#!/usr/bin/env python3
"""Offline adversarial tests for CI measurement and its command-line contract."""
import base64
import copy
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import ci_metrics as m

START = "2026-10-30T10:00:00Z"
END = "2026-10-30T10:01:00Z"


def job(identity=1, name="build", conclusion="success", **extra):
    return {"id": identity, "name": name, "status": "completed", "conclusion": conclusion,
            "created_at": "2026-10-30T09:59:58Z", "started_at": START, "completed_at": END, "runner_id": 1,
            "steps": [{"number": 1, "name": "Build web", "conclusion": conclusion, "started_at": START, "completed_at": END}], **extra}


def run(identity=1, event="push", conclusion="success", jobs=None, **extra):
    return {"id": identity, "workflow_id": 7, "name": "General", "path": ".github/workflows/ci.yml",
            "head_sha": "a" * 40, "head_branch": "main", "event": event, "status": "completed", "conclusion": conclusion,
            "run_attempt": 1, "created_at": START, "run_started_at": START, "updated_at": "2026-10-30T11:00:00Z",
            "html_url": f"https://example.test/runs/{identity}", "workflow_source": None,
            "attempts": [{"number": 1, "conclusion": conclusion, "status": "completed", "created_at": START,
                          "run_started_at": START, "updated_at": END, "jobs": jobs if jobs is not None else [job(identity)]}], **extra}


def report(runs=None):
    runs = runs if runs is not None else [run()]
    return {"schema_version": m.SCHEMA, "raw": {"repository": {"full_name": "owner/repo", "private": False},
            "runs": runs, "latest_run_ids": [r["id"] for r in runs], "prs": {}, "workflow_sources": {}}}


class FakeApi:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def get(self, path):
        self.calls.append(path)
        value = self.responses[path]
        if isinstance(value, Exception):
            raise value
        return copy.deepcopy(value)


class TimeTests(unittest.TestCase):
    def test_missing_invalid_inverted_never_zero(self):
        for a, b in [(None, END), (START, None), ("bad", END), (END, START), ("0001-01-01T00:00:00Z", END), ("2026-10-30", END)]:
            self.assertIsNone(m.seconds(a, b))
        self.assertEqual(m.seconds(START, START), 0)
        self.assertEqual(m.seconds(START, END), 60)

    def test_quantile_denominators_and_empty(self):
        result = m.distribution([0, 10, 20, 30, None, float("nan"), float("inf"), -1, True])
        self.assertEqual(result, {"n": 4, "missing": 5, "median_seconds": 15, "p90_seconds": 27})
        self.assertIsNone(m.distribution([])["median_seconds"])

    def test_no_runner_no_allocation(self):
        self.assertIsNone(m.job_duration(job(runner_id=0)))
        self.assertIsNone(m.job_duration(job(runner_id=True)))
        self.assertIsNone(m.job_duration(job(completed_at=None)))
        self.assertEqual(m.job_duration(job()), 60)


class PaginationTests(unittest.TestCase):
    def test_all_pages_not_first_hundred(self):
        api = FakeApi({"x?per_page=100&page=1": {"total_count": 101, "jobs": [{"id": n} for n in range(1, 101)]},
                       "x?per_page=100&page=2": {"total_count": 101, "jobs": [{"id": 101}]}})
        self.assertEqual(len(m.paginate(api, "x", "jobs")), 101)

    def test_explicit_sample_is_not_full_list_claim(self):
        api = FakeApi({"x?per_page=100&page=1": {"total_count": 1500, "workflow_runs": [{"id": n} for n in range(1, 101)]}})
        self.assertEqual(len(m.paginate(api, "x", "workflow_runs", limit=5)), 5)

    def test_truncation_changes_duplicates_and_api_failure_fail_closed(self):
        for payload in [{"total_count": 2, "jobs": [{"id": 1}]}, {"total_count": 2, "jobs": [{"id": 1}, {"id": 1}]}, {"jobs": []}]:
            with self.assertRaises(m.MetricsError):
                m.paginate(FakeApi({"x?per_page=100&page=1": payload}), "x", "jobs")
        api = FakeApi({"x?per_page=100&page=1": {"total_count": 101, "jobs": [{"id": n} for n in range(1, 101)]},
                       "x?per_page=100&page=2": m.ApiError(403)})
        with self.assertRaises(m.ApiError):
            m.paginate(api, "x", "jobs")
        api.responses["x?per_page=100&page=2"] = {"total_count": 102, "jobs": [{"id": 101}, {"id": 102}]}
        with self.assertRaises(m.MetricsError):
            m.paginate(api, "x", "jobs")

    def test_page_bound_and_search_ceiling(self):
        api = FakeApi({"x?per_page=100&page=1": [{"id": n} for n in range(1, 101)]})
        with self.assertRaises(m.MetricsError):
            m.paginate(api, "x", max_pages=1)
        api = FakeApi({f"x?per_page=100&page={p}": {"total_count": 1000, "workflow_runs": [{"id": p * 100 + n} for n in range(100)]} for p in range(1, 11)})
        with self.assertRaises(m.MetricsError):
            m.paginate(api, "x", "workflow_runs")

    def test_timeline_events_without_rest_ids(self):
        api = FakeApi({"x?per_page=100&page=1": [{"event": "cross-referenced", "created_at": START}, {"event": "ready_for_review", "id": 9}]})
        self.assertEqual(len(m.paginate(api, "x", timeline=True)), 2)


class DagTests(unittest.TestCase):
    def test_true_path_differs_from_longest_job(self):
        graph = m.static_graph({"jobs": {"a": {}, "b": {"needs": "a"}, "c": {}}})
        actual = m.critical_path(graph, [job(1, "a"), job(2, "b"), job(3, "c")])
        self.assertEqual(actual["seconds"], 120)
        self.assertEqual(actual["path"], ["a", "b"])

    def test_dynamic_matrix_reusable_and_bad_graph_rejected(self):
        for definition in [{"strategy": {}}, {"uses": "other.yml"}, {"name": "${{ matrix.os }}"}, {"needs": "missing"}]:
            with self.assertRaises(m.MetricsError):
                m.static_graph({"jobs": {"a": definition}})
        graph = {"a": {"name": "a", "needs": ["b"]}, "b": {"name": "b", "needs": ["a"]}}
        self.assertIsNone(m.critical_path(graph, [job(1, "a"), job(2, "b")])["seconds"])

    def test_missing_duplicate_failed_jobs_not_a_complete_path(self):
        graph = m.static_graph({"jobs": {"build": {}}})
        for jobs in [[], [job(), job(2)], [job(conclusion="failure")], [job(completed_at=None)]]:
            self.assertIsNone(m.critical_path(graph, jobs)["seconds"])
        self.assertIn("Failed/cancelled", m.critical_path(graph, [job(conclusion="failure")])["reason"])
        self.assertIn("timestamps", m.critical_path(graph, [job(completed_at=None)])["reason"])

    def test_exact_blob_verified_and_pr_head_not_assumed(self):
        content = b"jobs:\n  build:\n    runs-on: ubuntu-latest\n"
        sha = hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
        endpoint = "repos/o/r/contents/.github/workflows/ci.yml?ref=" + "a" * 40
        api = FakeApi({endpoint: {"sha": sha, "content": base64.b64encode(content).decode()}})
        collector = m.Collector(api, "o/r")
        self.assertIsNone(collector.workflow(run(event="pull_request")))
        key = collector.workflow(run())
        self.assertEqual(collector.graphs[key]["blob_sha"], sha)
        self.assertIsNotNone(collector.graphs[key]["graph"])
        collector.workflow(run())
        self.assertEqual(len(api.calls), 1)
        api.responses[endpoint]["sha"] = "wrong"
        collector = m.Collector(api, "o/r")
        self.assertIsNone(collector.graphs[collector.workflow(run())]["graph"])


class MeasurementTests(unittest.TestCase):
    def test_synthetic_skipped_timestamps_are_not_queue_or_execution_span(self):
        before = job(2, "skip-before", "skipped", runner_id=None, created_at="2026-10-30T09:00:00Z", started_at="2026-10-30T09:00:00Z", completed_at="2026-10-30T09:00:00Z")
        after = job(3, "skip-after", "skipped", runner_id=0, created_at="2026-10-30T11:00:00Z", started_at="2026-10-30T11:00:00Z", completed_at="2026-10-30T11:00:00Z")
        fixture = report([run(jobs=[job(), before, after])])
        result = m.analyze(fixture)["latest_completed_sample"]
        self.assertEqual(result["job_queue"], {"n": 1, "missing": 2, "median_seconds": 2, "p90_seconds": 2})
        self.assertEqual(result["run_observations"][0]["observed_job_span_seconds"], 60)
        self.assertEqual(result["run_observations"][0]["last_job_completed_at"], END)
        self.assertEqual(result["observed_elapsed"]["median_seconds"], 60)

    def test_malformed_attempt_metadata_bool_string_zero_excess_rejected(self):
        for value in [True, False, "1", 0, 21, None]:
            with self.assertRaises(m.MetricsError):
                m.Collector(FakeApi({}), "o/r").run(run(event="pull_request", run_attempt=value))

    def test_generic_fallback_filters_only_explicit_attempt_and_keeps_provenance(self):
        exact = "repos/o/r/actions/runs/1/attempts/1/jobs?per_page=100&page=1"
        generic = "repos/o/r/actions/runs/1/jobs?filter=all&per_page=100&page=1"
        rows = [job(1, run_id=1, run_attempt=1), job(2, run_id=1, run_attempt=2)]
        api = FakeApi({exact: m.ApiError(502), generic: {"total_count": 2, "jobs": rows}})
        jobs, provenance = m.Collector(api, "o/r").attempt_jobs(1, 1)
        self.assertEqual([j["id"] for j in jobs], [1])
        self.assertEqual(provenance["method"], "generic_all_filtered_by_explicit_attempt")
        self.assertEqual(provenance["fallback_after_http"], 502)
        self.assertEqual(provenance["generic_jobs_total"], 2)
        self.assertIsNotNone(m.timestamp(provenance["captured_at"]))

    def test_fallback_malformed_wrong_run_and_auth_fail_closed(self):
        exact = "repos/o/r/actions/runs/1/attempts/1/jobs?per_page=100&page=1"
        generic = "repos/o/r/actions/runs/1/jobs?filter=all&per_page=100&page=1"
        for row in [job(1, run_id=1), job(1, run_id=2, run_attempt=1), job(1, run_id=1, run_attempt="1"), job(1, run_id=1, run_attempt=True)]:
            api = FakeApi({exact: m.ApiError(502), generic: {"total_count": 1, "jobs": [row]}})
            with self.assertRaises(m.MetricsError):
                m.Collector(api, "o/r").attempt_jobs(1, 1)
        api = FakeApi({exact: m.ApiError(403)})
        with self.assertRaises(m.ApiError):
            m.Collector(api, "o/r").attempt_jobs(1, 1)
        self.assertEqual(api.calls, [exact])

    def test_fallback_pagination_dedup_and_other_attempt_not_assigned(self):
        exact = "repos/o/r/actions/runs/1/attempts/1/jobs?per_page=100&page=1"
        generic = "repos/o/r/actions/runs/1/jobs?filter=all&per_page=100&page="
        responses = {exact: m.ApiError(503),
                     generic + "1": {"total_count": 101, "jobs": [job(n, run_id=1, run_attempt=2) for n in range(1, 101)]},
                     generic + "2": {"total_count": 101, "jobs": [job(101, run_id=1, run_attempt=1)]}}
        jobs, _ = m.Collector(FakeApi(responses), "o/r").attempt_jobs(1, 1)
        self.assertEqual([j["id"] for j in jobs], [101])
        responses[generic + "2"]["jobs"] = [job(100, run_id=1, run_attempt=1)]
        with self.assertRaises(m.MetricsError):
            m.Collector(FakeApi(responses), "o/r").attempt_jobs(1, 1)
        responses[generic + "2"] = m.ApiError(502)
        with self.assertRaises(m.ApiError):
            m.Collector(FakeApi(responses), "o/r").attempt_jobs(1, 1)

    def test_collector_pr_files_snapshot_and_head_change_fail_closed(self):
        original = run(event="pull_request")
        pr = {"number": 850, "head": {"sha": "a" * 40}, "base": {"sha": "b" * 40}, "commits": 1, "changed_files": 1}
        endpoint = "repos/o/r"
        responses = {
            endpoint: {"full_name": "o/r", "private": False},
            endpoint + "/actions/runs?status=completed&per_page=100&page=1": {"total_count": 1, "workflow_runs": [original]},
            endpoint + "/pulls/850": pr,
            endpoint + "/pulls/850/files?per_page=100&page=1": [{"filename": "new.py", "previous_filename": "old.py", "status": "renamed"}],
            endpoint + "/pulls/850/commits?per_page=100&page=1": [{"sha": "a" * 40, "commit": {"committer": {"date": START}}}],
            endpoint + "/issues/850/timeline?per_page=100&page=1": [{"id": 4, "event": "ready_for_review", "created_at": START}],
            endpoint + "/actions/runs?head_sha=" + "a" * 40 + "&status=completed&per_page=100&page=1": {"total_count": 1, "workflow_runs": [original]},
            endpoint + "/actions/runs/1/attempts/1/jobs?per_page=100&page=1": {"total_count": 1, "jobs": [job()]},
        }
        api = FakeApi(responses)
        actual = m.Collector(api, "o/r").collect(100, [850])
        self.assertEqual(actual["raw"]["prs"]["850"]["changed_files"][0]["previous_filename"], "old.py")
        self.assertTrue(actual["raw"]["prs"]["850"]["head_base_stable_during_pr_collection"])
        self.assertEqual(m.analyze(actual)["prs"]["850"]["runs"], 1)
        original_get = api.get
        def changed(path):
            value = original_get(path)
            if path == endpoint + "/pulls/850" and api.calls.count(path) > 1:
                value["head"]["sha"] = "c" * 40
            return value
        api = FakeApi(responses)
        original_get = api.get
        api.get = changed
        with self.assertRaisesRegex(m.MetricsError, "head/base changed"):
            m.Collector(api, "o/r").collect(100, [850])

    def test_all_attempts_cancelled_actual_allocation_and_duplicate_events(self):
        a = run(1, conclusion="cancelled", jobs=[job(1, conclusion="cancelled")])
        a["attempts"].append({**a["attempts"][0], "number": 2, "jobs": [job(2, conclusion="cancelled", completed_at=None)]})
        a["run_attempt"] = 2
        b = run(3, "pull_request", jobs=[job(3)])
        c = run(4, conclusion="cancelled", jobs=[job(4, runner_id=0, started_at=None, completed_at=None)])
        result = m.analyze(report([a, b, c]))
        sample = result["latest_completed_sample"]
        self.assertEqual((sample["runs"], sample["attempts"], sample["rerun_attempts"], sample["jobs"]), (3, 4, 1, 4))
        self.assertEqual(sample["allocated_runner_minutes"], 2)
        self.assertEqual(sample["cancelled_run_allocated_minutes"], 1)
        self.assertEqual(sample["cancelled_runs_without_measurable_allocation"], 1)
        self.assertEqual(sample["measured_job_durations"]["missing"], 2)
        self.assertEqual(sample["duplicate_push_pr_groups"][0]["run_ids"], [1, 3, 4])
        self.assertEqual(sample["by_workflow"]["7"]["critical_path_coverage"]["measured"], 0)
        self.assertEqual(result["billing"]["public_policy_billable_minutes"], 0)
        self.assertIsNone(result["billing"]["monetary_cost"])
        self.assertIsNone(result["unavailable"]["agent_tokens"])

    def test_failure_cause_unknown_and_updated_timestamp_not_workflow_end(self):
        result = m.analyze(report([run(conclusion="failure", jobs=[job(conclusion="failure")])]))["latest_completed_sample"]
        self.assertEqual(result["observed_elapsed"]["median_seconds"], 60)
        self.assertEqual(result["failure_metadata"][0]["root_cause"], "UNKNOWN")
        self.assertEqual(result["failure_metadata"][0]["failed_jobs"][0]["steps"][0]["name"], "Build web")
        self.assertEqual(result["build_step_executions_proxy"], 1)
        self.assertIsNone(result["actual_compiler_rebuilds"])

    def test_private_billing_and_empty_sample_unavailable(self):
        fixture = report([])
        fixture["raw"]["repository"]["private"] = True
        result = m.analyze(fixture)
        self.assertIsNone(result["billing"]["public_policy_billable_minutes"])
        self.assertIsNone(result["latest_completed_sample"]["observed_elapsed"]["median_seconds"])

    def test_pr_lifecycle_not_ci_ready_and_overlapping_cohorts(self):
        fixture = report()
        pr = {"run_ids": [1], "created_at": START, "merged_at": END, "readiness_events": [],
              "commits": [{"sha": "a" * 40, "committed_at": START}]}
        fixture["raw"]["prs"] = {"850": pr, "878": copy.deepcopy(pr)}
        result = m.analyze(fixture)
        self.assertEqual(result["prs"]["850"]["runs"], 1)
        self.assertEqual(result["prs"]["878"]["runs"], 1)
        self.assertIsNone(result["prs"]["850"]["lifecycle"]["ci_ready_at"])
        self.assertEqual(result["prs"]["850"]["commit_to_first_observed_success"]["median_seconds"], 60)

    def _pr_rerun_fixture(self, latest_conclusion):
        first = run()["attempts"][0]
        later_start, later_end = "2026-10-30T10:05:00Z", "2026-10-30T10:06:00Z"
        record = run(run_attempt=2, conclusion=latest_conclusion,
                     jobs=[job(2, conclusion=latest_conclusion, started_at=later_start, completed_at=later_end)])
        latest = record["attempts"][0]
        latest.update(number=2, run_started_at=later_start)
        record["attempts"] = [first, latest]
        fixture = report([record])
        fixture["raw"]["prs"] = {"850": {"run_ids": [1], "created_at": START, "merged_at": None,
                                          "readiness_events": [], "commits": [{"sha": record["head_sha"], "committed_at": START}]}}
        return fixture

    def test_pr_first_success_precedes_later_successful_rerun(self):
        result = m.analyze(self._pr_rerun_fixture("success"))["prs"]["850"]
        self.assertEqual(result["commit_to_first_observed_success"], {"n": 1, "missing": 0, "median_seconds": 60, "p90_seconds": 60})
        self.assertIsNone(result["lifecycle"]["ci_ready_at"])

    def test_pr_first_success_survives_later_failed_rerun(self):
        result = m.analyze(self._pr_rerun_fixture("failure"))["prs"]["850"]
        self.assertEqual(result["commit_to_first_observed_success"], {"n": 1, "missing": 0, "median_seconds": 60, "p90_seconds": 60})
        self.assertIsNone(result["lifecycle"]["ci_ready_at"])

    def test_pr_first_success_unknown_without_completed_observable_attempt(self):
        for invalid in ("missing_end", "inverted_end", "no_runner", "not_completed"):
            with self.subTest(invalid=invalid):
                fixture = self._pr_rerun_fixture("failure")
                first = fixture["raw"]["runs"][0]["attempts"][0]
                if invalid == "not_completed":
                    first["status"] = "in_progress"
                elif invalid == "no_runner":
                    first["jobs"][0]["runner_id"] = None
                else:
                    first["jobs"][0]["completed_at"] = None if invalid == "missing_end" else "2026-10-30T09:59:59Z"
                result = m.analyze(fixture)["prs"]["850"]["commit_to_first_observed_success"]
                self.assertEqual(result, {"n": 0, "missing": 1, "median_seconds": None, "p90_seconds": None})

    def test_per_attempt_collection_preserves_earlier_failure(self):
        original = run(event="pull_request", run_attempt=2)
        first = {**original, "conclusion": "failure"}
        api = FakeApi({"repos/o/r/actions/runs/1/attempts/1": first,
                       "repos/o/r/actions/runs/1/attempts/1/jobs?per_page=100&page=1": {"total_count": 1, "jobs": [job(1, conclusion="failure")]},
                       "repos/o/r/actions/runs/1/attempts/2/jobs?per_page=100&page=1": {"total_count": 1, "jobs": [job(2)]}})
        actual = m.Collector(api, "o/r").run(original)
        self.assertEqual([a["conclusion"] for a in actual["attempts"]], ["failure", "success"])
        self.assertEqual(m.analyze(report([actual]))["latest_completed_sample"]["allocated_runner_minutes"], 2)
        api.responses["repos/o/r/actions/runs/1/attempts/2/jobs?per_page=100&page=1"]["jobs"] = [job(1)]
        with self.assertRaises(m.MetricsError):
            m.Collector(api, "o/r").run(original)


class CliTests(unittest.TestCase):
    def test_offline_replay_matches_canonical_git_lf_bytes_on_every_platform(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp) / "canonical-lf.json", Path(temp) / "replayed.json"
            fixture = report()
            fixture["methodology"] = m.METHODOLOGY
            fixture["docs"] = m.DOCS
            fixture["analysis_tool_sha256"] = hashlib.sha256(Path(m.__file__).read_bytes()).hexdigest()
            fixture["summary"] = m.analyze(fixture)
            canonical = (json.dumps(fixture, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
            source.write_bytes(canonical)
            with patch.object(m.GhApi, "get", side_effect=AssertionError("offline means no GitHub")), redirect_stdout(io.StringIO()):
                self.assertEqual(m.main(["--input", str(source), "--output", str(output)]), 0)
            self.assertNotIn(b"\r\n", output.read_bytes())
            self.assertEqual(output.read_bytes(), canonical)

    def test_real_offline_roundtrip_cli_and_no_github(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp) / "input.json", Path(temp) / "output.json"
            source.write_text(json.dumps(report()), encoding="utf-8")
            with patch.object(m.GhApi, "get", side_effect=AssertionError("offline means no GitHub")), redirect_stdout(io.StringIO()):
                self.assertEqual(m.main(["--input", str(source), "--output", str(output)]), 0)
                once = output.read_bytes()
                self.assertEqual(m.main(["--input", str(output), "--output", str(output)]), 0)
            self.assertEqual(output.read_bytes(), once)
            self.assertEqual(json.loads(once)["summary"], m.analyze(report()))

    def test_api_failure_no_success_or_partial_file(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "output.json"
            with patch.object(m.GhApi, "get", side_effect=m.ApiError(403)), redirect_stderr(io.StringIO()):
                self.assertEqual(m.main(["--output", str(output)]), 1)
            self.assertFalse(output.exists())

    def test_malformed_offline_attempts_fail_with_exit_one_not_traceback(self):
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp) / "input.json", Path(temp) / "output.json"
            fixture = report([run(attempts=[])])
            source.write_text(json.dumps(fixture), encoding="utf-8")
            with redirect_stderr(io.StringIO()):
                self.assertEqual(m.main(["--input", str(source), "--output", str(output)]), 1)
            self.assertFalse(output.exists())

    def test_read_only_get_shell_false_and_request_bound(self):
        completed = type("Result", (), {"returncode": 0, "stdout": "{}"})()
        api = m.GhApi(1)
        with patch.object(m.subprocess, "run", return_value=completed) as invoke:
            self.assertEqual(api.get("repos/o/r"), {})
            args, kwargs = invoke.call_args
            self.assertIn("GET", args[0])
            self.assertNotIn("shell", kwargs)
            with self.assertRaises(m.MetricsError):
                api.get("repos/o/r")
            self.assertEqual(invoke.call_count, 1)

    def test_transient_get_retries_are_bounded_and_auth_not_retried(self):
        bad = type("Result", (), {"returncode": 1, "stderr": "HTTP 502"})()
        good = type("Result", (), {"returncode": 0, "stdout": "{}"})()
        with patch.object(m.subprocess, "run", side_effect=[bad, good]) as invoke, patch.object(m.time, "sleep"):
            self.assertEqual(m.GhApi().get("repos/o/r"), {})
            self.assertEqual(invoke.call_count, 2)
        with patch.object(m.subprocess, "run", return_value=bad) as invoke, patch.object(m.time, "sleep"):
            with self.assertRaises(m.ApiError):
                m.GhApi().get("repos/o/r")
            self.assertEqual(invoke.call_count, 3)
        denied = type("Result", (), {"returncode": 1, "stderr": "HTTP 403 secret should never be echoed"})()
        with patch.object(m.subprocess, "run", return_value=denied) as invoke:
            with self.assertRaises(m.ApiError) as caught:
                m.GhApi().get("repos/o/r")
            self.assertNotIn("secret", str(caught.exception))
            self.assertEqual(invoke.call_count, 1)
        transport = type("Result", (), {"returncode": 1, "stderr": "connection EOF"})()
        with patch.object(m.subprocess, "run", side_effect=[transport, good]) as invoke, patch.object(m.time, "sleep"):
            self.assertEqual(m.GhApi().get("repos/o/r"), {})
            self.assertEqual(invoke.call_count, 2)


if __name__ == "__main__":
    unittest.main()
