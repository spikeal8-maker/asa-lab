#!/usr/bin/env python3
"""Validate active task references against canonical document revisions."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = "docs/agent/document-registry.yaml"
CURRENT = "docs/execution/current.yaml"


def _load(root: Path, relative: str) -> Any:
    return yaml.safe_load((root / relative).read_text(encoding="utf-8"))


def _lanes(current: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    result: list[tuple[str, dict[str, Any]]] = []
    primary = current.get("primary_lane") or {}
    task = current.get("task") or {}
    if isinstance(primary, dict) and isinstance(task, dict):
        result.append((str(primary.get("id") or ""), task))
    for lane in current.get("parallel_lanes") or []:
        if isinstance(lane, dict) and isinstance(lane.get("task"), dict):
            result.append((str(lane.get("id") or ""), lane["task"]))
    return result


def validate(root: Path) -> list[str]:
    errors: list[str] = []
    try:
        registry = _load(root, REGISTRY)
        current = _load(root, CURRENT)
    except Exception as exc:  # noqa: BLE001
        return [f"cannot load task document references: {exc}"]
    if not isinstance(registry, dict) or not isinstance(current, dict):
        return ["registry and current.yaml must be mappings"]
    documents = {
        str(item.get("id")): item
        for item in registry.get("documents") or []
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    strict = registry.get("strict_task_scopes") or []
    if not isinstance(strict, list):
        return ["strict_task_scopes must be an array"]

    lanes = dict(_lanes(current))
    for scope in strict:
        if scope not in lanes:
            errors.append(f"strict task scope {scope!r} is not declared in current.yaml")

    for lane_id, task in _lanes(current):
        refs = task.get("normative_refs")
        if lane_id in strict and (not isinstance(refs, list) or not refs):
            errors.append(f"lane {lane_id} must declare normative_refs")
            continue
        if refs is None:
            continue
        if not isinstance(refs, list):
            errors.append(f"lane {lane_id}.normative_refs must be an array")
            continue
        seen: set[str] = set()
        for index, raw in enumerate(refs):
            label = f"lane {lane_id}.normative_refs[{index}]"
            if not isinstance(raw, dict):
                errors.append(f"{label} must be a mapping")
                continue
            document_id = raw.get("document")
            if not isinstance(document_id, str) or not document_id:
                errors.append(f"{label}.document must be non-empty")
                continue
            if document_id in seen:
                errors.append(f"lane {lane_id} repeats normative document {document_id}")
                continue
            seen.add(document_id)
            document = documents.get(document_id)
            if document is None:
                errors.append(f"{label} references unknown document {document_id}")
                continue
            if document.get("status") != "canonical":
                errors.append(f"{label} must reference canonical document {document_id}")
            lanes_allowed = document.get("lanes") or []
            if "*" not in lanes_allowed and lane_id not in lanes_allowed:
                errors.append(f"{label} document {document_id} is not routed to lane {lane_id}")
            expected_revision = document.get("revision")
            actual_revision = raw.get("revision")
            if expected_revision is not None and str(actual_revision) != str(expected_revision):
                errors.append(
                    f"{label} revision drift: task={actual_revision!r}, "
                    f"canonical={expected_revision!r} ({document_id})"
                )
    return errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", help=argparse.SUPPRESS)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve() if args.root else ROOT
    errors = validate(root)
    if errors:
        print("task document refs: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("task document refs: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
