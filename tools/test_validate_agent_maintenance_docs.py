#!/usr/bin/env python3
"""Regression tests for compact maintenance document validation."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "validate_agent_maintenance_docs.py"
SPEC = importlib.util.spec_from_file_location("validate_agent_maintenance_docs", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def write_yaml(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")


def fixture(root: Path) -> None:
    write_yaml(
        root / "docs/agent/document-registry.yaml",
        {
            "documents": [
                {
                    "id": "MASTER",
                    "path": "docs/master.md",
                    "scope": "test",
                    "lanes": ["test"],
                    "status": "canonical",
                    "context_role": "escalation",
                },
                {
                    "id": "TEST-DOMAIN",
                    "path": "docs/agent/contracts/test.yaml",
                    "scope": "test",
                    "lanes": ["test"],
                    "status": "canonical",
                    "context_role": "compact",
                },
            ]
        },
    )
    (root / "docs/master.md").write_text("# Master\n\n#rule\n", encoding="utf-8")
    write_yaml(
        root / MODULE.DOMAIN_SCHEMA_PATH,
        {
            "schema_id": "ASA-AGENT-DOMAIN-CONTRACT-V1",
            "id_rules": {
                "contract_id": r"^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-DOMAIN$",
                "invariant_id": r"^[A-Z][A-Z0-9]*-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]{3}$",
            },
            "required_top_level": [
                "schema_version",
                "contract_id",
                "domain",
                "registry_document_id",
                "master_documents",
                "invariants",
            ],
            "invariant_required_fields": ["id", "statement", "master_refs", "applies_to"],
            "master_ref_required_fields": ["document", "section"],
            "forbidden_top_level": ["active_task", "checkpoint", "head_sha"],
        },
    )
    write_yaml(
        root / MODULE.SURFACE_SCHEMA_PATH,
        {
            "schema_id": "ASA-AGENT-SURFACE-MAP-V1",
            "id_rules": {
                "surface_id": r"^SURF-[A-Z0-9]+(?:-[A-Z0-9]+)*$",
                "control_id": r"^CTRL-[A-Z0-9]+(?:-[A-Z0-9]+)*$",
                "invariant_id": r"^[A-Z][A-Z0-9]*-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]{3}$",
                "test_id": r"^TST-[A-Z0-9]+(?:-[A-Z0-9]+)*$",
            },
            "required_top_level": ["schema_version", "context", "surfaces"],
            "forbidden_top_level": ["lane", "active_task", "checkpoint", "head_sha"],
            "surface_required_fields": ["id", "routes", "implementation", "invariants", "tests"],
            "control_required_fields": ["id", "change_class", "files", "invariants", "tests"],
            "allowed_change_classes": ["L0_LOCAL_UI", "L1_UI_BEHAVIOR", "L2_DOMAIN_MUTATION", "L3_CRITICAL"],
        },
    )
    (root / "docs/agent/contracts").mkdir(parents=True, exist_ok=True)
    (root / "docs/agent/surfaces").mkdir(parents=True, exist_ok=True)
    write_yaml(root / "docs/testing/test-catalog.yaml", {"tests": []})
    write_yaml(
        root / "docs/testing/active-task-tests.yaml",
        {"tests": [{"id": "TST-TEST-001"}]},
    )

def valid_contract() -> dict:
    return {
        "schema_version": "1.0.0",
        "contract_id": "TST-DOMAIN",
        "domain": "test",
        "registry_document_id": "TEST-DOMAIN",
        "master_documents": ["MASTER"],
        "invariants": [
            {
                "id": "TST-INV-001",
                "statement": "One stable invariant.",
                "master_refs": [{"document": "MASTER", "section": "#rule"}],
                "applies_to": ["thing"],
            }
        ],
    }


def valid_surface() -> dict:
    return {
        "schema_version": "1.0.0",
        "context": "test",
        "surfaces": [
            {
                "id": "SURF-TEST-HOME",
                "routes": ["/#/test"],
                "implementation": {"files": ["apps/test.ts"]},
                "invariants": ["TST-INV-001"],
                "tests": ["TST-TEST-001"],
                "controls": [
                    {
                        "id": "CTRL-TEST-SAVE",
                        "change_class": "L2_DOMAIN_MUTATION",
                        "files": ["apps/test.ts"],
                        "invariants": ["TST-INV-001"],
                        "tests": ["TST-TEST-001"],
                    }
                ],
            }
        ],
    }

class MaintenanceDocsTests(unittest.TestCase):
    def test_valid_contract_and_surface_pass(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            (root / "apps").mkdir()
            (root / "apps/test.ts").write_text("export {};\n", encoding="utf-8")
            write_yaml(root / "docs/agent/contracts/test.yaml", valid_contract())
            write_yaml(root / "docs/agent/surfaces/test.yaml", valid_surface())
            self.assertEqual(MODULE.validate(root), [])

    def test_invalid_invariant_id_fails(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            contract = valid_contract()
            contract["invariants"][0]["id"] = "bad"
            write_yaml(root / "docs/agent/contracts/test.yaml", contract)
            errors = MODULE.validate(root)
            self.assertTrue(any("invalid format" in item for item in errors))

    def test_live_state_is_forbidden_in_domain_contract(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            contract = valid_contract()
            contract["checkpoint"] = "do-not-copy-live-state"
            write_yaml(root / "docs/agent/contracts/test.yaml", contract)
            errors = MODULE.validate(root)
            self.assertTrue(any("live-state field checkpoint" in item for item in errors))

    def test_surface_unknown_invariant_fails(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            (root / "apps").mkdir()
            (root / "apps/test.ts").write_text("export {};\n", encoding="utf-8")
            write_yaml(root / "docs/agent/contracts/test.yaml", valid_contract())
            surface = valid_surface()
            surface["surfaces"][0]["invariants"] = ["TST-INV-999"]
            write_yaml(root / "docs/agent/surfaces/test.yaml", surface)
            errors = MODULE.validate(root)
            self.assertTrue(any("unknown invariant TST-INV-999" in item for item in errors))

    def test_surface_missing_implementation_file_fails(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            write_yaml(root / "docs/agent/contracts/test.yaml", valid_contract())
            write_yaml(root / "docs/agent/surfaces/test.yaml", valid_surface())
            errors = MODULE.validate(root)
            self.assertTrue(any("implementation path does not exist" in item for item in errors))

    def test_master_ref_must_point_to_declared_master(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            contract = valid_contract()
            contract["invariants"][0]["master_refs"] = [
                {"document": "OTHER", "section": "#rule"}
            ]
            write_yaml(root / "docs/agent/contracts/test.yaml", contract)
            errors = MODULE.validate(root)
            self.assertTrue(any("master_documents entry" in item for item in errors))

    def test_master_ref_anchor_must_exist_in_document(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            contract = valid_contract()
            contract["invariants"][0]["master_refs"] = [
                {"document": "MASTER", "section": "ATT-999"}
            ]
            write_yaml(root / "docs/agent/contracts/test.yaml", contract)
            errors = MODULE.validate(root)
            self.assertTrue(any("missing anchor ATT-999" in item for item in errors))




    def test_surface_map_cannot_store_execution_lane(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            (root / "apps").mkdir()
            (root / "apps/test.ts").write_text("export {};\n", encoding="utf-8")
            write_yaml(root / "docs/agent/contracts/test.yaml", valid_contract())
            surface = valid_surface()
            surface["lane"] = "test"
            write_yaml(root / "docs/agent/surfaces/test.yaml", surface)
            errors = MODULE.validate(root)
            self.assertTrue(any("must not contain routing/live-state field lane" in item for item in errors), errors)

    def test_surface_context_requires_one_compact_registry_route(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            (root / "apps").mkdir()
            (root / "apps/test.ts").write_text("export {};\n", encoding="utf-8")
            write_yaml(root / "docs/agent/contracts/test.yaml", valid_contract())
            write_yaml(root / "docs/agent/surfaces/test.yaml", valid_surface())
            registry_path = root / "docs/agent/document-registry.yaml"
            registry = yaml.safe_load(registry_path.read_text(encoding="utf-8"))
            compact = next(item for item in registry["documents"] if item["id"] == "TEST-DOMAIN")
            compact["lanes"] = ["test", "other"]
            write_yaml(registry_path, registry)
            errors = MODULE.validate(root)
            self.assertTrue(any("exactly one canonical compact-document lane" in item for item in errors), errors)

    def test_surface_cannot_use_invariant_from_another_bounded_context(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            (root / "apps").mkdir()
            (root / "apps/test.ts").write_text("export {};\n", encoding="utf-8")
            contract = valid_contract()
            contract["domain"] = "other"
            write_yaml(root / "docs/agent/contracts/test.yaml", contract)
            write_yaml(root / "docs/agent/surfaces/test.yaml", valid_surface())
            errors = MODULE.validate(root)
            self.assertTrue(any("expected 'test'" in item for item in errors), errors)

    def test_surface_test_id_must_be_registered(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            (root / "apps").mkdir()
            (root / "apps/test.ts").write_text("export {};\n", encoding="utf-8")
            write_yaml(root / "docs/agent/contracts/test.yaml", valid_contract())
            surface = valid_surface()
            surface["surfaces"][0]["tests"] = ["TST-NOT-REGISTERED-001"]
            write_yaml(root / "docs/agent/surfaces/test.yaml", surface)
            errors = MODULE.validate(root)
            self.assertTrue(any("unregistered test" in item for item in errors))


if __name__ == "__main__":
    unittest.main(verbosity=2)
