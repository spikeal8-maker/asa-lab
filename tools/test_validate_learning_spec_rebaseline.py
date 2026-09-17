#!/usr/bin/env python3
"""Negative tests for the documentation gate; these are not product acceptance tests."""
from __future__ import annotations

import copy
import unittest

import yaml

from validate_learning_spec_rebaseline import (
    ACCESS, CAPABILITY_MAP, CURRENT, IDENTITY_CONTRACT, INTEGRATED, LEARNING,
    LEDGER, REGISTRY, ROOT, validate,
)


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def changed_yaml(path: str, change) -> dict[str, str]:
    document = copy.deepcopy(yaml.safe_load(text(path)))
    change(document)
    return {path: yaml.safe_dump(document, allow_unicode=True, sort_keys=False)}


class LearningSpecGateTests(unittest.TestCase):
    def assertRejected(self, overrides: dict[str, str], message: str) -> None:
        errors = validate(ROOT, overrides)
        self.assertTrue(any(message in error for error in errors), errors)

    def test_current_contracts_are_consistent(self):
        self.assertEqual(validate(ROOT), [])

    def test_rejects_wrong_public_host(self):
        self.assertRejected({INTEGRATED: text(INTEGRATED).replace("https://asa-lab.ru", "https://asolab.ru")}, "wrong public origin")

    def test_rejects_question_mark_corruption(self):
        self.assertRejected({ACCESS: text(ACCESS) + "\n????? damaged contract\n"}, "question-mark corruption")

    def test_rejects_corrupted_normative_ref(self):
        def corrupt(doc):
            next(r for r in doc["requirements"] if r["id"] == "E1-FIX-11")["normative_ref"] = "PRODUCT-INTEGRATED-V15 ?4.2.1"
        self.assertRejected(changed_yaml(LEDGER, corrupt), "corrupted or incomplete normative ref")

    def test_rejects_missing_secret_recovery_fix(self):
        def corrupt(doc):
            doc["requirements"] = [r for r in doc["requirements"] if r["id"] != "E1-FIX-12"]
        self.assertRejected(changed_yaml(LEDGER, corrupt), "missing correction IDs")

    def test_rejects_student_code_rollout_race(self):
        def corrupt(doc):
            row = next(r for r in doc["requirements"] if r["id"] == "E1-FIX-02")
            row["implementation_contract"]["old_api_concurrent_with_backfill"] = True
        self.assertRejected(changed_yaml(LEDGER, corrupt), "protected storage contract drift")

    def test_rejects_class_code_secret_fallback(self):
        def corrupt(doc):
            row = next(r for r in doc["requirements"] if r["id"] == "E1-FIX-12")
            row["implementation_contract"]["production_db_url_secret_fallback"] = "allowed"
        self.assertRejected(changed_yaml(LEDGER, corrupt), "production secret/recovery contract drift")

    def test_rejects_wrong_registry_revision(self):
        def corrupt(doc):
            next(d for d in doc["documents"] if d["id"] == "PRODUCT-INTEGRATED-V15")["revision"] = "1.4"
        self.assertRejected(changed_yaml(REGISTRY, corrupt), "canonical edition mismatch")

    def test_rejects_stale_active_lane_reference(self):
        def corrupt(doc):
            lane = next(l for l in doc["parallel_lanes"] if l["id"] == "learning")
            lane["task"]["normative_refs"][0]["revision"] = "0.0"
        self.assertRejected(changed_yaml(CURRENT, corrupt), "active Learning reference mismatch")

    def test_rejects_old_one_time_readback_prohibition(self):
        def corrupt(doc):
            item = next(i for i in doc["invariants"] if i["id"] == "IDA-CRED-001")
            item["forbid"].append("credential_in_roster")
        self.assertRejected(changed_yaml(IDENTITY_CONTRACT, corrupt), "still forbids authorized")

    def test_rejects_loss_of_learning_requirement_id(self):
        self.assertRejected({LEARNING: text(LEARNING).replace("ARCH-001", "ARCH-REMOVED")}, "requirement IDs removed")

    def test_rejects_loss_of_access_requirement_id(self):
        self.assertRejected({ACCESS: text(ACCESS).replace("SET-01", "SET-REMOVED")}, "requirement IDs removed")

    def test_rejects_missing_fix(self):
        def corrupt(doc):
            doc["requirements"] = [r for r in doc["requirements"] if r["id"] != "E1-FIX-01"]
        self.assertRejected(changed_yaml(LEDGER, corrupt), "missing correction IDs")

    def test_rejects_missing_planned_scenarios(self):
        def corrupt(doc):
            next(r for r in doc["requirements"] if r["id"] == "E1-FIX-04")["planned_scenarios"] = []
        self.assertRejected(changed_yaml(LEDGER, corrupt), "lacks scenarios")

    def test_rejects_claiming_product_proof_without_execution(self):
        def corrupt(doc):
            row = next(r for r in doc["requirements"] if r["id"] == "E1-FIX-05")
            row["verification"]["product_fix_verified"] = True
        self.assertRejected(changed_yaml(LEDGER, corrupt), "product proof does not cover every planned scenario")

    def test_rejects_missing_required_security_clause(self):
        self.assertRejected({ACCESS: text(ACCESS).replace("class.credentials.read_current", "class.credentials.removed")}, "required semantic clause missing")

    def test_rejects_acceptance_blocker_that_blocks_repair(self):
        def corrupt(doc):
            block = next(b for b in doc["blocking"] if b["id"] == "LRN-E1-CORRECTIONS")
            block["kind"] = "execution_blocker"
            block["allows"] = []
        self.assertRejected(changed_yaml(CURRENT, corrupt), "must be acceptance_blocker")

    def test_rejects_proof_that_covers_only_one_scenario(self):
        def corrupt(doc):
            row = next(r for r in doc["requirements"] if r["id"] == "E1-FIX-01")
            row["status"] = "proven"
            row["verification"]["product_fix_verified"] = True
            row["verification"]["remote_verification_required"] = True
            row["verification"]["execution_records"] = [{
                "scenario": row["planned_scenarios"][0],
                "command": "pnpm test:placeholder",
                "result": "pass",
                "sha": "1" * 40,
                "runner": "local_isolated",
                "evidence": "docs/review/LRN_E1_SPEC_REBASELINE_2026_09_17.md",
                "evidence_sha256": "0" * 64,
            }]
        self.assertRejected(changed_yaml(LEDGER, corrupt), "does not cover every planned scenario")

    def test_rejects_zero_sha_or_bad_evidence_digest(self):
        def corrupt(doc):
            row = next(r for r in doc["requirements"] if r["id"] == "E1-FIX-03")
            row["status"] = "proven"
            row["verification"]["product_fix_verified"] = True
            row["verification"]["remote_verification_required"] = True
            row["verification"]["execution_records"] = [{
                "scenario": scenario,
                "command": "pnpm e2e:placeholder",
                "result": "pass",
                "sha": "0" * 40,
                "runner": "local_isolated",
                "evidence": "docs/review/LRN_E1_SPEC_REBASELINE_2026_09_17.md",
                "evidence_sha256": "0" * 64,
            } for scenario in row["planned_scenarios"]]
        self.assertRejected(changed_yaml(LEDGER, corrupt), "complete execution record")

    def test_rejects_missing_course_builder_fix(self):
        def corrupt(doc):
            doc["requirements"] = [r for r in doc["requirements"] if r["id"] != "E1-FIX-11"]
        self.assertRejected(changed_yaml(LEDGER, corrupt), "missing correction IDs")

    def test_rejects_rate_limit_contract_drift(self):
        def corrupt(doc):
            row = next(r for r in doc["requirements"] if r["id"] == "E1-FIX-01")
            row["implementation_contract"]["invalid_source_class_per_10m"] = 999
        self.assertRejected(changed_yaml(LEDGER, corrupt), "numeric admission contract drift")

    def test_rejects_unknown_planned_test_id(self):
        def corrupt(doc):
            row = next(r for r in doc["requirements"] if r["id"] == "E1-FIX-04")
            row["planned_test_ids"] = ["TST-DOES-NOT-EXIST"]
        self.assertRejected(changed_yaml(LEDGER, corrupt), "unknown planned/active test id")

    def test_rejects_incomplete_builder_matrix(self):
        def corrupt(doc):
            row = next(r for r in doc["requirements"] if r["id"] == "E1-FIX-11")
            row["planned_scenarios"] = ["SECTION-CREATE-RENAME-REORDER-DUPLICATE-HIDE-DELETE"]
        self.assertRejected(changed_yaml(LEDGER, corrupt), "Course Builder acceptance matrix incomplete")

    def test_rejects_stale_capability_storage_contract(self):
        self.assertRejected(
            {CAPABILITY_MAP: text(CAPABILITY_MAP).replace("AES-256-GCM protected readback", "Argon2id hash")},
            "required semantic clause missing",
        )

    def test_rejects_nonexistent_execution_commit(self):
        import hashlib
        def corrupt(doc):
            row = next(r for r in doc["requirements"] if r["id"] == "E1-FIX-05")
            evidence = "docs/review/LRN_E1_SPEC_REBASELINE_2026_09_17.md"
            digest = hashlib.sha256((ROOT / evidence).read_bytes()).hexdigest()
            row["status"] = "proven"
            row["verification"]["product_fix_verified"] = True
            row["verification"]["remote_verification_required"] = True
            row["verification"]["execution_records"] = [{
                "scenario": scenario,
                "command": "pnpm test:synthetic",
                "result": "pass",
                "sha": "1" * 40,
                "runner": "local_isolated",
                "evidence": evidence,
                "evidence_sha256": digest,
            } for scenario in row["planned_scenarios"]]
        self.assertRejected(changed_yaml(LEDGER, corrupt), "SHA is not a local Git commit")

    def test_rejects_arbitrary_command_for_active_test_id(self):
        import hashlib
        import subprocess
        def corrupt(doc):
            active = yaml.safe_load(text("docs/testing/test-catalog.yaml"))["tests"][0]
            sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
            evidence = "docs/review/LRN_E1_SPEC_REBASELINE_2026_09_17.md"
            digest = hashlib.sha256((ROOT / evidence).read_bytes()).hexdigest()
            row = next(r for r in doc["requirements"] if r["id"] == "E1-FIX-05")
            row["status"] = "proven"
            row["verification"]["product_fix_verified"] = True
            row["verification"]["remote_verification_required"] = True
            row["verification"]["execution_records"] = [{
                "scenario": scenario, "test_id": active["id"],
                "command": "echo fake-pass", "result": "pass", "sha": sha,
                "runner": "local_isolated", "evidence": evidence,
                "evidence_sha256": digest,
            } for scenario in row["planned_scenarios"]]
        self.assertRejected(changed_yaml(LEDGER, corrupt), "execution command does not match active test catalog")

    def test_rejects_live_claim_without_authenticated_evidence(self):
        def corrupt(doc):
            row = next(r for r in doc["requirements"] if r["id"] == "E1-FIX-10")
            row["verification"]["authenticated_live_journey"] = "passed"
        self.assertRejected(changed_yaml(LEDGER, corrupt), "live acceptance without")

    def test_rejects_missing_test_path(self):
        def corrupt(doc):
            row = next(r for r in doc["requirements"] if r["id"] == "E1-FIX-01")
            row["tests"].append("tests/does-not-exist-spec-review.synthetic.ts")
        self.assertRejected(changed_yaml(LEDGER, corrupt), "missing or unsafe traceability")

    def test_rejects_dropped_future_quiz_type(self):
        self.assertRejected({INTEGRATED: text(INTEGRATED).replace("long_text_manual", "removed_type")}, "preserved target missing")

    def test_planned_cases_do_not_become_execution_receipts(self):
        def corrupt(doc):
            doc["verification_policy"]["planned_scenarios_are_not_executed_tests"] = False
        self.assertRejected(changed_yaml(LEDGER, corrupt), "missing evidence boundary")


if __name__ == "__main__":
    unittest.main()
