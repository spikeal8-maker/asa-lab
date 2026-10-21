import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch,Mock
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
import asa_manager as manager
from deployment.contracts import Blocked,read_env

class BootstrapTests(unittest.TestCase):
    def test_downgrade_stops_before_image_fetch(self):
        with tempfile.TemporaryDirectory() as folder:
            install=Mock(root=Path(folder),state=Path(folder)/'.asa',profile='production',env={},settings={})
            install.readiness.return_value={'revision':'b'*40,'schema':'0234'}
            with patch.object(manager,'doctor'),patch.object(manager,'clean_checkout'),patch.object(manager,'attest_editor_env'),patch.object(manager,'assert_ci'),patch.object(manager,'discover_release',return_value={'revision':'a'*40,'schema':225}),patch.object(manager,'fetch_images') as fetch:
                with self.assertRaises(Blocked) as failure:manager.update(install)
                self.assertEqual(failure.exception.code,'RELEASE_DOWNGRADE');fetch.assert_not_called()

    def test_fresh_production_credentials_pass_real_api_validator(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);manager.first_environment(root,'production');env=read_env(root/'.env')
            module=Path(__file__).resolve().parents[2]/'apps/api/src/credential-configuration.cjs'
            result=subprocess.run(['node','-e','require(process.argv[1]).validateCredentialConfiguration()',str(module)],env={**os.environ,**env,'NODE_ENV':'production'},capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr.decode())
            self.assertNotEqual(env['CLASSROOM_CODE_SECRET'],env['POSTGRES_PASSWORD'])
            self.assertNotEqual(json.loads(env['ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON']),json.loads(env['ASA_STUDENT_CODE_LOOKUP_KEYS_JSON']))
            original=(root/'.env').read_bytes()
            with self.assertRaises(Blocked):manager.first_environment(root,'production')
            self.assertEqual(original,(root/'.env').read_bytes())
    def test_custom_maintenance_configuration_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'.asa').mkdir();backup=root/'private-backups'
            old={'backupDirectory':str(backup),'window':{'custom':True},'instanceId':'a'*32}
            install=SimpleNamespace(root=root,state=root/'.asa',settings=old,profile='production',project='test')
            manager.save_settings(install,False)
            result=json.loads((root/'.asa/installation.json').read_text())
            self.assertTrue(backup.is_dir());self.assertEqual(result['instanceId'],old['instanceId']);self.assertEqual(result['window'],old['window'])
            if os.name!='nt':self.assertEqual(backup.stat().st_mode&0o777,0o700)
    @unittest.skipIf(os.name=='nt','POSIX symlink and mode checks')
    def test_backup_symlink_is_rejected_without_changing_target(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'.asa').mkdir();target=root/'target';target.mkdir();(root/'backups').symlink_to(target,target_is_directory=True)
            install=SimpleNamespace(root=root,state=root/'.asa',settings={},profile='production',project='test')
            with self.assertRaises(Blocked):manager.save_settings(install)
            self.assertFalse((root/'.asa/installation.json').exists())
if __name__=='__main__':unittest.main()
