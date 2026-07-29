#!/usr/bin/env python3
"""Validate that exactly one R1 identity candidate is selected only during R0C."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
DECISION_PATH = ROOT / "docs/delivery/R0_R1_CANDIDATE_DECISION.yaml"
POST_MERGE_PATH = ROOT / "docs/delivery/R0_POST_MERGE_TRANSITION.yaml"
MIGRATION_CONTRACT_PATH = ROOT / "docs/architecture/R1_ACCOUNT_WORKSPACE_MIGRATION_CONTRACT.yaml"
EXPECTED_OWNER = "spikeal8-maker"
EXPECTED_COMMENT_PREFIX = "https://github.com/spikeal8-maker/asa-lab/issues/48#issuecomment-"
ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")
EXPECTED_CANDIDATES = {
    59: ("agent/parity-c1-identity", "candidate_a_broad_identity"),
    60: ("agent/account-vertical-001", "candidate_b_account_vertical"),
}
EXPECTED_PRESELECTION = {
    "r0b_integration_merged",
    "both_candidates_rebased_or_conflict_reported_against_accepted_baseline",
    "empty_existing_repeat_migrations_compared",
    "teacher_classes_projects_electronics_preservation_compared",
    "sessions_v2_and_active_workspace_compared",
    "tenant_principal_rls_negatives_compared",
    "creator_without_educator_classes_denial_compared",
    "class_code_studentseat_scope_absent_from_selected_r1",
    "owner_visible_account_flow_compared",
}
EXPECTED_ALLOWED_TRANSFERS = {
    "migration_preflight_and_integrity_patterns",
    "baseline_preservation_tooling",
    "age_and_email_verification_policy",
    "public_entry_ux_within_current_r1_milestone",
    "compatibility_and_deprecation_metadata",
}
EXPECTED_FORBIDDEN_TRANSFERS = {
    "join_class_controllers",
    "class_code_secret_or_issue_tools",
    "classroom_join_intent",
    "studentseat_routes_or_screens",
    "r5_capabilities",
}
EXPECTED_RULES = {
    "selection_forbidden_before_r0c",
    "exactly_one_candidate_selected",
    "unselected_candidate_closed_superseded_after_verified_transfer",
    "selected_candidate_rebased_once_on_accepted_baseline",
    "no_third_identity_implementation",
    "selected_candidate_must_pass_r1_migration_contract",
    "recommendation_does_not_equal_owner_decision",
}
ALLOWED_STATUSES = {
    "deferred_until_r0c",
    "owner_selection_pending",
    "selected_pending_rebase",
    "selected_ready_for_r1",
    "rejected_both_changes_required",
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


def validate_timestamp(value: Any) -> None:
    if not isinstance(value, str) or not ISO_UTC.fullmatch(value):
        fail("approval.decided_at must be a quoted ISO-8601 UTC timestamp ending in Z")
    try:
        datetime.fromisoformat(value.removesuffix("Z") + "+00:00")
    except ValueError as error:
        fail(f"approval.decided_at is invalid: {error}")


def main() -> int:
    try:
        document = load(DECISION_PATH)
        post_merge = load(POST_MERGE_PATH)
        migration_contract = load(MIGRATION_CONTRACT_PATH)

        if document.get("schema_version") != "1.0.0":
            fail("schema_version must be 1.0.0")
        if document.get("decision_id") != "asa-r0-r1-candidate-selection":
            fail("unexpected decision_id")
        if document.get("program_issue") != "https://github.com/spikeal8-maker/asa-lab/issues/36":
            fail("program_issue must reference Issue 36")
        if document.get("release_issue") != "https://github.com/spikeal8-maker/asa-lab/issues/48":
            fail("release_issue must reference Issue 48")
        if document.get("human_packet") != "docs/delivery/R0_R1_CANDIDATE_SELECTION.md":
            fail("human_packet must reference the R1 selection packet")
        if document.get("selection_phase") != "R0C_R1_SELECTION":
            fail("selection_phase must be R0C_R1_SELECTION")

        phase_ids = {
            phase.get("id")
            for phase in post_merge.get("phases") or []
            if isinstance(phase, dict)
        }
        if document["selection_phase"] not in phase_ids:
            fail("selection phase is missing from the post-merge contract")
        if migration_contract.get("contract_id") != "asa-r1-account-workspace-migration":
            fail("R1 candidate decision references an unexpected migration contract")

        raw_candidates = document.get("candidates")
        if not isinstance(raw_candidates, list):
            fail("candidates must be a list")
        candidates: dict[int, dict[str, Any]] = {}
        for candidate in raw_candidates:
            if not isinstance(candidate, dict) or not isinstance(candidate.get("pull_request"), int):
                fail("every candidate must be an object with integer pull_request")
            number = candidate["pull_request"]
            if number in candidates:
                fail(f"duplicate candidate PR: {number}")
            candidates[number] = candidate
        if set(candidates) != set(EXPECTED_CANDIDATES):
            fail("candidate set must be exactly PR 59 and PR 60")
        for number, (branch, label) in EXPECTED_CANDIDATES.items():
            candidate = candidates[number]
            if candidate.get("branch") != branch:
                fail(f"candidate PR {number} branch must be {branch}")
            if candidate.get("label") != label:
                fail(f"candidate PR {number} label must be {label}")
            if candidate.get("state") not in {"frozen", "selected", "superseded"}:
                fail(f"candidate PR {number} has invalid state {candidate.get('state')!r}")

        recommendation = document.get("recommendation")
        if not isinstance(recommendation, dict):
            fail("recommendation must be an object")
        if recommendation.get("pull_request") != 60:
            fail("static recommendation must remain PR 60 unless the review packet changes")
        if recommendation.get("status") != "advisory_only":
            fail("recommendation must remain advisory_only")
        reasons = recommendation.get("reasons")
        if not isinstance(reasons, list) or not reasons:
            fail("recommendation must include reasons")

        if set(document.get("required_preselection_evidence") or []) != EXPECTED_PRESELECTION:
            fail("required preselection evidence is incomplete or contains additions")
        if set(document.get("allowed_transfer_categories_from_pr59_if_pr60_selected") or []) != EXPECTED_ALLOWED_TRANSFERS:
            fail("allowed transfer categories are incomplete or contain additions")
        if set(document.get("forbidden_transfer_categories_from_pr59_to_r1") or []) != EXPECTED_FORBIDDEN_TRANSFERS:
            fail("forbidden transfer categories are incomplete or contain additions")
        if set(document.get("activation_rules") or []) != EXPECTED_RULES:
            fail("activation rules are incomplete or contain additions")

        status = document.get("status")
        if status not in ALLOWED_STATUSES:
            fail(f"unsupported candidate decision status: {status!r}")
        selection = document.get("selection")
        approval = document.get("approval")
        if not isinstance(selection, dict) or not isinstance(approval, dict):
            fail("selection and approval must be objects")
        if selection.get("target_branch") != "agent/r1-account-onboarding":
            fail("selected R1 target branch must be agent/r1-account-onboarding")

        selected = selection.get("selected_pull_request")
        unselected = selection.get("unselected_pull_request")
        selected_branch = selection.get("selected_branch")
        transfer = selection.get("transfer_from_unselected")
        if not isinstance(transfer, list):
            fail("transfer_from_unselected must be a list")

        if status in {"deferred_until_r0c", "owner_selection_pending"}:
            if any(value is not None for value in (selected, unselected, selected_branch, selection.get("decision_notes"))):
                fail(f"{status} must not contain a selected candidate")
            if transfer:
                fail(f"{status} must not contain transfer selections")
            if any(
                approval.get(field) is not None
                for field in ("decided_by", "decided_at", "evidence_comment_url")
            ):
                fail(f"{status} must not contain owner attribution")
            if any(candidate.get("state") != "frozen" for candidate in candidates.values()):
                fail(f"{status} requires both candidates frozen")

        elif status in {"selected_pending_rebase", "selected_ready_for_r1"}:
            if selected not in EXPECTED_CANDIDATES:
                fail("selected_pull_request must be 59 or 60")
            expected_unselected = 60 if selected == 59 else 59
            if unselected != expected_unselected:
                fail("unselected_pull_request must be the other candidate")
            if selected_branch != EXPECTED_CANDIDATES[selected][0]:
                fail("selected_branch does not match selected candidate")
            if candidates[selected].get("state") != "selected":
                fail("selected candidate state must be selected")
            if candidates[unselected].get("state") != "superseded":
                fail("unselected candidate state must be superseded")
            if selected == 60:
                unknown_transfers = sorted(set(transfer) - EXPECTED_ALLOWED_TRANSFERS)
                if unknown_transfers:
                    fail(f"transfer list contains forbidden categories: {unknown_transfers}")
            elif transfer:
                fail("PR 59 selection currently defines no automatic transfer categories from PR 60")
            if approval.get("decided_by") != EXPECTED_OWNER:
                fail(f"selection must be attributed to repository owner {EXPECTED_OWNER}")
            validate_timestamp(approval.get("decided_at"))
            evidence_url = approval.get("evidence_comment_url")
            if not isinstance(evidence_url, str) or not evidence_url.startswith(EXPECTED_COMMENT_PREFIX):
                fail("selection evidence must be an Issue 48 issue-comment URL")
            if not evidence_url.removeprefix(EXPECTED_COMMENT_PREFIX).isdigit():
                fail("selection evidence URL must end with a numeric comment id")
            notes = selection.get("decision_notes")
            if not isinstance(notes, str) or not notes.strip():
                fail("selected candidate requires decision_notes")

        else:
            if any(value is not None for value in (selected, unselected, selected_branch)):
                fail("rejected_both state must not select a candidate")
            if transfer:
                fail("rejected_both state must not contain transfer selections")
            if approval.get("decided_by") != EXPECTED_OWNER:
                fail(f"rejection must be attributed to repository owner {EXPECTED_OWNER}")
            validate_timestamp(approval.get("decided_at"))
            evidence_url = approval.get("evidence_comment_url")
            if not isinstance(evidence_url, str) or not evidence_url.startswith(EXPECTED_COMMENT_PREFIX):
                fail("rejection evidence must be an Issue 48 issue-comment URL")
            notes = selection.get("decision_notes")
            if not isinstance(notes, str) or not notes.strip():
                fail("rejected_both state requires decision_notes")
            print("ASA R0 R1 candidate decision REJECTED: consolidation plan required", file=sys.stderr)
            return 1

    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"ASA R0 R1 candidate decision FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA R0 R1 candidate decision state PASS")
    print(f"- status: {status}")
    print(f"- candidates: {len(candidates)}")
    print(f"- recommendation: PR {recommendation['pull_request']} (advisory only)")
    print(f"- selection recorded: {str(selected is not None).lower()}")
    print(f"- R1 implementation allowed: {str(status == 'selected_ready_for_r1').lower()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
