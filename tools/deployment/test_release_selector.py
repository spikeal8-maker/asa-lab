"""Immutable selection transport/continuation; all Docker/Git/CI calls are fakes."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager as manager
from deployment import releases
from deployment.contracts import Blocked, REGISTRY, SERVICES

DIGEST = 'sha256:' + 'c' * 64
REFERENCE = REGISTRY + '/deployment@' + DIGEST
IMAGE_ID = 'sha256:' + 'd' * 64


def manifest():
    return dict(format='asa-deployment-v2', repository='spikeal8-maker/asa-lab', revision='a'*40,
                schema=300, platform='linux/amd64', publicationRunId=123,
                images={s: REGISTRY+'/'+s+'@sha256:'+'b'*64 for s in SERVICES})


class Transport:
    def __init__(self, payload=None, digests=None):
        self.payload = manifest() if payload is None else payload
        self.digests = [REFERENCE] if digests is None else digests
        self.calls = []

    def __call__(self, args, **kwargs):
        self.calls.append(args)
        if args[:3] == ['docker', 'image', 'inspect']:
            return IMAGE_ID if args[-2] == '{{.Id}}' else json.dumps(dict(id=IMAGE_ID, digests=self.digests))
        if args[:2] == ['docker', 'create']:
            return 'synthetic-manifest-container'
        if args[:2] == ['docker', 'cp']:
            Path(args[-1]).write_text(json.dumps(self.payload), encoding='utf-8')
        return ''


class DiscoveryTests(unittest.TestCase):
    def test_exact_reference_and_local_id_pinned_before_extraction(self):
        transport = Transport()
        with patch.object(releases, 'run', side_effect=transport), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(releases.discover_release(DIGEST), manifest())
        self.assertEqual(transport.calls[0], ['docker', 'pull', REFERENCE])
        create = next(c for c in transport.calls if c[:2] == ['docker', 'create'])
        self.assertEqual(create[-2:], [IMAGE_ID, '/not-executed'])
        self.assertEqual(transport.calls[-1], ['docker', 'rm', 'synthetic-manifest-container'])
        self.assertFalse(any(':stable' in str(c) for c in transport.calls))

    def test_malformed_selector_denied_before_any_transport(self):
        for value in ('stable', 'latest', 'sha256:'+'A'*64, 'sha256:'+'a'*63,
                      REFERENCE, '/tmp/release.json', '{}', DIGEST+'\n', '', 7):
            with self.subTest(value=value), patch.object(releases, 'run') as run:
                with self.assertRaises(Blocked) as denied: releases.discover_release(value)
                self.assertEqual(denied.exception.code, 'RELEASE_SELECTOR'); run.assert_not_called()

    def test_wrong_repo_digest_denied_before_container_creation(self):
        for refs in ([], ['foreign/deployment@'+DIGEST], [REGISTRY+'/deployment@sha256:'+'e'*64]):
            transport = Transport(digests=refs)
            with patch.object(releases, 'run', side_effect=transport), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(Blocked) as denied: releases.discover_release(DIGEST)
            self.assertEqual(denied.exception.code, 'RELEASE_DIGEST_MISMATCH')
            self.assertFalse(any(c[:2] == ['docker', 'create'] for c in transport.calls))

    def test_manifest_validation_not_bypassed_and_container_cleaned(self):
        for key,value in (('repository','foreign/repo'),('schema',0),('publicationRunId',0),('images',{})):
            payload=manifest(); payload[key]=value; transport=Transport(payload)
            with patch.object(releases,'run',side_effect=transport), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(Blocked): releases.discover_release(DIGEST)
            self.assertEqual(transport.calls[-1],['docker','rm','synthetic-manifest-container'])

    def test_default_stable_transport_unchanged(self):
        transport=Transport()
        with patch.object(releases,'run',side_effect=transport),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(releases.discover_release(),manifest())
        self.assertEqual(transport.calls[0],['docker','pull',REGISTRY+'/deployment:stable'])
        self.assertEqual(transport.calls[1][-2:],[ '{{.Id}}', REGISTRY+'/deployment:stable'])


class ContinuationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name); self.current='b'*40; self.git_calls=[]
        self.install=SimpleNamespace(root=self.root,state=self.root/'.asa',profile='production',settings={},env={},
                                     readiness=Mock(return_value=dict(revision='b'*40,schema=286)),git=self.git)

    def git(self,*args):
        self.git_calls.append(args)
        if args==('remote','get-url','origin'):return 'https://github.com/spikeal8-maker/asa-lab.git'
        if args==('rev-parse','HEAD'):return self.current
        if args[0]=='diff':return 'tools/asa_manager.py'
        if args[0]=='switch':
            self.assertEqual(manager.pending_selection(self.install)['deploymentDigest'],DIGEST)
            self.current=args[-1]
        return ''

    def save_pending(self):
        self.install.state.mkdir(exist_ok=True)
        manager.private_atomic_json(self.install.state/'release-selection.json',manager.selection_record(DIGEST,manifest()))

    def checked_update(self, transport, **kwargs):
        with patch.object(manager,'doctor') as doctor, patch.object(manager,'clean_checkout'), \
             patch.object(manager,'backup_directory'), patch.object(manager,'attest_editor_env'), \
             patch.object(manager,'assert_ci') as ci, patch.object(releases,'run',side_effect=transport), \
             patch.object(manager,'fetch_images') as images, contextlib.redirect_stdout(io.StringIO()):
            manager.update(self.install,check=True,**kwargs)
        doctor.assert_called_once(); ci.assert_called_once_with(transport.payload); images.assert_not_called()

    def test_retry_checkpoint_written_before_switch_and_reused_with_fresh_ci(self):
        with patch.object(manager,'recovery_configuration',return_value={'synthetic':'old runtime'}), self.assertRaises(Blocked) as stopped:
            manager.selected_source(self.install,manifest(),existing=True,deployment_digest=DIGEST)
        self.assertEqual(stopped.exception.code,'RETRY_NEW_MANAGER')
        saved=(self.install.state/'release-selection.json').read_bytes()
        for _ in range(2):
            transport=Transport();self.checked_update(transport)
            self.assertEqual(transport.calls[0],['docker','pull',REFERENCE])
            self.assertEqual((self.install.state/'release-selection.json').read_bytes(),saved)
        self.assertIn(('merge-base','--is-ancestor','a'*40,'origin/main'),self.git_calls)
        self.assertIn(('merge-base','--is-ancestor','b'*40,'a'*40),self.git_calls)

    def test_different_explicit_pin_or_changed_manifest_cannot_replace_checkpoint(self):
        self.save_pending();before=(self.install.state/'release-selection.json').read_bytes()
        with patch.object(manager,'doctor') as doctor, self.assertRaises(Blocked) as denied:
            manager.update(self.install,check=True,deployment_digest='sha256:'+'e'*64)
        self.assertEqual(denied.exception.code,'RELEASE_SELECTION_PENDING');doctor.assert_not_called()
        altered=manifest();altered['schema']=301
        with patch.object(manager,'doctor'),patch.object(manager,'clean_checkout'),patch.object(manager,'backup_directory'), \
             patch.object(manager,'attest_editor_env'),patch.object(releases,'run',side_effect=Transport(altered)), \
             patch.object(manager,'assert_ci') as ci,contextlib.redirect_stdout(io.StringIO()),self.assertRaises(Blocked) as denied:
            manager.update(self.install,check=True)
        self.assertEqual(denied.exception.code,'RELEASE_SELECTION_MISMATCH');ci.assert_not_called()
        self.assertEqual((self.install.state/'release-selection.json').read_bytes(),before)

    def test_pending_pin_with_external_zero_arg_adapter_fails_before_mutation(self):
        self.save_pending();before=(self.install.state/'release-selection.json').read_bytes()
        with patch.object(manager,'discover_release',lambda:manifest()), patch.object(manager,'doctor') as doctor, \
             patch.object(manager,'fetch_images') as images, self.assertRaises(Blocked) as denied:
            manager.update(self.install)
        self.assertEqual(denied.exception.code,'RELEASE_SELECTOR_TRANSPORT')
        doctor.assert_not_called();images.assert_not_called()
        self.assertEqual((self.install.state/'release-selection.json').read_bytes(),before)

    def test_zero_arg_mcp_override_default_still_works(self):
        calls=[]
        def pinned():calls.append('zero-argument');return manifest()
        with patch.object(manager,'discover_release',pinned), patch.object(manager,'doctor'), \
             patch.object(manager,'clean_checkout'),patch.object(manager,'backup_directory'), \
             patch.object(manager,'attest_editor_env'),patch.object(manager,'assert_ci') as ci, \
             contextlib.redirect_stdout(io.StringIO()):manager.update(self.install,check=True)
        self.assertEqual(calls,['zero-argument']);ci.assert_called_once_with(manifest())
        self.assertFalse(self.install.state.exists())

    def test_ci_failure_on_retry_preserves_pin_and_never_fetches_target_images(self):
        self.save_pending();before=(self.install.state/'release-selection.json').read_bytes()
        with patch.object(manager,'doctor'),patch.object(manager,'clean_checkout'),patch.object(manager,'backup_directory'), \
             patch.object(manager,'attest_editor_env'),patch.object(releases,'run',side_effect=Transport()), \
             patch.object(manager,'assert_ci',side_effect=Blocked('CI_BLOCKED','not qualified','wait for exact CI')), \
             patch.object(manager,'fetch_images') as images,contextlib.redirect_stdout(io.StringIO()),self.assertRaises(Blocked):
            manager.update(self.install)
        images.assert_not_called();self.assertEqual((self.install.state/'release-selection.json').read_bytes(),before)

    def test_real_cli_parses_digest_and_external_tool_root_without_installation_edits(self):
        with patch.object(manager,'update') as update,contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(manager.main(['check','--root',str(self.root),'--profile','production','--deployment-digest',DIGEST]),0)
        install=update.call_args.args[0]
        self.assertEqual(install.root,self.root.resolve())
        self.assertEqual(update.call_args.kwargs,dict(check=True,scheduled=False,deployment_digest=DIGEST))
        self.assertFalse((self.root/'.asa').exists());self.assertFalse((self.root/'.env').exists())

    def test_cli_wrong_action_and_malformed_digest_rejected_before_installation(self):
        for argv in (['backup','--deployment-digest',DIGEST],['check','--deployment-digest','latest']):
            with patch.object(manager,'Installation') as install,contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(manager.main(argv),2)
            install.assert_not_called()

    def test_bad_checkpoint_denied_not_deleted(self):
        self.save_pending();path=self.install.state/'release-selection.json';path.write_text('{"format":"unknown"}',encoding='utf-8')
        before=path.read_bytes()
        with patch.object(manager,'doctor') as doctor,self.assertRaises(Blocked):manager.update(self.install,check=True)
        doctor.assert_not_called();self.assertEqual(path.read_bytes(),before)

    def test_checkpoint_flush_failure_stops_before_source_switch(self):
        with patch.object(manager,'recovery_configuration',return_value={'synthetic':'old runtime'}), \
             patch.object(manager,'sync_selection',side_effect=OSError('synthetic flush fault')), \
             self.assertRaises(OSError):
            manager.selected_source(self.install,manifest(),existing=True,deployment_digest=DIGEST)
        self.assertEqual(self.current,'b'*40)
        self.assertFalse(any(args[0]=='switch' for args in self.git_calls))
        self.assertEqual(manager.pending_selection(self.install)['deploymentDigest'],DIGEST)

    def test_verified_no_change_clears_only_exact_selection_after_reconcile(self):
        self.save_pending(); path=self.install.state/'release-selection.json'
        (self.install.state/'installed-release.json').write_text(json.dumps(manifest()),encoding='utf-8')
        self.install.readiness.return_value=dict(revision='a'*40,schema=300)
        self.install.identity=lambda: {s:{'image':ref} for s,ref in manifest()['images'].items()}
        def reconcile(install):self.assertTrue(path.exists())
        with patch.object(manager,'doctor'),patch.object(manager,'clean_checkout'),patch.object(manager,'backup_directory'), \
             patch.object(manager,'attest_editor_env'),patch.object(releases,'run',side_effect=Transport()), \
             patch.object(manager,'assert_ci'),patch.object(manager,'verify_embedded_entry_http'), \
             patch.object(manager,'collector_status',return_value={'state':'stale'}), \
             patch.object(manager,'prepare_collector',return_value={'readerGroupChanged':False}), \
             patch.object(manager,'Installation',return_value=self.install), \
             patch.object(manager,'reconcile_collector',side_effect=reconcile), \
             patch('deployment.operational.append_safely'),contextlib.redirect_stdout(io.StringIO()):
            self.install.env['ASA_UPDATE_ENTRY_ORIGIN']='https://example.test'
            manager.update(self.install)
        self.assertFalse(path.exists())

    def test_installed_exact_no_change_does_not_consume_github_quota(self):
        self.install.state.mkdir(exist_ok=True)
        (self.install.state/'installed-release.json').write_text(json.dumps(manifest()),encoding='utf-8')
        self.install.readiness.return_value=dict(revision='a'*40,schema=300)
        self.install.identity=lambda: {name:{'image':reference} for name,reference in manifest()['images'].items()}
        self.install.env['ASA_UPDATE_ENTRY_ORIGIN']='https://example.test'
        with patch.object(manager,'doctor'),patch.object(manager,'clean_checkout'), \
             patch.object(manager,'backup_directory'),patch.object(manager,'attest_editor_env'), \
             patch.object(manager,'discover_release',return_value=manifest()), \
             patch.object(manager,'collector_status',return_value={'state':'running'}), \
             patch.object(manager,'assert_ci',side_effect=Blocked('CI_UNAVAILABLE','rate limit','retry after quota reset')) as ci, \
             patch.object(manager,'verify_embedded_entry_http') as verify_entry, \
             patch.object(manager,'prepare_collector') as prepare, \
             patch.object(manager,'Installation',return_value=self.install), \
             patch.object(manager,'reconcile_collector') as reconcile, \
             patch.object(manager,'fetch_images') as images, \
             patch('deployment.operational.append_safely') as receipt, \
             contextlib.redirect_stdout(io.StringIO()) as output:
            manager.update(self.install)
        ci.assert_not_called()
        images.assert_not_called()
        verify_entry.assert_called_once_with('https://example.test','a'*40)
        reconcile.assert_not_called()
        prepare.assert_not_called()
        receipt.assert_called_once()
        self.assertIn('NO_CHANGE',output.getvalue())

    def test_ci_unavailable_still_blocks_actual_changes_check_and_stale_collector(self):
        self.install.state.mkdir(exist_ok=True)
        (self.install.state/'installed-release.json').write_text(json.dumps(manifest()),encoding='utf-8')
        self.install.readiness.return_value=dict(revision='a'*40,schema=300)
        self.install.env['ASA_UPDATE_ENTRY_ORIGIN']='https://example.test'
        for name,selected,collector,check in (
            ('new_revision',{**manifest(),'revision':'b'*40},'running',False),
            ('modified_manifest',{**manifest(),'publicationRunId':124},'running',False),
            ('check_requires_fresh_ci',manifest(),'running',True),
            ('stale_collector',manifest(),'stale',False),
        ):
            with self.subTest(name=name),patch.object(manager,'doctor'), \
                 patch.object(manager,'clean_checkout'),patch.object(manager,'backup_directory'), \
                 patch.object(manager,'attest_editor_env'), \
                 patch.object(manager,'discover_release',return_value=selected), \
                 patch.object(manager,'collector_status',return_value={'state':collector}), \
                 patch.object(manager,'assert_ci',side_effect=Blocked('CI_UNAVAILABLE','rate limit','retry after quota reset')) as ci, \
                 patch.object(manager,'prepare_collector') as prepare, \
                 patch.object(manager,'fetch_images') as images, \
                 contextlib.redirect_stdout(io.StringIO()),self.assertRaises(Blocked) as denied:
                manager.update(self.install,check=check)
            self.assertEqual(denied.exception.code,'CI_UNAVAILABLE')
            ci.assert_called_once_with(selected)
            prepare.assert_not_called()
            images.assert_not_called()

    def test_installed_same_source_with_image_drift_never_reports_no_change(self):
        self.install.state.mkdir(exist_ok=True)
        (self.install.state/'installed-release.json').write_text(json.dumps(manifest()),encoding='utf-8')
        self.install.readiness.return_value=dict(revision='a'*40,schema=300)
        self.install.identity=lambda: {name:{'image':'untrusted-image'} for name in manifest()['images']}
        with patch.object(manager,'doctor'),patch.object(manager,'clean_checkout'), \
             patch.object(manager,'backup_directory'),patch.object(manager,'attest_editor_env'), \
             patch.object(manager,'discover_release',return_value=manifest()), \
             patch.object(manager,'collector_status',return_value={'state':'running'}), \
             patch.object(manager,'assert_ci') as ci, \
             patch.object(manager,'prepare_collector') as prepare, \
             patch.object(manager,'fetch_images') as images, \
             contextlib.redirect_stdout(io.StringIO()),self.assertRaises(Blocked) as denied:
            manager.update(self.install)
        self.assertEqual(denied.exception.code,'IMAGE_DRIFT')
        ci.assert_not_called()
        prepare.assert_not_called()
        images.assert_not_called()

    def test_cli_pending_adapter_conflict_precedes_lock_and_collector_changes(self):
        self.save_pending()
        with patch.object(manager,'Installation',return_value=self.install), \
             patch.object(manager,'discover_release',lambda:manifest()), \
             patch.object(manager,'operation_lock') as lock,patch.object(manager,'select_root_mode') as select, \
             contextlib.redirect_stderr(io.StringIO()) as output:
            result=manager.main(['update','--root',str(self.root),'--collector-mode','system-root','--collector-reader-gid','1000'])
        self.assertEqual(result,2);self.assertIn('RELEASE_SELECTOR_TRANSPORT',output.getvalue())
        lock.assert_not_called();select.assert_not_called()


if __name__=='__main__':unittest.main()
