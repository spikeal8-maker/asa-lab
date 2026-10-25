import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import memory_sampling as memory
from collect_logs import normalize, now


class MemorySamplingTests(unittest.TestCase):
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
                sample = memory.capture_memory(proc)
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
            sample = memory.capture_memory()
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
