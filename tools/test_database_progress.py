"""OBS017 bounded progress. Actual SQL runs only in the isolated CI service."""
import csv
import gzip
import io
import json
import os
import subprocess
import types
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import collect_logs
from collect_logs import Collector, DATABASE_DIAGNOSTICS, normalize, write_collector_health


def response(rows, more=False):
    stream = io.StringIO()
    writer = csv.writer(stream)
    for row in rows: writer.writerow([json.dumps(row), '{}'])
    writer.writerow(['null', json.dumps({'count': len(rows), 'more': more})])
    return stream.getvalue().encode()


class DatabaseProgressUnitTests(unittest.TestCase):
    def test_recent_overflow_is_bounded_before_command(self):
        with tempfile.TemporaryDirectory() as temp:
            c = Collector(Path(temp), {}); c.postgres = 'synthetic'
            stamp = (datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat()
            def command(args, **kwargs):
                sql = kwargs['sql']
                if 'LIMIT ' not in sql:
                    raise RuntimeError('synthetic bounded output overflow: full recent window')
                return response([{'id': 'one', 'created_at': stamp}]) if '"audit_events"' in sql else response([])
            c.command = command
            c.database()
            sources = [json.loads(r[0]) for r in c.db.execute('SELECT payload FROM sources')]
            count = c.db.execute('SELECT count(*) FROM events').fetchone()[0]
            c.db.close()
            self.assertFalse([s for s in sources if s['state'] == 'error'], sources)
            self.assertEqual(count, 1)

    def test_same_time_pages_failure_restart_retry_mutation_and_quality(self):
        table = 'audit_events'
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); c = Collector(root, {}); c.postgres = 'synthetic'
            stamp = (datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat()
            rows = [{'id': str(n), 'created_at': stamp, 'action': 'account.registered'} for n in range(5)]
            queries = []
            def batch(table, condition, after=None):
                queries.append((condition, after))
                values = [r for r in rows if after is None or r['id'] > after[1]][:2]
                return [(r, {}) for r in values], bool(values and values[-1]['id'] != '4'), [stamp, values[-1]['id']] if values else after
            with patch.dict(collect_logs.DATABASE_DIAGNOSTICS, sources={table: DATABASE_DIAGNOSTICS['sources'][table]}):
                c.database_batch = batch
                c.set_state('db:history:' + table + ':completed', collect_logs.time.time())
                c.set_state('db:' + table, (datetime.now(timezone.utc)-timedelta(minutes=5)).isoformat())
                c.database(); c.publish()
                window = c.state('db:' + table + ':window')
                self.assertEqual(window['after'], [stamp, '1'])
                source = json.loads(c.db.execute('SELECT payload FROM sources WHERE name=?', ('database-events:' + table,)).fetchone()[0])
                self.assertEqual(source['state'], 'pending'); self.assertIsNone(source['collectedThrough'])
                health_sources = [json.loads(r[0]) for r in c.db.execute('SELECT payload FROM sources')]
                write_collector_health(root, 'ok', sources=health_sources)
                self.assertFalse(json.loads((c.store/'collector-health.json').read_text())['coverageComplete'])
                # Failure after one insert rolls back every row and its compatibility hash.
                add = c.add_database_row
                def failing_add(table, value, defaults, at):
                    add(table, value, defaults, at)
                    if value['id'] == '3': raise OSError('synthetic write interruption')
                c.add_database_row = failing_add; c.set_state('database:last', 0)
                c.database(); c.publish()
                self.assertEqual(c.state('db:' + table + ':window'), window)
                self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0], 2)
                self.assertEqual(c.db.execute('SELECT count(*) FROM database_observations').fetchone()[0], 2)
                c.db.close()
                c = Collector(root, {}); c.postgres = 'synthetic'; c.database_batch = batch
                for _ in range(2): c.set_state('database:last', 0); c.database(); c.publish()
                self.assertIsNone(c.state('db:' + table + ':window'))
                self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0], 5)
                self.assertEqual(queries[0][0], queries[1][0]); self.assertEqual(queries[1], queries[2])
                # A new bounded cycle still rereads the recent range at old timestamps.
                rows[0] = {**rows[0], 'action': 'workspace.switched'}
                for _ in range(3): c.set_state('database:last', 0); c.database(); c.publish()
                self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0], 6)
                c.db.close()

    def test_truncated_malformed_oversized_and_empty_continuation_retain_cursor(self):
        table = 'audit_events'
        with tempfile.TemporaryDirectory() as temp:
            c = Collector(Path(temp), {}); c.postgres = 'synthetic'
            try:
                stamp = (datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat()
                row = {'id': 'a', 'created_at': stamp}
                good = response([row])
                invalid = [b'', good.splitlines(keepends=True)[0], response([], True),
                           good.replace(b'""count"": 1', b'""count"": 2'), b'x'*(collect_logs.DATABASE_BATCH_BYTES+1),
                           b'"unterminated']
                with patch.dict(collect_logs.DATABASE_DIAGNOSTICS, sources={table: DATABASE_DIAGNOSTICS['sources'][table]}):
                    for data in invalid:
                        c.command = lambda *a, **k: data
                        c.set_state('database:last', 0); c.database()
                        self.assertIsNone(c.state('db:' + table))
                        self.assertIsNone(c.state('db:' + table + ':window')['after'])
                        self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0], 0)
                        self.assertEqual(json.loads(c.db.execute('SELECT payload FROM sources WHERE name="database-events"').fetchone()[0])['state'], 'error')
                c.command = lambda *a, **k: good
                with patch('collect_logs.DATABASE_BATCH_ROWS', 1):
                    values, more, after = c.database_batch(table, 'TRUE', [stamp, "private'key"])
                self.assertEqual(after, [stamp, 'a']); self.assertFalse(more); self.assertEqual(len(values), 1)
            finally: c.db.close()


@unittest.skipUnless(os.environ.get('ASA_OBS_DATABASE_TEST') == '1',
                     'actual PostgreSQL: opt in only in isolated GitHub CI')
class ActualDatabaseProgressTests(unittest.TestCase):
    def test_actual_sql_before_and_after_ties_timeout_restart_bytes_history_and_mutation(self):
        self.assertEqual(os.environ.get('GITHUB_ACTIONS'), 'true')
        container = os.environ['ASA_OBS_TEST_CONTAINER']
        self.assertRegex(container, r'^[a-f0-9]{12,64}$')
        inspection = json.loads(subprocess.run(['docker', 'inspect', container], capture_output=True, check=True).stdout)[0]
        for item in ('POSTGRES_DB=observability_identity_test', 'POSTGRES_USER=obs_ci', 'POSTGRES_PASSWORD=synthetic_ci_only'):
            self.assertIn(item, inspection['Config']['Env'])
        self.assertFalse((inspection['Config'].get('Labels') or {}).get('com.docker.compose.project'))
        def sql(statement):
            return subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-q', '-tA',
                '-v', 'ON_ERROR_STOP=1', '-U', 'obs_ci', '-d', 'observability_identity_test'],
                input=statement.encode(), capture_output=True, check=True).stdout
        self.assertEqual(sql('SELECT current_database();').strip(), b'observability_identity_test')
        recent = datetime.now(timezone.utc)-timedelta(minutes=1)
        historical = recent-timedelta(days=2)
        expected = set()
        for table, rule in DATABASE_DIAGNOSTICS['sources'].items():
            key = 'event_hash' if table == 'max_webhook_events' else 'id'
            column = rule['timeColumn']; kind = 'bigint' if column.endswith('_ms') else 'timestamptz'
            pk_kind = 'uuid' if table == 'classroom_activity_events' else 'text' if key == 'event_hash' else 'bigint'
            sql(f'DROP TABLE IF EXISTS public."{table}"; CREATE TABLE public."{table}" ("{key}" {pk_kind} PRIMARY KEY, "{column}" {kind} NOT NULL, occurrence_count integer DEFAULT 1, private_content text);')
            for n in range(9):
                stamp = historical if n < 2 else recent
                native = f'00000000-0000-0000-0000-{n:012d}' if pk_kind == 'uuid' else f"PRIVATE''KEY_{n}" if pk_kind == 'text' else str(n)
                at = str(int(stamp.timestamp()*1000)) if kind == 'bigint' else "'"+stamp.isoformat()+"'"
                sql(f'INSERT INTO public."{table}" VALUES (\'{native}\', {at}, 1, \'PRIVATE_{"x"*400}\');')
        # Run the real pre-fix SQL at a scaled command byte boundary, using the
        # immutable selected baseline. This fixture stays small (81 rows total).
        baseline = types.ModuleType('obs017_before'); baseline.__file__ = collect_logs.__file__
        before_source = subprocess.run(['git', 'show', '0724a63a2f6752b4be769e0064ab60a1345e35f6:tools/collect_logs.py'],
            capture_output=True, check=True).stdout
        exec(compile(before_source, baseline.__file__, 'exec'), baseline.__dict__)
        with tempfile.TemporaryDirectory() as temp:
            old = baseline.Collector(Path(temp), {}); old.postgres = container
            execute = old.command; before_bytes = []
            def scaled_before(args, **kwargs):
                data = execute(args, **kwargs)
                before_bytes.append({'lane': 'fresh' if ' OR ' in kwargs['sql'] else 'history', 'bytes': len(data)})
                if len(data) > 4096: raise RuntimeError('scaled 4096-byte command overflow; cursor not advanced')
                return data
            old.command = scaled_before
            with patch.dict(baseline.DATABASE_DIAGNOSTICS, sources={'audit_events': DATABASE_DIAGNOSTICS['sources']['audit_events']}):
                for _ in range(2): old.set_state('database:last', 0); old.database()
            self.assertIsNone(old.state('db:audit_events'))
            self.assertEqual(old.db.execute('SELECT count(*) FROM events').fetchone()[0], 0)
            fresh_bytes = [sample['bytes'] for sample in before_bytes if sample['lane'] == 'fresh']
            self.assertEqual(len(fresh_bytes), 2)
            self.assertTrue(all(size > 4096 for size in fresh_bytes), before_bytes)
            print('OBS017_ACTUAL_BEFORE ' + json.dumps({'baseline': '0724a63', 'scaledCommandBound': 4096,
                'actualSqlResponseBytes': before_bytes, 'cursorAdvanced': False, 'saved': 0}), flush=True)
            old.db.close()
        with tempfile.TemporaryDirectory() as temp, patch('collect_logs.DATABASE_BATCH_ROWS', 2), patch('collect_logs.DATABASE_BATCH_BYTES', 4096):
            root = Path(temp); c = Collector(root, {}); c.postgres = container; c.reader_format = 2
            original_command = c.command; page_bytes = []; aborted = False
            def execute(args, **kwargs):
                nonlocal aborted
                query = kwargs['sql']
                if not aborted and '"audit_events"' in query and ' OR ' in query and ') > (' in query:
                    aborted = True
                    kwargs['sql'] = query.replace("SET LOCAL statement_timeout='15s';", "SET LOCAL statement_timeout='1ms'; SELECT pg_sleep(0.02);")
                data = original_command(args, **kwargs); page_bytes.append(len(data)); return data
            c.command = execute
            c.database(); c.publish()
            first_window = c.state('db:audit_events:window')
            self.assertIsNotNone(first_window['after'])
            original_segments = {p.name: p.read_bytes() for p in c.store.glob('seg-*')}
            c.set_state('database:last', 0); c.database(); c.publish()
            self.assertTrue(aborted); self.assertEqual(c.state('db:audit_events:window'), first_window)
            self.assertEqual(json.loads(c.db.execute('SELECT payload FROM sources WHERE name="database-events:audit_events"').fetchone()[0])['state'], 'error')
            c.db.close()
            c = Collector(root, {}); c.postgres = container; c.reader_format = 2
            original_command = c.command; c.command = execute
            for _ in range(8): c.set_state('database:last', 0); c.database(); c.publish()
            # Compare actual saved identities against every source row independently.
            for table in DATABASE_DIAGNOSTICS['sources']:
                values = json.loads(sql(f'SELECT json_agg(t) FROM public."{table}" t;'))
                for value in values:
                    raw = json.dumps(value, ensure_ascii=False, sort_keys=True)
                    event = normalize('auth' if table == 'product_analytics_events' else 'audit', raw,
                        recent.isoformat(), table+':'+raw, table)
                    expected.add(bytes.fromhex(event['id']))
            actual = {r[0] for r in c.db.execute('SELECT id FROM events')}
            self.assertEqual(actual, expected); self.assertEqual(len(actual), 81)
            for table in DATABASE_DIAGNOSTICS['sources']:
                self.assertIsNotNone(c.state('db:history:'+table+':completed'))
            # Same timestamp mutable observation must appear during a later recent cycle.
            sql('UPDATE public.classroom_activity_events SET occurrence_count=2 WHERE id=\'00000000-0000-0000-0000-000000000002\';')
            for _ in range(8): c.set_state('database:last', 0); c.database(); c.publish()
            self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0], 82)
            for name, data in original_segments.items(): self.assertEqual((c.store/name).read_bytes(), data)
            self.assertLessEqual(max(page_bytes), 4096)
            public = (c.store/'catalog.json').read_text()
            for path in c.store.glob('seg-*'): public += gzip.decompress(path.read_bytes()).decode()
            self.assertNotIn('PRIVATE', public)
            print('OBS017_ACTUAL_AFTER ' + json.dumps({'savedDistinctIds': len(actual), 'mutableObservationCount': 82,
                'maxPageBytes': max(page_bytes), 'scaledRowBound': 2, 'scaledByteBound': 4096,
                'actualTimeoutRetry': 'PASS', 'restart': 'PASS', 'sameTimeTies': 'PASS',
                'history': 'PASS', 'immutableSegments': 'PASS', 'privacy': 'PASS'}), flush=True)
            c.db.close()
