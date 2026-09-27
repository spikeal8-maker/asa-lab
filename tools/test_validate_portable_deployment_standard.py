#!/usr/bin/env python3
"""Tests for validate_portable_deployment_standard.py."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import yaml

from validate_portable_deployment_standard import validate_root


class PortableDeploymentStandardValidatorTests(unittest.TestCase):
    def make_fixture(self) -> Path:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        for directory in (
            "docs/architecture",
            "docs/agent/contracts",
            "docs/agent",
            "docs/execution",
            "tools",
        ):
            (root / directory).mkdir(parents=True, exist_ok=True)

        standard = """# Standard

The validator does not prove natural-language semantic equivalence.

### DPL-ARCH-001 — A

**MUST.** A.

### DPL-NET-001 — B

**SHOULD.** B.
"""
        (root / "docs/architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md").write_text(
            standard, encoding="utf-8"
        )
        transition = """# Transition
**FULL_COMPLIANCE_CLAIM:** BLOCKED
**COMPLIANCE_STATUS:** TRANSITIONAL_NON_COMPLIANT
DPL-AUTO-001
DPL-NET-002 / DPL-NET-003
DPL-NET-004
DPL-TST-003
### EX-05 — DPL-NET-003 / DPL-CFG-001 / DPL-EXC-001: fixed class-join origin

StudentAccessCards class-join QR uses https://asa-lab.ru.
"""
        (root / "docs/architecture/ADR-PORTABLE-DEPLOYMENT-TRANSITION-001.md").write_text(
            transition, encoding="utf-8"
        )

        contract = {
            "schema_version": "1.0.0",
            "contract_id": "DEPLOYMENT-DOMAIN",
            "domain": "deployment",
            "registry_document_id": "PORTABLE-DEPLOYMENT-CONTRACT",
            "master_documents": ["PORTABLE-DEPLOYMENT-STANDARD"],
            "invariants": [
                {
                    "id": "DPL-ARCH-001",
                    "level": "MUST",
                    "statement": "A",
                    "master_refs": [
                        {
                            "document": "PORTABLE-DEPLOYMENT-STANDARD",
                            "section": "DPL-ARCH-001",
                        }
                    ],
                    "applies_to": ["install"],
                    "forbid": ["bad_a"],
                },
                {
                    "id": "DPL-NET-001",
                    "level": "SHOULD",
                    "statement": "B",
                    "master_refs": [
                        {
                            "document": "PORTABLE-DEPLOYMENT-STANDARD",
                            "section": "DPL-NET-001",
                        }
                    ],
                    "applies_to": ["network"],
                    "forbid": ["bad_b"],
                },
            ],
        }
        (root / "docs/agent/contracts/deployment.yaml").write_text(
            yaml.safe_dump(contract, sort_keys=False), encoding="utf-8"
        )

        documents = []
        for doc_id, path, status, authority, role in (
            (
                "PORTABLE-DEPLOYMENT-STANDARD",
                "docs/architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md",
                "canonical",
                "portable_self_hosted_deployment_standard",
                "escalation",
            ),
            (
                "PORTABLE-DEPLOYMENT-CONTRACT",
                "docs/agent/contracts/deployment.yaml",
                "canonical",
                "deployment_portability_invariants",
                "compact",
            ),
            (
                "ADR-PORTABLE-DEPLOYMENT-TRANSITION-001",
                "docs/architecture/ADR-PORTABLE-DEPLOYMENT-TRANSITION-001.md",
                "canonical",
                "asa_portable_deployment_transition_exception",
                "escalation",
            ),
            (
                "PORTABLE-DEPLOYMENT-PLAN",
                "docs/execution/PORTABLE_DEPLOYMENT_IMPLEMENTATION_PLAN.md",
                "supporting",
                "none",
                "trace",
            ),
        ):
            documents.append(
                {
                    "id": doc_id,
                    "path": path,
                    "scope": "global",
                    "lanes": ["*"],
                    "kind": "contract",
                    "status": status,
                    "authority": authority,
                    "context_role": role,
                    "read_when": ["deployment"],
                }
            )
        (root / "docs/agent/document-registry.yaml").write_text(
            yaml.safe_dump({"documents": documents}, sort_keys=False), encoding="utf-8"
        )

        route = (
            "docs/architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md\n"
            "docs/agent/contracts/deployment.yaml\n"
            "docs/architecture/ADR-PORTABLE-DEPLOYMENT-TRANSITION-001.md\n"
        )
        (root / "docs/execution/PORTABLE_DEPLOYMENT_IMPLEMENTATION_PLAN.md").write_text(
            "#396\n" + route, encoding="utf-8"
        )
        (root / "AGENTS.md").write_text(route, encoding="utf-8")
        (root / "START_HERE_FOR_AI.md").write_text(route, encoding="utf-8")
        (root / "tools/gate-governance.sh").write_text(
            "python tools/test_validate_portable_deployment_standard.py\n"
            "python tools/validate_portable_deployment_standard.py\n",
            encoding="utf-8",
        )
        return root

    def test_valid_fixture(self) -> None:
        self.assertEqual(validate_root(self.make_fixture()), [])

    def test_requirement_id_drift_is_rejected(self) -> None:
        root = self.make_fixture()
        path = root / "docs/agent/contracts/deployment.yaml"
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        data["invariants"] = data["invariants"][:1]
        path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
        self.assertTrue(any("requirement ID mismatch" in error for error in validate_root(root)))

    def test_normative_level_drift_is_rejected(self) -> None:
        root = self.make_fixture()
        path = root / "docs/agent/contracts/deployment.yaml"
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        data["invariants"][0]["level"] = "SHOULD"
        path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
        self.assertTrue(any(".level" in error and "does not match" in error for error in validate_root(root)))

    def test_master_ref_drift_is_rejected(self) -> None:
        root = self.make_fixture()
        path = root / "docs/agent/contracts/deployment.yaml"
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        data["invariants"][0]["master_refs"][0]["section"] = "DPL-NET-001"
        path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
        self.assertTrue(any(".master_refs must equal" in error for error in validate_root(root)))

    def test_semantic_limit_must_be_explicit(self) -> None:
        root = self.make_fixture()
        path = root / "docs/architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md"
        text = path.read_text(encoding="utf-8").replace(
            "does not prove natural-language semantic equivalence",
            "checks the contract",
        )
        path.write_text(text, encoding="utf-8")
        self.assertTrue(any("semantic equivalence is not proven" in error for error in validate_root(root)))

    def test_statement_wording_is_outside_structural_parity(self) -> None:
        root = self.make_fixture()
        path = root / "docs/agent/contracts/deployment.yaml"
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        data["invariants"][0]["statement"] = "Different non-empty wording requiring L3 semantic review."
        path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
        self.assertEqual(validate_root(root), [])

    def test_transition_status_is_required(self) -> None:
        root = self.make_fixture()
        path = root / "docs/architecture/ADR-PORTABLE-DEPLOYMENT-TRANSITION-001.md"
        text = path.read_text(encoding="utf-8").replace(
            "TRANSITIONAL_NON_COMPLIANT", "UNKNOWN"
        )
        path.write_text(text, encoding="utf-8")
        self.assertTrue(any("TRANSITIONAL_NON_COMPLIANT" in error for error in validate_root(root)))

    def test_missing_class_join_exception_is_rejected(self) -> None:
        root = self.make_fixture()
        path = root / "docs/architecture/ADR-PORTABLE-DEPLOYMENT-TRANSITION-001.md"
        text = path.read_text(encoding="utf-8").replace(
            "### EX-05 — DPL-NET-003 / DPL-CFG-001 / DPL-EXC-001: fixed class-join origin\n"
            "\nStudentAccessCards class-join QR uses https://asa-lab.ru.\n",
            "",
        )
        path.write_text(text, encoding="utf-8")
        self.assertTrue(any("EX-05" in error for error in validate_root(root)))

    def test_missing_registry_route_is_rejected(self) -> None:
        root = self.make_fixture()
        path = root / "docs/agent/document-registry.yaml"
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        data["documents"] = data["documents"][1:]
        path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
        self.assertTrue(any("missing PORTABLE-DEPLOYMENT-STANDARD" in error for error in validate_root(root)))

    def test_missing_gate_hook_is_rejected(self) -> None:
        root = self.make_fixture()
        (root / "tools/gate-governance.sh").write_text("", encoding="utf-8")
        errors = validate_root(root)
        self.assertTrue(any("missing governance invocation" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
