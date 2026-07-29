#!/usr/bin/env python3
"""Validate the exact R0 branch-convergence action sequence."""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml"
FOUNDATION_PATH = ROOT / "docs/delivery/R0_FOUNDATION_DECISION.yaml"
POST_MERGE_PATH = ROOT / "docs/delivery/R0_POST_MERGE_TRANSITION.yaml"
EXPECTED_ACTIONS = [
    "owner_review_pr_34_foundation_scope",
    "resolve_pr_34_foundation_correctives",
    "owner_record_pr_34_foundation_decision",
    "merge_pr_34_if_accepted_else_revise_r0_contract",
    "owner_review_target_contract_decisions",
    "rebase_and_merge_pr_43_after_pr_34_accepted_merge",
    "execute_r0a_contract_activation",
    "create_one_p1_integration_pr",
    "close_pr_35_45_47_after_transfer_proof",
    "select_exactly_one_of_pr_59_or_pr_60",
    "rebase_selected_r1_once_on_accepted_baseline",
    "execute_r0d_completion_transition",
]


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
        plan = load(PLAN_PATH)
        foundation = load(FOUNDATION_PATH)
        post_merge = load(POST_MERGE_PATH)

        convergence = plan.get("r0_convergence")
        if not isinstance(convergence, dict):
            fail("target execution plan misses r0_convergence")
        actions = convergence.get("ordered_actions")
        if actions != EXPECTED_ACTIONS:
            fail(f"R0 ordered_actions must be exactly {EXPECTED_ACTIONS}, got {actions!r}")
        if len(set(actions)) != len(actions):
            fail("R0 ordered_actions contain duplicates")

        position = {action: index for index, action in enumerate(actions)}
        required_before = (
            ("owner_review_pr_34_foundation_scope", "owner_review_target_contract_decisions"),
            ("resolve_pr_34_foundation_correctives", "owner_record_pr_34_foundation_decision"),
            ("owner_record_pr_34_foundation_decision", "rebase_and_merge_pr_43_after_pr_34_accepted_merge"),
            ("owner_review_target_contract_decisions", "rebase_and_merge_pr_43_after_pr_34_accepted_merge"),
            ("rebase_and_merge_pr_43_after_pr_34_accepted_merge", "execute_r0a_contract_activation"),
            ("execute_r0a_contract_activation", "create_one_p1_integration_pr"),
            ("create_one_p1_integration_pr", "close_pr_35_45_47_after_transfer_proof"),
            ("close_pr_35_45_47_after_transfer_proof", "select_exactly_one_of_pr_59_or_pr_60"),
            ("select_exactly_one_of_pr_59_or_pr_60", "rebase_selected_r1_once_on_accepted_baseline"),
            ("rebase_selected_r1_once_on_accepted_baseline", "execute_r0d_completion_transition"),
        )
        for earlier, later in required_before:
            if position[earlier] >= position[later]:
                fail(f"R0 action {earlier} must precede {later}")

        if foundation.get("status") == "rejected_close_candidate":
            fail("PR34 rejection requires a revised R0 source/integration contract before proceeding")
        if "pr_43_rebase_waits_for_accepted_merged_foundation" not in set(
            foundation.get("activation_rules") or []
        ):
            fail("foundation decision must require accepted_merged before final PR43 rebase")

        phase_ids = [
            phase.get("id")
            for phase in post_merge.get("phases") or []
            if isinstance(phase, dict)
        ]
        if phase_ids != [
            "R0A_CONTRACT_ACTIVATION",
            "R0B_FOUNDATION_INTEGRATION",
            "R0C_R1_SELECTION",
            "R0D_COMPLETION_TRANSITION",
        ]:
            fail("post-merge phases do not match the convergence action sequence")

    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"ASA R0 convergence action sequence FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA R0 convergence action sequence PASS")
    print(f"- ordered actions: {len(EXPECTED_ACTIONS)}")
    print("- PR34 accepted merge before final PR43 rebase: enforced")
    print("- R0A -> R0B -> R0C -> R0D: enforced")
    print("- R1 ready before R0D: forbidden")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
