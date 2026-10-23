import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.contracts import Blocked, read_env
from deployment.entry_profiles import configure_entry, entry_profile, entry_environment_matches
import asa_manager


class EntryProfiles(unittest.TestCase):
    def test_saved_choice_is_not_skipped_on_same_release_and_preserves_legacy_path(self):
        install = MagicMock()
        install.env = {}
        self.assertTrue(entry_environment_matches(install))
        install.identity.assert_not_called()
        install.env = {'ASA_BLOCKS_SAME_ORIGIN': 'true', 'ASA_PUBLIC_WEB_ORIGINS': 'https://asa-lab.ru',
                       'ASA_PUBLIC_WEB_ORIGIN_PATTERNS': 'https://*.asa-lab.ru',
                       'ASA_BLOCKS_RUNTIME_ORIGIN': 'https://asa-lab.ru', 'ASA_BLOCKS_PARENT_ORIGIN': 'https://asa-lab.ru'}
        install.identity.return_value = {service: {'id': service} for service in ('api', 'web', 'scratch')}
        install.container_environment.return_value = dict(install.env)
        self.assertTrue(entry_environment_matches(install))
        install.container_environment.return_value = {**install.env, 'ASA_PUBLIC_WEB_ORIGIN_PATTERNS': ''}
        self.assertFalse(entry_environment_matches(install))

    def test_same_release_pending_configuration_is_reported_without_switch_on_check(self):
        from deployment.contracts import atomic_json
        from deployment.test_contracts import release
        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stdout(io.StringIO()) as output:
            install = MagicMock()
            install.state = Path(temporary)
            install.profile = 'production'
            install.env = {'ASA_UPDATE_ENTRY_ORIGIN': 'https://asa-lab.ru', 'ASA_BLOCKS_PARENT_ORIGIN': 'https://asa-lab.ru', 'ASA_BLOCKS_RUNTIME_ORIGIN': 'https://asa-lab.ru'}
            candidate = release()
            atomic_json(install.state / 'installed-release.json', candidate)
            install.readiness.return_value = {'revision': candidate['revision'], 'schema': candidate['schema']}
            with patch.object(asa_manager, 'doctor'), patch.object(asa_manager, 'clean_checkout'), \
                    patch.object(asa_manager, 'discover_release', return_value=candidate), patch.object(asa_manager, 'assert_ci'), \
                    patch.object(asa_manager, 'entry_environment_matches', return_value=False), \
                    patch.object(asa_manager, 'export_backup') as backup:
                asa_manager.update(install, check=True)
            self.assertIn('ENTRY_CONFIGURATION_PENDING', output.getvalue())
            self.assertIn('AVAILABLE', output.getvalue())
            backup.assert_not_called()
            install.compose.assert_not_called()

    @unittest.skipUnless(hasattr(os, 'fchown'), 'POSIX ownership preservation')
    def test_private_environment_owner_and_permissions_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stdout(io.StringIO()):
            root = self.fixture(temporary)
            os.chmod(root / '.env', 0o600)
            before = (root / '.env').stat()
            with patch('deployment.entry_profiles.os.fchown', wraps=os.fchown) as chown:
                configure_entry(root, 'asa-owned', 'https://test.asa-lab.ru', apply=True)
            self.assertEqual((before.st_uid, before.st_gid), chown.call_args.args[1:])
            after = (root / '.env').stat()
            self.assertEqual((before.st_uid, before.st_gid, 0o600), (after.st_uid, after.st_gid, after.st_mode & 0o777))

    def test_cli_preview_and_invalid_argument_do_not_create_state(self):
        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stdout(io.StringIO()):
            root = self.fixture(temporary)
            before = (root / '.env').read_bytes()
            self.assertEqual(0, asa_manager.main(['configure-entry', '--root', str(root), '--entry-profile', 'asa-owned', '--entry-origin', 'https://test.asa-lab.ru']))
            self.assertEqual(before, (root / '.env').read_bytes())
            self.assertFalse((root / '.asa').exists())
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(2, asa_manager.main(['install', '--root', str(root), '--entry-profile', 'asa-owned']))
            self.assertFalse((root / '.asa').exists())

    def fixture(self, temporary):
        root = Path(temporary)
        profiles = root / 'deployment' / 'entry-profiles'
        profiles.mkdir(parents=True)
        source = Path(__file__).resolve().parents[2] / 'deployment' / 'entry-profiles' / 'asa-owned.json'
        (profiles / source.name).write_bytes(source.read_bytes())
        (root / '.env').write_text('# private\nASA_SETTINGS_ENCRYPTION_KEY=synthetic-preserve\nAPP_DATABASE_URL=synthetic-preserve\nASA_PUBLIC_WEB_ORIGINS=https://custom.example.org\n', encoding='utf-8')
        return root

    def test_plan_apply_idempotence_and_private_rollback(self):
        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stdout(io.StringIO()) as output:
            root = self.fixture(temporary)
            before = (root / '.env').read_bytes()
            configure_entry(root, 'asa-owned', 'https://future.pretest.asa-lab.ru')
            self.assertEqual(before, (root / '.env').read_bytes())
            self.assertFalse((root / '.asa').exists())
            configure_entry(root, 'asa-owned', 'https://future.pretest.asa-lab.ru', apply=True)
            saved = read_env(root / '.env')
            self.assertEqual('synthetic-preserve', saved['ASA_SETTINGS_ENCRYPTION_KEY'])
            self.assertEqual('synthetic-preserve', saved['APP_DATABASE_URL'])
            self.assertIn('https://custom.example.org', saved['ASA_PUBLIC_WEB_ORIGINS'])
            self.assertEqual('https://*.asa-lab.ru', saved['ASA_PUBLIC_WEB_ORIGIN_PATTERNS'])
            self.assertEqual('true', saved['ASA_BLOCKS_SAME_ORIGIN'])
            backups = list((root / '.asa' / 'private-entry-backups').glob('*.env'))
            self.assertEqual(1, len(backups))
            self.assertEqual(before, backups[0].read_bytes())
            after = (root / '.env').read_bytes()
            configure_entry(root, 'asa-owned', 'https://future.pretest.asa-lab.ru', apply=True)
            self.assertEqual(after, (root / '.env').read_bytes())
            self.assertEqual(1, len(list(backups[0].parent.glob('*.env'))))
            self.assertNotIn('synthetic-preserve', output.getvalue())

    def test_invalid_or_legacy_http_entry_fails_before_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.fixture(temporary)
            before = (root / '.env').read_bytes()
            for origin in ['http://172.23.104.170:4610', 'https://evil.test', 'https://asa-lab.ru.evil.test', 'https://test.asa-lab.ru:8443']:
                with self.assertRaises(Blocked):
                    configure_entry(root, 'asa-owned', origin, apply=True)
                self.assertEqual(before, (root / '.env').read_bytes())
            self.assertFalse((root / '.asa').exists())

    def test_unknown_schema_and_zone_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.fixture(temporary)
            path = root / 'deployment' / 'entry-profiles' / 'asa-owned.json'
            profile = json.loads(path.read_text())
            for patch in [{'schemaVersion': 2}, {'httpsSubdomainZones': ['*']}, {'httpsSubdomainZones': ['https://*.ru']}]:
                path.write_text(json.dumps({**profile, **patch}))
                with self.assertRaises(Blocked):
                    entry_profile(root, 'asa-owned', 'https://asa-lab.ru', {})


if __name__ == '__main__':
    unittest.main()
