#!/usr/bin/env python3
"""Validate the machine-readable R0 owner-decision state.

A technically green contract may remain pending. This validator prevents an
agent from silently converting technical PASS into product/architecture
approval. Pending is a valid state; rejected requires contract revision;
approved requires complete attribution from the repository owner.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
DECISION_PATH = ROOT / "docs/delivery/R0_OWNER_DECISION.yaml"
SCOPE_PATH = ROOT / "docs/product/ASA_TINKERCAD_100_PERCENT_SCOPE.yaml"
EXPECTED_OWNER = "spikeal8-maker"
EXPECTED_COMMENT_PREFIX = "https://github.com/spikeal8-maker/asa-lab/pull/43#issuecomment-"
ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")
EXPECTED_DECISIONS = {
    "account_principal_workspace_are_distinct",
    "tenant_and_rls_remain_security_boundary",
    "personal_project_does_not_require_classroom",
    "account_and_studentseat_sessions_are_distinct",
    "r0_r10_release_order_and_additive_migration_policy",
    "complete_interface_catalog_and_functional_parity_scope",
}
EXPECTED_RULES = {
    "all_six_decisions_must_be_accepted",
    "convergence_order_must_be_accepted",
    "technical_r0_suite_must_pass",
    "pr_43_must_remain_draft_until_owner_approval",
    "r1_must_remain_blocked_until_post_merge_transition",
    "functional_parity_claim_must_remain_not_100_percent_until_runtime_and_owner_evidence",
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


def validate_approved_at(value: Any) -> None:
    if not isinstance(value, str) or not ISO_UTC.fullmatch(value):
        fail("approval.approved_at must be a quoted ISO-8601 UTC timestamp ending in Z")
    try:
        datetime.fromisoformat(value.removesuffix("Z") + "+00:00")
    except ValueError as error:
        fail(f"approval.approved_at is not a valid timestamp: {error}")


def main() -> int:
    try:
        document = load(DECISION_PATH)
        scope = load(SCOPE_PATH)
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
        if scope.get("scope_id") != "asa-tinkercad-functional-parity":
            fail("owner decision references an invalid functional parity scope")
        if scope.get("completion_rule", {}).get("current_claim") != "not_100_percent":
            fail("R0 owner approval cannot begin with a false 100% parity claim")

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
            fail("owner decision IDs do not match the six target activation decisions")

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
                fail("pending_owner requires all six decisions to remain pending")
            if convergence_status != "pending":
                fail("pending_owner requires convergence_order.status = pending")
            if any(
                approval.get(field) is not None
                for field in ("approved_by", "approved_at", "evidence_comment_url")
            ):
                fail("pending_owner must not contain approval attribution")

        elif status == "approved_pending_merge":
            if decision_statuses != {"accepted"}:
                fail("approved_pending_merge requires all six decisions accepted")
            if convergence_status != "accepted":
                fail("approved_pending_merge requires convergence order accepted")
            if approval.get("approved_by") != EXPECTED_OWNER:
                fail(f"approval.approved_by must be repository owner {EXPECTED_OWNER}")
            validate_approved_at(approval.get("approved_at"))
            evidence_url = approval.get("evidence_comment_url")
            if not isinstance(evidence_url, str) or not evidence_url.startswith(
                EXPECTED_COMMENT_PREFIX
            ):
                fail("approval evidence must be an issue-comment URL on PR 43")
            comment_id = evidence_url.removeprefix(EXPECTED_COMMENT_PREFIX)
            if not comment_id.isdigit():
                fail("approval evidence URL must end with a numeric issue-comment id")

        elif status == "rejected_changes_required":
            if "rejected" not in decision_statuses and convergence_status != "rejected":
                fail("rejected state requires a rejected decision or convergence order")
            notes = [
                entry.get("notes")
                for entry in decisions.values()
                if entry.get("status") == "rejected"
            ]
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
    print("- functional parity scope claim: not_100_percent")
    print(f"- expected owner: {EXPECTED_OWNER}")
    print(f"- activation allowed: {str(status == 'approved_pending_merge').lower()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
