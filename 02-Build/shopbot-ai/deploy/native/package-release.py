#!/usr/bin/env python3
"""Package a verified local build for the loopback-only native VPS preview."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--node-archive', type=Path, required=True)
parser.add_argument('--node-shasums', type=Path, required=True)
parser.add_argument('--output-dir', type=Path, required=True)
args = parser.parse_args()
app = Path(__file__).resolve().parents[2]
assert (app / 'dist/apps/server/src/index.js').is_file(), 'Run npm run build first'
node_name = 'node-v22.22.1-linux-x64.tar.xz'
expected = next(line.split()[0] for line in args.node_shasums.read_text().splitlines()
                if line.endswith('  ' + node_name))
assert hashlib.sha256(args.node_archive.read_bytes()).hexdigest() == expected, 'Node checksum mismatch'

source_hash = hashlib.sha256()
excluded = {'node_modules', 'dist', 'data', 'owner-only', '__pycache__', '.git'}
source_files = []
for path in sorted(app.rglob('*')):
    relative = path.relative_to(app)
    if any(part in excluded for part in relative.parts) or path.name.startswith('.env'):
        continue
    if path.is_symlink():
        raise RuntimeError('Unexpected source symlink: ' + str(relative))
    if path.is_file() and not path.name.endswith(('.pyc', '.log')):
        data = path.read_bytes()
        source_hash.update(str(relative).encode() + b'\0' + data + b'\0')
        source_files.append({'path': str(relative), 'sha256': hashlib.sha256(data).hexdigest()})
release_id = 'preview-' + source_hash.hexdigest()[:12]
args.output_dir.mkdir(parents=True, exist_ok=True)
stage = args.output_dir / release_id
if stage.exists():
    raise RuntimeError('Release already exists; do not overwrite an immutable release')
(stage / 'app').mkdir(parents=True)
for name in ['package.json', 'package-lock.json']:
    shutil.copy2(app / name, stage / 'app' / name)
shutil.copytree(app / 'dist', stage / 'app/dist')
catalog = stage / 'app/resources/catalog/ksmc-demo'
catalog.mkdir(parents=True)
for name in ['catalog.json', 'catalog-map.json']:
    shutil.copy2(app / 'resources/catalog/ksmc-demo' / name, catalog / name)
shutil.copytree(app / 'resources/catalog/ksmc-demo/images', catalog / 'images')

subprocess.run(['npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
               cwd=stage / 'app', check=True)
(stage / 'node/bin').mkdir(parents=True)
with tarfile.open(args.node_archive, 'r:xz') as archive:
    root = node_name.removesuffix('.tar.xz')
    for member, destination in [(root + '/bin/node', stage / 'node/bin/node'),
                                (root + '/LICENSE', stage / 'node/LICENSE')]:
        source = archive.extractfile(member)
        assert source is not None
        destination.write_bytes(source.read())
(stage / 'node/bin/node').chmod(0o755)
shutil.copytree(app / 'deploy/native', stage / 'deploy', ignore=shutil.ignore_patterns('__pycache__'))
for name in ['install.sh', 'rollback.sh', 'upgrade.sh']:
    (stage / 'deploy' / name).chmod(0o755)

repository = next((path for path in [app, *app.parents] if (path / '.git').exists()), None)
assert repository is not None, 'The release source must belong to a Git checkout'
# Managed worktrees may inherit core.worktree from a different/shared checkout.
# Override it for this metadata read without changing the user's Git config.
git = subprocess.run(['git', '-c', 'core.worktree=' + str(repository),
                      '--work-tree=' + str(repository), 'rev-parse', 'HEAD'],
                     cwd=app, text=True, capture_output=True, check=True)
manifest = {
    'release_id': release_id,
    'source_base_commit': git.stdout.strip(),
    'source_tree_sha256': source_hash.hexdigest(),
    'source_files': source_files,
    'node_version': '22.22.1',
    'node_archive_sha256': expected,
    'database_major': 17,
    'default_mode': 'mock',
    'default_listen': '127.0.0.1:3017',
    'paid_inference': False,
    'whatsapp_connected': False,
}
(stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
for path in stage.rglob('*'):
    if path.name.startswith('.env') or 'owner-only' in path.parts:
        raise RuntimeError('Unexpected private file in release: ' + str(path))
archive_path = args.output_dir / ('shopbot-vps-' + release_id + '.tar.gz')
with tarfile.open(archive_path, 'w:gz') as archive:
    archive.add(stage, arcname=release_id)
checksum = hashlib.sha256(archive_path.read_bytes()).hexdigest()
(archive_path.with_suffix(archive_path.suffix + '.sha256')).write_text(checksum + '  ' + archive_path.name + '\n')
print(json.dumps({'release_id': release_id, 'archive': str(archive_path),
                  'archive_bytes': archive_path.stat().st_size,
                  'unpacked_bytes': sum(p.stat().st_size for p in stage.rglob('*') if p.is_file()),
                  'sha256': checksum}, indent=2))
