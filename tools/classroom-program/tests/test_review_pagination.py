"""Bounded review pagination and post-bootstrap controller CI regressions."""
from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import classroomctl as ctl
import github_queue as queue
import verified_github as gh

REVIEW_PATH = "/repos/spikeal8-maker/asa-lab/pulls/999/reviews?per_page=100"
COMMENT_PATH = "/repos/spikeal8-maker/asa-lab/issues/999/comments?per_page=100"
SHA = "a" * 40
BOT = "chatgpt-codex-connector[bot]"


def bot_comment(identity, updated, *, findings=False):
    status = {"code_review": {
        "commit_sha": SHA, "status": "completed", "has_any_findings": findings,
        "has_unresolved_findings": findings,
    }}
    return {
        "id": identity, "updated_at": updated, "user": {"login": BOT},
        "body": "<!-- codex-review-state:v1 " + json.dumps(status) + " -->",
    }


def human_review(identity, state, who="independent"):
    return {
        "id": identity, "commit_id": SHA, "state": state,
        "user": {"login": who}, "submitted_at": f"2026-10-24T00:{identity % 60:02d}:00Z",
    }


class PaginatedIndependentReviews(unittest.TestCase):
    def fake_api(self, reviews, comments):
        def github_json(path, access_token):
            if path == REVIEW_PATH:
                return reviews[0]
            if path == REVIEW_PATH + "&page=2":
                return reviews[1] if len(reviews) > 1 else []
            if path == COMMENT_PATH:
                return comments[0]
            if path == COMMENT_PATH + "&page=2":
                return comments[1] if len(comments) > 1 else []
            self.fail("Unexpected GitHub pagination path: " + path)
        return github_json

    def test_approval_only_on_second_review_page_is_seen(self):
        first = [human_review(i, "COMMENTED", "commenter") for i in range(1, 101)]
        second = [human_review(101, "APPROVED")]
        with patch.object(gh, "github_json", side_effect=self.fake_api([first,second],[[]])):
            gh._get_reviews(999, SHA, "executor", False, "synthetic-token")

    def test_later_change_request_overrides_early_approval(self):
        first = [human_review(1, "APPROVED")] + [
            human_review(i, "COMMENTED") for i in range(2, 101)
        ]
        later = [human_review(101, "CHANGES_REQUESTED")]
        with patch.object(gh, "github_json", side_effect=self.fake_api([first,later],[[]])):
            with self.assertRaisesRegex(gh.RemoteProofError, "change requests"):
                gh._get_reviews(999, SHA, "executor", False, "synthetic-token")

    def test_later_negative_codex_comment_on_page_two_blocks_approval(self):
        reviews = [[human_review(1,"APPROVED")]]
        first = [bot_comment(1,"2026-10-24T01:00:00Z")] + [
            {"id":i, "body":"ordinary comment", "user":{"login":"anyone"}}
            for i in range(2,101)
        ]
        later = [bot_comment(101,"2026-10-24T02:00:00Z",findings=True)]
        with patch.object(gh, "github_json", side_effect=self.fake_api(reviews,[first,later])):
            with self.assertRaisesRegex(gh.RemoteProofError,"Latest exact-SHA"):
                gh._get_reviews(999, SHA, "executor", False, "synthetic-token")

    def test_newer_clean_codex_review_is_allowed_only_when_all_pages_read(self):
        old = [bot_comment(1,"2026-10-24T01:00:00Z",findings=True)] + [
            {"id":i,"body":"ordinary"} for i in range(2,101)
        ]
        new = [bot_comment(101,"2026-10-24T02:00:00Z")]
        with patch.object(gh, "github_json", side_effect=self.fake_api([[]],[old,new])):
            gh._get_reviews(999,SHA,"executor",False,"synthetic-token")

    def test_author_cannot_self_approve_on_later_page(self):
        first=[human_review(i,"COMMENTED","reviewer") for i in range(1,101)]
        second=[human_review(101,"APPROVED","executor")]
        with patch.object(gh, "github_json", side_effect=self.fake_api([first,second],[[]])):
            with self.assertRaisesRegex(gh.RemoteProofError,"independent"):
                gh._get_reviews(999,SHA,"executor",False,"synthetic-token")

    def test_missing_later_page_is_fail_closed(self):
        first=[bot_comment(1,"2026-10-24T01:00:00Z")] + [
            {"id":i,"body":"ordinary"} for i in range(2,101)
        ]
        def api(path,access_token):
            if path==REVIEW_PATH:return []
            if path==COMMENT_PATH:return first
            if path==COMMENT_PATH+"&page=2":
                raise gh.RemoteProofError("Simulated GitHub second page failure")
            self.fail(path)
        with patch.object(gh,"github_json",side_effect=api):
            with self.assertRaisesRegex(gh.RemoteProofError,"second page failure"):
                gh._get_reviews(999,SHA,"executor",False,"synthetic-token")

    def test_malformed_second_page_and_duplicates_rejected(self):
        hundred=[{"id":i} for i in range(1,101)]
        with patch.object(gh,"github_json",side_effect=self.fake_api([hundred,{"items":[]}],[[]])):
            with self.assertRaisesRegex(gh.RemoteProofError,"malformed"):
                gh.github_all_pages(REVIEW_PATH,"synthetic-token")
        with patch.object(gh,"github_json",side_effect=self.fake_api([hundred,[{"id":2}]],[[]])):
            with self.assertRaisesRegex(gh.RemoteProofError,"Duplicate"):
                gh.github_all_pages(REVIEW_PATH,"synthetic-token")

    def test_exact_page_bound_rejects_unknown_following_page(self):
        hundred=[{"id":i} for i in range(1,101)]
        next_hundred=[{"id":i} for i in range(101,201)]
        with patch.object(gh,"github_json",side_effect=self.fake_api([hundred,next_hundred],[[]])):
            with self.assertRaisesRegex(gh.RemoteProofError,"limit reached"):
                gh.github_all_pages(REVIEW_PATH,"synthetic-token",max_pages=2)

    def test_read_only_first_page_returns_without_extra_requests(self):
        with patch.object(gh,"github_json",return_value=[human_review(1,"APPROVED")]) as request:
            gh.github_all_pages(REVIEW_PATH,"synthetic-token")
        request.assert_called_once_with(REVIEW_PATH,"synthetic-token")


class WorkflowBeyondBootstrap(unittest.TestCase):
    def test_initial_ready_then_next_after_accepted_ctrl00(self):
        with tempfile.TemporaryDirectory() as td:
            directory=Path(td)
            shutil.copy(ROOT/"registry.json",directory/"registry.json")
            registry=ctl.registry(directory)
            bootstrap=[t["id"] for t in registry["tasks"] if ctl.status(directory,registry,t)=="READY"]
            self.assertEqual(bootstrap,["CTRL-00"])
            ctl.atomic_json(ctl.task_path(directory,"CTRL-00"),{
                "status":"ACCEPTED_MAIN","events":[],"evidence":[],
                "integrated_sha":SHA})
            advanced=[t["id"] for t in registry["tasks"] if ctl.status(directory,registry,t)=="READY"]
            self.assertNotIn("CTRL-00",advanced)
            self.assertTrue(advanced)
            old_issue={"number":716,"state":"closed","body":"<!-- ASA-CLASSROOM-TASK:CTRL-00 -->",
                       "user":{"login":"spikeal8-maker"}}
            state,next_id,_=queue.choose(directory,registry,{"CTRL-00":old_issue})
            self.assertEqual(state,"ready")
            self.assertEqual(next_id,sorted(advanced)[0])

    def test_real_pnpm_silent_launcher_emits_only_json(self):
        pnpm=shutil.which("pnpm.cmd" if sys.platform=="win32" else "pnpm")
        node=shutil.which("node")
        if not pnpm or not node:
            self.skipTest("pnpm + node unavailable on this Python-only runner")
        with tempfile.TemporaryDirectory() as td:
            folder=Path(td)
            (folder/"package.json").write_text(
                json.dumps({"private":True,"scripts":{"agent:preflight":"node emit.js"}}),
                encoding="utf-8")
            (folder/"emit.js").write_text(
                'const ok=!process.argv.includes("--negative");'
                'console.log(JSON.stringify({mode:ok?"SAFE_TO_START":"BLOCKED_EXECUTION",'
                'task:{id:"CTRL-00"},git:{head:"a".repeat(40)}}));'
                'if(!ok) process.exit(2);', encoding="utf-8")
            for extra,expected in [((),0),(("--negative",),2)]:
                proc=subprocess.run(
                    [pnpm,"--silent","agent:preflight","--check","--json",*extra],
                    cwd=folder,text=True,capture_output=True,timeout=30,encoding="utf-8")
                self.assertEqual(proc.returncode,expected,proc.stderr)
                parsed=json.loads(proc.stdout)
                self.assertEqual(parsed["mode"],"SAFE_TO_START" if expected==0 else "BLOCKED_EXECUTION")
                self.assertTrue(proc.stdout.lstrip().startswith("{"),proc.stdout[:100])


if __name__ == "__main__":
    unittest.main()
