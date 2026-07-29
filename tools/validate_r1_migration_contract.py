#!/usr/bin/env python3
"""Validate the inactive additive R1 Account/Workspace migration contract."""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "docs/architecture/R1_ACCOUNT_WORKSPACE_MIGRATION_CONTRACT.yaml"
EXECUTION_PATH = ROOT / "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml"
EXPECTED_ENTITIES = {
    "principals",
    "accounts",
    "profiles",
    "workspaces",
    "workspace_memberships",
    "capability_grants",
    "sessions_v2",
    "legacy_user_account_links",
}
EXPECTED_STAGES = [f"MIG-ID-{index:02d}" for index in range(9)]
R1_REQUIRED_STAGES = {f"MIG-ID-{index:02d}" for index in range(7)}
EXPECTED_BASELINE_TABLES = {
    "tenants",
    "schools",
    "academic_periods",
    "users",
    "sessions",
    "classrooms",
    "classroom_memberships",
    "projects",
    "project_drafts",
    "project_versions",
    "audit_events",
}
EXPECTED_PRESERVE_VALUES = {
    "users.password_hash",
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
EXPECTED_FINGERPRINTS = {
    "project_drafts_document_json_canonical_sha256",
    "project_versions_document_json_canonical_sha256",
}
EXPECTED_SCHEMA_BINDING = {
    "project_document_column": "document_json",
    "project_version_number_column": "version_no",
    "persisted_project_version_digest_column": None,
    "digest_rule": "compare canonical SHA-256 externally until an additive digest column is introduced by an approved release",
}
EXPECTED_FORBIDDEN = {
    "rename_users_to_accounts",
    "drop_users",
    "drop_sessions",
    "disable_rls",
    "reset_password_hashes",
    "regenerate_existing_project_ids",
    "make_client_tenant_or_workspace_authoritative",
    "destructive_cleanup_in_r1",
}
EXPECTED_API = {
    "POST /api/auth/register",
    "POST /api/auth/login",
    "POST /api/auth/logout",
    "GET /api/auth/me",
    "GET /api/workspaces",
    "POST /api/session/context",
    "POST /api/capabilities/educator/self-attest",
    "GET /api/account/profile",
    "PATCH /api/account/profile",
    "GET /api/account/sessions",
    "DELETE /api/account/sessions/:id",
    "POST /api/account/sessions/revoke-all",
}
EXPECTED_NEGATIVES = {
    "account_cannot_activate_unknown_workspace",
    "member_cannot_activate_suspended_workspace",
    "client_tenant_override_rejected",
    "personal_workspace_invisible_to_other_account",
    "school_admin_does_not_gain_platform_admin",
    "legacy_user_cannot_map_cross_tenant",
    "studentseat_session_denied_account_only_endpoints",
    "creator_without_educator_denied_classes",
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
        execution = load(EXECUTION_PATH)

        if contract.get("schema_version") != "1.0.0":
            fail("R1 migration contract schema_version must be 1.0.0")
        if contract.get("contract_id") != "asa-r1-account-workspace-migration":
            fail("unexpected R1 migration contract_id")
        if contract.get("status") != "inactive_until_r0d_r1_ready":
            fail("R1 migration contract must remain inactive until R0D")
        if contract.get("release") != "R1":
            fail("R1 migration contract release must be R1")
        if contract.get("issue") != "https://github.com/spikeal8-maker/asa-lab/issues/48":
            fail("R1 migration contract must reference Issue 48")
        if contract.get("source_plan") != "docs/architecture/ASA_IDENTITY_WORKSPACE_TRANSITION_PLAN.md":
            fail("R1 migration contract must reference the identity transition plan")
        if contract.get("source_execution") != "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml":
            fail("R1 migration contract must reference the target execution plan")

        baseline = contract.get("baseline_preservation")
        if not isinstance(baseline, dict):
            fail("baseline_preservation must be an object")
        if string_set(baseline.get("required_tables"), "baseline.required_tables") != EXPECTED_BASELINE_TABLES:
            fail("baseline required_tables do not match the accepted product data")
        if string_set(baseline.get("forbidden_operations"), "baseline.forbidden_operations") != EXPECTED_FORBIDDEN:
            fail("baseline forbidden_operations are incomplete or contain additions")
        string_set(baseline.get("immutable_identifiers"), "baseline.immutable_identifiers")
        if string_set(baseline.get("preserve_values"), "baseline.preserve_values") != EXPECTED_PRESERVE_VALUES:
            fail("baseline preserve_values do not match the actual Project schema")
        if string_set(baseline.get("computed_fingerprints"), "baseline.computed_fingerprints") != EXPECTED_FINGERPRINTS:
            fail("baseline computed_fingerprints must cover draft and version document_json")
        schema_binding = baseline.get("schema_binding")
        if schema_binding != EXPECTED_SCHEMA_BINDING:
            fail(f"baseline schema_binding must be {EXPECTED_SCHEMA_BINDING}, got {schema_binding!r}")

        entities = contract.get("entities")
        if not isinstance(entities, dict) or set(entities) != EXPECTED_ENTITIES:
            fail("R1 entity set is incomplete or contains unapproved additions")
        for entity_name, entity in entities.items():
            if not isinstance(entity, dict):
                fail(f"entity {entity_name} must be an object")
            invariants = string_set(entity.get("invariants"), f"entities.{entity_name}.invariants")
            if not invariants:
                fail(f"entity {entity_name} must define invariants")

        for required_marker in (
            "account_has_exactly_one_account_principal",
            "studentseat_has_distinct_studentseat_principal",
            "exactly_one_personal_workspace_per_account",
            "workspace_is_product_scope_tenant_is_security_boundary",
            "school_admin_is_scoped_not_global",
            "educator_is_explicit_audited_and_revocable",
            "account_and_studentseat_session_types_remain_distinct",
            "one_legacy_user_maps_to_one_account",
        ):
            if not any(
                required_marker in (entity.get("invariants") or [])
                for entity in entities.values()
            ):
                fail(f"R1 entity invariants miss: {required_marker}")

        raw_stages = contract.get("stages")
        if not isinstance(raw_stages, list):
            fail("R1 stages must be a list")
        stages = [stage for stage in raw_stages if isinstance(stage, dict)]
        if len(stages) != len(raw_stages):
            fail("every R1 migration stage must be an object")
        stage_ids = [stage.get("id") for stage in stages]
        if stage_ids != EXPECTED_STAGES:
            fail(f"R1 stage order must be {EXPECTED_STAGES}, got {stage_ids}")

        required_stage_ids = {
            stage["id"] for stage in stages if stage.get("r1_required") is True
        }
        if required_stage_ids != R1_REQUIRED_STAGES:
            fail(
                f"R1 required stages must be {sorted(R1_REQUIRED_STAGES)}, "
                f"got {sorted(required_stage_ids)}"
            )
        stage_by_id = {stage["id"]: stage for stage in stages}
        for stage in stages:
            stage_id = stage["id"]
            operations = string_set(stage.get("operations"), f"{stage_id}.operations")
            if not operations:
                fail(f"{stage_id} has no operations")
            if stage_id in {"MIG-ID-07", "MIG-ID-08"} and stage.get("r1_required") is not False:
                fail(f"{stage_id} must not be required during R1")
        if "record_canonical_project_document_fingerprints" not in set(
            stage_by_id["MIG-ID-00"].get("operations") or []
        ):
            fail("MIG-ID-00 must record canonical Project document fingerprints")

        stage08 = stages[-1]
        if stage08.get("destructive") is not True or stage08.get("forbidden_during_r1") is not True:
            fail("MIG-ID-08 must be destructive and forbidden during R1")
        string_set(stage08.get("earliest_after"), "MIG-ID-08.earliest_after")

        execution_r1 = next(
            (
                release
                for release in execution.get("releases") or []
                if isinstance(release, dict) and release.get("id") == "R1"
            ),
            None,
        )
        if not isinstance(execution_r1, dict):
            fail("target execution plan misses R1")
        if set(execution_r1.get("migrations") or []) != {
            f"MIG-ID-{index:02d}" for index in range(1, 7)
        }:
            fail("target execution R1 migrations must be MIG-ID-01 through MIG-ID-06")

        api_contract = contract.get("api_contract")
        if not isinstance(api_contract, dict):
            fail("api_contract must be an object")
        if string_set(api_contract.get("primary"), "api_contract.primary") != EXPECTED_API:
            fail("R1 primary API set is incomplete or contains additions")
        compatibility = string_set(
            api_contract.get("compatibility"), "api_contract.compatibility"
        )
        if compatibility != {"POST /api/auth/login-legacy-workspace"}:
            fail("R1 compatibility API must contain only the legacy workspace login endpoint")
        string_set(api_contract.get("context_resolution"), "api_contract.context_resolution")
        if string_set(api_contract.get("untrusted_client_fields"), "api_contract.untrusted_client_fields") != {
            "tenantId",
            "workspaceId",
            "role",
            "capability",
        }:
            fail("R1 untrusted client fields are incomplete")

        security = contract.get("security_contract")
        if not isinstance(security, dict):
            fail("security_contract must be an object")
        if security.get("global_identity_tables_direct_runtime_grants") != "forbidden":
            fail("global identity tables must forbid direct runtime grants")
        if string_set(security.get("negative_tests"), "security.negative_tests") != EXPECTED_NEGATIVES:
            fail("R1 security negative test set is incomplete")
        string_set(security.get("tenant_owned_tables_require"), "security.tenant_owned_tables_require")

        tests = contract.get("required_test_groups")
        if not isinstance(tests, dict) or set(tests) != {
            "migration",
            "identity",
            "compatibility",
            "authorization",
        }:
            fail("R1 required_test_groups are incomplete or contain additions")
        for group_name, values in tests.items():
            string_set(values, f"required_test_groups.{group_name}")

        rollback = contract.get("rollback_contract")
        if not isinstance(rollback, dict):
            fail("rollback_contract must be an object")
        if rollback.get("strategy") != "disable_new_read_path_and_feature_flags_without_dropping_new_tables":
            fail("R1 rollback must disable new paths without destructive table removal")
        string_set(rollback.get("must_preserve"), "rollback.must_preserve")
        forbidden_rollback = string_set(rollback.get("forbidden"), "rollback.forbidden")
        if "rollback_by_disabling_rls" not in forbidden_rollback:
            fail("rollback contract must prohibit disabling RLS")

        candidates = contract.get("candidate_acceptance")
        if not isinstance(candidates, dict):
            fail("candidate_acceptance must be an object")
        selected_requirements = string_set(
            candidates.get("selected_candidate_must"),
            "candidate_acceptance.selected_candidate_must",
        )
        for required in (
            "include_sessions_v2",
            "include_exactly_one_personal_workspace_per_account",
            "bridge_existing_teacher",
            "exclude_class_code_and_studentseat_scope",
            "pass_empty_existing_repeat_migrations",
        ):
            if required not in selected_requirements:
                fail(f"selected candidate requirements miss: {required}")
        for candidate_name in ("candidate_a_pr59", "candidate_b_pr60"):
            candidate = candidates.get(candidate_name)
            if not isinstance(candidate, dict):
                fail(f"candidate_acceptance misses {candidate_name}")
            string_set(candidate.get("known_gap"), f"candidate_acceptance.{candidate_name}.known_gap")

    except (OSError, StopIteration, ValueError, yaml.YAMLError) as error:
        print(f"ASA R1 migration contract FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA R1 migration contract PASS")
    print(f"- entities: {len(EXPECTED_ENTITIES)}")
    print(f"- migration stages: {len(EXPECTED_STAGES)}")
    print(f"- R1 required stages: {len(R1_REQUIRED_STAGES)}")
    print("- actual Project document columns: verified")
    print("- persisted ProjectVersion digest assumed: false")
    print("- destructive stage allowed during R1: false")
    print("- selected R1 candidate requirements: explicit")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
