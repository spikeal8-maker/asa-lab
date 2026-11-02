"""Optional actual PostgreSQL projection proof. Runs only in a disposable CI DB."""
import gzip
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
from collect_logs import Collector


@unittest.skipUnless(os.environ.get('ASA_OPERATIONAL_DATABASE_TEST')=='1','actual PostgreSQL belongs to explicit isolated CI')
class OperationalDatabaseTests(unittest.TestCase):
    def test_actual_sql_excludes_private_columns_and_observes_late_changes(self):
        container=os.environ.get('ASA_OPERATIONAL_TEST_CONTAINER','')
        self.assertRegex(container,r'^[a-zA-Z0-9_-]{1,100}$')
        args=['docker','exec','-i',container,'sh','-c','exec psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"']
        def sql(value):
            result=subprocess.run(args,input=value.encode(),capture_output=True,timeout=20)
            self.assertEqual(result.returncode,0,'isolated PostgreSQL fixture command failed')
            return result.stdout
        database=sql('SELECT current_database();').decode().strip()
        self.assertTrue(database.endswith('_test'))
        secret='synthetic-PRIVATE-prompt-secret-model-path'
        sql("""CREATE TABLE ai_image_jobs(owner_principal_id uuid,request_id uuid,created_at timestamptz,lease_until timestamptz,state varchar,error_code varchar,prompt text,settings_snapshot jsonb,recipe text,sha256 text,PRIMARY KEY(owner_principal_id,request_id));
CREATE TABLE ai_usage_journal(owner_principal_id uuid,request_id uuid,admitted_at timestamptz,started_at timestamptz,finished_at timestamptz,duration_ms bigint,operation varchar,provider varchar,status varchar,error_code varchar,requested_model text,actual_model text,PRIMARY KEY(owner_principal_id,request_id));
INSERT INTO ai_image_jobs VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now()-interval '2 days',NULL,'admitted',NULL,repeat('synthetic-PRIVATE-prompt-secret-model-path',100000),'{}','synthetic-PRIVATE-prompt-secret-model-path',NULL);
INSERT INTO ai_usage_journal VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now()-interval '2 days',NULL,NULL,NULL,'image','comfyui','admitted',NULL,'synthetic-PRIVATE-prompt-secret-model-path',NULL);
""")
        with tempfile.TemporaryDirectory() as temp:
            c=Collector(Path(temp),{}); c.postgres=container
            original=c.command; batches=[]
            def command(*args,**kwargs):
                value=original(*args,**kwargs); batches.append(value)
                self.assertNotIn(secret.encode(),value)
                self.assertLess(len(value),8192)
                return value
            c.command=command
            try:
                c.operational_database(); c.operational_database()
                self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0],2)
                sql("UPDATE ai_image_jobs SET state='failed',error_code='ai_image_provider_failed'; UPDATE ai_usage_journal SET status='failed',error_code='ai_image_provider_failed',started_at=now()-interval '10 seconds',finished_at=now(),duration_ms=10000;")
                c.operational_database()
                self.assertEqual(c.db.execute('SELECT count(*) FROM events').fetchone()[0],4)
                values=[json.loads(gzip.decompress(r[0])) for r in c.db.execute('SELECT payload FROM events')]
                self.assertNotIn(secret,json.dumps(values))
                self.assertEqual(sum(v['level']=='error' for v in values),2)
                for value in values:
                    self.assertIsNone(value['requestId'])
                    self.assertNotIn('aaaaaaaa',value['message'])
                health=[json.loads(r[0]) for r in c.db.execute('SELECT payload FROM sources')]
                self.assertTrue(all(s['state']=='ok' and s['collectedThrough'] for s in health))
            finally:c.db.close()

if __name__=='__main__':unittest.main()
