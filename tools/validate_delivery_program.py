#!/usr/bin/env python3
"""Validate the owner-activated ASA Lab delivery contract."""

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "docs/delivery/EXECUTION_MANIFEST.yaml"
PROGRAM_PATH = ROOT / "docs/delivery/DEVELOPMENT_PROGRAM_V1.md"
PORT_PATH = ROOT / "docs/delivery/LOCAL_PORT_POLICY.md"
MAP_PATH = ROOT / "docs/project-map/project-map.yaml"
CATALOG_PATH = ROOT / "docs/testing/test-catalog.yaml"

EXPECTED_TASKS = [
    "TASK-PRODUCT-DOC-001",
    "TASK-PORTAL-001",
    "TASK-ACCOUNT-C1-001",
    "TASK-CREATOR-PORTAL-001",
]
ACTIVE_TASK = "TASK-CREATOR-PORTAL-001"
ACTIVE_BRANCH = "agent/r2-creator-portal"
ACTIVE_ISSUE = "https://github.com/spikeal8-maker/asa-lab/issues/62"
ACTIVE_STATUSES = {"ready", "in_progress", "in_review"}
EXPECTED_ROADMAP = {
    "R3": "https://github.com/spikeal8-maker/asa-lab/issues/37",
    "R4": "https://github.com/spikeal8-maker/asa-lab/issues/63",
}
CANONICAL_PORTS = {"web": 4610, "api": 4611, "e2e": 4612}
FORBIDDEN_PORTS = {3000, 3100, 5173}


def load_yaml(path: Path, errors: list[str]) -> dict[str, Any]:
    if not path.is_file():
        errors.append(f"Missing file: {path.relative_to(ROOT)}")
        return {}
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"Cannot parse {path.relative_to(ROOT)}: {exc}")
        return {}
    if not isinstance(value, dict):
        errors.append(f"{path.relative_to(ROOT)} root must be an object")
        return {}
    return value


def string_list(value: Any, label: str, errors: list[str]) -> list[str]:
    if not isinstance(value, list):
        errors.append(f"{label} must be an array")
        return []
    if any(not isinstance(item, str) or not item.strip() for item in value):
        errors.append(f"{label} must contain non-empty strings")
        return []
    return list(value)


def validate_documents(errors: list[str]) -> None:
    required = (
        MANIFEST_PATH,
        PROGRAM_PATH,
        PORT_PATH,
        MAP_PATH,
        CATALOG_PATH,
        ROOT / "README.md",
        ROOT / "AGENTS.md",
        ROOT / "START_HERE_FOR_AI.md",
        ROOT / "docs/delivery/BOT_RUNBOOK.md",
        ROOT / "docs/project-map/PROJECT_MAP.md",
        ROOT / "docs/project-map/QUALITY_MAP.md",
        ROOT / "docs/project-map/README.md",
        ROOT / "docs/project-map/TASK_SYSTEM.md",
        ROOT / "docs/testing/TEST_STRATEGY.md",
    )
    for path in required:
        if not path.is_file():
            errors.append(f"Missing delivery document: {path.relative_to(ROOT)}")
    for path in required[5:]:
        if path.is_file() and "EXECUTION_MANIFEST.yaml" not in path.read_text(encoding="utf-8"):
            errors.append(f"{path.relative_to(ROOT)} must reference EXECUTION_MANIFEST.yaml")


def validate_ports(manifest: dict[str, Any], errors: list[str]) -> None:
    ports = manifest.get("ports")
    if not isinstance(ports, dict):
        errors.append("Execution manifest ports must be an object")
        return
    if ports.get("bind") != "127.0.0.1":
        errors.append("Execution manifest bind must be 127.0.0.1")
    for name, expected in CANONICAL_PORTS.items():
        if ports.get(name) != expected:
            errors.append(f"Execution manifest port {name} must be {expected}")
    if set(ports.get("forbidden") or []) != FORBIDDEN_PORTS:
        errors.append(f"Forbidden ports must be {sorted(FORBIDDEN_PORTS)}")


def validate_roadmap(manifest: dict[str, Any], errors: list[str]) -> None:
    roadmap = manifest.get("roadmap_after_current")
    if not isinstance(roadmap, list):
        errors.append("Execution manifest must contain roadmap_after_current")
        return
    actual: dict[str, str] = {}
    for entry in roadmap:
        if not isinstance(entry, dict):
            errors.append("roadmap entries must be objects")
            continue
        release = entry.get("release")
        issue = entry.get("issue")
        if isinstance(release, str) and isinstance(issue, str):
            actual[release] = issue
        if entry.get("status") != "blocked":
            errors.append(f"Roadmap release {release} must remain blocked")
    if actual != EXPECTED_ROADMAP:
        errors.append(f"Roadmap mismatch: expected {EXPECTED_ROADMAP}, got {actual}")


def expand_profiles(task: dict[str, Any], profiles: dict[str, list[str]], errors: list[str]) -> set[str]:
    result: set[str] = set()
    for name in string_list(task.get("test_profiles"), f"{task.get('task_id')}.test_profiles", errors):
        tests = profiles.get(name)
        if tests is None:
            errors.append(f"Task {task.get('task_id')} references unknown profile {name}")
            continue
        result.update(tests)
    result.update(string_list(task.get("task_tests"), f"{task.get('task_id')}.task_tests", errors))
    return result


def validate_manifest(manifest: dict[str, Any], catalog: dict[str, Any], errors: list[str]) -> list[dict[str, Any]]:
    if manifest.get("schema_version") != "1.0.0":
        errors.append("Unsupported execution manifest schema_version")
    if manifest.get("program_id") != "PROGRAM-ALPHA-001":
        errors.append("program_id must be PROGRAM-ALPHA-001")
    if manifest.get("semantics", {}).get("no_automatic_future_activation") is not True:
        errors.append("Automatic future activation must be forbidden")

    state = manifest.get("canonical_state")
    if not isinstance(state, dict):
        errors.append("canonical_state must be an object")
    else:
        if state.get("branch") != "main":
            errors.append("canonical_state.branch must be main")
        if state.get("product_merge_sha") != "e01ac85095ddaabef19ed618964deac3aa5b2406":
            errors.append("product merge SHA mismatch")
        if state.get("verified_account_implementation_sha") != "35c06c42012672b9b4cb2626b85ba1f21b973bc0":
            errors.append("verified Account implementation SHA mismatch")
        if state.get("active_task") != ACTIVE_TASK:
            errors.append(f"canonical_state.active_task must be {ACTIVE_TASK}")
        if state.get("active_branch") != ACTIVE_BRANCH:
            errors.append(f"canonical_state.active_branch must be {ACTIVE_BRANCH}")
        if state.get("active_issue") != ACTIVE_ISSUE:
            errors.append(f"canonical_state.active_issue must be {ACTIVE_ISSUE}")

    validate_roadmap(manifest, errors)

    raw_profiles = manifest.get("test_profiles")
    if not isinstance(raw_profiles, dict):
        errors.append("test_profiles must be an object")
        raw_profiles = {}
    profiles = {str(name): string_list(value, f"test_profiles.{name}", errors) for name, value in raw_profiles.items()}

    raw_tasks = manifest.get("tasks")
    if not isinstance(raw_tasks, list):
        errors.append("tasks must be an array")
        return []
    tasks = sorted((task for task in raw_tasks if isinstance(task, dict)), key=lambda task: task.get("position", 0))
    ids = [task.get("task_id") for task in tasks]
    if ids != EXPECTED_TASKS:
        errors.append(f"Executable tasks must be exactly {EXPECTED_TASKS}, got {ids}")
    if [task.get("position") for task in tasks] != list(range(1, len(tasks) + 1)):
        errors.append("Task positions must be contiguous")

    catalog_tests = catalog.get("tests")
    if not isinstance(catalog_tests, list):
        errors.append("Test catalog tests must be an array")
        catalog_tests = []
    known_tests = {item.get("id") for item in catalog_tests if isinstance(item, dict) and isinstance(item.get("id"), str)}
    actual_by_task: dict[str, set[str]] = defaultdict(set)
    for item in catalog_tests:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            continue
        for task_id in item.get("required_for") or []:
            if isinstance(task_id, str):
                actual_by_task[task_id].add(item["id"])

    for index, task in enumerate(tasks):
        task_id = task.get("task_id")
        expected_status = ACTIVE_STATUSES if task_id == ACTIVE_TASK else {"done"}
        if task.get("status") not in expected_status:
            errors.append(f"Task {task_id} has invalid status {task.get('status')!r}")
        for field in ("issue", "branch", "milestone", "track", "delivery_stage", "architecture_horizon", "visible_result"):
            value = task.get(field)
            if not isinstance(value, str) or not value.strip():
                errors.append(f"Task {task_id} has empty {field}")
        expected_next = tasks[index + 1].get("task_id") if index + 1 < len(tasks) else None
        if task.get("next_task") != expected_next:
            errors.append(f"Task {task_id} next_task must be {expected_next!r}")
        dependencies = string_list(task.get("depends_on"), f"{task_id}.depends_on", errors)
        if task_id == ACTIVE_TASK and dependencies != ["TASK-ACCOUNT-C1-001"]:
            errors.append("R2 must depend only on completed Account C1")
        map_nodes = string_list(task.get("map_nodes"), f"{task_id}.map_nodes", errors)
        if "PROGRAM-ALPHA-001" not in map_nodes:
            errors.append(f"Task {task_id} map_nodes must include PROGRAM-ALPHA-001")
        if task.get("architecture_horizon") not in map_nodes:
            errors.append(f"Task {task_id} map_nodes must include architecture horizon")

        expected_tests = expand_profiles(task, profiles, errors)
        unknown = expected_tests - known_tests
        if unknown:
            errors.append(f"Task {task_id} references unknown tests: {sorted(unknown)}")
        actual = actual_by_task.get(str(task_id), set())
        if expected_tests != actual:
            errors.append(f"Task {task_id} test mapping mismatch: missing={sorted(expected_tests-actual)} extra={sorted(actual-expected_tests)}")

    account = next((task for task in tasks if task.get("task_id") == "TASK-ACCOUNT-C1-001"), None)
    if not account or account.get("completed_sha") != "35c06c42012672b9b4cb2626b85ba1f21b973bc0" or account.get("merged_sha") != "e01ac85095ddaabef19ed618964deac3aa5b2406" or account.get("merged_pr") != 70:
        errors.append("Account C1 completion evidence mismatch")
    return tasks


def validate_map(tasks: list[dict[str, Any]], document: dict[str, Any], errors: list[str]) -> None:
    nodes_raw = document.get("nodes")
    queue_raw = document.get("execution_queue")
    if not isinstance(nodes_raw, list) or not isinstance(queue_raw, list):
        errors.append("Project map must contain nodes and execution_queue")
        return
    nodes = {item.get("id"): item for item in nodes_raw if isinstance(item, dict) and isinstance(item.get("id"), str)}
    canonical_ids = [task["task_id"] for task in tasks]
    queue_ids = [item.get("task_id") for item in sorted((item for item in queue_raw if isinstance(item, dict)), key=lambda item: item.get("position", 0))]
    if queue_ids != canonical_ids:
        errors.append("Project map execution_queue differs from manifest")
    focus = document.get("project", {}).get("current_focus")
    if focus != ACTIVE_TASK:
        errors.append(f"Project map current_focus must be {ACTIVE_TASK}, got {focus!r}")
    for task in tasks:
        node = nodes.get(task["task_id"])
        if not isinstance(node, dict):
            errors.append(f"Project map misses task node {task['task_id']}")
            continue
        expected = ACTIVE_STATUSES if task["task_id"] == ACTIVE_TASK else {"done"}
        if node.get("status") not in expected:
            errors.append(f"Project map task {task['task_id']} has invalid status {node.get('status')!r}")
        if node.get("issue") != task.get("issue"):
            errors.append(f"Project map Issue mismatch for {task['task_id']}")
        if node.get("phase") != task.get("architecture_horizon"):
            errors.append(f"Project map phase mismatch for {task['task_id']}")


def main() -> int:
    errors: list[str] = []
    validate_documents(errors)
    manifest = load_yaml(MANIFEST_PATH, errors)
    project_map = load_yaml(MAP_PATH, errors)
    catalog = load_yaml(CATALOG_PATH, errors)
    validate_ports(manifest, errors)
    tasks = validate_manifest(manifest, catalog, errors)
    validate_map(tasks, project_map, errors)
    if errors:
        print("ASA Lab execution contract validation: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    active = next(task for task in tasks if task["task_id"] == ACTIVE_TASK)
    print("ASA Lab execution contract validation: PASS")
    print(f"- executable tasks: {len(tasks)}")
    print(f"- current focus: {ACTIVE_TASK} ({active['status']})")
    print(f"- branch: {ACTIVE_BRANCH}")
    print("- future roadmap: R3 -> R4 (blocked)")
    print("- automatic future activation: forbidden")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
