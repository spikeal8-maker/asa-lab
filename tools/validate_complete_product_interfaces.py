#!/usr/bin/env python3
"""Validate complete ASA Lab page, admin, learner and Electronics contracts."""

from __future__ import annotations

from pathlib import Path
import re
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
SURFACES = ROOT / "docs/product/ASA_PRODUCT_SURFACE_CATALOG.yaml"
SCOPE = ROOT / "docs/product/ASA_TINKERCAD_100_PERCENT_SCOPE.yaml"
ELECTRONICS = ROOT / "docs/product/ASA_ELECTRONICS_TOOL_CATALOG.yaml"
HUMAN_DOCS = {
    ROOT / "docs/product/ASA_COMPLETE_INTERFACE_BLUEPRINT.md": (
        "Что означает «100% копия»",
        "School/Organization:",
        "StudentSeat",
        "Что реализовано, а что только описано",
    ),
    ROOT / "docs/product/ASA_ELECTRONICS_WORKBENCH_COMPLETE_SPEC.md": (
        "полная спецификация электронной лаборатории",
        "Instruments",
        "Arduino и micro:bit",
        "Serial monitor",
        "Definition of 100% Electronics parity",
    ),
    ROOT / "docs/product/ASA_ADMIN_CONSOLE_SPEC.md": (
        "school и platform administration",
        "Audited SupportSession",
        "Feature flags and rollout",
        "Storage, retention and deletion",
    ),
    ROOT / "docs/product/ASA_STUDENT_EXPERIENCE_SPEC.md": (
        "Два разных типа ученика",
        "Learner Home",
        "Assignment editor context",
        "Safe Mode negative",
    ),
}
VIEWER = ROOT / "docs/product/interface-catalog.html"

RELEASES = {f"R{number}" for number in range(1, 11)}
ACTORS = {
    "anonymous", "account_creator", "educator", "registered_student",
    "student_seat", "guardian", "co_teacher", "school_admin", "moderator",
    "platform_admin", "support_operator",
}
TEMPLATES = {"PUBLIC", "PORTAL", "CLASSROOM", "STUDENT", "EDITOR_HOST", "ADMIN", "PUBLICATION"}
UI_STATES = {
    "loading", "empty", "populated", "validation_error", "authorization_denied",
    "server_error", "offline_or_reconnecting", "success_feedback",
}
IMPLEMENTATION_STATES = {"absent", "partial", "in_review", "parity_pass", "approved_deviation"}
SURFACE_PATTERN = re.compile(r"^(PUB|CRT|EDU|STU|EDT|SADM|PADM)-\d{3}$")
TOOL_PATTERN = re.compile(r"^ELEC-[A-Z0-9-]+$")

REQUIRED_SURFACES = {
    "PUB-002", "PUB-004", "PUB-005", "PUB-007", "PUB-009",
    "CRT-001", "CRT-002", "CRT-003", "CRT-008", "CRT-009", "CRT-010",
    "EDU-001", "EDU-004", "EDU-005", "EDU-006", "EDU-007", "EDU-008",
    "EDU-011", "EDU-012", "EDU-013", "EDU-014", "EDU-015", "EDU-017",
    "EDU-018", "EDU-019", "EDU-020", "STU-001", "STU-003", "STU-004",
    "STU-005", "STU-006", "STU-007", "STU-008", "STU-009", "STU-010",
    "EDT-001", "EDT-002", "EDT-003", "EDT-004", "EDT-005", "SADM-001",
    "SADM-003", "SADM-006", "SADM-007", "SADM-008", "SADM-009", "SADM-010",
    "PADM-001", "PADM-002", "PADM-004", "PADM-005", "PADM-006", "PADM-007",
    "PADM-008", "PADM-009", "PADM-010", "PADM-011", "PADM-012", "PADM-013",
}
REQUIRED_ELECTRONICS_GROUPS = {
    "SHELL", "EDIT", "VIEW", "LIBRARY", "WIRING", "INSPECTOR",
    "SIMULATION-BASIC", "DIAGNOSTICS", "INSTRUMENTS", "CODE", "SERIAL",
    "PERSISTENCE", "CLASSROOM-CONTEXT", "PUBLIC-VIEWER", "ACCESSIBILITY", "EXPORT",
}
REQUIRED_ELECTRONICS_TOOLS = {
    "ELEC-SELECT", "ELEC-MULTISELECT", "ELEC-UNDO", "ELEC-REDO", "ELEC-PAN",
    "ELEC-FIT", "ELEC-LIBRARY-SEARCH", "ELEC-TERMINALS", "ELEC-WIRE-CREATE",
    "ELEC-WIRE-RECONNECT", "ELEC-WIRE-BEND", "ELEC-WIRE-COLOR",
    "ELEC-INSPECTOR-PROPERTIES", "ELEC-SIM-START", "ELEC-SIM-STOP",
    "ELEC-SIM-UNSUPPORTED", "ELEC-DIAG-NO-FAKE-SUCCESS", "ELEC-MULTIMETER",
    "ELEC-OSCILLOSCOPE", "ELEC-CODE-BLOCKS", "ELEC-CODE-TEXT",
    "ELEC-CODE-COMPILE", "ELEC-SERIAL-OPEN", "ELEC-AUTOSAVE", "ELEC-RELOAD",
    "ELEC-CHECKPOINT", "ELEC-ASSIGNMENT-BANNER", "ELEC-SUBMIT",
    "ELEC-TEACHER-VIEW", "ELEC-REVIEW-ANCHOR", "ELEC-PUBLIC-SIM", "ELEC-REMIX",
    "ELEC-A11Y-KEYBOARD", "ELEC-EXPORT-DOCUMENT",
}
REQUIRED_COMPONENT_FAMILIES = {
    "COMPONENT-BASIC", "COMPONENT-SEMICONDUCTOR", "COMPONENT-SENSORS",
    "COMPONENT-ACTUATORS", "COMPONENT-DISPLAYS", "COMPONENT-IC",
    "MICROCONTROLLER-ARDUINO", "MICROCONTROLLER-MICROBIT", "INSTRUMENT-COMPONENTS",
}
REQUIRED_SCOPE_GROUPS = {
    "GROUP-PLATFORM", "GROUP-CLASSROOM", "GROUP-CIRCUITS", "GROUP-3D",
    "GROUP-CODEBLOCKS", "GROUP-SIMLAB", "GROUP-MOBILE-INTEGRATIONS",
}


def fail(message: str) -> None:
    raise ValueError(message)


def load(path: Path) -> dict[str, Any]:
    if not path.is_file():
        fail(f"missing {path.relative_to(ROOT)}")
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        fail(f"{path.relative_to(ROOT)} must contain a YAML object")
    return value


def strings(value: Any, label: str, *, allow_empty: bool = False) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
        fail(f"{label} must be a string list")
    if not allow_empty and not value:
        fail(f"{label} must not be empty")
    if len(value) != len(set(value)):
        fail(f"{label} contains duplicates")
    return value


def validate_surfaces(doc: dict[str, Any]) -> tuple[int, int, int]:
    if doc.get("schema_version") != "1.0.0" or doc.get("catalog_id") != "asa-complete-product-surfaces":
        fail("invalid product surface catalog identity")
    if set(doc.get("actors") or []) != ACTORS:
        fail("surface actor set is incomplete")
    if set(doc.get("required_ui_states") or []) != UI_STATES:
        fail("surface UI state vocabulary is incomplete")
    templates = doc.get("layout_templates")
    if not isinstance(templates, dict) or set(templates) != TEMPLATES:
        fail("layout template set is incomplete")
    for name, template in templates.items():
        if not isinstance(template, dict):
            fail(f"layout template {name} must be an object")
        strings(template.get("regions"), f"layout_templates.{name}.regions")

    surfaces = doc.get("surfaces")
    if not isinstance(surfaces, list) or len(surfaces) < 75:
        fail("complete surface catalog must contain at least 75 surfaces")
    ids: set[str] = set()
    routes: set[str] = set()
    admin_count = student_count = 0
    for surface in surfaces:
        if not isinstance(surface, dict):
            fail("every surface must be an object")
        surface_id = surface.get("id")
        if not isinstance(surface_id, str) or not SURFACE_PATTERN.fullmatch(surface_id):
            fail(f"invalid surface id: {surface_id!r}")
        if surface_id in ids:
            fail(f"duplicate surface id: {surface_id}")
        ids.add(surface_id)
        for field in ("name", "route", "release", "template", "implementation", "purpose"):
            if not isinstance(surface.get(field), str) or not surface[field].strip():
                fail(f"{surface_id}.{field} must be a non-empty string")
        if not surface["route"].startswith("/"):
            fail(f"{surface_id}.route must start with /")
        if surface["route"] in routes:
            fail(f"duplicate exact route: {surface['route']}")
        routes.add(surface["route"])
        if surface["release"] not in RELEASES:
            fail(f"{surface_id}.release is invalid")
        if surface["template"] not in TEMPLATES:
            fail(f"{surface_id}.template is invalid")
        if surface["implementation"] not in IMPLEMENTATION_STATES:
            fail(f"{surface_id}.implementation is invalid")
        actors = set(strings(surface.get("actors"), f"{surface_id}.actors"))
        if not actors <= ACTORS:
            fail(f"{surface_id}.actors contain unknown values")
        strings(surface.get("primary_actions"), f"{surface_id}.primary_actions")
        states = set(strings(surface.get("required_states"), f"{surface_id}.required_states"))
        if not states <= UI_STATES:
            fail(f"{surface_id}.required_states contain unknown values")
        if "populated" not in states and "empty" not in states:
            fail(f"{surface_id} must define a visible content state")
        if not states & {"validation_error", "authorization_denied", "server_error"}:
            fail(f"{surface_id} must define at least one failure state")
        strings(surface.get("screenshot_ids"), f"{surface_id}.screenshot_ids")
        if surface_id.startswith(("SADM-", "PADM-")):
            admin_count += 1
            if surface["template"] != "ADMIN":
                fail(f"admin surface {surface_id} must use ADMIN template")
        if surface_id.startswith("STU-"):
            student_count += 1
            if not actors & {"student_seat", "registered_student"}:
                fail(f"student surface {surface_id} has no learner actor")
    missing = sorted(REQUIRED_SURFACES - ids)
    if missing:
        fail("surface catalog misses required IDs: " + ", ".join(missing))
    if admin_count < 20 or student_count < 10:
        fail(f"surface coverage too small: admin={admin_count}, student={student_count}")
    electronics = next((surface for surface in surfaces if surface.get("id") == "EDT-002"), None)
    if not isinstance(electronics, dict) or electronics.get("implementation") not in {"partial", "in_review"}:
        fail("Electronics workbench must remain partial/in_review before parity")
    return len(surfaces), admin_count, student_count


def validate_electronics(doc: dict[str, Any]) -> tuple[int, int, int]:
    if doc.get("schema_version") != "1.0.0" or doc.get("catalog_id") != "asa-electronics-complete-tool-catalog":
        fail("invalid Electronics tool catalog identity")
    if doc.get("module_key") != "electronics" or doc.get("release") != "R4":
        fail("Electronics catalog must target module electronics / R4")
    groups = doc.get("capability_groups")
    if not isinstance(groups, list):
        fail("Electronics capability_groups must be a list")
    group_ids: set[str] = set()
    tool_ids: set[str] = set()
    evidence_required = 0
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get("id"), str):
            fail("every Electronics group must have id")
        group_id = group["id"]
        if group_id in group_ids:
            fail(f"duplicate Electronics group: {group_id}")
        group_ids.add(group_id)
        tools = group.get("tools")
        if not isinstance(tools, list) or not tools:
            fail(f"Electronics group {group_id} has no tools")
        for tool in tools:
            if not isinstance(tool, dict):
                fail(f"Electronics group {group_id} contains invalid tool")
            tool_id = tool.get("id")
            if not isinstance(tool_id, str) or not TOOL_PATTERN.fullmatch(tool_id):
                fail(f"invalid Electronics tool id: {tool_id!r}")
            if tool_id in tool_ids:
                fail(f"duplicate Electronics tool id: {tool_id}")
            tool_ids.add(tool_id)
            for field in ("name", "reference_status", "implementation"):
                if not isinstance(tool.get(field), str) or not tool[field].strip():
                    fail(f"{tool_id}.{field} must be a non-empty string")
            evidence_required += int(tool["reference_status"] == "evidence_required")
    if group_ids != REQUIRED_ELECTRONICS_GROUPS:
        fail("Electronics group set is incomplete or contains additions")
    missing = sorted(REQUIRED_ELECTRONICS_TOOLS - tool_ids)
    if missing:
        fail("Electronics catalog misses critical tools: " + ", ".join(missing))
    if len(tool_ids) < 85:
        fail(f"Electronics catalog must contain at least 85 tools, got {len(tool_ids)}")

    families = doc.get("component_families")
    if not isinstance(families, list):
        fail("component_families must be a list")
    family_ids: set[str] = set()
    part_count = 0
    for family in families:
        if not isinstance(family, dict) or not isinstance(family.get("id"), str):
            fail("every component family must have id")
        if family["id"] in family_ids:
            fail(f"duplicate component family: {family['id']}")
        family_ids.add(family["id"])
        if family.get("required_for_full_parity") is not True:
            fail(f"component family {family['id']} must be required for parity")
        part_count += len(strings(family.get("parts"), f"{family['id']}.parts"))
    if family_ids != REQUIRED_COMPONENT_FAMILIES or part_count < 55:
        fail(f"component family coverage is incomplete: families={len(family_ids)}, parts={part_count}")
    if len(strings(doc.get("required_reference_capture"), "required_reference_capture")) < 8:
        fail("Electronics reference-capture list is incomplete")
    if len(strings(doc.get("required_screenshots"), "required_screenshots")) < 15:
        fail("Electronics screenshot set is incomplete")
    rules = set(strings(doc.get("parity_rules"), "parity_rules"))
    if "evidence_required_item_blocks_100_percent_claim" not in rules:
        fail("Electronics rules must block 100% claim while evidence is unresolved")
    if evidence_required < 10:
        fail("Electronics catalog hides unresolved reference details")
    return len(tool_ids), part_count, evidence_required


def validate_scope(doc: dict[str, Any]) -> tuple[int, int, int]:
    if doc.get("schema_version") != "1.0.0" or doc.get("scope_id") != "asa-tinkercad-functional-parity":
        fail("invalid functional parity scope identity")
    literal = doc.get("literal_copy")
    if not isinstance(literal, dict):
        fail("literal_copy must be an object")
    if literal.get("source_code") != "forbidden" or literal.get("trademarks_and_branding") != "forbidden":
        fail("functional parity must prohibit source and trademark copying")
    if literal.get("functional_flows_and_tool_capabilities") != "required":
        fail("functional flows and tool capabilities must be required")
    completion = doc.get("completion_rule")
    if not isinstance(completion, dict) or completion.get("current_claim") != "not_100_percent":
        fail("current parity claim must remain not_100_percent")
    conditions = set(strings(completion.get("may_claim_100_percent_only_when"), "completion conditions"))
    if "every evidence_required capability is resolved by reference capture or owner decision" not in conditions:
        fail("completion rule must resolve every evidence_required capability")

    groups = doc.get("capability_groups")
    if not isinstance(groups, list):
        fail("functional parity capability_groups must be a list")
    group_ids: set[str] = set()
    capability_ids: set[str] = set()
    points = unresolved = 0
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get("id"), str):
            fail("every parity group must have id")
        if group["id"] in group_ids:
            fail(f"duplicate parity group: {group['id']}")
        group_ids.add(group["id"])
        releases = set(strings(group.get("target_releases"), f"{group['id']}.target_releases"))
        if not releases <= RELEASES:
            fail(f"{group['id']} has invalid target release")
        capabilities = group.get("capabilities")
        if not isinstance(capabilities, list) or not capabilities:
            fail(f"parity group {group['id']} has no capabilities")
        for capability in capabilities:
            if not isinstance(capability, dict) or not isinstance(capability.get("id"), str):
                fail(f"parity group {group['id']} has invalid capability")
            if capability["id"] in capability_ids:
                fail(f"duplicate parity capability: {capability['id']}")
            capability_ids.add(capability["id"])
            if not isinstance(capability.get("points"), int) or capability["points"] <= 0:
                fail(f"{capability['id']}.points must be positive")
            points += capability["points"]
            for field in ("requirement", "evidence", "status"):
                if not isinstance(capability.get(field), str) or not capability[field].strip():
                    fail(f"{capability['id']}.{field} must be non-empty")
            unresolved += int(capability["evidence"] == "evidence_required")
    if group_ids != REQUIRED_SCOPE_GROUPS:
        fail("functional parity group set is incomplete")
    if len(capability_ids) < 55 or points < 220 or unresolved < 10:
        fail(f"functional parity scope too small or overclaims certainty: capabilities={len(capability_ids)}, points={points}, unresolved={unresolved}")
    return len(capability_ids), points, unresolved


def validate_human_and_viewer() -> None:
    for path, markers in HUMAN_DOCS.items():
        if not path.is_file():
            fail(f"missing {path.relative_to(ROOT)}")
        text = path.read_text(encoding="utf-8")
        for marker in markers:
            if marker not in text:
                fail(f"{path.name} misses marker: {marker}")
    if not VIEWER.is_file():
        fail("missing visual interface catalog")
    viewer = VIEWER.read_text(encoding="utf-8")
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
    for port in ("3000", "3100", "5173"):
        if f"127.0.0.1:{port}" in viewer or f"localhost:{port}" in viewer:
            fail(f"interface catalog uses forbidden ASA runtime port {port}")


def main() -> int:
    try:
        surfaces, admin, students = validate_surfaces(load(SURFACES))
        tools, parts, electronics_unresolved = validate_electronics(load(ELECTRONICS))
        capabilities, points, scope_unresolved = validate_scope(load(SCOPE))
        validate_human_and_viewer()
    except (OSError, ValueError, yaml.YAMLError) as error:
        print(f"ASA complete product interfaces FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA complete product interfaces PASS")
    print(f"- product surfaces: {surfaces}")
    print(f"- admin surfaces: {admin}")
    print(f"- student surfaces: {students}")
    print(f"- Electronics tools: {tools}")
    print(f"- component targets: {parts}")
    print(f"- functional parity capabilities: {capabilities}")
    print(f"- functional parity points: {points}")
    print(f"- unresolved Electronics evidence items: {electronics_unresolved}")
    print(f"- unresolved scope evidence items: {scope_unresolved}")
    print("- current 100% parity claim: false")
    print("- visual interface catalog: present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
