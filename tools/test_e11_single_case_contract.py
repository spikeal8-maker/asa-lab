"""No Docker/Node dependencies: deny unknown CI pairs and source/workflow drift."""
import os
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch
import e11_single_case_contract as contract

ROOT = Path(__file__).resolve().parent.parent
ENV = {'GITHUB_REPOSITORY':'spikeal8-maker/asa-lab','GITHUB_JOB':'browser',
       'GITHUB_EVENT_NAME':'workflow_dispatch',
       'GITHUB_WORKFLOW_REF':'spikeal8-maker/asa-lab/'+contract.WORKFLOW+'@refs/heads/test/fixed',
       'GITHUB_SHA':'a'*40,'ASA_ELECTRONICS_EXPECTED_SHA':'a'*40}


class SingleCaseContract(unittest.TestCase):
    def test_existing_docker_guard_checks_the_new_pair_before_admitting_it(self):
        import test_ci_image_transport as transport
        with patch.object(transport,'require_ci_amd64'),patch.dict(os.environ,ENV,clear=True),patch.object(contract,'source_identity',return_value={'revision':'a'*40}) as source:
            transport.require_electronics_job(browser_only=True)
            source.assert_called_once()
            source.reset_mock()
            os.environ['GITHUB_JOB']='review-images'
            with self.assertRaises(ValueError):transport.require_electronics_job()
            source.assert_not_called()

    def test_exact_fixed_workflow_and_changed_command_are_distinct(self):
        raw=(ROOT/contract.WORKFLOW).read_bytes()
        contract.workflow_identity(raw)
        for old,new in [(b'node tools/run-e11-stopped-fit-390.mjs',b'pnpm arbitrary-command'),
                        (b'--no-deps migration',b'--no-deps migration || true'),
                        (b'workflow_dispatch: {}',b'workflow_dispatch: {inputs: {grep: {type: string}}}')]:
            self.assertIn(old,raw)
            with self.assertRaises(ValueError):contract.workflow_identity(raw.replace(old,new))

    def test_unknown_workflow_job_repository_ref_and_event_never_reach_source_or_docker(self):
        with patch.object(contract,'source_identity',return_value={'revision':'a'*40}) as source:
            self.assertEqual(contract.require_pair(ROOT,ENV),{'revision':'a'*40})
            source.reset_mock()
            for change in [{'GITHUB_JOB':'review-images'},{'GITHUB_REPOSITORY':'foreign/repo'},
                           {'GITHUB_EVENT_NAME':'pull_request'},
                           {'GITHUB_WORKFLOW_REF':ENV['GITHUB_WORKFLOW_REF'].replace('@refs/heads/','@refs/tags/')},
                           {'GITHUB_WORKFLOW_REF':ENV['GITHUB_WORKFLOW_REF'].replace('e11-stopped-fit-390','foreign')}]:
                with self.subTest(change=change),self.assertRaises(ValueError):contract.require_pair(ROOT,{**ENV,**change})
            source.assert_not_called()

    def test_only_additive_ci_paths_and_exact_clean_source_are_allowed(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'migrations').mkdir();(root/'migrations/0300_test.sql').write_text('-- metadata only')
            (root/contract.WORKFLOW).parent.mkdir(parents=True);(root/contract.WORKFLOW).write_bytes((ROOT/contract.WORKFLOW).read_bytes())
            (root/contract.RUNNER).parent.mkdir(parents=True);(root/contract.RUNNER).write_bytes((ROOT/contract.RUNNER).read_bytes())
            with patch.object(contract.subprocess,'run'),patch.object(contract.subprocess,'check_output',side_effect=['','a'*40,'tools/run-e11-stopped-fit-390.mjs']):
                self.assertEqual(contract.source_identity(root,ENV)['schema'],300)
            with patch.object(contract.subprocess,'run'),patch.object(contract.subprocess,'check_output',side_effect=['?? reports/e11-stopped-fit-390/source.json\0','a'*40,'tools/run-e11-stopped-fit-390.mjs']):
                self.assertEqual(contract.source_identity(root,ENV)['schema'],300)
            for replies in [['','b'*40],['dirty','a'*40],['?? injected.mjs\0','a'*40],[' M reports/e11-stopped-fit-390/tracked.json\0','a'*40],['','a'*40,'e2e/electronics-selection-outline.spec.ts'],
                            ['','a'*40,'migrations/0300_ai_image_durable_queue.sql'],['','a'*40,'']]:
                with patch.object(contract.subprocess,'run'),patch.object(contract.subprocess,'check_output',side_effect=replies),self.assertRaises(ValueError):
                    contract.source_identity(root,ENV)

    def test_actual_clean_committed_runner_mutations_are_rejected_with_unchanged_workflow(self):
        # A real Git fixture reproduces the reviewed bypass: allowed path, clean
        # new commit and unchanged workflow, but altered executable command bytes.
        with tempfile.TemporaryDirectory(prefix='e11-runner-negative-',dir=ROOT.parent) as folder:
            root=Path(folder).resolve()
            self.assertTrue(root.is_relative_to(ROOT.parent.resolve()))
            def git(*args):
                return subprocess.check_output(['git','-C',str(root),*args],text=True,stderr=subprocess.PIPE).strip()
            git('init','-q')
            git('config','user.name','Source fixture')
            git('config','user.email','fixture@example.invalid')
            git('config','commit.gpgsign','false')
            git('config','core.hooksPath',str(root/'.git/empty-hooks'))
            (root/'.git/empty-hooks').mkdir()
            (root/contract.WORKFLOW).parent.mkdir(parents=True)
            workflow=(ROOT/contract.WORKFLOW).read_bytes()
            (root/contract.WORKFLOW).write_bytes(workflow)
            (root/contract.RUNNER).parent.mkdir(parents=True)
            original=(ROOT/contract.RUNNER).read_bytes().replace(b'\r\n',b'\n')
            contract.runner_identity(original)
            for name,changed in [('arbitrary-command',original+b"\nspawnSync('arbitrary-command', []);\n"),
                                 ('retry-seven',original.replace(b'--retries=0',b'--retries=7'))]:
                self.assertNotEqual(changed,original)
                (root/contract.RUNNER).write_bytes(changed)
                git('add','.')
                git('commit','-qm',name)
                revision=git('rev-parse','HEAD')
                self.assertEqual(git('status','--porcelain'),'')
                self.assertEqual((root/contract.WORKFLOW).read_bytes(),workflow)
                with self.subTest(name=name),self.assertRaisesRegex(ValueError,'runner command/identity'):
                    contract.source_identity(root,{**ENV,'GITHUB_SHA':revision,'ASA_ELECTRONICS_EXPECTED_SHA':revision})


if __name__=='__main__':unittest.main()
