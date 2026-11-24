#!/usr/bin/env python3
"""Receive and activate a checked build through the VPS's restricted SSH login."""
import filecmp
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

ROOT = Path('/opt/shopbot-vps')
BACKUPS = Path('/var/backups/shopbot-migration')
UNIT = Path('/etc/systemd/system/shopbot-vps.service')
SERVICE = 'shopbot-vps.service'
MAX_ARCHIVE = 256 * 1024**2
MAX_CONTENT = 1024 * 1024**2
BACKUP_AGE = 86400


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def read_json(path):
    return json.loads(path.read_text())


def current():
    release = (ROOT / 'current').resolve(strict=True)
    require(release.parent == ROOT / 'releases', 'The active release is outside the release directory.')
    return release


def ready(release):
    if current() != release:
        return False
    try:
        with urllib.request.urlopen('http://127.0.0.1:3017/health/ready', timeout=4) as response:
            status = json.load(response)
        pid = subprocess.check_output(['systemctl', 'show', '-p', 'MainPID', '--value', SERVICE], text=True).strip()
        return (status.get('status') == 'ready' and status.get('mode') == 'connected'
                and status.get('processing') is True and status.get('sending') is True
                and Path('/proc', pid, 'cwd').resolve(strict=True) == release / 'app')
    except (OSError, ValueError, subprocess.SubprocessError):
        return False


def file_hashes(root):
    return {p.relative_to(root): digest(p) for p in root.rglob('*') if p.is_file()}


def compatible(candidate, active):
    require(filecmp.cmp(candidate / 'deploy/shopbot-vps.service', UNIT, shallow=False),
            'The systemd unit changed. Use the VPS runbook for this release.')
    database_code = Path('app/dist/apps/server/src/db')
    candidate_db = file_hashes(candidate / database_code)
    require(candidate_db and candidate_db == file_hashes(active / database_code),
            'Database code changed. Use the VPS runbook for this release.')
    require(filecmp.cmp(candidate / 'app/package-lock.json', active / 'app/package-lock.json', shallow=False),
            'Dependencies changed. Use the VPS runbook for this release.')
    require(ready(active), 'The current release was not ready. Inspect it before deploying.')


def receive(path, expected_sha):
    checksum = hashlib.sha256()
    size = 0
    with path.open('wb') as target:
        while chunk := sys.stdin.buffer.read(1024**2):
            size += len(chunk)
            require(size <= MAX_ARCHIVE, 'Release archive exceeds the transfer limit.')
            checksum.update(chunk)
            target.write(chunk)
    require(checksum.hexdigest() == expected_sha, 'Release archive checksum does not match.')


def unpack(path, destination, commit):
    with tarfile.open(path, 'r:gz') as archive:
        members, names, size = [], set(), 0
        for member in archive:
            name = PurePosixPath(member.name)
            require(name.parts and not name.is_absolute() and '..' not in name.parts
                    and re.fullmatch(r'preview-[a-f0-9]{12}', name.parts[0])
                    and (member.isfile() or member.isdir())
                    and not any(part.startswith('.env') or part in {'.git', 'owner-only'} for part in name.parts),
                    'Invalid or private path in the release archive.')
            require(str(name) not in names, 'Duplicate release path.')
            names.add(str(name))
            size += member.size
            require(size <= MAX_CONTENT and len(names) <= 50000, 'Unpacked release exceeds the size limit.')
            members.append(member)
        roots = {PurePosixPath(member.name).parts[0] for member in members}
        require(len(roots) == 1, 'Expected one release directory.')
        require(shutil.disk_usage(ROOT).free > size + 512 * 1024**2, 'Insufficient disk space to stage this release.')
        archive.extractall(destination, members=members, filter='data')
    candidate = destination / roots.pop()
    # The scratch directory stays private during validation. The runtime user must
    # be able to traverse the installed public build after activation.
    for directory in [candidate, *(p for p in candidate.rglob('*') if p.is_dir())]:
        directory.chmod(0o755)
    manifest = read_json(candidate / 'manifest.json')
    proof = read_json(candidate / 'app/dist/release-manifest.json')
    payload = json.dumps(proof['files'], ensure_ascii=False, separators=(',', ':')).encode()
    require(manifest['release_id'] == candidate.name and manifest['source_base_commit'] == commit
            and proof['gitCommit'] == commit and proof['clean'] is True
            and manifest['verified_artifact_sha256'] == proof['artifactHash'] == hashlib.sha256(payload).hexdigest(),
            'Release identity does not match the approved commit and build.')
    require(manifest['runtime_from_release'] is None and (candidate / 'node/bin/node').stat().st_mode & 0o111,
            'Expected a complete native release.')
    actual = {}
    for item in ('dist', 'resources', 'package.json', 'package-lock.json'):
        base = candidate / 'app' / item
        for file in base.rglob('*') if base.is_dir() else [base]:
            if file.is_file() and file != candidate / 'app/dist/release-manifest.json':
                actual[file.relative_to(candidate / 'app').as_posix()] = digest(file)
    require(len(actual) == len(proof['files']) and actual == {x['path']: x['sha256'] for x in proof['files']},
            'The unpacked build differs from its manifest.')
    return candidate


def backup():
    candidates = sorted((p for p in BACKUPS.glob('owner-*/database.dump') if p.is_file()),
                        key=lambda p: p.stat().st_mtime, reverse=True)
    rolling = BACKUPS / 'github-routine'
    snapshot = rolling / 'database.dump'
    for path in [snapshot, *candidates[:1]]:
        if path.is_file() and time.time() - path.stat().st_mtime <= BACKUP_AGE:
            if subprocess.run(['pg_restore', '--list', str(path)], stdout=subprocess.DEVNULL).returncode == 0:
                return path
    rolling.mkdir(mode=0o700, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=rolling) as temp:
        candidate = Path(temp) / 'database.dump'
        with candidate.open('wb') as output:
            subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_dump', '--format=custom', 'shopbot_vps_preview'],
                           stdout=output, check=True)
        subprocess.run(['pg_restore', '--list', str(candidate)], stdout=subprocess.DEVNULL, check=True)
        os.replace(candidate, snapshot)
    return snapshot


def stage(commit, sha):
    started = time.monotonic()
    active = current()
    prepared = ROOT / 'github-staged'
    with tempfile.TemporaryDirectory(prefix='.github-', dir=ROOT) as temp:
        temp = Path(temp)
        archive = temp / 'release.tar.gz'
        receive(archive, sha)
        candidate = unpack(archive, temp, commit)
        archive.unlink()
        compatible(candidate, active)
        print(f'Checked the staged build in {time.monotonic()-started:.0f}s.', flush=True)
        verified = backup()
        record = {'commit': commit, 'release': candidate.name, 'base': active.name,
                  'archive_sha256': sha, 'backup': str(verified)}
        new_stage = temp / 'prepared'
        new_stage.mkdir(mode=0o700)
        candidate.rename(new_stage / candidate.name)
        (new_stage / 'release.json').write_text(json.dumps(record))
        if prepared.exists():
            prepared.rename(temp / 'superseded')
        new_stage.rename(prepared)
    print(f'Staged {record["release"]} from {commit} in {time.monotonic()-started:.0f}s. Activation is manual.')


def switch(release):
    with tempfile.TemporaryDirectory(prefix='.switch-', dir=ROOT) as temp:
        link = Path(temp) / 'current'
        link.symlink_to(release)
        os.replace(link, ROOT / 'current')


def restart_and_wait(release):
    if subprocess.run(['systemctl', 'restart', SERVICE], timeout=45).returncode != 0:
        return False
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        if ready(release):
            return True
        time.sleep(2)
    return False


def activate(commit):
    started = time.monotonic()
    prepared = ROOT / 'github-staged'
    require(not Path('/run/systemd/system/cloudflared.service.d/shopbot-local.conf').exists(),
            'Stop the connected local WhatsApp session before activating.')
    active = current()
    if read_json(active / 'manifest.json')['source_base_commit'] == commit and ready(active):
        print(f'{active.name} already runs {commit} and is ready.')
        return
    record = read_json(prepared / 'release.json')
    require(record['commit'] == commit and record['base'] == active.name,
            'The staged build or active base changed. Run Project checks on main to restage.')
    verified = Path(record['backup'])
    require(verified.is_file() and time.time() - verified.stat().st_mtime <= BACKUP_AGE,
            'The verified backup is older than 24 hours. Restage before activating.')
    candidate = prepared / record['release']
    compatible(candidate, active)
    installed = ROOT / 'releases' / candidate.name
    require(not installed.exists(), 'A release with this ID is already installed. Inspect it before retrying.')
    (ROOT / 'previous-release.txt').write_text(str(active) + '\n')
    candidate.rename(installed)
    try:
        switch(installed)
        require(restart_and_wait(installed), 'Candidate did not pass readiness.')
    except (OSError, ValueError, subprocess.SubprocessError, KeyboardInterrupt):
        if current() == installed:
            switch(active)
            require(restart_and_wait(active), 'Readiness failed and the restored version needs attention.')
        installed.rename(candidate)
        raise ValueError(f'Activation failed. Restored {active.name}.') from None
    shutil.rmtree(prepared)
    print(f'Activated {installed.name} from {commit}. Readiness and worker flags verified in {time.monotonic()-started:.0f}s.')


def main():
    command = sys.argv[1] if len(sys.argv) == 2 else ''
    if command == 'status':
        active = current()
        require(ready(active), 'The active release is not ready.')
        print(f'Active release: {active.name} ({read_json(active / "manifest.json")["source_base_commit"]})')
        receipt = ROOT / 'github-staged/release.json'
        if receipt.is_file():
            record = read_json(receipt)
            print(f'Staged release: {record["release"]} ({record["commit"]})')
        return
    match = re.fullmatch(r'stage ([0-9a-f]{40}) ([0-9a-f]{64})', command)
    if match:
        stage(*match.groups())
        return
    match = re.fullmatch(r'activate ([0-9a-f]{40})', command)
    if match:
        activate(match[1])
        return
    raise ValueError('The release login supports status, stage and activate.')


def interrupted(_signal, _frame):
    raise KeyboardInterrupt


if __name__ == '__main__':
    signal.signal(signal.SIGHUP, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    os.umask(0o077)
    try:
        with (ROOT / 'deploy.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, tarfile.TarError, KeyboardInterrupt) as error:
        sys.exit(f'Release operation failed: {error}')
