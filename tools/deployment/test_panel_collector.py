"""The canonical updater never falls back from a selected 1Panel manager."""
import json
from pathlib import Path
import stat
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import collector
from deployment.contracts import Blocked


class PanelCollectorManagerTests(unittest.TestCase):
    def setUp(self):
        self.install = SimpleNamespace(root=Path('/srv/asa-lab'), state=Path('/srv/asa-lab/.asa'),
                    project='asa-lab-school', settings={'collectorMode': 'system-root',
                                                      'collectorManager': collector.PANEL_MANAGER})
        self.identity = {'version': 1, 'root': str(self.install.root), 'project': self.install.project,
                         'mode': 'system-root', 'owner': 'root', 'name': 'asa-log-collector-asa-lab-school.service',
                         'manager': collector.PANEL_MANAGER, 'scriptDigest': 'a' * 64, 'revision': 'b' * 40}
        self.receipt = {'format': 'asa-1panel-collector-result-v1', 'root': str(self.install.root),
                        'project': self.install.project, 'manager': collector.PANEL_MANAGER,
                        'state': 'running', 'processCount': 1, 'restartRequested': True}

    @staticmethod
    def trusted(path):
        return SimpleNamespace(st_uid=0, st_mode=(stat.S_IFREG if path == collector.PANEL_BRIDGE else stat.S_IFDIR) | 0o755,
                               st_size=100, st_nlink=1)

    def invoke(self, receipt=None, returncode=0):
        output = json.dumps(self.receipt if receipt is None else receipt)
        result = subprocess.CompletedProcess([], returncode, stdout=output, stderr='private failure detail')
        with patch.object(collector, 'WINDOWS', False), patch.object(collector.os, 'geteuid', return_value=0, create=True), \
                patch.object(Path, 'lstat', self.trusted), patch.object(collector.subprocess, 'run', return_value=result) as called, \
                patch.object(collector, 'command') as native:
            value = collector.reconcile_runner(self.install, self.identity, True)
            native.assert_not_called()
            return value, called.call_args

    def test_selected_manager_uses_exact_bridge_and_preserves_identity(self):
        original = dict(self.identity)
        detail, call = self.invoke()
        self.assertIn('1Panel', detail)
        self.assertEqual(self.identity, original)
        self.assertEqual(call.args[0], [str(collector.PANEL_BRIDGE), 'reconcile', '--apply', '--root',
                                      str(self.install.root), '--project', 'asa-lab-school', '--restart'])
        self.assertEqual(call.kwargs['stdin'], subprocess.DEVNULL)
        self.assertNotIn('PANEL_ACCESS_TOKEN', call.kwargs['env'])

    def test_bridge_failure_never_calls_native_systemd(self):
        for receipt, code in ((self.receipt, 2), ({**self.receipt, 'root': '/srv/other'}, 0),
                              ({**self.receipt, 'processCount': 2}, 0), ({**self.receipt, 'processCount': True}, 0),
                              ({**self.receipt, 'restartRequested': False}, 0)):
            with self.subTest(receipt=receipt, code=code), self.assertRaises(Blocked) as caught:
                self.invoke(receipt, code)
            self.assertEqual(caught.exception.code, 'COLLECTOR_MANAGER_BRIDGE')

    def test_missing_bridge_is_explicit_failure_not_fallback(self):
        with patch.object(collector, 'WINDOWS', False), patch.object(collector.os, 'geteuid', return_value=0, create=True), \
                patch.object(Path, 'lstat', side_effect=FileNotFoundError), \
                patch.object(collector, 'command') as native, self.assertRaises(Blocked) as caught:
            collector.reconcile_runner(self.install, self.identity, False)
        self.assertEqual(caught.exception.code, 'COLLECTOR_MANAGER_BRIDGE')
        native.assert_not_called()

    def test_untrusted_bridge_parent_prevents_execution(self):
        def untrusted(path):
            value = self.trusted(path)
            if path == Path('/usr/local'):
                value.st_mode |= 0o002
            return value
        with patch.object(collector, 'WINDOWS', False), patch.object(collector.os, 'geteuid', return_value=0, create=True), \
                patch.object(Path, 'lstat', untrusted), patch.object(collector.subprocess, 'run') as execute, \
                self.assertRaises(Blocked):
            collector.reconcile_runner(self.install, self.identity, False)
        execute.assert_not_called()

    def test_unknown_manager_cannot_reach_native_runner(self):
        with patch.object(collector, 'command') as native, self.assertRaises(Blocked):
            collector.reconcile_runner(self.install, {**self.identity, 'manager': 'unknown'}, False)
        native.assert_not_called()

    def test_registration_retains_mode_owner_name_and_manager(self):
        with patch.object(collector, 'read_json', return_value=self.identity), \
                patch.object(collector, 'WINDOWS', False), patch.object(collector.os, 'geteuid', return_value=0, create=True), \
                patch.object(collector, 'linux_operator', return_value=SimpleNamespace(pw_name='root', pw_uid=0)), \
                patch.object(collector, 'digest', return_value='a' * 64), \
                patch.object(collector, 'source_revision', return_value='b' * 40):
            self.assertEqual(collector.runner_identity(self.install), self.identity)

    def test_one_sided_selection_blocks_instead_of_recreating_native_service(self):
        variants = [({**self.identity, 'manager': None}, self.install.settings),
                    (self.identity, {'collectorMode': 'system-root'})]
        for registered, settings in variants:
            self.install.settings = settings
            with self.subTest(settings=settings), patch.object(collector, 'read_json', return_value=registered), \
                    patch.object(collector, 'command') as native, self.assertRaises(Blocked):
                collector.runner_identity(self.install)
            native.assert_not_called()

    def test_status_rejects_matching_unknown_manager_in_both_metadata_files(self):
        self.install.settings['collectorManager'] = 'unknown'
        identity = {**self.identity, 'manager': 'unknown'}
        with patch.object(collector, 'safe_paths'), patch.object(collector, 'plain_paths'), \
                patch.object(collector, 'validate_config'), \
                patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=stat.S_IFREG | 0o600)), \
                patch.object(collector, 'read_json', side_effect=[identity, {}, {}]):
            result = collector.status(self.install)
        self.assertEqual(result['state'], 'unavailable')
        self.assertEqual(result['code'], 'COLLECTOR_STATUS_CONFIG')

    def test_native_host_source_is_allowed_without_general_namespace_bypass(self):
        configuration = {'fileSources': [{'source': 'linux:1panel-supervisor', 'path': str(Path('/opt/1panel/tools/supervisord/log').absolute())}]}
        with patch.object(collector, 'WINDOWS', False), patch.object(collector, 'read_json', return_value=configuration):
            self.assertEqual(collector.validate_config(self.install), configuration)
        for source in ('linux:foreign', 'windows:1panel-supervisor', 'linux:1panel-supervisor:other', 'linux:1panel-supervisor\n'):
            configuration['fileSources'][0]['source'] = source
            with self.subTest(source=source), patch.object(collector, 'WINDOWS', False), \
                    patch.object(collector, 'read_json', return_value=configuration), self.assertRaises(Blocked):
                collector.validate_config(self.install)


if __name__ == '__main__':
    unittest.main()
