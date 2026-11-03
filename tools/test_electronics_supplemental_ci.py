"""Offline public fixtures only. No Docker, network, application imports or host configuration."""
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import electronics_supplemental_ci as guard

ROOT=Path(__file__).resolve().parents[1]
NEW_FILES=[guard.WORKFLOW,'tools/electronics_supplemental_ci.py',guard.RUNNER,guard.ENVELOPE,
    'tools/test_electronics_supplemental_ci.py','tools/test-electronics-supplemental-native.mjs',
    'docs/product/electronics/evidence/supplemental-native-qualification/README.md']

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
        (control/'.git/no-hooks').mkdir();git(control,'config','core.hooksPath',str(control/'.git/no-hooks'))
        for path in [*guard.COMPATIBILITY,*guard.FILES]:put(control,path,(ROOT/path).read_bytes())
        if incompatible:put(control,'compose.test.yaml',(ROOT/'compose.test.yaml').read_bytes()+b'\n# different historical transport\n')
        for path in guard.MODE_REPORTS:put(control,path,'{}\n')
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
        original={'services':{'postgres':{'image':'postgres:17.7-bookworm'},'api':{'read_only':True}}}
        reference='mirror/postgres@sha256:'+'a'*64
        transported=deepcopy(original);transported['services']['postgres']['image']=reference
        guard.validate_models(deepcopy(original),deepcopy(transported),reference)
        for mutate in [lambda x:x['services']['api'].update(read_only=False),lambda x:x['services']['api'].update(privileged=True),
                       lambda x:x['services'].update(foreign={}),lambda x:x['services']['postgres'].update(image='postgres:latest')]:
            changed=deepcopy(transported);mutate(changed)
            with self.assertRaises(ValueError):guard.validate_models(deepcopy(original),changed,reference)
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
        self.assertLess(text.index('electronic'+'s_supplemental_ci.py prepare'),text.index('chmod -R 0777'))
        self.assertEqual(text.count('uses: actions/upload-artifact@v4'),1)
        self.assertIn('path: ${{ runner.temp }}/asa-electronics-supplemental.encrypted.json',text)
        self.assertIn('timeout-minutes: 50',text);self.assertNotIn('secrets.',text)
        self.assertNotIn('test_ci_image_transport.py --',text)
        self.assertIn(':/workspace/tools/run-electronics-supplemental-native.mjs:ro',text)

if __name__=='__main__':unittest.main()
