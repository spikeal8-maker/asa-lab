#!/usr/bin/env python3
"""Regression tests for the read-only agent recovery command."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SCRIPT = HERE / "agent_recover.py"
SPEC = importlib.util.spec_from_file_location("agent_recover", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=root, capture_output=True, text=True, check=True
    )
    return result.stdout.strip()


def build_repo(root: Path) -> None:
    git(root, "init", "-q", "-b", "main")
    git(root, "config", "user.email", "test@example.com")
    git(root, "config", "user.name", "Test User")
    (root / "contexts/electronics").mkdir(parents=True)
    (root / "docs/execution").mkdir(parents=True)
    (root / "contexts/electronics/state.txt").write_text("stable\n", encoding="utf-8")
    document = {
        "task": {
            "id": "TASK-PRIMARY-001",
            "issue": 1,
            "branch": "main",
            "base_branch": "main",
            "status": "done",
            "checkpoint": "primary_done",
        },
        "primary_lane": {"id": "primary", "owned_paths": ["contexts/primary/**"]},
        "parallel_lanes": [
            {
                "id": "electronics",
                "owned_paths": ["contexts/electronics/**"],
                "task": {
                    "id": "TASK-ELECTRONICS-RECOVERY-001",
                    "issue": 2,
                    "branch": "main",
                    "base_branch": "main",
                    "status": "in_progress",
                    "checkpoint": "recovery_contract",
                },
            }
        ],
    }
    (root / "docs/execution/current.yaml").write_text(
        yaml.safe_dump(document, sort_keys=False), encoding="utf-8"
    )
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "baseline")
    git(root, "update-ref", "refs/remotes/origin/main", "HEAD")


class AgentRecoverTests(unittest.TestCase):
    def snapshot(self, root: Path):
        with patch.object(MODULE, "_process_snapshot", return_value=[]):
            return MODULE.build_snapshot(root, "electronics")

    def test_clean_repo_is_safe_to_start(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            snapshot = self.snapshot(root)
        self.assertEqual(snapshot["mode"], "SAFE_TO_START")
        self.assertEqual(snapshot["git"]["dirty_paths"], [])
        self.assertEqual(snapshot["task"]["id"], "TASK-ELECTRONICS-RECOVERY-001")
        self.assertEqual(snapshot["git"]["vs_origin_main"], {"left_only": 0, "right_only": 0})

    def test_dirty_lane_enters_recovery_without_mutating_head(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            before = git(root, "rev-parse", "HEAD")
            path = root / "contexts/electronics/state.txt"
            path.write_text("interrupted\n", encoding="utf-8")
            snapshot = self.snapshot(root)
            after = git(root, "rev-parse", "HEAD")
        self.assertEqual(snapshot["mode"], "RECOVERY_REQUIRED")
        self.assertEqual(snapshot["git"]["dirty_in_scope"], ["contexts/electronics/state.txt"])
        self.assertEqual(before, after)

    def test_foreign_dirty_path_still_requires_recovery(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            (root / "outside.txt").write_text("partial\n", encoding="utf-8")
            snapshot = self.snapshot(root)
        self.assertEqual(snapshot["mode"], "RECOVERY_REQUIRED")
        self.assertEqual(snapshot["git"]["dirty_in_scope"], [])
        self.assertIn("outside.txt", snapshot["git"]["dirty_paths"])

    def test_unknown_scope_is_rejected(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            with self.assertRaisesRegex(ValueError, "unknown lane"):
                MODULE.build_snapshot(root, "missing")

    def test_check_mode_returns_two_for_dirty_repo(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            (root / "outside.txt").write_text("partial\n", encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--root", str(root), "--scope", "electronics", "--check"],
                capture_output=True,
                check=False,
            )
        self.assertEqual(result.returncode, 2)
        self.assertIn(b"RECOVERY_REQUIRED", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
