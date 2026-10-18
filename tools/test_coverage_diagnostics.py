import gzip
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from collect_logs import Collector, database_diagnostics, now
from resource_sampling import ResourceSampler


class CoverageTests(unittest.TestCase):
    def test_sampler_keeps_cadence_and_explicit_bounded_overflow_without_consumer(self):
        clock = [0]
        sampler = ResourceSampler(lambda *_: {'sampledAt': now()}, capacity=2, clock=lambda: clock[0])
        deadline = 0
        for at in (0, 60, 120, 180):
            clock[0] = at; deadline = sampler.sample(deadline)
        self.assertEqual(deadline, 240)
        values = sampler.drain()
        self.assertEqual([v['sampling']['sequence'] for v in values], [3, 4])
        self.assertEqual(values[-1]['sampling']['droppedSamplesTotal'], 2)
        self.assertEqual(values[-1]['sampling']['scheduleLagMs'], 0)
        clock[0] = 600
        self.assertEqual(sampler.sample(deadline), 660)
        self.assertEqual(sampler.drain()[0]['sampling']['missedIntervals'], 6)

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
        self.assertEqual(sampler.drain()[0]['sampling']['sequence'], 1)

    def test_capture_failure_is_fixed_vocabulary_and_does_not_kill_next_sample(self):
        def capture(*_): raise RuntimeError('PRIVATE SQL password=value')
        sampler = ResourceSampler(capture, clock=lambda: 0)
        sampler.sample(0); sampler.sample(60)
        values = sampler.drain()
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
                self.assertEqual(collector.sampler.drain(), [])
            finally: collector.db.close()

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
