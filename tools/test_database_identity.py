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

from collect_logs import Collector, DATABASE_DIAGNOSTICS, normalize


def legacy_identity(table, value):
    return table + ':' + json.dumps(value, ensure_ascii=False, sort_keys=True)


class DatabaseIdentityUnitTests(unittest.TestCase):
    def row(self, **changes):
        return {'id': 'PRIVATE_NATIVE_KEY', 'occurred_at': datetime.now(timezone.utc).isoformat(),
                'occurrence_count': 1, 'private_content': 'PRIVATE_CONTENT', **changes}

    def test_fresh_schema_extension_repeat_and_private_mutation(self):
        with tempfile.TemporaryDirectory() as temp:
            c = Collector(Path(temp), {})
            row = self.row(); at = row['occurred_at']
            c.add_database_row('classroom_activity_events', row, {}, at)
            first = c.db.execute('SELECT id FROM events').fetchone()[0]
            extended = {**row, 'new_nullable': None, 'new_default': 7}
            defaults = {'new_nullable': None, 'new_default': 7}
            for _ in range(2): c.add_database_row('classroom_activity_events', extended, defaults, at)
            self.assertEqual(c.db.execute('SELECT id FROM events').fetchall(), [(first,)])
            for changes in ({'occurrence_count': 2}, {'private_content': 'PRIVATE_CHANGED'},
                            {'new_default': 8}):
                value = {**extended, **changes}
                c.add_database_row('classroom_activity_events', value, defaults, at)
                c.add_database_row('classroom_activity_events', value, defaults, at)
            self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0], 4)
            # The native key distinguishes equal public diagnostics.
            c.add_database_row('classroom_activity_events', {**extended, 'id': 'PRIVATE_OTHER'}, defaults, at)
            self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0], 5)
            encoded = json.dumps(c.db.execute('SELECT fields FROM database_observations').fetchall())
            self.assertNotIn('PRIVATE_', encoded); self.assertNotIn('private_content', encoded)
            for native, in c.db.execute('SELECT native_key FROM database_observations'):
                self.assertEqual(len(native), 32)
            c.db.close()

    def test_legacy_exact_hash_compatibility_never_rewrites_immutable_segments(self):
        for compressed in (False, True):
            with self.subTest(compressed=compressed), tempfile.TemporaryDirectory() as temp:
                root = Path(temp); c = Collector(root, {}); c.reader_format = 2 if compressed else 1
                row = self.row(); at = row['occurred_at']
                raw = json.dumps(row, ensure_ascii=False, sort_keys=True)
                old = normalize('audit', raw, at, legacy_identity('classroom_activity_events', row), 'classroom_activity_events')
                c.add(old); c.publish()
                files = {p.name: p.read_bytes() for p in c.store.glob('seg-*')}
                c.db.execute('DROP TABLE database_observations'); c.db.commit(); c.db.close()
                c = Collector(root, {}); c.reader_format = 2 if compressed else 1
                extended = {**row, 'nullable': None, 'defaulted': 7}
                c.add_database_row('classroom_activity_events', extended, {'nullable': None, 'defaulted': 7}, at)
                c.publish()
                self.assertEqual(c.db.execute('SELECT id FROM events').fetchall(), [(bytes.fromhex(old['id']),)])
                for name, data in files.items(): self.assertEqual((c.store/name).read_bytes(), data)
                # A different value in a new field cannot be excused as a default.
                c.add_database_row('classroom_activity_events', {**extended, 'defaulted': 9},
                                   {'nullable': None, 'defaulted': 7}, at)
                self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0], 2)
                c.db.close()

    def test_no_default_proof_or_changed_existing_field_never_aliases_legacy(self):
        for changed in ({'private_content': 'PRIVATE_DIFFERENT'}, {'new_column': 'PRIVATE_REAL_UPDATE'}):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temp:
                c = Collector(Path(temp), {}); row = self.row(); at = row['occurred_at']
                c.add(normalize('audit', json.dumps(row), at, legacy_identity('classroom_activity_events', row), 'classroom_activity_events'))
                c.add_database_row('classroom_activity_events', {**row, **changed}, {}, at)
                self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0], 2)
                c.db.close()

    def test_all_native_keys_and_invalid_keys_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            c = Collector(Path(temp), {})
            for table, rule in DATABASE_DIAGNOSTICS['sources'].items():
                key = 'event_hash' if table == 'max_webhook_events' else 'id'
                at = datetime.now(timezone.utc).isoformat()
                column = rule['timeColumn']
                for invalid in (None, '', True, [], {}, 'x'*1025):
                    row = {key: invalid, column: at}
                    with self.subTest(table=table, invalid=type(invalid)), self.assertRaises(ValueError):
                        c.add_database_row(table, row, {}, at)
                with self.assertRaises(ValueError): c.add_database_row(table, {column: at}, {}, at)
            row = self.row(); row.update({f'extra_{i}': i for i in range(256)})
            with self.assertRaises(ValueError): c.add_database_row('classroom_activity_events', row, {}, row['occurred_at'])
            self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0], 0)
            c.db.close()

    def test_more_than_256_mutable_observations_repeat_and_retention_cleanup(self):
        with tempfile.TemporaryDirectory() as temp:
            c = Collector(Path(temp), {'retentionDays': 30}); c.reader_format = 2
            row = self.row(occurred_at=(datetime.now(timezone.utc)-timedelta(days=2)).isoformat())
            at = row['occurred_at']
            for count in range(1, 261):
                c.add_database_row('classroom_activity_events', {**row, 'occurrence_count': count}, {}, at)
            self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0], 260)
            extended = {**row, 'new_nullable': None, 'new_default': 7}
            for count in range(1, 261):
                c.add_database_row('classroom_activity_events', {**extended, 'occurrence_count': count},
                                   {'new_nullable': None, 'new_default': 7}, at)
            self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0], 260)
            self.assertEqual(c.db.execute('SELECT count(*) FROM database_observations').fetchone()[0], 260)
            c.publish(); originals = {p.name: p.read_bytes() for p in c.store.glob('seg-*')}
            c.config['retentionDays'] = 1; c.publish()
            self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0], 0)
            self.assertEqual(c.db.execute('SELECT count(*) FROM database_observations').fetchone()[0], 0)
            for name, data in originals.items(): self.assertEqual((c.store/name).read_bytes(), data)
            c.db.close()


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
            if hasattr(c, 'add_database_row'):
                def legacy_add(table, value, defaults, at):
                    raw = json.dumps(value, ensure_ascii=False, sort_keys=True)
                    c.add(normalize('auth' if table == 'product_analytics_events' else 'audit',
                                    raw, at, legacy_identity(table, value), table))
                c.add_database_row = legacy_add
            c.database(); c.publish()
            before = sorted(row[0].hex() for row in c.db.execute('SELECT id FROM events'))
            self.assertEqual(len(before), 27)
            old_segments = {p.name: p.read_bytes() for p in c.store.glob('seg-*')}
            c.db.execute('DROP TABLE IF EXISTS database_observations'); c.db.commit()
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
