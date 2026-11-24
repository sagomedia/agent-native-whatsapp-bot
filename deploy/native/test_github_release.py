import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('github_release', Path(__file__).with_name('github-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
NAME = 'preview-abcd01234567'
COMMIT = 'a' * 40


class ReleaseTests(unittest.TestCase):
    def archive(self, target, extra=None):
        artifact = 'dist/example.js'
        artifacts = [{'path': artifact, 'sha256': hashlib.sha256(b'compiled').hexdigest()}]
        fingerprint = hashlib.sha256(json.dumps(artifacts, separators=(',', ':')).encode()).hexdigest()
        files = {
            'manifest.json': json.dumps({'release_id': NAME, 'source_base_commit': COMMIT,
                                        'verified_artifact_sha256': fingerprint, 'runtime_from_release': None}).encode(),
            'app/dist/release-manifest.json': json.dumps({'gitCommit': COMMIT, 'clean': True,
                                                        'artifactHash': fingerprint, 'files': artifacts}).encode(),
            'app/' + artifact: b'compiled',
            'node/bin/node': b'runtime',
        }
        with tarfile.open(target, 'w:gz') as bundle:
            for path, body in files.items():
                member = tarfile.TarInfo(f'{NAME}/{path}')
                member.mode = 0o755 if path == 'node/bin/node' else 0o644
                member.size = len(body)
                bundle.addfile(member, io.BytesIO(body))
            if extra:
                bundle.addfile(extra)

    def test_unpack_verifies_commit_and_makes_build_readable(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(release, 'ROOT', Path(directory)):
            archive = Path(directory) / 'release.tar.gz'
            self.archive(archive)
            candidate = release.unpack(archive, Path(directory), COMMIT)
            self.assertEqual((candidate / 'app/dist/example.js').read_bytes(), b'compiled')
            self.assertEqual((candidate / 'app/dist').stat().st_mode & 0o777, 0o755)
            with self.assertRaisesRegex(ValueError, 'approved commit'):
                release.unpack(archive, Path(directory), 'b' * 40)

    def test_archive_rejects_links_and_private_files(self):
        for name, kind in (('app/node_modules/link', tarfile.SYMTYPE), ('app/.env', tarfile.REGTYPE),
                           ('../escape', tarfile.REGTYPE)):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                archive = Path(directory) / 'release.tar.gz'
                extra = tarfile.TarInfo(f'{NAME}/{name}')
                extra.type = kind
                extra.linkname = '/etc/shopbot-vps.env'
                self.archive(archive, extra)
                with self.assertRaisesRegex(ValueError, 'Invalid or private path'):
                    release.unpack(archive, Path(directory), COMMIT)

    def test_failed_readiness_reinstates_active_release_and_retains_candidate(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(release, 'ROOT', Path(directory)):
            root = Path(directory)
            active = root / 'releases/preview-000000000000'
            active.mkdir(parents=True)
            (active / 'manifest.json').write_text(json.dumps({'source_base_commit': 'b' * 40}))
            (root / 'current').symlink_to(active)
            staged = root / 'github-staged'
            (staged / NAME).mkdir(parents=True)
            backup = root / 'backup.dump'
            backup.touch()
            (staged / 'release.json').write_text(json.dumps({'commit': COMMIT, 'release': NAME,
                                                           'base': active.name, 'backup': str(backup)}))
            with patch.object(release, 'compatible'), patch.object(release, 'restart_and_wait', side_effect=[False, True]):
                with self.assertRaisesRegex(ValueError, 'Restored'):
                    release.activate(COMMIT)
            self.assertEqual(release.current(), active)
            self.assertTrue((staged / NAME).is_dir())


if __name__ == '__main__':
    unittest.main()
