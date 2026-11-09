#!/usr/bin/env python3
"""Offline regression controls for the mandatory General aggregate."""

from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import yaml

import ci_required as aggregate


SHA = "a" * 40
REQUIRED_JOB_NAME = ("${{ github.event_name == 'push' && github.ref != 'refs/heads/main' "
                     "&& 'ASA / branch push (not required)' || 'ASA / required' }}")


def successful_needs():
    return {job: {"result": "success", "outputs": {}} for job in aggregate.REQUIRED_JOBS}


class RequiredSummaryTests(unittest.TestCase):
    def test_only_four_actual_successes_pass(self):
        report = aggregate.summarize(SHA, SHA, successful_needs())
        self.assertEqual(report["status"], "PASS")
        self.assertTrue(report["full_regression_verified"])
        self.assertFalse(report["integration_ready"])
        self.assertFalse(report["release_ready"])

    def test_every_mandatory_job_rejects_all_non_success_states(self):
        for job in aggregate.REQUIRED_JOBS:
            for raw, state in (("failure", "FAIL"), ("cancelled", "CANCELLED"), ("skipped", "NOT_RUN"),
                               ("not_applicable", "NOT_APPLICABLE"), ("unknown", "BLOCKED"),
                               (None, "BLOCKED"), (True, "BLOCKED"), ({}, "BLOCKED")):
                with self.subTest(job=job, raw=raw):
                    needs = successful_needs()
                    needs[job]["result"] = raw
                    report = aggregate.summarize(SHA, SHA, needs)
                    self.assertEqual(report["checks"][job], state)
                    self.assertEqual(report["status"], state)
                    self.assertFalse(report["full_regression_verified"])

    def test_missing_and_malformed_jobs_never_pass(self):
        for job in aggregate.REQUIRED_JOBS:
            with self.subTest(job=job):
                needs = successful_needs()
                del needs[job]
                self.assertEqual(aggregate.summarize(SHA, SHA, needs)["status"], "NOT_RUN")
                needs[job] = "success"
                self.assertEqual(aggregate.summarize(SHA, SHA, needs)["status"], "BLOCKED")
        self.assertEqual(aggregate.summarize(SHA, SHA, {})["status"], "NOT_RUN")

    def test_unknown_needs_shape_and_jobs_block(self):
        for needs in (None, [], "success", {**successful_needs(), "other": {"result": "success"}}):
            with self.subTest(needs=needs):
                self.assertEqual(aggregate.summarize(SHA, SHA, needs)["status"], "BLOCKED")

    def test_wrong_missing_or_malformed_source_blocks_success(self):
        for expected, actual in ((SHA, "b" * 40), (None, SHA), (SHA, None), ("", SHA),
                                 (SHA.upper(), SHA), (SHA, SHA + "\n"), (True, SHA)):
            with self.subTest(expected=expected, actual=actual):
                self.assertEqual(aggregate.summarize(expected, actual, successful_needs())["status"], "BLOCKED")

    def test_failure_and_cancellation_remain_visible_in_mixed_results(self):
        needs = successful_needs()
        needs["code"]["result"] = "failure"
        needs["postgres-tests"]["result"] = "skipped"
        needs["access-a-browser"]["result"] = "cancelled"
        report = aggregate.summarize(SHA, SHA, needs)
        self.assertEqual(report["status"], "FAIL")
        self.assertEqual(report["checks"]["access-a-browser"], "CANCELLED")
        self.assertEqual(report["checks"]["postgres-tests"], "NOT_RUN")

    def test_cli_source_read_failure_and_invalid_json_fail_closed(self):
        payloads = ("", "[]", "{", '{"code":{},"code":{}}', "x" * 16385)
        for payload in payloads:
            with self.subTest(payload=payload[:30]):
                with patch.dict(os.environ, {"ASA_REQUIRED_EXPECTED_SHA": SHA,
                                              "ASA_REQUIRED_NEEDS_JSON": payload}, clear=True):
                    with redirect_stdout(io.StringIO()) as output:
                        self.assertEqual(aggregate.main(), 1)
                    self.assertEqual(json.loads(output.getvalue())["status"], "BLOCKED")
        with patch.dict(os.environ, {"ASA_REQUIRED_EXPECTED_SHA": SHA,
                                    "ASA_REQUIRED_NEEDS_JSON": json.dumps(successful_needs())}, clear=True):
            with patch.object(aggregate.subprocess, "run", side_effect=OSError("git unavailable")):
                with redirect_stdout(io.StringIO()) as output:
                    self.assertEqual(aggregate.main(), 1)
                self.assertEqual(json.loads(output.getvalue())["status"], "BLOCKED")

    def test_real_cli_binds_checkout_source_and_returns_nonzero_on_skips(self):
        actual = subprocess.run(["git", "rev-parse", "HEAD"], cwd=aggregate.ROOT, check=True,
                                capture_output=True, text=True).stdout.strip()
        needs = successful_needs()
        for expected, selected, code, state in ((actual, needs, 0, "PASS"), (SHA, needs, 1, "BLOCKED"),
                                                (actual, {**needs, "code": {"result": "skipped"}}, 1, "NOT_RUN")):
            with self.subTest(state=state):
                env = {**os.environ, "ASA_REQUIRED_EXPECTED_SHA": expected,
                       "ASA_REQUIRED_NEEDS_JSON": json.dumps(selected)}
                completed = subprocess.run([sys.executable, str(Path(aggregate.__file__))], cwd=aggregate.ROOT,
                                           env=env, capture_output=True, text=True, check=False, timeout=15)
                self.assertEqual(completed.returncode, code, completed.stderr)
                self.assertEqual(json.loads(completed.stdout)["status"], state)

    def test_native_workflow_wiring_and_canonical_regression_command(self):
        workflow = yaml.safe_load((aggregate.ROOT / ".github/workflows/spec-validation.yml").read_text(encoding="utf-8"))
        job = workflow["jobs"]["required"]
        self.assertEqual(job["name"], REQUIRED_JOB_NAME)
        self.assertEqual(job["needs"], list(aggregate.REQUIRED_JOBS))
        self.assertEqual(job["if"], "${{ always() }}")
        self.assertEqual(job["permissions"], {"contents": "read"})
        self.assertEqual(job["env"], {"ASA_REQUIRED_EXPECTED_SHA": "${{ github.event.pull_request.head.sha || github.sha }}",
                                     "ASA_REQUIRED_NEEDS_JSON": "${{ toJSON(needs) }}"})
        checkout = job["steps"][0]
        self.assertEqual(checkout["uses"], "actions/checkout@v4")
        self.assertEqual(checkout["with"]["ref"], job["env"]["ASA_REQUIRED_EXPECTED_SHA"])
        self.assertFalse(checkout["with"]["persist-credentials"])
        commands = [step["run"] for step in job["steps"] if "run" in step]
        self.assertEqual(commands, ["python tools/ci_required.py"])
        gate = (aggregate.ROOT / "tools/gate-governance.sh").read_text(encoding="utf-8")
        self.assertIn('run "$PYTHON" tools/test_ci_required.py', gate)

    def test_static_event_name_contract_keeps_branch_push_failures_out_of_required_context(self):
        workflow = yaml.safe_load((aggregate.ROOT / ".github/workflows/spec-validation.yml").read_text(encoding="utf-8"))
        self.assertEqual(workflow["jobs"]["required"]["name"], REQUIRED_JOB_NAME)

        # Static wiring contract for this exact pinned and/or expression, not a
        # general expression evaluator. Native push/PR checks prove the names.
        def check_name(event, ref):
            return (event == "push" and ref != "refs/heads/main"
                    and "ASA / branch push (not required)") or "ASA / required"

        for event, ref in (("pull_request", "refs/pull/983/merge"),
                           ("pull_request", "refs/heads/codex/work"),
                           ("push", "refs/heads/main")):
            with self.subTest(event=event, ref=ref):
                self.assertEqual(check_name(event, ref), "ASA / required")

        cancelled = {**successful_needs(), "code": {"result": "cancelled"}}
        for ref in ("refs/heads/agent/work", "refs/heads/assistant/work",
                    "refs/heads/codex/work", "refs/heads/main-backup"):
            with self.subTest(ref=ref):
                branch_name = check_name("push", ref)
                self.assertEqual(branch_name, "ASA / branch push (not required)")
                checks = {branch_name: aggregate.summarize(SHA, SHA, cancelled),
                          check_name("pull_request", "refs/pull/983/merge"):
                              aggregate.summarize(SHA, SHA, successful_needs())}
                self.assertEqual(len(checks), 2)
                self.assertEqual(checks["ASA / required"]["status"], "PASS")
                self.assertEqual(checks[branch_name]["status"], "CANCELLED")
                self.assertFalse(checks[branch_name]["full_regression_verified"])


if __name__ == "__main__":
    unittest.main()
