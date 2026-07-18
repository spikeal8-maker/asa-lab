#!/usr/bin/env python3
"""Deterministic validation of the ASA Lab test catalog."""

from __future__ import annotations

import re
import shlex
import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "docs/testing/test-catalog.yaml"
MAP_PATH = ROOT / "docs/project-map/project-map.yaml"
STRATEGY_PATH = ROOT / "docs/testing/TEST_STRATEGY.md"
RUNBOOK_PATH = ROOT / "docs/delivery/BOT_RUNBOOK.md"
QUALITY_MAP_PATH = ROOT / "docs/project-map/QUALITY_MAP.md"

TEST_ID_PATTERN = re.compile(r"^TST-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}$")
TASK_ID_PATTERN = re.compile(r"^TASK-[A-Z0-9]+-[0-9]{3}$")
PHASE_ID_PATTERN = re.compile(r"^PHASE-(?:[0-9]|1[0-2])$")
REQUIRED_TEST_FIELDS = {
    "id",
    "title",
    "suite",
    "level",
    "phase_available",
    "required_for",
    "command",
    "timeout_seconds",
    "owner",
    "artifacts",
}
ALLOWED_RESULT_STATES = {"PASS", "FAIL", "NOT_RUN", "BLOCKED"}
EXTERNAL_GOVERNANCE_TASKS = {"TASK-GOV-001"}
DANGEROUS_COMMAND_FRAGMENTS = {
    "rm -rf /",
    "git push --force",
    "git reset --hard origin/",
    "curl | sh",
    "wget | sh",
}


def load_yaml(path: Path, errors: list[str]) -> Any:
    if not path.is_file():
        errors.append(f"Missing required YAML file: {path.relative_to(ROOT)}")
        return None
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"Cannot parse {path.relative_to(ROOT)}: {exc}")
        return None


def task_ids_from_map(document: Any, errors: list[str]) -> set[str]:
    if not isinstance(document, dict):
        return set()
    nodes = document.get("nodes")
    if not isinstance(nodes, list):
        errors.append("Project map must contain a nodes array")
        return set()

    task_ids: set[str] = set()
    for node in nodes:
        if not isinstance(node, dict) or node.get("kind") != "task":
            continue
        task_id = node.get("id")
        if isinstance(task_id, str) and TASK_ID_PATTERN.fullmatch(task_id):
            task_ids.add(task_id)
        else:
            errors.append(f"Invalid task id in project map: {task_id!r}")
    return task_ids


def validate_command(test_id: str, command: Any, errors: list[str]) -> None:
    if not isinstance(command, str) or not command.strip():
        errors.append(f"{test_id}: command must be a non-empty string")
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


def validate_catalog(catalog: Any, task_ids: set[str], errors: list[str]) -> tuple[int, int]:
    if not isinstance(catalog, dict):
        errors.append("Test catalog root must be an object")
        return 0, 0

    result_states = catalog.get("result_states")
    if not isinstance(result_states, list) or set(result_states) != ALLOWED_RESULT_STATES:
        errors.append("result_states must contain exactly PASS, FAIL, NOT_RUN and BLOCKED")

    suites = catalog.get("suites")
    if not isinstance(suites, dict) or not suites:
        errors.append("Test catalog must contain non-empty suites")
        suites = {}

    tests = catalog.get("tests")
    if not isinstance(tests, list):
        errors.append("Test catalog must contain a tests array")
        return 0, len(suites)
    if len(tests) < 20:
        errors.append(f"Expected at least 20 registered tests, got {len(tests)}")

    known_tasks = task_ids | EXTERNAL_GOVERNANCE_TASKS
    seen_ids: set[str] = set()
    covered_tasks: set[str] = set()

    for index, test in enumerate(tests, start=1):
        if not isinstance(test, dict):
            errors.append(f"Test #{index} must be an object")
            continue

        missing = REQUIRED_TEST_FIELDS - set(test)
        if missing:
            errors.append(f"Test #{index} misses fields: {', '.join(sorted(missing))}")

        test_id = test.get("id")
        if not isinstance(test_id, str) or not TEST_ID_PATTERN.fullmatch(test_id):
            errors.append(f"Test #{index} has invalid id: {test_id!r}")
            test_id = f"test-{index}"
        elif test_id in seen_ids:
            errors.append(f"Duplicate test id: {test_id}")
        else:
            seen_ids.add(test_id)

        if not isinstance(test.get("title"), str) or not test.get("title", "").strip():
            errors.append(f"{test_id}: title must be non-empty")
        if test.get("suite") not in suites:
            errors.append(f"{test_id}: unknown suite {test.get('suite')!r}")
        if not isinstance(test.get("level"), str) or not test.get("level", "").strip():
            errors.append(f"{test_id}: level must be non-empty")

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
                covered_tasks.add(task_id)
                if task_id not in known_tasks:
                    errors.append(f"{test_id}: unknown task {task_id}")

        validate_command(test_id, test.get("command"), errors)

        timeout = test.get("timeout_seconds")
        if not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= 14400:
            errors.append(f"{test_id}: timeout_seconds must be 1..14400")

        if not isinstance(test.get("owner"), str) or not test.get("owner", "").strip():
            errors.append(f"{test_id}: owner must be non-empty")

        artifacts = test.get("artifacts")
        if not isinstance(artifacts, list) or not artifacts:
            errors.append(f"{test_id}: artifacts must be a non-empty array")
        elif any(not isinstance(item, str) or not item.strip() for item in artifacts):
            errors.append(f"{test_id}: artifacts must contain non-empty strings")

    tasks_requiring_coverage = (task_ids - {"TASK-CI-001"}) | EXTERNAL_GOVERNANCE_TASKS
    for task_id in sorted(tasks_requiring_coverage - covered_tasks):
        errors.append(f"Task has no registered test: {task_id}")

    return len(seen_ids), len(suites)


def validate_documents(catalog: Any, errors: list[str]) -> None:
    required_files = (STRATEGY_PATH, RUNBOOK_PATH, QUALITY_MAP_PATH)
    for path in required_files:
        if not path.is_file():
            errors.append(f"Missing required file: {path.relative_to(ROOT)}")

    if not isinstance(catalog, dict) or not isinstance(catalog.get("tests"), list):
        return

    test_ids = {
        item.get("id")
        for item in catalog["tests"]
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    strategy = STRATEGY_PATH.read_text(encoding="utf-8") if STRATEGY_PATH.is_file() else ""
    runbook = RUNBOOK_PATH.read_text(encoding="utf-8") if RUNBOOK_PATH.is_file() else ""
    quality_map = QUALITY_MAP_PATH.read_text(encoding="utf-8") if QUALITY_MAP_PATH.is_file() else ""

    if "test-catalog.yaml" not in strategy:
        errors.append("TEST_STRATEGY.md must reference test-catalog.yaml")
    if "test-catalog.yaml" not in runbook:
        errors.append("BOT_RUNBOOK.md must reference test-catalog.yaml")
    for required_id in ("TST-ARCH-001", "TST-MAP-001", "TST-CATALOG-001"):
        if required_id not in test_ids:
            errors.append(f"Missing governance test: {required_id}")
        if required_id not in quality_map:
            errors.append(f"QUALITY_MAP.md must display {required_id}")


def main() -> int:
    errors: list[str] = []
    project_map = load_yaml(MAP_PATH, errors)
    task_ids = task_ids_from_map(project_map, errors)
    catalog = load_yaml(CATALOG_PATH, errors)
    tests, suites = validate_catalog(catalog, task_ids, errors)
    validate_documents(catalog, errors)

    if errors:
        print("ASA Lab test catalog validation: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("ASA Lab test catalog validation: PASS")
    print(f"registeredTests={tests}")
    print(f"registeredSuites={suites}")
    print(f"projectTasks={len(task_ids)}")
    print(f"externalGovernanceTasks={len(EXTERNAL_GOVERNANCE_TASKS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
