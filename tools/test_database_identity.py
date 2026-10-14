"""DB identity regression. Actual PostgreSQL is opt-in and CI-only.

Canonical command: python -B tools/test_collect_logs.py
The CI service is selected explicitly, never by discovering a local installation.
"""
import gzip
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from collect_logs import Collector, DATABASE_DIAGNOSTICS


def legacy_identity(table, value):
    return table + ':' + json.dumps(value, ensure_ascii=False, sort_keys=True)


@unittest.skipUnless(os.environ.get('ASA_OBS_DATABASE_TEST') == '1',
                     'actual PostgreSQL: opt in only in isolated GitHub CI')
class ActualDatabaseIdentityTests(unittest.TestCase):
    def test_schema_extension_preserves_legacy_history_and_mutable_observations(self):
        self.assertEqual(os.environ.get('GITHUB_ACTIONS'), 'true')
        container = os.environ['ASA_OBS_TEST_CONTAINER']
        self.assertRegex(container, r'^[a-f0-9]{12,64}$')
        # Reject production-like targets before executing any test SQL.
        def sql(statement):
            return subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-q',
                '-v', 'ON_ERROR_STOP=1', '-U', 'obs_ci', '-d', 'observability_identity_test',
                '-tA'], input=statement.encode(), capture_output=True, check=True).stdout
        self.assertEqual(sql('SELECT current_database();').strip(), b'observability_identity_test')
        inspection = json.loads(subprocess.run(['docker', 'inspect', container],
            capture_output=True, check=True).stdout)[0]
        env = inspection['Config']['Env']
        self.assertIn('POSTGRES_DB=observability_identity_test', env)
        self.assertIn('POSTGRES_USER=obs_ci', env)
        self.assertIn('POSTGRES_PASSWORD=synthetic_ci_only', env)
        self.assertFalse((inspection['Config'].get('Labels') or {}).get('com.docker.compose.project'))
        recent = datetime.now(timezone.utc) - timedelta(minutes=1)
        historical = recent - timedelta(days=2)
        for table, rule in DATABASE_DIAGNOSTICS['sources'].items():
            key = 'event_hash' if table == 'max_webhook_events' else 'id'
            column = rule['timeColumn']
            kind = 'bigint' if column.endswith('_ms') else 'timestamptz'
            sql(f'CREATE TABLE public."{table}" ("{key}" text PRIMARY KEY, '
                f'"{column}" {kind} NOT NULL, occurrence_count integer NOT NULL DEFAULT 1, '
                'private_content text NOT NULL);')
            for n, stamp in enumerate((recent, recent, historical)):
                at = str(int(stamp.timestamp()*1000)) if kind == 'bigint' else "'" + stamp.isoformat() + "'"
                sql(f'INSERT INTO public."{table}" VALUES (\'PRIVATE_NATIVE_{n}\', {at}, 1, \'PRIVATE_CONTENT_{n}\');')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            c = Collector(root, {}); c.postgres = container; c.reader_format = 2
            # Seed precisely the existing whole-row identity via real collection SQL.
            if hasattr(c, 'database_identity'):
                c.database_identity = legacy_identity
            c.database(); c.publish()
            before = sorted(row[0].hex() for row in c.db.execute('SELECT id FROM events'))
            self.assertEqual(len(before), 27)
            old_segments = {p.name: p.read_bytes() for p in c.store.glob('seg-*')}
            c.db.close()
            for table in DATABASE_DIAGNOSTICS['sources']:
                sql(f'ALTER TABLE public."{table}" ADD COLUMN schema_nullable text, '
                    'ADD COLUMN schema_default integer NOT NULL DEFAULT 7;')
            c = Collector(root, {}); c.postgres = container; c.reader_format = 2
            def collect():
                c.set_state('database:last', 0)
                for table in DATABASE_DIAGNOSTICS['sources']:
                    c.set_state('db:history:' + table + ':completed', 0)
                c.database(); c.publish()
                failures = [json.loads(row[0]) for row in c.db.execute('SELECT payload FROM sources')
                            if json.loads(row[0])['state'] == 'error']
                self.assertEqual(failures, [])
                return sorted(row[0].hex() for row in c.db.execute('SELECT id FROM events'))
            after = collect()
            print('OBS016_ACTUAL_DB ' + json.dumps({'beforeCount': len(before), 'afterSchemaCount': len(after),
                'beforeIds': before, 'afterSchemaIds': after}), flush=True)
            self.assertEqual(after, before, 'schema-only extension duplicated unchanged DB rows')
            self.assertEqual(collect(), before)
            for name, data in old_segments.items(): self.assertEqual((c.store/name).read_bytes(), data)
            # Mutable source: both diagnostic and private-only changes are real observations.
            sql("UPDATE public.classroom_activity_events SET occurrence_count=2 WHERE id='PRIVATE_NATIVE_0';")
            changed = collect(); self.assertEqual(len(changed), 28)
            self.assertEqual(collect(), changed)
            sql("UPDATE public.classroom_activity_events SET private_content='PRIVATE_UPDATED' WHERE id='PRIVATE_NATIVE_0';")
            private_changed = collect(); self.assertEqual(len(private_changed), 29)
            sql("UPDATE public.classroom_activity_events SET schema_default=8 WHERE id='PRIVATE_NATIVE_0';")
            extended_changed = collect(); self.assertEqual(len(extended_changed), 30)
            self.assertEqual(collect(), extended_changed)
            for name, data in old_segments.items(): self.assertEqual((c.store/name).read_bytes(), data)
            public = (c.store/'catalog.json').read_text()
            for path in c.store.glob('seg-*'):
                public += (gzip.decompress(path.read_bytes()) if path.suffix == '.gz' else path.read_bytes()).decode()
            self.assertNotIn('PRIVATE_', public)
            print('OBS016_ACTUAL_DB ' + json.dumps({'repeatCount': len(before),
                'mutableCount': len(changed), 'privateMutableCount': len(private_changed),
                'newColumnMutableCount': len(extended_changed), 'immutableHistory': 'PASS', 'privacy': 'PASS'}), flush=True)
            c.db.close()
