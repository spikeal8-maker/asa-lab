#!/usr/bin/env python3
"""Check Learning documentation contracts, never claim product or deployment readiness."""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Mapping

import yaml

ROOT = Path(__file__).resolve().parents[1]
INTEGRATED = "docs/product/ASA_INTEGRATED_IMPLEMENTATION_SPEC.md"
LEARNING = "docs/product/ASA_LEARNING_TECHNICAL_SPEC.md"
ACCESS = "docs/product/ASA_USERS_ACCESS_AND_SETTINGS_SPEC.md"
LEDGER = "docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml"
CURRENT = "docs/execution/current.yaml"
REGISTRY = "docs/agent/document-registry.yaml"
IDENTITY_CONTRACT = "docs/agent/contracts/identity.yaml"
LEARNING_CONTRACT = "docs/agent/contracts/learning.yaml"
ACTIVE_TEXTS = (
    INTEGRATED, LEARNING, ACCESS, LEDGER,
    "docs/product/ASA_PRODUCT_SURFACE_CATALOG.yaml",
    "docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md",
    "docs/product/ASA_STUDENT_EXPERIENCE_SPEC.md",
    "docs/product/ASA_AUTH_ENTRY_UX_SPEC.md",
    "docs/product/ASA_AUTH_ENTRY_UX_SPEC.yaml",
    "docs/product/CLASSROOM_CORE_SPEC.md",
    "docs/product/TINKERCAD_EDUCATOR_CLASSROOM_PARITY_SPEC.md",
    IDENTITY_CONTRACT, LEARNING_CONTRACT, "docs/execution/LRN_COURSE_01.md",
)
EDITIONS = {
    "PRODUCT-INTEGRATED-V15": ("1.5", INTEGRATED),
    "LEARNING-MASTER-V22": ("2.2", LEARNING),
    "IDENTITY-ACCESS-V22": ("2.2", ACCESS),
}
FIX_IDS = {f"E1-FIX-{number:02}" for number in range(1, 11)}
ID_PATTERNS = (
    (LEARNING, "docs/product/ASA_LEARNING_TECHNICAL_SPEC_V2_1.md",
     r"\b(?:ARCH|IDN|VER|CRS|RUN|AUD|ATT|QUIZ|ASM|GRD|CAT|MED|MLT|SEC|DB|API|NFR|MIG|EXEC|REL|TST|E2E|UX)(?:-[A-Z]+)*-\d{3}\b"),
    (ACCESS, "docs/product/ASA_USERS_ACCESS_AND_SETTINGS_SPEC_V2_1.md",
     r"\b(?:(?:U|R|P)\d{2}|(?:INV|UI|SET|PREF|AC|UI-AC|PERSONA-AC)-\d{2,3})\b"),
)


def validate(root: Path, overrides: Mapping[str, str] | None = None) -> list[str]:
    """Allow in-memory corrupted copies for negative tests; never edit the source tree."""
    override = overrides or {}
    errors: list[str] = []

    def read(path: str) -> str:
        return override[path] if path in override else (root / path).read_text(encoding="utf-8")

    try:
        texts = {path: read(path) for path in ACTIVE_TEXTS}
        registry = yaml.safe_load(read(REGISTRY))
        current = yaml.safe_load(read(CURRENT))
        ledger = yaml.safe_load(texts[LEDGER])
        docs = {entry["id"]: entry for entry in registry["documents"]}
        requirements = ledger["requirements"]
        lane = next(entry for entry in current["parallel_lanes"] if entry["id"] == "learning")
    except (OSError, ValueError, TypeError, KeyError, StopIteration, yaml.YAMLError) as exc:
        return [f"cannot load Learning documentation: {exc}"]

    for path, text in texts.items():
        if re.search(r"asolab\.ru", text, re.IGNORECASE):
            errors.append(f"wrong public origin in active document: {path}")
        if "\ufffd" in text:
            errors.append(f"replacement character in UTF-8 document: {path}")

    for doc_id, (revision, path) in EDITIONS.items():
        item = docs.get(doc_id, {})
        if (item.get("status"), str(item.get("revision")), item.get("path")) != (
            "canonical", revision, path
        ):
            errors.append(f"canonical edition mismatch: {doc_id}")
        if doc_id not in texts[path]:
            errors.append(f"document header missing edition: {doc_id}")
    refs = {entry["document"]: str(entry["revision"]) for entry in lane["task"].get("normative_refs", [])}
    for doc_id, (revision, _) in EDITIONS.items():
        if refs.get(doc_id) != revision:
            errors.append(f"active Learning reference mismatch: {doc_id}")

    for contract_path in (IDENTITY_CONTRACT, LEARNING_CONTRACT):
        contract = yaml.safe_load(texts[contract_path])
        for doc_id in contract.get("master_documents", []):
            if docs.get(doc_id, {}).get("status") != "canonical":
                errors.append(f"compact contract refers to noncanonical document: {doc_id}")
        for invariant in contract["invariants"]:
            for ref in invariant.get("master_refs", []):
                if docs.get(ref["document"], {}).get("status") != "canonical":
                    errors.append(f"noncanonical master ref in {invariant['id']}")
    identity = yaml.safe_load(texts[IDENTITY_CONTRACT])
    credential = next((i for i in identity["invariants"] if i["id"] == "IDA-CRED-001"), {})
    if set(credential.get("forbid", [])) & {"plaintext_credential_readback", "credential_in_roster"}:
        errors.append("credential invariant still forbids authorized repeated card readback")
    if "repeat-readable" not in credential.get("statement", ""):
        errors.append("credential invariant lacks authorized repeat-readable contract")
    for forbidden in ("new card available once", "login handle + individual secret", "secret credential;", "reveal credentials once", "одноразовые print-friendly credentials", "printable cards are rendered from that one-time response"):
        if any(forbidden.casefold() in text.casefold() for text in texts.values()):
            errors.append(f"obsolete basic Seat contract: {forbidden}")

    for active, historical, pattern in ID_PATTERNS:
        old_ids = set(re.findall(pattern, read(historical)))
        now_ids = set(re.findall(pattern, texts[active]))
        if old_ids - now_ids:
            errors.append(f"requirement IDs removed from {active}: {sorted(old_ids - now_ids)}")

    ids = [r.get("id") for r in requirements]
    if len(ids) != len(set(ids)):
        errors.append("duplicate requirement ID")
    by_id = {r["id"]: r for r in requirements}
    if not FIX_IDS.issubset(by_id):
        errors.append(f"missing correction IDs: {sorted(FIX_IDS - set(by_id))}")
    policy = ledger.get("verification_policy", {})
    if policy.get("live_origin") != "https://asa-lab.ru":
        errors.append("verification policy has wrong live origin")
    for key in ("listed_test_files_are_not_execution_receipts", "planned_scenarios_are_not_executed_tests", "implementation_and_verification_are_separate"):
        if policy.get(key) is not True:
            errors.append(f"missing evidence boundary: {key}")
    for rid in FIX_IDS & set(by_id):
        row = by_id[rid]
        if not row.get("planned_scenarios") or not row.get("evidence") or not row.get("source_paths"):
            errors.append(f"correction lacks scenarios or source evidence: {rid}")
        proof = row.get("verification", {})
        if not re.fullmatch(r"[0-9a-f]{40}", str(proof.get("source_sha", ""))):
            errors.append(f"correction source SHA missing: {rid}")
        if not proof.get("method") or not proof.get("observed_result"):
            errors.append(f"correction verification method missing: {rid}")
        if row.get("status") == "proven" or proof.get("product_fix_verified") is True:
            records = proof.get("execution_records", [])
            if not records or any(not r.get("command") or not r.get("scenario") or r.get("result") != "pass" or not re.fullmatch(r"[0-9a-f]{40}", str(r.get("sha", ""))) or not r.get("evidence") for r in records):
                errors.append(f"product proof without actual execution records: {rid}")
        if proof.get("authenticated_live_journey") == "passed" and not proof.get("live_authenticated_evidence"):
            errors.append(f"live acceptance without authenticated evidence: {rid}")
        for relative in row.get("evidence", []) + row.get("source_paths", []) + row.get("tests", []):
            path = Path(relative)
            if path.is_absolute() or ".." in path.parts or not (root / path).is_file():
                errors.append(f"missing or unsafe traceability file for {rid}: {relative}")

    for token in ("single_choice", "multiple_choice", "boolean", "numeric", "short_text", "matching", "ordering", "long_text_manual", "Python 3", "TemporaryLearningAccess", "stage_assignment_pending"):
        if token not in texts[INTEGRATED]:
            errors.append(f"preserved target missing: {token}")
    if "INT-REUSE-HISTORY" not in by_id:
        errors.append("history-to-course requirement was silently dropped")
    for number in range(1, 19):
        if f"INT-E1-{number:02}" not in by_id:
            errors.append(f"existing E1 requirement missing: {number}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    errors = validate(args.root.resolve())
    if errors:
        print("Learning spec consistency: FAIL", file=sys.stderr)
        for message in errors:
            print(f"- {message}", file=sys.stderr)
        return 1
    print("Learning spec consistency: PASS (documentation only; no product or live acceptance)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
