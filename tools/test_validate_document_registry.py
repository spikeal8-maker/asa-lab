#!/usr/bin/env python3
"""Regression tests for the document authority registry validator."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "validate_document_registry.py"
SPEC = importlib.util.spec_from_file_location("validate_document_registry", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def write_file(root: Path, relative: str, content: str = "x") -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def registry(root: Path) -> dict:
    write_file(root, "AGENTS.md")
    write_file(root, "docs/execution/current.yaml")
    data = {
        "schema_version": "1.0.0",
        "coverage": "partial",
        "unregistered_documents_allowed": True,
        "status_values": [
            "canonical",
            "supporting",
            "historical",
            "superseded",
            "review_only",
        ],
        "documents": [
            {
                "id": "POLICY",
                "path": "AGENTS.md",
                "scope": "global",
                "kind": "policy",
                "status": "canonical",
                "authority": "engineering_policy",
                "read_when": ["always"],
            },
            {
                "id": "STATE",
                "path": "docs/execution/current.yaml",
                "scope": "global",
                "kind": "live_state",
                "status": "canonical",
                "authority": "execution_state",
                "read_when": ["active_task"],
            },
        ],
    }
    return data


class DocumentRegistryTests(unittest.TestCase):
    def test_valid_registry_passes(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            data = registry(root)
            self.assertEqual(MODULE.validate_registry(root, data), [])

    def test_duplicate_canonical_authority_fails(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            data = registry(root)
            write_file(root, "SECOND.md")
            data["documents"].append(
                {
                    "id": "SECOND",
                    "path": "SECOND.md",
                    "scope": "global",
                    "kind": "policy",
                    "status": "canonical",
                    "authority": "engineering_policy",
                    "read_when": ["always"],
                }
            )
            errors = MODULE.validate_registry(root, data)
            self.assertTrue(any("duplicated" in error for error in errors))

    def test_missing_registered_path_fails(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            data = registry(root)
            data["documents"][0]["path"] = "missing.md"
            errors = MODULE.validate_registry(root, data)
            self.assertIn("registered document does not exist: missing.md", errors)

    def test_superseded_requires_known_canonical_target(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            data = registry(root)
            write_file(root, "OLD.md")
            data["documents"].append(
                {
                    "id": "OLD",
                    "path": "OLD.md",
                    "scope": "global",
                    "kind": "historical_plan",
                    "status": "superseded",
                    "authority": "none",
                    "read_when": ["history"],
                    "superseded_by": "UNKNOWN",
                }
            )
            errors = MODULE.validate_registry(root, data)
            self.assertTrue(any("unknown id UNKNOWN" in error for error in errors))

    def test_only_current_yaml_can_be_live_state(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            data = registry(root)
            data["documents"][1]["path"] = "AGENTS.md"
            errors = MODULE.validate_registry(root, data)
            self.assertTrue(any("only live_state" in error for error in errors))

    def test_full_coverage_cannot_allow_unregistered_documents(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            data = registry(root)
            data["coverage"] = "full"
            errors = MODULE.validate_registry(root, data)
            self.assertIn("full coverage cannot allow unregistered documents", errors)

    def test_v11_requires_routing_fields(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            data = registry(root)
            data["schema_version"] = "1.1.0"
            data["strict_task_scopes"] = []
            errors = MODULE.validate_registry(root, data)
            self.assertTrue(any("context_role" in error for error in errors))
            self.assertTrue(any(".lanes" in error for error in errors))

    def test_v11_routing_fields_pass(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            data = registry(root)
            data["schema_version"] = "1.1.0"
            data["strict_task_scopes"] = []
            data["context_role_values"] = MODULE.CONTEXT_ROLE_VALUES
            for item in data["documents"]:
                item["lanes"] = ["*"]
                item["context_role"] = "root"
            self.assertEqual(MODULE.validate_registry(root, data), [])

    def test_delegated_document_root_passes_for_canonical_compact_provider(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            data = registry(root)
            data["schema_version"] = "1.1.0"
            data["strict_task_scopes"] = []
            data["context_role_values"] = MODULE.CONTEXT_ROLE_VALUES
            for item in data["documents"]:
                item["lanes"] = ["*"]
                item["context_role"] = "root"
            write_file(root, "docs/provider/GUIDE.md")
            (root / "docs/provider/components").mkdir(parents=True)
            data["documents"].append(
                {
                    "id": "PROVIDER",
                    "path": "docs/provider/GUIDE.md",
                    "scope": "provider",
                    "lanes": ["provider"],
                    "kind": "maintenance_guide",
                    "status": "canonical",
                    "authority": "provider_maintenance",
                    "context_role": "compact",
                    "read_when": ["provider_change"],
                    "delegated_roots": ["docs/provider/components/**"],
                }
            )
            self.assertEqual(MODULE.validate_registry(root, data), [])

    def test_delegated_document_root_rejects_unsafe_or_noncompact_provider(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            data = registry(root)
            data["schema_version"] = "1.1.0"
            data["strict_task_scopes"] = []
            data["context_role_values"] = MODULE.CONTEXT_ROLE_VALUES
            for item in data["documents"]:
                item["lanes"] = ["*"]
                item["context_role"] = "root"
            data["documents"][0]["delegated_roots"] = ["../outside/**"]
            errors = MODULE.validate_registry(root, data)
            self.assertTrue(any("canonical compact" in error for error in errors))
            self.assertTrue(any("unsafe root" in error for error in errors))

    def test_encoding_guard_rejects_question_mark_corruption(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            data = registry(root)
            write_file(root, "AGENTS.md", "broken " + ("?" * 3) + " text")
            errors = MODULE.validate_registry(root, data)
            self.assertTrue(any("encoding guard" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
