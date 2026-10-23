import gzip
import json
import re
import os
import sqlite3
import time
import secrets
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from collect_logs import Collector, database_diagnostics, now, normalize
from resource_sampling import ResourceSampler


def consume(sampler):
    values = []
    while (value := sampler.acquire()) is not None:
        values.append(value)
        sampler.acknowledge(value['sampling'])
    return values


class CoverageTests(unittest.TestCase):
    def test_durable_resource_spool_survives_slow_consumer_and_restart_without_evicting_samples(self):
        with tempfile.TemporaryDirectory() as directory:
            spool = Path(directory)/'resources.sqlite'
            sampler = ResourceSampler(lambda *_: {'sampledAt': now()}, spool=spool, capacity=2, clock=lambda: 0)
            for i in range(30): sampler.sample(i*60)
            stream = sampler.stream_id
            restarted = ResourceSampler(lambda *_: {'sampledAt': now()}, spool=spool, clock=lambda: 0)
            values = restarted.batch()
            self.assertEqual([v['sampling']['sequence'] for v in values], list(range(1,31)))
            self.assertEqual({v['sampling']['streamId'] for v in values}, {stream})
            self.assertTrue(all(v['sampling']['droppedSamplesTotal'] == 0 for v in values))
            # A producer restart uses a new stream, without replacing old data.
            restarted.sample(0)
            self.assertNotEqual(restarted.batch()[-1]['sampling']['streamId'], stream)
            for value in restarted.batch(): restarted.acknowledge(value['sampling'])
            self.assertEqual(restarted.batch(), [])

    def test_durable_resource_spool_reports_bounded_disk_overflow_and_write_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            spool = Path(directory)/'resources.sqlite'
            sampler = ResourceSampler(lambda *_: {'sampledAt': now(), 'fixture': 'x'*20000},
                spool=spool, max_bytes=128*1024, clock=lambda: 0)
            for i in range(10): sampler.sample(i*60)
            values = sampler.batch()
            self.assertEqual([v['sampling']['sequence'] for v in values], [1,2,3])
            self.assertEqual(values[0]['sampling']['droppedSamplesTotal'], 7)
            self.assertEqual(sampler.storage_error, 'resource_spool_full')
            self.assertLessEqual(spool.stat().st_size, 128*1024)
            restarted = ResourceSampler(lambda *_: {'sampledAt': now()}, spool=spool, max_bytes=128*1024, clock=lambda: 0)
            self.assertEqual(restarted.batch()[0]['sampling']['droppedSamplesTotal'], 7)
            with patch.object(restarted, 'spool_db', side_effect=sqlite3.OperationalError('PRIVATE error')):
                restarted.sample(0)
            self.assertEqual(restarted.storage_error, 'resource_spool_write_failed')
            restarted.sample(60)
            self.assertEqual(restarted.batch()[0]['sampling']['droppedSamplesTotal'], 8)

    def test_spool_ack_waits_for_catalog_and_replays_main_commit_after_crash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); collector = Collector(root, {})
            spool = collector.private/'resources.sqlite'
            sampler = ResourceSampler(lambda *_: {'sampledAt': now()}, spool=spool, clock=lambda: 0)
            collector.sampler = sampler
            sampler.sample(0)
            collector.telemetry()
            self.assertEqual(len(sampler.batch()), 1)
            from collect_logs import atomic_bytes
            def fail_catalog(path, data, **kw):
                if path.name == 'catalog.json': raise OSError('simulated catalog write failure')
                return atomic_bytes(path, data, **kw)
            with patch('collect_logs.atomic_bytes', side_effect=fail_catalog):
                with self.assertRaises(OSError): collector.publish()
            self.assertEqual(len(sampler.batch()), 1)
            collector.db.close()
            collector = Collector(root, {})
            collector.sampler = ResourceSampler(lambda *_: {'sampledAt': now()}, spool=spool)
            collector.telemetry(); collector.publish()
            self.assertEqual(collector.sampler.batch(), [])
            catalog = json.loads((collector.store/'catalog.json').read_text(encoding='utf-8'))
            self.assertEqual(sum(s['count'] for s in catalog['segments']), 1)
            self.assertEqual(collector.db.execute('SELECT count(*) FROM events').fetchone()[0], 1)
            collector.db.close()

    def test_verification_cache_hashes_bytes_and_rejects_restored_mtime_index_or_forged_cache(self):
        for corruption in ('bytes', 'index', 'receipt'):
            with self.subTest(corruption=corruption), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); collector = Collector(root, {}); collector.reader_format = 2
                collector.add(normalize('api', 'retained', now(), 'kept')); collector.publish()
                collector.validate_history_index(); collector.db.commit()
                path = next(collector.store.glob('seg-*.gz')); stamp = path.stat()
                if corruption == 'index':
                    collector.db.execute('UPDATE events SET id=?', (bytes.fromhex('00'*32),)); collector.db.commit()
                else:
                    data = bytearray(path.read_bytes()); data[-1] ^= 1; path.write_bytes(data)
                    os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
                    if corruption == 'receipt':
                        collector.db.execute("UPDATE segment_verification SET proof=?,metadata=?", ('0'*64, '{}')); collector.db.commit()
                collector.db.close()
                with self.assertRaisesRegex(RuntimeError, 'private payloads were preserved'): Collector(root, {})
                self.assertTrue(path.exists())

    def test_verified_metadata_overrides_forged_classification_and_range_hints(self):
        with tempfile.TemporaryDirectory() as directory:
            collector = Collector(Path(directory), {}); collector.reader_format = 2
            collector.add(normalize('api', json.dumps({'path':'/api/projects/fixture'}), now(), 'kept')); collector.publish()
            values = collector.state('segments')
            for value in values.values():
                value.update(sources=['windows:System'], modules=['system'], subsystems=['host'], sourceRanges={'windows:System': {'first':now(),'last':now()}})
            collector.set_state('segments', values); collector.db.commit(); collector.publish()
            meta = json.loads((collector.store/'catalog.json').read_text(encoding='utf-8'))['segments'][0]
            self.assertEqual(meta['sources'], ['api']); self.assertEqual(meta['subsystems'], ['projects'])
            self.assertEqual(set(meta['sourceRanges']), {'api'}); collector.db.close()

    def test_bounded_history_benchmark_warm_restart_and_fresh_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); collector = Collector(root, {}); collector.reader_format = 2
            metadata = {}; at = now()
            # 512 independent compressed segments, 8 MiB of varied raw text.
            for i in range(512):
                event = normalize('api', secrets.token_hex(8192), at, str(i)); collector.add(event)
                meta = collector.write_segment(f'seg-{i+1:016d}-{i+1:016d}.jsonl', [event]); metadata[meta['file']] = meta
            collector.db.execute('UPDATE events SET published=1,payload=NULL'); collector.set_state('segments',metadata); collector.db.commit()
            start = time.monotonic(); collector.validate_history_index(); cold = time.monotonic()-start; collector.db.commit()
            with patch('collect_logs.gzip.open', side_effect=AssertionError('warm cache must not decompress retained history')):
                start = time.monotonic(); collector.validate_history_index(); warm = time.monotonic()-start
                collector.db.commit(); collector.db.close()
                start = time.monotonic(); collector = Collector(root, {}); restart = time.monotonic()-start
            collector.add(normalize('scratch', 'fresh marker', now(), 'fresh'))
            start = time.monotonic(); collector.publish(); elapsed = time.monotonic()-start
            catalog = json.loads((collector.store/'catalog.json').read_text(encoding='utf-8'))
            self.assertIn('scratch', {s for meta in catalog['segments'] for s in meta['sources']})
            self.assertLess(cold+elapsed, 60); self.assertLess(warm, 60); self.assertLess(restart, 60)
            print(f'POINT1 synthetic512 cold={cold:.3f}s warm={warm:.3f}s restart={restart:.3f}s freshPublish={elapsed:.3f}s; warm/restart gzipReads=0')
            collector.db.close()

    def test_checkpoints_are_reentrancy_safe_and_publication_marks_stale_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            collector = Collector(Path(directory), {})
            collector.checkpoint_enabled = True
            calls = []
            def publish(): calls.append('publish'); collector.checkpoint(force=True)
            with patch.object(collector, 'publish', side_effect=publish), patch.object(collector, 'telemetry'):
                collector.checkpoint(force=True)
            self.assertEqual(calls, ['publish'])
            collector.status('api:recent', 'ok', collected_through='2026-01-01T00:00:00Z')
            collector.publish()
            source = json.loads((collector.store/'catalog.json').read_text(encoding='utf-8'))['sources'][0]
            self.assertTrue(source['stale']); self.assertEqual(source['state'], 'pending')
            self.assertGreater(source['coverageLagSeconds'], 60); collector.db.close()

    def test_spool_sql_failure_and_quota_eviction_never_ack_unpublished_samples(self):
        with tempfile.TemporaryDirectory() as directory:
            collector = Collector(Path(directory), {'maxBytes': 1024**3})
            collector.sampler = ResourceSampler(lambda *_: {'sampledAt': now()}, spool=collector.private/'resources.sqlite', clock=lambda: 0)
            collector.sampler.sample(0)
            with patch.object(collector, 'persist_metrics', side_effect=sqlite3.OperationalError('synthetic failure')):
                with self.assertRaises(sqlite3.OperationalError): collector.telemetry()
            self.assertEqual(len(collector.sampler.batch()), 1)
            collector.telemetry()
            # Terminal expiry is a recorded loss, never a publication ACK.
            with patch('collect_logs.timedelta', return_value=__import__('datetime').timedelta(days=-1)):
                collector.publish()
            self.assertEqual(collector.sampler.batch(), [])
            self.assertEqual(collector.sampler.loss_counters()['expiredSamplesTotal'], 1)
            source = next(s for s in json.loads((collector.store/'catalog.json').read_text(encoding='utf-8'))['sources'] if s['source']=='metrics')
            self.assertEqual(source['state'], 'pending'); self.assertTrue(source['possibleCoverageGap'])
            collector.telemetry(); collector.publish()
            self.assertEqual(collector.sampler.batch(), []); collector.db.close()

    def test_expired_spool_prefix_advances_to_fresh_sample_after_restart_with_durable_loss_receipt(self):
        from datetime import datetime, timedelta, timezone
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); collector = Collector(root, {'retentionDays':1})
            spool = collector.private/'resources.sqlite'
            old = (datetime.now(timezone.utc)-timedelta(days=2)).isoformat()
            stamp = [old]
            collector.sampler = ResourceSampler(lambda *_: {'sampledAt':stamp[0]}, spool=spool, clock=lambda:0)
            for i in range(128): collector.sampler.sample(i*60)
            stamp[0] = now(); collector.sampler.sample(128*60)
            with patch.object(collector.sampler, 'acknowledge', wraps=collector.sampler.acknowledge) as ack:
                collector.telemetry(); collector.publish()
                ack.assert_not_called()
            self.assertEqual([v['sampling']['sequence'] for v in collector.sampler.batch()], [129])
            self.assertEqual(collector.sampler.loss_counters(), dict(droppedSamplesTotal=128, expiredSamplesTotal=128, quotaDiscardedSamplesTotal=0))
            collector.db.close()
            collector = Collector(root, {'retentionDays':1})
            collector.sampler = ResourceSampler(lambda *_: {'sampledAt':now()}, spool=spool)
            collector.telemetry(); collector.publish(); collector.telemetry(); collector.publish()
            self.assertEqual(collector.sampler.batch(), [])
            catalog = json.loads((collector.store/'catalog.json').read_text(encoding='utf-8'))
            self.assertEqual(sum(s['count'] for s in catalog['segments']), 1)
            source = next(s for s in catalog['sources'] if s['source']=='metrics')
            self.assertTrue(source['possibleCoverageGap']); self.assertEqual(source['state'],'pending')
            self.assertEqual(source['resourceLossCounters']['expiredSamplesTotal'],128)
            self.assertEqual(collector.db.execute('SELECT count(*) FROM events').fetchone()[0],1)
            collector.db.close()

    def test_quota_disposition_is_durable_idempotent_and_does_not_block_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); collector = Collector(root, {'maxBytes':1})
            spool = collector.private/'resources.sqlite'
            collector.sampler = ResourceSampler(lambda *_:{'sampledAt':now()}, spool=spool, clock=lambda:0)
            collector.sampler.sample(0); expired_reservation = collector.sampler.batch()[0]['sampling']
            collector.telemetry()
            with patch.object(collector.sampler,'acknowledge',wraps=collector.sampler.acknowledge) as ack:
                collector.publish(); ack.assert_not_called()
            self.assertEqual(collector.sampler.batch(),[])
            collector.sampler.dispose(expired_reservation,'quota_discarded')
            self.assertEqual(collector.sampler.loss_counters(),dict(droppedSamplesTotal=1,expiredSamplesTotal=0,quotaDiscardedSamplesTotal=1))
            collector.db.close(); collector = Collector(root, {'maxBytes':1024**3})
            collector.sampler = ResourceSampler(lambda *_:{'sampledAt':now()},spool=spool,clock=lambda:0)
            collector.sampler.sample(0); collector.telemetry(); collector.publish()
            self.assertEqual(collector.sampler.batch(),[])
            catalog = json.loads((collector.store/'catalog.json').read_text(encoding='utf-8'))
            self.assertEqual(sum(s['count'] for s in catalog['segments']),1)
            source = next(s for s in catalog['sources'] if s['source']=='metrics')
            self.assertEqual(source['resourceLossCounters']['quotaDiscardedSamplesTotal'],1)
            self.assertTrue(source['possibleCoverageGap']); collector.db.close()

    def test_fresh_lanes_publish_before_slow_history_and_windows_work(self):
        with tempfile.TemporaryDirectory() as directory:
            collector = Collector(Path(directory), {}); collector.reader_format = 2
            order = []
            def docker(history):
                order.append(('docker', history))
                if history is False: collector.add(normalize('api','fresh',now(),'fresh'))
                else:
                    catalog = json.loads((collector.store/'catalog.json').read_text(encoding='utf-8'))
                    self.assertIn('api', {source for meta in catalog['segments'] for source in meta['sources']})
            with patch.object(collector, 'docker', side_effect=docker), patch.object(collector, 'database', side_effect=lambda history: order.append(('database',history))), \
                 patch.object(collector, 'files'), patch.object(collector, 'windows') as windows, patch.object(collector, 'linux'), patch.object(collector, 'lifecycle'):
                collector.cycle()
            self.assertEqual(order, [('docker',False),('database',False),('docker',True),('database',True)])
            windows.assert_called_once_with(background=True); collector.db.close()

    def test_windows_background_worker_never_owns_index_or_blocks_core_publication(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as directory:
            collector = Collector(Path(directory), {})
            started, release = threading.Event(), threading.Event()
            def command(*args, **kwargs):
                started.set(); release.wait(3)
                return json.dumps({'events': [], 'sources': [], 'cursors': {}}).encode()
            try:
                with patch.object(collector, 'command', side_effect=command):
                    with patch('collect_logs.os', SimpleNamespace(name='nt')): collector.windows(background=True)
                    self.assertTrue(started.wait(1)); self.assertTrue(collector.windows_worker.is_alive())
                    collector.add(normalize('api','fresh while Windows pending',now(),'live')); collector.publish()
                    self.assertTrue((collector.store/'catalog.json').exists())
                    with patch('collect_logs.os', SimpleNamespace(name='nt')): collector.windows(background=True)
                    self.assertIsNone(collector.state('windows:last'))
                    release.set(); collector.windows_worker.join(2)
                    with patch('collect_logs.os', SimpleNamespace(name='nt')): collector.windows(background=True)
                    self.assertIsNotNone(collector.state('windows:last'))
            finally:
                release.set()
                if getattr(collector,'windows_worker',None): collector.windows_worker.join(3)
                collector.db.close()

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
