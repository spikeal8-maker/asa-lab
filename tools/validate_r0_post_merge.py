#!/usr/bin/env python3
"""Validate the deterministic post-merge R0 convergence sequence."""

from __future__ import annotations

from collections import Counter, deque
from pathlib import Path
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / "docs/delivery/R0_POST_MERGE_TRANSITION.yaml"
EXPECTED_PHASES = [
    "R0A_CONTRACT_ACTIVATION",
    "R0B_FOUNDATION_INTEGRATION",
    "R0C_R1_SELECTION",
    "R0D_COMPLETION_TRANSITION",
]
GOVERNANCE_PHASES = {"R0A_CONTRACT_ACTIVATION", "R0D_COMPLETION_TRANSITION"}
FORBIDDEN_PRODUCT_PATHS = {
    "apps/",
    "packages/",
    "contexts/",
    "modules/",
    "migrations/",
    "schemas/",
    "crates/",
    "infra/",
}


def fail(message: str) -> None:
    raise ValueError(message)


def load() -> dict[str, Any]:
    if not PLAN_PATH.is_file():
        fail(f"missing {PLAN_PATH.relative_to(ROOT)}")
    document = yaml.safe_load(PLAN_PATH.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        fail("post-merge transition plan must be an object")
    return document


def as_strings(value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        fail(f"{label} must be a string list")
    return value


def main() -> int:
    try:
        document = load()
        if document.get("schema_version") != "1.0.0":
            fail("schema_version must be 1.0.0")
        if document.get("transition_id") != "asa-r0-post-merge":
            fail("unexpected transition_id")
        if document.get("status") != "planned":
            fail("post-merge transition must remain planned before PR 43 merge")
        if document.get("source_contract_pr") != 43:
            fail("source_contract_pr must be 43")
        if document.get("program_issue") != "https://github.com/spikeal8-maker/asa-lab/issues/36":
            fail("program_issue must reference Issue 36")

        invariants = set(as_strings(document.get("invariants"), "invariants"))
        required_invariants = {
            "r1_remains_blocked_after_contract_merge",
            "no_product_feature_in_governance_transitions",
            "one_p1_integration_pr_only",
            "transfer_only_prs_close_after_verified_transfer",
            "exactly_one_r1_candidate_selected",
            "next_release_starts_only_after_r0_completion_transition",
        }
        if invariants != required_invariants:
            fail("post-merge invariants are incomplete or contain unapproved additions")

        raw_phases = document.get("phases")
        if not isinstance(raw_phases, list):
            fail("phases must be a list")
        phases = [phase for phase in raw_phases if isinstance(phase, dict)]
        if len(phases) != len(raw_phases):
            fail("every phase must be an object")
        phase_ids = [phase.get("id") for phase in phases]
        if phase_ids != EXPECTED_PHASES:
            fail(f"phase order must be {EXPECTED_PHASES}, got {phase_ids}")

        branches: list[str] = []
        known = set(EXPECTED_PHASES)
        dependencies: dict[str, set[str]] = {}
        reverse = {phase_id: set() for phase_id in EXPECTED_PHASES}

        for phase in phases:
            phase_id = phase["id"]
            branch = phase.get("canonical_branch")
            if not isinstance(branch, str) or not branch.strip():
                fail(f"{phase_id} must define canonical_branch")
            branches.append(branch)
            if phase.get("stop") is not True:
                fail(f"{phase_id} must stop after its exit gate")
            as_strings(phase.get("actions"), f"{phase_id}.actions")
            as_strings(phase.get("exit_gate"), f"{phase_id}.exit_gate")

            raw_dependencies = as_strings(phase.get("depends_on"), f"{phase_id}.depends_on")
            phase_dependencies = {item for item in raw_dependencies if item in known}
            dependencies[phase_id] = phase_dependencies
            for dependency in phase_dependencies:
                reverse[dependency].add(phase_id)

            if phase_id in GOVERNANCE_PHASES:
                if phase.get("type") != "governance_only":
                    fail(f"{phase_id} must be governance_only")
                forbidden_paths = set(
                    as_strings(phase.get("forbidden_paths"), f"{phase_id}.forbidden_paths")
                )
                if forbidden_paths != FORBIDDEN_PRODUCT_PATHS:
                    fail(f"{phase_id} must forbid all product/runtime path prefixes")
            elif "forbidden_paths" in phase:
                fail(f"{phase_id} must not masquerade as a governance-only phase")

        duplicate_branches = [
            branch for branch, count in Counter(branches).items() if count > 1
        ]
        if duplicate_branches:
            fail(f"post-merge canonical branches must be unique: {duplicate_branches}")

        indegree = {phase_id: len(dependencies[phase_id]) for phase_id in EXPECTED_PHASES}
        queue = deque(phase_id for phase_id in EXPECTED_PHASES if indegree[phase_id] == 0)
        visited: list[str] = []
        while queue:
            current = queue.popleft()
            visited.append(current)
            for dependent in reverse[current]:
                indegree[dependent] -= 1
                if indegree[dependent] == 0:
                    queue.append(dependent)
        if len(visited) != len(EXPECTED_PHASES):
            fail("post-merge transition graph contains a cycle")

        activation = phases[0]
        if "keep_r1_r10_blocked" not in activation["actions"]:
            fail("R0A must keep all future releases blocked")
        if "set_current_focus_r0_convergence" not in activation["actions"]:
            fail("R0A must keep current focus on R0 convergence")

        integration = phases[1]
        if integration.get("type") != "controlled_product_convergence":
            fail("R0B must be controlled_product_convergence")
        if integration.get("source_branch") != "agent/parity-p1-visual-integration":
            fail("R0B must use the verified parity P1 integration source")
        integration_actions = set(integration["actions"])
        for required in (
            "create_one_owner_facing_integration_pr",
            "close_pr_35_45_47_after_verified_transfer",
            "preserve_teacher_classroom_project_and_electronics_data",
        ):
            if required not in integration_actions:
                fail(f"R0B misses required action: {required}")

        selection = phases[2]
        selection_actions = set(selection["actions"])
        for required in (
            "owner_selects_exactly_one_of_pr_59_or_pr_60",
            "close_unselected_candidate_superseded",
            "rebase_selected_candidate_once_on_accepted_baseline",
        ):
            if required not in selection_actions:
                fail(f"R0C misses required action: {required}")

        completion = phases[3]
        completion_actions = set(completion["actions"])
        for required in (
            "mark_r0_done",
            "mark_r1_ready",
            "set_current_gate_r1",
            "keep_r2_r10_blocked",
        ):
            if required not in completion_actions:
                fail(f"R0D misses required action: {required}")

        early_actions = {
            action
            for phase in phases[:-1]
            for action in as_strings(phase.get("actions"), f"{phase['id']}.actions")
        }
        forbidden_early = {"mark_r1_ready", "set_current_gate_r1", "set_current_focus_r1"}
        leaked = sorted(early_actions & forbidden_early)
        if leaked:
            fail(f"R1 activation leaked before R0D completion: {leaked}")

    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"ASA R0 post-merge plan FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA R0 post-merge plan PASS")
    print(f"- phases: {len(EXPECTED_PHASES)}")
    print("- R1 activation before R0D: forbidden")
    print("- integration PR count: one")
    print("- identity candidates selected: exactly one")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
