#!/usr/bin/env python3
"""Validate stable and active ASA Lab test registries."""

from __future__ import annotations

import re
import shlex
import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "docs/testing/test-catalog.yaml"
ACTIVE_CATALOG_PATH = ROOT / "docs/testing/active-task-tests.yaml"
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
ACTIVE_TASK = "TASK-ELECTRONICS-M1-001"
ACTIVE_CHAIN_TASKS = {"TASK-R3A-ELECTRONICS-GATEWAY-001", ACTIVE_TASK}
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


def validate_command(test_id: str, command: Any, errors: list[str]) -> None:
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


def collect_catalogs(errors: list[str]) -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    stable = load_yaml(CATALOG_PATH, errors)
    active = load_yaml(ACTIVE_CATALOG_PATH, errors)
    if not isinstance(stable, dict):
        stable = {}
    if not isinstance(active, dict):
        active = {}
    if active.get("active_task") != ACTIVE_TASK:
        errors.append(f"active-task-tests.yaml active_task must be {ACTIVE_TASK}")
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
    known_tasks = set(task_nodes) | EXTERNAL_GOVERNANCE_TASKS | HISTORICAL_TASK_IDS
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
        validate_command(str(test_id), test.get("command"), errors)
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
        if not isinstance(required_for, list) or len(required_for) != 1 or required_for[0] not in ACTIVE_CHAIN_TASKS:
            errors.append(f"{active_id}: active tests must belong to the owner-activated R3A/M1 chain")
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
    for required_id in ("TST-ARCH-001", "TST-MAP-001", "TST-CATALOG-001", "TST-DEVELOPMENT-PROGRAM-001", *active_ids):
        if required_id not in quality:
            errors.append(f"QUALITY_MAP.md must display {required_id}")
    task_map = load_yaml(MAP_PATH, errors)
    task_nodes, _ = task_nodes_from_map(task_map, errors)
    active_status = task_nodes.get(ACTIVE_TASK, {}).get("status")
    if active_status == "in_review":
        if "currently `NOT_RUN`" in quality:
            errors.append("QUALITY_MAP.md cannot report current NOT_RUN results for an in-review task")
        for test_id in active_ids:
            if re.search(rf"(?m)^{re.escape(test_id)}\s+PASS\s*$", quality) is None:
                errors.append(f"QUALITY_MAP.md must report {test_id} PASS while task is in_review")


def main() -> int:
    errors: list[str] = []
    project_map = load_yaml(MAP_PATH, errors)
    task_nodes, roadmap_aliases = task_nodes_from_map(project_map, errors)
    stable, tests, active_ids = collect_catalogs(errors)
    test_count, suite_count = validate_catalogs(stable, tests, active_ids, task_nodes, roadmap_aliases, errors)
    validate_documents(active_ids, errors)
    if errors:
        print("ASA Lab test catalog validation: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("ASA Lab test catalog validation: PASS")
    print(f"registeredTests={test_count}")
    print(f"registeredSuites={suite_count}")
    print(f"activeTask={ACTIVE_TASK}")
    print(f"activeTests={len(active_ids)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
