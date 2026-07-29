#!/usr/bin/env python3
"""Validate the inactive target test matrix for releases R0-R10."""

from __future__ import annotations

from pathlib import Path
import re
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
MATRIX_PATH = ROOT / "docs/testing/ASA_TARGET_TEST_MATRIX.yaml"
EXECUTION_PATH = ROOT / "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml"
ACTIVE_CATALOG_PATH = ROOT / "docs/testing/test-catalog.yaml"
EXPECTED_RELEASES = [f"R{index}" for index in range(11)]
EXPECTED_RESULT_STATES = {"PASS", "FAIL", "BLOCKED", "NOT_RUN"}
EXPECTED_PROFILES = {
    "governance_common",
    "code_common",
    "migration_common",
    "security_common",
    "browser_common",
    "owner_evidence",
}
EXPECTED_MIGRATION_RELEASES = {"R1", "R3", "R5", "R7", "R8", "R9"}
EXPECTED_RULES = {
    "do_not_modify_active_test_catalog_before_r0a",
    "r0a_registers_target_test_contracts_without_removing_existing_tests",
    "release_test_ids_are_frozen_before_product_code",
    "blocked_and_not_run_never_close_a_release",
    "owner_evidence_does_not_replace_automated_tests",
    "automated_tests_do_not_replace_owner_acceptance",
    "next_release_tests_do_not_run_as_current_scope",
}
TEST_ID_PATTERN = re.compile(r"^TST-[A-Z0-9][A-Z0-9-]*-\d{3}$")


def fail(message: str) -> None:
    raise ValueError(message)


def load(path: Path) -> dict[str, Any]:
    if not path.is_file():
        fail(f"missing {path.relative_to(ROOT)}")
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        fail(f"{path.relative_to(ROOT)} must contain a YAML object")
    return document


def string_list(value: Any, label: str, *, non_empty: bool = True) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        fail(f"{label} must be a string list")
    if non_empty and not value:
        fail(f"{label} must not be empty")
    if any(not item.strip() for item in value):
        fail(f"{label} contains an empty string")
    if len(set(value)) != len(value):
        fail(f"{label} contains duplicates")
    return value


def validate_test_ids(ids: list[str], label: str, seen: set[str]) -> None:
    for test_id in ids:
        if not TEST_ID_PATTERN.fullmatch(test_id):
            fail(f"{label} contains invalid test ID: {test_id}")
        if test_id in seen:
            fail(f"test ID appears more than once in target matrix: {test_id}")
        seen.add(test_id)


def active_catalog_ids(catalog: dict[str, Any]) -> set[str]:
    raw_tests = catalog.get("tests")
    if not isinstance(raw_tests, list):
        fail("active test catalog tests must be a list")
    return {
        item.get("id")
        for item in raw_tests
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }


def main() -> int:
    try:
        matrix = load(MATRIX_PATH)
        execution = load(EXECUTION_PATH)
        active_catalog = load(ACTIVE_CATALOG_PATH)

        if matrix.get("schema_version") != "1.0.0":
            fail("target test matrix schema_version must be 1.0.0")
        if matrix.get("matrix_id") != "asa-target-platform-r0-r10-tests":
            fail("unexpected target test matrix id")
        if matrix.get("status") != "inactive_until_r0a_contract_activation":
            fail("target test matrix must remain inactive before R0A")
        if matrix.get("source_execution_plan") != "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml":
            fail("target test matrix must reference the target execution plan")
        if matrix.get("source_blueprint") != "docs/product/ASA_TARGET_PLATFORM_BLUEPRINT.yaml":
            fail("target test matrix must reference the target blueprint")
        if matrix.get("activation_transition") != "R0A_CONTRACT_ACTIVATION":
            fail("target test matrix activation transition must be R0A_CONTRACT_ACTIVATION")

        result_states = matrix.get("result_states")
        if not isinstance(result_states, dict) or set(result_states) != EXPECTED_RESULT_STATES:
            fail("result_states must be exactly PASS, FAIL, BLOCKED and NOT_RUN")
        if any(not isinstance(value, str) or not value.strip() for value in result_states.values()):
            fail("every result state must have a description")

        raw_profiles = matrix.get("profiles")
        if not isinstance(raw_profiles, dict) or set(raw_profiles) != EXPECTED_PROFILES:
            fail("target test profiles are incomplete or contain unapproved additions")

        seen_test_ids: set[str] = set()
        profile_tests: dict[str, set[str]] = {}
        for profile_name, profile in raw_profiles.items():
            if not isinstance(profile, dict):
                fail(f"profile {profile_name} must be an object")
            tests = string_list(profile.get("tests"), f"profiles.{profile_name}.tests")
            validate_test_ids(tests, f"profiles.{profile_name}.tests", seen_test_ids)
            profile_tests[profile_name] = set(tests)

        owner_profile = raw_profiles["owner_evidence"]
        if owner_profile.get("owner_gate") is not True:
            fail("owner_evidence profile must declare owner_gate: true")
        for profile_name, profile in raw_profiles.items():
            if profile_name != "owner_evidence" and "owner_gate" in profile:
                fail(f"only owner_evidence may declare owner_gate: {profile_name}")

        raw_releases = matrix.get("releases")
        if not isinstance(raw_releases, list):
            fail("target test matrix releases must be a list")
        releases = [release for release in raw_releases if isinstance(release, dict)]
        if len(releases) != len(raw_releases):
            fail("every target test release must be an object")
        release_ids = [release.get("id") for release in releases]
        if release_ids != EXPECTED_RELEASES:
            fail(f"target test release order must be {EXPECTED_RELEASES}, got {release_ids}")
        if release_ids != execution.get("execution_order"):
            fail("target test release order differs from target execution order")

        release_specific_ids: set[str] = set()
        for release in releases:
            release_id = release["id"]
            required_profiles = string_list(
                release.get("required_profiles"), f"{release_id}.required_profiles"
            )
            unknown_profiles = sorted(set(required_profiles) - EXPECTED_PROFILES)
            if unknown_profiles:
                fail(f"{release_id} references unknown profiles: {unknown_profiles}")

            if release_id == "R0":
                if required_profiles != ["governance_common"]:
                    fail("R0 must use only governance_common")
            else:
                required = {"code_common", "security_common", "browser_common", "owner_evidence"}
                missing = sorted(required - set(required_profiles))
                if missing:
                    fail(f"{release_id} misses required profiles: {missing}")
                migration_present = "migration_common" in required_profiles
                if (release_id in EXPECTED_MIGRATION_RELEASES) != migration_present:
                    fail(
                        f"{release_id} migration_common profile mismatch; "
                        f"expected={release_id in EXPECTED_MIGRATION_RELEASES}"
                    )
                if "governance_common" in required_profiles:
                    fail(f"{release_id} must not run R0 governance_common as product scope")

            release_tests = string_list(
                release.get("release_tests"), f"{release_id}.release_tests"
            )
            expected_prefix = f"TST-{release_id}-"
            if any(not test_id.startswith(expected_prefix) for test_id in release_tests):
                fail(f"every {release_id} release test must start with {expected_prefix}")
            validate_test_ids(release_tests, f"{release_id}.release_tests", seen_test_ids)
            release_specific_ids.update(release_tests)

            artifacts = string_list(
                release.get("required_artifacts"), f"{release_id}.required_artifacts"
            )
            if any(".." in artifact or artifact.startswith("/") for artifact in artifacts):
                fail(f"{release_id}.required_artifacts contains an unsafe path")
            owner_flow = release.get("owner_flow")
            if not isinstance(owner_flow, str) or not owner_flow.strip():
                fail(f"{release_id} must define owner_flow")

        active_ids = active_catalog_ids(active_catalog)
        leaked = sorted(release_specific_ids & active_ids)
        if leaked:
            fail(
                "inactive target release test IDs leaked into active v1 test catalog: "
                + ", ".join(leaked)
            )

        rules = set(matrix.get("activation_rules") or [])
        if rules != EXPECTED_RULES:
            fail("target test activation_rules are incomplete or contain unapproved additions")

        all_profile_ids = set().union(*profile_tests.values())
        if not all_profile_ids:
            fail("target test profiles unexpectedly contain no test IDs")

    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"ASA target test matrix FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA target test matrix PASS")
    print(f"- releases: {len(EXPECTED_RELEASES)}")
    print(f"- profiles: {len(EXPECTED_PROFILES)}")
    print(f"- unique target test IDs: {len(seen_test_ids)}")
    print("- target release IDs active in v1 catalog: 0")
    print("- next release tests executable before R0A: false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
