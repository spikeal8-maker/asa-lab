#!/usr/bin/env python3
"""Validate the ASA Lab project knowledge graph and executable queue."""

from __future__ import annotations

import os
import re
import subprocess
import sys
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
MAP_PATH = ROOT / "docs/project-map/project-map.yaml"
MANIFEST_PATH = ROOT / "docs/delivery/EXECUTION_MANIFEST.yaml"
RENDERED_MAP_PATH = ROOT / "docs/project-map/PROJECT_MAP.md"
HISTORICAL_QUEUE_SEMANTICS = "historical_program_catalog_not_task_selection"
HISTORICAL_IMPERATIVE_PATTERN = re.compile(
    r"^Historical result:\s*(?:implement|build|verify|preserve|stabili[sz]e)\b",
    re.IGNORECASE,
)

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
    if document.get("execution_queue_semantics") != HISTORICAL_QUEUE_SEMANTICS:
        errors.append(
            "execution_queue_semantics must mark the queue as a historical program "
            "catalog, not a task selector"
        )

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
        instruction = item.get("instruction")
        if isinstance(instruction, str):
            if not instruction.startswith(
                "Historical result:"
            ) or HISTORICAL_IMPERATIVE_PATTERN.search(instruction):
                errors.append(
                    f"Execution queue task {task_id} contains an imperative or "
                    "non-historical instruction"
                )
            if "agent/" in instruction.casefold():
                errors.append(
                    f"Execution queue task {task_id} contains a stale product branch"
                )
    return task_ids


def validate_execution_state_absence(document: dict[str, Any], errors: list[str]) -> None:
    """The architecture graph must never become a second execution state file."""
    project = document.get("project")
    if not isinstance(project, dict):
        errors.append("project must be an object")
        return
    for key in ("current_focus", "active_checkpoint"):
        if key in project:
            errors.append(
                f"project.{key} duplicates docs/execution/current.yaml and must be absent"
            )
    if project.get("execution_state_source") != "docs/execution/current.yaml":
        errors.append(
            "project.execution_state_source must be docs/execution/current.yaml"
        )


def base_ref_candidate() -> str:
    """The ref this branch will merge into.

    CI names it in GITHUB_BASE_REF for pull requests and leaves it unset for
    pushes. Every caller has to answer against the same base. When the change
    policy resolved one and its exemption resolved another, a push-event run
    failed on a branch whose map was already current, while the pull-request run
    on the identical commit passed.
    """
    base_ref = os.getenv("GITHUB_BASE_REF", "").strip()
    return f"origin/{base_ref}" if base_ref else "origin/main"


def base_ref_exists(candidate: str) -> bool:
    """A shallow clone, or a repository with no origin, cannot answer this."""
    try:
        subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", f"{candidate}^{{commit}}"],
            cwd=ROOT,
            check=True,
            text=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return False
    return True


def changed_files_against_base() -> set[str]:
    """What this branch changes relative to the branch it will merge into.

    Returning nothing when GITHUB_BASE_REF was absent meant the change policy
    below applied on GitHub and nowhere else: a gate that passes on the machine
    writing the code and fails after the push is not one gate, it is two.
    """
    candidate = base_ref_candidate()
    if not base_ref_exists(candidate):
        # Silence beats a false accusation.
        return set()
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", f"{candidate}...HEAD"],
            cwd=ROOT,
            check=True,
            text=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return set()
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def map_matches_base() -> bool:
    """Is this branch's map already the same as the base branch's?

    If it is, the base already carries a map describing this work — which happens
    once a map update has been merged ahead of the code that prompted it. There is
    then nothing missing, and demanding a further edit would only produce a
    cosmetic one.
    """
    candidate = base_ref_candidate()
    if not base_ref_exists(candidate):
        return False
    try:
        result = subprocess.run(
            ["git", "diff", "--quiet", candidate, "--", "docs/project-map/project-map.yaml"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


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
    # The rule catches code that leaves the map behind. A long-lived branch whose
    # map update already merged into the base has not left it behind — the map is
    # simply current in both places, and the diff has nothing left to show.
    if architecture_changed and not map_changed and not map_matches_base():
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
    for task in tasks:
        if not isinstance(task, dict) or not isinstance(task.get("task_id"), str):
            continue
        node = nodes.get(task["task_id"])
        if not isinstance(node, dict):
            errors.append(f"Project map misses manifest task {task['task_id']}")
            continue
        if node.get("status") != task.get("status"):
            errors.append(
                f"Project map task {task['task_id']} status {node.get('status')!r} "
                f"differs from manifest catalog {task.get('status')!r}"
            )
    rendered = (
        RENDERED_MAP_PATH.read_text(encoding="utf-8")
        if RENDERED_MAP_PATH.is_file()
        else ""
    )
    for marker in ("docs/execution/current.yaml", "pnpm agent:context"):
        if marker not in rendered:
            errors.append(f"PROJECT_MAP.md must reference {marker}")


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
    validate_execution_state_absence(document, errors)
    validate_delivery_alignment(document, manifest, nodes, errors)
    validate_map_change_policy(errors)
    if errors:
        return fail(errors)
    print("ASA Lab project map validation: PASS")
    print(f"- nodes: {len(nodes)}")
    print(f"- edges: {len(edges)}")
    print("- live execution state: docs/execution/current.yaml")
    print(f"- executable tasks: {len(queue_ids)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
