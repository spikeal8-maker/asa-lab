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
### ARCH-001 — A
**MUST.** A.
### NET-001 — B
**MUST.** B.
"""
        (root / "docs/architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md").write_text(
            standard, encoding="utf-8"
        )
        contract = {
            "schema_version": "1.0.0",
            "contract_id": "DEPLOYMENT-PORTABILITY",
            "domain": "deployment",
            "registry_document_id": "PORTABLE-DEPLOYMENT-CONTRACT",
            "master_documents": ["PORTABLE-DEPLOYMENT-STANDARD"],
            "invariants": [
                {
                    "id": "ARCH-001",
                    "level": "MUST",
                    "statement": "A",
                    "applies_to": ["install"],
                    "forbid": ["bad_a"],
                },
                {
                    "id": "NET-001",
                    "level": "MUST",
                    "statement": "B",
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
        registry = {"documents": documents}
        (root / "docs/agent/document-registry.yaml").write_text(
            yaml.safe_dump(registry, sort_keys=False), encoding="utf-8"
        )
        plan = (
            "#396\n"
            "docs/architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md\n"
            "docs/agent/contracts/deployment.yaml\n"
        )
        (root / "docs/execution/PORTABLE_DEPLOYMENT_IMPLEMENTATION_PLAN.md").write_text(
            plan, encoding="utf-8"
        )
        route = (
            "docs/architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md\n"
            "docs/agent/contracts/deployment.yaml\n"
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

    def test_requirement_drift_is_rejected(self) -> None:
        root = self.make_fixture()
        path = root / "docs/agent/contracts/deployment.yaml"
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        data["invariants"] = data["invariants"][:1]
        path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
        self.assertTrue(any("requirement ID mismatch" in error for error in validate_root(root)))

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
