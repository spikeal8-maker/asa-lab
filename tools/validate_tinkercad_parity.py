#!/usr/bin/env python3
"""Validate ASA Lab's Tinkercad parity product contract.

This validator is intentionally product-facing: coding agents must not silently
remove capabilities, reference unknown dependencies, or introduce undocumented
deviations.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
MATRIX_PATH = ROOT / "docs/product/TINKERCAD_PARITY_MATRIX.yaml"
SPEC_PATH = ROOT / "docs/product/TINKERCAD_PARITY_SPEC.md"
PROGRAM_PATH = ROOT / "docs/delivery/TINKERCAD_PARITY_PROGRAM.md"
DEVIATIONS_PATH = ROOT / "docs/product/TINKERCAD_PARITY_DEVIATIONS.yaml"


def fail(message: str) -> None:
    raise ValueError(message)


def load_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        fail(f"missing required file: {path.relative_to(ROOT)}")
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        fail(f"{path.relative_to(ROOT)} must contain a YAML object")
    return data


def require_text(path: Path, markers: list[str]) -> None:
    if not path.is_file():
        fail(f"missing required file: {path.relative_to(ROOT)}")
    text = path.read_text(encoding="utf-8")
    for marker in markers:
        if marker not in text:
            fail(f"{path.relative_to(ROOT)} misses required marker: {marker}")


def validate_matrix(matrix: dict[str, Any]) -> tuple[int, int, int]:
    statuses = matrix.get("status_definitions")
    if not isinstance(statuses, dict) or not statuses:
        fail("matrix.status_definitions must be a non-empty object")

    capabilities = matrix.get("capabilities")
    if not isinstance(capabilities, list) or not capabilities:
        fail("matrix.capabilities must be a non-empty list")

    capability_ids = [item.get("id") for item in capabilities if isinstance(item, dict)]
    if len(capability_ids) != len(capabilities) or any(not isinstance(item, str) for item in capability_ids):
        fail("every capability must have a string id")
    duplicates = [item for item, count in Counter(capability_ids).items() if count > 1]
    if duplicates:
        fail(f"duplicate capability ids: {duplicates}")
    known_capabilities = set(capability_ids)

    releases = matrix.get("releases")
    if not isinstance(releases, list) or not releases:
        fail("matrix.releases must be a non-empty list")
    release_ids = [item.get("id") for item in releases if isinstance(item, dict)]
    if len(release_ids) != len(releases) or any(not isinstance(item, str) for item in release_ids):
        fail("every release must have a string id")
    if len(set(release_ids)) != len(release_ids):
        fail("release ids must be unique")
    known_releases = set(release_ids)

    required_capabilities = {
        "PARITY-PROJECT-HUB",
        "PARITY-MODULE-CHOOSER",
        "PARITY-EDITOR-SHELL",
        "PARITY-VISIBILITY",
        "PARITY-SHARE-LINK",
        "PARITY-PUBLISH",
        "PARITY-PUBLIC-PAGE",
        "PARITY-REMIX",
        "PARITY-PROFILE",
        "PARITY-EXPLORE",
        "PARITY-PUBLIC-COMMENTS",
        "PARITY-CLASSROOM",
        "PARITY-STUDENT-SEAT",
        "PARITY-STUDENT-WORK",
        "PARITY-SAFE-MODE",
        "PARITY-ASSIGNMENT",
        "PARITY-SUBMISSION",
        "PARITY-EDU-COMMENTS",
        "PARITY-REVIEW",
        "PARITY-GRADE",
        "PARITY-BADGE",
        "PARITY-MODULE-CONTRACT",
    }
    missing_required = sorted(required_capabilities - known_capabilities)
    if missing_required:
        fail(f"matrix misses mandatory parity capabilities: {missing_required}")

    for capability in capabilities:
        if not isinstance(capability, dict):
            fail("capability entries must be objects")
        capability_id = capability["id"]
        if capability.get("status") not in statuses:
            fail(f"{capability_id}: unknown status {capability.get('status')!r}")
        if capability.get("target_release") not in known_releases:
            fail(f"{capability_id}: unknown target_release {capability.get('target_release')!r}")
        dependencies = capability.get("depends_on")
        if not isinstance(dependencies, list):
            fail(f"{capability_id}: depends_on must be a list")
        unknown = sorted(set(dependencies) - known_capabilities)
        if unknown:
            fail(f"{capability_id}: unknown dependencies {unknown}")
        if capability_id in dependencies:
            fail(f"{capability_id}: self-dependency is forbidden")
        for required_key in ("name", "gap", "gate", "current_evidence"):
            if required_key not in capability:
                fail(f"{capability_id}: missing {required_key}")

    surfaces = matrix.get("surfaces")
    if not isinstance(surfaces, list) or not surfaces:
        fail("matrix.surfaces must be a non-empty list")
    surface_ids: list[str] = []
    for surface in surfaces:
        if not isinstance(surface, dict) or not isinstance(surface.get("id"), str):
            fail("every surface must be an object with a string id")
        surface_ids.append(surface["id"])
        referenced = surface.get("capabilities")
        if not isinstance(referenced, list):
            fail(f"{surface['id']}: capabilities must be a list")
        unknown = sorted(set(referenced) - known_capabilities)
        if unknown:
            fail(f"{surface['id']}: unknown capabilities {unknown}")
    if len(set(surface_ids)) != len(surface_ids):
        fail("surface ids must be unique")

    for release in releases:
        referenced = release.get("capabilities")
        if not isinstance(referenced, list):
            fail(f"{release['id']}: capabilities must be a list")
        unknown = sorted(set(referenced) - known_capabilities)
        if unknown:
            fail(f"{release['id']}: unknown capabilities {unknown}")
        if not isinstance(release.get("gate"), str) or not release["gate"].strip():
            fail(f"{release['id']}: non-empty gate is required")

    return len(capabilities), len(surfaces), len(releases)


def validate_deviations(data: dict[str, Any]) -> tuple[int, int]:
    allowed_reasons = data.get("allowed_reasons")
    decisions = data.get("decisions")
    pending = data.get("pending")
    if not isinstance(allowed_reasons, list) or not all(isinstance(item, str) for item in allowed_reasons):
        fail("deviation register allowed_reasons must be a string list")
    if not isinstance(decisions, list) or not isinstance(pending, list):
        fail("deviation register decisions and pending must be lists")

    all_items = [*decisions, *pending]
    ids: list[str] = []
    for item in all_items:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            fail("every deviation must have a string id")
        ids.append(item["id"])
        if item.get("reason") not in allowed_reasons:
            fail(f"{item['id']}: reason {item.get('reason')!r} is not allowed")
        for key in ("surface", "reference_behavior", "asa_behavior", "owner_decision", "target_release", "test"):
            if not isinstance(item.get(key), str) or not item[key].strip():
                fail(f"{item['id']}: non-empty {key} is required")
    if len(set(ids)) != len(ids):
        fail("deviation ids must be unique")
    return len(decisions), len(pending)


def main() -> int:
    try:
        require_text(
            SPEC_PATH,
            [
                "## 6. Видимость, ссылки и публикация",
                "## 7. Публичная страница проекта",
                "## 9. Галерея / Explore",
                "## 11. Classroom parity",
                "## 12. Задания и стартовые проекты",
                "## 14. Module Platform parity",
                "## 22. Parity Deviation Register",
            ],
        )
        require_text(
            PROGRAM_PATH,
            [
                "TASK-PARITY-100",
                "TASK-PARITY-200",
                "TASK-PARITY-300",
                "TASK-PARITY-400",
                "TASK-PARITY-500",
                "TASK-PARITY-600",
            ],
        )
        capability_count, surface_count, release_count = validate_matrix(load_yaml(MATRIX_PATH))
        decision_count, pending_count = validate_deviations(load_yaml(DEVIATIONS_PATH))
    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"Tinkercad parity contract FAIL: {error}", file=sys.stderr)
        return 1

    print(
        "Tinkercad parity contract PASS "
        f"(capabilities={capability_count}, surfaces={surface_count}, releases={release_count}, "
        f"acceptedDeviations={decision_count}, pendingDeviations={pending_count})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
