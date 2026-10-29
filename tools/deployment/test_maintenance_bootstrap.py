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
    @unittest.skipIf(os.name=='nt','POSIX directory permissions')
    def test_bad_backup_mode_is_rejected_before_release_discovery(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);bad=root/'backups';bad.mkdir(mode=0o755);bad.chmod(0o755)
            install=Mock(root=root,state=root/'.asa',settings={},profile='production')
            with patch.object(manager,'doctor'),patch.object(manager,'clean_checkout'),patch.object(manager,'discover_release') as discover:
                with self.assertRaises(Blocked) as failure:manager.update(install)
                self.assertEqual(failure.exception.code,'BACKUP_PERMISSIONS');discover.assert_not_called()
            self.assertEqual(bad.stat().st_mode&0o777,0o755)
    @unittest.skipIf(os.name=='nt','POSIX symlink and mode checks')
    def test_backup_symlink_is_rejected_without_changing_target(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'.asa').mkdir();target=root/'target';target.mkdir();(root/'backups').symlink_to(target,target_is_directory=True)
            install=SimpleNamespace(root=root,state=root/'.asa',settings={},profile='production',project='test')
            with self.assertRaises(Blocked):manager.save_settings(install)
            self.assertFalse((root/'.asa/installation.json').exists())
class ExactReleaseCIReuseTests(unittest.TestCase):
    def test_nochange_reuses_only_a_successful_exact_release_receipt(self):
        cases = ('verified', 'missing_receipt', 'wrong_receipt', 'failed_receipt', 'new_release')
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                state = root / '.asa'
                state.mkdir()
                installed = {'revision': 'a'*40, 'schema': 279, 'images': {'api': 'pinned-api'}}
                release = dict(installed)
                if case == 'new_release':
                    release = {'revision': 'b'*40, 'schema': 280, 'images': {'api': 'pinned-new-api'}}
                (state / 'installed-release.json').write_text(json.dumps(installed))
                receipt = {'status': 'success', 'entryHttp': 'pass', 'selected': installed}
                if case == 'wrong_receipt':
                    receipt['selected'] = {'revision': 'c'*40, 'schema': 279, 'images': {'api': 'pinned-api'}}
                if case == 'failed_receipt':
                    receipt['status'] = 'failed_switch'
                if case != 'missing_receipt':
                    (state / 'last-operation.json').write_text(json.dumps(receipt))
                origin = 'http://127.0.0.1:4620'
                install = Mock(root=root, state=state, profile='production', settings={},
                               env={'ASA_UPDATE_ENTRY_ORIGIN': origin,
                                    'ASA_BLOCKS_PARENT_ORIGIN': origin,
                                    'ASA_BLOCKS_RUNTIME_ORIGIN': origin})
                install.readiness.return_value = {'revision': installed['revision'], 'schema': installed['schema']}
                install.identity.return_value = {'api': {'image': installed['images']['api']}}
                unavailable = Blocked('CI_UNAVAILABLE', 'GitHub temporarily unavailable.', 'Retry later.')
                with patch.object(manager, 'doctor'), patch.object(manager, 'clean_checkout'), \
                     patch.object(manager, 'backup_directory'), patch.object(manager, 'attest_editor_env'), \
                     patch.object(manager, 'discover_release', return_value=release), \
                     patch.object(manager, 'verify_embedded_entry_http'), \
                     patch.object(manager, 'assert_ci', side_effect=unavailable) as ci, \
                     patch.object(manager, 'fetch_images') as fetch:
                    if case == 'verified':
                        manager.update(install, check=True)
                        ci.assert_not_called()
                    else:
                        with self.assertRaises(Blocked) as caught:
                            manager.update(install, check=True)
                        self.assertEqual(caught.exception.code, 'CI_UNAVAILABLE')
                        ci.assert_called_once_with(release)
                    fetch.assert_not_called()


if __name__=='__main__':unittest.main()
