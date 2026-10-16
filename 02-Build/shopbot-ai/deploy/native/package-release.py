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
runtime = parser.add_mutually_exclusive_group(required=True)
runtime.add_argument('--node-archive', type=Path)
runtime.add_argument('--reuse-release', help='Installed immutable release whose runtime and identical production dependencies will be hard-linked on the VPS')
parser.add_argument('--dependency-additions-from',type=Path,help='Base lockfile for a verified additive dependency bundle; shared package entries must remain identical')
parser.add_argument('--source-base-commit',help='Verified base commit when packaging a recovered source copy')
parser.add_argument('--node-shasums', type=Path)
parser.add_argument('--output-dir', type=Path, required=True)
args = parser.parse_args()
app = Path(__file__).resolve().parents[2]
assert (app / 'dist/apps/server/src/index.js').is_file(), 'Run npm run build first'
proof=json.loads((app/'dist/release-manifest.json').read_text())
subprocess.run(['node','--input-type=module','-e',"import {verifyRelease} from './dist/apps/server/src/services/release-manifest.js'; await verifyRelease(process.cwd(),true);"],cwd=app,check=True)
node_name = 'node-v22.22.1-linux-x64.tar.xz'
expected = None
if args.node_archive:
    assert args.node_shasums, 'Node checksums are required for a new runtime'
    expected = next(line.split()[0] for line in args.node_shasums.read_text().splitlines()
                    if line.endswith('  ' + node_name))
    assert hashlib.sha256(args.node_archive.read_bytes()).hexdigest() == expected, 'Node checksum mismatch'
else:
    import re
    assert re.fullmatch(r'preview-[a-f0-9]{12}', args.reuse_release), 'Invalid installed runtime release'

source_hash = hashlib.sha256()
excluded = {'node_modules', 'dist', 'data', 'owner-only', '__pycache__', '.git', 'preview', 'artifacts'}
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
shutil.copytree(app / 'resources/fonts',stage / 'app/resources/fonts')
if (app/'resources/welcome').exists():
    shutil.copytree(app/'resources/welcome',stage/'app/resources/welcome')
dependency_additions=[]
base_lock_sha256=None
if args.dependency_additions_from:
    assert args.reuse_release, 'Dependency additions require the installed immutable base release'
    base_lock=args.dependency_additions_from.read_bytes()
    old=json.loads(base_lock)['packages']
    new=json.loads((app/'package-lock.json').read_bytes())['packages']
    assert all(key in new and new[key]==value for key,value in old.items() if key), 'Existing dependency changes require a complete new bundle'
    base_lock_sha256=hashlib.sha256(base_lock).hexdigest()
    for key in sorted(new):
        if key and key not in old and (app/key).is_dir():
            dependency_additions.append(key)
            shutil.copytree(app/key,stage/'app'/key,symlinks=False)
    assert dependency_additions, 'No new dependencies to bundle'

if args.node_archive:
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
# A slim stage intentionally lacks the reused dependency tree until staging on
# the VPS. Verify its exact artifact set without importing Node dependencies.
assert json.loads((stage/'app/dist/release-manifest.json').read_text())==proof
packaged_files=[]
for root in ['dist','resources','package.json','package-lock.json']:
    target=stage/'app'/root
    for path in sorted(target.rglob('*')) if target.is_dir() else [target]:
        if path.is_file():
            relative=path.relative_to(stage/'app').as_posix()
            if relative!='dist/release-manifest.json':
                assert not path.is_symlink(), 'Artifact symlinks are forbidden'
                packaged_files.append({'path':relative,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
assert sorted(packaged_files,key=lambda item:item['path'])==proof['files'], 'Packaged artifacts differ from the verified source build'
for name in ['install.sh', 'rollback.sh', 'upgrade.sh']:
    (stage / 'deploy' / name).chmod(0o755)

repository = next((path for path in [app, *app.parents] if (path / '.git').exists()), None)
assert repository is not None or args.source_base_commit, 'Supply a verified base commit for a recovered source copy'
# Managed worktrees may inherit core.worktree from a different/shared checkout.
# Override it for this metadata read without changing the user's Git config.
if args.source_base_commit:
    import re
    assert re.fullmatch('[a-f0-9]{40}',args.source_base_commit), 'Invalid source base commit'
    base_commit=args.source_base_commit
else:
    git_dir=repository/'.git'
    if git_dir.is_file():
        pointer=git_dir.read_text().strip()
        assert pointer.startswith('gitdir: '), 'Invalid managed worktree metadata'
        git_dir=(repository/pointer.removeprefix('gitdir: ')).resolve()
    base_commit=subprocess.check_output(['git','--git-dir='+str(git_dir),'--work-tree='+str(repository),'rev-parse','HEAD'],cwd=app,text=True).strip()
assert proof['gitCommit']==base_commit, 'Built release must match the current source commit'
manifest = {
    'release_id': release_id,
    'source_base_commit': base_commit,
    'verified_artifact_sha256':proof['artifactHash'],
    'prompt_version':proof['promptVersion'],
    'understanding_version':proof['understandingVersion'],
    'model_id':proof['model'],
    'dependency_additions':dependency_additions,
    'base_lock_sha256':base_lock_sha256,
    'source_tree_sha256': source_hash.hexdigest(),
    'source_files': source_files,
    'node_version': '22.22.1',
    'node_archive_sha256': expected,
    'runtime_from_release': args.reuse_release,
    'runtime_dependencies_lock_sha256': hashlib.sha256((app / 'package-lock.json').read_bytes()).hexdigest(),
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
