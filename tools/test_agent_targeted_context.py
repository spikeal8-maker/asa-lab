#!/usr/bin/env python3
"""Regression tests for address-targeted agent context."""
from __future__ import annotations
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "agent_context.py"

def write_yaml(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")

def write_text(path: Path, text: str = "x") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
def fixture(root: Path) -> None:
    write_text(root / "AGENTS.md", "policy")
    write_text(root / "docs/delivery/AGENT_CHANGE_WORKFLOW.md", "workflow")
    write_text(root / "docs/product/electronics/README.md", "# Electronics\n## MATH-10\n")
    write_text(root / "docs/product/visual/README.md", "# Visual programming\n")
    write_text(root / "apps/web/src/electronics/TestSurface.tsx", "export const x = 1;\n")
    write_text(root / "apps/api/src/electronics-test.controller.ts", "export const y = 1;\n")
    write_yaml(
        root / "docs/agent/contracts/electronics.yaml",
        {
            "schema_version": "1.0.0",
            "contract_id": "ELEC-DOMAIN",
            "domain": "electronics",
            "registry_document_id": "ELECTRONICS-DOMAIN-CONTRACT",
            "master_documents": ["ELECTRONICS-MASTER"],
            "invariants": [
                {
                    "id": "ELEC-DOM-001",
                    "statement": "Simulation truth stays in the domain core.",
                    "master_refs": [{"document": "ELECTRONICS-MASTER", "section": "MATH-10"}],
                    "applies_to": ["simulation"],
                    "forbid": ["ui_as_authority"],
                }
            ],
        },
    )
    write_yaml(
        root / "docs/agent/surfaces/electronics.yaml",
        {
            "schema_version": "1.0.0",
            "context": "electronics",
            "surfaces": [
                {
                    "id": "SURF-ELECTRONICS-TEST",
                    "routes": ["#/electronics"],
                    "implementation": {
                        "files": [
                            "apps/web/src/electronics/TestSurface.tsx",
                            "apps/api/src/electronics-test.controller.ts",
                        ]
                    },
                    "invariants": ["ELEC-DOM-001"],
                    "tests": ["TST-ELECTRONICS-TARGET-001"],
                    "controls": [
                        {
                            "id": "CTRL-ELECTRONICS-RUN",
                            "label": "Run simulation",
                            "change_class": "L3_CRITICAL",
                            "files": [
                                "apps/web/src/electronics/TestSurface.tsx",
                                "apps/api/src/electronics-test.controller.ts",
                            ],
                            "commands": ["run_simulation"],
                            "invariants": ["ELEC-DOM-001"],
                            "tests": ["TST-ELECTRONICS-TARGET-001"],
                        }
                    ],
                }
            ],
        },
    )
    write_yaml(
        root / "docs/testing/test-catalog.yaml",
        {
            "tests": [
                {
                    "id": "TST-ELECTRONICS-TARGET-001",
                    "title": "Targeted electronics check",
                    "command": "pnpm test:electronics",
                }
            ]
        },
    )
    write_yaml(root / "docs/testing/active-task-tests.yaml", {"tests": []})
    write_yaml(
        root / "docs/agent/document-registry.yaml",
        {
            "documents": [
                {
                    "id": "ELECTRONICS-MASTER",
                    "path": "docs/product/electronics/README.md",
                    "lanes": ["electronics"],
                    "status": "canonical",
                    "context_role": "escalation",
                    "authority": "electronics_semantics",
                    "revision": "1.0",
                },
                {
                    "id": "ELECTRONICS-DOMAIN-CONTRACT",
                    "path": "docs/agent/contracts/electronics.yaml",
                    "lanes": ["electronics"],
                    "status": "canonical",
                    "context_role": "compact",
                    "authority": "electronics_compact_invariants",
                },
                {
                    "id": "VSCR-MASTER",
                    "path": "docs/product/visual/README.md",
                    "lanes": ["visual-programming"],
                    "status": "canonical",
                    "context_role": "escalation",
                    "authority": "visual_programming_target",
                },
            ]
        },
    )
    write_yaml(
        root / "docs/execution/current.yaml",
        {
            "development_policy": {"mode": "direct_main"},
            "task": {
                "id": "TASK-ELECTRONICS-DOCS-001",
                "issue": 63,
                "status": "in_progress",
                "checkpoint": "targeted_context",
                "owner_acceptance": "pending",
                "branch": "main",
                "base_branch": "main",
                "pr": None,
            },
            "revisions": {"head_sha": "a" * 40},
            "gates": {"focused": {"commands": ["pnpm test:electronics"]}},
            "primary_lane": {
                "id": "electronics",
                "owned_paths": ["apps/web/src/electronics/**", "apps/api/src/electronics-test.controller.ts"],
            },
            "parallel_lanes": [],
            "integration": {"shared_paths": ["AGENTS.md"]},
            "blocking": [],
        },
    )
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)


def run_cli(root: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(root), *args],
        capture_output=True,
        check=False,
    )


def text(result: subprocess.CompletedProcess[bytes]) -> str:
    return result.stdout.decode("utf-8", errors="strict") + result.stderr.decode("utf-8", errors="strict")
class TargetedAgentContextTests(unittest.TestCase):
    def test_path_resolves_only_relevant_context(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            result = run_cli(root, "--path", "apps/web/src/electronics/TestSurface.tsx")
        output = text(result)
        self.assertEqual(result.returncode, 0, output)
        self.assertIn("scope: electronics", output)
        self.assertIn("SURF-ELECTRONICS-TEST", output)
        self.assertIn("ELEC-DOM-001", output)
        self.assertIn("TST-ELECTRONICS-TARGET-001", output)
        self.assertNotIn("docs/product/visual/README.md", output)
        self.assertLess(len(output), 8000)

    def test_control_requires_challenge_review_for_l3(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            result = run_cli(root, "--control", "CTRL-ELECTRONICS-RUN")
        output = text(result)
        self.assertEqual(result.returncode, 0, output)
        self.assertIn("changeClass: L3_CRITICAL", output)
        self.assertIn("POST_STEP_REVIEW: REQUIRED", output)
        self.assertIn("CHALLENGE_REVIEW: REQUIRED", output)
        self.assertIn("run_simulation", output)
    def test_surface_and_windows_path_are_supported(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            surface = run_cli(root, "--surface", "SURF-ELECTRONICS-TEST")
            windows_path = run_cli(root, "--path", r"apps\web\src\electronics\TestSurface.tsx")
        self.assertEqual(surface.returncode, 0, text(surface))
        self.assertEqual(windows_path.returncode, 0, text(windows_path))
        self.assertIn("CTRL-ELECTRONICS-RUN", text(surface))
        self.assertIn("target: apps/web/src/electronics/TestSurface.tsx", text(windows_path))

    def test_unmapped_path_fails_instead_of_guessing(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            result = run_cli(root, "--path", "apps/web/src/unknown.tsx")
        output = text(result)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("is not mapped to an agent surface", output)

    def test_render_budget_fails_closed(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture(root)
            path = root / "docs/agent/contracts/electronics.yaml"
            contract = yaml.safe_load(path.read_text(encoding="utf-8"))
            contract["invariants"][0]["statement"] = "x" * 9000
            write_yaml(path, contract)
            result = run_cli(root, "--path", "apps/web/src/electronics/TestSurface.tsx")
        output = text(result)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("budget is 8000", output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
