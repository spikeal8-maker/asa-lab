#!/usr/bin/env python3
"""Validate the machine-readable R0 owner-decision state.

A technically green contract may remain pending. This validator prevents an
agent from silently converting technical PASS into product/architecture
approval. Pending is a valid state; rejected requires contract revision;
approved requires complete attribution and all decisions accepted.
"""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
DECISION_PATH = ROOT / "docs/delivery/R0_OWNER_DECISION.yaml"
EXPECTED_DECISIONS = {
    "account_principal_workspace_are_distinct",
    "tenant_and_rls_remain_security_boundary",
    "personal_project_does_not_require_classroom",
    "account_and_studentseat_sessions_are_distinct",
    "r0_r10_release_order_and_additive_migration_policy",
}
EXPECTED_RULES = {
    "all_five_decisions_must_be_accepted",
    "convergence_order_must_be_accepted",
    "technical_r0_suite_must_pass",
    "pr_43_must_remain_draft_until_owner_approval",
    "r1_must_remain_blocked_until_post_merge_transition",
}


def fail(message: str) -> None:
    raise ValueError(message)


def load() -> dict[str, Any]:
    if not DECISION_PATH.is_file():
        fail(f"missing {DECISION_PATH.relative_to(ROOT)}")
    document = yaml.safe_load(DECISION_PATH.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        fail("owner decision YAML must be an object")
    return document


def main() -> int:
    try:
        document = load()
        if document.get("schema_version") != "1.0.0":
            fail("schema_version must be 1.0.0")
        if document.get("decision_id") != "asa-r0-target-platform-activation":
            fail("unexpected decision_id")
        if document.get("activation_pull_request") != 43:
            fail("activation_pull_request must be 43")
        if document.get("program_issue") != "https://github.com/spikeal8-maker/asa-lab/issues/36":
            fail("program_issue must reference Issue 36")
        if document.get("human_packet") != "docs/delivery/R0_OWNER_DECISION.md":
            fail("human_packet must reference R0_OWNER_DECISION.md")

        raw_decisions = document.get("decisions")
        if not isinstance(raw_decisions, list):
            fail("decisions must be a list")
        decisions: dict[str, dict[str, Any]] = {}
        for entry in raw_decisions:
            if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
                fail("every decision must be an object with an id")
            decision_id = entry["id"]
            if decision_id in decisions:
                fail(f"duplicate decision: {decision_id}")
            decisions[decision_id] = entry
        if set(decisions) != EXPECTED_DECISIONS:
            fail("owner decision IDs do not match the five target activation decisions")

        rules = set(document.get("activation_rules") or [])
        if rules != EXPECTED_RULES:
            fail("activation_rules are incomplete or contain unapproved additions")

        status = document.get("status")
        convergence = document.get("convergence_order")
        approval = document.get("approval")
        if not isinstance(convergence, dict) or not isinstance(approval, dict):
            fail("convergence_order and approval must be objects")

        decision_statuses = {entry.get("status") for entry in decisions.values()}
        convergence_status = convergence.get("status")

        if status == "pending_owner":
            if decision_statuses != {"pending"}:
                fail("pending_owner requires all five decisions to remain pending")
            if convergence_status != "pending":
                fail("pending_owner requires convergence_order.status = pending")
            if any(approval.get(field) is not None for field in ("approved_by", "approved_at", "evidence_comment_url")):
                fail("pending_owner must not contain approval attribution")

        elif status == "approved_pending_merge":
            if decision_statuses != {"accepted"}:
                fail("approved_pending_merge requires all five decisions accepted")
            if convergence_status != "accepted":
                fail("approved_pending_merge requires convergence order accepted")
            for field in ("approved_by", "approved_at", "evidence_comment_url"):
                value = approval.get(field)
                if not isinstance(value, str) or not value.strip():
                    fail(f"approved_pending_merge requires approval.{field}")
            if "/pull/43#issuecomment-" not in approval["evidence_comment_url"]:
                fail("approval evidence must be a PR 43 issue-comment URL")

        elif status == "rejected_changes_required":
            if "rejected" not in decision_statuses and convergence_status != "rejected":
                fail("rejected state requires a rejected decision or convergence order")
            notes = [entry.get("notes") for entry in decisions.values() if entry.get("status") == "rejected"]
            if convergence_status == "rejected":
                notes.append(convergence.get("notes"))
            if not any(isinstance(note, str) and note.strip() for note in notes):
                fail("rejected state requires explanatory notes")
            print("ASA R0 owner decision REJECTED: contract changes required", file=sys.stderr)
            return 1

        else:
            fail(f"unsupported owner decision status: {status!r}")

    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"ASA R0 owner decision FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA R0 owner decision state PASS")
    print(f"- status: {status}")
    print(f"- decisions: {len(decisions)}")
    print(f"- convergence order: {convergence_status}")
    print(f"- activation allowed: {str(status == 'approved_pending_merge').lower()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
