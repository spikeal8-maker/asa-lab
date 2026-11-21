"""Exercise the real settings callback; no Docker, services or installation access."""
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager as manager


class PrivateSettings(unittest.TestCase):
    def installation(self, root, previous=None):
        root = root.resolve()
        state = root / '.asa'
        state.mkdir(mode=0o700)
        return SimpleNamespace(root=root, state=state, profile='production', project='fixture',
                               settings=dict(previous or {}))

    def test_actual_callback_preserves_complete_body_instance_and_flags(self):
        with tempfile.TemporaryDirectory() as directory:
            old = {'instanceId': 'stable-instance', 'window': {'start': '03:20'},
                   'collectorMode': 'system-root', 'collectorReaderGid': 1000,
                   'custom': {'nested': ['retained', 7]}, 'automaticUpdates': True}
            install = self.installation(Path(directory), old)
            with patch.object(manager.uuid, 'uuid4', side_effect=AssertionError('existing identity')):
                manager.save_settings(install, False)
            expected = {**old, 'format': 'asa-installation-v1', 'profile': 'production',
                        'project': 'fixture', 'automaticUpdates': False,
                        'backupDirectory': str(install.root / 'backups')}
            self.assertEqual(json.loads((install.state / 'installation.json').read_text()), expected)
            self.assertEqual(install.settings, old)
            self.assertEqual(list(install.state.glob('.*.tmp')), [])

    def test_new_instance_defaults_remain_stable_on_subsequent_save(self):
        with tempfile.TemporaryDirectory() as directory:
            install = self.installation(Path(directory))
            manager.save_settings(install, True)
            path = install.state / 'installation.json'
            initial = json.loads(path.read_text())
            self.assertRegex(initial['instanceId'], r'^[0-9a-f]{32}$')
            self.assertEqual(initial['window'], manager.DEFAULT_WINDOW)
            install.settings = initial
            manager.save_settings(install, True)
            self.assertEqual(json.loads(path.read_text()), initial)

    @unittest.skipUnless(os.name == 'posix', 'real POSIX umask/UID/mode contract')
    def test_new_and_existing_permissive_settings_are_always_private(self):
        for mask in (0o002, 0o022, 0o077):
            for existing in (False, True):
                with self.subTest(mask=mask, existing=existing), tempfile.TemporaryDirectory() as directory:
                    install = self.installation(Path(directory), {'instanceId': 'stable'})
                    path = install.state / 'installation.json'
                    if existing:
                        path.write_text('{"old":true}\n')
                        path.chmod(0o664)
                    previous = os.umask(mask)
                    try:
                        manager.save_settings(install, False)
                    finally:
                        os.umask(previous)
                    self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                    self.assertEqual(path.stat().st_uid, os.geteuid())
                    self.assertEqual(json.loads(path.read_text())['instanceId'], 'stable')
                    self.assertEqual(list(install.state.glob('.*.tmp')), [])

    def test_replace_failure_preserves_old_body_and_removes_temporary(self):
        with tempfile.TemporaryDirectory() as directory:
            install = self.installation(Path(directory), {'instanceId': 'stable'})
            path = install.state / 'installation.json'
            original = b'{"retained":"unchanged"}\n'
            path.write_bytes(original)
            old_mode = path.stat().st_mode
            with patch('deployment.paths.os.replace', side_effect=OSError('synthetic replace failure')):
                with self.assertRaises(OSError):
                    manager.save_settings(install)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(path.stat().st_mode, old_mode)
            self.assertEqual(list(install.state.glob('.*.tmp')), [])

    @unittest.skipUnless(os.name == 'posix', 'real POSIX links')
    def test_target_link_is_replaced_without_touching_foreign_inode(self):
        for kind in ('symlink', 'hardlink'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                install = self.installation(Path(directory), {'instanceId': 'stable'})
                foreign = install.root / 'foreign-preserved.json'
                foreign.write_bytes(b'foreign-preserved\n')
                before = foreign.stat()
                path = install.state / 'installation.json'
                if kind == 'symlink':
                    path.symlink_to(foreign)
                else:
                    os.link(foreign, path)
                manager.save_settings(install)
                self.assertFalse(path.is_symlink())
                self.assertNotEqual(path.stat().st_ino, foreign.stat().st_ino)
                self.assertEqual(foreign.read_bytes(), b'foreign-preserved\n')
                self.assertEqual(foreign.stat().st_mode, before.st_mode)
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    @unittest.skipUnless(os.name == 'posix', 'real POSIX redirected parent')
    def test_redirected_state_parent_fails_without_external_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            foreign = root / 'foreign'
            foreign.mkdir()
            state = root / '.asa'
            state.symlink_to(foreign, target_is_directory=True)
            install = SimpleNamespace(root=root, state=state, profile='production', project='fixture',
                                       settings={'instanceId': 'stable'})
            with self.assertRaises(ValueError):
                manager.save_settings(install)
            self.assertEqual(list(foreign.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
