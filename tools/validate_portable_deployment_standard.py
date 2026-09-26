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
PLAN = "docs/execution/PORTABLE_DEPLOYMENT_IMPLEMENTATION_PLAN.md"
REGISTRY = "docs/agent/document-registry.yaml"
AGENTS = "AGENTS.md"
START = "START_HERE_FOR_AI.md"
GATE = "tools/gate-governance.sh"

REQUIREMENT_RE = re.compile(r"^### (DPL-[A-Z]+-\d{3})\b", re.MULTILINE)

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


def validate_root(root: Path) -> list[str]:
    errors: list[str] = []
    standard = _read(root, STANDARD, errors)
    contract = _yaml(root, CONTRACT, errors)
    registry = _yaml(root, REGISTRY, errors)
    agents = _read(root, AGENTS, errors)
    start = _read(root, START, errors)
    gate = _read(root, GATE, errors)
    plan = _read(root, PLAN, errors)

    standard_ids = REQUIREMENT_RE.findall(standard)
    if not standard_ids:
        errors.append(f"{STANDARD}: no requirement IDs found")
    if len(standard_ids) != len(set(standard_ids)):
        errors.append(f"{STANDARD}: duplicate requirement IDs")

    if contract.get("schema_version") != "1.0.0":
        errors.append(f"{CONTRACT}: schema_version must be 1.0.0")
    if contract.get("contract_id") != "DEPLOYMENT-DOMAIN":
        errors.append(f"{CONTRACT}: contract_id must be DEPLOYMENT-DOMAIN")
    if contract.get("registry_document_id") != "PORTABLE-DEPLOYMENT-CONTRACT":
        errors.append(f"{CONTRACT}: registry_document_id mismatch")
    if contract.get("master_documents") != ["PORTABLE-DEPLOYMENT-STANDARD"]:
        errors.append(f"{CONTRACT}: master_documents must contain only PORTABLE-DEPLOYMENT-STANDARD")

    invariants = contract.get("invariants")
    if not isinstance(invariants, list) or not invariants:
        errors.append(f"{CONTRACT}: invariants must be a non-empty array")
        contract_ids: list[str] = []
    else:
        contract_ids = []
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
            if item.get("level") not in {"MUST", "SHOULD", "MAY"}:
                errors.append(f"{label}.level must be MUST/SHOULD/MAY")
            if not isinstance(item.get("statement"), str) or not item["statement"].strip():
                errors.append(f"{label}.statement must be non-empty")
            for field in ("applies_to", "forbid"):
                value = item.get(field)
                if not isinstance(value, list) or not value or not all(isinstance(x, str) and x for x in value):
                    errors.append(f"{label}.{field} must be a non-empty string array")
        if len(contract_ids) != len(set(contract_ids)):
            errors.append(f"{CONTRACT}: duplicate invariant IDs")

    if set(standard_ids) != set(contract_ids):
        missing_contract = sorted(set(standard_ids) - set(contract_ids))
        missing_standard = sorted(set(contract_ids) - set(standard_ids))
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
        for marker in (STANDARD, CONTRACT):
            if marker not in text:
                errors.append(f"{relative}: missing route to {marker}")

    for marker in (
        "tools/test_validate_portable_deployment_standard.py",
        "tools/validate_portable_deployment_standard.py",
    ):
        if marker not in gate:
            errors.append(f"{GATE}: missing governance invocation {marker}")

    for marker in ("#396", STANDARD, CONTRACT):
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
