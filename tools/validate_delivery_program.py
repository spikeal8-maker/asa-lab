#!/usr/bin/env python3
"""Validate the canonical ASA Lab Product Alpha → School Pilot program."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
PROGRAM_PATH = ROOT / "docs/delivery/DEVELOPMENT_PROGRAM_V1.md"
PORT_PATH = ROOT / "docs/delivery/LOCAL_PORT_POLICY.md"
MAP_PATH = ROOT / "docs/project-map/project-map.yaml"

EXPECTED_QUEUE = [
    "TASK-PRODUCT-DOC-001",
    "TASK-PORTAL-001",
    "TASK-PROJECT-SHELL-001",
    "TASK-CHECKERS-LITE-001",
    "TASK-ELECTRONICS-ALPHA-001",
    "TASK-SEAT-001",
    "TASK-ACT-001",
    "TASK-REVIEW-001",
    "TASK-ELEC-001",
]

EXPECTED_ISSUES = {
    "TASK-PRODUCT-DOC-001": "/issues/19",
    "TASK-PORTAL-001": "/issues/18",
    "TASK-PROJECT-SHELL-001": "/issues/24",
    "TASK-CHECKERS-LITE-001": "/issues/25",
    "TASK-ELECTRONICS-ALPHA-001": "/issues/26",
    "TASK-SEAT-001": "/issues/7",
    "TASK-ACT-001": "/issues/8",
    "TASK-REVIEW-001": "/issues/20",
    "TASK-ELEC-001": "/issues/6",
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


def validate_documents(errors: list[str]) -> None:
    for path in (PROGRAM_PATH, PORT_PATH):
        if not path.is_file():
            errors.append(f"Missing delivery document: {path.relative_to(ROOT)}")

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
        ):
            if marker not in text:
                errors.append(f"Development Program misses marker: {marker}")

    if PORT_PATH.is_file():
        text = PORT_PATH.read_text(encoding="utf-8")
        for port in ("4610", "4611", "4612"):
            if port not in text:
                errors.append(f"Port Policy misses canonical port: {port}")
        for port in ("3000", "3100", "5173"):
            if port not in text:
                errors.append(f"Port Policy must explicitly list forbidden port: {port}")
        if "127.0.0.1" not in text:
            errors.append("Port Policy must require loopback binding")
        if "не завершать процесс" not in text and "не завершать чужой процесс" not in text:
            errors.append("Port Policy must prohibit killing unknown processes")


def validate_map(document: dict[str, Any], errors: list[str]) -> None:
    nodes_raw = document.get("nodes")
    if not isinstance(nodes_raw, list):
        errors.append("Project map nodes must be an array")
        return
    nodes = {
        item.get("id"): item
        for item in nodes_raw
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }

    for task_id in EXPECTED_QUEUE:
        node = nodes.get(task_id)
        if not isinstance(node, dict):
            errors.append(f"Missing canonical task node: {task_id}")
            continue
        issue = node.get("issue")
        expected_suffix = EXPECTED_ISSUES[task_id]
        if not isinstance(issue, str) or expected_suffix not in issue:
            errors.append(f"Task {task_id} must reference GitHub {expected_suffix}")

    for doc_id in ("DOC-DEVELOPMENT-PROGRAM", "DOC-PORT-POLICY"):
        if doc_id not in nodes:
            errors.append(f"Missing delivery document node: {doc_id}")

    queue_raw = document.get("execution_queue")
    if not isinstance(queue_raw, list):
        errors.append("execution_queue must be an array")
        return
    ordered = [
        item.get("task_id")
        for item in sorted(
            (item for item in queue_raw if isinstance(item, dict)),
            key=lambda item: item.get("position", 0),
        )
    ]
    if ordered != EXPECTED_QUEUE:
        errors.append(
            "Canonical execution queue differs from Development Program: "
            + " -> ".join(str(item) for item in ordered)
        )

    project = document.get("project")
    focus = project.get("current_focus") if isinstance(project, dict) else None
    if focus not in EXPECTED_QUEUE:
        errors.append(f"current_focus must belong to canonical queue, got {focus!r}")


def main() -> int:
    errors: list[str] = []
    validate_documents(errors)
    document = load_yaml(MAP_PATH, errors)
    validate_map(document, errors)

    if errors:
        print("ASA Lab development program validation: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("ASA Lab development program validation: PASS")
    print("- tracks: Technical Product Alpha, School Pilot")
    print("- canonical tasks: " + str(len(EXPECTED_QUEUE)))
    print("- ports: web=4610 api=4611 e2e=4612")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
