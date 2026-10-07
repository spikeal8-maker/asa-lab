import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from collect_logs import Collector, normalize, now


class CollectorTests(unittest.TestCase):
    @unittest.skipUnless(os.name == 'nt', 'Windows Event Log adapter is host-specific')
    def test_windows_paging_and_channel_recovery(self):
        with tempfile.TemporaryDirectory() as temp:
            subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(Path(__file__).with_name('test-windows-log-cursors.ps1')), '-TempRoot', temp], check=True, timeout=30)
    def test_secret_cleanup_covers_headers_json_queries_and_metadata(self):
        for raw in ['token=top-secret', 'Cookie: a=first-secret; b=second-secret', 'https://test.invalid/?token=query-secret&x=1', '{"token":"json-secret","requestId":"id-secret","revision":"rev-secret"}', 'postgres://user:db-secret@test.invalid/db']:
            entry = normalize('api', raw, now(), raw)
            text = json.dumps(entry)
            for secret in ['top-secret', 'first-secret', 'second-secret', 'query-secret', 'json-secret', 'id-secret', 'rev-secret', 'db-secret']:
                self.assertNotIn(secret, text)

    def test_equal_lines_are_distinct_occurrences_and_rescan_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'source'; source.mkdir()
            file = source / 'test.log'
            file.write_text('ERROR repeated\nERROR repeated\n', encoding='utf8')
            collector = Collector(root, {'includeDockerDesktop': False, 'fileSources': [{'source': 'test', 'path': str(source)}]})
            collector.files(); collector.db.commit()
            self.assertEqual(collector.db.execute('SELECT count(*) FROM events').fetchone()[0], 2)
            collector.files(); collector.db.commit()
            self.assertEqual(collector.db.execute('SELECT count(*) FROM events').fetchone()[0], 2)
            with file.open('a') as stream: stream.write('ERROR repeated\n')
            collector.files(); collector.db.commit()
            self.assertEqual(collector.db.execute('SELECT count(*) FROM events').fetchone()[0], 3)
            collector.db.close()

    def test_unicode_segments_stay_bounded_and_restart_publishes_existing_data(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); collector = Collector(root, {})
            for i in range(140): collector.add(normalize('scratch', '🔥' * 16384, now(), str(i)))
            collector.publish()
            catalog = json.loads((collector.store / 'catalog.json').read_text())
            self.assertEqual(sum(s['count'] for s in catalog['segments']), 140)
            self.assertTrue(all(s['bytes'] <= 1024 * 1024 for s in catalog['segments']))
            collector.db.close()
            resumed = Collector(root, {}); resumed.publish()
            self.assertEqual(sum(s['count'] for s in json.loads((resumed.store/'catalog.json').read_text())['segments']), 140)
            resumed.db.close()

    def test_budget_eviction_deletes_exact_private_rows(self):
        with tempfile.TemporaryDirectory() as temp:
            collector = Collector(Path(temp), {'maxBytes': 3 * 1024 * 1024})
            for i in range(160): collector.add(normalize('api', '🔥' * 10000, now(), str(i)))
            collector.publish()
            catalog = json.loads((collector.store/'catalog.json').read_text())
            self.assertTrue(catalog['trimmed'])
            retained = sum(s['count'] for s in catalog['segments'])
            self.assertEqual(collector.db.execute('SELECT count(*) FROM events').fetchone()[0], retained)
            self.assertLessEqual(catalog['storageBytes'], 3 * 1024 * 1024)
            collector.db.close()


if __name__ == '__main__': unittest.main()
