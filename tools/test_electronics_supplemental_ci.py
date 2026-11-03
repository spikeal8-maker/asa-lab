"""Offline public fixtures only. No Docker, network, application imports or host configuration."""
from copy import deepcopy
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
import electronics_supplemental_ci as guard

ROOT=Path(__file__).resolve().parents[1]
NEW_FILES=[guard.WORKFLOW,'tools/electronics_supplemental_ci.py',guard.RUNNER,guard.ENVELOPE,
    'tools/test_electronics_supplemental_ci.py','tools/test-electronics-supplemental-native.mjs',
    'docs/product/electronics/evidence/supplemental-native-qualification/README.md']
TRACKED_EVIDENCE=['reports/docker-backup-restore.json','reports/docker-health.json','reports/docker-persistence.json',
    'e2e/artifacts/synthetic.png','e2e/artifacts/synthetic/receipt.json']

def put(root,path,data):
    target=root/path;target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(data if isinstance(data,bytes) else data.encode());return target

class Transport(unittest.TestCase):
    def fixture(self,incompatible=False):
        temp=tempfile.TemporaryDirectory(prefix='asa-supplemental-contract-');self.addCleanup(temp.cleanup)
        root=Path(temp.name).resolve();self.assertTrue(root.is_relative_to(Path(tempfile.gettempdir()).resolve()))
        control=root/'control';control.mkdir()
        def git(where,*args):return subprocess.check_output(['git','-C',str(where),*args],stderr=subprocess.PIPE).decode().strip()
        git(control,'init','-q');git(control,'config','user.name','Offline fixture');git(control,'config','user.email','fixture@example.invalid')
        git(control,'config','core.autocrlf','false');git(control,'config','commit.gpgsign','false')
        if os.name=='posix':git(control,'config','core.filemode','true')
        (control/'.git/no-hooks').mkdir();git(control,'config','core.hooksPath',str(control/'.git/no-hooks'))
        for path in [*guard.COMPATIBILITY,*guard.FILES]:put(control,path,(ROOT/path).read_bytes())
        if incompatible:put(control,'compose.test.yaml',(ROOT/'compose.test.yaml').read_bytes()+b'\n# different historical transport\n')
        for path in TRACKED_EVIDENCE:put(control,path,b'\x89PNG\r\n\x1a\n' if path.endswith('.png') else '{}\n')
        put(control,'migrations/0300_synthetic.sql','-- no database execution\n');put(control,'product.txt','preserved\n')
        git(control,'add','.');git(control,'commit','-qm','accepted product fixture');candidate_sha=git(control,'rev-parse','HEAD')
        if incompatible:put(control,'compose.test.yaml',(ROOT/'compose.test.yaml').read_bytes())
        for path in NEW_FILES:put(control,path,(ROOT/path).read_bytes())
        git(control,'add','.');git(control,'commit','-qm','trusted workflow fixture');workflow_sha=git(control,'rev-parse','HEAD')
        git(control,'remote','add','origin','https://github.com/'+guard.REPOSITORY+'.git')
        git(control,'update-ref','refs/remotes/origin/main',workflow_sha)
        candidate=root/'candidate'
        subprocess.run(['git','clone','--no-hardlinks','--quiet',str(control),str(candidate)],check=True,capture_output=True)
        git(candidate,'checkout','--detach',candidate_sha);git(candidate,'remote','set-url','origin','https://github.com/'+guard.REPOSITORY+'.git')
        if os.name=='posix':git(candidate,'config','core.filemode','true')
        env=dict(GITHUB_REPOSITORY=guard.REPOSITORY,GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_JOB='browser',
            GITHUB_REF='refs/heads/main',GITHUB_WORKFLOW_REF=guard.REPOSITORY+'/'+guard.WORKFLOW+'@refs/heads/main',
            GITHUB_SHA=workflow_sha,GITHUB_WORKFLOW_SHA=workflow_sha,ASA_SUPPLEMENTAL_WORKFLOW_REVISION=workflow_sha,
            ASA_CANDIDATE_REVISION=candidate_sha,GITHUB_ACTIONS='true',RUNNER_ENVIRONMENT='github-hosted',RUNNER_OS='Linux',RUNNER_ARCH='X64')
        return root,control,candidate,env,git

    def test_ancestral_but_incompatible_candidate_is_not_silently_reconfigured(self):
        _,control,candidate,env,_=self.fixture(incompatible=True)
        guard.authorize(control,env)
        with self.assertRaisesRegex(ValueError,'INCOMPATIBLE_CANDIDATE_TRANSPORT'):
            guard.candidate_source(control,candidate,env)

    def test_actual_separate_git_histories_authorize_exact_older_main_candidate(self):
        root,control,candidate,env,git=self.fixture()
        authority=guard.candidate_source(control,candidate,env)
        self.assertNotEqual(authority['candidateRevision'],authority['workflowRevision'])
        temporary=root/'runner-temp';temporary.mkdir();envfile=put(root,'github-env','')
        source=guard.prepare(control,candidate,{**env,'RUNNER_TEMP':str(temporary),'GITHUB_ENV':str(envfile)})
        self.assertEqual(source['schema'],300)
        self.assertEqual(source['candidateRevision'],git(candidate,'rev-parse','HEAD'))
        self.assertIn('ASA_EXPECTED_SCHEMA_VERSION=300\n',envfile.read_text())
        self.assertEqual(git(candidate,'diff','--name-only'),'')
        guard.candidate_source(control,candidate,env,prepared=True)
        with self.assertRaises((ValueError,FileExistsError)):guard.prepare(control,candidate,{**env,'RUNNER_TEMP':str(temporary),'GITHUB_ENV':str(envfile)})

    def test_wrong_context_remote_mutable_input_or_non_main_commit_cannot_execute(self):
        _,control,candidate,env,git=self.fixture()
        for change in [{'GITHUB_REPOSITORY':'foreign/repo'},{'GITHUB_REF':'refs/heads/feature'},
            {'GITHUB_EVENT_NAME':'pull_request'},{'GITHUB_WORKFLOW_REF':env['GITHUB_WORKFLOW_REF']+'@evil'},
            {'GITHUB_JOB':'other'},{'RUNNER_ENVIRONMENT':'self-hosted'},{'GITHUB_ACTIONS':'false'},
            {'ASA_CANDIDATE_REVISION':'main'},{'ASA_CANDIDATE_REVISION':'a'*39},
            {'ASA_CANDIDATE_REVISION':'$(arbitrary-command)'},{'GITHUB_WORKFLOW_SHA':'b'*40}]:
            with self.subTest(change=change),self.assertRaises(ValueError):guard.authorize(control,{**env,**change})
        tree=git(control,'rev-parse','HEAD^{tree}')
        foreign=subprocess.check_output(['git','-C',str(control),'commit-tree',tree,'-m','non-main fixture'],stderr=subprocess.PIPE).decode().strip()
        with self.assertRaises(subprocess.CalledProcessError):guard.authorize(control,{**env,'ASA_CANDIDATE_REVISION':foreign})
        git(candidate,'remote','set-url','origin','https://github.com/foreign/repo.git')
        with self.assertRaisesRegex(ValueError,'NONCANONICAL_REMOTE'):guard.candidate_source(control,candidate,env)

    def test_candidate_changes_are_denied_and_actual_committed_controller_mutant_is_denied(self):
        _,control,candidate,env,git=self.fixture()
        put(candidate,'product.txt','foreign change\n')
        with self.assertRaisesRegex(ValueError,'SOURCE_DIRTY'):guard.candidate_source(control,candidate,env,prepared=True)
        put(candidate,'product.txt','preserved\n')
        put(control,guard.RUNNER,(ROOT/guard.RUNNER).read_bytes()+b"\nspawnSync('arbitrary-command',[]);\n")
        git(control,'add',guard.RUNNER);git(control,'commit','-qm','actual committed command mutant')
        changed=git(control,'rev-parse','HEAD');git(control,'update-ref','refs/remotes/origin/main',changed)
        with self.assertRaisesRegex(ValueError,'EXECUTABLE_CHANGED'):
            guard.authorize(control,{**env,'GITHUB_SHA':changed,'GITHUB_WORKFLOW_SHA':changed,'ASA_SUPPLEMENTAL_WORKFLOW_REVISION':changed})

    def test_models_and_built_identity_enforce_original_content_not_only_labels(self):
        baseline=guard.json.loads(guard.approved.RECEIPT.read_text())
        guard.approved.check_identities(baseline)
        baseline_reference=baseline['images']['postgres']['reference']
        original={'services':{'postgres':{'image':baseline_reference},'api':{'read_only':True}}}
        reference=guard.receipts()['images']['postgres']['reference']
        transported=deepcopy(original);transported['services']['postgres']['image']=reference
        guard.validate_models(deepcopy(original),deepcopy(transported),baseline_reference,reference)
        for mutate in [lambda x:x['services']['api'].update(read_only=False),lambda x:x['services']['api'].update(privileged=True),
                       lambda x:x['services'].update(foreign={}),lambda x:x['services']['postgres'].update(image='postgres:latest')]:
            changed=deepcopy(transported);mutate(changed)
            with self.assertRaises(ValueError):guard.validate_models(deepcopy(original),changed,baseline_reference,reference)
        wrong_baseline=deepcopy(original);wrong_baseline['services']['postgres']['image']='postgres:17.7-bookworm'
        with self.assertRaisesRegex(ValueError,'POSTGRES_IMAGE_CHANGED'):
            guard.validate_models(wrong_baseline,deepcopy(transported),baseline_reference,reference)
        digest='sha256:'+'a'*64;source={'candidateRevision':'b'*40,'images':{n:{'rootfs_diff_ids':[digest]} for n in ['node','caddy']}}
        images=[dict(Architecture='amd64',Os='linux',Id=digest,RootFS={'Layers':[digest]},Config={'Labels':{'org.opencontainers.image.revision':'b'*40}}) for _ in range(3)]
        guard.validate_images(images,source)
        for mutate in [lambda x:x[0]['RootFS'].update(Layers=[]),lambda x:x[0].update(Architecture='arm64'),
                       lambda x:x[1]['Config']['Labels'].update({'org.opencontainers.image.revision':'c'*40}),lambda x:x.pop()]:
            changed=deepcopy(images);mutate(changed)
            with self.assertRaises(ValueError):guard.validate_images(changed,source)

    def test_registered_workflow_has_only_encrypted_upload_and_distinct_checkouts(self):
        text=(ROOT/guard.WORKFLOW).read_text()
        self.assertIn('ref: ${{ github.workflow_sha }}',text);self.assertIn('ref: ${{ inputs.candidate_revision }}',text)
        self.assertLess(text.index('electronic'+'s_supplemental_ci.py authorize'),text.index('ref: ${{ inputs.candidate_revision }}'))
        self.assertLess(text.index('electronic'+'s_supplemental_ci.py prepare'),text.index('chmod 0777 '+guard.OUTPUT))
        self.assertNotIn('chmod -R',text)
        self.assertNotIn('mkdir -p e2e/artifacts',text)
        self.assertEqual(text.count('uses: actions/upload-artifact@v4'),1)
        self.assertIn('path: ${{ runner.temp }}/asa-electronics-supplemental.encrypted.json',text)
        self.assertIn('timeout-minutes: 50',text);self.assertNotIn('secrets.',text)
        self.assertNotIn('test_ci_image_transport.py --',text)
        self.assertIn(':/workspace/tools/run-electronics-supplemental-native.mjs:ro',text)

    def test_model_commands_share_the_registry_overlay_and_only_add_the_validated_override(self):
        overlay=Path('/synthetic-runner-temp/asa-electronics-postgres.yaml')
        original,transported=guard.model_arguments(overlay)
        base=['compose','-f','compose.yaml','-f','compose.test.yaml','-f','.github/compose.registry-ci.yaml']
        tail=['--profile','test','config','--format','json']
        self.assertEqual(original,base+tail)
        self.assertEqual(transported,base+['-f',str(overlay)]+tail)
        # The real source receipt chain proves this shared overlay changes only PostgreSQL image.
        effective=guard.receipts()
        baseline=json.loads(guard.approved.RECEIPT.read_text())
        self.assertEqual(set(effective['images']),set(baseline['images']))
        self.assertEqual(guard.approved.read(guard.approved.OVERLAY),
            'services:\n  postgres:\n    image: '+baseline['images']['postgres']['reference']+'\n')

    def test_prepared_candidate_cannot_change_tracked_evidence_or_other_source_bytes(self):
        root,control,candidate,env,_=self.fixture()
        temporary=root/'runner-temp';temporary.mkdir()
        guard.prepare(control,candidate,{**env,'RUNNER_TEMP':str(temporary),'GITHUB_ENV':str(put(root,'github-env',''))})
        for name in [*TRACKED_EVIDENCE,'product.txt','compose.yaml']:
            with self.subTest(path=name):
                path=candidate/name;original=path.read_bytes();path.write_bytes(original+b'changed')
                with self.assertRaisesRegex(ValueError,'CANDIDATE_SOURCE_DIRTY'):
                    guard.candidate_source(control,candidate,env,prepared=True)
                path.write_bytes(original)
        guard.candidate_source(control,candidate,env,prepared=True)

    @unittest.skipUnless(os.name=='posix','real executable-bit prefix requires POSIX; no platform or CI spoof')
    def test_real_git_old_recursive_prefix_fails_and_actual_fresh_directory_prefix_stays_clean(self):
        root,control,candidate,env,git=self.fixture()
        temporary=root/'runner-temp';temporary.mkdir()
        guard.prepare(control,candidate,{**env,'RUNNER_TEMP':str(temporary),'GITHUB_ENV':str(put(root,'github-env',''))})
        self.assertEqual(git(candidate,'config','core.filemode'),'true')
        before={name:(candidate/name).read_bytes() for name in TRACKED_EVIDENCE}
        subprocess.run(['chmod','-R','0777','e2e/artifacts','reports'],cwd=candidate,check=True,capture_output=True)
        self.assertTrue(set(TRACKED_EVIDENCE)<=set(git(candidate,'diff','--name-only').splitlines()))
        self.assertEqual(before,{name:(candidate/name).read_bytes() for name in TRACKED_EVIDENCE})
        with self.assertRaisesRegex(ValueError,'CANDIDATE_SOURCE_DIRTY'):
            guard.candidate_source(control,candidate,env,prepared=True)
        # Restore only synthetic fixture modes, never a repository or real evidence tree.
        for name in TRACKED_EVIDENCE:(candidate/name).chmod(0o644)
        self.assertEqual(git(candidate,'diff','--name-only'),'')
        text=(ROOT/guard.WORKFLOW).read_text()
        commands=re.findall(r'^        run: (chmod[^\n]+)$',text,re.M)
        self.assertEqual(commands,['chmod 0777 '+guard.OUTPUT])
        subprocess.run(commands[0].split(),cwd=candidate,check=True,capture_output=True)
        self.assertEqual((candidate/guard.OUTPUT).stat().st_mode&0o777,0o777)
        self.assertEqual((candidate/guard.OUTPUT/'source.json').stat().st_mode&0o777,0o644)
        self.assertEqual(git(candidate,'diff','--name-only'),'')
        guard.candidate_source(control,candidate,env,prepared=True)
        for name in [*TRACKED_EVIDENCE,'product.txt','compose.yaml']:
            with self.subTest(wrong_mode=name):
                path=candidate/name;path.chmod(0o755)
                with self.assertRaisesRegex(ValueError,'CANDIDATE_SOURCE_DIRTY'):
                    guard.candidate_source(control,candidate,env,prepared=True)
                path.chmod(0o644)
        guard.candidate_source(control,candidate,env,prepared=True)

    @unittest.skipUnless(os.name=='posix','descriptor permission contract requires POSIX')
    def test_fresh_proof_readability_is_explicit_even_with_private_child_umask(self):
        with tempfile.TemporaryDirectory(prefix='asa-supplemental-proof-mode-') as temporary:
            path=Path(temporary)/'proof.json'
            code=('import os,sys; from pathlib import Path; import electronics_supplemental_ci as g; '
                'os.umask(0o077); g.write(Path(sys.argv[1]),{"synthetic":True})')
            # Child-only umask, no CI/platform/environment spoof or nonfixture file access.
            subprocess.run([sys.executable,'-B','-c',code,str(path)],cwd=ROOT/'tools',check=True,capture_output=True)
            self.assertEqual(path.stat().st_mode&0o777,0o644)
            self.assertEqual(json.loads(path.read_text()),{'synthetic':True})

    def test_public_diagnostics_are_closed_phase_and_code_without_exception_payloads(self):
        sentinel='private-cookie-secret/raw/path?token=never-public'
        cases=[(ValueError('CANDIDATE_SOURCE_DIRTY'),'CANDIDATE_SOURCE_DIRTY'),
            (ValueError(sentinel),'INTERNAL_FAILURE'),(KeyError(sentinel),'PROOF_STRUCTURE_INVALID'),
            (json.JSONDecodeError(sentinel,sentinel,0),'PROOF_JSON_INVALID'),
            (OSError(sentinel),'IO_FAILED'),
            (subprocess.CalledProcessError(1,[sentinel],output=sentinel,stderr=sentinel),'COMMAND_FAILED')]
        class Unprintable(Exception):
            def __str__(self):raise AssertionError('exception payload must never be stringified')
        cases.append((Unprintable(sentinel),'INTERNAL_FAILURE'))
        for error,code in cases:
            with self.subTest(code=code):
                message=guard.blocked_message('models',error)
                self.assertIn('phase=models code='+code+';',message);self.assertNotIn(sentinel,message)
        self.assertIn('phase=unknown',guard.blocked_message(sentinel,ValueError(sentinel)))

if __name__=='__main__':unittest.main()
