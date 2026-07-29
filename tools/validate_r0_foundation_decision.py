#!/usr/bin/env python3
"""Validate machine-readable owner state for the PR #34 foundation candidate."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
DECISION_PATH = ROOT / "docs/delivery/R0_FOUNDATION_DECISION.yaml"
EXPECTED_OWNER = "spikeal8-maker"
EXPECTED_COMMENT_PREFIX = "https://github.com/spikeal8-maker/asa-lab/pull/34#issuecomment-"
ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")
GIT_SHA = re.compile(r"^[0-9a-f]{40}$")
EXPECTED_SCOPE = {"project_foundation", "electronics_foundation"}
EXPECTED_FORBIDDEN_SCOPE = {
    "account_identity",
    "studentseat",
    "publication_remix",
    "assignments_submissions_review",
    "full_tinkercad_parity_claim",
    "destructive_migration",
}
EXPECTED_ITEMS = {
    "runtime_projects_update_is_column_scoped",
    "migration_empty_existing_repeat_pass",
    "project_save_reload_checkpoint_pass",
    "electronics_foundation_flow_pass",
    "owner_visual_review_pass",
}
EXPECTED_RULES = {
    "all_required_corrective_items_must_pass_before_acceptance",
    "acceptance_is_project_and_electronics_foundation_only",
    "parity_completion_must_remain_not_claimed",
    "rejection_requires_owner_notes",
    "pr_43_rebase_waits_for_accepted_merged_foundation",
    "r1_remains_blocked",
}
EXPECTED_ALLOWED_STATUSES = {
    "pending_owner",
    "accepted_pending_merge",
    "accepted_merged",
    "rejected_changes_required",
    "rejected_close_candidate",
}


def fail(message: str) -> None:
    raise ValueError(message)


def load() -> dict[str, Any]:
    if not DECISION_PATH.is_file():
        fail(f"missing {DECISION_PATH.relative_to(ROOT)}")
    document = yaml.safe_load(DECISION_PATH.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        fail("foundation decision YAML must be an object")
    return document


def validate_timestamp(value: Any, label: str) -> None:
    if not isinstance(value, str) or not ISO_UTC.fullmatch(value):
        fail(f"{label} must be a quoted ISO-8601 UTC timestamp ending in Z")
    try:
        datetime.fromisoformat(value.removesuffix("Z") + "+00:00")
    except ValueError as error:
        fail(f"{label} is invalid: {error}")


def validate_owner_attribution(approval: dict[str, Any]) -> None:
    if approval.get("decided_by") != EXPECTED_OWNER:
        fail(f"approval.decided_by must be repository owner {EXPECTED_OWNER}")
    validate_timestamp(approval.get("decided_at"), "approval.decided_at")
    evidence_url = approval.get("evidence_comment_url")
    if not isinstance(evidence_url, str) or not evidence_url.startswith(EXPECTED_COMMENT_PREFIX):
        fail("foundation decision evidence must be a PR34 issue-comment URL")
    if not evidence_url.removeprefix(EXPECTED_COMMENT_PREFIX).isdigit():
        fail("foundation evidence URL must end with a numeric comment id")
    notes = approval.get("decision_notes")
    if not isinstance(notes, str) or not notes.strip():
        fail("foundation owner decision requires decision_notes")


def validate_acceptance_items(items: dict[str, dict[str, Any]]) -> None:
    non_pass = sorted(item_id for item_id, item in items.items() if item.get("status") != "pass")
    if non_pass:
        fail(f"foundation acceptance requires all corrective items PASS: {non_pass}")
    missing_evidence = sorted(item_id for item_id, item in items.items() if not item.get("evidence"))
    if missing_evidence:
        fail(f"foundation acceptance requires evidence for all items: {missing_evidence}")


def main() -> int:
    try:
        document = load()
        if document.get("schema_version") != "1.0.0":
            fail("schema_version must be 1.0.0")
        if document.get("decision_id") != "asa-r0-pr34-foundation":
            fail("unexpected decision_id")
        if document.get("foundation_pull_request") != 34:
            fail("foundation_pull_request must be 34")
        if document.get("program_issue") != "https://github.com/spikeal8-maker/asa-lab/issues/36":
            fail("program_issue must reference Issue 36")
        if document.get("human_packet") != "docs/delivery/R0_FOUNDATION_REVIEW_PR34.md":
            fail("human_packet must reference the PR34 review packet")

        if set(document.get("expected_scope") or []) != EXPECTED_SCOPE:
            fail("expected_scope must be exactly Project and Electronics foundation")
        if set(document.get("forbidden_scope") or []) != EXPECTED_FORBIDDEN_SCOPE:
            fail("forbidden_scope is incomplete or contains additions")
        if set(document.get("allowed_statuses") or []) != EXPECTED_ALLOWED_STATUSES:
            fail("allowed_statuses are incomplete or contain additions")
        if set(document.get("activation_rules") or []) != EXPECTED_RULES:
            fail("activation_rules are incomplete or contain additions")

        raw_items = document.get("required_corrective_items")
        if not isinstance(raw_items, list):
            fail("required_corrective_items must be a list")
        items: dict[str, dict[str, Any]] = {}
        for item in raw_items:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                fail("every corrective item must be an object with id")
            item_id = item["id"]
            if item_id in items:
                fail(f"duplicate corrective item: {item_id}")
            if item.get("status") not in {"open", "pending", "pass", "fail", "blocked", "not_applicable"}:
                fail(f"unsupported corrective status for {item_id}: {item.get('status')!r}")
            if not isinstance(item.get("requirement"), str) or not item["requirement"].strip():
                fail(f"corrective item {item_id} must define requirement")
            items[item_id] = item
        if set(items) != EXPECTED_ITEMS:
            fail("corrective item set is incomplete or contains additions")

        status = document.get("status")
        if status not in EXPECTED_ALLOWED_STATUSES:
            fail(f"unsupported foundation decision status: {status!r}")
        approval = document.get("approval")
        merge = document.get("merge")
        if not isinstance(approval, dict) or not isinstance(merge, dict):
            fail("approval and merge must be objects")

        if status == "pending_owner":
            if any(
                approval.get(field) is not None
                for field in ("decided_by", "decided_at", "evidence_comment_url", "decision_notes")
            ):
                fail("pending_owner must not contain owner attribution")
            if any(value is not None for value in merge.values()):
                fail("pending_owner must not contain merge attribution")
            if any(item.get("status") == "pass" and not item.get("evidence") for item in items.values()):
                fail("a passing corrective item must contain evidence")

        elif status in {"accepted_pending_merge", "accepted_merged"}:
            validate_acceptance_items(items)
            validate_owner_attribution(approval)
            if "foundation" not in approval["decision_notes"].lower():
                fail("accepted foundation requires explicit foundation-only decision notes")
            if status == "accepted_pending_merge":
                if any(value is not None for value in merge.values()):
                    fail("accepted_pending_merge must not contain merge attribution")
            else:
                validate_timestamp(merge.get("merged_at"), "merge.merged_at")
                merge_sha = merge.get("merge_commit_sha")
                if not isinstance(merge_sha, str) or not GIT_SHA.fullmatch(merge_sha):
                    fail("merge.merge_commit_sha must be a 40-character lowercase Git SHA")
                if merge.get("merged_by") != EXPECTED_OWNER:
                    fail(f"merge.merged_by must be repository owner {EXPECTED_OWNER}")

        else:
            validate_owner_attribution(approval)
            if any(value is not None for value in merge.values()):
                fail("rejected foundation decision must not contain merge attribution")
            if status == "rejected_changes_required" and not any(
                item.get("status") in {"fail", "blocked", "open"} for item in items.values()
            ):
                fail("rejected_changes_required must identify an unresolved corrective item")
            print(
                "ASA R0 foundation decision REJECTED: target convergence contract must be revised",
                file=sys.stderr,
            )
            return 1

    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"ASA R0 foundation decision FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA R0 foundation decision state PASS")
    print(f"- status: {status}")
    print(f"- corrective items: {len(items)}")
    print(f"- owner decision recorded: {str(status != 'pending_owner').lower()}")
    print(f"- PR34 merged: {str(status == 'accepted_merged').lower()}")
    print(f"- PR43 final rebase allowed: {str(status == 'accepted_merged').lower()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
