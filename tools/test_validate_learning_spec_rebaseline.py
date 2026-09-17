#!/usr/bin/env python3
"""Negative tests for the documentation gate; these are not product acceptance tests."""
from __future__ import annotations

import copy
import unittest

import yaml

from validate_learning_spec_rebaseline import (
    ACCESS, CURRENT, IDENTITY_CONTRACT, INTEGRATED, LEARNING,
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
        self.assertRejected(changed_yaml(LEDGER, corrupt), "product proof without actual")

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
