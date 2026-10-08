import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timedelta, timezone
from collect_logs import Collector, normalize, now


class CollectorTests(unittest.TestCase):
    def test_replaced_container_collects_current_errors_without_history_delay(self):
        with tempfile.TemporaryDirectory() as temp:
            collector = Collector(Path(temp), {})
            created = datetime.now(timezone.utc) - timedelta(days=2)
            collector.set_state('docker:new-container:recent', (created - timedelta(days=8)).isoformat())
            calls = []
            def command(args, **kwargs):
                if args[1] == 'ps': return b'new-container\npostgres-container'
                if args[1] == 'inspect':
                    records = [dict(Id=cid, Created=created.isoformat(), Config=dict(Labels={'com.docker.compose.service': service, 'com.docker.compose.project.working_dir': str(collector.root)})) for cid, service in [('new-container', 'api'), ('postgres-container', 'postgres')]]
                    return '\n'.join(json.dumps(c) for c in records).encode()
                calls.append(args)
                return (now() + ' ERROR startup failure\n').encode()
            collector.command = command
            collector.docker()
            api_calls = [c for c in calls if c[-1] == 'new-container']
            self.assertEqual(len(api_calls), 2)
            self.assertGreater(datetime.fromisoformat(api_calls[0][api_calls[0].index('--since') + 1]), datetime.now(timezone.utc) - timedelta(minutes=6))
            self.assertTrue(all(datetime.fromisoformat(c[c.index('--since') + 1]) >= created for c in api_calls))
            self.assertGreater(collector.db.execute("SELECT count(*) FROM events WHERE source='api'").fetchone()[0], 0)
            collector.db.close()
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
