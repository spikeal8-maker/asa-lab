"""P1 regressions: cross-SHA review veto and focused task CI provenance."""
from __future__ import annotations

from pathlib import Path
import json
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import verified_github as gh
import classroomctl as ctl

SOURCE_SHA = "a" * 40
OLDER_SHA = "c" * 40
MAIN_SHA = "b" * 40
PR_REVIEWS = "/repos/spikeal8-maker/asa-lab/pulls/999/reviews?per_page=100"
PR_COMMENTS = "/repos/spikeal8-maker/asa-lab/issues/999/comments?per_page=100"
WORKFLOW = ".github/workflows/classroom-notify-02.yml"
CI_RUN = "https://github.com/spikeal8-maker/asa-lab/actions/runs/777"


def review(identity: int, sha: str, reviewer: str, state: str):
    return {"id": identity, "commit_id": sha, "user": {"login": reviewer},
            "state": state, "submitted_at": "2026-10-24T09:00:00Z"}


class PreviousHeadReviewVeto(unittest.TestCase):
    def assert_review(self, records, *, clean: bool):
        def api(path, token):
            if path == PR_REVIEWS:
                return records
            if path == PR_COMMENTS:
                return []
            self.fail("Unexpected remote review path: " + path)
        with patch.object(gh, "github_json", side_effect=api):
            if clean:
                gh._get_reviews(999, SOURCE_SHA, "controller", False,
                                "synthetic-token", implementation_authors={"executor"})
            else:
                with self.assertRaisesRegex(gh.RemoteProofError, "Undismissed CHANGES_REQUESTED"):
                    gh._get_reviews(999, SOURCE_SHA, "controller", False,
                                    "synthetic-token", implementation_authors={"executor"})

    def test_previous_source_change_request_blocks_current_approval(self):
        self.assert_review([
            review(10, OLDER_SHA, "security-reviewer", "CHANGES_REQUESTED"),
            review(12, SOURCE_SHA, "independent", "APPROVED"),
        ], clean=False)

    def test_older_change_request_survives_comment_on_new_head(self):
        self.assert_review([
            review(10, OLDER_SHA, "security-reviewer", "CHANGES_REQUESTED"),
            review(11, SOURCE_SHA, "security-reviewer", "COMMENTED"),
            review(12, SOURCE_SHA, "independent", "APPROVED"),
        ], clean=False)

    def test_unsorted_source_history_still_blocks_earlier_change_request(self):
        self.assert_review([
            review(13, SOURCE_SHA, "independent", "APPROVED"),
            review(12, SOURCE_SHA, "security-reviewer", "COMMENTED"),
            review(10, OLDER_SHA, "security-reviewer", "CHANGES_REQUESTED"),
        ], clean=False)

    def test_previous_change_request_dismissal_allows_exact_source_approval(self):
        self.assert_review([
            review(10, OLDER_SHA, "security-reviewer", "CHANGES_REQUESTED"),
            review(11, OLDER_SHA, "security-reviewer", "DISMISSED"),
            review(12, SOURCE_SHA, "independent", "APPROVED"),
        ], clean=True)

    def test_newer_approval_clears_previous_change_request(self):
        self.assert_review([
            review(10, OLDER_SHA, "security-reviewer", "CHANGES_REQUESTED"),
            review(11, OLDER_SHA, "security-reviewer", "APPROVED"),
            review(12, SOURCE_SHA, "independent", "APPROVED"),
        ], clean=True)

    def test_prior_sha_approval_alone_is_not_exact_source_approval(self):
        with self.assertRaisesRegex(gh.RemoteProofError, "independent"):
            self.assert_review([
                review(10, OLDER_SHA, "reviewer", "APPROVED"),
            ], clean=True)

    def test_previous_change_request_on_second_page_still_blocks(self):
        page1 = [
            review(200, SOURCE_SHA, "independent", "APPROVED")
        ] + [
            review(i + 300, OLDER_SHA, "filler-" + str(i), "COMMENTED")
            for i in range(99)
        ]
        self.assertEqual(len(page1), 100)
        page2 = [review(10, OLDER_SHA, "security-reviewer", "CHANGES_REQUESTED")]
        def api(path, token):
            if path == PR_REVIEWS:
                return page1
            if path == PR_REVIEWS + "&page=2":
                return page2
            if path == PR_COMMENTS:
                return []
            self.fail(path)
        with patch.object(gh, "github_json", side_effect=api):
            with self.assertRaisesRegex(gh.RemoteProofError, "Undismissed CHANGES_REQUESTED"):
                gh._get_reviews(999, SOURCE_SHA, "controller", False, "synthetic-token",
                                implementation_authors={"executor"})

    def test_malformed_prior_sha_review_id_also_rejected(self):
        x = review(10, OLDER_SHA, "reviewer", "CHANGES_REQUESTED")
        x.pop("id")
        with patch.object(gh, "github_json", side_effect=lambda path, token: [x] if path == PR_REVIEWS else []):
            with self.assertRaisesRegex(gh.RemoteProofError, "Invalid or missing"):
                gh._get_reviews(999, SOURCE_SHA, "controller", False, "synthetic-token")


class TaskBoundFocusedEvidence(unittest.TestCase):
    def setUp(self):
        reg = ctl.registry(ROOT)
        self.task = dict(ctl.tasks_map(reg)["NOTIFY-02"])
        self.events = []
        self.workflow = WORKFLOW
        self.job = "NOTIFY-02 inbox E2E"
        self.step = "NOTIFY-02 revoked duplicate privacy E2E"
        self.task["focused_ci"] = {
            "task_id": "NOTIFY-02",
            "workflow_path": WORKFLOW,
            "required_jobs": [self.job],
            "required_steps": [self.step],
        }

    def api(self, path, token):
        self.events.append(path)
        if path.endswith("/actions/runs/777"):
            return {
                "head_sha": SOURCE_SHA, "status": "completed",
                "conclusion": "success",
                "repository": {"full_name": gh.REPOSITORY},
                "name": "Classroom Program Controller Checks",
                "path": self.workflow,
            }
        if path.endswith("/actions/runs/777/jobs?per_page=100"):
            return {
                "total_count": 1,
                "jobs": [{
                    "name": self.job, "status": "completed", "conclusion": "success",
                    "steps": [{"name": self.step, "status": "completed", "conclusion": "success"}],
                }],
            }
        self.fail(path)

    def check(self, *, task=None):
        with patch.object(gh, "github_json", side_effect=self.api):
            gh._ci_run({"uri": CI_RUN}, SOURCE_SHA, "focused",
                       "synthetic-token", task=task if task is not None else self.task)

    def test_successful_generic_classroom_controller_cannot_authorize_notify02(self):
        self.task.pop("focused_ci")
        self.workflow = ".github/workflows/classroom-controller.yml"
        self.job = "validate"
        self.step = "Run all controller regression tests"
        with self.assertRaisesRegex(gh.RemoteProofError, "No task-specific approved"):
            self.check()
        self.assertEqual(self.events, [])

    def test_registry_policy_must_bind_actual_task_id(self):
        self.task["focused_ci"]["task_id"] = "CTRL-00"
        with self.assertRaisesRegex(gh.RemoteProofError, "task-specific approved"):
            self.check()

    def test_product_contract_cannot_reuse_controller_workflow_path(self):
        self.task["focused_ci"]["workflow_path"] = ".github/workflows/classroom-controller.yml"
        with self.assertRaisesRegex(gh.RemoteProofError, "generic"):
            self.check()

    def test_product_contract_requires_task_id_in_real_step_name(self):
        self.task["focused_ci"]["required_steps"] = ["Run all controller regression tests"]
        with self.assertRaisesRegex(gh.RemoteProofError, "explicitly bound"):
            self.check()

    def test_registered_focused_workflow_and_jobs_may_pass(self):
        self.check()
        self.assertEqual(len(self.events), 2)

    def test_wrong_run_workflow_path_is_rejected(self):
        self.workflow = ".github/workflows/classroom-controller.yml"
        with self.assertRaisesRegex(gh.RemoteProofError, "Focused workflow path"):
            self.check()

    def test_required_job_must_actually_run_and_succeed(self):
        self.job = "validate"
        with self.assertRaisesRegex(gh.RemoteProofError, "Missing successful focused CI job"):
            self.check()

    def test_required_task_step_must_actually_run_and_succeed(self):
        self.step = "Run all controller regression tests"
        with self.assertRaisesRegex(gh.RemoteProofError, "Missing task-specific successful"):
            self.check()

    def test_incomplete_ci_job_collection_cannot_attest(self):
        original = self.api
        def api(path, token):
            response = original(path, token)
            if path.endswith("/jobs?per_page=100"):
                response["total_count"] = 2
            return response
        with patch.object(gh, "github_json", side_effect=api):
            with self.assertRaisesRegex(gh.RemoteProofError, "incomplete"):
                gh._ci_run({"uri":CI_RUN}, SOURCE_SHA, "focused", "synthetic-token", task=self.task)

    def test_focused_ci_cannot_omit_job_count(self):
        original = self.api
        def api(path, token):
            response = original(path, token)
            if path.endswith("/jobs?per_page=100"):
                response.pop("total_count")
            return response
        with patch.object(gh, "github_json", side_effect=api):
            with self.assertRaisesRegex(gh.RemoteProofError, "incomplete"):
                gh._ci_run({"uri": CI_RUN}, SOURCE_SHA, "focused",
                           "synthetic-token", task=self.task)

    def test_task_step_in_unapproved_job_does_not_count(self):
        original = self.api
        def api(path, token):
            response = original(path, token)
            if path.endswith("/jobs?per_page=100"):
                response["jobs"][0]["steps"] = []
                response["jobs"].append({
                    "name": "unrelated successful job",
                    "status": "completed", "conclusion": "success",
                    "steps": [{
                        "name": self.step, "status": "completed",
                        "conclusion": "success",
                    }],
                })
                response["total_count"] = 2
            return response
        with patch.object(gh, "github_json", side_effect=api):
            with self.assertRaisesRegex(gh.RemoteProofError, "task-specific successful"):
                gh._ci_run({"uri": CI_RUN}, SOURCE_SHA, "focused",
                           "synthetic-token", task=self.task)

    def test_passing_controller_ci_is_bound_to_ctrl00_only(self):
        t = dict(ctl.tasks_map(ctl.registry(ROOT))["CTRL-00"])
        self.workflow = ".github/workflows/classroom-controller.yml"
        self.job = "validate"
        self.step = "Validate requirements, dependencies and decisions"
        original=self.api
        def api(path, token):
            obj=original(path,token)
            if path.endswith("/jobs?per_page=100"):
                obj["jobs"][0]["steps"] = [
                    {"name": value, "status": "completed", "conclusion": "success"}
                    for value in (
                        "Validate requirements, dependencies and decisions",
                        "Run all controller regression tests",
                        "Rebuild registry and check deterministic output",
                    )
                ]
            return obj
        with patch.object(gh,"github_json",side_effect=api):
            gh._ci_run({"uri":CI_RUN},SOURCE_SHA,"focused","synthetic-token",task=t)

    def test_controller_ci_missing_one_required_step_is_blocked(self):
        t = dict(ctl.tasks_map(ctl.registry(ROOT))["CTRL-00"])
        self.workflow = ".github/workflows/classroom-controller.yml"
        self.job = "validate"
        self.step = "Run all controller regression tests"
        with self.assertRaisesRegex(gh.RemoteProofError,"Missing task-specific successful"):
            self.check(task=t)


if __name__=="__main__":
    unittest.main()
