"""Closed operational source tests; no Docker, provider, host configuration or live DB."""
import datetime as dt
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import operational as op
from deployment import backup
from deployment.system import Installation
from deployment import collector as lifecycle
from collect_logs import Collector, normalize, DATABASE_DIAGNOSTICS, now

SECRET = 'synthetic-private-prompt-key-url-path-user'


def event(**change):
    return {'version':1,'operation':'updates','status':'succeeded','producer':'manager','trigger':'manual','at':op.stamp(),**change}


def entries(c):
    return [json.loads(gzip.decompress(row[0])) for row in c.db.execute('SELECT payload FROM events WHERE payload IS NOT NULL')]


def sources(c):
    return {row['source']:row for row in (json.loads(r[0]) for r in c.db.execute('SELECT payload FROM sources'))}


class OperationalTests(unittest.TestCase):
    def test_published_real_school_producer_receipts_normalize_and_collect_without_errors(self):
        contract=json.loads((Path(__file__).parent/'fixtures/school-backup-success.json').read_text())
        self.assertEqual(contract['contract'],'asa-school-verified-cloud-receipt-v1')
        self.assertEqual(contract['producerRevision'],'8ae8d4bcd578bb05598ecb487b242772383d0ab3')
        self.assertEqual(contract['producerLfSha256'],'fda5db30f0d3d79384682c6e96c50b706dbc502d51de9fbb14785ccd3a0f35d5')
        self.assertEqual(set(contract['receipts']),{'manual','scheduled'})
        for trigger,receipt in contract['receipts'].items():
            with self.subTest(trigger=trigger), tempfile.TemporaryDirectory() as temp:
                observed=op.from_backup_receipt(receipt)
                self.assertEqual(observed,{'version':1,'operation':'backup','producer':'backup-receipt',
                    'status':'succeeded','trigger':'automatic' if trigger=='scheduled' else 'manual',
                    'at':'2026-11-01T00:20:00.000Z','archiveBytes':1024,'archiveSha256':'b'*64,'verification':'cloud_sha256'})
                c=Collector(Path(temp),{})
                try:
                    fresh_receipt={**receipt,'createdAt':op.stamp()}
                    with patch.object(op,'private_file',return_value=json.dumps(fresh_receipt).encode()):
                        op.backup_event(c,normalize,{'backupSuccessReceipt':'/operator/latest-success.json'})
                    self.assertEqual(sources(c)['operations:backup']['state'],'ok')
                    self.assertEqual(len(entries(c)),1)
                    self.assertNotIn(receipt['archive'],json.dumps(entries(c)))
                    self.assertNotIn(receipt['remote'],json.dumps(entries(c)))
                finally:c.db.close()

    def test_incomplete_success_receipts_never_create_green_evidence(self):
        with self.assertRaises(ValueError): op.from_manager_receipt({'status':'success','at':op.stamp(),'selected':{}})
        raw=('status=success\nupdated_at_utc='+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'\n').encode()
        with self.assertRaises(ValueError): op.from_source_receipt(raw)
        with self.assertRaises(ValueError): op.configuration({'operationalSources':{'backupSuccessReceipt':str(Path.cwd()/'folder'/'..'/'file')}})

    def test_actual_receipts_preserved_and_only_closed_scalar_events_append(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); state=root/'.asa'; state.mkdir()
            install=SimpleNamespace(root=root,state=state)
            receipt={'status':'success','trigger':'automatic','phase':'verify_entry','selected':{'revision':'a'*40,'schema':'286','endpoint':SECRET},'previous':{'revision':'b'*40},'entryOrigin':SECRET,'backup':SECRET,'payload':{'prompt':SECRET}}
            Installation.receipt(install,receipt)
            first=json.loads((state/'last-operation.json').read_text())
            self.assertEqual(first['entryOrigin'],SECRET)  # Existing private original was preserved.
            Installation.receipt(install,{**receipt,'status':'failed_switch'})
            recorded=[json.loads(line) for line in (state/'operations/events.jsonl').read_text().splitlines()]
            self.assertEqual([v['status'] for v in recorded],['succeeded','failed'])
            self.assertEqual(recorded[0]['revision'],'a'*40)
            self.assertEqual(recorded[0]['schema'],286)
            self.assertNotIn(SECRET,json.dumps(recorded))
            self.assertEqual(recorded[0]['trigger'],'automatic')
            if os.name!='nt': self.assertEqual(stat.S_IMODE((state/'operations/events.jsonl').stat().st_mode),0o600)

    def test_source_receipt_cli_reads_actual_shell_and_powershell_format(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); receipt=root/'update.receipt.txt'
            receipt.write_text('status=success\nupdated_at_utc='+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'\nprevious_revision='+'a'*40+'\ndeployed_revision='+'b'*40+'\nbackup_sha256='+'c'*64+'\nschema_version=286\nentry_origin='+SECRET+'\nbackup_path='+SECRET+'\n',encoding='utf-8')
            before=receipt.read_bytes()
            result=subprocess.run([sys.executable,str(Path(op.__file__)),'source-update','--root',str(root),'--receipt',str(receipt)],capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(receipt.read_bytes(),before)
            record=(root/'.asa/operations/events.jsonl').read_text()
            self.assertNotIn(SECRET,record+result.stdout+result.stderr)
            self.assertEqual(json.loads(record)['archiveSha256'],'c'*64)
            self.assertEqual(json.loads(record)['producer'],'source-updater')
            self.assertIn('tools/deployment/operational.py source-update',(Path(__file__).resolve().parents[1]/'docker-update.sh').read_text())
            self.assertIn('tools/deployment/operational.py source-update',(Path(__file__).resolve().parents[1]/'docker-update.ps1').read_text())

    def test_backup_outcome_uses_real_verified_manifest_summary_and_failure_has_no_invented_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); target=root/'owner-backup'; target.mkdir()
            manifest={'files':{SECRET:{'bytes':123,'sha256':'a'*64}},'private':SECRET}
            (target/'manifest.json').write_text(json.dumps(manifest))
            install=SimpleNamespace(root=root)
            with patch.object(backup,'_export_backup',return_value=target): self.assertEqual(backup.export_backup(install,trigger='automatic'),target)
            with patch.object(backup,'_export_backup',side_effect=RuntimeError(SECRET)), self.assertRaises(RuntimeError): backup.export_backup(install)
            values=[json.loads(line) for line in (root/'.asa/operations/events.jsonl').read_text().splitlines()]
            self.assertEqual([v['status'] for v in values],['succeeded','failed'])
            self.assertEqual(values[0]['verifiedPayloadBytes'],123)
            self.assertEqual(values[0]['manifestSha256'],hashlib.sha256((target/'manifest.json').read_bytes()).hexdigest())
            self.assertNotIn('manifestSha256',values[1]); self.assertNotIn(SECRET,json.dumps(values))
            self.assertTrue((target/'manifest.json').exists())

    def test_rotation_is_bounded_and_never_deletes_owner_backups(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); original=root/'owner.dump'; original.write_text(SECRET)
            with patch.object(op,'SEGMENT_BYTES',400):
                for index in range(20): op.append_operation(root,event(durationMs=index))
            files=list((root/'.asa/operations').glob('events.jsonl*'))
            self.assertLessEqual(len(files),5)
            self.assertTrue(all(p.stat().st_size<=400 for p in files))
            self.assertEqual(original.read_text(),SECRET)
            self.assertLessEqual(len(list((root/'.asa/operations').iterdir())),6)

    def test_symlink_hardlink_and_public_journal_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); op.append_operation(root,event())
            journal=root/'.asa/operations/events.jsonl'
            if os.name!='nt':
                journal.chmod(0o644)
                with self.assertRaises(ValueError): op.append_operation(root,event())
                journal.chmod(0o600)
            alias=root/'owner-hardlink'; os.link(journal,alias)
            with self.assertRaises(ValueError): op.append_operation(root,event())

    def test_empty_missing_failed_stale_and_replayed_operations_are_honest(self):
        with tempfile.TemporaryDirectory() as temp:
            c=Collector(Path(temp),{})
            try:
                op.operational_events(c,normalize,{})
                self.assertEqual(sources(c)['operations:updates']['state'],'pending')
                self.assertFalse((Path(temp)/'.asa/logs').exists())
                record=event(status='failed'); op.append_operation(Path(temp),record)
                op.operational_events(c,normalize,{}); op.operational_events(c,normalize,{})
                self.assertEqual(len(entries(c)),1)
                self.assertEqual(entries(c)[0]['level'],'error')
                self.assertEqual(sources(c)['operations:updates']['state'],'error')
                stale=event(at=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=8)).isoformat())
                c.set_state('operations:last:updates',stale)
                # A separate old-source fixture has no newer failure receipt.
                (Path(temp)/'.asa/operations/events.jsonl').unlink()
                op.operational_events(c,normalize,{})
                self.assertEqual(sources(c)['operations:updates']['state'],'pending')
                self.assertNotIn(SECRET,json.dumps(entries(c)))
            finally: c.db.close()

    def test_provider_projection_discards_all_strings_and_nested_private_fields(self):
        loaded={'models':[{'name':SECRET,'digest':SECRET,'size':123,'size_vram':100,'details':{'path':SECRET}}]}
        tags={'models':[{'name':SECRET,'modified_at':SECRET}]}
        sample=op.provider_sample('ollama',[loaded,tags])
        self.assertEqual(sample,{'availability':'reachable','loadedModels':1,'availableModels':1,'modelBytes':123,'vramBytes':100})
        comfy={'system':{'ram_total':1000,'ram_free':500,'argv':[SECRET],'username':SECRET},'devices':[{'type':'cuda','index':0,'name':SECRET,'vram_total':100,'vram_free':50,'path':SECRET}], 'prompt':SECRET}
        sample=op.provider_sample('comfyui',[comfy])
        self.assertEqual(sample['ramFreeBytes'],500)
        self.assertNotIn(SECRET,json.dumps(sample))
        with self.assertRaises(ValueError): op.provider_sample('comfyui',[{'system':{'ram_total':1,'ram_free':2},'devices':[]}])

    def test_ssrf_and_untrusted_config_are_rejected_before_network(self):
        for url in ['http://169.254.169.254','http://100.100.100.200','http://8.8.8.8','http://localhost:123','file:///etc/passwd','http://127.0.0.1:1/x','http://user:pass@127.0.0.1','http://127.0.0.1?'+SECRET,'http://127.0.0.1/#x','http://[fe80::1]','http://0.0.0.0']:
            with self.subTest(url=url), patch.object(op.http.client,'HTTPConnection') as connect, self.assertRaises(ValueError): op.fetch_json(url,'/api/ps')
            connect.assert_not_called()
        for config in [{'providers':{'foreign':{'origin':'http://127.0.0.1'}}}, {'providers':{'ollama':{'origin':'http://127.0.0.1','headers':{'Authorization':SECRET}}}}, {'providerIntervalSeconds':True},{'providerIntervalSeconds':301},{'backupSuccessReceipt':'relative'},{'unknown':SECRET}]:
            with self.subTest(config=config), self.assertRaises(ValueError): op.configuration({'operationalSources':config})
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'config'; path.write_text('{}'); path.chmod(0o644)
            with self.assertRaises(ValueError): op.configuration({'operationalSources':{'providers':{'ollama':{'origin':'http://127.0.0.1:11434'}}}},path)

    def test_http_is_get_only_bounded_and_never_follows_redirects(self):
        for status,length,body in [(302,'0',b''),(200,str(op.HTTP_BYTES+1),b''),(200,None,b'x'*(op.HTTP_BYTES+1))]:
            response=SimpleNamespace(status=status,getheader=lambda *_:length,read1=Mock(side_effect=[body,b'']))
            connection=Mock(); connection.getresponse.return_value=response
            with patch.object(op.http.client,'HTTPConnection',return_value=connection), self.assertRaises(ValueError): op.fetch_json('http://127.0.0.1:9999','/api/ps')
            self.assertEqual(connection.request.call_args.args,('GET','/api/ps'))
            self.assertEqual(connection.request.call_count,1)
            connection.close.assert_called_once()

    def test_absolute_deadline_terminates_a_trickling_body(self):
        terminated=threading.Event()
        def read(_):
            terminated.wait(1)
            raise socket.timeout(SECRET)
        connection=Mock(); protected=connection.sock
        protected.shutdown.side_effect=lambda *_:terminated.set()
        def response():
            connection.sock=None  # Real HTTP/1.0 or Connection: close detaches it.
            return SimpleNamespace(status=200,getheader=lambda *_:None,read1=read)
        connection.getresponse.side_effect=response
        started=time.monotonic()
        with patch.object(op,'HTTP_SECONDS',0.05), patch.object(op.http.client,'HTTPConnection',return_value=connection), self.assertRaises(OSError): op.fetch_json('http://127.0.0.1:9999','/api/ps')
        self.assertLess(time.monotonic()-started,0.5)
        self.assertTrue(terminated.is_set())

    def test_provider_failure_redaction_dedup_sampling_and_independent_source_health(self):
        with tempfile.TemporaryDirectory() as temp:
            c=Collector(Path(temp),{})
            config={'providers':{'ollama':{'origin':'http://127.0.0.1:11434'},'comfyui':{'origin':'http://127.0.0.1:8188'}}}
            def fetch(url,path):
                if path=='/system_stats': raise OSError(SECRET)
                return {'models':[],'prompt':SECRET}
            try:
                with patch.object(op,'fetch_json',side_effect=fetch) as network:
                    op.provider_events(c,normalize,config); op.provider_events(c,normalize,config)
                    self.assertEqual(network.call_count,3)
                self.assertEqual(sources(c)['provider:ollama']['state'],'ok')
                self.assertEqual(sources(c)['provider:comfyui']['state'],'error')
                self.assertNotIn(SECRET,json.dumps(entries(c))+json.dumps(sources(c)))
                self.assertEqual(len(entries(c)),2)
            finally: c.db.close()

    def test_typed_external_backup_receipt_and_missing_or_forged_input(self):
        value={'format':'asa-backup-success-v1','status':'succeeded','completedAt':op.stamp(),'archiveSha256':'a'*64,'archiveBytes':1024,'trigger':'automatic','remoteUrl':SECRET,'files':[SECRET]}
        self.assertNotIn(SECRET,json.dumps(op.from_backup_receipt(value)))
        legacy={'status':'verified_cloud_sha256','trigger':'manual','createdAt':op.stamp(),
                'archive':SECRET,'size':230876392,'sha256':'b'*64,'project':'asa-lab-school','remote':SECRET,'restore_rehearsal':{'path':SECRET}}
        observed=op.from_backup_receipt(legacy)
        self.assertEqual(observed['verification'],'cloud_sha256')
        self.assertEqual(observed['archiveBytes'],230876392)
        self.assertEqual(observed['archiveSha256'],'b'*64)
        self.assertNotIn(SECRET,json.dumps(observed))
        with self.assertRaises(ValueError): op.from_backup_receipt({**legacy,'status':'uploaded'})
        self.assertEqual(op.from_backup_receipt({**legacy,'trigger':'scheduled'})['trigger'],'automatic')
        self.assertEqual(observed['trigger'],'manual')
        for change in ({'trigger':'unknown'},{'trigger':'automatic'},{'trigger':SECRET},{'trigger':None},
                       {'project':SECRET},{'sha256':SECRET},{'size':True},{'size':0},
                       {'createdAt':'not-a-timestamp'},{'format':'unknown'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                op.from_backup_receipt({**legacy,**change})
        for trigger in ('manual','automatic','unknown'):
            self.assertEqual(op.from_backup_receipt({**value,'trigger':trigger})['trigger'],trigger)
        with self.assertRaises(ValueError):op.from_backup_receipt({**value,'trigger':'scheduled'})
        with self.assertRaises(ValueError):op.operation(event(trigger='scheduled'))
        for change in ({'archiveBytes':True},{'archiveBytes':0},{'archiveSha256':SECRET},{'status':'complete'},{'trigger':SECRET}):
            with self.assertRaises(ValueError): op.from_backup_receipt({**value,**change})
        with tempfile.TemporaryDirectory() as temp:
            c=Collector(Path(temp),{})
            try:
                with patch.object(op,'private_file',return_value=json.dumps(value).encode()) as private:
                    op.backup_event(c,normalize,{'backupSuccessReceipt':'/operator/success.json'})
                    self.assertTrue(private.call_args.kwargs['root_owned'])
                    self.assertEqual(sources(c)['operations:backup']['state'],'ok')
                with patch.object(op,'private_file',side_effect=OSError(SECRET)):
                    op.backup_event(c,normalize,{'backupSuccessReceipt':'/operator/success.json'})
                self.assertEqual(sources(c)['operations:backup']['state'],'error')
                self.assertNotIn(SECRET,json.dumps(entries(c))+json.dumps(sources(c)))
            finally: c.db.close()

    def test_manifest_is_nonempty_platform_pinned_and_configured_sources_cannot_disappear(self):
        config={'fileSources':[{'source':'school-ingress','path':'/operator/log'}],'operationalSources':{'providers':{'ollama':{'origin':'http://127.0.0.1:11434'}},'backupSuccessReceipt':str(Path.cwd()/'synthetic-backup.json')}}
        result=op.required_sources(config,DATABASE_DIAGNOSTICS['sources'],'linux')
        values={r['source']:r for r in result['sources']}
        for name in ['docker','metrics','database-events','operations:updates','operations:backup','provider:ollama','school-ingress','database-events:ai_image_jobs']:
            self.assertTrue(values[name]['applicable'])
        self.assertFalse(values['windows:Security']['applicable']); self.assertEqual(values['windows:Security']['reason'],'other-platform')
        self.assertTrue(values['linux:journal']['requireThrough'])
        self.assertEqual(result['auditMaxAgeSeconds'],900)
        self.assertTrue(all(type(r['maxAgeSeconds']) is int and type(r['requireThrough']) is bool for r in result['sources']))

    def test_unconfigured_backup_remains_declared_and_pending_until_a_verified_outcome(self):
        with tempfile.TemporaryDirectory() as temp:
            c = Collector(Path(temp), {})
            try:
                op.operational_events(c, normalize, {})
                c.publish()
                catalog = json.loads((c.store/'catalog.json').read_text())
                rule = next(row for row in catalog['requiredSources']['sources'] if row['source'] == 'operations:backup')
                source = next(row for row in catalog['sources'] if row['source'] == 'operations:backup')
                self.assertTrue(rule['applicable'])
                self.assertFalse(rule['requireThrough'])
                self.assertEqual(source['state'], 'pending')
                self.assertIsNone(source['lastCollectedAt'])
            finally:
                c.db.close()

    def test_ai_rows_are_closed_before_sql_stdout_and_reconciled_changes_do_not_expose_native_keys(self):
        with tempfile.TemporaryDirectory() as temp:
            c=Collector(Path(temp),{}); c.postgres='synthetic'
            captured=[]
            def query(args,*,sql,**_):
                captured.append(sql)
                # Bounded empty COPY page with completion trailer.
                return b'null,"{""count"":0,""more"":false}"\n'
            try:
                with patch.object(c,'command',side_effect=query): c.operational_database()
                self.assertEqual(len(captured),2)
                for sql in captured:
                    self.assertNotRegex(sql,r'SELECT\s+\*\s+FROM\s+public')
                    for forbidden in ['prompt','settings_snapshot','recipe','requested_model','actual_model','sha256','size_bytes','account_id','seat_id','thread_id']:
                        self.assertNotIn('"'+forbidden+'"',sql)
                self.assertEqual(sources(c)['database-events:ai_image_jobs']['state'],'ok')
                self.assertIsNotNone(sources(c)['database-events:ai_image_jobs']['collectedThrough'])
                at=now(); raw={'created_at':at,'owner_principal_id':SECRET,'request_id':'synthetic-native','image_state':'unknown','image_error_code':SECRET,'prompt':SECRET}
                c.add_database_row('ai_image_jobs',raw,{},at)
                c.add_database_row('ai_image_jobs',raw,{},at)
                raw={**raw,'image_state':'failed','image_error_code':'ai_image_provider_failed'}
                c.add_database_row('ai_image_jobs',raw,{},at)
                self.assertEqual(len(entries(c)),2)
                self.assertNotIn(SECRET,json.dumps(entries(c)))
                self.assertEqual(sorted(v['level'] for v in entries(c)),['error','warn'])
            finally:c.db.close()

if __name__=='__main__': unittest.main()
