import json
import gzip
import secrets
import zipfile
import os
import subprocess
import tempfile
import unittest
import time
from unittest.mock import patch
from pathlib import Path
from datetime import datetime, timedelta, timezone
from collect_logs import Collector, normalize, now, file_timestamp, clean


class CollectorTests(unittest.TestCase):
    def test_empty_legacy_index_keeps_sequence_after_atomic_swap(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);c=Collector(root,{});c.add(normalize('api','expired',now(),'expired'))
            c.db.execute('DELETE FROM events');c.db.execute("UPDATE sqlite_sequence SET seq=777 WHERE name='events'")
            c.set_state('index:version',1);c.db.commit();c.db.close()
            c=Collector(root,{});c.add(normalize('api','next',now(),'next'))
            self.assertEqual(c.db.execute('SELECT seq FROM events').fetchone()[0],778);c.db.close()

    def test_retirement_clock_starts_after_published_catalog_exclusion(self):
        with tempfile.TemporaryDirectory() as temp:
            c=Collector(Path(temp),{});c.reader_format=2;c.add(normalize('api','old snapshot',now(),'old'));c.publish()
            catalog=json.loads((c.store/'catalog.json').read_text());name=catalog['segments'][0]['file'];file=c.store/name
            # Model a crash after retirement commit but before catalog replacement.
            c.set_state('retired:segments',{name:1});c.db.execute('DELETE FROM events');c.db.commit()
            with patch('collect_logs.time.time',return_value=10000):c.publish()
            self.assertTrue(file.exists());self.assertIsNone(c.state('retired:segments')[name])
            with patch('collect_logs.time.time',return_value=10020):c.publish()
            self.assertTrue(file.exists())
            with patch('collect_logs.time.time',return_value=10139):c.publish()
            self.assertTrue(file.exists())
            with patch('collect_logs.time.time',return_value=10200):c.publish()
            self.assertFalse(file.exists());c.db.close()

    def test_email_redaction_handles_long_identifiers_without_quadratic_delay(self):
        started=time.monotonic()
        for value in ['a'*100000, 'a'*100000+'@invalid', 'a'*100000+'@example.org', 'user.name+tag@example.org']:
            result=clean(value)
            if value.endswith('.org'): self.assertEqual(result,'[email]')
            else: self.assertEqual(result,value)
        self.assertLess(time.monotonic()-started,3)

    def test_corrupt_segment_upgrade_preserves_private_payloads(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);c=Collector(root,{});event=normalize('api','kept private',now(),'kept');c.add(event);c.publish()
            c.set_state('index:version',1)
            c.db.execute('UPDATE events SET id=?,payload=?',(event['id'],json.dumps(event)));c.db.commit()
            file=next(c.store.glob('seg-*.jsonl'));file.write_text('corrupt\n');c.db.close()
            with self.assertRaisesRegex(RuntimeError,'private payloads were preserved'):Collector(root,{})
            import sqlite3
            with sqlite3.connect(root/'.asa/diagnostics/private/index.sqlite') as db:
                self.assertEqual(json.loads(db.execute('SELECT payload FROM events').fetchone()[0])['id'],event['id'])
            db.close()

    def test_source_coverage_uses_actual_source_rows_in_mixed_segment(self):
        with tempfile.TemporaryDirectory() as temp:
            c=Collector(Path(temp),{});c.reader_format=2
            later=now();earlier=(datetime.now(timezone.utc)-timedelta(days=2)).isoformat(timespec='milliseconds').replace('+00:00','Z')
            c.add(normalize('api','old',earlier,'old'));c.add(normalize('scratch','new',later,'new'));c.status('scratch','ok');c.publish()
            cat=json.loads((c.store/'catalog.json').read_text());source=cat['sources'][0]
            self.assertEqual((source['retainedFrom'],source['retainedTo']),(later,later))
            self.assertEqual(cat['segments'][0]['schema'],2);self.assertIn('sha256',cat['segments'][0]);c.db.close()

    def test_short_file_rewrite_is_collected_as_a_new_generation(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);file=root/'test.log';file.write_text('ERROR first\n')
            c=Collector(root,{'includeDockerDesktop':False,'fileSources':[{'source':'test','path':str(file)}]})
            c.files();file.write_text('ERROR other\n');c.files();c.files()
            self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0],2);c.db.close()

    def test_explicit_severity_and_status_override_incidental_error_words(self):
        for value, expected in [(40, 'warn'), (50, 'error'), ('info', 'info'), ('debug', 'info'), ('ERROR', 'error')]:
            self.assertEqual(normalize('api', json.dumps({'level':value,'msg':'The error counter is zero'}), now(), str(value))['level'], expected)
        self.assertEqual(normalize('api', '{"path":"/errors","status":200}', now(), 'ok')['level'], 'info')
        self.assertEqual(normalize('api', '{"status":503}', now(), 'down')['level'], 'error')

    def test_file_json_timestamp_seconds_milliseconds_and_fallback(self):
        stamp = datetime.now(timezone.utc) - timedelta(days=2)
        expected = stamp.isoformat(timespec='milliseconds').replace('+00:00','Z')
        for raw in [json.dumps({'time':stamp.isoformat()}),json.dumps({'timestamp':stamp.isoformat()}),json.dumps({'ts':stamp.timestamp()}),json.dumps({'ts':int(stamp.timestamp()*1000)})]:
            self.assertEqual(file_timestamp(raw, now()), (expected, 'event'))
        fallback = now()
        for raw in ['{"time":"invalid"}', '{"ts":true}', '{"ts":1e30}', '{"time":"2099-01-01T00:00:00Z"}', 'no clock']:
            self.assertEqual(file_timestamp(raw, fallback), (fallback, 'file_mtime'))

    def test_rename_rotation_restart_and_new_file_preserve_occurrences(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'source';source.mkdir();file=source/'test.log'
            line=json.dumps({'time':now(),'level':'info','msg':'repeated'})+'\n'
            file.write_text(line+line,encoding='utf8')
            cfg={'includeDockerDesktop':False,'fileSources':[{'source':'test','path':str(source)}]}
            c=Collector(root,cfg);c.files();c.db.commit();c.db.close()
            file.rename(source/'test.log.1');file.write_text(line,encoding='utf8')
            c=Collector(root,cfg);c.files();c.db.commit();self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0],3)
            c.files();c.db.commit();self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0],3);c.db.close()

    def test_legacy_index_and_segments_upgrade_without_changing_ids(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);c=Collector(root,{});event=normalize('api','{"status":500}',now(),'kept');c.add(event);c.publish()
            meta=json.loads((c.store/'catalog.json').read_text())['segments'][0]
            # Recreate the prior private-index representation for upgrade coverage.
            c.set_state('index:version',1)
            c.db.execute('UPDATE events SET id=?,time=?,source=?,payload=?',(event['id'],event['time'],event['source'],json.dumps(event)))
            c.db.execute("UPDATE sqlite_sequence SET seq=777 WHERE name='events'")
            c.db.commit();c.db.close()
            c=Collector(root,{});self.assertIsNone(c.db.execute('SELECT payload FROM events').fetchone()[0]);c.reader_format=2;c.publish()
            catalog=json.loads((c.store/'catalog.json').read_text());self.assertEqual(sum(s['count'] for s in catalog['segments']),1)
            file=c.store/catalog['segments'][0]['file'];self.assertTrue(file.name.endswith('.gz'))
            self.assertEqual(json.loads(gzip.decompress(file.read_bytes()))['id'],event['id'])
            self.assertTrue((c.store/meta['file']).exists()) # old readers keep their immutable snapshot
            c.add(event);c.db.commit();self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0],1)
            c.add(normalize('api','after upgrade',now(),'next'));self.assertGreater(c.db.execute('SELECT max(seq) FROM events').fetchone()[0],777);c.db.close()

    def test_crash_after_segment_write_replay_retires_only_verified_prefix(self):
        with tempfile.TemporaryDirectory() as temp:
            c=Collector(Path(temp),{'retentionDays':3});c.reader_format=2
            old=(datetime.now(timezone.utc)-timedelta(days=2)).isoformat(timespec='milliseconds').replace('+00:00','Z')
            c.add(normalize('api','first',old,'first'))
            write=c.write_segment
            def interrupted(*args):
                write(*args);raise RuntimeError('simulated interruption')
            c.write_segment=interrupted
            with self.assertRaises(RuntimeError):c.publish()
            c.write_segment=write;c.config['retentionDays']=1;c.add(normalize('api','second',now(),'second'));c.publish()
            catalog=json.loads((c.store/'catalog.json').read_text());self.assertEqual(sum(s['count'] for s in catalog['segments']),2)
            self.assertEqual(len(catalog['segments']),1);self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0],2);c.db.close()

    def test_normalized_history_import_is_atomic_and_idempotent(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);c=Collector(root,{});event=normalize('scratch','retained',now(),'archive')
            event.update(requestId='private-value',revision='private-value',windowsRecordId='private-value',windowsEventId=True,timeBasis='private-value')
            archive=root/'old.zip'
            with zipfile.ZipFile(archive,'w') as z:
                z.writestr('manifest.json',json.dumps({'normalized':True,'count':1}))
                z.writestr('records/part-00001.jsonl',json.dumps(event)+'\n')
            c.import_history(archive);c.import_history(archive)
            self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0],1)
            imported=json.loads(gzip.decompress(c.db.execute('SELECT payload FROM events').fetchone()[0]));self.assertNotIn('private-value',json.dumps(imported))
            bad=root/'bad.zip'
            with zipfile.ZipFile(bad,'w') as z:
                z.writestr('manifest.json',json.dumps({'normalized':True,'count':2}))
                z.writestr('records/part-00001.jsonl',json.dumps(normalize('api','new',now(),'bad'))+'\n')
            with self.assertRaises(RuntimeError):c.import_history(bad)
            self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0],1);c.db.close()
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
            collector.reader_format=2
            # Random data stays large after compression and exercises real eviction.
            for i in range(400): collector.add(normalize('docker-desktop', secrets.token_hex(8000), now(), str(i)))
            app=normalize('scratch','important editor failure',now(),'protected');collector.add(app)
            collector.publish()
            catalog = json.loads((collector.store/'catalog.json').read_text())
            self.assertTrue(catalog['trimmed'])
            retained = sum(s['count'] for s in catalog['segments'])
            self.assertEqual(collector.db.execute('SELECT count(*) FROM events').fetchone()[0], retained)
            self.assertLessEqual(catalog['activeStorageBytes'], 3 * 1024 * 1024)
            kept=[json.loads(line) for s in catalog['segments'] for line in gzip.decompress((collector.store/s['file']).read_bytes()).decode().splitlines()]
            self.assertIn(app['id'],[e['id'] for e in kept])
            collector.db.close()


if __name__ == '__main__': unittest.main()
