"""Synthetic current authority, never original receipt fabrication or live data."""
import contextlib
import copy
import gzip
import hashlib
import hmac
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from retired_successor_recovery import analyze, apply_metadata, verify_retirement_authority, RecoveryBlocked, encoded, sha


MANIFEST = 'f'*64
OLD = ['seg-0000000000000001-0000000000000004.jsonl.gz', 'seg-0000000000000005-0000000000000005.jsonl.gz']
NEW = 'seg-0000000000000100-0000000000000103.jsonl.gz'


class MemoryFiles:
    def __init__(self): self.files = {}; self.seen = {}
    def __call__(self, name, limit):
        data = self.files[name]
        if len(data) > limit: raise RecoveryBlocked('limit')
        old = self.seen.setdefault(name, sha(data))
        if old != sha(data): raise RecoveryBlocked('FILE_CAS_CHANGED')
        return data
    def revalidate(self):
        for name, digest in self.seen.items():
            if sha(self.files[name]) != digest: raise RecoveryBlocked('FILE_CAS_CHANGED')


class SuccessorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)/'index.sqlite'
        self.db = sqlite3.connect(self.path); self.addCleanup(self.db.close)
        self.db.executescript('CREATE TABLE events(seq INTEGER PRIMARY KEY,id UNIQUE,published INTEGER,payload); CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE segment_verification(name TEXT PRIMARY KEY,proof TEXT,metadata TEXT);')
        self.reader = MemoryFiles(); self.key = b'k'*32
        self.events = [dict(id=sha(str(i).encode()), time='2026-11-02T00:00:00.000Z', source='api', module='system', level='info', message='synthetic '+str(i)) for i in range(4)]
        self.lines = [json.dumps(e, ensure_ascii=False, separators=(',', ':')).encode() for e in self.events]
        for name, lines in zip(OLD, [self.lines[:3], self.lines[3:]]): self.put(name, lines)
        data, raw = self.put(NEW, self.lines)
        meta = dict(file=NEW, sha256=sha(raw), rawBytes=len(raw), bytes=len(data), count=4)
        self.reader.files['diagnostics/store/catalog.json'] = json.dumps({'segments':[meta], 'historyAudit':{'state':'error'}}).encode()
        self.reader.files['diagnostics/private/segment-verification.key'] = self.key
        mapping = hashlib.sha256()
        for i, e in enumerate(self.events):
            self.db.execute('INSERT INTO events VALUES(?,?,1,NULL)', (100+i, bytes.fromhex(e['id'])))
            mapping.update(str(100+i).encode()+b':'+bytes.fromhex(e['id']))
        text = json.dumps(meta)
        proof = hmac.new(self.key, (NEW+':'+sha(data)+':'+mapping.hexdigest()+':'+text).encode(), hashlib.sha256).hexdigest()
        self.db.execute('INSERT INTO segment_verification VALUES(?,?,?)', (NEW, proof, text))
        for k, v in [('retired:segments',{n:None for n in OLD}), ('retired:metadata',{}), ('preserved:error',{'state':'error'})]:
            self.db.execute('INSERT INTO state VALUES(?,?)',(k,json.dumps(v)))
        # Unpublished newer work must survive recovery unchanged.
        self.db.execute('INSERT INTO events VALUES(200,?,0,?)',(bytes.fromhex(sha(b'newer')),b'preserve unpublished'))
        self.db.commit()
    def put(self, name, lines):
        raw = b'\n'.join(lines)+b'\n'; data = gzip.compress(raw,mtime=0)
        self.reader.files['diagnostics/store/'+name] = data
        return data, raw
    def plan(self): return analyze(self.db, self.reader, MANIFEST)
    def rows(self, table): return self.db.execute('SELECT * FROM '+table+' ORDER BY 1').fetchall()

    def test_plan_reads_only_immutable_database_and_creates_no_sidecars(self):
        before = self.path.read_bytes(); files = sorted(p.name for p in self.path.parent.iterdir())
        with contextlib.closing(sqlite3.connect('file:'+self.path.as_posix()+'?mode=ro&immutable=1',uri=True)) as db:
            db.execute('PRAGMA query_only=ON'); result = analyze(db,self.reader,MANIFEST)
        self.assertEqual(result['records'],4)
        self.assertEqual(self.path.read_bytes(),before)
        self.assertEqual(sorted(p.name for p in self.path.parent.iterdir()),files)

    def test_operator_cli_requires_isolated_no_bytecode_python_before_import_or_io(self):
        script=Path(__file__).with_name('retired_successor_recovery.py')
        denied=subprocess.run([sys.executable,str(script),'--apply'],capture_output=True,text=True,timeout=10)
        self.assertNotEqual(denied.returncode,0)
        self.assertEqual(json.loads(denied.stdout)['code'],'ISOLATED_PYTHON_REQUIRED')
        help_result=subprocess.run([sys.executable,'-I','-B',str(script),'--help'],capture_output=True,text=True,timeout=10)
        self.assertEqual(help_result.returncode,0)
        self.assertIn('--manifest-sha256',help_result.stdout)

    def test_gapped_original_gets_separate_authority_without_original_mapping_or_hmac(self):
        before_events,before_receipts = self.rows('events'),self.rows('segment_verification')
        catalog = self.reader.files['diagnostics/store/catalog.json']; retired = self.db.execute("SELECT value FROM state WHERE key='retired:segments'").fetchone()
        expected = self.plan(); apply_metadata(self.db,self.reader,expected,MANIFEST)
        metadata = json.loads(self.db.execute("SELECT value FROM state WHERE key='retired:metadata'").fetchone()[0])
        for meta in metadata.values():
            verify_retirement_authority(meta,self.key)
            self.assertFalse(meta['retirementAuthority']['originalMappingRecovered'])
            self.assertEqual(meta['retirementAuthority']['kind'],'verified-successor-v1')
        self.assertEqual(metadata[OLD[0]]['count'],3) # Gapped filename range has four positions, never inferred.
        self.assertEqual(before_events,self.rows('events')); self.assertEqual(before_receipts,self.rows('segment_verification'))
        self.assertEqual(catalog,self.reader.files['diagnostics/store/catalog.json'])
        self.assertEqual(retired,self.db.execute("SELECT value FROM state WHERE key='retired:segments'").fetchone())
        self.assertEqual(json.loads(self.db.execute("SELECT value FROM state WHERE key='preserved:error'").fetchone()[0]),{'state':'error'})
        state = self.rows('state'); apply_metadata(self.db,self.reader,expected,MANIFEST)
        self.assertEqual(self.rows('state'),state)

    def test_absent_unpublished_or_ambiguous_current_ids_deny_entire_batch(self):
        for change in ('absent','unpublished','ambiguous'):
            with self.subTest(change=change):
                self.db.execute('SAVEPOINT negative')
                if change=='absent': self.db.execute('DELETE FROM events WHERE seq=100')
                elif change=='unpublished': self.db.execute('UPDATE events SET published=0 WHERE seq=100')
                else: self.db.execute('INSERT INTO events VALUES(300,?,1,NULL)',(self.events[0]['id'],))
                with self.assertRaises(RecoveryBlocked): self.plan()
                self.db.execute('ROLLBACK TO negative'); self.db.execute('RELEASE negative')

    def test_wrong_hmac_or_missing_successor_receipt_denies(self):
        for change in ('wrong','missing'):
            self.db.execute('SAVEPOINT negative')
            self.db.execute('UPDATE segment_verification SET proof=?',('0'*64,)) if change=='wrong' else self.db.execute('DELETE FROM segment_verification')
            with self.assertRaises(RecoveryBlocked): self.plan()
            self.db.execute('ROLLBACK TO negative'); self.db.execute('RELEASE negative')

    def test_wrong_key_changed_old_body_spacing_duplicate_id_and_partial_match_deny(self):
        original = copy.deepcopy(self.reader.files)
        for change in ('key','body','spacing','duplicate','partial','successor','line-ending'):
            with self.subTest(change=change):
                self.reader.files=copy.deepcopy(original); self.reader.seen={}
                lines=list(self.lines[:3])
                if change=='key': self.reader.files['diagnostics/private/segment-verification.key']=b'x'*32
                elif change=='body':
                    e={**self.events[0],'message':'tampered'}; lines[0]=json.dumps(e,separators=(',',':')).encode(); self.put(OLD[0],lines)
                elif change=='spacing': lines[0]=json.dumps(self.events[0]).encode(); self.put(OLD[0],lines)
                elif change=='duplicate': self.put(OLD[0],[lines[0],lines[0]])
                elif change=='partial':
                    e={**self.events[0],'id':sha(b'absent')}; lines[0]=json.dumps(e,separators=(',',':')).encode(); self.put(OLD[0],lines)
                elif change=='line-ending': self.reader.files['diagnostics/store/'+OLD[0]]=gzip.compress(b'\r\n'.join(lines)+b'\r\n',mtime=0)
                else: self.put(NEW,self.lines[:3])
                with self.assertRaises(RecoveryBlocked): self.plan()
        self.reader.files=original

    def test_changed_mapping_metadata_and_missing_active_segment_deny(self):
        self.db.execute('UPDATE events SET seq=104 WHERE seq=100')
        with self.assertRaises(RecoveryBlocked):self.plan()
        self.db.rollback();self.reader.seen={}
        self.reader.files['diagnostics/store/catalog.json']=b'{"segments":[]}'
        with self.assertRaises(RecoveryBlocked):self.plan()

    def test_apply_stale_or_replaced_body_has_no_metadata_writes(self):
        expected=self.plan();before=self.rows('state')
        self.reader.files['diagnostics/store/'+OLD[1]]+=b'changed'
        with self.assertRaises((RecoveryBlocked, OSError, EOFError)):apply_metadata(self.db,self.reader,expected,MANIFEST)
        self.assertEqual(self.rows('state'),before)

    def test_recompressed_predecessor_cannot_pass_the_forensic_cas(self):
        expected=self.plan();before=self.rows('state');self.reader.seen={}
        self.reader.files['diagnostics/store/'+OLD[0]]=gzip.compress(b'\n'.join(self.lines[:3])+b'\n',mtime=1)
        with self.assertRaisesRegex(RecoveryBlocked,'SUCCESSOR_CAS_CHANGED'):
            apply_metadata(self.db,self.reader,expected,MANIFEST)
        self.assertEqual(self.rows('state'),before)

    def test_any_transaction_fault_rolls_back_all_metadata_and_ledger(self):
        expected=self.plan();before=self.rows('state');real=self.db
        class Fault:
            def __getattr__(self,name):return getattr(real,name)
            def execute(self,sql,args=()):
                if args and args[0]=='retired:successor-recovery:v1':raise RuntimeError('synthetic precommit failure')
                return real.execute(sql,args)
        with self.assertRaises(RuntimeError):apply_metadata(Fault(),self.reader,expected,MANIFEST)
        self.assertEqual(self.rows('state'),before)

    def test_file_race_during_metadata_write_rolls_back_before_commit(self):
        expected=self.plan();before=self.rows('state'); original=self.reader.revalidate; calls=[]
        def raced():
            calls.append(1)
            if len(calls)==2:self.reader.files['diagnostics/store/'+OLD[1]]+=b'raced'
            original()
        self.reader.revalidate=raced
        with self.assertRaisesRegex(RecoveryBlocked,'FILE_CAS_CHANGED'):
            apply_metadata(self.db,self.reader,expected,MANIFEST)
        self.assertEqual(self.rows('state'),before)

    def test_state_trigger_cannot_mutate_events_or_clear_error_during_apply(self):
        expected=self.plan();before_events=self.rows('events');before_state=self.rows('state')
        self.db.execute("CREATE TRIGGER malicious_state AFTER INSERT ON state BEGIN DELETE FROM events; END")
        self.db.commit()
        with self.assertRaisesRegex(RecoveryBlocked,'STATE_WRITE_SIDE_EFFECTS'):
            apply_metadata(self.db,self.reader,expected,MANIFEST)
        self.assertEqual(self.rows('events'),before_events);self.assertEqual(self.rows('state'),before_state)

    def test_typed_proof_cannot_be_substituted_for_original_or_tampered(self):
        meta=next(iter(self.plan()['proposals'].values()))
        for value in ({**meta,'count':999},{**meta,'retirementAuthorityProof':'0'*64},
                      {**meta,'retirementAuthority':{'kind':'original'}}):
            with self.assertRaises(RecoveryBlocked):verify_retirement_authority(value,self.key)

    def test_forged_or_stripped_ledger_fails_before_retirement_use(self):
        from collect_logs import verify_successor_retirements
        expected=self.plan();apply_metadata(self.db,self.reader,expected,MANIFEST)
        metadata=json.loads(self.db.execute("SELECT value FROM state WHERE key='retired:metadata'").fetchone()[0])
        ledger=json.loads(self.db.execute("SELECT value FROM state WHERE key='retired:successor-recovery:v1'").fetchone()[0])
        verify_successor_retirements(dict.fromkeys(OLD),metadata,ledger,self.key)
        forged=copy.deepcopy(ledger);next(iter(forged.values()))['records']=999
        for bad in ({},forged):
            with self.assertRaisesRegex(RuntimeError,'successor authority is invalid'):
                verify_successor_retirements(dict.fromkeys(OLD),metadata,bad,self.key)

    def test_real_collector_restart_accepts_recovery_and_rejects_tampered_typed_authority(self):
        from collect_logs import Collector
        import test_retired_metadata_atomic as atomic
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); c=atomic.RetirementAtomicTests().fixture(root); c.publish()
            fresh='seg-0000000000000257-0000000000000257.jsonl.gz'
            metadata=c.state('retired:metadata'); metadata.pop(fresh)
            c.set_state('retired:metadata',metadata); c.db.commit()
            c.validate_history_index(); c.db.commit()
            reader=MemoryFiles()
            for path in (root/'.asa/diagnostics/store').iterdir():
                if path.is_file():reader.files['diagnostics/store/'+path.name]=path.read_bytes()
            reader.files['diagnostics/private/segment-verification.key']=c.verification_key
            expected=analyze(c.db,reader,MANIFEST)
            self.assertEqual(expected['files'],1)
            before=c.db.execute('SELECT seq,id,published FROM events ORDER BY seq').fetchall()
            apply_metadata(c.db,reader,expected,MANIFEST)
            c.db.close();c=Collector(root,{});c.reader_format=2;c.publish()
            self.assertEqual(before,c.db.execute('SELECT seq,id,published FROM events ORDER BY seq').fetchall())
            catalog=(c.store/'catalog.json').read_bytes()
            valid=copy.deepcopy(c.state('retired:metadata'))
            for strip in (False,True):
                metadata=copy.deepcopy(valid)
                if strip:
                    metadata[fresh].pop('retirementAuthorityProof');metadata[fresh].pop('retirementAuthority')
                else: metadata[fresh]['retirementAuthorityProof']='0'*64
                c.set_state('retired:metadata',metadata);c.db.commit()
                with self.assertRaisesRegex(RuntimeError,'successor authority is invalid'):c.publish()
                self.assertEqual(catalog,(c.store/'catalog.json').read_bytes());self.assertTrue((c.store/fresh).exists())
            c.db.close()

    def test_recovered_predecessor_gc_and_successor_recompaction_survive_cold_restart(self):
        from collect_logs import Collector, normalize, now, RETIRE_SECONDS
        import test_retired_metadata_atomic as atomic
        import time
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);c=atomic.RetirementAtomicTests().fixture(root);c.publish()
            fresh='seg-0000000000000257-0000000000000257.jsonl.gz'
            metadata=c.state('retired:metadata');metadata.pop(fresh);c.set_state('retired:metadata',metadata)
            c.db.commit();c.validate_history_index();c.db.commit()
            reader=MemoryFiles()
            for path in c.store.iterdir():
                if path.is_file():reader.files['diagnostics/store/'+path.name]=path.read_bytes()
            reader.files['diagnostics/private/segment-verification.key']=c.verification_key
            expected=analyze(c.db,reader,MANIFEST)
            successor=expected['proposals'][fresh]['retirementAuthority']['successors'][0]['file']
            apply_metadata(c.db,reader,expected,MANIFEST)
            # Represent an honestly elapsed grace period in synthetic state; no
            # production clock/retention limit is changed or bypassed.
            def expire():
                c.set_state('retired:segments',{n:time.time()-RETIRE_SECONDS-10 for n in c.state('retired:segments')});c.db.commit();c.publish()
            expire();self.assertFalse((c.store/fresh).exists())
            self.assertEqual(set(c.state('retired:metadata')),set(c.state('retired:segments')))
            metadata=c.state('segments')
            for i in range(30):
                event=normalize('api','later fixture',now(),'later-'+str(i));c.add(event)
                seq=c.db.execute('SELECT seq FROM events WHERE id=?',(bytes.fromhex(event['id']),)).fetchone()[0]
                meta=c.write_segment(f'seg-{seq:016d}-{seq:016d}.jsonl',[event]);metadata[meta['file']]=meta
            c.db.execute('UPDATE events SET published=1');c.set_state('segments',metadata);c.db.commit();c.publish()
            self.assertIn(successor,c.state('retired:segments'))
            expire();self.assertFalse((c.store/successor).exists())
            c.db.close();c=Collector(root,{});c.reader_format=2;c.publish()
            self.assertEqual(c.db.execute('SELECT count(*),count(distinct id) FROM events').fetchone(),(287,287))
            self.assertTrue(c.state('retired:successor-recovery:v1'));c.db.close()


if __name__=='__main__':unittest.main()
