#!/usr/bin/env python3
"""Transactional consistency check for the ASA Lab control plane.

docs/execution/current.yaml is the single source of execution state. Every other
surface — entry point, policy, delivery manifest, project map, active test
registry, Git, and the GitHub pull request — must either agree with it or stay
silent about state entirely. Any disagreement is a FAIL, never a judgement call.

GitHub checks are skipped (not failed) when `gh` is unavailable or unauthenticated,
so the same command runs locally, in CI and offline. Pass --require-github to turn
a skipped remote check into a failure.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
CURRENT_PATH = ROOT / "docs/execution/current.yaml"
START_HERE_PATH = ROOT / "START_HERE_FOR_AI.md"
AGENTS_PATH = ROOT / "AGENTS.md"
MANIFEST_PATH = ROOT / "docs/delivery/EXECUTION_MANIFEST.yaml"
MAP_PATH = ROOT / "docs/project-map/project-map.yaml"
ACTIVE_TESTS_PATH = ROOT / "docs/testing/active-task-tests.yaml"
CATALOG_VALIDATOR_PATH = ROOT / "tools/validate_test_catalog.py"
PACKAGE_JSON_PATH = ROOT / "package.json"

TASK_ID_PATTERN = re.compile(r"\bTASK-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}\b")
BRANCH_PATTERN = re.compile(r"\bagent/[a-z0-9][a-z0-9./_-]*", re.IGNORECASE)
SHA_PATTERN = re.compile(r"\b[0-9a-f]{40}\b")

# Documents that describe policy or process and must not restate execution state.
STATELESS_DOCUMENTS = (START_HERE_PATH, AGENTS_PATH)

# Keys that used to be duplicated into the delivery manifest.
FORBIDDEN_MANIFEST_KEYS = (
    "active_task",
    "active_branch",
    "active_issue",
    "active_checkpoint",
    "sole_executor",
    "assistant_role",
)

REQUIRED_TASK_FIELDS = ("id", "issue", "branch", "base_branch", "pr", "status", "checkpoint")
ALLOWED_STATUSES = {"ready", "in_progress", "in_review", "blocked", "done"}
ALLOWED_GATE_RESULTS = {"PASS", "FAIL", "NOT_RUN", "BLOCKED"}
ISO_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")

# Engineering invariants AGENTS.md states as already in force. A policy claim
# that nothing checks is how the documents drifted apart in the first place, so
# each one here is a grep the governance gate actually runs.
SOURCE_INVARIANTS = (
    (
        "contexts/electronics/domain/netlist.ts",
        re.compile(r"\blocaleCompare\b"),
        "net numbering must not depend on runtime locale (AGENTS.md §5); "
        "use code-unit comparison instead of localeCompare",
    ),
)


def run(command: list[str], cwd: Path = ROOT) -> tuple[int, str]:
    try:
        result = subprocess.run(
            command, cwd=cwd, capture_output=True, text=True, timeout=90, check=False
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return 1, str(exc)
    return result.returncode, (result.stdout or result.stderr).strip()


def load_yaml(path: Path, errors: list[str]) -> Any:
    if not path.is_file():
        errors.append(f"Missing required file: {path.relative_to(ROOT)}")
        return None
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - surfaced verbatim to the operator
        errors.append(f"Cannot parse {path.relative_to(ROOT)}: {exc}")
        return None


def check_current(current: Any, errors: list[str]) -> dict[str, Any]:
    if not isinstance(current, dict):
        errors.append("current.yaml must be a mapping")
        return {}
    task = current.get("task")
    if not isinstance(task, dict):
        errors.append("current.yaml must contain a task mapping")
        return {}
    for field in REQUIRED_TASK_FIELDS:
        if task.get(field) in (None, ""):
            errors.append(f"current.yaml task.{field} must be set")
    if task.get("status") not in ALLOWED_STATUSES:
        errors.append(f"current.yaml task.status invalid: {task.get('status')!r}")
    if not TASK_ID_PATTERN.fullmatch(str(task.get("id", ""))):
        errors.append(f"current.yaml task.id invalid: {task.get('id')!r}")
    check_lease(current.get("execution_lease"), errors)
    check_gate_shape(current.get("gates"), errors)
    return task


def check_lease(lease: Any, errors: list[str]) -> None:
    """The lease decides who may write. Declaring it is not enough to trust it."""
    if not isinstance(lease, dict):
        errors.append("current.yaml must declare an execution_lease mapping")
        return
    holder = lease.get("holder")
    executor = lease.get("executor_id")
    acquired = lease.get("acquired_at")
    expires = lease.get("expires_at")
    if not isinstance(executor, str) or not executor.strip():
        errors.append("execution_lease.executor_id must be a non-empty string")
    if holder is None or (not isinstance(holder, str)) or not holder.strip():
        errors.append("execution_lease.holder must be 'unassigned' or the executor id")
        return
    if holder not in {"unassigned", executor}:
        errors.append(
            f"execution_lease.holder {holder!r} must be 'unassigned' or the declared "
            f"executor_id {executor!r}; a second agent cannot grant itself the lease"
        )
    if holder == "unassigned":
        # An unheld lease must not carry the timestamps of a held one, or a
        # reader cannot tell a released lease from a live one.
        if acquired is not None:
            errors.append("execution_lease.acquired_at must be null while holder is unassigned")
        if expires is not None:
            errors.append("execution_lease.expires_at must be null while holder is unassigned")
        return
    parsed: dict[str, datetime] = {}
    for field, value in (("acquired_at", acquired), ("expires_at", expires)):
        if not isinstance(value, str) or not ISO_TIMESTAMP.fullmatch(value):
            errors.append(
                f"execution_lease.{field} must be an ISO-8601 timestamp while the lease is held"
            )
            continue
        try:
            # Compared as instants, not as text: two timestamps written in
            # different UTC offsets sort correctly one way and not the other.
            moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            errors.append(f"execution_lease.{field} is not a valid timestamp: {exc}")
            continue
        if moment.tzinfo is None:
            errors.append(f"execution_lease.{field} must carry a UTC offset")
            continue
        parsed[field] = moment
    if len(parsed) == 2:
        if parsed["expires_at"] <= parsed["acquired_at"]:
            errors.append("execution_lease.expires_at must be after acquired_at")
        elif parsed["expires_at"] <= datetime.now(timezone.utc):
            # A lease nobody released still locks out every other agent. Expiry
            # has to be observed, or the lock outlives the work it protected.
            errors.append(
                f"execution_lease expired at {expires}; release or extend it before working"
            )


def check_gate_shape(gates: Any, errors: list[str]) -> None:
    if not isinstance(gates, dict) or not gates:
        errors.append("current.yaml must declare gates")
        return
    for name, gate in gates.items():
        if not isinstance(gate, dict):
            errors.append(f"current.yaml gates.{name} must be a mapping")
            continue
        if gate.get("status") not in ALLOWED_GATE_RESULTS:
            errors.append(
                f"current.yaml gates.{name}.status must be one of "
                f"{', '.join(sorted(ALLOWED_GATE_RESULTS))}"
            )
        if "last_known" in gate:
            errors.append(
                f"current.yaml gates.{name} uses last_known; a result must be recorded as "
                "status plus the verified_sha it was observed on"
            )
        if not isinstance(gate.get("workflow"), str):
            errors.append(f"current.yaml gates.{name}.workflow must name a GitHub workflow")


def check_source_invariants(errors: list[str]) -> None:
    for relative, pattern, message in SOURCE_INVARIANTS:
        path = ROOT / relative
        if not path.is_file():
            errors.append(f"Invariant target is missing: {relative}")
            continue
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            # The rationale comment names the forbidden call; only code counts.
            stripped = line.lstrip()
            if stripped.startswith(("*", "//", "/*")):
                continue
            if pattern.search(line):
                errors.append(f"{relative}:{line_number} violates an AGENTS.md invariant — {message}")


def check_stateless_documents(errors: list[str]) -> None:
    """Policy and entry-point documents must not hard-code execution state."""
    for path in STATELESS_DOCUMENTS:
        if not path.is_file():
            errors.append(f"Missing required file: {path.relative_to(ROOT)}")
            continue
        name = path.relative_to(ROOT)
        text = path.read_text(encoding="utf-8")
        for line_number, line in enumerate(text.splitlines(), start=1):
            # A reference to the state file itself is the whole point; allow it.
            if "current.yaml" in line:
                continue
            for pattern, label in (
                (TASK_ID_PATTERN, "task id"),
                (BRANCH_PATTERN, "product branch"),
                (SHA_PATTERN, "commit SHA"),
            ):
                found = pattern.search(line)
                if found:
                    errors.append(
                        f"{name}:{line_number} hard-codes {label} {found.group(0)!r}; "
                        "state belongs only in docs/execution/current.yaml"
                    )


def check_manifest(task: dict[str, Any], errors: list[str]) -> None:
    manifest = load_yaml(MANIFEST_PATH, errors)
    if not isinstance(manifest, dict):
        return
    canonical = manifest.get("canonical_state")
    if isinstance(canonical, dict):
        for key in FORBIDDEN_MANIFEST_KEYS:
            if key in canonical:
                errors.append(
                    f"EXECUTION_MANIFEST.yaml canonical_state.{key} duplicates current.yaml"
                )
    if manifest.get("execution_state_source") != "docs/execution/current.yaml":
        errors.append(
            "EXECUTION_MANIFEST.yaml must declare "
            "execution_state_source: docs/execution/current.yaml"
        )
    tasks = manifest.get("tasks")
    if not isinstance(tasks, list):
        errors.append("EXECUTION_MANIFEST.yaml must contain a tasks array")
        return
    entry = next(
        (item for item in tasks if isinstance(item, dict) and item.get("task_id") == task.get("id")),
        None,
    )
    if entry is None:
        errors.append(f"EXECUTION_MANIFEST.yaml has no task {task.get('id')}")
        return
    if entry.get("status") != task.get("status"):
        errors.append(
            f"EXECUTION_MANIFEST.yaml task status {entry.get('status')!r} != "
            f"current.yaml {task.get('status')!r}"
        )
    for manifest_key, task_key in (("branch", "branch"), ("checkpoint", "checkpoint")):
        if manifest_key in entry and entry.get(manifest_key) != task.get(task_key):
            errors.append(
                f"EXECUTION_MANIFEST.yaml task {manifest_key} {entry.get(manifest_key)!r} != "
                f"current.yaml {task.get(task_key)!r}"
            )


def check_project_map(task: dict[str, Any], errors: list[str]) -> None:
    document = load_yaml(MAP_PATH, errors)
    if not isinstance(document, dict):
        return
    project = document.get("project")
    project = project if isinstance(project, dict) else document
    if project.get("current_focus") != task.get("id"):
        errors.append(
            f"project-map.yaml current_focus {project.get('current_focus')!r} != "
            f"current.yaml task.id {task.get('id')!r}"
        )
    if project.get("active_checkpoint") != task.get("checkpoint"):
        errors.append(
            f"project-map.yaml active_checkpoint {project.get('active_checkpoint')!r} != "
            f"current.yaml task.checkpoint {task.get('checkpoint')!r}"
        )
    nodes = document.get("nodes")
    if isinstance(nodes, list):
        node = next(
            (item for item in nodes if isinstance(item, dict) and item.get("id") == task.get("id")),
            None,
        )
        if node is not None and node.get("status") != task.get("status"):
            errors.append(
                f"project-map.yaml node {task.get('id')} status {node.get('status')!r} != "
                f"current.yaml {task.get('status')!r}"
            )


def check_active_tests(task: dict[str, Any], errors: list[str]) -> None:
    document = load_yaml(ACTIVE_TESTS_PATH, errors)
    if not isinstance(document, dict):
        return
    if document.get("active_task") != task.get("id"):
        errors.append(
            f"active-task-tests.yaml active_task {document.get('active_task')!r} != "
            f"current.yaml task.id {task.get('id')!r}"
        )


def check_catalog_validator(errors: list[str]) -> None:
    if not CATALOG_VALIDATOR_PATH.is_file():
        errors.append("Missing tools/validate_test_catalog.py")
        return
    text = CATALOG_VALIDATOR_PATH.read_text(encoding="utf-8")
    if re.search(r'^ACTIVE_TASK\s*=\s*"', text, re.MULTILINE):
        errors.append(
            "tools/validate_test_catalog.py hard-codes ACTIVE_TASK; "
            "it must read docs/execution/current.yaml"
        )


def check_gate_scripts(current: dict[str, Any], errors: list[str]) -> None:
    try:
        scripts = json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8")).get("scripts", {})
    except Exception as exc:  # noqa: BLE001
        errors.append(f"Cannot read package.json: {exc}")
        return
    gates = current.get("gates")
    if not isinstance(gates, dict):
        errors.append("current.yaml must declare gates")
        return
    for name, gate in gates.items():
        if not isinstance(gate, dict):
            errors.append(f"current.yaml gates.{name} must be a mapping")
            continue
        commands = gate.get("commands")
        if not isinstance(commands, list) or not commands:
            errors.append(f"current.yaml gates.{name}.commands must be a non-empty list")
            continue
        for command in commands:
            script = str(command).removeprefix("pnpm ").strip()
            if not script or script not in scripts:
                errors.append(
                    f"current.yaml gates.{name} references {command!r}, "
                    "which is not a package.json script"
                )
    if "control-plane:check" not in scripts:
        errors.append("package.json must expose the control-plane:check script")


def check_git(task: dict[str, Any], errors: list[str], notes: list[str]) -> str | None:
    code, head = run(["git", "rev-parse", "HEAD"])
    if code != 0:
        errors.append(f"Cannot resolve git HEAD: {head}")
        return None
    branch = str(task.get("branch"))
    code, _ = run(["git", "rev-parse", "--verify", f"refs/remotes/origin/{branch}"])
    if code != 0:
        errors.append(f"Product branch origin/{branch} does not exist on the remote")
    code, current_branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    if code == 0 and current_branch != branch:
        notes.append(
            f"working on {current_branch}, product branch is {branch} (allowed for control-plane work)"
        )
    return head


def check_github(task: dict[str, Any], errors: list[str], notes: list[str], require: bool) -> None:
    code, _ = run(["gh", "auth", "status"])
    if code != 0:
        message = "GitHub checks skipped: gh is unavailable or unauthenticated"
        (errors if require else notes).append(message)
        return
    pr = task.get("pr")
    code, payload = run(
        ["gh", "pr", "view", str(pr), "--json", "number,isDraft,state,headRefName,headRefOid,body"]
    )
    if code != 0:
        (errors if require else notes).append(f"GitHub checks skipped: cannot read PR #{pr}")
        return
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        errors.append(f"Cannot parse PR #{pr} payload: {exc}")
        return
    if data.get("headRefName") != task.get("branch"):
        errors.append(
            f"PR #{pr} head branch {data.get('headRefName')!r} != "
            f"current.yaml task.branch {task.get('branch')!r}"
        )
    # A closed or merged PR cannot be the one an in-flight task points at, and a
    # PR silently taken out of Draft is an owner decision the control plane must
    # not discover by accident.
    if data.get("state") != "OPEN":
        errors.append(
            f"PR #{pr} is {data.get('state')}, but current.yaml still names it as the "
            f"pull request for {task.get('id')}"
        )
    expected_draft = task.get("pr_draft")
    if isinstance(expected_draft, bool) and bool(data.get("isDraft")) != expected_draft:
        errors.append(
            f"PR #{pr} isDraft={data.get('isDraft')} but current.yaml declares "
            f"task.pr_draft={expected_draft}"
        )
    head_oid = str(data.get("headRefOid", ""))
    body = str(data.get("body") or "")
    # A body that never mentions the current head is describing a different
    notes.append(f"PR #{pr}: draft={data.get('isDraft')} state={data.get('state')} head={head_oid[:7]}")
    head_verified = check_gate_results(task, head_oid, errors, notes, require)
    check_pr_body(task, pr, head_oid, body, head_verified, errors, notes)


def check_pr_body(
    task: dict[str, Any],
    pr: Any,
    head_oid: str,
    body: str,
    head_verified: bool,
    errors: list[str],
    notes: list[str],
) -> None:
    """The body must describe an identified revision, and a review claim must
    describe the current one.

    Demanding the current head unconditionally would turn every ordinary push
    into a red gate, which trains people to ignore the check. The rule instead
    scales with what is being claimed: while work is in progress the body may
    describe the last verified revision, but a task offered for review must
    describe the head a reviewer will actually see.
    """
    if not head_oid:
        return
    verified = {
        str(gate.get("verified_sha"))
        for gate in (task.get("_gates") or {}).values()
        if isinstance(gate.get("verified_sha"), str)
    }
    if head_oid in body:
        return
    if str(task.get("status")) == "in_review":
        errors.append(
            f"PR #{pr} body does not reference the current head {head_oid[:7]} while "
            f"{task.get('id')} is in_review; a review claim must describe the revision "
            "a reviewer sees"
        )
        return
    if verified & set(re.findall(SHA_PATTERN, body)):
        notes.append(
            f"PR #{pr} body describes the last verified revision, not head {head_oid[:7]}; "
            "refresh it before returning the task to review"
        )
        return
    errors.append(
        f"PR #{pr} body references neither the current head {head_oid[:7]} nor any "
        "verified revision from current.yaml; it describes an unidentified state"
    )


def check_gate_results(
    task: dict[str, Any], head_oid: str, errors: list[str], notes: list[str], require: bool
) -> bool:
    """Check that each recorded gate result is a fact GitHub can confirm.

    A result is a pair: `status` and the `verified_sha` it was observed on. That
    pair is history, so it can always be checked without waiting for anything.

    Comparing the record against the *current* head instead would deadlock: the
    first run on a new head is the one asking the question, so no completed run
    exists yet and every push would fail. Whether the head itself is verified is
    a separate question, answered by the return value and enforced only where a
    claim depends on it.

    Returns True when every gate's verified_sha is the current head.
    """
    conclusion_to_result = {"success": "PASS", "failure": "FAIL", "cancelled": "NOT_RUN"}
    gates = task.get("_gates") or {}
    head_verified = bool(gates)
    for name, gate in gates.items():
        workflow = gate.get("workflow")
        recorded = gate.get("status")
        verified_sha = gate.get("verified_sha")

        if recorded == "NOT_RUN":
            if verified_sha is not None:
                errors.append(
                    f"current.yaml gates.{name} is NOT_RUN but names verified_sha; "
                    "a result that was never observed has no revision"
                )
            notes.append(f"gate {name}: NOT_RUN, awaiting a run")
            head_verified = False
            continue
        if not isinstance(verified_sha, str) or not SHA_PATTERN.fullmatch(verified_sha):
            errors.append(
                f"current.yaml gates.{name} records {recorded} without a full verified_sha; "
                "a result must name the revision it was observed on"
            )
            head_verified = False
            continue
        if verified_sha != head_oid:
            head_verified = False

        code, payload = run(
            [
                "gh", "run", "list",
                "--branch", str(task.get("branch")),
                "--workflow", str(workflow),
                "--limit", "40",
                "--json", "headSha,status,conclusion",
            ]
        )
        # Under --require-github an unreadable remote is a failure, not a note.
        sink = errors if require else notes
        if code != 0:
            sink.append(f"gate {name}: cannot read runs of workflow {workflow!r}")
            continue
        try:
            runs = json.loads(payload)
        except json.JSONDecodeError:
            sink.append(f"gate {name}: unreadable workflow run payload for {workflow!r}")
            continue
        observed = next(
            (
                item
                for item in runs
                if item.get("headSha") == verified_sha and item.get("status") == "completed"
            ),
            None,
        )
        if observed is None:
            sink.append(
                f"current.yaml gates.{name} records {recorded} on {verified_sha[:7]}, but no "
                f"completed run of {workflow!r} exists there; the cited evidence is absent"
            )
            continue
        actual = conclusion_to_result.get(str(observed.get("conclusion")), "NOT_RUN")
        if actual != recorded:
            errors.append(
                f"current.yaml gates.{name} records {recorded} on {verified_sha[:7]}, but "
                f"{workflow!r} concluded {observed.get('conclusion')} there"
            )
        elif verified_sha == head_oid:
            notes.append(f"gate {name}: {actual} confirmed on head {head_oid[:7]}")
        else:
            notes.append(
                f"gate {name}: {actual} on {verified_sha[:7]}, head is {head_oid[:7]} — "
                "not yet verified"
            )

    # A task offered for review must stand on a verified head. Mid-work drift is
    # normal and only noted; claiming readiness on an unverified revision is the
    # failure this whole mechanism exists to prevent.
    if str(task.get("status")) == "in_review" and not head_verified:
        errors.append(
            f"{task.get('id')} is in_review, but not every gate is verified on head "
            f"{head_oid[:7]}; run the gates on this revision before offering it"
        )
    return head_verified


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-github", action="store_true")
    args = parser.parse_args()

    errors: list[str] = []
    notes: list[str] = []

    current = load_yaml(CURRENT_PATH, errors)
    if current is None:
        print("ASA Lab control plane validation: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    task = check_current(current, errors)
    if task:
        # Revisions listed in current.yaml are legitimate historical references.
        task = {**task, "_revisions": current.get("revisions") or {}, "_gates": current.get("gates") or {}}
        check_stateless_documents(errors)
        check_source_invariants(errors)
        check_manifest(task, errors)
        check_project_map(task, errors)
        check_active_tests(task, errors)
        check_catalog_validator(errors)
        check_gate_scripts(current, errors)
        check_git(task, errors, notes)
        check_github(task, errors, notes, args.require_github)

    if errors:
        print("ASA Lab control plane validation: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("ASA Lab control plane validation: PASS")
    print(f"activeTask={task.get('id')}")
    print(f"branch={task.get('branch')}")
    print(f"pr={task.get('pr')}")
    print(f"status={task.get('status')}")
    print(f"leaseHolder={(current.get('execution_lease') or {}).get('holder')}")
    blocking = current.get("blocking") or []
    print(f"blocking={len(blocking)}")
    for note in notes:
        print(f"note: {note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
