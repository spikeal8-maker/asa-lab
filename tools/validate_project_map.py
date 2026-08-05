#!/usr/bin/env python3
"""Validate the ASA Lab project knowledge graph and executable queue."""

from __future__ import annotations

import os
import subprocess
import sys
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
MAP_PATH = ROOT / "docs/project-map/project-map.yaml"
MANIFEST_PATH = ROOT / "docs/delivery/EXECUTION_MANIFEST.yaml"
CURRENT_PATH = ROOT / "docs/execution/current.yaml"
RENDERED_MAP_PATH = ROOT / "docs/project-map/PROJECT_MAP.md"


def active_task_from_control_plane() -> str:
    """The active task has exactly one home: docs/execution/current.yaml."""
    document = yaml.safe_load(CURRENT_PATH.read_text(encoding="utf-8"))
    return str(document["task"]["id"])

ALLOWED_STATUSES = {
    "planned",
    "blocked",
    "ready",
    "in_progress",
    "in_review",
    "done",
    "deprecated",
}
ACTIVE_STATUSES = {"ready", "in_progress", "in_review"}
ALLOWED_RELATIONS = {
    "contains",
    "uses",
    "depends_on",
    "produces",
    "implements",
    "governs",
    "observes",
    "stores_in",
    "queues_to",
    "serves",
    "next",
}
REQUIRED_MAP_FILES = (
    ROOT / "docs/project-map/README.md",
    ROOT / "docs/project-map/PROJECT_MAP.md",
    ROOT / "docs/project-map/TASK_SYSTEM.md",
    ROOT / "docs/project-map/viewer.html",
    ROOT / "docs/architecture/structurizr/workspace.dsl",
)
ARCHITECTURE_SENSITIVE_PREFIXES = (
    "apps/",
    "packages/",
    "contexts/",
    "modules/",
    "crates/",
    "infra/",
    "schemas/",
    "docs/architecture/",
)
ARCHITECTURE_SENSITIVE_FILES = {
    "AGENTS.md",
    "START_HERE_FOR_AI.md",
    "README.md",
    ".github/workflows/spec-validation.yml",
}


def fail(errors: list[str]) -> int:
    print("ASA Lab project map validation: FAIL", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    return 1


def load_map(errors: list[str]) -> dict[str, Any]:
    if not MAP_PATH.is_file():
        errors.append(f"Missing project map: {MAP_PATH.relative_to(ROOT)}")
        return {}
    try:
        value = yaml.safe_load(MAP_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"Cannot parse project map YAML: {exc}")
        return {}
    if not isinstance(value, dict):
        errors.append("Project map root must be an object")
        return {}
    return value


def load_manifest(errors: list[str]) -> dict[str, Any]:
    if not MANIFEST_PATH.is_file():
        errors.append(f"Missing execution manifest: {MANIFEST_PATH.relative_to(ROOT)}")
        return {}
    try:
        value = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"Cannot parse execution manifest YAML: {exc}")
        return {}
    if not isinstance(value, dict):
        errors.append("Execution manifest root must be an object")
        return {}
    return value


def validate_required_files(errors: list[str]) -> None:
    for path in REQUIRED_MAP_FILES:
        if not path.is_file():
            errors.append(f"Missing project map file: {path.relative_to(ROOT)}")


def validate_nodes(document: dict[str, Any], errors: list[str]) -> dict[str, dict[str, Any]]:
    raw = document.get("nodes")
    if not isinstance(raw, list):
        errors.append("nodes must be an array")
        return {}

    nodes: dict[str, dict[str, Any]] = {}
    required = {"id", "label", "kind", "layer", "status", "summary"}
    for position, node in enumerate(raw, start=1):
        if not isinstance(node, dict):
            errors.append(f"Node #{position} must be an object")
            continue
        missing = required - set(node)
        if missing:
            errors.append(f"Node #{position} misses fields: {', '.join(sorted(missing))}")
            continue
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id.strip():
            errors.append(f"Node #{position} has invalid id")
            continue
        if node_id in nodes:
            errors.append(f"Duplicate node id: {node_id}")
            continue
        if node.get("status") not in ALLOWED_STATUSES:
            errors.append(f"Node {node_id} has invalid status: {node.get('status')!r}")
        for field in ("label", "kind", "layer", "summary"):
            value = node.get(field)
            if not isinstance(value, str) or not value.strip():
                errors.append(f"Node {node_id} has empty {field}")
        nodes[node_id] = node

    if len(nodes) < 40:
        errors.append(f"Project map is unexpectedly small: {len(nodes)} nodes")
    return nodes


def validate_edges(
    document: dict[str, Any], nodes: dict[str, dict[str, Any]], errors: list[str]
) -> list[dict[str, Any]]:
    raw = document.get("edges")
    if not isinstance(raw, list):
        errors.append("edges must be an array")
        return []

    edges: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for position, edge in enumerate(raw, start=1):
        if not isinstance(edge, dict):
            errors.append(f"Edge #{position} must be an object")
            continue
        source = edge.get("from")
        target = edge.get("to")
        relation = edge.get("type")
        label = edge.get("label", "")
        if source not in nodes:
            errors.append(f"Edge #{position} has unknown source: {source!r}")
        if target not in nodes:
            errors.append(f"Edge #{position} has unknown target: {target!r}")
        if relation not in ALLOWED_RELATIONS:
            errors.append(f"Edge #{position} has invalid relation: {relation!r}")
        if source == target:
            errors.append(f"Self edge is not allowed: {source}")
        key = (str(source), str(target), str(relation), str(label))
        if key in seen:
            errors.append(f"Duplicate edge: {key}")
        seen.add(key)
        edges.append(edge)

    if len(edges) < 60:
        errors.append(f"Project map is unexpectedly sparse: {len(edges)} edges")
    return edges


def validate_task_dependencies(
    nodes: dict[str, dict[str, Any]], edges: list[dict[str, Any]], errors: list[str]
) -> None:
    task_ids = {node_id for node_id, node in nodes.items() if node.get("kind") == "task"}
    dependencies: dict[str, set[str]] = {task_id: set() for task_id in task_ids}
    reverse: dict[str, set[str]] = defaultdict(set)

    for edge in edges:
        if edge.get("type") != "depends_on":
            continue
        source = edge.get("from")
        target = edge.get("to")
        if source not in task_ids or target not in task_ids:
            errors.append(f"Task dependency must connect task nodes: {source} -> {target}")
            continue
        dependencies[source].add(target)
        reverse[target].add(source)

    indegree = {task_id: len(dependencies[task_id]) for task_id in task_ids}
    queue = deque(sorted(task_id for task_id, count in indegree.items() if count == 0))
    visited = 0
    while queue:
        current = queue.popleft()
        visited += 1
        for dependent in reverse[current]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                queue.append(dependent)
    if visited != len(task_ids):
        errors.append(
            "Task dependency cycle detected: "
            + ", ".join(sorted(task_id for task_id, count in indegree.items() if count > 0))
        )

    for task_id in sorted(task_ids):
        status = nodes[task_id].get("status")
        unfinished = [
            dependency
            for dependency in dependencies[task_id]
            if nodes[dependency].get("status") != "done"
        ]
        if status in ACTIVE_STATUSES | {"done"} and unfinished:
            if task_id == "TASK-ARCH-001" and status == "in_review":
                continue
            errors.append(
                f"Task {task_id} is {status} but dependencies are not done: "
                + ", ".join(sorted(unfinished))
            )


def validate_execution_queue(
    document: dict[str, Any], nodes: dict[str, dict[str, Any]], errors: list[str]
) -> list[str]:
    raw = document.get("execution_queue")
    if not isinstance(raw, list) or not raw:
        errors.append("execution_queue must be a non-empty array")
        return []

    ordered = sorted((item for item in raw if isinstance(item, dict)), key=lambda item: item.get("position", 0))
    positions = [item.get("position") for item in ordered]
    if positions != list(range(1, len(ordered) + 1)):
        errors.append(f"Execution queue positions must be contiguous: {positions}")

    task_ids: list[str] = []
    for item in ordered:
        task_id = item.get("task_id")
        if task_id not in nodes or nodes[task_id].get("kind") != "task":
            errors.append(f"Execution queue references non-task node: {task_id!r}")
            continue
        if task_id in task_ids:
            errors.append(f"Duplicate task in execution queue: {task_id}")
        task_ids.append(task_id)
        for field in ("instruction", "gate"):
            value = item.get(field)
            if not isinstance(value, str) or not value.strip():
                errors.append(f"Execution queue task {task_id} has empty {field}")
    return task_ids


def validate_focus(
    document: dict[str, Any], nodes: dict[str, dict[str, Any]], queue_ids: list[str], errors: list[str]
) -> None:
    project = document.get("project")
    if not isinstance(project, dict):
        errors.append("project must be an object")
        return

    active_tasks = sorted(
        node_id
        for node_id, node in nodes.items()
        if node.get("kind") == "task" and node.get("status") in ACTIVE_STATUSES
    )
    if len(active_tasks) > 1:
        errors.append("Only one active task is allowed: " + ", ".join(active_tasks))

    focus = project.get("current_focus")
    if focus is None:
        if active_tasks:
            errors.append(f"current_focus is null but active tasks exist: {active_tasks}")
        unfinished = [task_id for task_id in queue_ids if nodes[task_id].get("status") != "done"]
        if unfinished:
            errors.append(
                "current_focus may be null only when the executable queue is complete: "
                + ", ".join(unfinished)
            )
        return

    if focus not in nodes:
        errors.append(f"current_focus references unknown node: {focus!r}")
        return
    if nodes[focus].get("kind") != "task":
        errors.append("current_focus must reference a task node")
    if nodes[focus].get("status") not in ACTIVE_STATUSES:
        errors.append(f"current_focus must be active, got {nodes[focus].get('status')!r}")
    if active_tasks and active_tasks != [focus]:
        errors.append(f"current_focus {focus} does not match active task {active_tasks}")


def changed_files_against_base() -> set[str]:
    base_ref = os.getenv("GITHUB_BASE_REF", "").strip()
    if not base_ref:
        return set()
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", f"origin/{base_ref}...HEAD"],
            cwd=ROOT,
            check=True,
            text=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return set()
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def validate_map_change_policy(errors: list[str]) -> None:
    changed = changed_files_against_base()
    if not changed:
        return
    architecture_changed = any(
        path in ARCHITECTURE_SENSITIVE_FILES
        or path.startswith(ARCHITECTURE_SENSITIVE_PREFIXES)
        for path in changed
    )
    map_changed = "docs/project-map/project-map.yaml" in changed
    rendered_changed = "docs/project-map/PROJECT_MAP.md" in changed
    if architecture_changed and not map_changed:
        errors.append("Architecture-sensitive files changed without project-map.yaml update")
    if map_changed and not rendered_changed:
        errors.append("project-map.yaml changed without PROJECT_MAP.md update")


def validate_delivery_alignment(
    document: dict[str, Any],
    manifest: dict[str, Any],
    nodes: dict[str, dict[str, Any]],
    errors: list[str],
) -> None:
    canonical_state = manifest.get("canonical_state")
    tasks = manifest.get("tasks")
    if not isinstance(canonical_state, dict) or not isinstance(tasks, list):
        errors.append("Execution manifest must expose canonical_state and tasks")
        return
    # Read from the control plane, not from a copy inside the manifest.
    active_task = active_task_from_control_plane()
    manifest_task = next(
        (
            task
            for task in tasks
            if isinstance(task, dict) and task.get("task_id") == active_task
        ),
        None,
    )
    if not isinstance(active_task, str) or not isinstance(manifest_task, dict):
        errors.append("Execution manifest active task is missing from tasks")
        return
    status = manifest_task.get("status")
    if document.get("project", {}).get("current_focus") != active_task:
        errors.append("Project map current_focus differs from execution manifest")
    for node_id in (active_task, manifest_task.get("architecture_horizon"), "ACT-AGENT"):
        node = nodes.get(str(node_id))
        if not isinstance(node, dict) or node.get("status") != status:
            errors.append(f"Project map node {node_id} must match manifest status {status!r}")
    rendered = (
        RENDERED_MAP_PATH.read_text(encoding="utf-8")
        if RENDERED_MAP_PATH.is_file()
        else ""
    )
    if f"status {status}" not in rendered:
        errors.append(f"PROJECT_MAP.md must display manifest status {status!r}")


def main() -> int:
    errors: list[str] = []
    validate_required_files(errors)
    document = load_map(errors)
    manifest = load_manifest(errors)
    if not document:
        return fail(errors)
    if document.get("schema_version") != "1.0.0":
        errors.append("Unsupported project map schema_version")
    nodes = validate_nodes(document, errors)
    edges = validate_edges(document, nodes, errors)
    validate_task_dependencies(nodes, edges, errors)
    queue_ids = validate_execution_queue(document, nodes, errors)
    validate_focus(document, nodes, queue_ids, errors)
    validate_delivery_alignment(document, manifest, nodes, errors)
    validate_map_change_policy(errors)
    if errors:
        return fail(errors)
    focus = document.get("project", {}).get("current_focus")
    print("ASA Lab project map validation: PASS")
    print(f"- nodes: {len(nodes)}")
    print(f"- edges: {len(edges)}")
    print(f"- current focus: {focus}")
    print(f"- executable tasks: {len(queue_ids)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
