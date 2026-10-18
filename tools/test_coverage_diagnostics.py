import gzip
import json
import re
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from collect_logs import Collector, database_diagnostics, now
from resource_sampling import ResourceSampler


def consume(sampler):
    values = []
    while (value := sampler.acquire()) is not None:
        values.append(value)
        sampler.acknowledge(value['sampling'])
    return values


class CoverageTests(unittest.TestCase):
    def test_sampler_keeps_cadence_and_explicit_bounded_overflow_without_consumer(self):
        clock = [0]
        sampler = ResourceSampler(lambda *_: {'sampledAt': now()}, capacity=2, clock=lambda: clock[0])
        deadline = 0
        for at in (0, 60, 120, 180):
            clock[0] = at; deadline = sampler.sample(deadline)
        self.assertEqual(deadline, 240)
        values = consume(sampler)
        self.assertEqual([v['sampling']['sequence'] for v in values], [3, 4])
        self.assertEqual(values[-1]['sampling']['droppedSamplesTotal'], 2)
        self.assertEqual(values[-1]['sampling']['scheduleLagMs'], 0)
        clock[0] = 600
        self.assertEqual(sampler.sample(deadline), 660)
        self.assertEqual(consume(sampler)[0]['sampling']['missedIntervals'], 6)

    def test_producer_runs_while_consumer_is_idle_and_targets_are_immutable(self):
        produced = threading.Event(); seen = []
        def capture(containers, postgres):
            seen.append((containers, postgres)); produced.set()
            return {'sampledAt': now()}
        sampler = ResourceSampler(capture, interval=60)
        targets = ['verified-container']; sampler.set_targets(targets, 'verified-db')
        targets.append('unverified')
        sampler.start()
        self.assertTrue(produced.wait(2))
        self.assertTrue(sampler.stop(2))
        self.assertEqual(seen, [(('verified-container',), 'verified-db')])
        self.assertEqual(consume(sampler)[0]['sampling']['sequence'], 1)

    def test_capture_failure_is_fixed_vocabulary_and_does_not_kill_next_sample(self):
        def capture(*_): raise RuntimeError('PRIVATE SQL password=value')
        sampler = ResourceSampler(capture, clock=lambda: 0)
        sampler.sample(0); sampler.sample(60)
        values = consume(sampler)
        self.assertEqual(len(values), 2)
        self.assertTrue(values[0]['incomplete'])
        self.assertNotIn('PRIVATE', json.dumps(values))
        self.assertNotIn('password', json.dumps(values))

    def test_resource_capture_never_uses_sqlite_and_publication_records_lag(self):
        with tempfile.TemporaryDirectory() as directory:
            collector = Collector(Path(directory), {})
            try:
                with patch.object(collector, 'state', side_effect=AssertionError('SQLite on producer')):
                    metrics, _ = collector.sample_resources((), None, {})
                self.assertNotIn('resource_capture', metrics.get('failedComponents', []))
                collector.sampler = ResourceSampler(lambda *_: metrics)
                collector.sampler.sample(collector.sampler.clock())
                collector.telemetry()
                stored = json.loads(json.loads(gzip.decompress(collector.db.execute('SELECT payload FROM events').fetchone()[0]))['message'])
                self.assertGreaterEqual(stored['sampling']['publicationLagMs'], 0)
                self.assertEqual(stored['sampling']['sequence'], 1)
                self.assertIsNone(collector.sampler.acquire())
            finally: collector.db.close()

    def test_handoff_retries_after_insert_failure_and_survives_later_cycle_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            collector = Collector(Path(directory), {})
            try:
                collector.sampler = ResourceSampler(lambda *_: {'sampledAt': now()}, capacity=1, clock=lambda: 0)
                collector.sampler.sample(0)
                persist = collector.persist_metrics
                def fail_after_insert(metrics):
                    persist(metrics)
                    raise OSError('synthetic failed handoff')
                with patch.object(collector, 'persist_metrics', side_effect=fail_after_insert):
                    with self.assertRaises(OSError): collector.telemetry()
                self.assertEqual(collector.db.execute('SELECT count(*) FROM events').fetchone()[0], 0)
                # Producer overflow must never evict the unacknowledged sample.
                collector.sampler.sample(60); collector.sampler.sample(120)
                self.assertEqual(collector.sampler.acquire()['sampling']['sequence'], 1)
                collector.telemetry()
                collector.set_state('later-adapter', 'uncommitted')
                collector.db.rollback()
                rows = collector.db.execute('SELECT payload FROM events ORDER BY seq').fetchall()
                values = [json.loads(json.loads(gzip.decompress(row[0]))['message']) for row in rows]
                self.assertEqual([v['sampling']['sequence'] for v in values], [1, 3])
                self.assertTrue(all(v['sampling']['droppedSamplesTotal'] == 1 for v in values))
                self.assertTrue(all(v['samplingCoverage'] == 'gapped' for v in values))
                collector.telemetry()
                self.assertEqual(collector.db.execute('SELECT count(*) FROM events').fetchone()[0], 2)
                self.assertIsNone(collector.sampler.acquire())
            finally: collector.db.close()

    def test_once_cpu_state_survives_process_recreation_and_legacy_upgrade(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            collector = Collector(root, {})
            prior = {'windows': [1, 10], 'linux': [2, 20]}
            updated = {'windows': [3, 30], 'linux': [4, 40]}
            try:
                collector.set_state('metrics:cpu', prior['windows'])
                collector.set_state('metrics:cpu-linux', prior['linux'])
                with patch.object(collector, 'sample_resources', return_value=({'sampledAt': now()}, updated)) as capture:
                    collector.telemetry()
                    self.assertEqual(capture.call_args.args[2], prior)
                collector.set_state('metrics:last', 0)
                collector.db.commit()
            finally: collector.db.close()
            collector = Collector(root, {})
            try:
                with patch.object(collector, 'sample_resources', return_value=({'sampledAt': now()}, updated)) as capture:
                    collector.telemetry()
                    self.assertEqual(capture.call_args.args[2], updated)
            finally: collector.db.close()

    def test_actual_administrative_mutation_names_have_closed_safe_projection(self):
        root = Path(__file__).resolve().parent.parent
        actions = set()
        for file in (root / 'migrations').glob('*.sql'):
            for call in re.findall(r'PERFORM public\.admin_append_audit_event\((.*?)\);', file.read_text(encoding='utf-8'), re.S):
                actions.update(re.findall(r"'(administration\.[a-z_.]+)'", call))
        self.assertGreaterEqual(len(actions), 10)
        for action in actions:
            self.assertEqual(database_diagnostics('administrative_audit_events', {'action': action, 'reason': 'PRIVATE'}), {'action': action})
        self.assertEqual(database_diagnostics('administrative_audit_events', {'action': 'administration.PRIVATE'}), {})

    def test_new_projection_keeps_real_names_metadata_and_no_private_values(self):
        row = {'event_type':'visit.observed','module_key':'blocks','browser_family':'Firefox',
               'operating_system':'Linux','device_category':'desktop','address_provenance':'server_resolved',
               'ip_address':None, 'email':'PRIVATE@example.invalid','payload_json':{'name':'PRIVATE'}}
        value = database_diagnostics('product_analytics_events', row)
        self.assertEqual(value['event_type'], 'visit.observed')
        self.assertEqual(value['address_provenance'], 'server_unresolved')
        self.assertEqual(database_diagnostics('product_analytics_events', value), value)
        self.assertNotIn('PRIVATE', json.dumps(value))
        self.assertNotIn('ip_address', value)
        self.assertEqual(database_diagnostics('audit_events', {'action':'classroom.participant.avatar_choose'}), {'action':'classroom.participant.avatar_choose'})
        self.assertEqual(database_diagnostics('audit_events', {'action':'PRIVATE arbitrary'}), {})


if __name__ == '__main__': unittest.main()
