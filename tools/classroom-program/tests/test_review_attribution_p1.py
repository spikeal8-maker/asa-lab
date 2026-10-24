"""P1 control-plane regressions: latest review state and verified implementation authors."""
from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import classroomctl as controller
import verified_github as proof

CODE_SHA = "a" * 40
MAIN_SHA = "b" * 40
REVIEWS = "/repos/spikeal8-maker/asa-lab/pulls/999/reviews?per_page=100"
COMMENTS = "/repos/spikeal8-maker/asa-lab/issues/999/comments?per_page=100"
COMMITS = "/repos/spikeal8-maker/asa-lab/pulls/999/commits?per_page=100"


def review(identity, state, reviewer="reviewer"):
    item = {"id": identity, "commit_id": CODE_SHA, "state": state,
            "user": {"login": reviewer}}
    if state != "PENDING":
        item["submitted_at"] = f"2026-10-24T00:{identity % 60:02d}:00Z"
    return item


def comment(identity, findings=False):
    verdict = {"code_review": {
        "commit_sha": CODE_SHA, "status": "completed",
        "has_any_findings": findings, "has_unresolved_findings": findings}}
    return {"id": identity, "updated_at": "2026-10-24T07:00:00Z",
            "user": {"login": "chatgpt-codex-connector[bot]"},
            "body": "<!-- codex-review-state:v1 " + json.dumps(verdict) + " -->"}


class ReviewOrderingP1(unittest.TestCase):
    def call_with_pages(self, pages, comments=None, excluded=None):
        comments = comments if comments is not None else [[]]
        called = []
        def api(path, access_token):
            called.append(path)
            if path.startswith(REVIEWS):
                n = 0 if path == REVIEWS else int(path.split("&page=")[1]) - 1
                return pages[n] if n < len(pages) else []
            if path.startswith(COMMENTS):
                n = 0 if path == COMMENTS else int(path.split("&page=")[1]) - 1
                return comments[n] if n < len(comments) else []
            self.fail("Unexpected API path " + path)
        with patch.object(proof, "github_json", side_effect=api):
            proof._get_reviews(999, CODE_SHA, "controller", False, "fake-test-token",
                               implementation_authors=set(excluded or []))
        return called

    def test_new_pending_without_submitted_at_blocks_old_approval(self):
        with self.assertRaisesRegex(proof.RemoteProofError, "pending"):
            self.call_with_pages([[review(10,"APPROVED"),review(11,"PENDING")]])

    def test_reverse_review_response_uses_newer_pending_id(self):
        # The PENDING ID is newer even if API/order is unexpectedly reversed.
        with self.assertRaisesRegex(proof.RemoteProofError, "pending"):
            self.call_with_pages([[review(11,"PENDING"),review(10,"APPROVED")]])

    def test_partial_review_ids_are_invalid_and_fail_closed(self):
        old = review(10,"APPROVED")
        old.pop("id")
        with self.assertRaisesRegex(proof.RemoteProofError, "Invalid or missing"):
            self.call_with_pages([[old,review(11,"PENDING")]])

    def test_all_invalid_review_ids_fail_closed_even_when_order_reversed(self):
        for invalid in (None, 0, -7, "101"):
            with self.subTest(id=invalid):
                newer = review(11,"PENDING")
                older = review(10,"APPROVED")
                if invalid is None:
                    newer.pop("id")
                    older.pop("id")
                else:
                    newer["id"] = invalid
                    older["id"] = invalid - 1 if isinstance(invalid, int) else invalid + "-older"
                with self.assertRaisesRegex(proof.RemoteProofError, "Invalid or missing"):
                    self.call_with_pages([[newer,older]])

    def test_negative_security_verdict_blocks_a_standard_task(self):
        code = {"commit_sha":CODE_SHA,"status":"completed",
                "has_any_findings":False,"has_unresolved_findings":False}
        security = {"commit_sha":CODE_SHA,"status":"completed",
                    "has_any_findings":True,"has_unresolved_findings":True}
        state = {"code_review":code,"security_review":security}
        result = {"id":101,"updated_at":"2026-10-24T08:00:00Z",
                  "user":{"login":"chatgpt-codex-connector[bot]"},
                  "body":"<!-- codex-review-state:v1 "+json.dumps(state)+" -->"}
        with self.assertRaisesRegex(proof.RemoteProofError, "security"):
            self.call_with_pages([[]],comments=[[result]])

    def test_incomplete_security_verdict_blocks_a_standard_task(self):
        code = {"commit_sha":CODE_SHA,"status":"completed",
                "has_any_findings":False,"has_unresolved_findings":False}
        security = {"commit_sha":CODE_SHA,"status":"running",
                    "has_any_findings":None,"has_unresolved_findings":None}
        state = {"code_review":code,"security_review":security}
        result = {"id":102,"updated_at":"2026-10-24T08:01:00Z",
                  "user":{"login":"chatgpt-codex-connector[bot]"},
                  "body":"<!-- codex-review-state:v1 "+json.dumps(state)+" -->"}
        with self.assertRaisesRegex(proof.RemoteProofError, "incomplete"):
            self.call_with_pages([[]],comments=[[result]])

    def test_clean_security_verdict_accepted_for_standard_task(self):
        complete = {"commit_sha":CODE_SHA,"status":"completed",
                    "has_any_findings":False,"has_unresolved_findings":False}
        state = {"code_review":complete,"security_review":complete}
        result = {"id":103,"updated_at":"2026-10-24T08:02:00Z",
                  "user":{"login":"chatgpt-codex-connector[bot]"},
                  "body":"<!-- codex-review-state:v1 "+json.dumps(state)+" -->"}
        self.call_with_pages([[]],comments=[[result]])

    def test_second_page_pending_blocks_older_approval(self):
        first = [review(1,"APPROVED")] + [
            review(i,"COMMENTED","other-reviewer") for i in range(2,101)]
        second = [review(101,"PENDING")]
        with self.assertRaisesRegex(proof.RemoteProofError, "pending"):
            self.call_with_pages([first,second])

    def test_separate_reviewer_pending_blocks_other_approval(self):
        with self.assertRaisesRegex(proof.RemoteProofError, "pending"):
            self.call_with_pages([[
                review(10,"APPROVED","reader1"),
                review(11,"PENDING","reader2"),
            ]])

    def test_later_change_request_blocks_earlier_approval(self):
        with self.assertRaisesRegex(proof.RemoteProofError, "changes"):
            self.call_with_pages([[review(10,"APPROVED"),review(11,"CHANGES_REQUESTED")]])

    def test_pending_followed_by_new_approval_is_valid(self):
        called=self.call_with_pages([[
            review(10,"APPROVED"),review(11,"PENDING"),
            review(12,"APPROVED")]])
        self.assertIn(COMMENTS,called)

    def test_other_clean_approver_does_not_override_pending(self):
        with self.assertRaisesRegex(proof.RemoteProofError, "pending"):
            self.call_with_pages([[
                review(10,"APPROVED","reader1"),
                review(11,"PENDING","reader2"),
                review(12,"APPROVED","reader3"),
            ]])

    def test_multiple_approvers_one_independent_after_exclusions(self):
        called=self.call_with_pages([[
            review(10,"APPROVED","controller"),
            review(11,"APPROVED","executor"),
            review(12,"APPROVED","independent"),
        ]],excluded={"executor"})
        self.assertIn(COMMENTS,called)

    def test_all_approvers_are_actual_contributors_rejected(self):
        with self.assertRaisesRegex(proof.RemoteProofError, "independent"):
            self.call_with_pages([[
                review(10,"APPROVED","controller"),
                review(11,"APPROVED","executor"),
            ]],excluded={"executor"})

    def test_review_comment_second_page_failure_still_blocks(self):
        page1=[comment(1)] + [
            {"id":i,"body":"ordinary comment","user":{"login":"other"}}
            for i in range(2,101)]
        def api(path, access_token):
            if path==REVIEWS:return [review(1,"APPROVED")]
            if path==COMMENTS:return page1
            if path==COMMENTS+"&page=2":
                raise proof.RemoteProofError("incomplete Github review pagination")
            self.fail(path)
        with patch.object(proof,"github_json",side_effect=api):
            with self.assertRaisesRegex(proof.RemoteProofError,"incomplete"):
                proof._get_reviews(999,CODE_SHA,"controller",False,"synthetic-token")


class VerifiedImplementerP1(unittest.TestCase):
    def setUp(self):
        self.registry = controller.registry(ROOT)
        self.task = controller.tasks_map(self.registry)["CTRL-00"]
        self.evidence = {
            "source":{"uri":f"https://github.com/spikeal8-maker/asa-lab/commit/{CODE_SHA}"},
            "focused":{"uri":"https://github.com/spikeal8-maker/asa-lab/actions/runs/777"},
            "review":{"uri":"https://github.com/spikeal8-maker/asa-lab/pull/999"},
            "integration":{"uri":f"https://github.com/spikeal8-maker/asa-lab/commit/{MAIN_SHA}"},
        }
        self.approver="executor"
        self.implementation_author="executor"
        self.commit_author_authenticated=True
        self.receipt={}

    def api(self,path,token):
        if path.endswith("/git/ref/heads/main"):
            return {"object":{"sha":MAIN_SHA}}
        if "/compare/" in path:
            return {"status":"ahead","behind_by":0}
        if path.endswith("/pulls/999"):
            return {"merged_at":"2026-10-24T00:00:00Z",
                    "head":{"sha":CODE_SHA},"base":{"ref":"main","repo":{"full_name":proof.REPOSITORY}},
                    "user":{"login":"controller"},"body":"CTRL-00"}
        if path==COMMITS:
            return [{"sha":CODE_SHA,
                     "author":{"login":self.implementation_author} if self.commit_author_authenticated else None,
                     "committer":{"login":"controller"}}]
        if path==REVIEWS:
            return [review(5,"APPROVED",self.approver)]
        if path==COMMENTS:
            return []
        if path.endswith("/actions/runs/777"):
            return {"head_sha":CODE_SHA,"conclusion":"success","status":"completed",
                    "repository":{"full_name":proof.REPOSITORY},
                    "path":".github/workflows/classroom-controller.yml",
                    "name":"Classroom Program Controller Checks"}
        if path.endswith("/actions/runs/777/jobs?per_page=100"):
            steps = ["Validate requirements, dependencies and decisions",
                     "Run all controller regression tests",
                     "Rebuild registry and check deterministic output"]
            return {"total_count":1, "jobs":[
                {"name":"validate","conclusion":"success","status":"completed",
                 "steps":[{"name": step, "status":"completed","conclusion":"success"}
                          for step in steps]}]}
        if path.endswith("/commits/"+CODE_SHA+"/check-runs?per_page=100"):
            return {"check_runs":[
                {"name":name,"head_sha":CODE_SHA,"status":"completed","conclusion":"success","id":i+1}
                for i,name in enumerate(["Governance contracts","Format lint types contracts build"])
            ]}
        self.fail("Unexpected API path: "+path)

    def verify(self):
        with patch.object(proof,"github_json",side_effect=self.api), \
             patch.object(proof,"token",return_value="synthetic-token"):
            return proof.verify_acceptance(
                self.registry,self.task,self.receipt,MAIN_SHA,CODE_SHA,self.evidence
            )

    def test_implementation_executor_cannot_approve_controller_pr(self):
        self.approver="executor"
        with self.assertRaisesRegex(proof.RemoteProofError,"independent"):
            self.verify()

    def test_distinct_independent_reviewer_accepts(self):
        self.approver="independent-reviewer"
        result=self.verify()
        self.assertEqual(result["verified"],"GITHUB_API_VERIFIED")

    def test_pr_opener_cannot_approve_implementation(self):
        self.approver="controller"
        with self.assertRaisesRegex(proof.RemoteProofError,"independent"):
            self.verify()

    def test_untrusted_receipt_cannot_substitute_for_github_attribution(self):
        self.approver="executor"
        self.receipt={"author":"made-up-actor","actor":"made-up-actor"}
        with self.assertRaisesRegex(proof.RemoteProofError,"independent"):
            self.verify()

    def test_fake_receipt_actor_can_only_veto_not_authorize(self):
        self.approver="independent-reviewer"
        self.receipt={"author":"independent-reviewer"}
        with self.assertRaisesRegex(proof.RemoteProofError,"independent"):
            self.verify()

    def test_missing_authenticated_implementer_fails_closed(self):
        self.approver="independent-reviewer"
        self.commit_author_authenticated=False
        with self.assertRaisesRegex(proof.RemoteProofError,"authenticated GitHub"):
            self.verify()

    def test_source_commit_must_be_in_github_pr_attribution(self):
        def fake(path,token):
            if path==COMMITS:
                return [{"sha":"c"*40,"author":{"login":"executor"},
                         "committer":{"login":"controller"}}]
            return self.api(path,token)
        with patch.object(proof,"github_json",side_effect=fake), \
             patch.object(proof,"token",return_value="synthetic-token"):
            with self.assertRaisesRegex(proof.RemoteProofError,"Source SHA absent"):
                proof.verify_acceptance(self.registry,self.task,{},MAIN_SHA,CODE_SHA,self.evidence)

    def test_implementation_authors_later_page_all_excluded(self):
        self.approver="executor"
        def fake(path,token):
            if path==COMMITS:
                return [
                    {"sha":f"{i:040x}","author":{"login":"controller"},
                     "committer":{"login":"controller"}} for i in range(1,101)
                ]
            if path==COMMITS+"&page=2":
                return [{"sha":CODE_SHA,"author":{"login":"executor"},
                         "committer":{"login":"controller"}}]
            return self.api(path,token)
        with patch.object(proof,"github_json",side_effect=fake), \
             patch.object(proof,"token",return_value="synthetic-token"):
            with self.assertRaisesRegex(proof.RemoteProofError,"independent"):
                proof.verify_acceptance(self.registry,self.task,{},MAIN_SHA,CODE_SHA,self.evidence)

    def test_codex_reviewer_cannot_self_review_contributed_code(self):
        self.approver="controller"
        self.implementation_author="chatgpt-codex-connector[bot]"
        def fake(path,token):
            if path==COMMENTS:
                return [comment(1)]
            return self.api(path,token)
        with patch.object(proof,"github_json",side_effect=fake), \
             patch.object(proof,"token",return_value="synthetic-token"):
            with self.assertRaisesRegex(proof.RemoteProofError,"cannot independently"):
                proof.verify_acceptance(self.registry,self.task,{},MAIN_SHA,CODE_SHA,self.evidence)


if __name__=="__main__":
    unittest.main()
