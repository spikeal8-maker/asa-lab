#!/usr/bin/env python3
"""Validate canonical cross-references in the R0 target execution package."""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml"
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

        human = (ROOT / EXPECTED_REFS["human_plan"]).read_text(encoding="utf-8")
        for marker in (
            "owner_review_required",
            "Current gate:** `R0`",
            "Product coding до активации:** запрещён",
            "Release R10",
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
    print("- canonical human plan: owner-gated R0 contract")
    print("- detailed plan: non-canonical design/workstream reference")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
