from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import classroomctl as c
import github_queue as q
import verified_github as g


class ClassroomSecurityGateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        shutil.copy(ROOT / "registry.json", self.root / "registry.json")
        self.reg = c.registry(self.root)
        self.sha = "a" * 40
        self.main = "b" * 40
        self.pr = 999
        self.facts = self._evidence()

    def _evidence(self):
        return {
            "source": {"sha": self.sha, "uri": "https://github.com/spikeal8-maker/asa-lab/commit/" + self.sha, "result": "PASS"},
            "focused": {"sha": self.sha, "uri": "https://github.com/spikeal8-maker/asa-lab/actions/runs/777", "result": "PASS"},
            "review": {"sha": self.sha, "uri": "https://github.com/spikeal8-maker/asa-lab/pull/" + str(self.pr), "result": "PASS"},
            "integration": {"sha": self.main, "uri": "https://github.com/spikeal8-maker/asa-lab/commit/" + self.main, "result": "PASS"},
        }

    def _mock_api(self, path, token):
        if path.endswith("/git/ref/heads/main"):
            return {"object": {"sha": self.main}}
        if "/compare/" in path:
            return {"status": "ahead", "behind_by": 0}
        if path.endswith("/pulls/999"):
            return {"merged_at": "2026-10-24T00:00:00Z",
                    "head": {"sha": self.sha}, "base": {"ref": "main", "repo": {"full_name": g.REPOSITORY}},
                    "user": {"login": "executor-bot"}, "body": "CTRL-00"}
        if path.endswith("/pulls/999/reviews?per_page=100"):
            return [{"state": "APPROVED", "commit_id": self.sha, "user": {"login": "independent-reviewer"}}]
        if path.endswith("/actions/runs/777"):
            return {"head_sha": self.sha, "conclusion": "success", "status": "completed",
                    "repository": {"full_name": g.REPOSITORY}, "name": "Classroom Program Controller Checks"}
        if path.endswith("/actions/runs/777/jobs?per_page=100"):
            return {"jobs": [{"name": "validate", "status": "completed", "conclusion": "success"}]}
        if path.endswith("/commits/" + self.sha + "/check-runs?per_page=100"):
            return {"check_runs": [{"name": s, "status": "completed", "conclusion": "success",
                                    "head_sha": self.sha} for s in (
                                    "Governance contracts", "Format lint types contracts build")]}
        raise AssertionError("Unexpected GH URL: " + path)

    def test_real_remote_attestation_with_independent_review_accepts(self):
        with patch.object(g, "github_json", side_effect=self._mock_api), patch.object(g, "token", return_value="fake-unit-token"):
            fact = g.verify_acceptance(self.reg, c.tasks_map(self.reg)["CTRL-00"], {}, self.main, self.sha, self.facts)
        self.assertEqual(fact["verified"], "GITHUB_API_VERIFIED")
        self.assertEqual(fact["pull_request"], 999)

    def test_wrong_source_SHA_or_failed_CI_blocks(self):
        def tampered(path, tok):
            value = self._mock_api(path, tok)
            if path.endswith("/actions/runs/777"):
                value["head_sha"] = "f" * 40
            return value
        with patch.object(g, "github_json", side_effect=tampered), patch.object(g, "token", return_value="fake-unit-token"):
            with self.assertRaisesRegex(g.RemoteProofError, "exact source SHA"):
                g.verify_acceptance(self.reg, c.tasks_map(self.reg)["CTRL-00"], {}, self.main, self.sha, self.facts)

    def test_missing_independent_approval_blocks(self):
        def unreviewed(path,tok):
            if path.endswith("/pulls/999/reviews?per_page=100"):
                return [{"state": "COMMENTED", "commit_id": self.sha, "user": {"login": "executor-bot"}}]
            if path.endswith("/issues/999/comments?per_page=100"):
                return []
            return self._mock_api(path,tok)
        with patch.object(g, "github_json", side_effect=unreviewed), patch.object(g, "token", return_value="fake-unit-token"):
            with self.assertRaisesRegex(g.RemoteProofError, "independent"):
                g.verify_acceptance(self.reg, c.tasks_map(self.reg)["CTRL-00"], {}, self.main, self.sha, self.facts)

    def test_wrong_main_snapshot_rejected(self):
        with patch.object(g, "github_json", side_effect=self._mock_api), patch.object(g, "token", return_value="fake-unit-token"):
            with self.assertRaisesRegex(g.RemoteProofError, "Main changed"):
                g.verify_acceptance(self.reg, c.tasks_map(self.reg)["CTRL-00"], {}, "c"*40, self.sha, self.facts)

    def test_unverified_owner_choice_does_not_activate_task(self):
        name = "desktop_grades"
        recorded={"choice":"compact_inline","evidence":"https://example.invalid/owner"}
        self.assertFalse(g.verify_owner_choice(name, recorded))
        valid_link = "https://github.com/spikeal8-maker/asa-lab/issues/715#issuecomment-123"
        recorded["evidence"] = valid_link
        with patch.object(g, "token", return_value="fake-unit-token"), patch.object(g, "github_json", return_value={
            "user":{"login":"untrusted-bot"},"html_url":valid_link,
            "body":"ASA-CLASSROOM-DECISION:desktop_grades=compact_inline"
        }):
            self.assertFalse(g.verify_owner_choice(name, recorded))
        g._verified_owner_comment.cache_clear()
        with patch.object(g, "token", return_value="fake-unit-token"), patch.object(g, "github_json", return_value={
            "user":{"login":"spikeal8-maker"},"html_url":valid_link,
            "body":"ASA-CLASSROOM-DECISION:desktop_grades=compact_inline"
        }):
            self.assertTrue(g.verify_owner_choice(name, recorded))

    def test_old_pass_after_fail_not_accepted_and_resume_cycle_clears(self):
        rr={"status":"IN_PROGRESS","cycle":1,"evidence":[
            {"kind":"review","sha":self.sha,"result":"PASS","cycle":1},
            {"kind":"review","sha":self.sha,"result":"FAIL","cycle":1},
        ]}
        self.assertIsNone(c.find_gate(rr, "review", self.sha))
        rr["cycle"]=2
        self.assertIsNone(c.find_gate(rr, "review", self.sha))
        rr["evidence"].append({"kind":"review","sha":self.sha,"result":"PASS","cycle":2})
        self.assertEqual(c.find_gate(rr, "review", self.sha)["cycle"],2)

    def test_fabricated_local_git_with_fake_urls_cannot_accept(self):
        repo=self.root/"fake_git"
        repo.mkdir()
        def git(*args):
            return subprocess.run(["git", "-C", str(repo), *args], check=True,
                                  capture_output=True, text=True).stdout.strip()
        git("init","-q")
        git("config","user.email","synthetic@example.invalid")
        git("config","user.name","Synthetic")
        (repo/"source.txt").write_text("synthetic",encoding="utf-8")
        git("add",".");git("commit","-q","-m","synthetic")
        sha=git("rev-parse","HEAD")
        git("update-ref","refs/remotes/origin/main",sha)
        rr=c.receipt(self.root,"CTRL-00")
        rr["status"]="IN_PROGRESS";rr["author"]="executor";rr["cycle"]=1
        for kind in ("source","focused","review","integration"):
            fact=c.create_evidence(kind,sha,"https://example.invalid/fake","PASS",
                "reviewer" if kind=="review" else "executor","")
            fact["cycle"]=1
            rr["evidence"].append(fact)
        c.atomic_json(c.task_path(self.root,"CTRL-00"),rr)
        class Args:
            id="CTRL-00"
            main_sha=sha
            repo_root=str(repo)
        with patch.dict(os.environ,{"GH_TOKEN":"","GITHUB_TOKEN":""}):
            with self.assertRaisesRegex(c.ControlError,"NOT VERIFIED"):
                c.cmd_accept(self.root,self.reg,Args)
        self.assertEqual(c.receipt(self.root,"CTRL-00")["status"],"IN_PROGRESS")

    def test_fabricated_preflight_file_not_executed(self):
        path=self.root/"preflight.txt"
        path.write_text("SAFE_TO_START\n",encoding="utf-8")
        self.assertTrue(c.preflight_ok(path))
        with self.assertRaisesRegex(c.ControlError,"канонического checkout"):
            c.trusted_preflight(self.root,self.sha,c.tasks_map(self.reg)["CTRL-00"])

    def test_queue_does_not_accept_existing_blocked_issue(self):
        with self.assertRaisesRegex(q.QueueError,"blocked task"):
            q.choose(ROOT,self.reg,{"UI-06":{"state":"open","number":999,
                "user":{"login":"github-actions[bot]"},
                "body":"<!-- ASA-CLASSROOM-QUEUE:task=UI-06;main="+"a"*40+" -->"}})

    def test_queue_rejects_untrusted_bootstrap_marker(self):
        with self.assertRaisesRegex(q.QueueError,"provenance"):
            q.choose(ROOT,self.reg,{"CTRL-00":{"state":"open","number":999,
                "user":{"login":"spikeal8-maker"}}})


if __name__=="__main__":
    unittest.main()
