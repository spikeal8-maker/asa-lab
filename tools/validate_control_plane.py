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
        # Outcomes belong to GitHub Actions, which already holds them per commit
        # and cannot be talked out of them. Copying them here produced a second
        # record to keep in step with the first, rewritten after every push, on
        # every branch that carried the file.
        for stale in ("status", "verified_sha", "last_known"):
            if stale in gate:
                errors.append(
                    f"current.yaml gates.{name} records {stale}; outcomes are read from "
                    "GitHub Actions, not written here"
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
        # A missing remote-tracking ref is not the same as a missing branch: a
        # single-branch or shallow clone simply never fetched it. Ask the remote
        # before blaming it, or the validator reports a cause that is not true.
        code, _ = run(["git", "ls-remote", "--exit-code", "--heads", "origin", branch])
        if code != 0:
            errors.append(f"Product branch {branch} does not exist on the remote")
        else:
            notes.append(
                f"origin/{branch} is not fetched in this clone; confirmed on the remote instead"
            )
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
    if head_oid in body:
        return
    if str(task.get("status")) == "in_review":
        errors.append(
            f"PR #{pr} body does not reference the current head {head_oid[:7]} while "
            f"{task.get('id')} is in_review; a review claim must describe the revision "
            "a reviewer sees"
        )
        return
    # Not an error while work is in progress: a push moves the head, and the body
    # is refreshed straight after. Naming a superseded revision is only a lie once
    # the task is offered for review, which the branch above already covers.
    notes.append(
        f"PR #{pr} body does not name head {head_oid[:7]}; refresh it before review"
    )


def check_gate_results(
    task: dict[str, Any], head_oid: str, errors: list[str], notes: list[str], require: bool
) -> bool:
    """Read each gate's conclusion for the current head from GitHub Actions.

    Nothing is recorded in current.yaml and then compared: GitHub already holds a
    conclusion per commit, and a second copy only creates something to keep in
    step. Reading it makes the answer current by construction, and removes the
    bookkeeping commit that used to follow every push on every branch carrying the
    file.

    Returns True when every gate has a successful completed run on this head.
    """
    gates = task.get("_gates") or {}
    all_green = bool(gates)
    for name, gate in gates.items():
        workflow = gate.get("workflow")
        code, payload = run(
            [
                "gh", "run", "list",
                "--branch", str(task.get("branch")),
                "--workflow", str(workflow),
                "--limit", "40",
                "--json", "headSha,status,conclusion",
            ]
        )
        sink = errors if require else notes
        if code != 0:
            sink.append(f"gate {name}: cannot read runs of workflow {workflow!r}")
            all_green = False
            continue
        try:
            runs = json.loads(payload)
        except json.JSONDecodeError:
            sink.append(f"gate {name}: unreadable workflow run payload for {workflow!r}")
            all_green = False
            continue
        here = [
            item
            for item in runs
            if item.get("headSha") == head_oid and item.get("status") == "completed"
        ]
        if not here:
            notes.append(f"gate {name}: no completed run on head {head_oid[:7]} yet")
            all_green = False
            continue
        conclusions = {str(item.get("conclusion")) for item in here}
        if conclusions == {"success"}:
            notes.append(f"gate {name}: success on head {head_oid[:7]}")
        else:
            all_green = False
            notes.append(
                f"gate {name}: {', '.join(sorted(conclusions))} on head {head_oid[:7]}"
            )

    # A task offered for review must stand on a head the gates have actually
    # passed. Mid-work this is normal and only noted; claiming readiness without
    # it is the failure this mechanism exists to prevent.
    if str(task.get("status")) == "in_review" and not all_green:
        errors.append(
            f"{task.get('id')} is in_review, but not every gate has a successful run on "
            f"head {head_oid[:7]}"
        )
    return all_green


def check_state_file_is_canonical(
    task: dict[str, Any], errors: list[str], notes: list[str]
) -> None:
    """The branch doing the work inherits programme state; it does not author it.

    A file tracked in main is inherited by every branch cut from it, so "the file
    exists nowhere else" is not a condition Git can satisfy. What can be required
    is that the branch doing the work does not also rewrite the record of what the
    work is — otherwise the two copies drift, which is what happened.

    A governance branch proposing a change to main is the intended way to change
    it, so the rule does not apply there.
    """
    code, branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    if code != 0:
        notes.append("cannot determine the current branch; canonical-copy check skipped")
        return
    if branch != str(task.get("branch")):
        notes.append(f"on {branch}: not the task branch, so it may propose state changes")
        return
    # Read verbatim rather than through run(), which strips: a stripped blob can
    # never equal a file ending in a newline, so the comparison would fail on
    # every branch for a reason that has nothing to do with the content.
    try:
        shown = subprocess.run(
            ["git", "show", "origin/main:docs/execution/current.yaml"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        notes.append(f"origin/main copy of current.yaml unreadable ({exc}); comparison skipped")
        return
    if shown.returncode != 0:
        notes.append("origin/main copy of current.yaml unavailable; comparison skipped")
        return
    if CURRENT_PATH.read_text(encoding="utf-8") == shown.stdout:
        notes.append("current.yaml matches origin/main byte for byte")
        return
    errors.append(
        f"task branch {branch} modifies docs/execution/current.yaml relative to "
        "origin/main; programme state changes on main and is inherited, never edited "
        "where the work happens"
    )


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
        check_state_file_is_canonical(task, errors, notes)
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
