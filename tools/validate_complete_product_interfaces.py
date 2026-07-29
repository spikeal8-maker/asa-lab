#!/usr/bin/env python3
"""Validate the complete ASA Lab surface and functional-parity contracts."""

from __future__ import annotations

from pathlib import Path
import re
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
SURFACES_PATH = ROOT / "docs/product/ASA_PRODUCT_SURFACE_CATALOG.yaml"
SCOPE_PATH = ROOT / "docs/product/ASA_TINKERCAD_100_PERCENT_SCOPE.yaml"
ELECTRONICS_PATH = ROOT / "docs/product/ASA_ELECTRONICS_TOOL_CATALOG.yaml"
INTERFACE_DOC = ROOT / "docs/product/ASA_COMPLETE_INTERFACE_BLUEPRINT.md"
ELECTRONICS_DOC = ROOT / "docs/product/ASA_ELECTRONICS_WORKBENCH_COMPLETE_SPEC.md"
ADMIN_DOC = ROOT / "docs/product/ASA_ADMIN_CONSOLE_SPEC.md"
STUDENT_DOC = ROOT / "docs/product/ASA_STUDENT_EXPERIENCE_SPEC.md"
VIEWER_PATH = ROOT / "docs/product/interface-catalog.html"

EXPECTED_RELEASES = {f"R{index}" for index in range(1, 11)}
EXPECTED_ACTORS = {
    "anonymous",
    "account_creator",
    "educator",
    "registered_student",
    "student_seat",
    "guardian",
    "co_teacher",
    "school_admin",
    "moderator",
    "platform_admin",
    "support_operator",
}
EXPECTED_TEMPLATES = {"PUBLIC", "PORTAL", "CLASSROOM", "STUDENT", "EDITOR_HOST", "ADMIN", "PUBLICATION"}
EXPECTED_UI_STATES = {
    "loading",
    "empty",
    "populated",
    "validation_error",
    "authorization_denied",
    "server_error",
    "offline_or_reconnecting",
    "success_feedback",
}
EXPECTED_SURFACE_PREFIXES = {"PUB", "CRT", "EDU", "STU", "EDT", "SADM", "PADM"}
EXPECTED_SURFACE_IDS = {
    "PUB-002", "PUB-004", "PUB-005", "PUB-007", "PUB-009",
    "CRT-001", "CRT-002", "CRT-003", "CRT-008", "CRT-009", "CRT-010",
    "EDU-001", "EDU-004", "EDU-005", "EDU-006", "EDU-007", "EDU-008",
    "EDU-011", "EDU-012", "EDU-013", "EDU-014", "EDU-015", "EDU-017", "EDU-018", "EDU-019", "EDU-020",
    "STU-001", "STU-003", "STU-004", "STU-005", "STU-006", "STU-007", "STU-008", "STU-009", "STU-010",
    "EDT-001", "EDT-002", "EDT-003", "EDT-004", "EDT-005",
    "SADM-001", "SADM-003", "SADM-006", "SADM-007", "SADM-008", "SADM-009", "SADM-010",
    "PADM-001", "PADM-002", "PADM-004", "PADM-005", "PADM-006", "PADM-007", "PADM-008", "PADM-009", "PADM-010", "PADM-011", "PADM-012", "PADM-013",
}
EXPECTED_ELECTRONICS_GROUPS = {
    "SHELL", "EDIT", "VIEW", "LIBRARY", "WIRING", "INSPECTOR", "SIMULATION-BASIC",
    "DIAGNOSTICS", "INSTRUMENTS", "CODE", "SERIAL", "PERSISTENCE", "CLASSROOM-CONTEXT",
    "PUBLIC-VIEWER", "ACCESSIBILITY", "EXPORT",
}
EXPECTED_ELECTRONICS_TOOLS = {
    "ELEC-SELECT", "ELEC-MULTISELECT", "ELEC-UNDO", "ELEC-REDO", "ELEC-PAN", "ELEC-FIT",
    "ELEC-LIBRARY-SEARCH", "ELEC-TERMINALS", "ELEC-WIRE-CREATE", "ELEC-WIRE-RECONNECT",
    "ELEC-WIRE-BEND", "ELEC-WIRE-COLOR", "ELEC-INSPECTOR-PROPERTIES", "ELEC-SIM-START",
    "ELEC-SIM-STOP", "ELEC-SIM-UNSUPPORTED", "ELEC-DIAG-NO-FAKE-SUCCESS", "ELEC-MULTIMETER",
    "ELEC-OSCILLOSCOPE", "ELEC-CODE-BLOCKS", "ELEC-CODE-TEXT", "ELEC-CODE-COMPILE",
    "ELEC-SERIAL-OPEN", "ELEC-AUTOSAVE", "ELEC-RELOAD", "ELEC-CHECKPOINT",
    "ELEC-ASSIGNMENT-BANNER", "ELEC-SUBMIT", "ELEC-TEACHER-VIEW", "ELEC-REVIEW-ANCHOR",
    "ELEC-PUBLIC-SIM", "ELEC-REMIX", "ELEC-A11Y-KEYBOARD", "ELEC-EXPORT-DOCUMENT",
}
EXPECTED_COMPONENT_FAMILIES = {
    "COMPONENT-BASIC", "COMPONENT-SEMICONDUCTOR", "COMPONENT-SENSORS", "COMPONENT-ACTUATORS",
    "COMPONENT-DISPLAYS", "COMPONENT-IC", "MICROCONTROLLER-ARDUINO",
    "MICROCONTROLLER-MICROBIT", "INSTRUMENT-COMPONENTS",
}
EXPECTED_PARITY_GROUPS = {
    "GROUP-PLATFORM", "GROUP-CLASSROOM", "GROUP-CIRCUITS", "GROUP-3D", "GROUP-CODEBLOCKS",
    "GROUP-SIMLAB", "GROUP-MOBILE-INTEGRATIONS",
}
SURFACE_ID = re.compile(r"^(PUB|CRT|EDU|STU|EDT|SADM|PADM)-\d{3}$")
TOOL_ID = re.compile(r"^ELEC-[A-Z0-9-]+$")
CAPABILITY_ID = re.compile(r"^[A-Z0-9]+(?:-[A-Z0-9]+)+$")


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
    if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
        fail(f"{label} must be a list of non-empty strings")
    if non_empty and not value:
        fail(f"{label} must not be empty")
    if len(set(value)) != len(value):
        fail(f"{label} contains duplicates")
    return value


def validate_surfaces(document: dict[str, Any]) -> tuple[int, int, int]:
    if document.get("schema_version") != "1.0.0":
        fail("surface catalog schema_version must be 1.0.0")
    if document.get("catalog_id") != "asa-complete-product-surfaces":
        fail("unexpected surface catalog_id")
    if set(document.get("actors") or []) != EXPECTED_ACTORS:
        fail("surface actor set is incomplete or contains additions")
    if set(document.get("required_ui_states") or []) != EXPECTED_UI_STATES:
        fail("required UI state set is incomplete or contains additions")
    templates = document.get("layout_templates")
    if not isinstance(templates, dict) or set(templates) != EXPECTED_TEMPLATES:
        fail("layout template set is incomplete or contains additions")
    for name, template in templates.items():
        if not isinstance(template, dict):
            fail(f"layout template {name} must be an object")
        string_list(template.get("regions"), f"layout_templates.{name}.regions")

    raw_surfaces = document.get("surfaces")
    if not isinstance(raw_surfaces, list):
        fail("surfaces must be a list")
    if len(raw_surfaces) < 75:
        fail(f"complete surface catalog must contain at least 75 surfaces, got {len(raw_surfaces)}")
    ids: set[str] = set()
    routes: set[str] = set()
    admin_count = 0
    student_count = 0
    electronics_count = 0
    implementations = set(document.get("implementation_states") or [])
    for surface in raw_surfaces:
        if not isinstance(surface, dict):
            fail("every surface must be an object")
        surface_id = surface.get("id")
        if not isinstance(surface_id, str) or not SURFACE_ID.fullmatch(surface_id):
            fail(f"invalid surface id: {surface_id!r}")
        if surface_id in ids:
            fail(f"duplicate surface id: {surface_id}")
        ids.add(surface_id)
        if surface_id.split("-", 1)[0] not in EXPECTED_SURFACE_PREFIXES:
            fail(f"unexpected surface prefix: {surface_id}")
        for field in ("name", "route", "release", "template", "implementation", "purpose"):
            if not isinstance(surface.get(field), str) or not surface[field].strip():
                fail(f"{surface_id}.{field} must be a non-empty string")
        route = surface["route"]
        if not route.startswith("/"):
            fail(f"{surface_id}.route must start with /")
        if route in routes:
            fail(f"duplicate exact route: {route}")
        routes.add(route)
        if surface["release"] not in EXPECTED_RELEASES:
            fail(f"{surface_id}.release is invalid: {surface['release']}")
        if surface["template"] not in EXPECTED_TEMPLATES:
            fail(f"{surface_id}.template is invalid")
        if surface["implementation"] not in implementations:
            fail(f"{surface_id}.implementation is invalid")
        actors = set(string_list(surface.get("actors"), f"{surface_id}.actors"))
        if not actors <= EXPECTED_ACTORS:
            fail(f"{surface_id}.actors contain unknown values: {sorted(actors - EXPECTED_ACTORS)}")
        string_list(surface.get("primary_actions"), f"{surface_id}.primary_actions")
        states = set(string_list(surface.get("required_states"), f"{surface_id}.required_states"))
        if not states <= EXPECTED_UI_STATES:
            fail(f"{surface_id}.required_states contain unknown values")
        if "loading" not in states or "server_error" not in states:
            fail(f"{surface_id} must include loading and server_error")
        string_list(surface.get("screenshot_ids"), f"{surface_id}.screenshot_ids")
        if surface_id.startswith(("SADM-", "PADM-")):
            admin_count += 1
            if surface["template"] != "ADMIN":
                fail(f"admin surface {surface_id} must use ADMIN template")
            if not actors & {"school_admin", "platform_admin", "moderator", "support_operator"}:
                fail(f"admin surface {surface_id} has no admin actor")
        if surface_id.startswith("STU-"):
            student_count += 1
            if not actors & {"student_seat", "registered_student"}:
                fail(f"student surface {surface_id} has no learner actor")
        if surface_id == "EDT-002":
            electronics_count += 1
            if surface["implementation"] not in {"partial", "in_review"}:
                fail("Electronics workbench must remain partial/in_review before full parity")

    missing = sorted(EXPECTED_SURFACE_IDS - ids)
    if missing:
        fail("surface catalog misses required interfaces: " + ", ".join(missing))
    if admin_count < 20:
        fail(f"admin surface coverage is too small: {admin_count}")
    if student_count < 10:
        fail(f"student surface coverage is too small: {student_count}")
    if electronics_count != 1:
        fail("surface catalog must contain exactly one shared Electronics workbench surface")
    return len(ids), admin_count, student_count


def validate_electronics(document: dict[str, Any]) -> tuple[int, int, int]:
    if document.get("schema_version") != "1.0.0":
        fail("electronics catalog schema_version must be 1.0.0")
    if document.get("catalog_id") != "asa-electronics-complete-tool-catalog":
        fail("unexpected electronics catalog_id")
    if document.get("module_key") != "electronics" or document.get("release") != "R4":
        fail("electronics catalog must target module electronics / release R4")
    groups = document.get("capability_groups")
    if not isinstance(groups, list):
        fail("electronics capability_groups must be a list")
    group_ids: set[str] = set()
    tool_ids: set[str] = set()
    evidence_required = 0
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get("id"), str):
            fail("every electronics capability group must have id")
        group_id = group["id"]
        if group_id in group_ids:
            fail(f"duplicate electronics group: {group_id}")
        group_ids.add(group_id)
        tools = group.get("tools")
        if not isinstance(tools, list) or not tools:
            fail(f"electronics group {group_id} has no tools")
        for tool in tools:
            if not isinstance(tool, dict):
                fail(f"electronics group {group_id} contains a non-object tool")
            tool_id = tool.get("id")
            if not isinstance(tool_id, str) or not TOOL_ID.fullmatch(tool_id):
                fail(f"invalid electronics tool id: {tool_id!r}")
            if tool_id in tool_ids:
                fail(f"duplicate electronics tool id: {tool_id}")
            tool_ids.add(tool_id)
            for field in ("name", "reference_status", "implementation"):
                if not isinstance(tool.get(field), str) or not tool[field].strip():
                    fail(f"{tool_id}.{field} must be a non-empty string")
            if tool["reference_status"] == "evidence_required":
                evidence_required += 1
    if set(group_ids) != EXPECTED_ELECTRONICS_GROUPS:
        fail("electronics capability group set is incomplete or contains additions")
    missing_tools = sorted(EXPECTED_ELECTRONICS_TOOLS - tool_ids)
    if missing_tools:
        fail("electronics catalog misses critical tools: " + ", ".join(missing_tools))
    if len(tool_ids) < 85:
        fail(f"electronics tool catalog must contain at least 85 tools, got {len(tool_ids)}")
    families = document.get("component_families")
    if not isinstance(families, list):
        fail("component_families must be a list")
    family_ids: set[str] = set()
    part_count = 0
    for family in families:
        if not isinstance(family, dict) or not isinstance(family.get("id"), str):
            fail("every component family must have id")
        family_id = family["id"]
        if family_id in family_ids:
            fail(f"duplicate component family: {family_id}")
        family_ids.add(family_id)
        if family.get("required_for_full_parity") is not True:
            fail(f"component family {family_id} must be required_for_full_parity")
        parts = string_list(family.get("parts"), f"component_families.{family_id}.parts")
        part_count += len(parts)
    if family_ids != EXPECTED_COMPONENT_FAMILIES:
        fail("component family set is incomplete or contains additions")
    if part_count < 55:
        fail(f"component catalog must enumerate at least 55 part targets, got {part_count}")
    required_capture = string_list(document.get("required_reference_capture"), "required_reference_capture")
    if len(required_capture) < 8:
        fail("electronics exact-reference capture list is incomplete")
    screenshots = string_list(document.get("required_screenshots"), "required_screenshots")
    if len(screenshots) < 15:
        fail("electronics screenshot set is incomplete")
    rules = set(string_list(document.get("parity_rules"), "parity_rules"))
    if "evidence_required_item_blocks_100_percent_claim" not in rules:
        fail("electronics parity rules must block 100% claim while evidence is unresolved")
    if evidence_required == 0:
        fail("electronics catalog must honestly retain evidence_required items")
    return len(tool_ids), part_count, evidence_required


def validate_scope(document: dict[str, Any]) -> tuple[int, int, int]:
    if document.get("schema_version") != "1.0.0":
        fail("100% scope schema_version must be 1.0.0")
    if document.get("scope_id") != "asa-tinkercad-functional-parity":
        fail("unexpected functional parity scope_id")
    literal = document.get("literal_copy")
    if not isinstance(literal, dict):
        fail("literal_copy must be an object")
    if literal.get("source_code") != "forbidden" or literal.get("trademarks_and_branding") != "forbidden":
        fail("functional parity scope must prohibit source/brand copying")
    if literal.get("functional_flows_and_tool_capabilities") != "required":
        fail("functional flows and tool capabilities must be required")
    completion = document.get("completion_rule")
    if not isinstance(completion, dict) or completion.get("current_claim") != "not_100_percent":
        fail("current functional parity claim must remain not_100_percent")
    conditions = set(string_list(completion.get("may_claim_100_percent_only_when"), "completion conditions"))
    if "every evidence_required capability is resolved by reference capture or owner decision" not in conditions:
        fail("100% completion rule must require resolving evidence_required capabilities")
    groups = document.get("capability_groups")
    if not isinstance(groups, list):
        fail("functional parity capability_groups must be a list")
    group_ids: set[str] = set()
    capability_ids: set[str] = set()
    evidence_required = 0
    total_points = 0
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get("id"), str):
            fail("every parity group must have id")
        group_id = group["id"]
        if group_id in group_ids:
            fail(f"duplicate parity group: {group_id}")
        group_ids.add(group_id)
        releases = set(string_list(group.get("target_releases"), f"{group_id}.target_releases"))
        if not releases <= EXPECTED_RELEASES:
            fail(f"{group_id} contains invalid target releases")
        capabilities = group.get("capabilities")
        if not isinstance(capabilities, list) or not capabilities:
            fail(f"parity group {group_id} has no capabilities")
        for capability in capabilities:
            if not isinstance(capability, dict):
                fail(f"parity group {group_id} contains a non-object capability")
            capability_id = capability.get("id")
            if not isinstance(capability_id, str) or not CAPABILITY_ID.fullmatch(capability_id):
                fail(f"invalid parity capability id: {capability_id!r}")
            if capability_id in capability_ids:
                fail(f"duplicate parity capability id: {capability_id}")
            capability_ids.add(capability_id)
            if not isinstance(capability.get("points"), int) or capability["points"] <= 0:
                fail(f"{capability_id}.points must be a positive integer")
            total_points += capability["points"]
            for field in ("requirement", "evidence", "status"):
                if not isinstance(capability.get(field), str) or not capability[field].strip():
                    fail(f"{capability_id}.{field} must be a non-empty string")
            if capability["evidence"] == "evidence_required":
                evidence_required += 1
    if group_ids != EXPECTED_PARITY_GROUPS:
        fail("functional parity group set is incomplete or contains additions")
    if len(capability_ids) < 55:
        fail(f"functional parity scope must contain at least 55 capabilities, got {len(capability_ids)}")
    if total_points < 220:
        fail(f"functional parity point total is unexpectedly small: {total_points}")
    if evidence_required < 10:
        fail("functional parity scope hides too many unresolved reference details")
    follow_up = set(string_list(document.get("required_follow_up"), "required_follow_up"))
    for required in (
        "create_complete_surface_catalog",
        "create_electronics_tool_and_component_contract",
        "create_admin_console_contract",
        "create_student_experience_contract",
    ):
        if required not in follow_up:
            fail(f"functional parity follow-up misses {required}")
    return len(capability_ids), total_points, evidence_required


def validate_human_docs() -> None:
    documents = {
        INTERFACE_DOC: (
            "Что означает «100% копия»",
            "School/Organization Admin",
            "StudentSeat",
            "Полный Electronics contract",
            "Что реализовано, а что только описано",
        ),
        ELECTRONICS_DOC: (
            "Полная спецификация электронной лаборатории",
            "Instruments",
            "Arduino и micro:bit",
            "Serial monitor",
            "Definition of 100% Electronics parity",
        ),
        ADMIN_DOC: (
            "school и platform administration",
            "Audited SupportSession",
            "Feature flags and rollout",
            "Storage, retention and deletion",
            "Definition of Done",
        ),
        STUDENT_DOC: (
            "Два разных типа ученика",
            "Learner Home",
            "Assignment editor context",
            "Safe Mode negative",
            "Definition of Done",
        ),
    }
    for path, markers in documents.items():
        if not path.is_file():
            fail(f"missing human interface document: {path.relative_to(ROOT)}")
        text = path.read_text(encoding="utf-8")
        for marker in markers:
            if marker not in text:
                fail(f"{path.name} misses marker: {marker}")

    if not VIEWER_PATH.is_file():
        fail("missing visual interface catalog HTML")
    viewer = VIEWER_PATH.read_text(encoding="utf-8")
    for marker in (
        "ASA_PRODUCT_SURFACE_CATALOG.yaml",
        "ASA_ELECTRONICS_TOOL_CATALOG.yaml",
        "ASA_TINKERCAD_100_PERCENT_SCOPE.yaml",
        "Все страницы",
        "Электронная лаборатория",
        "Полный parity scope",
        "100% parity: не подтверждена",
    ):
        if marker not in viewer:
            fail(f"interface-catalog.html misses marker: {marker}")
    if "5173" in viewer or "3000" in viewer or "3100" in viewer:
        fail("interface catalog must not use forbidden ASA runtime ports")


def main() -> int:
    try:
        surface_count, admin_count, student_count = validate_surfaces(load(SURFACES_PATH))
        tool_count, part_count, electronics_evidence = validate_electronics(load(ELECTRONICS_PATH))
        capability_count, total_points, scope_evidence = validate_scope(load(SCOPE_PATH))
        validate_human_docs()
    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"ASA complete product interfaces FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA complete product interfaces PASS")
    print(f"- product surfaces: {surface_count}")
    print(f"- admin surfaces: {admin_count}")
    print(f"- student surfaces: {student_count}")
    print(f"- electronics tools: {tool_count}")
    print(f"- component targets: {part_count}")
    print(f"- functional parity capabilities: {capability_count}")
    print(f"- functional parity points: {total_points}")
    print(f"- unresolved electronics evidence items: {electronics_evidence}")
    print(f"- unresolved scope evidence items: {scope_evidence}")
    print("- current 100% parity claim: false")
    print("- visual catalog: present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
