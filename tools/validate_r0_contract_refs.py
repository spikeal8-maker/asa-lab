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
    "visual_system": "docs/product/ASA_VISUAL_PRODUCT_SYSTEM.md",
    "functional_parity_scope": "docs/product/ASA_TINKERCAD_100_PERCENT_SCOPE.yaml",
    "complete_interface_blueprint": "docs/product/ASA_COMPLETE_INTERFACE_BLUEPRINT.md",
    "surface_catalog": "docs/product/ASA_PRODUCT_SURFACE_CATALOG.yaml",
    "interface_catalog_viewer": "docs/product/interface-catalog.html",
    "electronics_spec": "docs/product/ASA_ELECTRONICS_WORKBENCH_COMPLETE_SPEC.md",
    "electronics_tool_catalog": "docs/product/ASA_ELECTRONICS_TOOL_CATALOG.yaml",
    "student_experience_spec": "docs/product/ASA_STUDENT_EXPERIENCE_SPEC.md",
    "admin_console_spec": "docs/product/ASA_ADMIN_CONSOLE_SPEC.md",
    "owner_decision": "docs/delivery/R0_OWNER_DECISION.yaml",
    "foundation_decision": "docs/delivery/R0_FOUNDATION_DECISION.yaml",
    "r1_candidate_decision": "docs/delivery/R0_R1_CANDIDATE_DECISION.yaml",
    "post_merge_transition": "docs/delivery/R0_POST_MERGE_TRANSITION.yaml",
    "baseline_preservation": "docs/delivery/R0_BASELINE_PRESERVATION_CONTRACT.yaml",
    "release_map_template": "docs/project-map/R0_TARGET_RELEASE_MAP.yaml",
    "target_test_matrix": "docs/testing/ASA_TARGET_TEST_MATRIX.yaml",
    "r1_migration_contract": "docs/architecture/R1_ACCOUNT_WORKSPACE_MIGRATION_CONTRACT.yaml",
}
EXPECTED_OWNER_DECISIONS = {
    "account_principal_workspace_are_distinct",
    "tenant_and_rls_remain_security_boundary",
    "personal_project_does_not_require_classroom",
    "account_and_studentseat_sessions_are_distinct",
    "r0_r10_release_order_and_additive_migration_policy",
    "complete_interface_catalog_and_functional_parity_scope",
}


def fail(message: str) -> None:
    raise ValueError(message)


def load_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        fail(f"missing {path.relative_to(ROOT)}")
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        fail(f"{path.relative_to(ROOT)} must contain a YAML object")
    return document


def main() -> int:
    try:
        plan = load_yaml(PLAN_PATH)
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
        if plan.get("functional_parity_claim") != "not_100_percent":
            fail("functional_parity_claim must remain not_100_percent during R0")
        rules = set(plan.get("execution_rules") or [])
        for rule in (
            "strict_release_order_even_when_later_dependencies_are_satisfied",
            "every_product_task_references_surface_and_capability_ids",
            "absent_partial_in_review_or_evidence_required_never_count_as_parity_pass",
            "literal_source_brand_asset_or_pixel_copy_is_forbidden",
        ):
            if rule not in rules:
                fail(f"execution rules miss {rule}")

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
            "→ next release only ready",
            "Новые product branches до шага 10 запрещены",
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

        owner = load_yaml(ROOT / EXPECTED_REFS["owner_decision"])
        foundation = load_yaml(ROOT / EXPECTED_REFS["foundation_decision"])
        candidate = load_yaml(ROOT / EXPECTED_REFS["r1_candidate_decision"])
        scope = load_yaml(ROOT / EXPECTED_REFS["functional_parity_scope"])
        surfaces = load_yaml(ROOT / EXPECTED_REFS["surface_catalog"])
        electronics = load_yaml(ROOT / EXPECTED_REFS["electronics_tool_catalog"])
        if owner.get("activation_pull_request") != 43:
            fail("owner decision must activate PR 43")
        if {
            entry.get("id")
            for entry in owner.get("decisions") or []
            if isinstance(entry, dict)
        } != EXPECTED_OWNER_DECISIONS:
            fail("owner decision file must contain six target decisions")
        if foundation.get("foundation_pull_request") != 34:
            fail("foundation decision must govern PR 34")
        if candidate.get("selection_phase") != "R0C_R1_SELECTION":
            fail("R1 candidate decision must be deferred to R0C")
        if scope.get("completion_rule", {}).get("current_claim") != "not_100_percent":
            fail("functional parity scope contains a false completion claim")
        if surfaces.get("catalog_id") != "asa-complete-product-surfaces":
            fail("surface catalog identity mismatch")
        if electronics.get("catalog_id") != "asa-electronics-complete-tool-catalog":
            fail("Electronics tool catalog identity mismatch")

    except (OSError, ValueError, yaml.YAMLError, AttributeError) as error:
        print(f"ASA R0 contract references FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA R0 contract references PASS")
    print(f"- references: {len(EXPECTED_REFS)}")
    print("- execution order: R0 -> R10 (strict)")
    print("- PR34/PR43/R1 decisions: explicitly separated")
    print("- complete interfaces/admin/student/Electronics references: valid")
    print("- functional parity claim: not_100_percent")
    print("- canonical human plan: owner-gated R0 contract")
    print("- detailed plan: non-canonical design/workstream reference")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
