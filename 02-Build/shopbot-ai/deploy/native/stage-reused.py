#!/usr/bin/env python3
"""Stage a checksummed slim bundle, reusing an installed immutable runtime."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile

p=argparse.ArgumentParser()
p.add_argument('archive',type=Path)
p.add_argument('sha256')
a=p.parse_args()
assert os.geteuid()==0, 'Run with sudo'
assert re.fullmatch('[a-f0-9]{64}',a.sha256)
assert hashlib.sha256(a.archive.read_bytes()).hexdigest()==a.sha256, 'Bundle checksum mismatch'
base=Path('/opt/shopbot-vps/releases')
with tarfile.open(a.archive,'r:gz') as archive:
    members=archive.getmembers()
    roots={PurePosixPath(m.name).parts[0] for m in members}
    assert len(roots)==1
    name=roots.pop()
    assert re.fullmatch('preview-[a-f0-9]{12}',name)
    for m in members:
        path=PurePosixPath(m.name)
        assert not path.is_absolute() and '..' not in path.parts and (m.isfile() or m.isdir()), 'Invalid bundle member'
    manifest=json.load(archive.extractfile(name+'/manifest.json'))
    old=manifest.get('runtime_from_release','')
    assert re.fullmatch('preview-[a-f0-9]{12}',old)
    previous=base/old
    assert previous.is_dir() and not previous.is_symlink()
    old_manifest=json.loads((previous/'manifest.json').read_text())
    assert old_manifest['node_version']==manifest['node_version']=='22.22.1'
    assert subprocess.check_output([str(previous/'node/bin/node'),'--version'],text=True).strip()=='v22.22.1'
    new_lock_bytes=archive.extractfile(name+'/app/package-lock.json').read()
    old_lock_bytes=(previous/'app/package-lock.json').read_bytes()
    additions=manifest.get('dependency_additions',[])
    if additions:
        assert hashlib.sha256(old_lock_bytes).hexdigest()==manifest['base_lock_sha256'], 'Installed dependency base differs'
        old_lock=json.loads(old_lock_bytes)['packages']; new_lock=json.loads(new_lock_bytes)['packages']
        assert all(key in new_lock and new_lock[key]==value for key,value in old_lock.items() if key), 'Existing dependencies cannot change in an additive bundle'
        assert len(set(additions))==len(additions) and all(key.startswith('node_modules/') and '..' not in PurePosixPath(key).parts and key not in old_lock and key in new_lock for key in additions)
        for member in members:
            relative=PurePosixPath(member.name).relative_to(name)
            if member.isfile() and relative.parts[:2]==('app','node_modules'):
                dep=str(relative)[4:]
                assert any(dep.startswith(key+'/') for key in additions), 'Only new dependency files may be bundled'
    else:
        assert old_lock_bytes==new_lock_bytes, 'Runtime dependency change requires a complete bundle'
        old_package=json.loads((previous/'app/package.json').read_text());new_package=json.load(archive.extractfile(name+'/app/package.json'))
        old_scripts=old_package.pop('scripts',{});new_scripts=new_package.pop('scripts',{})
        assert old_package==new_package and old_scripts.get('start')==new_scripts.get('start'), 'Runtime package change requires a complete bundle'
    unpacked=sum(m.size for m in members)
    assert shutil.disk_usage(base).free-unpacked>1024**3, 'Keep at least 1 GiB free'
    stage=base/name
    assert not stage.exists(), 'Immutable release already exists'
    archive.extractall(base,filter='data')
    try:
        shutil.copytree(previous/'node',stage/'node',copy_function=os.link,symlinks=True)
        shutil.copytree(previous/'app/node_modules',stage/'app/node_modules',copy_function=os.link,symlinks=True,dirs_exist_ok=True)
        print(json.dumps({'staged_release':name,'runtime_reused_from':old,'bundle_sha256':a.sha256,'new_content_bytes':unpacked,'disk_free_bytes':shutil.disk_usage(base).free}))
    except Exception:
        shutil.rmtree(stage)
        raise
