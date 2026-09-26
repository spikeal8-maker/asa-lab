#!/usr/bin/env python3
"""Fresh-agent regression tests for the one-shot preflight command."""

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
SCRIPT = HERE / "agent_preflight.py"
SPEC = importlib.util.spec_from_file_location("agent_preflight", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def build_repo(root: Path) -> None:
    git(root, "init", "-q", "-b", "main")
    git(root, "config", "user.email", "test@example.com")
    git(root, "config", "user.name", "Test User")

    (root / "contexts/electronics").mkdir(parents=True)
    (root / "docs/execution").mkdir(parents=True)
    (root / "docs/agent").mkdir(parents=True)
    (root / "contexts/electronics/state.txt").write_text("stable\n", encoding="utf-8")
    (root / "AGENTS.md").write_text("policy\n", encoding="utf-8")
    (root / "docs/agent/document-registry.yaml").write_text(
        yaml.safe_dump({"documents": []}, sort_keys=False),
        encoding="utf-8",
    )

    current = {
        "development_policy": {"mode": "direct_main"},
        "task": {
            "id": "TASK-ELECTRONICS-PREFLIGHT-001",
            "issue": 1,
            "branch": "main",
            "base_branch": "main",
            "pr": None,
            "status": "in_progress",
            "checkpoint": "gov4_preflight",
            "owner_acceptance": "pending",
        },
        "revisions": {"head_sha": "a" * 40},
        "gates": {
            "focused": {
                "workflow": "Test",
                "commands": ["pnpm test:electronics"],
            }
        },
        "primary_lane": {
            "id": "electronics",
            "owned_paths": ["contexts/electronics/**"],
        },
        "integration": {
            "shared_paths": ["AGENTS.md", "package.json"],
        },
        "blocking": [],
    }
    (root / "docs/execution/current.yaml").write_text(
        yaml.safe_dump(current, sort_keys=False),
        encoding="utf-8",
    )

    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "baseline")
    git(root, "remote", "add", "origin", ".")
    git(root, "fetch", "-q", "origin", "refs/heads/main:refs/remotes/origin/main")


class AgentPreflightTests(unittest.TestCase):
    def build(self, root: Path):
        with patch.object(MODULE.agent_recover, "_process_snapshot", return_value=[]):
            return MODULE.build_preflight(
                root,
                scope="electronics",
                skip_control_plane=True,
            )

    def test_fresh_clean_agent_gets_one_safe_start_package_without_mutation(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            before = git(root, "rev-parse", "HEAD")
            result = self.build(root)
            after = git(root, "rev-parse", "HEAD")

        self.assertEqual(result["mode"], "SAFE_TO_START")
        self.assertEqual(result["scope"], "electronics")
        self.assertEqual(result["git"]["branch"], "main")
        self.assertEqual(result["git"]["dirty_paths"], [])
        self.assertEqual(result["gates"]["focused"], ["pnpm test:electronics"])
        self.assertEqual(before, after)

    def test_missing_origin_blocks_freshness_instead_of_guessing(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            git(root, "remote", "remove", "origin")
            result = self.build(root)

        self.assertEqual(result["mode"], "BLOCKED_GIT_FRESHNESS")
        self.assertEqual(result["remote_refresh"]["status"], "FAIL")

    def test_dirty_checkout_requires_recovery(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            (root / "contexts/electronics/state.txt").write_text(
                "interrupted\n",
                encoding="utf-8",
            )
            result = self.build(root)

        self.assertEqual(result["mode"], "RECOVERY_REQUIRED")
        self.assertIn(
            "contexts/electronics/state.txt",
            result["git"]["dirty_paths"],
        )

    def test_other_dirty_worktree_with_same_scope_requires_handoff(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            other = root.parent / f"{root.name}-other"
            git(root, "branch", "other")
            git(root, "worktree", "add", "-q", str(other), "other")
            try:
                (other / "contexts/electronics/state.txt").write_text(
                    "parallel edit\n",
                    encoding="utf-8",
                )
                result = self.build(root)
            finally:
                git(root, "worktree", "remove", "--force", str(other))

        self.assertEqual(result["mode"], "WAITING_HANDOFF")
        self.assertEqual(
            result["worktree_overlaps"][0]["overlap_paths"],
            ["contexts/electronics/state.txt"],
        )

    def test_clean_worktree_with_cyrillic_path_is_not_a_false_handoff(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            other = root.parent / f"{root.name}-моделирование"
            git(root, "branch", "other")
            git(root, "worktree", "add", "-q", str(other), "other")
            try:
                result = self.build(root)
            finally:
                git(root, "worktree", "remove", "--force", str(other))
        self.assertEqual(result["mode"], "SAFE_TO_START")
        self.assertEqual(result["worktree_overlaps"], [])

    def test_acceptance_blocker_does_not_block_bounded_implementation(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            path = root / "docs/execution/current.yaml"
            current = yaml.safe_load(path.read_text(encoding="utf-8"))
            current["blocking"] = [
                {
                    "id": "ACCEPTANCE",
                    "kind": "acceptance_blocker",
                    "lane": "electronics",
                    "task_id": "TASK-ELECTRONICS-PREFLIGHT-001",
                    "blocks": ["owner_acceptance"],
                    "reason": "owner evidence pending",
                    "evidence": "docs/evidence.md",
                }
            ]
            path.write_text(yaml.safe_dump(current, sort_keys=False), encoding="utf-8")
            result = self.build(root)

        self.assertEqual(result["mode"], "RECOVERY_REQUIRED")
        self.assertEqual(result["execution_blocking"], [])

    def test_execution_blocker_is_fail_closed(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            path = root / "docs/execution/current.yaml"
            current = yaml.safe_load(path.read_text(encoding="utf-8"))
            current["blocking"] = [
                {
                    "id": "EXECUTION",
                    "kind": "execution_blocker",
                    "lane": "electronics",
                    "task_id": "TASK-ELECTRONICS-PREFLIGHT-001",
                    "blocks": ["implementation"],
                    "reason": "dependency missing",
                    "evidence": "docs/evidence.md",
                }
            ]
            path.write_text(yaml.safe_dump(current, sort_keys=False), encoding="utf-8")
            result = self.build(root)

        self.assertEqual(result["mode"], "BLOCKED_EXECUTION")
        self.assertEqual(len(result["execution_blocking"]), 1)

    def test_text_contains_context_and_preflight_summary(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            result = self.build(root)
            rendered = MODULE.render_text(result)

        self.assertIn("ASA Lab agent preflight: SAFE_TO_START", rendered)
        self.assertIn("BRANCH: main", rendered)
        self.assertIn("GATES:", rendered)
        self.assertIn("--- scoped context ---", rendered)
        self.assertIn("scope: electronics", rendered)

    def test_check_mode_returns_two_when_recovery_is_required(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            (root / "contexts/electronics/state.txt").write_text(
                "interrupted\n",
                encoding="utf-8",
            )
            with patch.object(MODULE.agent_recover, "_process_snapshot", return_value=[]):
                with patch.object(
                    sys,
                    "argv",
                    [
                        str(SCRIPT),
                        "--root",
                        str(root),
                        "--scope",
                        "electronics",
                        "--skip-control-plane",
                        "--check",
                    ],
                ):
                    code = MODULE.main()

        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
