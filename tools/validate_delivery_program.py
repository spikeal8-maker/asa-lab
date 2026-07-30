#!/usr/bin/env python3
"""Validate the canonical ASA Lab Product Alpha → School Pilot contract.

This validator treats delivery stage and architecture horizon as different axes
and cross-checks Execution Manifest, Project Map, test catalog, port policy,
interactive viewer and required map evidence.
"""

from __future__ import annotations

import os
import subprocess
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
PROJECT_MAP_MD = ROOT / "docs/project-map/PROJECT_MAP.md"
PROJECT_MAP_README = ROOT / "docs/project-map/README.md"
VIEWER_PATH = ROOT / "docs/project-map/viewer.html"
QUALITY_MAP_PATH = ROOT / "docs/project-map/QUALITY_MAP.md"
CATALOG_PATH = ROOT / "docs/testing/test-catalog.yaml"
NX_GRAPH_PATH = ROOT / "docs/project-map/nx-project-graph.json"

REFERENCE_FILES = (
    ROOT / "README.md",
    ROOT / "AGENTS.md",
    ROOT / "START_HERE_FOR_AI.md",
    ROOT / "docs/product/README.md",
    ROOT / "docs/delivery/BOT_RUNBOOK.md",
    ROOT / "docs/project-map/TASK_SYSTEM.md",
    ROOT / "docs/testing/TEST_STRATEGY.md",
    PROGRAM_PATH,
    PROJECT_MAP_MD,
    PROJECT_MAP_README,
    QUALITY_MAP_PATH,
    VIEWER_PATH,
)

CANONICAL_PORTS = {"web": 4610, "api": 4611, "e2e": 4612}
FORBIDDEN_PORTS = {3000, 3100, 5173}
ACTIVE_TASK_STATUSES = {"ready", "in_progress", "in_review"}
STARTED_TASK_STATUSES = {"in_progress", "in_review"}
FUTURE_TASK_STATUSES = {"blocked", "planned"}
ACTIVE_MAP_NODE_STATUSES = {"in_progress", "in_review"}
CODE_PREFIXES = (
    "apps/",
    "packages/",
    "contexts/",
    "modules/",
    "crates/",
    "schemas/",
    "migrations/",
)
CODE_FILES = {
    "package.json",
    "pnpm-lock.yaml",
    "nx.json",
    "tsconfig.base.json",
    "eslint.config.mjs",
    "eslint.boundaries.config.mjs",
}
DELIVERY_FILES = {
    "docs/delivery/EXECUTION_MANIFEST.yaml",
    "docs/delivery/DEVELOPMENT_PROGRAM_V1.md",
    "docs/delivery/LOCAL_PORT_POLICY.md",
}
REQUIRED_DELIVERY_SYNC = {
    *DELIVERY_FILES,
    "docs/project-map/project-map.yaml",
    "docs/project-map/PROJECT_MAP.md",
    "docs/project-map/QUALITY_MAP.md",
    "docs/project-map/README.md",
    "docs/project-map/viewer.html",
    "docs/testing/test-catalog.yaml",
}


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
        errors.append(f"{label} must contain only non-empty strings")
        return []
    return list(value)


def validate_documents(errors: list[str]) -> None:
    required = (
        MANIFEST_PATH,
        PROGRAM_PATH,
        PORT_PATH,
        MAP_PATH,
        PROJECT_MAP_MD,
        PROJECT_MAP_README,
        VIEWER_PATH,
        QUALITY_MAP_PATH,
        CATALOG_PATH,
        NX_GRAPH_PATH,
    )
    for path in required:
        if not path.is_file():
            errors.append(f"Missing delivery/map document: {path.relative_to(ROOT)}")

    for path in REFERENCE_FILES:
        if not path.is_file():
            errors.append(f"Missing required reference file: {path.relative_to(ROOT)}")
            continue
        text = path.read_text(encoding="utf-8")
        if "EXECUTION_MANIFEST.yaml" not in text:
            errors.append(f"{path.relative_to(ROOT)} must reference EXECUTION_MANIFEST.yaml")

    if PROGRAM_PATH.is_file():
        text = PROGRAM_PATH.read_text(encoding="utf-8").casefold()
        for marker in (
            "technical product alpha",
            "school pilot",
            "task-project-shell-001",
            "task-checkers-lite-001",
            "task-electronics-alpha-001",
            "scope freeze",
            "milestone:",
            "architecture horizon",
            "map protocol",
        ):
            if marker.casefold() not in text:
                errors.append(f"Development Program misses marker: {marker}")

    if VIEWER_PATH.is_file():
        text = VIEWER_PATH.read_text(encoding="utf-8")
        for marker in (
            "EXECUTION_MANIFEST.yaml",
            "delivery_stage",
            "architecture_horizon",
            "manifestOrder",
            "mapOrder",
        ):
            if marker not in text:
                errors.append(f"Interactive viewer misses execution marker: {marker}")


def validate_ports(manifest: dict[str, Any], errors: list[str]) -> None:
    ports = manifest.get("ports")
    if not isinstance(ports, dict):
        errors.append("Execution manifest ports must be an object")
        return
    if ports.get("bind") != "127.0.0.1":
        errors.append("Execution manifest must bind first-party dev servers to 127.0.0.1")
    for name, expected in CANONICAL_PORTS.items():
        if ports.get(name) != expected:
            errors.append(f"Execution manifest port {name} must be {expected}")
    forbidden = set(ports.get("forbidden") or [])
    if forbidden != FORBIDDEN_PORTS:
        errors.append(f"Execution manifest forbidden ports must be {sorted(FORBIDDEN_PORTS)}")

    if PORT_PATH.is_file():
        text = PORT_PATH.read_text(encoding="utf-8")
        for port in (*CANONICAL_PORTS.values(), *FORBIDDEN_PORTS):
            if str(port) not in text:
                errors.append(f"Port Policy misses required port declaration: {port}")
        if "127.0.0.1" not in text:
            errors.append("Port Policy must require loopback binding")
        if "не завершать процесс" not in text and "не завершать чужой процесс" not in text:
            errors.append("Port Policy must prohibit killing unknown processes")


def expand_profiles(
    task: dict[str, Any], profiles: dict[str, list[str]], errors: list[str]
) -> set[str]:
    result: set[str] = set()
    for profile_name in string_list(
        task.get("test_profiles"), f"{task.get('task_id')}.test_profiles", errors
    ):
        tests = profiles.get(profile_name)
        if tests is None:
            errors.append(f"Task {task.get('task_id')} references unknown test profile {profile_name}")
            continue
        result.update(tests)
    result.update(
        string_list(task.get("task_tests"), f"{task.get('task_id')}.task_tests", errors)
    )
    return result


def validate_manifest(
    manifest: dict[str, Any], catalog: dict[str, Any], errors: list[str]
) -> list[dict[str, Any]]:
    if manifest.get("schema_version") != "1.0.0":
        errors.append("Unsupported execution manifest schema_version")
    if manifest.get("program_id") != "PROGRAM-ALPHA-001":
        errors.append("Execution manifest program_id must be PROGRAM-ALPHA-001")

    protocol = manifest.get("map_protocol")
    if not isinstance(protocol, dict):
        errors.append("Execution manifest must contain map_protocol")
    else:
        for state in ("start", "draft_pr", "after_merge"):
            string_list(protocol.get(state), f"map_protocol.{state}", errors)

    raw_profiles = manifest.get("test_profiles")
    if not isinstance(raw_profiles, dict) or not raw_profiles:
        errors.append("Execution manifest test_profiles must be a non-empty object")
        raw_profiles = {}
    profiles = {
        str(name): string_list(value, f"test_profiles.{name}", errors)
        for name, value in raw_profiles.items()
    }

    tasks_raw = manifest.get("tasks")
    if not isinstance(tasks_raw, list):
        errors.append("Execution manifest tasks must be an array")
        return []
    tasks = sorted(
        (task for task in tasks_raw if isinstance(task, dict)),
        key=lambda task: task.get("position", 0),
    )
    if len(tasks) != 10:
        errors.append(f"Execution manifest must contain exactly 10 executable tasks, got {len(tasks)}")
    positions = [task.get("position") for task in tasks]
    if positions != list(range(1, len(tasks) + 1)):
        errors.append(f"Execution manifest positions must be contiguous: {positions}")

    catalog_tests = catalog.get("tests")
    if not isinstance(catalog_tests, list):
        errors.append("Test catalog tests must be an array")
        catalog_tests = []
    known_tests = {
        item.get("id")
        for item in catalog_tests
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    actual_by_task: dict[str, set[str]] = defaultdict(set)
    for item in catalog_tests:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            continue
        for task_id in item.get("required_for") or []:
            if isinstance(task_id, str):
                actual_by_task[task_id].add(item["id"])

    seen_task_ids: set[str] = set()
    seen_issues: set[str] = set()
    seen_stages: set[str] = set()
    for index, task in enumerate(tasks):
        task_id = task.get("task_id")
        if not isinstance(task_id, str) or not task_id.startswith("TASK-"):
            errors.append(f"Execution manifest task #{index + 1} has invalid task_id")
            continue
        if task_id in seen_task_ids:
            errors.append(f"Duplicate execution task: {task_id}")
        seen_task_ids.add(task_id)

        for field in (
            "issue",
            "branch",
            "milestone",
            "track",
            "delivery_stage",
            "architecture_horizon",
            "visible_result",
        ):
            value = task.get(field)
            if not isinstance(value, str) or not value.strip():
                errors.append(f"Task {task_id} has empty {field}")

        issue = task.get("issue")
        if not isinstance(issue, str) or "github.com/spikeal8-maker/asa-lab/issues/" not in issue:
            errors.append(f"Task {task_id} must reference an ASA Lab GitHub Issue")
        elif issue in seen_issues:
            errors.append(f"Duplicate executable Issue in manifest: {issue}")
        else:
            seen_issues.add(issue)

        stage = task.get("delivery_stage")
        if isinstance(stage, str):
            if stage in seen_stages:
                errors.append(f"Duplicate delivery stage: {stage}")
            seen_stages.add(stage)

        string_list(task.get("depends_on"), f"{task_id}.depends_on", errors)
        string_list(task.get("capabilities"), f"{task_id}.capabilities", errors)
        string_list(task.get("read"), f"{task_id}.read", errors)
        map_nodes = string_list(task.get("map_nodes"), f"{task_id}.map_nodes", errors)
        string_list(task.get("artifacts"), f"{task_id}.artifacts", errors)
        if "PROGRAM-ALPHA-001" not in map_nodes:
            errors.append(f"Task {task_id} map_nodes must include PROGRAM-ALPHA-001")
        if task.get("architecture_horizon") not in map_nodes:
            errors.append(f"Task {task_id} map_nodes must include its architecture horizon")
        if task.get("track") == "technical-alpha" and "TRACK-TECH-ALPHA" not in map_nodes:
            errors.append(f"Task {task_id} map_nodes must include TRACK-TECH-ALPHA")
        if task.get("track") == "school-pilot" and "TRACK-SCHOOL-PILOT" not in map_nodes:
            errors.append(f"Task {task_id} map_nodes must include TRACK-SCHOOL-PILOT")

        expected_next = tasks[index + 1].get("task_id") if index + 1 < len(tasks) else None
        if task.get("next_task") != expected_next:
            errors.append(
                f"Task {task_id} next_task must be {expected_next!r}, got {task.get('next_task')!r}"
            )

        expected_tests = expand_profiles(task, profiles, errors)
        unknown = sorted(expected_tests - known_tests)
        if unknown:
            errors.append(f"Task {task_id} references unknown tests: {', '.join(unknown)}")
        actual_tests = actual_by_task.get(task_id, set())
        missing = sorted(expected_tests - actual_tests)
        extra = sorted(actual_tests - expected_tests)
        if missing:
            errors.append(f"Task {task_id} test catalog misses: {', '.join(missing)}")
        if extra:
            errors.append(f"Task {task_id} test catalog has unmanifested tests: {', '.join(extra)}")

    return tasks


def validate_map(
    tasks: list[dict[str, Any]], document: dict[str, Any], errors: list[str]
) -> None:
    nodes_raw = document.get("nodes")
    edges_raw = document.get("edges")
    queue_raw = document.get("execution_queue")
    if not isinstance(nodes_raw, list) or not isinstance(edges_raw, list) or not isinstance(queue_raw, list):
        errors.append("Project map must contain nodes, edges and execution_queue arrays")
        return

    nodes = {
        item.get("id"): item
        for item in nodes_raw
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    canonical_ids = [task["task_id"] for task in tasks]
    queue_ids = [
        item.get("task_id")
        for item in sorted(
            (item for item in queue_raw if isinstance(item, dict)),
            key=lambda item: item.get("position", 0),
        )
    ]
    if queue_ids != canonical_ids:
        errors.append("Project map execution_queue differs from Execution Manifest")

    dependencies: dict[str, set[str]] = {task_id: set() for task_id in canonical_ids}
    for edge in edges_raw:
        if not isinstance(edge, dict) or edge.get("type") != "depends_on":
            continue
        source, target = edge.get("from"), edge.get("to")
        if source in dependencies and isinstance(target, str):
            dependencies[source].add(target)

    map_node_refs: dict[str, list[str]] = defaultdict(list)
    for task in tasks:
        task_id = task["task_id"]
        node = nodes.get(task_id)
        if not isinstance(node, dict):
            errors.append(f"Project map misses canonical task node: {task_id}")
            continue
        if node.get("issue") != task.get("issue"):
            errors.append(f"Project map Issue mismatch for {task_id}")
        if node.get("phase") != task.get("architecture_horizon"):
            errors.append(
                f"Project map architecture horizon mismatch for {task_id}: "
                f"expected {task.get('architecture_horizon')}, got {node.get('phase')}"
            )
        expected_dependencies = set(task.get("depends_on") or [])
        if dependencies.get(task_id, set()) != expected_dependencies:
            errors.append(
                f"Project map dependencies mismatch for {task_id}: "
                f"expected {sorted(expected_dependencies)}, got {sorted(dependencies.get(task_id, set()))}"
            )
        for map_node in task.get("map_nodes") or []:
            if map_node not in nodes:
                errors.append(f"Task {task_id} references missing map node {map_node}")
            else:
                map_node_refs[map_node].append(task_id)

    project = document.get("project")
    focus = project.get("current_focus") if isinstance(project, dict) else None
    if focus not in canonical_ids:
        errors.append(f"current_focus must belong to Execution Manifest, got {focus!r}")
        return
    focus_index = canonical_ids.index(focus)
    task_statuses = {task_id: nodes.get(task_id, {}).get("status") for task_id in canonical_ids}
    for index, task_id in enumerate(canonical_ids):
        status = task_statuses[task_id]
        if index < focus_index and status != "done":
            errors.append(f"Task before current_focus must be done: {task_id} is {status}")
        elif index == focus_index and status not in ACTIVE_TASK_STATUSES:
            errors.append(f"current_focus {task_id} must be ready/in_progress/in_review, got {status}")
        elif index > focus_index and status not in FUTURE_TASK_STATUSES:
            errors.append(f"Task after current_focus must be blocked/planned: {task_id} is {status}")

    for map_node, task_ids in sorted(map_node_refs.items()):
        node_status = nodes[map_node].get("status")
        statuses = [task_statuses[task_id] for task_id in task_ids]
        all_done = bool(statuses) and all(status == "done" for status in statuses)
        any_done = any(status == "done" for status in statuses)
        any_started = any(status in STARTED_TASK_STATUSES for status in statuses)
        any_unfinished = any(status != "done" for status in statuses)
        if all_done and node_status != "done":
            errors.append(f"Shared map node {map_node} must be done; all referencing tasks are done")
        elif any_started and node_status not in ACTIVE_MAP_NODE_STATUSES:
            errors.append(
                f"Map node {map_node} must be in_progress/in_review while a referencing task is active; got {node_status}"
            )
        elif any_done and any_unfinished and node_status != "in_progress":
            errors.append(
                f"Shared map node {map_node} must remain in_progress until all referencing tasks are done; got {node_status}"
            )


def changed_files_against_base() -> set[str]:
    base_ref = os.getenv("GITHUB_BASE_REF", "").strip()
    candidates = [f"origin/{base_ref}" if base_ref else "", "origin/main", "main"]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            merge_base = subprocess.run(
                ["git", "merge-base", candidate, "HEAD"],
                cwd=ROOT,
                check=True,
                text=True,
                capture_output=True,
            ).stdout.strip()
            output = subprocess.run(
                ["git", "diff", "--name-only", f"{merge_base}...HEAD"],
                cwd=ROOT,
                check=True,
                text=True,
                capture_output=True,
            ).stdout
            return {line.strip() for line in output.splitlines() if line.strip()}
        except (OSError, subprocess.CalledProcessError):
            continue
    return set()


def validate_change_policy(errors: list[str]) -> None:
    changed = changed_files_against_base()
    if not changed:
        return

    code_changed = any(path in CODE_FILES or path.startswith(CODE_PREFIXES) for path in changed)
    if code_changed:
        for required in (
            "docs/project-map/project-map.yaml",
            "docs/project-map/PROJECT_MAP.md",
            "docs/project-map/QUALITY_MAP.md",
            "docs/project-map/nx-project-graph.json",
        ):
            if required not in changed:
                errors.append(f"Product code changed without required map artifact: {required}")

    if "docs/project-map/project-map.yaml" in changed and "docs/project-map/PROJECT_MAP.md" not in changed:
        errors.append("project-map.yaml changed without PROJECT_MAP.md")
    if "docs/testing/test-catalog.yaml" in changed and "docs/project-map/QUALITY_MAP.md" not in changed:
        errors.append("test-catalog.yaml changed without QUALITY_MAP.md")

    if changed & DELIVERY_FILES:
        for required in sorted(REQUIRED_DELIVERY_SYNC):
            if required not in changed:
                errors.append(f"Delivery contract changed without synchronized file: {required}")


def main() -> int:
    errors: list[str] = []
    validate_documents(errors)
    manifest = load_yaml(MANIFEST_PATH, errors)
    project_map = load_yaml(MAP_PATH, errors)
    catalog = load_yaml(CATALOG_PATH, errors)
    validate_ports(manifest, errors)
    tasks = validate_manifest(manifest, catalog, errors)
    validate_map(tasks, project_map, errors)
    validate_change_policy(errors)

    if errors:
        print("ASA Lab execution contract validation: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    focus = project_map.get("project", {}).get("current_focus")
    print("ASA Lab execution contract validation: PASS")
    print(f"- canonical tasks: {len(tasks)}")
    print(f"- current focus: {focus}")
    print("- ports: web=4610 api=4611 e2e=4612")
    print("- task/test/map synchronization: PASS")
    print("- delivery stages vs architecture horizons: PASS")
    print("- map node lifecycle and interactive viewer contract: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
