"""Exact-SHA independent review gates retain outstanding human and security vetoes."""
from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import verified_github as proof

SHA = "a" * 40
REVIEWS = "/repos/spikeal8-maker/asa-lab/pulls/999/reviews?per_page=100"
COMMENTS = "/repos/spikeal8-maker/asa-lab/issues/999/comments?per_page=100"
BOT = "chatgpt-codex-connector[bot]"


def review(identity: int, reviewer: str, state: str):
    return {
        "id": identity, "user": {"login": reviewer},
        "state": state, "commit_id": SHA,
        **({"submitted_at": "2026-10-24T09:00:00Z"} if state != "PENDING" else {}),
    }


def verdict(kind: str, *, flag: bool, status: str="completed", sha: str=SHA):
    return {"commit_sha": sha, "status": status,
            "has_any_findings": flag, "has_unresolved_findings": flag}


def comment(identity: int, at: str, *, code=None, security=None):
    code = code if code is not None else {}
    security = security if security is not None else {}
    state={"code_review": code, "security_review": security}
    return {
        "id": identity,
        "updated_at": at,
        "user": {"login": BOT},
        "body": "<!-- codex-review-state:v1 " + json.dumps(state) + " -->",
    }


class IndependentReviewTransitions(unittest.TestCase):
    def verify(self, reviews, comments=(), *, security_required=False):
        calls = []
        def api(path, access_token):
            calls.append(path)
            if path == REVIEWS:
                return reviews
            if path == COMMENTS:
                return list(comments)
            raise AssertionError(f"Unexpected review verification path: {path}")
        with patch.object(proof,"github_json",side_effect=api):
            result=proof._get_reviews(
                999,SHA,"controller",security_required,"synthetic-token",
                implementation_authors={"executor"},
            )
        self.assertIn(COMMENTS,calls)
        return result

    def test_change_request_then_comment_still_vetoes_other_approval(self):
        with self.assertRaisesRegex(proof.RemoteProofError, "change requests"):
            self.verify([
                review(10,"security-reviewer","CHANGES_REQUESTED"),
                review(11,"security-reviewer","COMMENTED"),
                review(12,"independent-reviewer","APPROVED"),
            ])

    def test_change_request_veto_survives_multiple_interleaved_comments(self):
        with self.assertRaisesRegex(proof.RemoteProofError, "change requests"):
            self.verify([
                review(10,"security-reviewer","CHANGES_REQUESTED"),
                review(17,"independent-reviewer","APPROVED"),
                review(12,"security-reviewer","COMMENTED"),
                review(11,"security-reviewer","COMMENTED"),
            ])

    def test_change_request_is_cleared_by_newer_approval(self):
        self.verify([
            review(10,"security-reviewer","CHANGES_REQUESTED"),
            review(11,"security-reviewer","COMMENTED"),
            review(12,"security-reviewer","APPROVED"),
        ])

    def test_change_request_dismissed_allows_another_independent_approval(self):
        self.verify([
            review(10,"security-reviewer","CHANGES_REQUESTED"),
            review(11,"security-reviewer","DISMISSED"),
            review(12,"independent-reviewer","APPROVED"),
        ])

    def test_approved_then_commented_preserves_approval(self):
        self.verify([
            review(10,"independent-reviewer","APPROVED"),
            review(11,"independent-reviewer","COMMENTED"),
        ])

    def test_pending_then_commented_does_not_clear_pending(self):
        with self.assertRaisesRegex(proof.RemoteProofError,"pending"):
            self.verify([
                review(10,"independent-reviewer","PENDING"),
                review(11,"independent-reviewer","COMMENTED"),
                review(12,"another-reviewer","APPROVED"),
            ])

    def test_only_comment_does_not_act_as_approval(self):
        with self.assertRaisesRegex(proof.RemoteProofError,"independent"):
            self.verify([review(10,"independent-reviewer","COMMENTED")])

    def test_newer_clean_code_does_not_clear_old_security_findings(self):
        old=comment(100,"2026-10-24T09:01:00Z",
            code=verdict("code",flag=False),
            security=verdict("security",flag=True))
        new=comment(101,"2026-10-24T09:03:00Z",
            code=verdict("code",flag=False))
        with self.assertRaisesRegex(proof.RemoteProofError, "security"):
            self.verify([], [old,new])

    def test_newer_clean_code_does_not_clear_security_review_running(self):
        old=comment(100,"2026-10-24T09:01:00Z",
            code=verdict("code",flag=False),
            security=verdict("security",flag=False,status="running"))
        new=comment(101,"2026-10-24T09:03:00Z",
            code=verdict("code",flag=False))
        with self.assertRaisesRegex(proof.RemoteProofError, "incomplete"):
            self.verify([], [old,new])

    def test_newer_clean_security_clears_prior_security_failure(self):
        old=comment(100,"2026-10-24T09:01:00Z",
            code=verdict("code",flag=False),
            security=verdict("security",flag=True))
        new_code=comment(101,"2026-10-24T09:02:00Z",
            code=verdict("code",flag=False))
        clean_security=comment(102,"2026-10-24T09:03:00Z",
            security=verdict("security",flag=False))
        self.verify([], [old,new_code,clean_security])

    def test_security_clean_cannot_erase_older_code_failure(self):
        old=comment(100,"2026-10-24T09:01:00Z",
            code=verdict("code",flag=True),
            security=verdict("security",flag=False))
        newer=comment(101,"2026-10-24T09:02:00Z",
            security=verdict("security",flag=False))
        with self.assertRaisesRegex(proof.RemoteProofError, "incomplete"):
            self.verify([], [old,newer])

    def test_code_clean_security_fail_with_no_security_sha_blocks(self):
        old=comment(100,"2026-10-24T09:01:00Z",
            code=verdict("code",flag=False),
            security=verdict("security",flag=True,sha=None))
        newer=comment(101,"2026-10-24T09:03:00Z",
            code=verdict("code",flag=False))
        with self.assertRaisesRegex(proof.RemoteProofError, "security"):
            self.verify([], [old,newer])

    def test_code_clean_security_pending_without_sha_blocks(self):
        old=comment(100,"2026-10-24T09:01:00Z",
            code=verdict("code",flag=False),
            security=verdict("security",flag=False,status="pending",sha=None))
        newer=comment(101,"2026-10-24T09:03:00Z",
            code=verdict("code",flag=False))
        with self.assertRaisesRegex(proof.RemoteProofError, "incomplete"):
            self.verify([], [old,newer])

    def test_newer_code_success_overrides_older_failed_code_only(self):
        old=comment(100,"2026-10-24T09:01:00Z",
            code=verdict("code",flag=True))
        new=comment(101,"2026-10-24T09:03:00Z",
            code=verdict("code",flag=False))
        self.verify([], [old,new])

    def test_newer_security_failure_overrides_older_security_success(self):
        old=comment(100,"2026-10-24T09:01:00Z",
            code=verdict("code",flag=False),
            security=verdict("security",flag=False))
        new=comment(101,"2026-10-24T09:03:00Z",
            security=verdict("security",flag=True))
        with self.assertRaisesRegex(proof.RemoteProofError,"security"):
            self.verify([], [old,new])

    def test_nonreviewer_codex_bot_summary_is_ignored(self):
        good=comment(100,"2026-10-24T09:01:00Z",
            code=verdict("code",flag=False))
        good["user"]={"login":"random-attacker"}
        with self.assertRaisesRegex(proof.RemoteProofError,"independent"):
            self.verify([], [good])

    def test_invalid_codex_state_fails_closed(self):
        broken={"id":110,"updated_at":"2026-10-24T09:02:00Z",
                "user":{"login":BOT},
                "body":"<!-- codex-review-state:v1 {broken-json} -->"}
        with self.assertRaisesRegex(proof.RemoteProofError, "Malformed"):
            self.verify([], [broken])


if __name__=="__main__":
    unittest.main()
