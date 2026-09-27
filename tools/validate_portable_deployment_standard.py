#!/usr/bin/env python3
"""Validate the canonical portable deployment standard, contract and routing."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
STANDARD = "docs/architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md"
CONTRACT = "docs/agent/contracts/deployment.yaml"
TRANSITION = "docs/architecture/ADR-PORTABLE-DEPLOYMENT-TRANSITION-001.md"
PLAN = "docs/execution/PORTABLE_DEPLOYMENT_IMPLEMENTATION_PLAN.md"
REGISTRY = "docs/agent/document-registry.yaml"
AGENTS = "AGENTS.md"
START = "START_HERE_FOR_AI.md"
GATE = "tools/gate-governance.sh"

REQUIREMENT_HEADING_RE = re.compile(r"^### (DPL-[A-Z]+-\d{3})\b.*$", re.MULTILINE)
LEVEL_RE = re.compile(r"^\*\*(MUST|SHOULD|MAY)\.\*\*", re.MULTILINE)
TRANSITION_REVISION_RE = re.compile(
    r"^\*\*Revision:\*\*[ \t]*(\d+(?:\.\d+)+)(?=[ \t\\]|$)", re.MULTILINE
)
SEMANTIC_LIMIT_MARKER = "does not prove natural-language semantic equivalence"
CANONICAL_REQUIREMENT_IDS = frozenset({
    "DPL-ARCH-001", "DPL-ARCH-002", "DPL-HOST-001", "DPL-AUTO-001",
    "DPL-NET-001", "DPL-NET-002", "DPL-NET-003", "DPL-NET-004",
    "DPL-NET-005", "DPL-NET-006", "DPL-SEC-001", "DPL-SEC-002",
    "DPL-CFG-001", "DPL-CFG-002", "DPL-SEC-003", "DPL-DAT-001",
    "DPL-REL-001", "DPL-REL-002", "DPL-UPD-001", "DPL-UPD-002",
    "DPL-BAK-001", "DPL-BAK-002", "DPL-MIG-001", "DPL-MOV-001",
    "DPL-TST-001", "DPL-TST-002", "DPL-TST-003", "DPL-OPS-001",
    "DPL-EXC-001",
})
TRANSITION_MARKERS = (
    "COMPLIANCE_STATUS:** TRANSITIONAL_NON_COMPLIANT",
    "FULL_COMPLIANCE_CLAIM:** BLOCKED",
    "DPL-AUTO-001",
    "DPL-NET-002 / DPL-NET-003",
    "DPL-NET-004",
    "DPL-TST-003",
    "### EX-05 — DPL-NET-003 / DPL-CFG-001 / DPL-EXC-001: fixed class-join origin",
)

EXPECTED_REGISTRY: dict[str, dict[str, Any]] = {
    "PORTABLE-DEPLOYMENT-STANDARD": {
        "path": STANDARD,
        "status": "canonical",
        "authority": "portable_self_hosted_deployment_standard",
        "context_role": "escalation",
    },
    "PORTABLE-DEPLOYMENT-CONTRACT": {
        "path": CONTRACT,
        "status": "canonical",
        "authority": "deployment_portability_invariants",
        "context_role": "compact",
    },
    "ADR-PORTABLE-DEPLOYMENT-TRANSITION-001": {
        "path": TRANSITION,
        "status": "canonical",
        "authority": "asa_portable_deployment_transition_exception",
        "context_role": "escalation",
    },
    "PORTABLE-DEPLOYMENT-PLAN": {
        "path": PLAN,
        "status": "supporting",
        "authority": "none",
        "context_role": "trace",
    },
}


def _read(root: Path, relative: str, errors: list[str]) -> str:
    path = root / relative
    if not path.is_file():
        errors.append(f"missing required file: {relative}")
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"cannot read {relative}: {exc}")
        return ""


def _yaml(root: Path, relative: str, errors: list[str]) -> dict[str, Any]:
    raw = _read(root, relative, errors)
    if not raw:
        return {}
    try:
        value = yaml.safe_load(raw)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"cannot parse {relative}: {exc}")
        return {}
    if not isinstance(value, dict):
        errors.append(f"{relative} root must be a mapping")
        return {}
    return value


def _standard_requirements(text: str, errors: list[str]) -> dict[str, str]:
    matches = list(REQUIREMENT_HEADING_RE.finditer(text))
    if not matches:
        errors.append(f"{STANDARD}: no requirement IDs found")
        return {}

    result: dict[str, str] = {}
    for index, match in enumerate(matches):
        req_id = match.group(1)
        if req_id in result:
            errors.append(f"{STANDARD}: duplicate requirement ID {req_id}")
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[match.end():end]
        level = LEVEL_RE.search(block)
        if level is None:
            errors.append(f"{STANDARD}: {req_id} missing normative MUST/SHOULD/MAY level")
            continue
        result[req_id] = level.group(1)
    return result


def validate_root(root: Path) -> list[str]:
    errors: list[str] = []
    standard = _read(root, STANDARD, errors)
    contract = _yaml(root, CONTRACT, errors)
    transition = _read(root, TRANSITION, errors)
    registry = _yaml(root, REGISTRY, errors)
    agents = _read(root, AGENTS, errors)
    start = _read(root, START, errors)
    gate = _read(root, GATE, errors)
    plan = _read(root, PLAN, errors)

    standard_requirements = _standard_requirements(standard, errors)
    raw_invariants = contract.get("invariants")
    declared_contract_ids = {
        item["id"] for item in raw_invariants
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    } if isinstance(raw_invariants, list) else set()
    for source, ids in ((STANDARD, set(standard_requirements)), (CONTRACT, declared_contract_ids)):
        if ids != CANONICAL_REQUIREMENT_IDS:
            errors.append(
                f"{source}: canonical requirement ID mismatch"
                f"; missing={sorted(CANONICAL_REQUIREMENT_IDS - ids)}"
                f"; unexpected={sorted(ids - CANONICAL_REQUIREMENT_IDS)}"
            )
    if SEMANTIC_LIMIT_MARKER not in standard:
        errors.append(
            f"{STANDARD}: machine-enforcement boundary must state that semantic equivalence is not proven"
        )

    for marker in TRANSITION_MARKERS:
        if marker not in transition:
            errors.append(f"{TRANSITION}: missing transition marker {marker!r}")

    if contract.get("schema_version") != "1.0.0":
        errors.append(f"{CONTRACT}: schema_version must be 1.0.0")
    if contract.get("contract_id") != "DEPLOYMENT-DOMAIN":
        errors.append(f"{CONTRACT}: contract_id must be DEPLOYMENT-DOMAIN")
    if contract.get("registry_document_id") != "PORTABLE-DEPLOYMENT-CONTRACT":
        errors.append(f"{CONTRACT}: registry_document_id mismatch")
    if contract.get("master_documents") != ["PORTABLE-DEPLOYMENT-STANDARD"]:
        errors.append(f"{CONTRACT}: master_documents must contain only PORTABLE-DEPLOYMENT-STANDARD")

    invariants = contract.get("invariants")
    contract_ids: list[str] = []
    if not isinstance(invariants, list) or not invariants:
        errors.append(f"{CONTRACT}: invariants must be a non-empty array")
    else:
        for index, item in enumerate(invariants):
            label = f"{CONTRACT}: invariants[{index}]"
            if not isinstance(item, dict):
                errors.append(f"{label} must be a mapping")
                continue
            req_id = item.get("id")
            if not isinstance(req_id, str) or not re.fullmatch(r"DPL-[A-Z]+-\d{3}", req_id):
                errors.append(f"{label}.id invalid")
                continue
            contract_ids.append(req_id)

            level = item.get("level")
            if level not in {"MUST", "SHOULD", "MAY"}:
                errors.append(f"{label}.level must be MUST/SHOULD/MAY")
            expected_level = standard_requirements.get(req_id)
            if expected_level is not None and level != expected_level:
                errors.append(
                    f"{label}.level {level!r} does not match {STANDARD} level {expected_level!r}"
                )

            expected_refs = [
                {"document": "PORTABLE-DEPLOYMENT-STANDARD", "section": req_id}
            ]
            if item.get("master_refs") != expected_refs:
                errors.append(f"{label}.master_refs must equal {expected_refs!r}")

            if not isinstance(item.get("statement"), str) or not item["statement"].strip():
                errors.append(f"{label}.statement must be non-empty")
            for field in ("applies_to", "forbid"):
                value = item.get(field)
                if (
                    not isinstance(value, list)
                    or not value
                    or not all(isinstance(x, str) and x for x in value)
                ):
                    errors.append(f"{label}.{field} must be a non-empty string array")

        if len(contract_ids) != len(set(contract_ids)):
            errors.append(f"{CONTRACT}: duplicate invariant IDs")

    if set(standard_requirements) != set(contract_ids):
        missing_contract = sorted(set(standard_requirements) - set(contract_ids))
        missing_standard = sorted(set(contract_ids) - set(standard_requirements))
        errors.append(
            "requirement ID mismatch"
            f"; missing in contract={missing_contract}"
            f"; missing in standard={missing_standard}"
        )

    documents = registry.get("documents")
    by_id = {
        item.get("id"): item
        for item in documents or []
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    transition_revisions = TRANSITION_REVISION_RE.findall(transition)
    if len(transition_revisions) != 1:
        errors.append(f"{TRANSITION}: must declare exactly one numeric Revision")
    else:
        transition_entry = by_id.get("ADR-PORTABLE-DEPLOYMENT-TRANSITION-001")
        if transition_entry is not None and transition_entry.get("revision") != transition_revisions[0]:
            errors.append(
                f"{REGISTRY}: ADR-PORTABLE-DEPLOYMENT-TRANSITION-001.revision"
                f" must match {TRANSITION} Revision {transition_revisions[0]!r}"
            )
    for doc_id, expected in EXPECTED_REGISTRY.items():
        item = by_id.get(doc_id)
        if item is None:
            errors.append(f"{REGISTRY}: missing {doc_id}")
            continue
        for field, value in expected.items():
            if item.get(field) != value:
                errors.append(f"{REGISTRY}: {doc_id}.{field} must be {value!r}")
        if item.get("lanes") != ["*"]:
            errors.append(f"{REGISTRY}: {doc_id}.lanes must be ['*']")
        read_when = item.get("read_when")
        if not isinstance(read_when, list) or not read_when:
            errors.append(f"{REGISTRY}: {doc_id}.read_when must be non-empty")

    for relative, text in ((AGENTS, agents), (START, start)):
        for marker in (STANDARD, CONTRACT, TRANSITION):
            if marker not in text:
                errors.append(f"{relative}: missing route to {marker}")

    for marker in (
        "tools/test_validate_portable_deployment_standard.py",
        "tools/validate_portable_deployment_standard.py",
    ):
        if marker not in gate:
            errors.append(f"{GATE}: missing governance invocation {marker}")

    for marker in ("#396", STANDARD, CONTRACT, TRANSITION):
        if marker not in plan:
            errors.append(f"{PLAN}: missing marker {marker!r}")

    return errors


def main() -> int:
    errors = validate_root(ROOT)
    if errors:
        print("portable deployment standard: FAIL", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("portable deployment standard: PASS")
    print("- structural parity: IDs + normative levels + exact master_refs + transition ADR revision")
    print("- semantic equivalence: NOT machine-proven; L3 review remains required")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
