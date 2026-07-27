#!/usr/bin/env python3
"""Validate ASA Lab's Tinkercad parity and target-platform contracts.

This validator is intentionally product-facing: coding agents must not silently
remove capabilities, reference unknown dependencies, introduce undocumented
deviations, or bypass the non-destructive identity/workspace transition plan.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
MATRIX_PATH = ROOT / "docs/product/TINKERCAD_PARITY_MATRIX.yaml"
SPEC_PATH = ROOT / "docs/product/TINKERCAD_PARITY_SPEC.md"
PROGRAM_PATH = ROOT / "docs/delivery/TINKERCAD_PARITY_PROGRAM.md"
DEVIATIONS_PATH = ROOT / "docs/product/TINKERCAD_PARITY_DEVIATIONS.yaml"
TARGET_BLUEPRINT_PATH = ROOT / "docs/product/ASA_TARGET_PLATFORM_BLUEPRINT.md"
TARGET_MATRIX_PATH = ROOT / "docs/product/ASA_TARGET_PLATFORM_BLUEPRINT.yaml"
TRANSITION_PLAN_PATH = ROOT / "docs/architecture/ASA_IDENTITY_WORKSPACE_TRANSITION_PLAN.md"


def fail(message: str) -> None:
    raise ValueError(message)


def load_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        fail(f"missing required file: {path.relative_to(ROOT)}")
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        fail(f"{path.relative_to(ROOT)} must contain a YAML object")
    return data


def require_text(path: Path, markers: list[str]) -> None:
    if not path.is_file():
        fail(f"missing required file: {path.relative_to(ROOT)}")
    text = path.read_text(encoding="utf-8")
    for marker in markers:
        if marker not in text:
            fail(f"{path.relative_to(ROOT)} misses required marker: {marker}")


def validate_matrix(matrix: dict[str, Any]) -> tuple[int, int, int]:
    statuses = matrix.get("status_definitions")
    if not isinstance(statuses, dict) or not statuses:
        fail("matrix.status_definitions must be a non-empty object")

    capabilities = matrix.get("capabilities")
    if not isinstance(capabilities, list) or not capabilities:
        fail("matrix.capabilities must be a non-empty list")

    capability_ids = [item.get("id") for item in capabilities if isinstance(item, dict)]
    if len(capability_ids) != len(capabilities) or any(not isinstance(item, str) for item in capability_ids):
        fail("every capability must have a string id")
    duplicates = [item for item, count in Counter(capability_ids).items() if count > 1]
    if duplicates:
        fail(f"duplicate capability ids: {duplicates}")
    known_capabilities = set(capability_ids)

    releases = matrix.get("releases")
    if not isinstance(releases, list) or not releases:
        fail("matrix.releases must be a non-empty list")
    release_ids = [item.get("id") for item in releases if isinstance(item, dict)]
    if len(release_ids) != len(releases) or any(not isinstance(item, str) for item in release_ids):
        fail("every release must have a string id")
    if len(set(release_ids)) != len(release_ids):
        fail("release ids must be unique")
    known_releases = set(release_ids)

    required_capabilities = {
        "PARITY-PROJECT-HUB",
        "PARITY-MODULE-CHOOSER",
        "PARITY-EDITOR-SHELL",
        "PARITY-VISIBILITY",
        "PARITY-SHARE-LINK",
        "PARITY-PUBLISH",
        "PARITY-PUBLIC-PAGE",
        "PARITY-REMIX",
        "PARITY-PROFILE",
        "PARITY-EXPLORE",
        "PARITY-PUBLIC-COMMENTS",
        "PARITY-CLASSROOM",
        "PARITY-STUDENT-SEAT",
        "PARITY-STUDENT-WORK",
        "PARITY-SAFE-MODE",
        "PARITY-ASSIGNMENT",
        "PARITY-SUBMISSION",
        "PARITY-EDU-COMMENTS",
        "PARITY-REVIEW",
        "PARITY-GRADE",
        "PARITY-BADGE",
        "PARITY-MODULE-CONTRACT",
    }
    missing_required = sorted(required_capabilities - known_capabilities)
    if missing_required:
        fail(f"matrix misses mandatory parity capabilities: {missing_required}")

    for capability in capabilities:
        if not isinstance(capability, dict):
            fail("capability entries must be objects")
        capability_id = capability["id"]
        if capability.get("status") not in statuses:
            fail(f"{capability_id}: unknown status {capability.get('status')!r}")
        if capability.get("target_release") not in known_releases:
            fail(f"{capability_id}: unknown target_release {capability.get('target_release')!r}")
        dependencies = capability.get("depends_on")
        if not isinstance(dependencies, list):
            fail(f"{capability_id}: depends_on must be a list")
        unknown = sorted(set(dependencies) - known_capabilities)
        if unknown:
            fail(f"{capability_id}: unknown dependencies {unknown}")
        if capability_id in dependencies:
            fail(f"{capability_id}: self-dependency is forbidden")
        for required_key in ("name", "gap", "gate", "current_evidence"):
            if required_key not in capability:
                fail(f"{capability_id}: missing {required_key}")

    surfaces = matrix.get("surfaces")
    if not isinstance(surfaces, list) or not surfaces:
        fail("matrix.surfaces must be a non-empty list")
    surface_ids: list[str] = []
    for surface in surfaces:
        if not isinstance(surface, dict) or not isinstance(surface.get("id"), str):
            fail("every surface must be an object with a string id")
        surface_ids.append(surface["id"])
        referenced = surface.get("capabilities")
        if not isinstance(referenced, list):
            fail(f"{surface['id']}: capabilities must be a list")
        unknown = sorted(set(referenced) - known_capabilities)
        if unknown:
            fail(f"{surface['id']}: unknown capabilities {unknown}")
    if len(set(surface_ids)) != len(surface_ids):
        fail("surface ids must be unique")

    for release in releases:
        referenced = release.get("capabilities")
        if not isinstance(referenced, list):
            fail(f"{release['id']}: capabilities must be a list")
        unknown = sorted(set(referenced) - known_capabilities)
        if unknown:
            fail(f"{release['id']}: unknown capabilities {unknown}")
        if not isinstance(release.get("gate"), str) or not release["gate"].strip():
            fail(f"{release['id']}: non-empty gate is required")

    return len(capabilities), len(surfaces), len(releases)


def validate_deviations(data: dict[str, Any]) -> tuple[int, int]:
    allowed_reasons = data.get("allowed_reasons")
    decisions = data.get("decisions")
    pending = data.get("pending")
    if not isinstance(allowed_reasons, list) or not all(isinstance(item, str) for item in allowed_reasons):
        fail("deviation register allowed_reasons must be a string list")
    if not isinstance(decisions, list) or not isinstance(pending, list):
        fail("deviation register decisions and pending must be lists")

    all_items = [*decisions, *pending]
    ids: list[str] = []
    for item in all_items:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            fail("every deviation must have a string id")
        ids.append(item["id"])
        if item.get("reason") not in allowed_reasons:
            fail(f"{item['id']}: reason {item.get('reason')!r} is not allowed")
        for key in ("surface", "reference_behavior", "asa_behavior", "owner_decision", "target_release", "test"):
            if not isinstance(item.get(key), str) or not item[key].strip():
                fail(f"{item['id']}: non-empty {key} is required")
    if len(set(ids)) != len(ids):
        fail("deviation ids must be unique")
    return len(decisions), len(pending)


def _ids(items: Any, label: str) -> list[str]:
    if not isinstance(items, list) or not items:
        fail(f"target blueprint {label} must be a non-empty list")
    result: list[str] = []
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            fail(f"target blueprint {label} entries must have string ids")
        result.append(item["id"])
    if len(result) != len(set(result)):
        fail(f"target blueprint {label} ids must be unique")
    return result


def validate_target_blueprint(data: dict[str, Any]) -> tuple[int, int, int, int]:
    if data.get("status") != "normative":
        fail("target blueprint status must be normative")
    if data.get("supersedes_conflicting_assumptions") is not True:
        fail("target blueprint must supersede conflicting assumptions")

    sources = data.get("sources")
    if not isinstance(sources, list) or not all(isinstance(item, str) for item in sources):
        fail("target blueprint sources must be a string list")
    for source in sources:
        if not (ROOT / source).is_file():
            fail(f"target blueprint references missing source: {source}")

    principal_ids = set(_ids(data.get("principals"), "principals"))
    required_principals = {"account", "student_seat", "service"}
    missing = sorted(required_principals - principal_ids)
    if missing:
        fail(f"target blueprint misses principals: {missing}")

    workspace_items = data.get("workspace_kinds")
    workspace_ids = set(_ids(workspace_items, "workspace_kinds"))
    if workspace_ids != {"personal", "organization"}:
        fail("target blueprint workspace kinds must be personal and organization")
    personal = next(item for item in workspace_items if item["id"] == "personal")
    if personal.get("exactly_one_per_account") is not True or personal.get("backed_by_tenant") is not True:
        fail("personal workspace must be exactly one per account and backed by tenant")

    capabilities = data.get("capabilities")
    if not isinstance(capabilities, dict):
        fail("target blueprint capabilities must be an object")
    required_global = {"creator", "educator", "registered_student", "guardian", "platform_admin"}
    required_scoped = {"owner", "educator", "school_admin"}
    global_caps = set(capabilities.get("global", []))
    scoped_roles = set(capabilities.get("workspace_roles", []))
    if missing := sorted(required_global - global_caps):
        fail(f"target blueprint misses global capabilities: {missing}")
    if missing := sorted(required_scoped - scoped_roles):
        fail(f"target blueprint misses workspace roles: {missing}")
    if "school_admin" in global_caps:
        fail("school_admin must be scoped, not global")

    policies = data.get("policies")
    if not isinstance(policies, dict):
        fail("target blueprint policies must be an object")
    if policies.get("educator_self_attestation_min_age") != 18:
        fail("educator self-attestation minimum age must be 18")
    if policies.get("educator_age_policy_source") != "server":
        fail("educator age policy must be server-derived")
    if policies.get("public_project_default_visibility") != "private":
        fail("new projects must be private by default")
    if policies.get("student_seat_pin_default") != "off":
        fail("StudentSeat PIN must default to off in parity v1")

    invariants = set(data.get("project_invariants", []))
    required_invariants = {
        "personal_project_does_not_require_classroom",
        "project_owner_is_principal",
        "project_version_is_immutable",
        "publish_references_project_version",
        "assignment_work_is_never_public_automatically",
        "core_has_no_subject_switches",
    }
    if missing := sorted(required_invariants - invariants):
        fail(f"target blueprint misses project invariants: {missing}")

    migration_items = data.get("migration_stages")
    migration_ids = _ids(migration_items, "migration_stages")
    known_migrations = set(migration_ids)
    for stage in migration_items:
        dependencies = stage.get("depends_on")
        if not isinstance(dependencies, list):
            fail(f"{stage['id']}: depends_on must be a list")
        unknown = sorted(set(dependencies) - known_migrations)
        if unknown:
            fail(f"{stage['id']}: unknown migration dependencies {unknown}")
        if stage["id"] in dependencies:
            fail(f"{stage['id']}: self-dependency is forbidden")
        if stage.get("destructive") and stage["id"] != "MIG-ID-08":
            fail(f"{stage['id']}: destructive migration is forbidden before MIG-ID-08")
    destructive = next((item for item in migration_items if item["id"] == "MIG-ID-08"), None)
    if not destructive or destructive.get("owner_approval_required") is not True:
        fail("MIG-ID-08 must require owner approval")
    if int(destructive.get("minimum_stable_release_gates", 0)) < 2:
        fail("MIG-ID-08 requires at least two stable release gates")

    release_items = data.get("releases")
    release_ids = _ids(release_items, "releases")
    known_releases = set(release_ids)
    for release in release_items:
        dependencies = release.get("depends_on")
        if not isinstance(dependencies, list):
            fail(f"{release['id']}: depends_on must be a list")
        unknown = sorted(set(dependencies) - known_releases)
        if unknown:
            fail(f"{release['id']}: unknown release dependencies {unknown}")
        if release.get("owner_review") is not True:
            fail(f"{release['id']}: owner_review must be true")

    forbidden = set(data.get("forbidden_shortcuts", []))
    required_forbidden = {
        "rename_tenant_users_to_accounts_in_place",
        "destructive_identity_migration_before_cutover",
        "disable_rls_for_migration",
        "trust_client_role",
        "trust_client_tenant_or_workspace",
        "require_classroom_for_personal_project",
        "merge_account_and_studentseat",
        "merge_global_capability_and_scoped_role",
        "shared_undifferentiated_account_seat_sessions",
        "mutable_published_version",
        "subject_switch_in_platform_core",
        "second_unrelated_audit_log",
        "visual_acceptance_from_test_count_only",
    }
    if missing := sorted(required_forbidden - forbidden):
        fail(f"target blueprint misses forbidden shortcuts: {missing}")

    return len(principal_ids), len(workspace_ids), len(migration_ids), len(release_ids)


def main() -> int:
    try:
        require_text(
            SPEC_PATH,
            [
                "## 6. Видимость, ссылки и публикация",
                "## 7. Публичная страница проекта",
                "## 9. Галерея / Explore",
                "## 11. Classroom parity",
                "## 12. Задания и стартовые проекты",
                "## 14. Module Platform parity",
                "## 22. Parity Deviation Register",
            ],
        )
        require_text(
            PROGRAM_PATH,
            [
                "TASK-PARITY-100",
                "TASK-PARITY-200",
                "TASK-PARITY-300",
                "TASK-PARITY-400",
                "TASK-PARITY-500",
                "TASK-PARITY-600",
            ],
        )
        require_text(
            TARGET_BLUEPRINT_PATH,
            [
                "## 4. Principal model",
                "## 5. Capabilities, memberships и active context",
                "## 6. Workspace model и сохранение tenant isolation",
                "## 10. Universal Project and Module Platform",
                "## 11. Classroom target",
                "## 16. Неразрушающий переход",
                "## 18. Anti-regression rules for coding agents",
            ],
        )
        require_text(
            TRANSITION_PLAN_PATH,
            [
                "## 3. Запрещённые migration shortcuts",
                "## 5. Migration stages",
                "### MIG-ID-03 — backfill existing teacher",
                "## 7. RLS transition",
                "## 9. Rollback strategy",
                "## 13. Exit gate for identity cutover",
            ],
        )
        capability_count, surface_count, release_count = validate_matrix(load_yaml(MATRIX_PATH))
        decision_count, pending_count = validate_deviations(load_yaml(DEVIATIONS_PATH))
        principal_count, workspace_count, migration_count, target_release_count = validate_target_blueprint(
            load_yaml(TARGET_MATRIX_PATH)
        )
    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"Tinkercad parity contract FAIL: {error}", file=sys.stderr)
        return 1

    print(
        "Tinkercad parity contract PASS "
        f"(capabilities={capability_count}, surfaces={surface_count}, releases={release_count}, "
        f"acceptedDeviations={decision_count}, pendingDeviations={pending_count}, "
        f"principals={principal_count}, workspaces={workspace_count}, "
        f"migrationStages={migration_count}, targetReleases={target_release_count})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
