#!/usr/bin/env python3
"""Behavioural regression tests for the compact lane context command."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "agent_context.py"
SPEC = importlib.util.spec_from_file_location("agent_context", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def fixture(root: Path, checkpoint: str = "math_10a3_meter") -> dict:
    (root / "docs/product/electronics").mkdir(parents=True)
    (root / "docs/product/electronics/README.md").write_text(
        "# Электроника\n\n"
        "### MATH-10 — измерительные приборы\n\n"
        "#### MATH-10A2 — постоянный ток\n\n"
        "#### Checkpoint MATH-10A3 — сопротивление\n\n"
        "### OPT-0 — геометрический baseline\n",
        encoding="utf-8",
    )
    (root / "AGENTS.md").write_text("policy", encoding="utf-8")
    registry_path = root / "docs/agent/document-registry.yaml"
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(
        yaml.safe_dump(
            {
                "documents": [
                    {
                        "id": "ELECTRONICS-MASTER",
                        "path": "docs/product/electronics/README.md",
                        "lanes": ["electronics"],
                        "status": "canonical",
                        "context_role": "escalation",
                        "authority": "electronics_semantics",
                    }
                ]
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    document = {
        "development_policy": {"mode": "direct_main"},
        "task": {
            "id": "TASK-PRIMARY-001",
            "issue": 1,
            "status": "in_progress",
            "checkpoint": "primary_checkpoint",
            "owner_acceptance": "pending",
            "branch": "main",
            "base_branch": "main",
            "pr": None,
        },
        "revisions": {"head_sha": "a" * 40},
        "gates": {"focused": {"commands": ["pnpm gate:primary"]}},
        "primary_lane": {"id": "primary", "owned_paths": ["contexts/primary/**"]},
        "parallel_lanes": [
            {
                "id": "electronics",
                "owned_paths": ["docs/product/electronics/**"],
                "task": {
                    "id": "TASK-ELECTRONICS-DOCS-001",
                    "issue": 63,
                    "status": "in_progress",
                    "checkpoint": checkpoint,
                    "owner_acceptance": "pending",
                    "branch": "main",
                    "base_branch": "main",
                    "pr": None,
                },
                "revisions": {"head_sha": "b" * 40},
                "gates": {"focused": {"commands": ["pnpm gate:electronics-m1"]}},
            }
        ],
        "integration": {"shared_paths": ["AGENTS.md"]},
        "blocking": [],
    }
    path = root / "docs/execution/current.yaml"
    path.parent.mkdir(parents=True)
    path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")
    return document


def available(*paths: str) -> dict:
    return {"state": "available", "message": None, "paths": list(paths)}


def lane(document: dict, lane_id: str = "electronics") -> dict:
    return next(item for item in MODULE.collect_lanes(document) if item["id"] == lane_id)


def run_cli(root: Path, *arguments: str, env: dict[str, str] | None = None):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(root), *arguments],
        capture_output=True,
        check=False,
        env=env,
    )


class AgentContextTests(unittest.TestCase):
    def test_collects_primary_and_parallel_lanes(self):
        with tempfile.TemporaryDirectory() as raw:
            document = fixture(Path(raw))
            self.assertEqual(
                [item["id"] for item in MODULE.collect_lanes(document)],
                ["primary", "electronics"],
            )

    def test_primary_lane_milestone_is_exposed_in_compact_context(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            document = fixture(root)
            document["primary_lane"]["milestone"] = {
                "id": "VSCR-M1-002",
                "owner_authorization": "accepted",
            }
            context = MODULE.build_context(
                root, document, lane(document, "primary"), git_status=available()
            )
            rendered = MODULE.render_text(context)
        self.assertEqual(
            context["milestone"],
            {"id": "VSCR-M1-002", "owner_authorization": "accepted"},
        )
        self.assertIn("milestone: VSCR-M1-002", rendered)
        self.assertIn("milestoneOwnerAuthorization: accepted", rendered)

    def test_delivery_workflow_is_always_in_compact_context(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            document = fixture(root)
            context = MODULE.build_context(
                root, document, lane(document), git_status=available()
            )
            rendered = MODULE.render_text(context)
        self.assertEqual(
            context["delivery_workflow"],
            "docs/delivery/AGENT_CHANGE_WORKFLOW.md",
        )
        self.assertIn("delivery: docs/delivery/AGENT_CHANGE_WORKFLOW.md", rendered)
        self.assertIn("  docs/delivery/AGENT_CHANGE_WORKFLOW.md", rendered)

    def test_git_status_failure_is_not_a_clean_tree(self):
        with tempfile.TemporaryDirectory() as raw:
            snapshot = MODULE._git_status(Path(raw))
        self.assertEqual(snapshot["state"], "unavailable")
        self.assertIsNone(snapshot["paths"])
        self.assertTrue(snapshot["message"])

    def test_missing_git_executable_is_reported(self):
        with patch.object(MODULE.subprocess, "run", side_effect=FileNotFoundError()):
            snapshot = MODULE._git_status(Path("."))
        self.assertEqual(snapshot["state"], "unavailable")
        self.assertEqual(snapshot["message"], "git executable unavailable")
        self.assertIsNone(snapshot["paths"])

    def test_dirty_lane_and_shared_paths_are_counted_independently(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            document = fixture(root)
            context = MODULE.build_context(
                root,
                document,
                lane(document),
                git_status=available(
                    "docs/product/electronics/README.md",
                    "AGENTS.md",
                    "outside.txt",
                ),
            )
        self.assertEqual(context["dirty"]["total_count"], 3)
        self.assertEqual(
            context["dirty"]["lane_paths"],
            ["docs/product/electronics/README.md"],
        )
        self.assertEqual(context["dirty"]["shared_paths"], ["AGENTS.md"])
        self.assertEqual(context["dirty"]["overlap_paths"], [])

    def test_lane_shared_overlap_is_visible_and_advisory(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            document = fixture(root)
            document["integration"]["shared_paths"].append(
                "docs/product/electronics/**"
            )
            context = MODULE.build_context(
                root,
                document,
                lane(document),
                git_status=available("docs/product/electronics/README.md"),
            )
            rendered = MODULE.render_text(context)
        self.assertEqual(
            context["dirty"]["overlap_paths"],
            ["docs/product/electronics/README.md"],
        )
        self.assertIn("handoff", rendered.lower())
        self.assertIn("advisory", rendered.lower())

    def test_more_than_twenty_paths_are_disclosed_without_json_truncation(self):
        paths = tuple(f"docs/product/electronics/file-{index:02}.md" for index in range(25))
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            document = fixture(root)
            context = MODULE.build_context(
                root, document, lane(document), git_status=available(*paths)
            )
            rendered = MODULE.render_text(context)
            payload = json.loads(json.dumps(context, ensure_ascii=False))
        self.assertIn("... and 5 more", rendered)
        self.assertEqual(len(payload["dirty"]["lane_paths"]), 25)
        self.assertEqual(len(payload["dirty"]["all_paths"]), 25)

    def test_porcelain_rename_and_copy_keep_both_paths(self):
        payload = b"R  new/name.txt\0old/name.txt\0C  copy/new.txt\0copy/old.txt\0"
        self.assertEqual(
            MODULE._parse_porcelain(payload),
            ["new/name.txt", "old/name.txt", "copy/new.txt", "copy/old.txt"],
        )

    def test_checkpoint_parser_is_precise_and_general(self):
        cases = {
            "math_10a3_anything": "MATH-10A3",
            "math_10a2_anything": "MATH-10A2",
            "math_10b_anything": "MATH-10B",
            "opt_0_anything": "OPT-0",
        }
        for checkpoint, expected in cases.items():
            with self.subTest(checkpoint=checkpoint):
                self.assertEqual(MODULE._checkpoint_hint(checkpoint), expected)

    def test_exact_checkpoint_heading_wins_over_parent_heading(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            document = fixture(root, checkpoint="math_10a3_meter")
            context = MODULE.build_context(
                root, document, lane(document), git_status=available()
            )
        self.assertEqual(context["checkpoint_marker"], "MATH-10A3")
        self.assertEqual(context["contract_section_resolution"], "found")
        self.assertEqual(context["contract_sections"][0]["line"], 7)
        self.assertIn("MATH-10A3", context["contract_sections"][0]["heading"])

    def test_missing_exact_checkpoint_heading_is_explicit(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            document = fixture(root, checkpoint="math_10b_supply")
            context = MODULE.build_context(
                root, document, lane(document), git_status=available()
            )
            rendered = MODULE.render_text(context)
        self.assertEqual(context["checkpoint_marker"], "MATH-10B")
        self.assertEqual(context["contract_section_resolution"], "not_found")
        self.assertEqual(context["contract_sections"], [])
        self.assertIn("exact section MATH-10B was not found", rendered)

    def test_utf8_subprocess_output_survives_windows_style_encoding_override(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            environment = os.environ.copy()
            environment["PYTHONIOENCODING"] = "cp1251"
            result = run_cli(root, "--scope", "electronics", env=environment)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = result.stdout.decode("utf-8", errors="strict")
        self.assertIn("сопротивление", output)
        self.assertIn("—", output)
        self.assertNotIn("�", output)

    def test_non_git_cli_and_check_fail_closed(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            plain = run_cli(root, "--scope", "electronics")
            check = run_cli(root, "--check")
            as_json = run_cli(root, "--scope", "electronics", "--json")
        self.assertNotEqual(plain.returncode, 0)
        text = plain.stdout.decode("utf-8", errors="strict")
        self.assertIn("gitStatus: unavailable", text)
        self.assertIn("workingTreeDirty: unknown", text)
        self.assertNotIn("workingTreeDirty: 0", text)
        self.assertIn("do not start writing", text)
        self.assertNotEqual(check.returncode, 0)
        payload = json.loads(as_json.stdout.decode("utf-8", errors="strict"))
        self.assertEqual(payload["gitStatus"], "unavailable")
        self.assertFalse(payload["dirty"]["known"])
        self.assertIsNone(payload["dirty"]["all_paths"])

    def test_missing_git_cli_fails_closed(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            environment = os.environ.copy()
            environment["PATH"] = ""
            result = run_cli(root, "--scope", "electronics", env=environment)
        self.assertNotEqual(result.returncode, 0)
        output = result.stdout.decode("utf-8", errors="strict")
        self.assertIn("gitStatus: unavailable", output)
        self.assertIn("git executable unavailable", output)

    def test_registry_routes_master_as_read_if_needed(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            document = fixture(root)
            context = MODULE.build_context(
                root, document, lane(document), git_status=available()
            )
            rendered = MODULE.render_text(context)
        self.assertEqual(
            context["document_routes"]["read_if_needed"][0]["id"],
            "ELECTRONICS-MASTER",
        )
        self.assertIn("readIfNeeded:", rendered)
        self.assertIn("ELECTRONICS-MASTER", rendered)

    def test_registered_but_not_routed_doc_is_not_called_unregistered(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            document = fixture(root)
            extra = root / "docs/product/electronics/ADR.md"
            extra.write_text("# ADR\n", encoding="utf-8")
            document["parallel_lanes"][0]["owned_paths"].append(
                "docs/product/electronics/ADR.md"
            )
            registry_path = root / "docs/agent/document-registry.yaml"
            registry = yaml.safe_load(registry_path.read_text(encoding="utf-8"))
            registry["documents"].append(
                {
                    "id": "OTHER-ADR",
                    "path": "docs/product/electronics/ADR.md",
                    "lanes": ["other"],
                    "status": "canonical",
                    "context_role": "escalation",
                    "authority": "other_architecture",
                }
            )
            registry_path.write_text(
                yaml.safe_dump(registry, sort_keys=False), encoding="utf-8"
            )
            context = MODULE.build_context(
                root, document, lane(document), git_status=available()
            )
        self.assertNotIn(
            "docs/product/electronics/ADR.md",
            context["unregistered_contract_documents"],
        )

    def test_delegated_provider_docs_are_not_called_unregistered(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            document = fixture(root)
            delegated = root / "docs/product/electronics/components/module.yaml"
            delegated.parent.mkdir(parents=True, exist_ok=True)
            delegated.write_text("component: test\n", encoding="utf-8")
            outside = root / "docs/product/electronics/provider-notes.md"
            outside.write_text("notes\n", encoding="utf-8")
            document["parallel_lanes"][0]["owned_paths"].extend(
                [
                    "docs/product/electronics/components/module.yaml",
                    "docs/product/electronics/provider-notes.md",
                ]
            )
            registry_path = root / "docs/agent/document-registry.yaml"
            registry = yaml.safe_load(registry_path.read_text(encoding="utf-8"))
            registry["documents"].append(
                {
                    "id": "ELECTRONICS-GUIDE",
                    "path": "docs/product/electronics/README.md",
                    "lanes": ["electronics"],
                    "status": "canonical",
                    "context_role": "compact",
                    "authority": "electronics_maintenance",
                    "delegated_roots": ["docs/product/electronics/components/**"],
                }
            )
            registry_path.write_text(
                yaml.safe_dump(registry, sort_keys=False), encoding="utf-8"
            )
            context = MODULE.build_context(
                root, document, lane(document), git_status=available()
            )
            rendered = MODULE.render_text(context)
        self.assertNotIn(
            "docs/product/electronics/components/module.yaml",
            context["unregistered_contract_documents"],
        )
        self.assertIn(
            "docs/product/electronics/provider-notes.md",
            context["unregistered_contract_documents"],
        )
        self.assertIn("delegatedDocs:", rendered)
        self.assertIn("docs/product/electronics/components/**", rendered)

    def test_normative_refs_are_visible_in_context(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            document = fixture(root)
            target = lane(document)
            target["task"]["normative_refs"] = [
                {"document": "ELECTRONICS-MASTER", "revision": "1.0"}
            ]
            context = MODULE.build_context(root, document, target, git_status=available())
            rendered = MODULE.render_text(context)
        self.assertIn("normativeRefs:", rendered)
        self.assertIn("ELECTRONICS-MASTER@1.0", rendered)


    def test_split_history_is_labelled_snapshot_not_current_learning_head(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            document = fixture(root)
            target = lane(document)
            target["revisions"] = {
                "kind": "split_history", "head_sha": None, "convergence_baseline_sha": "a" * 40,
                "observed_at": "2026-09-13T12:00:00Z",
                "main": {"branch": "main", "sha": "b" * 40},
                "recovery": {"branch": "recovery/example", "sha": "c" * 40},
                "bounded_review": {"branch": "codex/preview", "sha": "d" * 40},
            }
            context = MODULE.build_context(root, document, target, git_status=available())
            rendered = MODULE.render_text(context)
        self.assertIn("no integrated Learning HEAD", rendered)
        self.assertIn("recorded snapshot, not live remote HEADs", rendered)
        self.assertIn("historicalMergeBase: " + "a" * 40, rendered)
        self.assertIn("bounded_review: codex/preview @ " + "d" * 40, rendered)
        self.assertNotIn("head_sha: " + "a" * 40, rendered)
        self.assertIn("observations grant no authority", rendered)


if __name__ == "__main__":
    unittest.main(verbosity=2)
