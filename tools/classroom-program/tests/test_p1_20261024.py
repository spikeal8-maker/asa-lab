"""Regressions for exact-SHA Codex review, structured preflight and historical Issues."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import classroomctl as c
import github_queue as q
import verified_github as g


class RepairRegressionTest(unittest.TestCase):
    def test_successful_canonical_json_preflight_can_start(self):
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td)
            folder = repo / 'tools' / 'classroom-program'
            folder.mkdir(parents=True)
            (repo / 'docs/execution').mkdir(parents=True)
            (repo / 'AGENTS.md').write_text('policy', encoding='utf-8')
            (repo / 'docs/execution/current.yaml').write_text(
                'task:\n  id: CTRL-00\n', encoding='utf-8')
            sha = 'a' * 40
            payload = {
                'mode': 'SAFE_TO_START',
                'task': {'id': 'CTRL-00', 'status': 'in_progress'},
                'git': {'head': sha, 'origin_main': sha},
                'remote_refresh': {'status': 'PASS'},
                'control_plane': {'status': 'PASS'},
                'worktree_overlaps': [],
                'execution_blocking': [],
            }
            calls = []
            def runner(argv, **kwargs):
                calls.append(argv)
                if argv[0] == 'git':
                    return SimpleNamespace(returncode=0, stdout=sha+'\n', stderr='')
                self.assertEqual(
                    argv, ['pnpm','--silent','agent:preflight','--check','--json'])
                return SimpleNamespace(returncode=0, stdout=json.dumps(payload), stderr='')
            with patch.object(c.shutil, 'which', return_value='pnpm'), \
                 patch.object(c.subprocess, 'run', side_effect=runner):
                proof = c.trusted_preflight(folder, sha, {'id':'CTRL-00'})
            self.assertEqual(proof['verification'], 'EXECUTED_IN_CANONICAL_CHECKOUT')
            self.assertEqual(proof['selected_task'], 'CTRL-00')
            self.assertEqual(len(calls), 3)

    def test_preflight_blocks_mismatched_task_even_if_green(self):
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td)
            folder = repo / 'tools' / 'classroom-program'
            folder.mkdir(parents=True)
            (repo / 'docs/execution').mkdir(parents=True)
            (repo / 'AGENTS.md').write_text('policy', encoding='utf-8')
            (repo / 'docs/execution/current.yaml').write_text(
                'task:\n  id: CTRL-00\n', encoding='utf-8')
            sha = 'a' * 40
            payload = {
                'mode': 'SAFE_TO_START',
                'task': {'id': 'WRONG-TASK'},
                'git': {'head': sha, 'origin_main': sha},
                'remote_refresh': {'status': 'PASS'},
                'control_plane': {'status': 'PASS'},
                'worktree_overlaps': [],
                'execution_blocking': [],
            }
            def runner(argv, **kwargs):
                if argv[0] == 'git':
                    return SimpleNamespace(returncode=0, stdout=sha+'\n', stderr='')
                return SimpleNamespace(returncode=0, stdout=json.dumps(payload), stderr='')
            with patch.object(c.shutil, 'which', return_value='pnpm'), \
                 patch.object(c.subprocess, 'run', side_effect=runner):
                with self.assertRaisesRegex(c.ControlError, 'task'):
                    c.trusted_preflight(folder, sha, {'id':'CTRL-00'})

    def test_closed_accepted_issue_does_not_block_next_issue_creation(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            shutil.copy(ROOT/'registry.json', root/'registry.json')
            reg=c.registry(root)
            c.atomic_json(c.task_path(root, 'CTRL-00'),
                {'status':'ACCEPTED_MAIN','evidence':[],
                 'events':[],'integrated_sha':'a'*40})
            old_issue={'number':716,'state':'closed',
                       'body':'<!-- ASA-CLASSROOM-TASK:CTRL-00 -->',
                       'user':{'login':'spikeal8-maker'},
                       'updated_at':'2026-10-24T00:00:00Z'}
            sha='a'*40
            posts=[]
            def github(method,path,token,data=None):
                if path.endswith('/git/ref/heads/main'):
                    return {'object':{'sha':sha}}
                if 'issues?state=all' in path:
                    return [old_issue]
                if method=='POST' and path.endswith('/issues'):
                    posts.append(data)
                    return {'html_url':'https://github.com/spikeal8-maker/asa-lab/issues/999'}
                self.fail('Unexpected API call: '+path)
            with patch.object(q,'github_json',side_effect=github), \
                 patch.object(q,'checked_local_head',return_value=sha):
                result=q.run(root,'spikeal8-maker/asa-lab','token','create',715)
            self.assertEqual(result[0],'created')
            self.assertNotEqual(result[1],'CTRL-00')
            self.assertEqual(len(posts),1)
            self.assertIn('<!-- ASA-CLASSROOM-QUEUE:task=',posts[0]['body'])

    def test_latest_negative_codex_review_overrides_earlier_clean_and_human_approval(self):
        sha='a'*40
        clean={'code_review':{
            'commit_sha':sha,'status':'completed','has_any_findings':False,
            'has_unresolved_findings':False}}
        bad={'code_review':{
            'commit_sha':sha,'status':'completed','has_any_findings':True,
            'has_unresolved_findings':True}}
        def comment(id_,updated,state):
            return {'id':id_, 'updated_at':updated,
                    'user':{'login':'chatgpt-codex-connector[bot]'},
                    'body':'<!-- codex-review-state:v1 '+json.dumps(state)+' -->'}
        def github(path,token):
            if path.endswith('/reviews?per_page=100'):
                return [{'commit_id':sha,'state':'APPROVED',
                         'user':{'login':'independent-reviewer'}}]
            if path.endswith('/comments?per_page=100'):
                # A summary edited later has an earlier creation/id.
                return [comment(1,'2026-10-24T12:00:00Z',bad),
                        comment(2,'2026-10-24T11:00:00Z',clean)]
            self.fail('Unexpected API request: '+path)
        with patch.object(g,'github_json',side_effect=github):
            with self.assertRaisesRegex(g.RemoteProofError,'Latest'):
                g._get_reviews(999,sha,'executor',False,'test-token')

    def test_latest_clean_codex_state_allows_review(self):
        sha='a'*40
        clean={'code_review':{
            'commit_sha':sha,'status':'completed','has_any_findings':False,
            'has_unresolved_findings':False}}
        bad={'code_review':{
            'commit_sha':sha,'status':'completed','has_any_findings':True,
            'has_unresolved_findings':True}}
        def record(id_,updated,state):
            return {'id':id_,'updated_at':updated,
                    'user':{'login':'chatgpt-codex-connector[bot]'},
                    'body':'<!-- codex-review-state:v1 '+json.dumps(state)+' -->'}
        def github(path,token):
            if path.endswith('/reviews?per_page=100'):
                return []
            if path.endswith('/comments?per_page=100'):
                return [record(1,'2026-10-24T11:00:00Z',bad),
                        record(2,'2026-10-24T12:00:00Z',clean)]
            self.fail('Unexpected API request: '+path)
        with patch.object(g,'github_json',side_effect=github):
            g._get_reviews(999,sha,'executor',False,'test-token')


if __name__=='__main__':
    unittest.main()
