#!/usr/bin/env python3
"""Validate the temporary owner-authorized infrastructure execution lane."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
FOCUS_PATH = ROOT / "docs/project-map/infrastructure-focus.yaml"
MANIFEST_PATH = ROOT / "docs/delivery/INFRASTRUCTURE_EXECUTION_MANIFEST.yaml"
PRODUCT_MAP_PATH = ROOT / "docs/project-map/project-map.yaml"

ALLOWED_PORTS = {"web": 4610, "api": 4611, "e2e": 4612}
FORBIDDEN_PORTS = {3000, 3100, 5173}
ACTIVE_STATUSES = {"ready", "in_progress", "in_review"}
TERMINAL_STATUSES = {"done", "cancelled", "superseded"}


def load_yaml(path: Path, errors: list[str]) -> dict[str, Any]:
    if not path.is_file():
        errors.append(f"Missing file: {path.relative_to(ROOT)}")
        return {}
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover - diagnostic path
        errors.append(f"Cannot parse {path.relative_to(ROOT)}: {exc}")
        return {}
    if not isinstance(value, dict):
        errors.append(f"{path.relative_to(ROOT)} root must be an object")
        return {}
    return value


def main() -> int:
    errors: list[str] = []
    focus = load_yaml(FOCUS_PATH, errors)
    manifest = load_yaml(MANIFEST_PATH, errors)
    product_map = load_yaml(PRODUCT_MAP_PATH, errors)

    if focus.get("schema_version") != "1.0.0":
        errors.append("Unsupported infrastructure-focus schema_version")
    if manifest.get("schema_version") != "1.0.0":
        errors.append("Unsupported infrastructure manifest schema_version")
    if manifest.get("program_id") != "INFRA-BOOTSTRAP-001":
        errors.append("Infrastructure manifest program_id must be INFRA-BOOTSTRAP-001")

    tasks = manifest.get("tasks")
    if not isinstance(tasks, list) or len(tasks) != 1 or not isinstance(tasks[0], dict):
        errors.append("Infrastructure manifest must contain exactly one task")
        task: dict[str, Any] = {}
    else:
        task = tasks[0]

    expected_task = "TASK-DOCKER-LINUX-001"
    if task.get("task_id") != expected_task:
        errors.append(f"Infrastructure task must be {expected_task}")
    active = focus.get("active")
    if not isinstance(active, bool):
        errors.append("Infrastructure focus active must be a boolean")
    elif active:
        if focus.get("current_focus") != expected_task:
            errors.append("Infrastructure current_focus must match TASK-DOCKER-LINUX-001")
        if focus.get("status") not in ACTIVE_STATUSES:
            errors.append("Infrastructure focus status must be ready/in_progress/in_review")
        if task.get("status") not in ACTIVE_STATUSES:
            errors.append("Infrastructure manifest task status must be ready/in_progress/in_review")
    else:
        focus_status = focus.get("status")
        task_status = task.get("status")
        if focus.get("current_focus") is not None:
            errors.append("Terminal infrastructure current_focus must be null")
        if focus.get("task_id") != expected_task:
            errors.append("Terminal infrastructure focus must preserve task_id")
        if focus_status not in TERMINAL_STATUSES:
            errors.append("Terminal infrastructure focus status must be done/cancelled/superseded")
        if task_status != focus_status:
            errors.append("Terminal infrastructure focus and manifest statuses must match")
        completed_sha = focus.get("completed_sha")
        if focus_status == "done":
            if not isinstance(completed_sha, str) or len(completed_sha) != 40:
                errors.append("Completed infrastructure focus must declare completed_sha")
            if task.get("completed_sha") != completed_sha:
                errors.append("Infrastructure focus and manifest completed_sha must match")
            if task.get("exit_gate_result") != "PASS":
                errors.append("Completed infrastructure task exit_gate_result must be PASS")

    for field in ("issue", "base_branch", "branch"):
        if focus.get(field) != task.get(field):
            errors.append(f"Infrastructure focus and manifest mismatch for {field}")

    if task.get("issue") != "https://github.com/spikeal8-maker/asa-lab/issues/69":
        errors.append("Infrastructure task must reference Issue 69")
    if task.get("base_branch") != "assistant/chess-online-core":
        errors.append("Infrastructure base branch must be assistant/chess-online-core")
    if task.get("branch") != "assistant/docker-linux-bootstrap":
        errors.append("Infrastructure work branch must be assistant/docker-linux-bootstrap")
    if task.get("draft_pr_base") != task.get("base_branch"):
        errors.append("Draft PR base must equal the infrastructure base branch")

    product = product_map.get("project")
    product_focus = product.get("current_focus") if isinstance(product, dict) else None
    frozen = focus.get("product_focus_frozen")
    if active and product_focus != frozen:
        errors.append(
            f"Frozen product focus mismatch: expected project-map {product_focus!r}, got {frozen!r}"
        )
    if task.get("product_focus_frozen") != frozen:
        errors.append("Manifest and focus file disagree about the frozen product task")
    if active is False and focus.get("superseded_by") != product_focus:
        errors.append("Terminal infrastructure superseded_by must match project current_focus")

    ports = manifest.get("ports")
    if not isinstance(ports, dict):
        errors.append("Infrastructure manifest ports must be an object")
    else:
        if ports.get("bind") != "127.0.0.1":
            errors.append("Infrastructure dev binding must be 127.0.0.1")
        for name, expected in ALLOWED_PORTS.items():
            if ports.get(name) != expected:
                errors.append(f"Infrastructure port {name} must be {expected}")
        if set(ports.get("forbidden") or []) != FORBIDDEN_PORTS:
            errors.append("Infrastructure forbidden ports must be 3000, 3100 and 5173")

    required_commands = task.get("required_commands")
    required_artifacts = task.get("required_artifacts")
    exit_gate = task.get("exit_gate")
    if not isinstance(required_commands, list) or len(required_commands) < 20:
        errors.append("Infrastructure task must declare its complete command gate")
    if not isinstance(required_artifacts, list) or len(required_artifacts) < 8:
        errors.append("Infrastructure task must declare required evidence artifacts")
    if not isinstance(exit_gate, list) or len(exit_gate) < 8:
        errors.append("Infrastructure task must declare a non-trivial exit gate")

    if errors:
        print("Infrastructure focus FAIL")
        for error in errors:
            print(f"- {error}")
        return 1

    mode = "active" if active else "terminal"
    print(
        "Infrastructure focus PASS: "
        f"mode={mode}, task={expected_task}, status={task['status']}, "
        f"branch={task['branch']}, product_focus_frozen={frozen}, "
        f"commands={len(required_commands)}, artifacts={len(required_artifacts)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
