#!/usr/bin/env python3
"""Validate the inactive R0-R10 release-map template against target contracts."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_PATH = ROOT / "docs/project-map/R0_TARGET_RELEASE_MAP.yaml"
EXECUTION_PATH = ROOT / "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml"
BLUEPRINT_PATH = ROOT / "docs/product/ASA_TARGET_PLATFORM_BLUEPRINT.yaml"
ACTIVE_MAP_PATH = ROOT / "docs/project-map/project-map.yaml"
EXPECTED_RELEASES = [f"R{index}" for index in range(11)]
EXPECTED_LEGACY = {
    "TASK-PRODUCT-DOC-001": ("done", "R0"),
    "TASK-PORTAL-001": ("done", "R0"),
    "TASK-PROJECT-SHELL-001": ("superseded", "R3"),
    "TASK-CHECKERS-LITE-001": ("superseded", "R10"),
    "TASK-ELECTRONICS-ALPHA-001": ("superseded", "R4"),
    "TASK-SEAT-001": ("superseded", "R5"),
    "TASK-ACT-001": ("superseded", "R9"),
    "TASK-REVIEW-001": ("superseded", "R9"),
    "TASK-ELEC-001": ("superseded", "R9"),
}
EXPECTED_ACTIVATION_RULES = {
    "do_not_replace_active_project_map_before_pr_43_merge",
    "r0a_sets_current_focus_to_r0",
    "r1_remains_blocked_after_r0a",
    "r0d_is_the_only_transition_that_marks_r1_ready",
    "strict_next_release_beats_dependency_ready_candidates",
    "preserve_existing_architecture_and_code_nodes",
    "update_owner_viewer_dynamically_after_activation",
}


def fail(message: str) -> None:
    raise ValueError(message)


def load(path: Path) -> dict[str, Any]:
    if not path.is_file():
        fail(f"missing {path.relative_to(ROOT)}")
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        fail(f"{path.relative_to(ROOT)} must contain a YAML object")
    return document


def main() -> int:
    try:
        template = load(TEMPLATE_PATH)
        execution = load(EXECUTION_PATH)
        blueprint = load(BLUEPRINT_PATH)
        active_map = load(ACTIVE_MAP_PATH)

        if template.get("schema_version") != "1.0.0":
            fail("template schema_version must be 1.0.0")
        if template.get("template_id") != "asa-target-release-map-r0-r10":
            fail("unexpected release-map template_id")
        if template.get("status") != "inactive_until_pr_43_merge":
            fail("release-map template must remain inactive before PR 43 merge")
        if template.get("activation_transition") != "R0A_CONTRACT_ACTIVATION":
            fail("activation_transition must be R0A_CONTRACT_ACTIVATION")
        if template.get("current_gate") != "R0":
            fail("template current_gate must be R0")
        if template.get("execution_order") != EXPECTED_RELEASES:
            fail("template execution_order must be strict R0-R10")
        if template.get("release_selection") != "strict_list_order":
            fail("template release_selection must be strict_list_order")

        raw_nodes = template.get("release_nodes")
        if not isinstance(raw_nodes, list):
            fail("release_nodes must be a list")
        nodes = [node for node in raw_nodes if isinstance(node, dict)]
        if len(nodes) != len(raw_nodes):
            fail("every release node must be an object")
        node_ids = [node.get("id") for node in nodes]
        if node_ids != EXPECTED_RELEASES:
            fail(f"release node order must be {EXPECTED_RELEASES}, got {node_ids}")

        execution_releases = {
            release.get("id"): release
            for release in execution.get("releases") or []
            if isinstance(release, dict)
        }
        blueprint_releases = {
            release.get("id"): release
            for release in blueprint.get("releases") or []
            if isinstance(release, dict)
        }

        reverse: dict[str, set[str]] = defaultdict(set)
        for node in nodes:
            release_id = node["id"]
            execution_release = execution_releases.get(release_id)
            blueprint_release = blueprint_releases.get(release_id)
            if execution_release is None or blueprint_release is None:
                fail(f"{release_id} missing from execution plan or blueprint")

            for field in ("issue", "canonical_branch"):
                if node.get(field) != execution_release.get(field):
                    fail(f"{release_id}.{field} differs from execution plan")
            dependencies = set(node.get("depends_on") or [])
            if dependencies != set(execution_release.get("depends_on") or []):
                fail(f"{release_id}.depends_on differs from execution plan")
            if dependencies != set(blueprint_release.get("depends_on") or []):
                fail(f"{release_id}.depends_on differs from blueprint")
            for dependency in dependencies:
                reverse[dependency].add(release_id)

            expected_status = "in_progress" if release_id == "R0" else "blocked"
            if node.get("status") != expected_status:
                fail(f"{release_id}.status must be {expected_status}")

        for index, node in enumerate(nodes):
            release_id = node["id"]
            expected_next = EXPECTED_RELEASES[index + 1] if index + 1 < len(nodes) else None
            if node.get("next_release") != expected_next:
                fail(
                    f"{release_id}.next_release must be {expected_next!r}, "
                    f"got {node.get('next_release')!r}"
                )
            unlocks = set(node.get("unlocks_when_done") or [])
            if unlocks != reverse.get(release_id, set()):
                fail(
                    f"{release_id}.unlocks_when_done must equal direct reverse dependencies "
                    f"{sorted(reverse.get(release_id, set()))}, got {sorted(unlocks)}"
                )
            if expected_next is not None and node.get("next_release") not in EXPECTED_RELEASES:
                fail(f"{release_id}.next_release is not a known release")

        raw_legacy = template.get("legacy_traceability")
        if not isinstance(raw_legacy, list):
            fail("legacy_traceability must be a list")
        legacy = {
            item.get("id"): item
            for item in raw_legacy
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        }
        if set(legacy) != set(EXPECTED_LEGACY):
            fail("legacy traceability IDs do not match the v1 delivery tasks")
        for task_id, (expected_status, expected_replacement) in EXPECTED_LEGACY.items():
            if legacy[task_id].get("target_status") != expected_status:
                fail(f"{task_id}.target_status must be {expected_status}")
            if legacy[task_id].get("replacement") != expected_replacement:
                fail(f"{task_id}.replacement must be {expected_replacement}")
            if expected_replacement not in EXPECTED_RELEASES:
                fail(f"{task_id} names unknown replacement {expected_replacement}")

        rules = set(template.get("activation_rules") or [])
        if rules != EXPECTED_ACTIVATION_RULES:
            fail("release-map activation_rules are incomplete or contain additions")

        active_nodes = active_map.get("nodes")
        if not isinstance(active_nodes, list):
            fail("active project map nodes must be a list")
        active_ids = {
            node.get("id")
            for node in active_nodes
            if isinstance(node, dict) and isinstance(node.get("id"), str)
        }
        leaked = sorted(set(EXPECTED_RELEASES) & active_ids)
        if leaked:
            fail(f"inactive R0 release nodes leaked into active project map: {leaked}")
        if active_map.get("project", {}).get("current_focus") == "R1":
            fail("active project map must not jump to R1 before R0 completion")

    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"ASA R0 release-map template FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA R0 release-map template PASS")
    print(f"- releases: {len(EXPECTED_RELEASES)}")
    print("- active release nodes before PR 43 merge: 0")
    print("- current template gate: R0")
    print("- strict next release: R1")
    print("- dependency unlocks do not override execution order")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
