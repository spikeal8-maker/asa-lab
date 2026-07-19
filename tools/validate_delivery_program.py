#!/usr/bin/env python3
"""Validate the canonical ASA Lab Product Alpha → School Pilot execution contract.

The validator cross-checks the machine-readable execution manifest, project map,
test catalog, port policy and required human-readable documents.  It intentionally
validates delivery *stages* separately from architecture horizons: the Technical
Alpha may prove a later architecture capability before an earlier school-pilot
capability, but the executable task order must remain exact and deterministic.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "docs/delivery/EXECUTION_MANIFEST.yaml"
PROGRAM_PATH = ROOT / "docs/delivery/DEVELOPMENT_PROGRAM_V1.md"
PORT_PATH = ROOT / "docs/delivery/LOCAL_PORT_POLICY.md"
MAP_PATH = ROOT / "docs/project-map/project-map.yaml"
PROJECT_MAP_MD = ROOT / "docs/project-map/PROJECT_MAP.md"
QUALITY_MAP_PATH = ROOT / "docs/project-map/QUALITY_MAP.md"
CATALOG_PATH = ROOT / "docs/testing/test-catalog.yaml"
NX_GRAPH_PATH = ROOT / "docs/project-map/nx-project-graph.json"

REFERENCE_FILES = (
    ROOT / "AGENTS.md",
    ROOT / "START_HERE_FOR_AI.md",
    ROOT / "docs/delivery/BOT_RUNBOOK.md",
    ROOT / "docs/project-map/TASK_SYSTEM.md",
    PROGRAM_PATH,
    PROJECT_MAP_MD,
    QUALITY_MAP_PATH,
)

CANONICAL_PORTS = {"web": 4610, "api": 4611, "e2e": 4612}
FORBIDDEN_PORTS = {3000, 3100, 5173}
ACTIVE_STATUSES = {"ready", "in_progress", "in_review"}
LATER_STATUSES = {"blocked", "planned"}
CODE_PREFIXES = ("apps/", "packages/", "contexts/", "modules/", "crates/", "schemas/", "migrations/")
CODE_FILES = {
    "package.json",
    "pnpm-lock.yaml",
    "nx.json",
    "tsconfig.base.json",
    "eslint.config.mjs",
    "eslint.boundaries.config.mjs",
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


def required_strings(value: Any, name: str, errors: list[str]) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) or not item.strip() for item in value):
        errors.append(f"{name} must be an array of non-empty strings")
        return []
    return list(value)


def validate_documents(errors: list[str]) -> None:
    for path in (MANIFEST_PATH, PROGRAM_PATH, PORT_PATH, MAP_PATH, PROJECT_MAP_MD, QUALITY_MAP_PATH, CATALOG_PATH):
        if not path.is_file():
            errors.append(f"Missing delivery document: {path.relative_to(ROOT)}")

    for path in REFERENCE_FILES:
        if not path.is_file():
            errors.append(f"Missing required reference file: {path.relative_to(ROOT)}")
            continue
        text = path.read_text(encoding="utf-8")
        if "EXECUTION_MANIFEST.yaml" not in text:
            errors.append(f"{path.relative_to(ROOT)} must reference EXECUTION_MANIFEST.yaml")

    if PROGRAM_PATH.is_file():
        text = PROGRAM_PATH.read_text(encoding="utf-8")
        for marker in (
            "Technical Product Alpha",
            "School Pilot",
            "TASK-PROJECT-SHELL-001",
            "TASK-CHECKERS-LITE-001",
            "TASK-ELECTRONICS-ALPHA-001",
            "Scope freeze",
            "MILESTONE:",
            "architecture horizon",
        ):
            if marker.lower() not in text.lower():
                errors.append(f"Development Program misses marker: {marker}")


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
    profile_names = required_strings(task.get("test_profiles"), f"{task.get('task_id')}.test_profiles", errors)
    for profile_name in profile_names:
        tests = profiles.get(profile_name)
        if tests is None:
            errors.append(f"Task {task.get('task_id')} references unknown test profile {profile_name}")
            continue
        result.update(tests)
    result.update(required_strings(task.get("task_tests"), f"{task.get('task_id')}.task_tests", errors))
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
            required_strings(protocol.get(state), f"map_protocol.{state}", errors)

    raw_profiles = manifest.get("test_profiles")
    if not isinstance(raw_profiles, dict) or not raw_profiles:
        errors.append("Execution manifest test_profiles must be a non-empty object")
        raw_profiles = {}
    profiles: dict[str, list[str]] = {}
    for name, value in raw_profiles.items():
        profiles[str(name)] = required_strings(value, f"test_profiles.{name}", errors)

    tasks = manifest.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        errors.append("Execution manifest tasks must be a non-empty array")
        return []

    catalog_tests = catalog.get("tests")
    if not isinstance(catalog_tests, list):
        errors.append("Test catalog tests must be an array")
        catalog_tests = []
    known_test_ids = {
        item.get("id")
        for item in catalog_tests
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    actual_by_task: dict[str, set[str]] = {}
    for item in catalog_tests:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            continue
        for task_id in item.get("required_for") or []:
            if isinstance(task_id, str):
                actual_by_task.setdefault(task_id, set()).add(item["id"])

    seen_task_ids: set[str] = set()
    seen_positions: set[int] = set()
    ordered = sorted(
        (task for task in tasks if isinstance(task, dict)), key=lambda task: task.get("position", 0)
    )
    expected_positions = list(range(1, len(ordered) + 1))
    actual_positions = [task.get("position") for task in ordered]
    if actual_positions != expected_positions:
        errors.append(f"Execution manifest positions must be contiguous: {actual_positions}")

    for index, task in enumerate(ordered):
        task_id = task.get("task_id")
        if not isinstance(task_id, str) or not task_id.startswith("TASK-"):
            errors.append(f"Execution manifest task #{index + 1} has invalid task_id")
            continue
        if task_id in seen_task_ids:
            errors.append(f"Duplicate execution manifest task: {task_id}")
        seen_task_ids.add(task_id)
        position = task.get("position")
        if not isinstance(position, int) or position in seen_positions:
            errors.append(f"Invalid or duplicate position for {task_id}: {position!r}")
        seen_positions.add(position)

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
        required_strings(task.get("depends_on"), f"{task_id}.depends_on", errors)
        required_strings(task.get("capabilities"), f"{task_id}.capabilities", errors)
        required_strings(task.get("read"), f"{task_id}.read", errors)
        required_strings(task.get("map_nodes"), f"{task_id}.map_nodes", errors)
        required_strings(task.get("artifacts"), f"{task_id}.artifacts", errors)

        expected_next = ordered[index + 1].get("task_id") if index + 1 < len(ordered) else None
        if task.get("next_task") != expected_next:
            errors.append(
                f"Task {task_id} next_task must be {expected_next!r}, got {task.get('next_task')!r}"
            )

        expected_tests = expand_profiles(task, profiles, errors)
        unknown_tests = sorted(expected_tests - known_test_ids)
        if unknown_tests:
            errors.append(f"Task {task_id} references unknown tests: {', '.join(unknown_tests)}")
        actual_tests = actual_by_task.get(task_id, set())
        if actual_tests != expected_tests:
            missing = sorted(expected_tests - actual_tests)
            extra = sorted(actual_tests - expected_tests)
            if missing:
                errors.append(f"Task {task_id} test catalog misses: {', '.join(missing)}")
            if extra:
                errors.append(f"Task {task_id} test catalog has unmanifested tests: {', '.join(extra)}")

    return ordered


def validate_map(manifest_tasks: list[dict[str, Any]], document: dict[str, Any], errors: list[str]) -> None:
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
    canonical_ids = [task["task_id"] for task in manifest_tasks if isinstance(task.get("task_id"), str)]

    ordered_queue = [
        item.get("task_id")
        for item in sorted(
            (item for item in queue_raw if isinstance(item, dict)),
            key=lambda item: item.get("position", 0),
        )
    ]
    if ordered_queue != canonical_ids:
        errors.append("Project map execution_queue differs from execution manifest")

    dependency_edges: dict[str, set[str]] = {task_id: set() for task_id in canonical_ids}
    for edge in edges_raw:
        if not isinstance(edge, dict) or edge.get("type") != "depends_on":
            continue
        source, target = edge.get("from"), edge.get("to")
        if source in dependency_edges and isinstance(target, str):
            dependency_edges[source].add(target)

    for task in manifest_tasks:
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
        if dependency_edges.get(task_id, set()) != expected_dependencies:
            errors.append(
                f"Project map dependencies mismatch for {task_id}: "
                f"expected {sorted(expected_dependencies)}, got {sorted(dependency_edges.get(task_id, set()))}"
            )
        for map_node in task.get("map_nodes") or []:
            if map_node not in nodes:
                errors.append(f"Task {task_id} references missing map node {map_node}")

    project = document.get("project")
    focus = project.get("current_focus") if isinstance(project, dict) else None
    if focus not in canonical_ids:
        errors.append(f"current_focus must belong to execution manifest, got {focus!r}")
        return
    focus_index = canonical_ids.index(focus)
    for index, task_id in enumerate(canonical_ids):
        status = nodes.get(task_id, {}).get("status")
        if index < focus_index and status != "done":
            errors.append(f"Task before current_focus must be done: {task_id} is {status}")
        elif index == focus_index and status not in ACTIVE_STATUSES:
            errors.append(f"current_focus {task_id} must be ready/in_progress/in_review, got {status}")
        elif index > focus_index and status not in LATER_STATUSES:
            errors.append(f"Task after current_focus must be blocked/planned: {task_id} is {status}")


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

    delivery_changed = any(
        path in {
            "docs/delivery/EXECUTION_MANIFEST.yaml",
            "docs/delivery/DEVELOPMENT_PROGRAM_V1.md",
            "docs/delivery/LOCAL_PORT_POLICY.md",
        }
        for path in changed
    )
    if delivery_changed:
        for required in (
            "docs/delivery/EXECUTION_MANIFEST.yaml",
            "docs/delivery/DEVELOPMENT_PROGRAM_V1.md",
            "docs/delivery/LOCAL_PORT_POLICY.md",
            "docs/project-map/project-map.yaml",
            "docs/project-map/PROJECT_MAP.md",
            "docs/project-map/QUALITY_MAP.md",
            "docs/testing/test-catalog.yaml",
        ):
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
    print("- delivery stages are distinct from architecture horizons: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
