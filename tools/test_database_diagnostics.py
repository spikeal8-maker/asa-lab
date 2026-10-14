"""Artificial database rows through the real collector; no database connection."""
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from collect_logs import Collector, normalize


SENTINELS = ('PRIVATE_PERSON_012', 'private012@example.invalid', '203.0.113.212',
             'PRIVATE_CONTENT_012', 'PRIVATE_SECRET_012', 'PRIVATE_NESTED_012')
# Expectations are independent of the production contract.
SOURCES = {
    'audit_events': ('created_at', {'entity_type': 'account', 'action': 'account.registered'}),
    'administrative_audit_events': ('occurred_at', {'scope_kind': 'platform', 'result': 'failed'}),
    'classroom_activity_events': ('occurred_at', {'action': 'project.saved', 'occurrence_count': 3}),
    'account_external_identity_events': ('occurred_at', {'provider': 'max', 'event': 'revoked'}),
    'grade_change_events': ('created_at', {'event_kind': 'corrected'}),
    'checkers_reaction_events': ('created_at', {'reaction_id': 'good-move', 'game_state': 'active'}),
    'chess_live_events': ('created_at_ms', {'sequence': 7}),
    'max_webhook_events': ('received_at', {}),
    'product_analytics_events': ('occurred_at', {'event_type': 'auth.login', 'outcome': 'failed',
        'actor_kind': 'account', 'auth_method': 'password', 'network_kind': 'public'}),
}


def fixture_row(table, history=False):
    column, diagnostics = SOURCES[table]
    stamp = datetime.now(timezone.utc) - timedelta(days=2 if history else 0, minutes=1)
    value = {'id': 'private-native-id-history' if history else 'private-native-id-fresh',
             'display_name': SENTINELS[0], 'email': SENTINELS[1], 'ip_address': SENTINELS[2],
             'project_title': SENTINELS[3], 'reason': SENTINELS[3], 'reason_text': SENTINELS[3],
             'user_agent_summary': SENTINELS[3], 'event_hash': SENTINELS[4],
             'future_schema_field': {'nested': [SENTINELS[5]]},
             'payload_json': {'free_text': SENTINELS[3]},
             'metadata_json': {'unexpected': SENTINELS[4]}, 'snapshot': {'name': SENTINELS[0]},
             'module': SENTINELS[0], 'requestId': SENTINELS[4], 'revision': SENTINELS[4],
             'level': 'error', 'message': SENTINELS[3]}
    value.update(diagnostics)
    value[column] = int(stamp.timestamp()*1000) if column.endswith('_ms') else stamp.isoformat()
    return value


def collected_fixture(root):
    collector = Collector(root, {}); collector.reader_format = 2; collector.postgres = 'artificial'
    rows = {}; queries = []
    def command(args, **kwargs):
        sql = kwargs['sql']; queries.append(sql)
        table = re.search(r'FROM public\."([a-z_]+)"', sql)[1]
        historical = ' OR ' not in sql
        row = rows.setdefault((table, historical), fixture_row(table, historical))
        stream = io.StringIO(); csv.writer(stream).writerow([json.dumps(row)])
        return stream.getvalue().encode()
    collector.command = command
    collector.database()
    return collector, rows, queries


class DatabaseDiagnosticTests(unittest.TestCase):
    def test_all_sources_fresh_and_history_persist_only_diagnostics(self):
        with tempfile.TemporaryDirectory() as temp:
            c, rows, queries = collected_fixture(Path(temp))
            try:
                self.assertEqual(len(queries), 18)
                pending = [json.loads(gzip.decompress(r[0])) for r in c.db.execute('SELECT payload FROM events')]
                self.assertEqual(len(pending), 18)
                for event in pending:
                    with self.subTest(origin=event['origin'], time=event['time']):
                        column, expected = SOURCES[event['origin']]
                        message = json.loads(event['message'])
                        self.assertEqual(message, {**expected, column: message[column]})
                        for secret in SENTINELS: self.assertNotIn(secret, json.dumps(event))
                        self.assertEqual(event['module'], 'auth' if event['source'] == 'auth' else 'system')
                        self.assertEqual(event['level'], 'error' if event['origin'] in
                            ('administrative_audit_events', 'product_analytics_events') else 'info')
                        self.assertIsNone(event['requestId']); self.assertIsNone(event['revision'])
                c.publish()
                catalog = json.loads((c.store/'catalog.json').read_text())
                self.assertEqual(sum(s['count'] for s in catalog['segments']), 18)
                persisted = (c.store/'catalog.json').read_text()
                for segment in catalog['segments']:
                    data = (c.store/segment['file']).read_bytes()
                    persisted += gzip.decompress(data).decode() if segment['file'].endswith('.gz') else data.decode()
                for secret in SENTINELS: self.assertNotIn(secret, persisted)
                self.assertEqual(len(rows), 18)
            finally: c.db.close()

    def test_allowlisted_fields_reject_arbitrary_text_nested_and_wrong_types(self):
        contract = json.loads((Path(__file__).resolve().parents[1]/'apps/api/src/database-diagnostic-contract.json').read_text())
        for table, rules in contract['sources'].items():
            for key in rules['fields']:
                for invalid in (SENTINELS[0], SENTINELS[1], SENTINELS[2], {'name': SENTINELS[0]},
                                [SENTINELS[0]], True, None, 1.5, -1, 10**20):
                    with self.subTest(table=table, key=key, invalid=invalid):
                        event = normalize('auth' if table == 'product_analytics_events' else 'audit',
                                          json.dumps({key: invalid}), '2026-10-01T00:00:00Z', 'identity', table)
                        self.assertEqual(json.loads(event['message']), {})
        for invalid in ('2026-99-01T00:00:00Z', '2026-10-01T00:00:00Z PRIVATE_PERSON_012',
                        '2026-10-01T00:00:00', '9999-10-01T00:00:00Z'):
            event = normalize('audit', json.dumps({'created_at': invalid}), '2026-10-01T00:00:00Z', 'identity', 'audit_events')
            self.assertEqual(json.loads(event['message']), {})
        for raw in ('broken PRIVATE_PERSON_012', '"PRIVATE_PERSON_012"', '["PRIVATE_PERSON_012"]', 'null'):
            event = normalize('audit', raw, '2026-10-01T00:00:00Z', 'identity', 'audit_events')
            self.assertEqual(json.loads(event['message']), {})

    def test_valid_codes_and_scalar_boundaries_remain_useful(self):
        checks = {
            'administrative_audit_events': ({'result': 'denied', 'reason_code': 'permission_not_granted',
                'before_version': 0, 'after_version': 9007199254740991}, 'warn'),
            'product_analytics_events': ({'outcome': 'blocked', 'module_key': 'electronics'}, 'warn'),
            'classroom_activity_events': ({'occurrence_count': 2147483647,
                'first_occurred_at': '2026-10-01T00:00:00.123456+03:00'}, 'info'),
            'chess_live_events': ({'created_at_ms': 0, 'sequence': 9007199254740991}, 'info'),
        }
        for table, (value, level) in checks.items():
            event = normalize('auth' if table == 'product_analytics_events' else 'audit',
                              json.dumps(value), '2026-10-01T00:00:00Z', 'identity', table)
            self.assertEqual(json.loads(event['message']), value)
            self.assertEqual(event['level'], level)

    def test_raw_identity_cursors_and_repeat_are_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            c, rows, queries = collected_fixture(Path(temp))
            try:
                actual = {r[0] for r in c.db.execute('SELECT id FROM events')}
                expected = {bytes.fromhex(hashlib.sha256((('auth' if table == 'product_analytics_events' else 'audit')
                    + '\0' + table + ':' + json.dumps(row, ensure_ascii=False, sort_keys=True)).encode()).hexdigest())
                    for (table, _), row in rows.items()}
                self.assertEqual(actual, expected)
                for table in SOURCES:
                    self.assertIsNotNone(c.state('db:'+table))
                    self.assertIsNotNone(c.state('db:history:'+table+':completed'))
                c.set_state('database:last', 0)
                c.database()
                self.assertEqual(len(queries), 27)  # history remains on its own six-hour schedule
                self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0], 18)
            finally: c.db.close()


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--write-store':
        c, _, _ = collected_fixture(Path(sys.argv[2])); c.publish(); c.db.close()
    else: unittest.main()
