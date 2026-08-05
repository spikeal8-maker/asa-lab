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
    lease = current.get("execution_lease")
    if not isinstance(lease, dict) or "holder" not in lease:
        errors.append("current.yaml must declare execution_lease.holder")
    return task


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
        command = str(gate.get("command", ""))
        script = command.removeprefix("pnpm ").strip()
        if not script or script not in scripts:
            errors.append(
                f"current.yaml gates.{name}.command {command!r} is not a package.json script"
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
    head_oid = str(data.get("headRefOid", ""))
    body = str(data.get("body") or "")
    # A body that never mentions the current head is describing a different
    # revision, whatever it claims in prose. This is the check that would have
    # caught PR #72 asserting a verified release candidate four commits back.
    if head_oid and head_oid not in body:
        errors.append(
            f"PR #{pr} body does not reference the current head {head_oid[:7]}; "
            "it describes a superseded revision and must be refreshed"
        )
    notes.append(f"PR #{pr}: draft={data.get('isDraft')} state={data.get('state')} head={head_oid[:7]}")


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
        task = {**task, "_revisions": current.get("revisions") or {}}
        check_stateless_documents(errors)
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
