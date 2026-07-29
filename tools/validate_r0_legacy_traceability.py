#!/usr/bin/env python3
"""Validate that every legacy v1 task is superseded without losing requirements."""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
TRACE_PATH = ROOT / "docs/delivery/R0_LEGACY_TRACEABILITY.yaml"
EXECUTION_PATH = ROOT / "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml"

EXPECTED_LEGACY: dict[str, tuple[int, set[str]]] = {
    "TASK-PROJECT-SHELL-001": (24, {"R3"}),
    "TASK-CHECKERS-LITE-001": (25, {"R3", "R10"}),
    "TASK-ELECTRONICS-ALPHA-001": (26, {"R3", "R4"}),
    "TASK-SEAT-001": (7, {"R1", "R3", "R5"}),
    "TASK-ACT-001": (8, {"R3", "R5", "R6", "R9"}),
    "TASK-REVIEW-001": (20, {"R6", "R9"}),
    "TASK-ELEC-001": (6, {"R4", "R5", "R6", "R9", "R10"}),
}
EXPECTED_EVIDENCE_ISSUES = {44, 46, 49, 50, 52, 61}
EXPECTED_RULES = {
    "legacy_issue_remains_open_for_traceability",
    "legacy_issue_never_becomes_current_release",
    "no_branch_or_pr_created_from_superseded_task",
    "preserved_requirement_must_exist_in_at_least_one_replacement_release",
    "evidence_issue_never_unlocks_a_release",
    "replacements_follow_target_execution_dependencies",
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


def issue_number(url: Any) -> int:
    prefix = "https://github.com/spikeal8-maker/asa-lab/issues/"
    if not isinstance(url, str) or not url.startswith(prefix):
        fail(f"invalid Issue URL: {url!r}")
    suffix = url.removeprefix(prefix)
    if not suffix.isdigit():
        fail(f"Issue URL does not end with an integer: {url}")
    return int(suffix)


def main() -> int:
    try:
        trace = load(TRACE_PATH)
        execution = load(EXECUTION_PATH)

        if trace.get("schema_version") != "1.0.0":
            fail("traceability schema_version must be 1.0.0")
        if trace.get("traceability_id") != "asa-r0-legacy-v1-to-r0-r10":
            fail("unexpected traceability_id")
        if trace.get("status") != "active_during_r0":
            fail("legacy traceability must remain active during R0")
        if trace.get("source_execution_plan") != "docs/delivery/ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml":
            fail("legacy traceability must reference the target execution plan")

        release_ids = {
            release.get("id")
            for release in execution.get("releases") or []
            if isinstance(release, dict) and isinstance(release.get("id"), str)
        }

        raw_items = trace.get("legacy_items")
        if not isinstance(raw_items, list):
            fail("legacy_items must be a list")
        items: dict[str, dict[str, Any]] = {}
        for entry in raw_items:
            if not isinstance(entry, dict) or not isinstance(entry.get("task_id"), str):
                fail("every legacy item must be an object with task_id")
            task_id = entry["task_id"]
            if task_id in items:
                fail(f"duplicate legacy task: {task_id}")
            items[task_id] = entry
        if set(items) != set(EXPECTED_LEGACY):
            fail("legacy task set does not match the v1 tasks superseded by R0-R10")

        issue_numbers: set[int] = set()
        for task_id, (expected_issue, expected_replacements) in EXPECTED_LEGACY.items():
            item = items[task_id]
            actual_issue = issue_number(item.get("issue"))
            if actual_issue != expected_issue:
                fail(f"{task_id} must reference Issue {expected_issue}, got {actual_issue}")
            if actual_issue in issue_numbers:
                fail(f"legacy Issue {actual_issue} is mapped twice")
            issue_numbers.add(actual_issue)
            if item.get("status") != "superseded":
                fail(f"{task_id}.status must be superseded")
            replacements = set(item.get("replacements") or [])
            if replacements != expected_replacements:
                fail(
                    f"{task_id}.replacements must be {sorted(expected_replacements)}, "
                    f"got {sorted(replacements)}"
                )
            unknown = sorted(replacements - release_ids)
            if unknown:
                fail(f"{task_id} references unknown releases: {unknown}")
            requirements = item.get("preserved_requirements")
            if not isinstance(requirements, list) or not requirements or not all(
                isinstance(value, str) and value.strip() for value in requirements
            ):
                fail(f"{task_id}.preserved_requirements must be a non-empty string list")
            if len(set(requirements)) != len(requirements):
                fail(f"{task_id}.preserved_requirements contains duplicates")

        raw_evidence = trace.get("non_executable_evidence_issues")
        if not isinstance(raw_evidence, list):
            fail("non_executable_evidence_issues must be a list")
        evidence_numbers: set[int] = set()
        roles: set[str] = set()
        for entry in raw_evidence:
            if not isinstance(entry, dict):
                fail("every evidence entry must be an object")
            number = issue_number(entry.get("issue"))
            role = entry.get("role")
            if number in evidence_numbers:
                fail(f"evidence Issue {number} is duplicated")
            if not isinstance(role, str) or not role.strip():
                fail(f"evidence Issue {number} must define a role")
            if role in roles:
                fail(f"evidence role is duplicated: {role}")
            evidence_numbers.add(number)
            roles.add(role)
        if evidence_numbers != EXPECTED_EVIDENCE_ISSUES:
            fail(
                f"evidence Issue set must be {sorted(EXPECTED_EVIDENCE_ISSUES)}, "
                f"got {sorted(evidence_numbers)}"
            )
        if issue_numbers & evidence_numbers:
            fail("legacy executable Issues and evidence-only Issues must not overlap")

        rules = set(trace.get("rules") or [])
        if rules != EXPECTED_RULES:
            fail("legacy traceability rules are incomplete or contain unapproved additions")

    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"ASA R0 legacy traceability FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA R0 legacy traceability PASS")
    print(f"- superseded v1 tasks: {len(EXPECTED_LEGACY)}")
    print(f"- non-executable evidence Issues: {len(EXPECTED_EVIDENCE_ISSUES)}")
    print("- unresolved legacy task branches allowed: 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
