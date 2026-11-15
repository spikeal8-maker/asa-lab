#!/usr/bin/env python3
"""Read-only GitHub Actions measurements; Python + existing PyYAML + authenticated gh.

Collect: python tools/ci_metrics.py --repo spikeal8-maker/asa-lab --limit 100 \
    --pr 850 --pr 878 --pr 875 --output baseline.json
Recalculate without GitHub: python tools/ci_metrics.py --input baseline.json --output recalculated.json
Exit codes: 0 complete requested collection/reanalysis; 1 API/data/bound failure; 2 usage.
No logs, reruns, billing credentials, local agent sessions or current execution state are read.
"""

from __future__ import annotations

import argparse
import base64
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.parse import urlencode, quote

import yaml

SCHEMA = 1
DOCS = {
    "runs": "https://docs.github.com/en/rest/actions/workflow-runs",
    "jobs": "https://docs.github.com/en/rest/actions/workflow-jobs",
    "billing": "https://docs.github.com/en/actions/how-tos/monitor-workflows/view-job-execution-time",
    "syntax": "https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax",
}
METHODOLOGY = {
    "sample": "Latest N completed runs in API created-descending order at collection time; an intentional sample, not all repository history.",
    "cohorts": "All completed runs returned for every PR commit SHA. SHA-associated, including push and pull_request events; not an exclusive attribution of cost to a PR. Cohorts overlap: never sum them.",
    "attempts": "Every run attempt fetched separately, jobs deduplicated by job ID within the run. After exhausted transient errors on the attempt-jobs route, the fully paginated generic filter=all route is accepted only with explicit valid matching run_id/run_attempt; other attempts are excluded. Every attempt retains route, fallback and capture provenance. Run count differs from attempt count; reruns are sum(run_attempt - 1).",
    "quantiles": "Sorted finite nonnegative seconds, linear interpolation at (n-1)*q (R type 7). Every distribution reports n and missing; empty quantiles are null.",
    "allocation": "Sum completed_at - started_at for jobs with a positive runner_id and valid UTC timestamps (year >= 2000). No rounding/multipliers. Missing/inverted timestamps are unknown, never zero. This is allocated runner resource time, not money or API billable minutes.",
    "cancellation": "Allocation of all measured jobs in runs whose latest conclusion is cancelled, including their earlier attempts. Separately count cancelled jobs and cancelled runs with no measurable allocation.",
    "workflow_time": "Latest attempt, positive runner_id jobs only: observed elapsed = run_started_at to last completed allocated job; observed job span = first allocated job start to last allocated job completion. Skipped/unallocated synthetic timestamps are excluded. These exclude unobserved completion overhead; updated_at is not a completion timestamp. Mixed workflows are not an L0/L1 KPI.",
    "queue": "Positive runner_id jobs only: job.created_at to started_at where both exist, including dependency/scheduler wait; not pure runner-capacity wait. Skipped/unallocated synthetic zero-delay timestamps are excluded, reported missing. First-job delay = attempt.run_started_at to first allocated job start, not trigger-to-start or rerun queue time.",
    "critical_path": "Only exact push head workflow blobs with static unique job names, no matrix/reusable/dynamic jobs and complete job mapping: longest needs-DAG path weighted by observed job execution seconds. Excludes scheduling gaps, conditions and workflow overhead. Observed span and longest job remain separate. Other cases explicitly unavailable.",
    "builds": "Executed step names matching build/compile (excluding post steps) with valid timestamps; a metadata proxy. Actual compiler rebuilds, Nx/cache hits and repeated deterministic builds cannot be inferred without separate logs/artifacts.",
    "duplicates": "Same head SHA + workflow_id with both push and pull_request events. Lists run IDs; indicates duplicate triggers, not proven redundant validation.",
    "failure": "Failed run/job/step conclusions and names only. Root cause UNKNOWN: metadata cannot prove a product or infrastructure cause. No full logs downloaded.",
    "readiness": "PR creation/ready_for_review event/merge timestamps are lifecycle only. First observed success considers every completed successful attempt for a matching commit SHA, independently of the run's latest conclusion. Successful workflow completion after a commit is not proof the required check set was ready. CI-ready/change-to-ready, regression escape and L0/L1 class metrics unavailable without check-set/classification evidence.",
    "billing": "Current public visibility implies no GitHub Actions billable minutes under documented public-repository policy. Historical visibility, paid runner products and invoices are not collected. Private-repo billable minutes and all monetary costs remain unknown. No savings claim.",
    "boundedness": "API pages up to 100, maximum 10 pages per full list, maximum 20 attempts/run and explicit global request/report-size limits. GET requests retry transport/timeouts or HTTP 502/503/504 at most twice with short backoff. Hitting a bound fails collection rather than silently truncating. Workflow-source unavailability is retained explicitly.",
}


class MetricsError(Exception):
    """An incomplete collection must not be published as complete evidence."""


class ApiError(MetricsError):
    def __init__(self, status=None, endpoint=None):
        self.status = status
        super().__init__(f"GitHub API request failed (HTTP {status or 'unknown/transport'}, endpoint={endpoint or 'unknown'}); check gh authentication/access/rate limit")


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return result if result.tzinfo and result.year >= 2000 else None
    except ValueError:
        return None


def seconds(start, end):
    a, b = timestamp(start), timestamp(end)
    if a is None or b is None:
        return None
    value = (b - a).total_seconds()
    return value if math.isfinite(value) and value >= 0 else None


def distribution(values):
    valid = sorted(x for x in values if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x >= 0)

    def quantile(q):
        if not valid:
            return None
        pos = (len(valid) - 1) * q
        low, high = math.floor(pos), math.ceil(pos)
        return round(valid[low] + (valid[high] - valid[low]) * (pos - low), 3)

    return {"n": len(valid), "missing": len(values) - len(valid), "median_seconds": quantile(.5), "p90_seconds": quantile(.9)}


def pick(obj, fields):
    return {key: obj.get(key) for key in fields.split()}


class GhApi:
    """GET only; shell=False; never surface raw stderr (which may contain credentials)."""
    def __init__(self, max_requests=2500):
        self.max_requests = max_requests
        self.requests = 0

    def get(self, endpoint):
        for attempt in range(3):
            self.requests += 1
            if self.requests > self.max_requests:
                raise MetricsError("API request bound exceeded; narrow the sample")
            try:
                response = subprocess.run(
                    ["gh", "api", "--method", "GET", "-H", "Accept: application/vnd.github+json", endpoint],
                    capture_output=True, text=True, encoding="utf-8", timeout=60, check=False,
                )
            except subprocess.TimeoutExpired as exc:
                if attempt < 2:
                    time.sleep(.5 * (attempt + 1))
                    continue
                raise ApiError(None, endpoint) from exc
            except OSError as exc:
                raise MetricsError("gh unavailable or API request timed out") from exc
            if response.returncode:
                match = re.search(r"HTTP (\d{3})", response.stderr)
                status = int(match.group(1)) if match else None
                if status in {None, 502, 503, 504} and attempt < 2:
                    time.sleep(.5 * (attempt + 1))
                    continue
                raise ApiError(status, endpoint)
            try:
                return json.loads(response.stdout)
            except ValueError as exc:
                raise MetricsError("GitHub API returned invalid JSON") from exc


def paginate(api, endpoint, key=None, limit=None, max_pages=10, timeline=False):
    """Full lists fail closed at limits. A requested latest-N sample is intentionally bounded."""
    rows, seen, expected = [], set(), None
    for page in range(1, max_pages + 1):
        separator = "&" if "?" in endpoint else "?"
        payload = api.get(f"{endpoint}{separator}per_page=100&page={page}")
        batch = payload.get(key) if key else payload
        if not isinstance(batch, list):
            raise MetricsError("Malformed paginated API list")
        if key:
            total = payload.get("total_count")
            if not isinstance(total, int) or total < 0:
                raise MetricsError("Missing pagination total_count")
            if expected is not None and total != expected:
                raise MetricsError("API list changed during pagination; recollect a stable sample")
            expected = total
        for item in batch:
            identity = item.get("id") or item.get("sha") or item.get("filename")
            if timeline:
                # Timeline also contains cross-reference events without REST IDs.
                identity = hashlib.sha256(json.dumps(item, sort_keys=True).encode()).hexdigest()
            if identity is None or identity in seen:
                raise MetricsError("Missing/duplicate identity during pagination")
            seen.add(identity)
            rows.append(item)
            if limit is not None and len(rows) >= limit:
                return rows
        if len(batch) < 100 or (expected is not None and len(rows) == expected):
            if expected is not None and len(rows) != expected:
                raise MetricsError("API pagination ended before total_count")
            # Filtered workflow-run searches have a documented 1000-result ceiling.
            if key == "workflow_runs" and expected is not None and expected >= 1000 and limit is None:
                raise MetricsError("Filtered run search reached GitHub's 1000-result ceiling")
            return rows
    raise MetricsError("Pagination bound exceeded; collection is incomplete")


def static_graph(document):
    if not isinstance(document, dict) or not isinstance(document.get("jobs"), dict):
        raise MetricsError("Workflow has no static jobs mapping")
    result = {}
    for identity, job in document["jobs"].items():
        if not isinstance(job, dict) or "strategy" in job or "uses" in job:
            raise MetricsError("Matrix/strategy/reusable workflow jobs unsupported")
        name = job.get("name", identity)
        needs = job.get("needs", [])
        needs = [needs] if isinstance(needs, str) else needs
        if not isinstance(name, str) or "${{" in name or not isinstance(needs, list) or any(not isinstance(n, str) or "${{" in n for n in needs):
            raise MetricsError("Dynamic job name/dependency unsupported")
        result[identity] = {"name": name, "needs": needs}
    if len({job["name"] for job in result.values()}) != len(result):
        raise MetricsError("Nonunique static job names")
    if any(n not in result for job in result.values() for n in job["needs"]):
        raise MetricsError("Unknown static dependency")
    return result


def critical_path(graph, jobs):
    unavailable = {"seconds": None, "path": None, "reason": "exact static graph or complete unique job mapping unavailable"}
    if not graph:
        return unavailable
    by_name = defaultdict(list)
    for job in jobs:
        by_name[job["name"]].append(job)
    if set(by_name) != {v["name"] for v in graph.values()} or any(len(v) != 1 for v in by_name.values()):
        return unavailable
    weights = {}
    for identity, definition in graph.items():
        job = by_name[definition["name"]][0]
        duration = seconds(job.get("started_at"), job.get("completed_at"))
        if job.get("conclusion") == "skipped":
            duration = 0
        if job.get("conclusion") not in {"success", "skipped"}:
            return {"seconds": None, "path": None, "reason": "Failed/cancelled/incomplete jobs do not establish a completed execution DAG path"}
        if duration is None:
            return {"seconds": None, "path": None, "reason": "Job execution timestamps unavailable or invalid"}
        weights[identity] = duration
    memo, visiting = {}, set()

    def visit(identity):
        if identity in visiting:
            raise MetricsError("Cyclic workflow DAG")
        if identity not in memo:
            visiting.add(identity)
            previous = [visit(dep) for dep in graph[identity]["needs"]]
            weight, path = max(previous, key=lambda v: v[0]) if previous else (0, [])
            memo[identity] = (weight + weights[identity], path + [identity])
            visiting.remove(identity)
        return memo[identity]

    try:
        weight, path = max((visit(identity) for identity in graph), key=lambda v: v[0])
        return {"seconds": weight, "path": path, "reason": None}
    except (MetricsError, ValueError):
        return unavailable


class Collector:
    def __init__(self, api, repo):
        self.api, self.repo = api, repo
        self.prefix = f"repos/{repo}"
        self.graphs = {}

    def attempt_jobs(self, run_id, number):
        endpoint = f"{self.prefix}/actions/runs/{run_id}/attempts/{number}/jobs"
        provenance = {"endpoint": endpoint, "method": "attempt_jobs", "fallback_after_http": None}
        try:
            jobs = paginate(self.api, endpoint, "jobs")
            for job in jobs:
                if job.get("run_id", run_id) != run_id or job.get("run_attempt", number) != number:
                    raise MetricsError("Attempt-jobs endpoint returned a mismatched run/attempt")
        except ApiError as exc:
            if exc.status not in {None, 502, 503, 504}:
                raise
            generic = f"{self.prefix}/actions/runs/{run_id}/jobs?filter=all"
            all_jobs = paginate(self.api, generic, "jobs")
            jobs = []
            for job in all_jobs:
                # Never infer an attempt from latest-run metadata or list position.
                if any(type(job.get(key)) is not int or job[key] <= 0 for key in ("id", "run_id", "run_attempt")):
                    raise MetricsError("Generic jobs fallback lacks explicit positive job/run/attempt identity")
                if job["run_id"] != run_id:
                    raise MetricsError("Generic jobs fallback returned a different run_id")
                if job["run_attempt"] == number:
                    jobs.append(job)
            provenance = {"endpoint": generic, "method": "generic_all_filtered_by_explicit_attempt", "fallback_after_http": exc.status,
                          "failed_endpoint": endpoint, "generic_jobs_total": len(all_jobs)}
        provenance["captured_at"] = datetime.now(timezone.utc).isoformat()
        return jobs, provenance

    def workflow(self, run):
        # PR workflow comes from GitHub's merge context; head SHA alone is insufficient.
        if run.get("event") != "push" or not re.fullmatch(r"\.github/workflows/[^@]+\.ya?ml", run.get("path") or ""):
            return None
        key = run["head_sha"] + ":" + run["path"]
        if key not in self.graphs:
            source = {"head_sha": run["head_sha"], "path": run["path"], "blob_sha": None, "graph": None, "unavailable_reason": None}
            try:
                endpoint = f"{self.prefix}/contents/{quote(run['path'])}?{urlencode({'ref': run['head_sha']})}"
                blob = self.api.get(endpoint)
                data = base64.b64decode(blob["content"], validate=False)
                digest = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
                if digest != blob.get("sha"):
                    raise MetricsError("Workflow blob hash mismatch")
                source["blob_sha"] = digest
                source["graph"] = static_graph(yaml.safe_load(data))
            except ApiError as exc:
                if exc.status not in {403, 404, 410}:
                    raise
                source["unavailable_reason"] = f"workflow source HTTP {exc.status}"
            except (MetricsError, KeyError, ValueError, yaml.YAMLError) as exc:
                source["unavailable_reason"] = str(exc)[:180]
            self.graphs[key] = source
        return key

    def run(self, original):
        run = pick(original, "id workflow_id name path head_sha head_branch event status conclusion run_attempt created_at run_started_at updated_at html_url")
        attempts = run["run_attempt"]
        if type(attempts) is not int or not 1 <= attempts <= 20:
            raise MetricsError("Invalid or excessive run_attempt")
        run["workflow_source"] = self.workflow(run)
        run["attempts"] = []
        all_jobs = set()
        for number in range(1, attempts + 1):
            endpoint = f"{self.prefix}/actions/runs/{run['id']}/attempts/{number}"
            metadata = original if number == attempts else self.api.get(endpoint)
            attempt = pick(metadata, "run_started_at created_at updated_at status conclusion")
            attempt["number"] = number
            attempt["jobs"] = []
            sources, attempt["jobs_source"] = self.attempt_jobs(run["id"], number)
            for source in sources:
                if source["id"] in all_jobs:
                    raise MetricsError("Job ID repeated across attempts")
                all_jobs.add(source["id"])
                job = pick(source, "id run_id run_attempt name status conclusion created_at started_at completed_at runner_id")
                job["steps"] = [pick(step, "number name conclusion started_at completed_at") for step in source.get("steps", [])]
                attempt["jobs"].append(job)
            run["attempts"].append(attempt)
        return run

    def collect(self, limit, prs):
        started_at = datetime.now(timezone.utc).isoformat()
        repository = self.api.get(self.prefix)
        latest = paginate(self.api, self.prefix + "/actions/runs?status=completed", "workflow_runs", limit)
        candidates = {run["id"]: run for run in latest}
        cohorts = {}
        for number in prs:
            source = self.api.get(f"{self.prefix}/pulls/{number}")
            pr = pick(source, "number created_at merged_at closed_at draft html_url")
            pr["snapshot_head_sha"] = source["head"]["sha"]
            pr["snapshot_base_sha"] = source["base"]["sha"]
            changed = paginate(self.api, f"{self.prefix}/pulls/{number}/files")
            if len(changed) != source.get("changed_files"):
                raise MetricsError("PR changed-file list incomplete/changed")
            pr["changed_files"] = [pick(f, "filename status previous_filename") for f in changed]
            commits = paginate(self.api, f"{self.prefix}/pulls/{number}/commits")
            if source.get("commits") != len(commits):
                raise MetricsError("PR commits incomplete/changed (GitHub also caps this endpoint at 250)")
            pr["commits"] = [{"sha": c["sha"], "committed_at": c["commit"]["committer"]["date"]} for c in commits]
            events = paginate(self.api, f"{self.prefix}/issues/{number}/timeline", timeline=True)
            pr["readiness_events"] = [pick(e, "id event created_at") for e in events if e.get("event") in {"ready_for_review", "converted_to_draft"}]
            ids = set()
            for commit in commits:
                for run in paginate(self.api, self.prefix + "/actions/runs?" + urlencode({"head_sha": commit["sha"], "status": "completed"}), "workflow_runs"):
                    candidates[run["id"]] = run
                    ids.add(run["id"])
            pr["run_ids"] = sorted(ids)
            final_pr = self.api.get(f"{self.prefix}/pulls/{number}")
            if (final_pr["head"]["sha"], final_pr["base"]["sha"], final_pr.get("commits"), final_pr.get("changed_files")) != (source["head"]["sha"], source["base"]["sha"], source.get("commits"), source.get("changed_files")):
                raise MetricsError("PR head/base changed during collection; no mixed snapshot published")
            pr["head_base_stable_during_pr_collection"] = True
            cohorts[str(number)] = pr
        raw = {"repository": pick(repository, "full_name private"), "latest_run_ids": [r["id"] for r in latest], "prs": cohorts,
               "runs": [self.run(candidates[k]) for k in sorted(candidates)], "workflow_sources": self.graphs}
        return {"schema_version": SCHEMA, "collection_started_at": started_at, "collected_at": datetime.now(timezone.utc).isoformat(), "source": "GitHub REST via gh api GET; no logs",
                "request": {"repo": self.repo, "latest_completed_limit": limit, "prs": prs}, "docs": DOCS, "methodology": METHODOLOGY, "raw": raw}


def has_runner(job):
    runner = job.get("runner_id")
    return type(runner) is int and runner > 0


def job_duration(job):
    return seconds(job.get("started_at"), job.get("completed_at")) if has_runner(job) else None


def observed_times(attempt):
    jobs = [job for job in attempt["jobs"] if has_runner(job)]
    started = [j["started_at"] for j in jobs if timestamp(j.get("started_at"))]
    completed = [j["completed_at"] for j in jobs if seconds(j.get("started_at"), j.get("completed_at")) is not None]
    first = min(started, key=timestamp) if started else None
    last = max(completed, key=timestamp) if completed else None
    return {"observed_elapsed_seconds": seconds(attempt.get("run_started_at"), last), "observed_job_span_seconds": seconds(first, last),
            "first_job_delay_seconds": seconds(attempt.get("run_started_at"), first), "last_job_completed_at": last}


def summarize_group(runs, graphs):
    jobs = [j for r in runs for a in r["attempts"] for j in a["jobs"]]
    measured = [job_duration(j) for j in jobs]
    cancelled = [r for r in runs if r["conclusion"] == "cancelled"]
    cancelled_durations = [job_duration(j) for r in cancelled for a in r["attempts"] for j in a["jobs"]]
    details, failures, duplicates = [], [], defaultdict(list)
    for run in runs:
        latest = run["attempts"][-1]
        time = observed_times(latest)
        source = graphs.get(run.get("workflow_source")) or {}
        path = critical_path(source.get("graph"), latest["jobs"])
        if path["seconds"] is None and not source.get("graph"):
            path["reason"] = source.get("unavailable_reason") or "Exact push-head workflow source unavailable for this event/path"
        durations = [job_duration(j) for j in latest["jobs"]]
        details.append({"run_id": run["id"], **time,
                        "longest_measured_job_seconds": max((v for v in durations if v is not None), default=None),
                        "execution_weighted_dag_path": path})
        duplicates[(run["head_sha"], run["workflow_id"])].append(run)
        for attempt in run["attempts"]:
            if attempt["conclusion"] in {"failure", "timed_out", "action_required", "startup_failure"}:
                failures.append({"run_id": run["id"], "attempt": attempt["number"], "conclusion": attempt["conclusion"], "root_cause": "UNKNOWN",
                                 "failed_jobs": [{"id": j["id"], "name": j["name"], "conclusion": j["conclusion"],
                                                  "steps": [{"number": s["number"], "name": s["name"], "conclusion": s["conclusion"]} for s in j["steps"] if s["conclusion"] in {"failure", "timed_out"}]}
                                                 for j in attempt["jobs"] if j["conclusion"] not in {"success", "skipped", "cancelled", None}]})
    by_workflow = {}
    for workflow in sorted({str(r["workflow_id"]) for r in runs}):
        selected = [r for r in runs if str(r["workflow_id"]) == workflow]
        selected_ids = {r["id"] for r in selected}
        selected_details = [d for d in details if d["run_id"] in selected_ids]
        successful_ids = {r["id"] for r in selected if r["conclusion"] == "success"}
        by_workflow[workflow] = {"name": selected[0]["name"], "runs": len(selected), "conclusions": dict(Counter(r["conclusion"] for r in selected)),
                                 "critical_path_coverage": {"measured": sum(d["execution_weighted_dag_path"]["seconds"] is not None for d in selected_details),
                                                            "unavailable_reasons": dict(Counter(d["execution_weighted_dag_path"]["reason"] for d in selected_details if d["execution_weighted_dag_path"]["seconds"] is None))},
                                 "observed_elapsed": distribution([d["observed_elapsed_seconds"] for d in selected_details]),
                                 "successful_observed_elapsed": distribution([d["observed_elapsed_seconds"] for d in selected_details if d["run_id"] in successful_ids])}
    builds = [s for j in jobs for s in j["steps"] if re.search(r"\b(build|compile)\b", s.get("name") or "", re.I)
              and not (s.get("name") or "").lower().startswith("post ") and s.get("conclusion") != "skipped"
              and seconds(s.get("started_at"), s.get("completed_at")) is not None]
    return {"runs": len(runs), "attempts": sum(len(r["attempts"]) for r in runs), "rerun_attempts": sum(len(r["attempts"]) - 1 for r in runs),
            "distinct_head_shas": len({r["head_sha"] for r in runs}), "conclusions": dict(Counter(r["conclusion"] for r in runs)),
            "jobs": len(jobs), "measured_job_durations": distribution(measured),
            "allocated_runner_minutes": round(sum(v for v in measured if v is not None) / 60, 4),
            "cancelled_runs": len(cancelled), "cancelled_jobs": sum(j["conclusion"] == "cancelled" for j in jobs),
            "cancelled_run_allocated_minutes": round(sum(v for v in cancelled_durations if v is not None) / 60, 4),
            "cancelled_runs_without_measurable_allocation": sum(not any(job_duration(j) is not None for a in r["attempts"] for j in a["jobs"]) for r in cancelled),
            "job_queue": distribution([seconds(j.get("created_at"), j.get("started_at")) if has_runner(j) else None for j in jobs]),
            "observed_elapsed": distribution([d["observed_elapsed_seconds"] for d in details]),
            "build_step_executions_proxy": len(builds), "actual_compiler_rebuilds": None, "cache_hits": None,
            "same_sha_workflow_extra_runs": sum(len(group) - 1 for group in duplicates.values()),
            "duplicate_push_pr_groups": [{"head_sha": sha, "workflow_id": workflow, "run_ids": sorted(r["id"] for r in group)}
                                         for (sha, workflow), group in sorted(duplicates.items()) if {"push", "pull_request"} <= {r["event"] for r in group}],
            "by_workflow": by_workflow, "run_observations": details, "failure_metadata": failures}


def analyze(report):
    if report.get("schema_version") != SCHEMA or not isinstance(report.get("raw"), dict):
        raise MetricsError("Unsupported report schema/raw metadata")
    raw = report["raw"]
    by_id = {r["id"]: r for r in raw["runs"]}
    if len(by_id) != len(raw["runs"]):
        raise MetricsError("Duplicate raw run IDs")
    latest = [by_id[identity] for identity in raw["latest_run_ids"]]
    result = {"latest_completed_sample": summarize_group(latest, raw["workflow_sources"]), "prs": {}}
    for number, pr in raw["prs"].items():
        cohort = [by_id[identity] for identity in pr["run_ids"]]
        lifecycle = {"created_to_merge_seconds": seconds(pr["created_at"], pr["merged_at"]),
                     "ready_for_review_at": next((e["created_at"] for e in pr["readiness_events"] if e["event"] == "ready_for_review"), None),
                     "ci_ready_at": None, "change_to_ci_ready_seconds": None, "reason": "Required-check readiness and original review-ready time are not established by lifecycle/Actions metadata."}
        after_commit = []
        for commit in pr["commits"]:
            completions = [observed_times(attempt)["last_job_completed_at"]
                           for r in cohort if r["head_sha"] == commit["sha"]
                           for attempt in r["attempts"]
                           if attempt.get("status") == "completed" and attempt.get("conclusion") == "success"]
            deltas = [seconds(commit["committed_at"], end) for end in completions]
            after_commit.append(min((v for v in deltas if v is not None), default=None))
        result["prs"][number] = {**summarize_group(cohort, raw["workflow_sources"]), "lifecycle": lifecycle,
                                 "commit_to_first_observed_success": distribution(after_commit), "ci_cycles_proxy_distinct_shas": len({r["head_sha"] for r in cohort})}
    result["billing"] = {"status": "public_no_billable_minutes" if raw["repository"]["private"] is False else "unavailable",
                         "public_policy_billable_minutes": 0 if raw["repository"]["private"] is False else None,
                         "api_billable_minutes": None, "monetary_cost": None, "reason": METHODOLOGY["billing"]}
    result["unavailable"] = {"agent_tokens": None, "reason": "No authorized per-slice model usage source available; local sessions are not inspected.",
                              "l0_l1_classification": None, "regressions_detected_or_missed": None, "ci_ready_latency": None}
    return result


def render_summary(report):
    summary = report["summary"]["latest_completed_sample"]
    elapsed = summary["observed_elapsed"]
    return (f"Latest completed sample: {summary['runs']} runs, {summary['attempts']} attempts, {summary['jobs']} jobs; "
            f"allocated {summary['allocated_runner_minutes']:.2f} runner-min, cancelled-run allocation {summary['cancelled_run_allocated_minutes']:.2f} min.\n"
            f"Mixed-workflow observed elapsed: median {elapsed['median_seconds']}s / p90 {elapsed['p90_seconds']}s (n={elapsed['n']}, missing={elapsed['missing']}).\n"
            f"PR SHA cohorts: {', '.join(report['summary']['prs']) or 'none'} (overlap; do not sum). Billing: {report['summary']['billing']['status']}; money/tokens/CI-ready unavailable.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", default="spikeal8-maker/asa-lab")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--pr", type=int, action="append", default=[])
    parser.add_argument("--input", type=Path, help="Recalculate saved curated metadata offline; no gh/API calls")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-requests", type=int, default=2500)
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repo) or not 1 <= args.limit <= 1000 or any(n <= 0 for n in args.pr) or not 1 <= args.max_requests <= 10000:
        parser.error("Use owner/repo, limit 1..1000, positive PRs and max-requests 1..10000")
    try:
        if args.input:
            report = json.loads(args.input.read_text(encoding="utf-8"))
        else:
            report = Collector(GhApi(args.max_requests), args.repo).collect(args.limit, list(dict.fromkeys(args.pr)))
        # Reanalysis updates definitions/code identity, never raw capture provenance/time.
        report["methodology"] = METHODOLOGY
        report["docs"] = DOCS
        report["analysis_tool_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        report["summary"] = analyze(report)
        content = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        if len(content.encode("utf-8")) > 8 * 1024 * 1024:
            raise MetricsError("Report exceeds 8 MiB bound; narrow sample")
        args.output.write_text(content, encoding="utf-8", newline="\n")
        print(render_summary(report))
        return 0
    except (MetricsError, OSError, ValueError, KeyError, TypeError, IndexError) as exc:
        print(f"ci_metrics: incomplete report: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
