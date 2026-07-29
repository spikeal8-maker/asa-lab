#!/usr/bin/env python3
"""Validate canonical cross-references and strict order in the R0 package."""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml"
EXPECTED_ORDER = [f"R{index}" for index in range(11)]
EXPECTED_REFS = {
    "human_plan": "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN_R0.md",
    "detailed_plan": "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.md",
    "target_blueprint": "docs/product/ASA_TARGET_PLATFORM_BLUEPRINT.yaml",
    "owner_decision": "docs/delivery/R0_OWNER_DECISION.yaml",
    "post_merge_transition": "docs/delivery/R0_POST_MERGE_TRANSITION.yaml",
    "release_map_template": "docs/project-map/R0_TARGET_RELEASE_MAP.yaml",
}


def fail(message: str) -> None:
    raise ValueError(message)


def load() -> dict[str, Any]:
    if not PLAN_PATH.is_file():
        fail(f"missing {PLAN_PATH.relative_to(ROOT)}")
    document = yaml.safe_load(PLAN_PATH.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        fail("target execution plan must be a YAML object")
    return document


def main() -> int:
    try:
        plan = load()
        for field, expected in EXPECTED_REFS.items():
            actual = plan.get(field)
            if actual != expected:
                fail(f"{field} must be {expected}, got {actual!r}")
            path = ROOT / expected
            if not path.is_file():
                fail(f"{field} target does not exist: {expected}")

        if plan.get("execution_order") != EXPECTED_ORDER:
            fail(
                f"execution_order must be strict {EXPECTED_ORDER}, "
                f"got {plan.get('execution_order')!r}"
            )
        if plan.get("release_selection") != "strict_list_order":
            fail("release_selection must be strict_list_order")
        rules = set(plan.get("execution_rules") or [])
        if "strict_release_order_even_when_later_dependencies_are_satisfied" not in rules:
            fail("execution rules must forbid skipping ahead to a dependency-ready later release")

        releases = plan.get("releases")
        if not isinstance(releases, list):
            fail("releases must be a list")
        release_ids = [release.get("id") for release in releases if isinstance(release, dict)]
        if release_ids != EXPECTED_ORDER:
            fail(f"releases array must follow execution_order, got {release_ids}")
        if plan.get("current_gate") not in EXPECTED_ORDER:
            fail("current_gate must reference a release in execution_order")
        current_index = EXPECTED_ORDER.index(plan["current_gate"])
        statuses = {
            release.get("id"): release.get("status")
            for release in releases
            if isinstance(release, dict)
        }
        for index, release_id in enumerate(EXPECTED_ORDER):
            if index < current_index and statuses.get(release_id) != "done":
                fail(f"release before current_gate must be done: {release_id}")
            if index == current_index and statuses.get(release_id) not in {
                "ready",
                "in_progress",
                "in_review",
            }:
                fail(f"current release {release_id} has invalid status {statuses.get(release_id)!r}")
            if index > current_index and statuses.get(release_id) != "blocked":
                fail(f"later release must remain blocked: {release_id}")

        human = (ROOT / EXPECTED_REFS["human_plan"]).read_text(encoding="utf-8")
        for marker in (
            "owner_review_required",
            "Current gate:** `R0`",
            "Product coding до активации:** запрещён",
            "Release R10",
            "строгий delivery order",
        ):
            if marker not in human:
                fail(f"canonical human plan misses marker: {marker}")

        detailed = (ROOT / EXPECTED_REFS["detailed_plan"]).read_text(encoding="utf-8")
        for marker in (
            "## 2. Конвергенция текущих веток",
            "## 17. Definition of Done",
        ):
            if marker not in detailed:
                fail(f"detailed execution plan misses marker: {marker}")

        if EXPECTED_REFS["human_plan"] == EXPECTED_REFS["detailed_plan"]:
            fail("canonical human plan and detailed design plan must remain distinct")

    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"ASA R0 contract references FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA R0 contract references PASS")
    print(f"- references: {len(EXPECTED_REFS)}")
    print("- execution order: R0 -> R10 (strict)")
    print("- canonical human plan: owner-gated R0 contract")
    print("- detailed plan: non-canonical design/workstream reference")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
