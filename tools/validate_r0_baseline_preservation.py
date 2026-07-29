#!/usr/bin/env python3
"""Validate the baseline-preservation contract for R0B integration."""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "docs/delivery/R0_BASELINE_PRESERVATION_CONTRACT.yaml"
POST_MERGE_PATH = ROOT / "docs/delivery/R0_POST_MERGE_TRANSITION.yaml"
EXECUTION_PATH = ROOT / "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml"
EXPECTED_MAIN_FLOWS = {
    "workspace_email_password_teacher_login",
    "teacher_session_reload",
    "classroom_create",
    "classroom_list",
    "classroom_reload_persistence",
    "logout_and_session_revocation",
}
EXPECTED_MAIN_TABLES = {
    "tenants",
    "tenant_placements",
    "schools",
    "academic_periods",
    "users",
    "sessions",
    "classrooms",
    "classroom_memberships",
    "audit_events",
}
EXPECTED_PROJECT_TABLES = {"projects", "project_drafts", "project_versions"}
EXPECTED_SCHEMA_MIGRATIONS = {
    "migrations/0003_electronics_project_slice.sql",
    "migrations/0004_personal_teacher_projects.sql",
}
EXPECTED_PRESERVE_VALUES = {
    "projects.tenant_id",
    "projects.created_by",
    "projects.classroom_id",
    "projects.project_scope",
    "projects.module_key",
    "project_drafts.document_json",
    "project_drafts.revision",
    "project_versions.document_json",
    "project_versions.version_no",
}
EXPECTED_COMPUTED_FINGERPRINTS = {
    "project_drafts_document_json_canonical_sha256",
    "project_versions_document_json_canonical_sha256",
}
EXPECTED_TRANSFER_PRS = {35, 45, 47}
EXPECTED_FORBIDDEN_CHANGES = {
    "new_account_identity_model",
    "studentseat_or_class_code",
    "publication_or_remix",
    "assignments_submissions_review_grades",
    "destructive_migration",
    "regenerate_existing_ids",
    "reset_existing_credential_hashes",
    "disable_rls",
    "client_authoritative_tenant_workspace_or_capability",
    "second_competing_portal_or_editor_host",
}
EXPECTED_MANIFEST_FIELDS = {
    "source_commit_sha",
    "database_schema_migration_versions",
    "table_row_counts",
    "stable_id_samples",
    "credential_hash_fingerprints_without_plaintext",
    "project_draft_document_digests",
    "project_version_document_digests",
    "electronics_fixture_digests",
    "canonical_route_inventory",
    "desktop_mobile_screenshot_inventory",
}
EXPECTED_MIGRATION_SCENARIOS = {
    "empty_database",
    "accepted_main_database",
    "accepted_main_plus_pr34_database_if_approved",
    "repeated_migration",
    "backup_restore_copy",
}
EXPECTED_ASSERTIONS = {
    "no_required_table_dropped",
    "no_stable_id_changed",
    "no_credential_hash_changed",
    "no_project_document_changed_without_explicit_schema_migrator",
    "no_project_version_document_digest_changed",
    "no_cross_tenant_lineage_broken",
    "no_rls_policy_removed",
    "no_runtime_role_privilege_broadened",
}
EXPECTED_APPLICATION_TESTS = {
    "teacher_login_compatibility",
    "session_reload_compatibility",
    "classroom_create_list_reload",
    "project_create_save_reload_version",
    "electronics_document_save_reload",
    "runtime_role_least_privilege_matrix",
    "cross_tenant_negative_matrix",
}
EXPECTED_EXIT_GATE = {
    "one_integration_pr_merged",
    "baseline_manifest_before_and_after_compared",
    "all_preservation_assertions_pass",
    "transfer_only_prs_closed_after_verified_transfer",
    "owner_visual_acceptance",
    "no_duplicate_portal_project_hub_or_editor_host_implementation",
    "r1_remains_blocked",
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


def string_set(value: Any, label: str, *, non_empty: bool = True) -> set[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        fail(f"{label} must be a string list")
    if non_empty and not value:
        fail(f"{label} must not be empty")
    if any(not item.strip() for item in value):
        fail(f"{label} contains an empty value")
    if len(set(value)) != len(value):
        fail(f"{label} contains duplicates")
    return set(value)


def main() -> int:
    try:
        contract = load(CONTRACT_PATH)
        post_merge = load(POST_MERGE_PATH)
        execution = load(EXECUTION_PATH)

        if contract.get("schema_version") != "1.0.0":
            fail("baseline preservation schema_version must be 1.0.0")
        if contract.get("contract_id") != "asa-r0-baseline-preservation":
            fail("unexpected baseline preservation contract_id")
        if contract.get("status") != "inactive_until_r0b_foundation_integration":
            fail("baseline preservation contract must remain inactive until R0B")
        if contract.get("source_transition") != "docs/delivery/R0_POST_MERGE_TRANSITION.yaml":
            fail("baseline preservation contract must reference the post-merge transition")
        if contract.get("program_issue") != "https://github.com/spikeal8-maker/asa-lab/issues/36":
            fail("baseline preservation contract must reference Issue 36")
        if contract.get("foundation_pull_request") != 34:
            fail("foundation_pull_request must be 34")
        if contract.get("integration_source_branch") != "agent/parity-p1-visual-integration":
            fail("integration source branch mismatch")

        r0b = next(
            (
                phase
                for phase in post_merge.get("phases") or []
                if isinstance(phase, dict) and phase.get("id") == "R0B_FOUNDATION_INTEGRATION"
            ),
            None,
        )
        if not isinstance(r0b, dict):
            fail("post-merge transition misses R0B_FOUNDATION_INTEGRATION")
        if r0b.get("source_branch") != contract["integration_source_branch"]:
            fail("baseline preservation source branch differs from R0B source branch")

        main_foundation = contract.get("accepted_main_foundation")
        if not isinstance(main_foundation, dict):
            fail("accepted_main_foundation must be an object")
        if string_set(main_foundation.get("user_flows"), "accepted_main_foundation.user_flows") != EXPECTED_MAIN_FLOWS:
            fail("accepted main user flow set is incomplete or contains additions")
        if string_set(main_foundation.get("required_tables"), "accepted_main_foundation.required_tables") != EXPECTED_MAIN_TABLES:
            fail("accepted main required table set is incomplete or contains additions")
        string_set(main_foundation.get("security_invariants"), "accepted_main_foundation.security_invariants")
        string_set(main_foundation.get("immutable_identifiers"), "accepted_main_foundation.immutable_identifiers")

        project_foundation = contract.get("foundation_if_pr34_accepted")
        if not isinstance(project_foundation, dict):
            fail("foundation_if_pr34_accepted must be an object")
        schema_source = project_foundation.get("schema_source")
        if not isinstance(schema_source, dict):
            fail("foundation schema_source must be an object")
        if string_set(schema_source.get("migrations"), "foundation.schema_source.migrations") != EXPECTED_SCHEMA_MIGRATIONS:
            fail("PR34 schema source must be migrations 0003 and 0004")
        note = schema_source.get("note")
        if not isinstance(note, str) or "document_json" not in note or "no persisted digest column" not in note:
            fail("foundation schema note must explicitly describe document_json and computed digests")
        if string_set(project_foundation.get("required_tables"), "foundation.required_tables") != EXPECTED_PROJECT_TABLES:
            fail("PR34 foundation required table set must be projects/project_drafts/project_versions")
        string_set(project_foundation.get("user_flows"), "foundation.user_flows")
        string_set(project_foundation.get("immutable_identifiers"), "foundation.immutable_identifiers")
        if string_set(project_foundation.get("preserve_values"), "foundation.preserve_values") != EXPECTED_PRESERVE_VALUES:
            fail("foundation preserve_values do not match the actual PR34 schema")
        if string_set(project_foundation.get("computed_fingerprints"), "foundation.computed_fingerprints") != EXPECTED_COMPUTED_FINGERPRINTS:
            fail("foundation computed_fingerprints must cover draft and version document_json")
        string_set(
            project_foundation.get("electronics_document_invariants"),
            "foundation.electronics_document_invariants",
        )

        rules = contract.get("r0b_integration_rules")
        if not isinstance(rules, dict):
            fail("r0b_integration_rules must be an object")
        if rules.get("exactly_one_owner_facing_integration_pr") is not True:
            fail("R0B must allow exactly one owner-facing integration PR")
        if rules.get("accepted_base") != "main_after_pr34_decision_and_pr43_merge":
            fail("R0B accepted_base mismatch")
        if rules.get("source_branch") != contract["integration_source_branch"]:
            fail("R0B rules source branch mismatch")
        raw_candidates = rules.get("transfer_candidates")
        if not isinstance(raw_candidates, list):
            fail("transfer_candidates must be a list")
        transfer_prs = {
            candidate.get("pull_request")
            for candidate in raw_candidates
            if isinstance(candidate, dict)
        }
        if transfer_prs != EXPECTED_TRANSFER_PRS or len(raw_candidates) != len(transfer_prs):
            fail(f"transfer candidate PRs must be unique and equal {sorted(EXPECTED_TRANSFER_PRS)}")
        string_set(rules.get("allowed_changes"), "r0b_integration_rules.allowed_changes")
        if string_set(rules.get("forbidden_changes"), "r0b_integration_rules.forbidden_changes") != EXPECTED_FORBIDDEN_CHANGES:
            fail("R0B forbidden change set is incomplete or contains additions")

        manifest = contract.get("baseline_manifest")
        if not isinstance(manifest, dict):
            fail("baseline_manifest must be an object")
        if string_set(manifest.get("required_before_integration"), "baseline_manifest.required_before_integration") != EXPECTED_MANIFEST_FIELDS:
            fail("baseline manifest field set is incomplete or contains additions")
        if manifest.get("digest_algorithm") != "sha256":
            fail("baseline manifest digest algorithm must be sha256")
        if manifest.get("json_canonicalization") != "recursively_sorted_object_keys_preserve_array_order":
            fail("baseline manifest JSON canonicalization mismatch")
        if manifest.get("storage_path") != "reports/r0-baseline-manifest.json":
            fail("baseline manifest storage path mismatch")
        if manifest.get("contains_secrets") is not False:
            fail("baseline manifest must explicitly contain no secrets")

        migration_gate = contract.get("migration_gate")
        if not isinstance(migration_gate, dict):
            fail("migration_gate must be an object")
        if string_set(migration_gate.get("scenarios"), "migration_gate.scenarios") != EXPECTED_MIGRATION_SCENARIOS:
            fail("migration scenarios are incomplete or contain additions")
        if string_set(migration_gate.get("required_assertions"), "migration_gate.required_assertions") != EXPECTED_ASSERTIONS:
            fail("migration preservation assertions are incomplete or contain additions")

        application_gate = contract.get("application_gate")
        if not isinstance(application_gate, dict):
            fail("application_gate must be an object")
        for label in ("required_routes", "required_surfaces", "conditional_surfaces_if_pr34_accepted"):
            string_set(application_gate.get(label), f"application_gate.{label}")
        if string_set(application_gate.get("required_tests"), "application_gate.required_tests") != EXPECTED_APPLICATION_TESTS:
            fail("application required test set is incomplete or contains additions")

        owner_evidence = contract.get("owner_evidence")
        if not isinstance(owner_evidence, dict):
            fail("owner_evidence must be an object")
        string_set(owner_evidence.get("required"), "owner_evidence.required")
        string_set(owner_evidence.get("conditional_if_pr34_accepted"), "owner_evidence.conditional")
        if owner_evidence.get("acceptance_rule") != "owner_accepts_visible_flow_and_no_data_loss":
            fail("owner evidence acceptance rule mismatch")

        rollback = contract.get("rollback_contract")
        if not isinstance(rollback, dict):
            fail("rollback_contract must be an object")
        if rollback.get("strategy") != "revert_integration_read_path_and_feature_flags_without_deleting_additive_data":
            fail("rollback strategy must preserve additive data")
        string_set(rollback.get("required"), "rollback_contract.required")
        forbidden_rollback = string_set(rollback.get("forbidden"), "rollback_contract.forbidden")
        if "disable_rls" not in forbidden_rollback or "overwrite_immutable_project_versions" not in forbidden_rollback:
            fail("rollback contract must forbid disabling RLS and overwriting immutable versions")

        if string_set(contract.get("exit_gate"), "exit_gate") != EXPECTED_EXIT_GATE:
            fail("baseline preservation exit gate is incomplete or contains additions")

        execution_candidates = {
            candidate.get("pull_request")
            for candidate in execution.get("r0_convergence", {}).get("candidates") or []
            if isinstance(candidate, dict) and candidate.get("role") == "transfer_only"
        }
        if execution_candidates != EXPECTED_TRANSFER_PRS:
            fail("baseline preservation transfer PRs differ from target execution plan")

    except (OSError, StopIteration, ValueError, yaml.YAMLError) as error:
        print(f"ASA R0 baseline preservation FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA R0 baseline preservation PASS")
    print(f"- accepted main tables: {len(EXPECTED_MAIN_TABLES)}")
    print(f"- conditional project tables: {len(EXPECTED_PROJECT_TABLES)}")
    print(f"- transfer candidates: {len(EXPECTED_TRANSFER_PRS)}")
    print("- actual PR34 document columns: verified")
    print("- database digest column assumed: false")
    print("- destructive migration allowed: false")
    print("- R1 allowed during R0B: false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
