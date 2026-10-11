"""Lifecycle tests never register host tasks or services."""
import datetime as dt
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import collector as lifecycle
from deployment.contracts import Blocked, atomic_json
from deployment.system import Installation
import asa_manager
from collect_logs import write_process_health, write_collector_health, process_identity


def fixture(root):
    (root / 'tools').mkdir()
    for name in ('collect_logs.py', 'collect-windows-logs.ps1'):
        (root / 'tools' / name).write_text('fixture-' + name)
    (root / '.env').write_text('COMPOSE_PROJECT_NAME=asa-lab-dev\n')
    return Installation(root, 'dev')


class CollectorLifecycleTests(unittest.TestCase):
    def test_status_and_manager_doctor_check_do_not_create_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            result = lifecycle.status(install)
            self.assertEqual(result['state'], 'unavailable')
            with patch.object(install, 'identity', return_value={}), patch.object(install, 'readiness', return_value={'revision': 'a'*40, 'schema': 203}), patch('asa_manager.run'):
                asa_manager.doctor(install)
            with patch.object(install, 'readiness', return_value={'revision': 'a'*40, 'schema': 203}), patch('asa_manager.doctor'), patch('asa_manager.clean_checkout'), patch('asa_manager.attest_editor_env'), patch('asa_manager.discover_release', return_value={'revision': 'a'*40, 'schema': 203}), patch('asa_manager.assert_ci'), patch('asa_manager.prepare_collector') as prepare, patch('asa_manager.reconcile_collector') as reconcile:
                asa_manager.update(install, check=True)
                prepare.assert_not_called(); reconcile.assert_not_called()
            after = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            self.assertEqual(before, after)

    def test_prepare_preserves_custom_config_history_and_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            config = {'version': 1, 'project': install.project, 'retentionDays': 45, 'maxBytes': 4*1024**3, 'customFutureSetting': True}
            atomic_json(install.state / 'log-collector.json', config)
            atomic_json(install.state / 'installation.json', {'project': install.project, 'profile': 'dev', 'automaticUpdates': True})
            install = Installation(root, 'dev')
            history = install.state / 'diagnostics/private/index.sqlite'; history.parent.mkdir(parents=True); history.write_bytes(b'durable-history')
            before = (install.state / 'log-collector.json').read_bytes()
            with patch('deployment.collector.WINDOWS', True), patch.object(install, 'identity', return_value={}):
                lifecycle.prepare(install); lifecycle.prepare(install)
            self.assertEqual(before, (install.state / 'log-collector.json').read_bytes())
            self.assertTrue(json.loads((install.state / 'installation.json').read_text())['automaticUpdates'])
            self.assertEqual(history.read_bytes(), b'durable-history')

    def test_invalid_project_and_future_schema_reject_before_any_write(self):
        for config in ({'version': 2}, {'project': 'another-stack'}, {'intervalSeconds': True}, {'fileSources': [{'source': 'tunnel', 'path': '../credentials'}]}):
            with self.subTest(config=config), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); install = fixture(root)
                atomic_json(install.state / 'log-collector.json', config)
                before = (install.state / 'log-collector.json').read_bytes()
                with patch.object(install, 'identity', return_value={}), self.assertRaises(Blocked): lifecycle.prepare(install)
                self.assertEqual(before, (install.state / 'log-collector.json').read_bytes())
                self.assertFalse((install.state / 'diagnostics').exists())

    def test_stale_or_future_or_foreign_process_never_counts_as_running(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            store = install.state / 'diagnostics/store'; store.mkdir(parents=True)
            identity = process_identity(root, install.project)
            for change in ({}, {'root': 'foreign'}, {'project': 'foreign'}, {'pid': -1}, {'nonce': 'not-a-nonce'}, {'checkedAt': '2099-01-01T00:00:00Z'}, {'checkedAt': '2000-01-01T00:00:00Z'}):
                value = {**identity, 'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(), **change}
                atomic_json(store / 'collector-process.json', value)
                result = lifecycle.status(install)
                self.assertEqual(result['state'] == 'running', not bool(change))

    def test_restart_requires_new_nonce_and_failed_start_only_degrades_collector(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            (install.state / 'diagnostics/store').mkdir(parents=True)
            (install.state / 'diagnostics/private').mkdir()
            identity = process_identity(root, install.project); write_process_health(root, identity)
            runner = {'root': str(root), 'project': install.project, 'scriptDigest': lifecycle.digest(root), 'mode': 'windows-task'}
            with patch.object(install, 'identity'), patch('deployment.collector.finalize_permissions'), patch('deployment.collector.reader_probe'), patch('deployment.collector.runner_identity', return_value=runner), patch('deployment.collector.reconcile_runner', return_value='owned runner') as start:
                failed = lifecycle.reconcile(install, wait_seconds=0)
                self.assertEqual(failed['state'], 'degraded'); self.assertEqual(failed['code'], 'COLLECTOR_START')
                def restarted(*args):
                    write_process_health(root, process_identity(root, install.project)); return 'owned runner'
                start.side_effect = restarted
                succeeded = lifecycle.reconcile(install, wait_seconds=0)
                self.assertEqual(succeeded['state'], 'running')
                self.assertNotEqual(succeeded['process']['nonce'], identity['nonce'])
                self.assertFalse((install.state / 'failed-switch.json').exists())

    def test_windows_rejects_foreign_action_privilege_interpreter_and_extra_action(self):
        identity = {'root': str(Path(tempfile.gettempdir()) / 'asa-owned'), 'owner': 'machine\\operator'}
        xml = lifecycle.windows_xml(identity, sys.executable)
        lifecycle.verify_windows_task(xml, identity)
        sid_identity = {**identity, 'ownerSid': 'S-1-5-21-1234'}
        short_name = xml.replace('machine\\operator', 'operator')
        lifecycle.verify_windows_task(short_name, sid_identity, 'S-1-5-21-1234')
        with self.assertRaises(Blocked): lifecycle.verify_windows_task(short_name, sid_identity, 'S-1-5-21-foreign')
        variants = [xml.replace('LeastPrivilege', 'HighestAvailable'), xml.replace('--root', '--foreign-root'),
                    xml.replace(str(sys.executable), str(Path(tempfile.gettempdir()) / 'foreign-python.exe')),
                    xml.replace('</Exec>', '</Exec><ComHandler><ClassId>foreign</ClassId></ComHandler>'),
                    xml.replace('machine\\operator', 'machine\\other'), xml.replace('<UserId>machine\\operator</UserId>', '<UserId></UserId>')]
        for changed in variants:
            with self.subTest(changed=changed[-200:]), self.assertRaises(Blocked): lifecycle.verify_windows_task(changed, identity)

    def test_systemd_rejects_comments_duplicates_extra_commands_and_root_user(self):
        identity = {'root': '/srv/asa', 'owner': 'operator', 'mode': 'system'}
        script = Path(identity['root']) / 'tools' / 'collect_logs.py'
        unit = f'[Unit]\nDescription=ASA\n[Service]\nUser=operator\nWorkingDirectory="/srv/asa"\nExecStart="/usr/bin/python3" "{script}" --root "/srv/asa"\nNoNewPrivileges=true\n[Install]\nWantedBy=multi-user.target\n'
        lifecycle.verify_systemd_unit(unit, identity, '/usr/bin/python3')
        for text in (unit.replace('ExecStart=', '#ExecStart='), unit.replace('User=operator', 'User=root'),
                     unit.replace('[Install]', 'ExecStartPre=/bin/foreign\n[Install]'), unit.replace('User=operator', 'User=operator\nUser=other')):
            with self.assertRaises(Blocked): lifecycle.verify_systemd_unit(text, identity, '/usr/bin/python3')

    def test_root_cannot_silently_maintain_owner_user_service(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            atomic_json(install.state / 'collector-runner.json', {'root': str(root), 'project': install.project, 'owner': 'operator', 'mode': 'user'})
            operator = SimpleNamespace(pw_uid=1234, pw_gid=1234, pw_name='operator')
            with patch('deployment.collector.WINDOWS', False), patch('deployment.collector.linux_operator', return_value=operator), patch('deployment.collector.os.geteuid', return_value=0, create=True), self.assertRaises(Blocked) as error:
                lifecycle.runner_identity(install)
            self.assertEqual(error.exception.code, 'COLLECTOR_RUNNER_OWNER')

    def test_persisted_but_unapplied_group_still_requires_application_switch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            with (root / '.env').open('a') as stream: stream.write('ASA_LOG_READER_GID=1234\n')
            install = Installation(root, 'dev')
            operator = SimpleNamespace(pw_uid=1234, pw_gid=1234, pw_name='operator')
            with patch('deployment.collector.WINDOWS', False), patch('deployment.collector.linux_operator', return_value=operator), patch('deployment.collector.os.geteuid', return_value=0, create=True), patch('deployment.collector.os.chown', create=True), patch('deployment.collector.os.chmod'), patch.object(install, 'identity', return_value={'api': {'id': 'owned-api'}}), patch('deployment.collector.command', return_value=('1000', 0)):
                self.assertTrue(lifecycle.prepare(install)['readerGroupChanged'])
            self.assertEqual((root / '.env').read_text().count('ASA_LOG_READER_GID='), 1)

    def test_prepare_does_not_change_existing_reader_access_before_application_switch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            store = install.state/'diagnostics/store'; private = install.state/'diagnostics/private'
            store.mkdir(parents=True); private.mkdir()
            segment = store/'seg-0000000000000001-0000000000000001.jsonl'; segment.write_bytes(b'history')
            before = segment.read_bytes(), segment.stat().st_gid, store.stat().st_gid
            operator = SimpleNamespace(pw_uid=1234, pw_gid=1234, pw_name='operator')
            with patch('deployment.collector.WINDOWS', False), patch('deployment.collector.linux_operator', return_value=operator), patch('deployment.collector.os.geteuid', return_value=0, create=True), patch('deployment.collector.os.chown', create=True) as chown, patch('deployment.collector.os.chmod') as chmod, patch.object(install, 'identity', return_value={'api': {'id': 'owned-api'}}), patch('deployment.collector.command', return_value=('1000', 0)):
                self.assertTrue(lifecycle.prepare(install)['readerGroupChanged'])
                self.assertFalse(any(call.args[0] in (store, segment, private) for call in chown.call_args_list))
                self.assertFalse(any(call.args[0] in (store, segment, private) for call in chmod.call_args_list))
            self.assertEqual(before, (segment.read_bytes(), segment.stat().st_gid, store.stat().st_gid))

    def test_docker_group_config_is_rejected_instead_of_used_as_reader_group(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            with (root / '.env').open('a') as stream: stream.write('ASA_LOG_READER_GID=999\n')
            install = Installation(root, 'dev')
            operator = SimpleNamespace(pw_uid=1234, pw_gid=1234, pw_name='operator')
            with patch('deployment.collector.WINDOWS', False), patch('deployment.collector.linux_operator', return_value=operator), patch.object(install, 'identity', return_value={}), self.assertRaises(Blocked) as error:
                lifecycle.prepare(install)
            self.assertEqual(error.exception.code, 'COLLECTOR_READER_GROUP')

    def test_cycle_health_excludes_not_applicable_but_preserves_denied_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sources = [{'state': 'ok'}, {'state': 'unavailable', 'applicable': False}]
            write_collector_health(root, 'ok', sources=sources)
            file = root / '.asa/diagnostics/store/collector-health.json'
            self.assertTrue(json.loads(file.read_text())['coverageComplete'])
            write_collector_health(root, 'ok', sources=[*sources, {'state': 'unavailable', 'applicable': True}])
            value = json.loads(file.read_text()); self.assertFalse(value['coverageComplete']); self.assertEqual(value['excludedNotApplicable'], 1)

    @unittest.skipUnless(os.name != 'nt', 'Symlink creation requires separate Windows privilege')
    def test_symlink_rejection_never_writes_health_into_foreign_directory(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as foreign:
            root = Path(directory); install = fixture(root)
            (install.state / 'diagnostics').mkdir(parents=True)
            (install.state / 'diagnostics/store').symlink_to(foreign, target_is_directory=True)
            with patch.object(install, 'identity'), self.assertRaises(Blocked): lifecycle.prepare(install)
            with self.assertRaises(ValueError): write_collector_health(root, 'error')
            self.assertEqual(list(Path(foreign).iterdir()), [])


if __name__ == '__main__': unittest.main()
