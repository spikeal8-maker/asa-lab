#!/usr/bin/env python3
"""Validate stable and active ASA Lab test registries."""

from __future__ import annotations

import json
import re
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
CURRENT_PATH = ROOT / "docs/execution/current.yaml"
CATALOG_PATH = ROOT / "docs/testing/test-catalog.yaml"
PLANNED_CATALOG_PATH = ROOT / "docs/testing/planned-test-catalog.yaml"
ACTIVE_CATALOG_PATH = ROOT / "docs/testing/active-task-tests.yaml"
PACKAGE_JSON_PATH = ROOT / "package.json"
MAP_PATH = ROOT / "docs/project-map/project-map.yaml"
STRATEGY_PATH = ROOT / "docs/testing/TEST_STRATEGY.md"
RUNBOOK_PATH = ROOT / "docs/delivery/BOT_RUNBOOK.md"
QUALITY_MAP_PATH = ROOT / "docs/project-map/QUALITY_MAP.md"
DEVELOPMENT_PROGRAM_PATH = ROOT / "docs/delivery/DEVELOPMENT_PROGRAM_V1.md"
PORT_POLICY_PATH = ROOT / "docs/delivery/LOCAL_PORT_POLICY.md"

TEST_ID_PATTERN = re.compile(r"^TST-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}$")
TASK_ID_PATTERN = re.compile(r"^TASK-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}$")
ROADMAP_ALIAS_PATTERN = re.compile(r"^TASK-(?:R[0-9]+|SEAT)$")
PHASE_ID_PATTERN = re.compile(r"^PHASE-(?:[0-9]|1[0-2])$")
ALLOWED_RESULT_STATES = {"PASS", "FAIL", "NOT_RUN", "BLOCKED"}


def _control_plane_task() -> dict[str, Any]:
    """The active task has exactly one home: docs/execution/current.yaml."""
    document = yaml.safe_load(CURRENT_PATH.read_text(encoding="utf-8"))
    return dict(document["task"])


def _control_plane_task_ids() -> set[str]:
    document = yaml.safe_load(CURRENT_PATH.read_text(encoding="utf-8"))
    task_ids = {str(document["task"]["id"])}
    for lane in document.get("parallel_lanes") or []:
        if isinstance(lane, dict) and isinstance(lane.get("task"), dict):
            task_ids.add(str(lane["task"]["id"]))
    return task_ids


def _checkout_contains_task_branch(branch: str) -> bool:
    """Is the active task's code present in this checkout?

    The active task's test registry names specs that live on its branch. On the
    canonical branch — or any other branch that predates the task — those files
    genuinely do not exist, and demanding them would make main unable to record
    which task is active at all.

    This is a precondition, not a waiver: when the branch is absent the caller
    still verifies that it exists on the remote, and says which layer went
    unchecked.
    """
    try:
        result = subprocess.run(
            ["git", "merge-base", "--is-ancestor", f"origin/{branch}", "HEAD"],
            cwd=ROOT,
            capture_output=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def _remote_branch_exists(branch: str) -> bool:
    """A missing remote-tracking ref only means this clone never fetched it.

    Single-branch and shallow clones are ordinary; asking the remote keeps the
    answer about the branch rather than about the clone.
    """
    for command in (
        ["git", "rev-parse", "--verify", f"refs/remotes/origin/{branch}"],
        ["git", "ls-remote", "--exit-code", "--heads", "origin", branch],
    ):
        try:
            result = subprocess.run(
                command, cwd=ROOT, capture_output=True, timeout=30, check=False
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if result.returncode == 0:
            return True
    return False


_CURRENT_TASK = _control_plane_task()
ACTIVE_TASK = str(_CURRENT_TASK["id"])
CURRENT_TASK_IDS = _control_plane_task_ids()
ACTIVE_BRANCH = str(_CURRENT_TASK["branch"])
ACTIVE_TASK_IS_DONE = str(_CURRENT_TASK.get("status")) == "done"
# A completed task is verified from the canonical checkout itself. Its temporary
# product branch may be deleted after merge; command validation below still
# proves that every registered test is present and executable here.
ACTIVE_CODE_PRESENT = ACTIVE_TASK_IS_DONE or _checkout_contains_task_branch(ACTIVE_BRANCH)
EXTERNAL_GOVERNANCE_TASKS = {"TASK-GOV-001"}
HISTORICAL_TASK_IDS = {
    "TASK-CI-001", "TASK-ARCH-001", "TASK-ENV-001", "TASK-TEN-001",
    "TASK-CLS-001", "TASK-MVP-001", "TASK-MOD-001",
    "TASK-ELECTRONICS-SLICE-001", "TASK-CHECKERS-LITE-001",
    "TASK-ELECTRONICS-ALPHA-001", "TASK-SEAT-001", "TASK-ACT-001",
    "TASK-REVIEW-001", "TASK-ELEC-001",
}
COVERAGE_REQUIRED_STATUSES = {"ready", "in_progress", "in_review", "done"}
REQUIRED_TEST_FIELDS = {"id", "title", "suite", "level", "phase_available", "required_for", "command", "timeout_seconds", "owner", "artifacts"}
DANGEROUS_COMMAND_FRAGMENTS = {"rm -rf /", "git push --force", "git reset --hard origin/", "curl | sh", "wget | sh"}


def load_yaml(path: Path, errors: list[str]) -> Any:
    if not path.is_file():
        errors.append(f"Missing required YAML file: {path.relative_to(ROOT)}")
        return None
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"Cannot parse {path.relative_to(ROOT)}: {exc}")
        return None


def task_nodes_from_map(document: Any, errors: list[str]) -> tuple[dict[str, dict[str, Any]], set[str]]:
    if not isinstance(document, dict) or not isinstance(document.get("nodes"), list):
        errors.append("Project map must contain a nodes array")
        return {}, set()
    task_nodes: dict[str, dict[str, Any]] = {}
    roadmap_aliases: set[str] = set()
    for node in document["nodes"]:
        if not isinstance(node, dict) or node.get("kind") != "task":
            continue
        task_id = node.get("id")
        if isinstance(task_id, str) and TASK_ID_PATTERN.fullmatch(task_id):
            task_nodes[task_id] = node
        elif isinstance(task_id, str) and ROADMAP_ALIAS_PATTERN.fullmatch(task_id) and node.get("status") in {"blocked", "planned"}:
            roadmap_aliases.add(task_id)
        else:
            errors.append(f"Invalid task id in project map: {task_id!r}")
    return task_nodes, roadmap_aliases


def package_scripts() -> dict[str, str]:
    try:
        return json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8")).get("scripts", {})
    except Exception:  # noqa: BLE001 - reported by the caller as a missing script
        return {}


PACKAGE_SCRIPTS = package_scripts()
# Binaries pnpm may run directly instead of a named script.
PNPM_BINARIES = {"vitest", "playwright", "exec", "node", "tsx", "dlx"}
PATH_EXTENSIONS = (".ts", ".tsx", ".mjs", ".js", ".py", ".sh", ".yaml", ".yml")


def looks_like_path(argument: str) -> bool:
    if argument.startswith("-"):
        return False
    return "/" in argument or argument.endswith(PATH_EXTENSIONS)


def validate_command_executable(test_id: str, parts: list[str], errors: list[str]) -> None:
    """A registered gate must actually be runnable, not merely well-formed.

    A catalog entry that names a missing pnpm script or a missing spec file is a
    gate that can never fail, which is worse than having no gate at all.
    """
    head = parts[0]
    arguments = parts[1:]
    if head == "pnpm":
        if not arguments:
            errors.append(f"{test_id}: pnpm command has no target")
            return
        target = arguments[0]
        if target not in PACKAGE_SCRIPTS and target not in PNPM_BINARIES:
            errors.append(
                f"{test_id}: pnpm script {target!r} does not exist in package.json"
            )
            return
        arguments = arguments[1:]
    elif head in {"python", "python3"}:
        arguments = [item for item in arguments if item != "-m"]
    for argument in arguments:
        if looks_like_path(argument) and not (ROOT / argument).exists():
            errors.append(f"{test_id}: command references a missing path: {argument}")


def validate_command(test_id: str, command: Any, errors: list[str], executable: bool = True) -> None:
    if not isinstance(command, str) or not command.strip():
        errors.append(f"{test_id}: command must be non-empty")
        return
    normalized = " ".join(command.lower().split())
    for fragment in DANGEROUS_COMMAND_FRAGMENTS:
        if fragment in normalized:
            errors.append(f"{test_id}: dangerous command fragment: {fragment}")
    try:
        parts = shlex.split(command)
    except ValueError as exc:
        errors.append(f"{test_id}: command cannot be tokenized: {exc}")
        return
    if not parts:
        errors.append(f"{test_id}: command has no executable")
        return
    if executable:
        validate_command_executable(test_id, parts, errors)


def collect_catalogs(errors: list[str]) -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    stable = load_yaml(CATALOG_PATH, errors)
    active = load_yaml(ACTIVE_CATALOG_PATH, errors)
    if not isinstance(stable, dict):
        stable = {}
    if not isinstance(active, dict):
        active = {}
    if "active_task" in active:
        errors.append("active-task-tests.yaml must not duplicate active_task")
    if active.get("task_selection_source") != "docs/execution/current.yaml":
        errors.append(
            "active-task-tests.yaml task_selection_source must be "
            "docs/execution/current.yaml"
        )
    if set(active.get("result_states") or []) != ALLOWED_RESULT_STATES:
        errors.append("active-task-tests result_states mismatch")
    stable_tests = stable.get("tests") if isinstance(stable.get("tests"), list) else []
    active_tests = active.get("tests") if isinstance(active.get("tests"), list) else []
    if not stable_tests:
        errors.append("Stable test catalog must contain tests")
    if not active_tests:
        errors.append("Active task test catalog must contain tests")
    return stable, [item for item in [*stable_tests, *active_tests] if isinstance(item, dict)], [str(item.get("id")) for item in active_tests if isinstance(item, dict)]


def validate_catalogs(stable: dict[str, Any], tests: list[dict[str, Any]], active_ids: list[str], task_nodes: dict[str, dict[str, Any]], roadmap_aliases: set[str], errors: list[str]) -> tuple[int, int]:
    if set(stable.get("result_states") or []) != ALLOWED_RESULT_STATES:
        errors.append("Stable result_states mismatch")
    suites = stable.get("suites")
    if not isinstance(suites, dict) or not suites:
        errors.append("Stable catalog must contain suites")
        suites = {}
    known_tasks = (
        set(task_nodes) | CURRENT_TASK_IDS | EXTERNAL_GOVERNANCE_TASKS | HISTORICAL_TASK_IDS
    )
    seen: set[str] = set()
    covered: set[str] = set()
    for index, test in enumerate(tests, start=1):
        missing = REQUIRED_TEST_FIELDS - set(test)
        if missing:
            errors.append(f"Test #{index} misses fields: {', '.join(sorted(missing))}")
        test_id = test.get("id")
        if not isinstance(test_id, str) or not TEST_ID_PATTERN.fullmatch(test_id):
            errors.append(f"Test #{index} has invalid id: {test_id!r}")
            test_id = f"test-{index}"
        elif test_id in seen:
            errors.append(f"Duplicate test id: {test_id}")
        else:
            seen.add(test_id)
        if test.get("suite") not in suites:
            errors.append(f"{test_id}: unknown suite {test.get('suite')!r}")
        phase = test.get("phase_available")
        if not isinstance(phase, str) or not PHASE_ID_PATTERN.fullmatch(phase):
            errors.append(f"{test_id}: invalid phase_available {phase!r}")
        required_for = test.get("required_for")
        if not isinstance(required_for, list):
            errors.append(f"{test_id}: required_for must be an array")
        else:
            for task_id in required_for:
                if not isinstance(task_id, str) or not TASK_ID_PATTERN.fullmatch(task_id):
                    errors.append(f"{test_id}: invalid task reference {task_id!r}")
                    continue
                covered.add(task_id)
                if task_id in roadmap_aliases:
                    errors.append(f"{test_id}: blocked roadmap alias cannot own a gate: {task_id}")
                elif task_id not in known_tasks:
                    errors.append(f"{test_id}: unknown task {task_id}")
        # Entries of the active task are only executable where its code is.
        owns_active_task = isinstance(required_for, list) and ACTIVE_TASK in required_for
        validate_command(
            str(test_id),
            test.get("command"),
            errors,
            executable=ACTIVE_CODE_PRESENT or not owns_active_task,
        )
        timeout = test.get("timeout_seconds")
        if not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= 14400:
            errors.append(f"{test_id}: timeout_seconds must be 1..14400")
        if not isinstance(test.get("owner"), str) or not test.get("owner", "").strip():
            errors.append(f"{test_id}: owner must be non-empty")
        artifacts = test.get("artifacts")
        if not isinstance(artifacts, list) or not artifacts or any(not isinstance(item, str) or not item.strip() for item in artifacts):
            errors.append(f"{test_id}: artifacts must contain non-empty strings")
    for active_id in active_ids:
        test = next((item for item in tests if item.get("id") == active_id), {})
        required_for = test.get("required_for")
        if (
            not isinstance(required_for, list)
            or len(required_for) != 1
            or required_for[0] not in CURRENT_TASK_IDS
        ):
            errors.append(
                f"{active_id}: execution tests must belong to exactly one task "
                "declared in current.yaml"
            )
    tasks_requiring_coverage = {
        task_id for task_id, node in task_nodes.items()
        if task_id != "TASK-CI-001" and node.get("status") in COVERAGE_REQUIRED_STATUSES
    } | EXTERNAL_GOVERNANCE_TASKS
    for task_id in sorted(tasks_requiring_coverage - covered):
        errors.append(f"Task has no registered test: {task_id}")
    return len(seen), len(suites)


def validate_documents(active_ids: list[str], errors: list[str]) -> None:
    required_files = (STRATEGY_PATH, RUNBOOK_PATH, QUALITY_MAP_PATH, DEVELOPMENT_PROGRAM_PATH, PORT_POLICY_PATH)
    for path in required_files:
        if not path.is_file():
            errors.append(f"Missing required file: {path.relative_to(ROOT)}")
    strategy = STRATEGY_PATH.read_text(encoding="utf-8") if STRATEGY_PATH.is_file() else ""
    runbook = RUNBOOK_PATH.read_text(encoding="utf-8") if RUNBOOK_PATH.is_file() else ""
    quality = QUALITY_MAP_PATH.read_text(encoding="utf-8") if QUALITY_MAP_PATH.is_file() else ""
    if "test-catalog.yaml" not in strategy or "active-task-tests.yaml" not in strategy:
        errors.append("TEST_STRATEGY.md must reference both test registries")
    for marker in ("test-catalog.yaml", "active-task-tests.yaml", "DEVELOPMENT_PROGRAM_V1.md", "LOCAL_PORT_POLICY.md"):
        if marker not in runbook:
            errors.append(f"BOT_RUNBOOK.md must reference {marker}")
    for required_id in (
        "TST-ARCH-001",
        "TST-MAP-001",
        "TST-CATALOG-001",
        "TST-DEVELOPMENT-PROGRAM-001",
    ):
        if required_id not in quality:
            errors.append(f"QUALITY_MAP.md must display {required_id}")


def validate_planned_catalog(executable_ids: set[str], errors: list[str]) -> int:
    """Planned tests are a roadmap, not a gate.

    They live in their own registry so a PASS from the executable catalog can
    never be produced by an entry whose command does not exist yet.
    """
    planned = load_yaml(PLANNED_CATALOG_PATH, errors)
    if not isinstance(planned, dict):
        return 0
    entries = planned.get("tests")
    if not isinstance(entries, list):
        errors.append("planned-test-catalog.yaml must contain a tests array")
        return 0
    seen: set[str] = set()
    for index, test in enumerate(entries, start=1):
        if not isinstance(test, dict):
            errors.append(f"Planned test #{index} must be a mapping")
            continue
        test_id = test.get("id")
        if not isinstance(test_id, str) or not TEST_ID_PATTERN.fullmatch(test_id):
            errors.append(f"Planned test #{index} has invalid id: {test_id!r}")
            continue
        if test_id in seen:
            errors.append(f"Duplicate planned test id: {test_id}")
        seen.add(test_id)
        if test_id in executable_ids:
            errors.append(f"{test_id}: registered as both executable and planned")
        # Shape is checked; executability deliberately is not.
        validate_command(test_id, test.get("command"), errors, executable=False)
    return len(seen)


def main() -> int:
    errors: list[str] = []
    if not ACTIVE_CODE_PRESENT and not _remote_branch_exists(ACTIVE_BRANCH):
        # The waiver above is only sound while the branch that carries the code
        # actually exists. Without it, nothing anywhere can verify the registry.
        errors.append(
            f"current.yaml names branch {ACTIVE_BRANCH!r}, which is neither in this "
            "checkout nor on the remote; the active task's tests cannot be verified anywhere"
        )
    project_map = load_yaml(MAP_PATH, errors)
    task_nodes, roadmap_aliases = task_nodes_from_map(project_map, errors)
    stable, tests, active_ids = collect_catalogs(errors)
    test_count, suite_count = validate_catalogs(stable, tests, active_ids, task_nodes, roadmap_aliases, errors)
    planned_count = validate_planned_catalog({str(test.get("id")) for test in tests}, errors)
    validate_documents(active_ids, errors)
    if errors:
        print("ASA Lab test catalog validation: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("ASA Lab test catalog validation: PASS")
    print(f"registeredTests={test_count}")
    print(f"registeredSuites={suite_count}")
    print(f"plannedTests={planned_count}")
    print(f"currentLaneTasks={len(CURRENT_TASK_IDS)}")
    print(f"executionTests={len(active_ids)}")
    if ACTIVE_CODE_PRESENT:
        source = "canonical checkout" if ACTIVE_TASK_IS_DONE else "task branch in this checkout"
        print(f"activeTaskLayer=executable ({source})")
    else:
        # Said out loud rather than passed over: this checkout could not confirm
        # that the active task's commands resolve, only that its branch exists.
        print(f"activeTaskLayer=not verified here (origin/{ACTIVE_BRANCH} is not in this history)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
