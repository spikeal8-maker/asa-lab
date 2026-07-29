#!/usr/bin/env python3
"""Validate the owner-gated ASA Lab target-platform execution contract.

The existing parity validator proves product invariants. This validator proves
that coding agents have one deterministic release order, one Issue per release,
one explicit R0 branch-convergence procedure and unambiguous owner/agent entry
points before product work resumes.
"""

from __future__ import annotations

from collections import Counter, deque
from pathlib import Path
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml"
HUMAN_PLAN_PATH = ROOT / "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.md"
CURRENT_STATE_PATH = ROOT / "docs/delivery/R0_CONVERGENCE_CURRENT_STATE.md"
OWNER_DECISION_PATH = ROOT / "docs/delivery/R0_OWNER_DECISION.md"
BLUEPRINT_PATH = ROOT / "docs/product/ASA_TARGET_PLATFORM_BLUEPRINT.yaml"
INDEX_PATH = ROOT / "docs/product/TARGET_PLATFORM_INDEX.md"
AGENTS_PATH = ROOT / "AGENTS.md"
START_PATH = ROOT / "START_HERE_FOR_AI.md"
RUNBOOK_PATH = ROOT / "docs/delivery/BOT_RUNBOOK.md"

EXPECTED_RELEASES = [f"R{index}" for index in range(11)]
EXPECTED_ISSUES = {
    "R0": 36,
    "R1": 48,
    "R2": 62,
    "R3": 37,
    "R4": 63,
    "R5": 40,
    "R6": 64,
    "R7": 38,
    "R8": 39,
    "R9": 41,
    "R10": 42,
}
EXPECTED_PORTS = {"bind": "127.0.0.1", "web": 4610, "api": 4611, "e2e": 4612}
EXPECTED_FORBIDDEN_PORTS = {3000, 3100, 5173}
EXPECTED_TRANSFER_ONLY = {35, 45, 47}
EXPECTED_COMPETING_R1 = {59, 60}
EXPECTED_OWNER_DECISIONS = {
    "account_principal_workspace_are_distinct",
    "tenant_and_rls_remain_security_boundary",
    "personal_project_does_not_require_classroom",
    "account_and_studentseat_sessions_are_distinct",
    "r0_r10_release_order_and_additive_migration_policy",
}


def fail(message: str) -> None:
    raise ValueError(message)


def load_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        fail(f"missing required file: {path.relative_to(ROOT)}")
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        fail(f"{path.relative_to(ROOT)} must contain a YAML object")
    return document


def read_text(path: Path) -> str:
    if not path.is_file():
        fail(f"missing required file: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_markers(path: Path, markers: tuple[str, ...]) -> None:
    text = read_text(path)
    for marker in markers:
        if marker not in text:
            fail(f"{path.relative_to(ROOT)} misses required marker: {marker}")


def issue_number(url: Any) -> int:
    prefix = "https://github.com/spikeal8-maker/asa-lab/issues/"
    if not isinstance(url, str) or not url.startswith(prefix):
        fail(f"invalid ASA Lab Issue URL: {url!r}")
    suffix = url.removeprefix(prefix)
    if not suffix.isdigit():
        fail(f"Issue URL does not end in an integer: {url}")
    return int(suffix)


def validate_release_graph(releases: list[dict[str, Any]]) -> None:
    release_ids = [release.get("id") for release in releases]
    if release_ids != EXPECTED_RELEASES:
        fail(f"release order must be {EXPECTED_RELEASES}, got {release_ids}")
    if len(set(release_ids)) != len(release_ids):
        fail("release IDs must be unique")

    known = set(release_ids)
    dependencies: dict[str, set[str]] = {}
    reverse: dict[str, set[str]] = {release_id: set() for release_id in release_ids}
    for release in releases:
        release_id = release["id"]
        raw_dependencies = release.get("depends_on")
        if not isinstance(raw_dependencies, list) or not all(
            isinstance(item, str) for item in raw_dependencies
        ):
            fail(f"{release_id}.depends_on must be a string list")
        unknown = sorted(set(raw_dependencies) - known)
        if unknown:
            fail(f"{release_id} references unknown dependencies: {unknown}")
        if release_id in raw_dependencies:
            fail(f"{release_id} cannot depend on itself")
        dependencies[release_id] = set(raw_dependencies)
        for dependency in raw_dependencies:
            reverse[dependency].add(release_id)

    indegree = {release_id: len(dependencies[release_id]) for release_id in release_ids}
    queue = deque(release_id for release_id in release_ids if indegree[release_id] == 0)
    visited: list[str] = []
    while queue:
        current = queue.popleft()
        visited.append(current)
        for dependent in reverse[current]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                queue.append(dependent)
    if len(visited) != len(release_ids):
        fail("release dependency graph contains a cycle")


def validate_plan(plan: dict[str, Any], blueprint: dict[str, Any]) -> tuple[int, int]:
    if plan.get("schema_version") != "1.0.0":
        fail("execution plan schema_version must be 1.0.0")
    if plan.get("plan_id") != "asa-target-platform-r0-r10":
        fail("unexpected execution plan id")
    if plan.get("status") != "owner_review_required":
        fail("execution plan must remain owner_review_required before PR 43 merge")
    if plan.get("current_gate") != "R0":
        fail("current gate must remain R0 until owner-approved baseline convergence")

    activation = plan.get("activation")
    if not isinstance(activation, dict) or activation.get("pull_request") != 43:
        fail("execution plan activation must be tied to PR 43")
    if "owner approval" not in str(activation.get("rule", "")):
        fail("activation rule must explicitly require owner approval")

    ports = plan.get("ports")
    if not isinstance(ports, dict):
        fail("ports must be an object")
    for key, expected in EXPECTED_PORTS.items():
        if ports.get(key) != expected:
            fail(f"port policy mismatch for {key}: expected {expected}, got {ports.get(key)!r}")
    if set(ports.get("forbidden") or []) != EXPECTED_FORBIDDEN_PORTS:
        fail("forbidden ports must be exactly 3000, 3100 and 5173")

    rules = set(plan.get("execution_rules") or [])
    required_rules = {
        "one_owner_facing_pr_per_release",
        "one_active_product_implementation_line",
        "owner_stop_between_releases",
        "additive_migrations_until_owner_approved_destructive_gate",
        "no_new_long_lived_stacked_product_branches_after_r0",
        "next_release_starts_only_after_merge_and_map_transition",
    }
    missing_rules = sorted(required_rules - rules)
    if missing_rules:
        fail(f"execution plan misses rules: {missing_rules}")

    branch_policy = plan.get("branch_policy")
    if not isinstance(branch_policy, dict):
        fail("branch_policy must be an object")
    if branch_policy.get("parallel_product_branches") != "forbidden":
        fail("parallel product branches must be forbidden")
    if branch_policy.get("competing_candidates_require_owner_selection") is not True:
        fail("competing candidates must require owner selection")

    convergence = plan.get("r0_convergence")
    if not isinstance(convergence, dict):
        fail("r0_convergence must be an object")
    candidates = convergence.get("candidates")
    if not isinstance(candidates, list):
        fail("r0_convergence.candidates must be a list")
    candidate_ids = [candidate.get("id") for candidate in candidates if isinstance(candidate, dict)]
    if len(candidate_ids) != len(candidates) or len(set(candidate_ids)) != len(candidate_ids):
        fail("R0 candidate IDs must be present and unique")

    transfer_only = {
        int(candidate["pull_request"])
        for candidate in candidates
        if candidate.get("role") == "transfer_only"
    }
    if transfer_only != EXPECTED_TRANSFER_ONLY:
        fail(f"transfer-only PRs must be {sorted(EXPECTED_TRANSFER_ONLY)}, got {sorted(transfer_only)}")
    competing = {
        int(candidate["pull_request"])
        for candidate in candidates
        if candidate.get("role") == "competing_r1_candidate"
    }
    if competing != EXPECTED_COMPETING_R1:
        fail(f"competing R1 PRs must be {sorted(EXPECTED_COMPETING_R1)}, got {sorted(competing)}")

    actions = convergence.get("ordered_actions")
    if not isinstance(actions, list) or len(actions) < 7:
        fail("R0 ordered_actions must define the full convergence sequence")
    if actions[-1] != "rebase_selected_r1_once_on_accepted_baseline":
        fail("R0 must end by rebasing exactly one selected R1 line on the accepted baseline")

    releases = plan.get("releases")
    if not isinstance(releases, list):
        fail("releases must be a list")
    validate_release_graph(releases)

    branches: list[str] = []
    issue_numbers: list[int] = []
    for release in releases:
        release_id = release["id"]
        expected_issue = EXPECTED_ISSUES[release_id]
        actual_issue = issue_number(release.get("issue"))
        if actual_issue != expected_issue:
            fail(f"{release_id} must reference Issue {expected_issue}, got {actual_issue}")
        issue_numbers.append(actual_issue)

        branch = release.get("canonical_branch")
        if not isinstance(branch, str) or not branch.strip():
            fail(f"{release_id} must define a canonical_branch")
        branches.append(branch)

        status = release.get("status")
        expected_status = "in_review" if release_id == "R0" else "blocked"
        if status != expected_status:
            fail(f"{release_id} status must be {expected_status}, got {status!r}")
        if not str(release.get("owner_review", "")).startswith("required"):
            fail(f"{release_id} must require owner review")
        if not isinstance(release.get("visible_result"), str) or not release["visible_result"].strip():
            fail(f"{release_id} must define a visible_result")
        if not isinstance(release.get("non_goals"), list):
            fail(f"{release_id}.non_goals must be a list")

    duplicate_branches = [branch for branch, count in Counter(branches).items() if count > 1]
    if duplicate_branches:
        fail(f"canonical release branches must be unique: {duplicate_branches}")
    if len(set(issue_numbers)) != len(issue_numbers):
        fail("release Issues must be unique")

    blueprint_releases = blueprint.get("releases")
    if not isinstance(blueprint_releases, list):
        fail("target blueprint releases must be a list")
    blueprint_by_id = {
        release.get("id"): release
        for release in blueprint_releases
        if isinstance(release, dict) and isinstance(release.get("id"), str)
    }
    for release in releases:
        blueprint_release = blueprint_by_id.get(release["id"])
        if blueprint_release is None:
            fail(f"execution release {release['id']} is missing from target blueprint")
        if set(release["depends_on"]) != set(blueprint_release.get("depends_on") or []):
            fail(f"dependency mismatch between execution plan and blueprint for {release['id']}")

    legacy = plan.get("legacy_traceability")
    if not isinstance(legacy, list):
        fail("legacy_traceability must be a list")
    if not any(
        item.get("issue", "").endswith("/24") and item.get("status") == "superseded"
        for item in legacy
        if isinstance(item, dict)
    ):
        fail("legacy Project Shell Issue 24 must be marked superseded")

    owner_decisions = set(plan.get("owner_decisions_required_before_activation") or [])
    if owner_decisions != EXPECTED_OWNER_DECISIONS:
        fail("owner decision set is incomplete or contains unapproved additions")

    return len(releases), len(candidates)


def validate_human_plan() -> None:
    text = read_text(HUMAN_PLAN_PATH)
    for release_id in EXPECTED_RELEASES:
        marker = f"Release {release_id}"
        if marker not in text:
            fail(f"human execution plan misses marker: {marker}")
    for marker in (
        "## 2. Конвергенция текущих веток",
        "one accepted baseline",
        "не создавать новые long-lived stacked product branches",
    ):
        if marker not in text:
            fail(f"human execution plan misses convergence marker: {marker}")


def validate_owner_and_agent_entry_points() -> None:
    require_markers(
        CURRENT_STATE_PATH,
        (
            "owner_review_required",
            "Current gate: `R0`",
            "PR №35/№45/№47",
            "PR №59",
            "PR №60",
            "Product coding",
            "Issue №24",
        ),
    )
    require_markers(
        OWNER_DECISION_PATH,
        (
            "## Решение 1.",
            "## Решение 2.",
            "## Решение 3.",
            "## Решение 4.",
            "## Решение 5.",
            "OWNER DECISION: APPROVED",
            "Convergence order: accepted",
        ),
    )
    require_markers(
        INDEX_PATH,
        (
            "R0  Contract and one accepted baseline",
            "R10 Multi-module lifecycle proof",
            "ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml",
            "R0_OWNER_DECISION.md",
        ),
    )
    require_markers(
        AGENTS_PATH,
        (
            "## 0. Target Platform activation gate",
            "current_gate: R0",
            "TASK-PROJECT-SHELL-001",
            "PR №59",
            "PR №60",
            "product code",
        ),
    )
    require_markers(
        START_PATH,
        (
            "current gate = R0",
            "product coding = forbidden",
            "ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml",
            "Issue №36",
        ),
    )
    require_markers(
        RUNBOOK_PATH,
        (
            "## 4. R0 convergence",
            "PR #35/#45/#47 transfer-only",
            "PR #59/#60",
            "python tools/validate_target_execution.py",
        ),
    )


def main() -> int:
    try:
        plan = load_yaml(PLAN_PATH)
        blueprint = load_yaml(BLUEPRINT_PATH)
        release_count, candidate_count = validate_plan(plan, blueprint)
        validate_human_plan()
        validate_owner_and_agent_entry_points()
    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"ASA target execution contract FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA target execution contract PASS")
    print(f"- releases: {release_count} (R0-R10)")
    print(f"- R0 convergence candidates: {candidate_count}")
    print("- owner/agent entry documents: synchronized")
    print("- current gate: R0 / owner review required")
    print("- competing R1 candidates frozen: PR 59 and PR 60")
    print("- canonical ports: web=4610 api=4611 e2e=4612")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
