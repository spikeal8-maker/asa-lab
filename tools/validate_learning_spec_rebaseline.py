#!/usr/bin/env python3
"""Check Learning documentation contracts, never claim product or deployment readiness."""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path
from typing import Mapping

import yaml

ROOT = Path(__file__).resolve().parents[1]
INTEGRATED = "docs/product/ASA_INTEGRATED_IMPLEMENTATION_SPEC.md"
LEARNING = "docs/product/ASA_LEARNING_TECHNICAL_SPEC.md"
ACCESS = "docs/product/ASA_USERS_ACCESS_AND_SETTINGS_SPEC.md"
LEDGER = "docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml"
PLANNED_TESTS = "docs/testing/planned-test-catalog.yaml"
ACTIVE_TESTS = "docs/testing/test-catalog.yaml"
CAPABILITY_MAP = "docs/product/CAPABILITY_MAP.yaml"
BLUEPRINT = "docs/product/ASA_TARGET_PLATFORM_BLUEPRINT.md"
SURFACE_CATALOG = "docs/product/ASA_PRODUCT_SURFACE_CATALOG.yaml"
CURRENT = "docs/execution/current.yaml"
REGISTRY = "docs/agent/document-registry.yaml"
IDENTITY_CONTRACT = "docs/agent/contracts/identity.yaml"
LEARNING_CONTRACT = "docs/agent/contracts/learning.yaml"
ACTIVE_TEXTS = (
    "AGENTS.md",
    "docs/agent/review-protocol.md",
    "docs/product/ASA_UI_LAYOUT_ACCEPTANCE_SPEC.md",
    CAPABILITY_MAP,
    INTEGRATED, LEARNING, ACCESS, LEDGER,
    SURFACE_CATALOG,
    BLUEPRINT,
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
FIX_IDS = {f"E1-FIX-{number:02}" for number in range(1, 13)}
ID_PATTERNS = (
    (LEARNING, "docs/product/ASA_LEARNING_TECHNICAL_SPEC_V2_1.md",
     r"\b(?:ARCH|IDN|VER|CRS|RUN|AUD|ATT|QUIZ|ASM|GRD|CAT|MED|MLT|SEC|DB|API|NFR|MIG|EXEC|REL|TST|E2E|UX)(?:-[A-Z]+)*-\d{3}\b"),
    (ACCESS, "docs/product/ASA_USERS_ACCESS_AND_SETTINGS_SPEC_V2_1.md",
     r"\b(?:(?:U|R|P)\d{2}|(?:INV|UI|SET|PREF|AC|UI-AC|PERSONA-AC)-\d{2,3})\b"),
)
REQUIRED_CLAUSES = {
    "AGENTS.md": ["acceptance_blocker", "execution_blocker", "deployment_blocker"],
    INTEGRATED: ["E1-FIX-11", "E1-FIX-12", "FUNCTIONAL_ACCEPTANCE", "VISUAL_ACCEPTANCE", "INSTALLED_ACCEPTANCE", "Course Builder E1", "CLASSROOM_CODE_SECRET", "legacy_predictable_active=0", "ASA Lab начинается с обычного личного Account", "StudentSeat — способ войти", "Organization/школа — отдельный рабочий workspace", "Organization Workspace имеет одну понятную IA", "Запрещённые продуктовые анти-паттерны"],
    ACCESS: ["class.credentials.read_current", "class.credentials.rotate", "class.sessions.revoke", "AES-256-GCM", "HMAC-SHA-256", "Retry-After", "shared rate-limit state", "Регистр значим:", "от 4 до 10 символов", "effective exact-class staff scope", "Временно подменяющий педагог", "2346789ACDEFGHJKMNPQRTUVWXYacdefghjkmnpqrtuvwxy", "credential_storage_unavailable", "credential_version_conflict", "v1|tenant_id|class_id|seat_id|credential_version", "lookup_key_id", "CLASSROOM_CODE_SECRET", "ASA_STUDENT_CODE_PROTECTION_MODE=compat", "legacy_predictable_active=0", "Один Account — одна личная оболочка", "публичные read-only «Сообщество» и «Знания»", "UX после успешного linking", "MAX/другие внешние providers привязываются к Account", "Organization Workspace — отдельный рабочий контекст", "UI-37"],
    LEARNING: ["## 89.6.", "FUNCTIONAL_ACCEPTANCE", "CRS-003/UX-BLD-002/003"],
    "docs/product/ASA_UI_LAYOUT_ACCEPTANCE_SPEC.md": ["FUNCTIONAL_ACCEPTANCE", "VISUAL_ACCEPTANCE", "visual_state: provisional"],
    CAPABILITY_MAP: ["AES-256-GCM protected readback", "HMAC-SHA-256 lookup", "repeat-printable card", "Personal Workspace", "current_stage_source", "historical_delivery_classification"],
    BLUEPRINT: ["supporting architecture/reference", "Document Registry", "не назначает собственную нормативную лестницу"],
    IDENTITY_CONTRACT: ["IDA-PRODUCT-001", "IDA-SEAT-PUBLIC-001", "IDA-SEAT-PROJECT-001", "IDA-ORG-002", "IDA-MAX-001"],
    LEARNING_CONTRACT: ["LRN-SURFACE-001"],
    SURFACE_CATALOG: ["supporting_target_atlas", "actor_semantics", "organization_owner", "registered_student_shell: ordinary_PORTAL_shell_with_My_Learning", "never invents a Personal Workspace"],
    "docs/product/ASA_AUTH_ENTRY_UX_SPEC.md": ["тот же личный Account", "Новый UI не должен копировать этот legacy-flow"],
    "docs/execution/LRN_COURSE_01.md": ["student-seat-protected-code-backfill.mjs", "keyring preflight", "0146", "E1-FIX-12", "CLASSROOM_CODE_SECRET", "ASA_STUDENT_CODE_PROTECTION_MODE=compat", "legacy_predictable_active=0"],
}


def _git_commit_exists(root: Path, sha: str) -> bool:
    try:
        result = subprocess.run(
            ["git", "cat-file", "-e", f"{sha}^{{commit}}"],
            cwd=root, capture_output=True, text=True, timeout=10, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


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
        planned_catalog = yaml.safe_load(read(PLANNED_TESTS))
        active_catalog = yaml.safe_load(read(ACTIVE_TESTS))
        docs = {entry["id"]: entry for entry in registry["documents"]}
        requirements = ledger["requirements"]
        planned_test_ids = {entry["id"] for entry in planned_catalog.get("tests", []) if isinstance(entry, dict) and entry.get("id")}
        active_tests = {entry["id"]: entry for entry in active_catalog.get("tests", []) if isinstance(entry, dict) and entry.get("id")}
        known_test_ids = planned_test_ids | set(active_tests)
        lane = next(entry for entry in current["parallel_lanes"] if entry["id"] == "learning")
    except (OSError, ValueError, TypeError, KeyError, StopIteration, yaml.YAMLError) as exc:
        return [f"cannot load Learning documentation: {exc}"]

    for path, text in texts.items():
        if re.search(r"asolab\.ru", text, re.IGNORECASE):
            errors.append(f"wrong public origin in active document: {path}")
        if "\ufffd" in text:
            errors.append(f"replacement character in UTF-8 document: {path}")
        if re.search(r"\?{3,}", text):
            errors.append(f"question-mark corruption in active document: {path}")
        bad_controls = sorted({ord(ch) for ch in text if ord(ch) < 32 and ch not in "\n\r\t"})
        if bad_controls:
            errors.append(f"control-character corruption in active document: {path}: {bad_controls}")

    for path, clauses in REQUIRED_CLAUSES.items():
        for clause in clauses:
            if clause not in texts[path]:
                errors.append(f"required semantic clause missing from {path}: {clause}")

    try:
        capability_map = yaml.safe_load(texts[CAPABILITY_MAP]) or {}
        capability_index = {
            item.get("id"): item
            for item in capability_map.get("capabilities", [])
            if isinstance(item, dict) and item.get("id")
        }
        surface_catalog = yaml.safe_load(texts[SURFACE_CATALOG]) or {}
        surface_index = {
            item.get("id"): item
            for item in surface_catalog.get("surfaces", [])
            if isinstance(item, dict) and item.get("id")
        }
    except yaml.YAMLError as exc:
        errors.append(f"cannot parse supporting product atlas: {exc}")
        capability_map, capability_index, surface_catalog, surface_index = {}, {}, {}, {}

    if capability_index.get("CAP-IDENTITY", {}).get("depends_on") not in ([], None):
        errors.append("CAP-IDENTITY must not depend on Organization")
    if "CAP-ORG" in (capability_index.get("CAP-CLASSROOM", {}).get("depends_on") or []):
        errors.append("independent Classroom must not require Organization")
    if "CAP-ORG" in (capability_index.get("CAP-MODULE-REGISTRY", {}).get("depends_on") or []):
        errors.append("personal module/project use must not require Organization")
    delivery_semantics = capability_map.get("delivery_semantics") or {}
    if delivery_semantics.get("current_stage_source") != INTEGRATED:
        errors.append("Capability Map must delegate current delivery order to Integrated V1.5")
    if delivery_semantics.get("release_slices_role") != "historical_delivery_classification":
        errors.append("Capability Map legacy releases must be marked historical")

    actor_semantics = surface_catalog.get("actor_semantics") or {}
    expected_actor_semantics = {
        "registered_student": "account_in_learner_context",
        "educator": "account_with_scoped_educator_capability",
        "school_admin": "account_with_scoped_organization_admin_grant",
        "student_seat": "distinct_scoped_learner_principal_without_required_account",
    }
    for actor, expected in expected_actor_semantics.items():
        if actor_semantics.get(actor) != expected:
            errors.append(f"Surface Catalog actor semantics drift: {actor}")
    student_layout = (surface_catalog.get("layout_templates") or {}).get("STUDENT") or {}
    if student_layout.get("registered_student_shell") != "ordinary_PORTAL_shell_with_My_Learning":
        errors.append("Account learner must keep ordinary Account PORTAL shell")
    for surface_id in ("ORG-001", "ORG-002", "ORG-003", "ORG-004", "ORG-005", "ORG-006"):
        surface = surface_index.get(surface_id, {})
        actors = set(surface.get("actors") or [])
        if not {"organization_owner", "school_admin"}.issubset(actors):
            errors.append(f"{surface_id} must include owner and scoped organization admin")
        if surface.get("release") != "R9":
            errors.append(f"{surface_id} must follow historical organization/admin slice R9")
    chooser = surface_index.get("CRT-003", {})
    if "never invents a Personal Workspace" not in str(chooser.get("purpose", "")):
        errors.append("StudentSeat project chooser lacks scoped destination boundary")

    for doc_id in ("PRODUCT-TARGET-BLUEPRINT", "PRODUCT-CAPABILITY-MAP", "PRODUCT-SURFACE-CATALOG"):
        item = docs.get(doc_id, {})
        if item.get("status") != "supporting" or item.get("authority") not in (None, "none"):
            errors.append(f"supporting product reference has unexpected authority: {doc_id}")

    blockers = current.get("blocking") or []
    correction_blocker = next((b for b in blockers if isinstance(b, dict) and b.get("id") == "LRN-E1-CORRECTIONS"), None)
    if not correction_blocker:
        errors.append("LRN-E1-CORRECTIONS blocker missing")
    else:
        if correction_blocker.get("kind") != "acceptance_blocker":
            errors.append("LRN-E1-CORRECTIONS must be acceptance_blocker")
        blocks = set(correction_blocker.get("blocks") or [])
        allows = set(correction_blocker.get("allows") or [])
        if not {"owner_acceptance", "release_claim", "deployment_authorization"}.issubset(blocks):
            errors.append("acceptance blocker closure actions incomplete")
        if not {"bounded_repair", "regression_authoring", "documentation_update", "focused_verification"}.issubset(allows):
            errors.append("acceptance blocker does not explicitly allow correction work")

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
    expected_limits = {
        "invalid_resolve_per_source_per_10m": 60,
        "invalid_candidate_per_class_per_10m": 5,
        "invalid_source_class_per_10m": 180,
        "invalid_source_total_per_10m": 300,
        "successful_requests_consume_failure_budget": False,
        "supported_e1_api_instances": 1,
    }
    if by_id.get("E1-FIX-01", {}).get("implementation_contract") != expected_limits:
        errors.append("E1-FIX-01 numeric admission contract drift")
    storage = by_id.get("E1-FIX-02", {}).get("implementation_contract") or {}
    expected_storage = {
        "encryption": "AES-256-GCM",
        "lookup": "HMAC-SHA-256",
        "key_storage": "outside_database_secret_keyring",
        "retired_code_reuse": "forbidden_within_class",
        "legacy_transition": "envelope_then_explicit_rotation",
        "aad": "v1|tenant_id|class_id|seat_id|credential_version",
        "encryption_key_bytes": 32,
        "lookup_key_min_bytes": 32,
        "lookup_key_rotation": "dual_read_then_rehash_then_retire",
        "generated_code_length": 6,
        "generated_code_alphabet": "2346789ACDEFGHJKMNPQRTUVWXYacdefghjkmnpqrtuvwxy",
        "generated_code_requires_all_character_classes": False,
        "manual_code_pattern": "^[A-Za-z0-9]{4,10}$",
        "code_case_sensitive": True,
        "migration": "migrations/0146_student_seat_protected_codes.sql",
        "backfill_tool": "tools/student-seat-protected-code-backfill.mjs",
        "keyring_env": [
            "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON",
            "ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID",
            "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON",
            "ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID",
        ],
        "sql_contains_key_material": False,
        "schema_apply_rotates_student_codes": False,
        "e1_permission_mapping": "active_exact_class_staff_scope",
        "existing_owner_and_co_teacher_access_preserved": True,
        "organization_role_requires_exact_class_scope": True,
        "temporary_substitute_access": "active_window_or_explicit_revoke",
        "rollout_mode_initial": "compat",
        "old_api_concurrent_with_backfill": False,
        "compat_new_writes_protected_and_legacy": True,
        "installed_acceptance_requires_unprotected_active": 0,
        "installed_acceptance_requires_legacy_predictable_active": 0,
        "final_mode": "enforced",
    }
    for key, value in expected_storage.items():
        if storage.get(key) != value:
            errors.append(f"E1-FIX-02 protected storage contract drift: {key}")
    required_permissions = {"class.credentials.issue", "class.credentials.read_current", "class.credentials.rotate", "class.sessions.revoke"}
    if set(storage.get("permissions") or []) != required_permissions:
        errors.append("E1-FIX-02 credential permission matrix drift")
    fix12 = by_id.get("E1-FIX-12", {}).get("implementation_contract") or {}
    expected_fix12 = {
        "production_class_code_secret_required": True,
        "class_code_secret_min_bytes": 32,
        "class_code_secret_independent_from_db_password": True,
        "production_db_url_secret_fallback": "forbidden",
        "class_code_secret_rotation": "maintenance_reissue_all_active_classes",
        "student_code_global_keyring_missing": "deployment_blocker",
        "unknown_row_key_id": "credential_specific_503_and_degraded_diagnostics",
        "old_writer_during_backfill": "forbidden",
        "installed_acceptance_legacy_predictable_active": 0,
    }
    if fix12 != expected_fix12:
        errors.append("E1-FIX-12 production secret/recovery contract drift")
    for rid in FIX_IDS & set(by_id):
        ref = str(by_id[rid].get("normative_ref") or "")
        if "?" in ref or "\u00a7" not in ref:
            errors.append(f"corrupted or incomplete normative ref: {rid}: {ref}")
    builder_required = {
        "SECTION-CREATE-RENAME-REORDER-DUPLICATE-HIDE-DELETE",
        "LESSON-CREATE-RENAME-REORDER-DUPLICATE-HIDE-DELETE",
        "BLOCK-EACH-INFORMATIONAL-KIND-SAVE-RELOAD",
        "BLOCK-MOVE-KEYBOARD-REORDER-DUPLICATE-SETTINGS-HIDE-DELETE-INSERT",
        "DUPLICATE-DOES-NOT-COPY-LEARNER-EVIDENCE",
        "HIDE-DELETE-DOES-NOT-MUTATE-PUBLISHED-RUN",
    }
    if not builder_required.issubset(set(by_id.get("E1-FIX-11", {}).get("planned_scenarios") or [])):
        errors.append("E1-FIX-11 Course Builder acceptance matrix incomplete")
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
            planned = set(row.get("planned_scenarios") or [])
            seen = {r.get("scenario") for r in records if isinstance(r, dict)}
            if not records or seen != planned:
                errors.append(f"product proof does not cover every planned scenario: {rid}")
            for record in records:
                if not isinstance(record, dict):
                    errors.append(f"malformed execution record: {rid}")
                    continue
                sha = str(record.get("sha", ""))
                evidence = record.get("evidence")
                digest = str(record.get("evidence_sha256", ""))
                runner = record.get("runner")
                test_id = record.get("test_id")
                if (not record.get("command") or not record.get("scenario") or record.get("result") != "pass"
                    or not re.fullmatch(r"[0-9a-f]{40}", sha) or sha == "0" * 40
                    or runner not in {"github_actions", "owner_manual", "local_isolated"}
                    or not evidence or not re.fullmatch(r"[0-9a-f]{64}", digest)):
                    errors.append(f"product proof without complete execution record: {rid}")
                    continue
                if not _git_commit_exists(root, sha):
                    errors.append(f"execution record SHA is not a local Git commit: {rid}: {sha}")
                active_test = active_tests.get(test_id)
                if active_test is None:
                    errors.append(f"execution record test_id is not in active test catalog: {rid}: {test_id}")
                elif record.get("command") != active_test.get("command"):
                    errors.append(f"execution command does not match active test catalog: {rid}: {test_id}")
                evidence_path = root / Path(str(evidence))
                if not evidence_path.is_file():
                    errors.append(f"execution evidence missing: {rid}: {evidence}")
                else:
                    import hashlib
                    actual = hashlib.sha256(evidence_path.read_bytes()).hexdigest()
                    if actual != digest:
                        errors.append(f"execution evidence digest mismatch: {rid}: {evidence}")
                if runner == "github_actions" and (not isinstance(record.get("run_id"), int) or record.get("run_id", 0) <= 0):
                    errors.append(f"GitHub execution record missing run_id: {rid}")
            if proof.get("remote_verification_required") is not True:
                errors.append(f"proven correction must require independent remote/manual verification: {rid}")
        if proof.get("authenticated_live_journey") == "passed":
            live = proof.get("live_authenticated_evidence") or {}
            required_live = {"observed_at", "web_sha", "api_sha", "schema_version", "scenario", "evidence"}
            if not isinstance(live, dict) or not required_live.issubset(live):
                errors.append(f"live acceptance without complete authenticated evidence: {rid}")
        for planned_id in row.get("planned_test_ids", []):
            if planned_id not in known_test_ids:
                errors.append(f"unknown planned/active test id for {rid}: {planned_id}")
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
