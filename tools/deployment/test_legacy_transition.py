from contextlib import contextmanager, ExitStack
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.contracts import Blocked
from deployment import legacy
from deployment.test_legacy_release import release


class LegacyPlanTests(unittest.TestCase):
    def test_plan_checksum_rejects_manual_change_and_nonplan(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'plan.json'
            value = {'format': legacy.PLAN_FORMAT, 'id': 'a' * 32, 'release': release()}
            value['sha256'] = legacy.json_hash(value)
            path.write_text(json.dumps(value))
            self.assertEqual(legacy.read_plan(path), value)
            value['release']['schema'] += 1
            path.write_text(json.dumps(value))
            with self.assertRaises(Blocked): legacy.read_plan(path)

    def test_public_endpoint_preserved_while_private_web_port_can_change(self):
        old = {'services': {'web': {'ports': [{'host_ip': '127.0.0.1', 'published': '4610', 'target': 4610}]}}}
        target = copy.deepcopy(old)
        target['services']['web']['ports'][0]['target'] = 8080
        self.assertEqual(legacy.ports(old, 'web'), legacy.ports(target, 'web'))
        target['services']['web']['ports'][0]['published'] = '4612'
        self.assertNotEqual(legacy.ports(old, 'web'), legacy.ports(target, 'web'))

    def test_no_source_change_before_restoration_proof(self):
        install = Mock()
        for journal in ({}, {'backup': '/private/copy'}, {'restoreVerified': True}):
            with self.subTest(journal=journal), self.assertRaises(Blocked):
                legacy.preserve_before_checkout(install, {}, journal)
        install.git.assert_not_called()

    def test_live_apply_is_not_available_via_migration_probe(self):
        install = Mock(process_env={})
        config = {'services': {'migration': {'environment': {}}}}
        with patch.object(legacy, 'run') as command, self.assertRaises(Blocked):
            legacy.migration_probe(install, config, release(), apply=True)
        command.assert_not_called()


class PreservationTests(unittest.TestCase):
    def test_new_untracked_work_is_rejected_even_when_all_saved_source_bytes_match(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'installation'
            root.mkdir()
            saved = Path(directory) / 'saved'
            saved.mkdir(mode=0o700)
            (saved / 'metadata').mkdir()
            git_dir = root / '.git'
            git_dir.mkdir()
            (git_dir / 'index').write_bytes(b'index')
            source = root / 'work.txt'
            source.write_bytes(b'original work')
            (saved / 'work.txt').write_bytes(source.read_bytes())
            for relative in ('.asa/local-review', 'packages/contracts/dist'):
                (root / relative).mkdir(parents=True)
            recovery = {'source_root': str(root), 'source_head': 'a' * 40, 'source_branch': 'review',
                        'tracked_paths': ['work.txt'], 'untracked_paths': [], 'staged_paths': [],
                        'ignored_inventory': {'.asa/local-review': [], 'packages/contracts/dist': []},
                        'index_sha256': legacy.file_hash(git_dir / 'index')}
            (saved / 'metadata/recovery.json').write_text(json.dumps(recovery))
            manifest = {'format': 1, 'independent_git_fetch_fsck': True, 'database_backup': False,
                        'source_head': 'a' * 40, 'source_branch': 'review',
                        'source_copies': [{'source': str(source), 'sha256': legacy.file_hash(source)}],
                        'files': [{'path': item.relative_to(saved).as_posix(), 'bytes': item.stat().st_size,
                                   'sha256': legacy.file_hash(item)} for item in saved.rglob('*') if item.is_file()]}
            (saved / 'MANIFEST.json').write_text(json.dumps(manifest))
            answers = {('rev-parse', 'HEAD'): 'a' * 40, ('symbolic-ref', '--short', 'HEAD'): 'review',
                       ('rev-parse', '--absolute-git-dir'): str(git_dir),
                       ('diff', '--name-only', '-z', 'HEAD'): 'work.txt\0',
                       ('ls-files', '--others', '--exclude-standard', '-z'): '',
                       ('diff', '--cached', '--name-only', '-z'): ''}
            install = Mock(root=root)
            install.git.side_effect = lambda *args: answers[args]
            with patch('deployment.legacy_backup._check_private'):
                self.assertFalse(legacy.verify_preservation(install, saved)['isApplicationBackup'])
                answers[('ls-files', '--others', '--exclude-standard', '-z')] = 'new-work.txt\0'
                with self.assertRaises(Blocked) as failure:
                    legacy.verify_preservation(install, saved)
                self.assertEqual(failure.exception.code, 'LEGACY_PRESERVATION_DRIFT')


class TransitionOrderingTests(unittest.TestCase):
    @contextmanager
    def fixture(self, *, fail=None):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            root = Path(directory) / 'installation'
            root.mkdir()
            (root / '.asa').mkdir()
            private = Path(directory) / 'private'
            private.mkdir(mode=0o700)
            events = []
            product = release()
            image_id = 'sha256:' + 'e' * 64
            record = {'id': 'd' * 64, 'image': 'postgres:17.7-bookworm', 'imageId': image_id}
            plan = {'format': legacy.PLAN_FORMAT, 'id': 'a' * 32, 'manager': {'revision': 'c' * 40},
                    'managerEvidence': {'review': 'review'}, 'preservation': {'path': str(private)},
                    'release': product, 'registry': {'deploymentDigest': 'sha256:' + 'b' * 64},
                    'source': {'root': str(root), 'project': 'asa-lab-dev', 'profile': 'dev',
                               'entryOrigin': 'http://127.0.0.1:4610', 'runtime': {'api': {'schema': 261}},
                               'containers': {'postgres': record}, 'git': {'branch': 'review'}},
                    'targetSources': {'compose.yaml': 'source'}, 'targetConfigSha256': legacy.json_hash({})}
            plan['sha256'] = legacy.json_hash(plan)
            path = private / 'plan.json'
            path.write_text(json.dumps(plan))
            install = Mock(root=root, state=root / '.asa', profile='dev', project='asa-lab-dev',
                           env={'POSTGRES_DB': 'asalab', 'ASA_UPDATE_ENTRY_ORIGIN': 'http://127.0.0.1:4610'}, process_env={})
            install.identity.return_value = {'postgres': record}
            install.revalidate.side_effect = lambda *a, **k: events.append('revalidate')
            def compose(*args, **kwargs):
                if args[:2] == ('config', '--format'): return '{}'
                if args and args[0] == 'run':
                    events.append('live_migration')
                    self.assertIn('ASA_SEED_DEV=false', args)
                    if fail == 'switch': raise Blocked('TEST', 'synthetic switch failure', 'inspect')
                elif args and args[0] == 'up': events.append('up:' + args[-1])
            install.compose.side_effect = compose
            install.wait_ready.side_effect = lambda *a: events.append('new_readiness')
            stack.enter_context(patch.object(legacy, 'Installation', return_value=install))
            stack.enter_context(patch.object(legacy, 'LegacyInstallation', return_value=install))
            stack.enter_context(patch.object(legacy, 'manager_source', return_value=(Path(directory) / 'manager', plan['manager'])))
            stack.enter_context(patch.object(legacy, 'verify_manager_evidence', side_effect=lambda *a: events.append('tool_evidence')))
            stack.enter_context(patch.object(legacy, 'read_exact_release', return_value=(product, plan['registry'])))
            stack.enter_context(patch.object(legacy, 'assert_official_history'))
            stack.enter_context(patch.object(legacy, 'target_sources', return_value=plan['targetSources']))
            stack.enter_context(patch.object(legacy, 'verify_preservation', return_value=plan['preservation']))
            @contextmanager
            def selected(*args): yield install
            stack.enter_context(patch.object(legacy, 'target_installation', side_effect=selected))
            stack.enter_context(patch.object(legacy, 'attest_target', return_value={}))
            stack.enter_context(patch.object(legacy, 'validate_resolved_images', return_value={}))
            stack.enter_context(patch.object(legacy, 'check_resources'))
            stack.enter_context(patch.object(legacy, 'fetch_images', side_effect=lambda *a: events.append('images')))
            def probe(*a, **kwargs):
                events.append('restored_upgrade' if kwargs.get('apply') else 'read_only_migration_plan')
                if fail == 'upgrade' and kwargs.get('apply'): raise Blocked('TEST', 'synthetic upgrade failure', 'inspect')
            stack.enter_context(patch.object(legacy, 'migration_probe', side_effect=probe))
            def backup(*args, **kwargs):
                events.append('full_backup')
                self.assertTrue(kwargs['leave_stopped'])
                if fail == 'backup': raise OSError('synthetic disk failure')
                return private / 'complete'
            stack.enter_context(patch('deployment.legacy_backup.export_legacy_backup', side_effect=backup))
            stack.enter_context(patch('deployment.legacy_backup.verify_legacy_restore',
                                      side_effect=lambda *a, **k: events.append('restore') or {'status': 'verified'}))
            stack.enter_context(patch.object(legacy, 'data_summary', return_value={'users': 7}))
            def checkout(current, expected, journal):
                self.assertTrue(journal['restoreVerified'])
                self.assertIn('restored_upgrade', events)
                events.append('source_switch')
                legacy.write_journal(current, journal, 'switching_sources')
            stack.enter_context(patch.object(legacy, 'preserve_before_checkout', side_effect=checkout))
            stack.enter_context(patch.object(legacy, 'apply_release_environment'))
            stack.enter_context(patch.object(legacy, 'verify_embedded_entry_http'))
            stack.enter_context(patch.object(legacy, 'verify_running_release', side_effect=lambda *a: events.append('exact_versions')))
            stack.enter_context(patch.object(legacy, 'verify_neighbours', side_effect=lambda *a: events.append('neighbours')))
            stack.enter_context(patch.object(legacy, 'run', return_value=image_id))
            yield root, path, private, events, install

    def test_full_backup_restore_and_rehearsal_precede_source_and_live_migration(self):
        with self.fixture() as (root, path, private, events, install):
            result = legacy.apply_plan(root, path, output=private, database='legacy_test', object_sandbox=True)
            self.assertEqual(result['phase'], 'accepted')
            expected = ['tool_evidence', 'images', 'read_only_migration_plan', 'full_backup', 'restore',
                        'restored_upgrade', 'source_switch', 'live_migration', 'new_readiness', 'exact_versions', 'neighbours']
            self.assertEqual([item for item in events if item in expected], expected)
            self.assertEqual(json.loads((root / '.asa/installed-release.json').read_text()), release())

    def test_backup_upgrade_and_switch_failure_never_replay_or_restore_live(self):
        for failure in ('backup', 'upgrade', 'switch'):
            with self.subTest(failure=failure), self.fixture(fail=failure) as (root, path, private, events, install):
                with self.assertRaises((Blocked, OSError)):
                    legacy.apply_plan(root, path, output=private, database='legacy_test', object_sandbox=True)
                journal = json.loads((root / '.asa/legacy-transition.json').read_text())
                self.assertEqual(journal['phase'], 'failed')
                self.assertFalse(journal['automaticDatabaseRestore'])
                self.assertFalse((root / '.asa/installed-release.json').exists())
                if failure != 'switch': self.assertNotIn('source_switch', events)
                before = list(events)
                with patch.object(legacy, 'status', return_value={}) as observed, self.assertRaises(Blocked) as rejected:
                    legacy.apply_plan(root, path, output=private, database='legacy_test', object_sandbox=True)
                self.assertEqual(rejected.exception.code, 'LEGACY_INTERRUPTED')
                observed.assert_called_once_with(root)
                self.assertEqual(events, before)
                self.assertFalse(any(call.args and call.args[0] in ('start', 'down') for call in install.compose.call_args_list))

    def test_accepted_retry_rechecks_real_state_without_backup_or_migration(self):
        with self.fixture() as (root, path, private, events, install):
            legacy.apply_plan(root, path, output=private, database='legacy_test', object_sandbox=True)
            before = list(events)
            with patch.object(legacy, 'accepted_state', return_value={'revision': 'a' * 40}) as verified:
                result = legacy.apply_plan(root, path, output=private, database='legacy_test', object_sandbox=True)
            self.assertEqual(result['phase'], 'accepted')
            verified.assert_called_once()
            self.assertEqual(events, before)

    def test_invalid_test_target_is_rejected_before_images_or_backup(self):
        with self.fixture() as (root, path, private, events, install):
            for database in ('asalab', 'x;DROP DATABASE asalab', 'legacy'):
                with self.subTest(database=database), self.assertRaises(Blocked):
                    legacy.apply_plan(root, path, output=private, database=database, object_sandbox=True)
            self.assertEqual(events, [])
            self.assertFalse((root / '.asa/legacy-transition.json').exists())


if __name__ == '__main__':
    unittest.main()
