import json
import os
from pathlib import Path
import tempfile
import subprocess
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import memory_sampling as memory
from collect_logs import normalize, now


class MemorySamplingTests(unittest.TestCase):
    def test_hung_owned_helper_is_killed_and_reaped_without_native_scan(self):
        real_popen = subprocess.Popen
        children = []
        def start_fixture(args, **kwargs):
            self.assertEqual(args[-1], '--capture')
            child = real_popen([memory.sys.executable, '-c', 'import time; time.sleep(60)'], **kwargs)
            children.append(child)
            return child
        started = time.monotonic()
        with patch.object(memory.subprocess, 'Popen', side_effect=start_fixture):
            result = memory.capture_memory(deadline=started + 0.15)
        self.assertEqual(result['processes'], dict(state='unavailable', reason='deadline'))
        self.assertNotIn('leaders', result['processes'])
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].returncode)
        self.assertIsNotNone(children[0].poll())
        self.assertLess(time.monotonic() - started, 3)

    def test_helper_startup_uses_remaining_budget_and_expired_budget_never_spawns(self):
        child = Mock(returncode=0)
        child.communicate.return_value = (b'{"processes":{"state":"available","leaders":[]}}', None)
        with patch.object(memory.subprocess, 'Popen', return_value=child):
            result = memory.capture_memory(deadline=11, clock=Mock(side_effect=[10, 10.4]))
        self.assertEqual(result['processes']['state'], 'available')
        self.assertAlmostEqual(child.communicate.call_args.kwargs['timeout'], 0.6)
        child.kill.assert_not_called()
        with patch.object(memory.subprocess, 'Popen') as spawn:
            self.assertEqual(memory.capture_memory(deadline=10, clock=lambda: 10)['processes']['reason'], 'deadline')
        spawn.assert_not_called()

    def test_deadline_exhausted_by_startup_still_reaps_owned_helper(self):
        child = Mock()
        with patch.object(memory.subprocess, 'Popen', return_value=child):
            result = memory.capture_memory(deadline=11, clock=Mock(side_effect=[10, 12]))
        self.assertEqual(result['processes']['reason'], 'deadline')
        child.kill.assert_called_once_with()
        child.communicate.assert_called_once_with()

    def test_helper_failure_and_invalid_output_are_typed_unavailable(self):
        for code, output in ((1, b''), (0, b'not-json'), (0, b'[]'), (0, b'x' * 8193)):
            child = Mock(returncode=code)
            child.communicate.return_value = output, None
            with patch.object(memory.subprocess, 'Popen', return_value=child):
                self.assertEqual(memory.capture_memory()['processes']['reason'], 'helper_failed')
        with patch.object(memory.subprocess, 'Popen', side_effect=OSError('private-value')):
            self.assertNotIn('private-value', json.dumps(memory.capture_memory()))

    def test_aggregation_ranking_bounds_and_private_unknown(self):
        rows = [('chrome.exe', 100, 50), ('CHROME.EXE', 200, 80), ('other', 1, None)]
        rows += [(f'app{i}', i, i) for i in range(20)]
        result = memory.aggregate(rows, 1, clock=lambda: 0)
        self.assertEqual(len(result['leaders']), 8)
        self.assertEqual(result['leaders'][0], dict(name='chrome.exe', count=2,
            workingSetBytes=300, privateCommitBytes=130))
        unknown = memory.aggregate([('app', 10, None), ('app', 20, 50)], 1, lambda: 0)
        self.assertIsNone(unknown['leaders'][0]['privateCommitBytes'])
        bounded = memory.aggregate(iter([('app', 1, 1)] * 5000), 1, lambda: 0)
        self.assertEqual(bounded['inspectedProcesses'], 4096)
        self.assertEqual(bounded['reason'], 'process_limit')

    def test_deadline_does_not_read_next_process_and_access_denial_is_partial(self):
        def forbidden():
            raise AssertionError('Read after deadline')
            yield
        result = memory.aggregate(forbidden(), 1, lambda: 1)
        self.assertEqual(result['reason'], 'deadline')
        self.assertEqual(result['leaders'], [])
        partial = memory.aggregate([None, ('safe', 10, 2)], 1, lambda: 0)
        self.assertEqual(partial['state'], 'partial')
        self.assertEqual(partial['unavailableProcesses'], 1)

    def test_linux_reads_only_status_and_vmstat_and_preserves_safe_json_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            proc = Path(directory)
            (proc / '123').mkdir()
            (proc / '123/status').write_text('Name:\tchrome\nVmRSS:\t12 kB\nVmData:\t99 kB\n')
            (proc / '123/cmdline').write_text('private-url-secret-argv')
            (proc / '123/environ').write_text('private-env')
            (proc / 'vmstat').write_text('pswpin 12\npswpout 34\n')
            with patch.object(memory, 'os', SimpleNamespace(name='posix', scandir=os.scandir)), patch.object(memory.sys, 'platform', 'linux'):
                sample = memory.capture_native_memory(proc)
            self.assertEqual(sample['processes']['leaders'][0]['workingSetBytes'], 12 * 1024)
            self.assertIsNone(sample['processes']['leaders'][0]['privateCommitBytes'])
            self.assertEqual(sample['paging']['pagesOut'], 34)
            payload = dict(kind='runtime_metrics', host=dict(memoryDiagnostics=sample))
            event = normalize('metrics', json.dumps(payload), now(), 'memory-fixture')
            retained = json.loads(event['message'])
            self.assertEqual(retained, payload)
            self.assertNotIn('private-url-secret-argv', event['message'])
            self.assertNotIn('private-env', event['message'])

    def test_unavailable_and_names_never_become_paths_or_arbitrary_text(self):
        for name in ('C:\\Users\\owner\\app.exe', '/home/owner/app', 'https://private', 'user@example.com', 'x' * 65):
            self.assertEqual(memory.process_name(name), 'other')
        with patch.object(memory, 'os', SimpleNamespace(name='posix')), patch.object(memory.sys, 'platform', 'unknown'):
            sample = memory.capture_native_memory()
        self.assertEqual(sample['processes'], dict(state='unavailable', reason='unsupported'))
        self.assertNotIn('leaders', sample['processes'])

    @unittest.skipUnless(os.name == 'nt', 'Windows native APIs')
    def test_windows_native_capture_has_actual_private_commit_and_pagefile(self):
        sample = memory.capture_memory()
        self.assertIn(sample['processes']['state'], ('available', 'partial'))
        self.assertTrue(sample['processes']['leaders'])
        self.assertTrue(all(type(row['privateCommitBytes']) is int for row in sample['processes']['leaders']))
        self.assertIn(sample['pagefile']['state'], ('available', 'unavailable'))
        if sample['pagefile']['state'] == 'available':
            self.assertGreaterEqual(sample['pagefile']['totalBytes'], sample['pagefile']['usedBytes'])


if __name__ == '__main__':
    unittest.main()
