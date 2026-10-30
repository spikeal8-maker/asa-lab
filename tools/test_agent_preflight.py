#!/usr/bin/env python3
"""Fresh-agent regression tests for the one-shot preflight command."""

from __future__ import annotations

import importlib.util
from contextlib import contextmanager
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
    def build(self, root: Path, **options):
        with patch.object(MODULE.agent_recover, "_process_snapshot", return_value=[]):
            return MODULE.build_preflight(
                root,
                scope="electronics",
                skip_control_plane=True,
                **options,
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

    @contextmanager
    def other_worktree(self, root: Path):
        other = root.parent / f"{root.name}-other"
        git(root, "worktree", "add", "-q", "-b", "other", str(other))
        try:
            yield other
        finally:
            git(root, "worktree", "remove", "--force", str(other))

    def add_shared_workflow(self, root: Path):
        path = root / "docs/execution/current.yaml"
        current = yaml.safe_load(path.read_text(encoding="utf-8"))
        current["integration"]["shared_paths"].append(".github/workflows/**")
        path.write_text(yaml.safe_dump(current, sort_keys=False), encoding="utf-8")
        git(root, "add", "docs/execution/current.yaml")
        git(root, "commit", "-qm", "shared workflow policy")

    def test_planned_file_allows_independent_dirty_workflow_but_default_remains_conservative(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            self.add_shared_workflow(root)
            with self.other_worktree(root) as other:
                (other / ".github/workflows").mkdir(parents=True)
                (other / ".github/workflows/other.yml").write_text("parallel\n", encoding="utf-8")
                planned = self.build(root, planned_paths=["contexts/electronics/state.txt"])
                conservative = self.build(root)
        self.assertEqual(planned["mode"], "SAFE_TO_START")
        self.assertEqual(conservative["mode"], "WAITING_HANDOFF")

    def test_planned_overlap_detects_staged_unstaged_deleted_and_nested_untracked_files(self):
        for kind in ("staged", "unstaged", "deleted", "untracked"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as raw:
                root = Path(raw)
                build_repo(root)
                with self.other_worktree(root) as other:
                    relative = "contexts/electronics/state.txt"
                    path = other / relative
                    if kind == "untracked":
                        relative = "new/nested/file.txt"
                        path = other / relative
                        path.parent.mkdir(parents=True)
                    if kind == "deleted":
                        path.unlink()
                    else:
                        path.write_text("parallel\n", encoding="utf-8")
                    if kind == "staged":
                        git(other, "add", relative)
                    result = self.build(root, planned_paths=[relative])
                self.assertEqual(result["mode"], "WAITING_HANDOFF")
                self.assertEqual(result["worktree_overlaps"][0]["overlap_paths"], [relative])

    def test_rename_blocks_both_planned_source_and_destination(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            with self.other_worktree(root) as other:
                old, new = "contexts/electronics/state.txt", "contexts/electronics/renamed.txt"
                git(other, "mv", old, new)
                for relative in (old, new):
                    with self.subTest(relative=relative):
                        result = self.build(root, planned_paths=[relative])
                        self.assertEqual(result["mode"], "WAITING_HANDOFF")
                        self.assertIn(relative, result["worktree_overlaps"][0]["overlap_paths"])

    def test_worktree_status_failure_blocks_even_an_unrelated_planned_path(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            with self.other_worktree(root) as other:
                original = MODULE._worktree_status
                def status(path):
                    if path == other.resolve():
                        raise ValueError("injected status error")
                    return original(path)
                with patch.object(MODULE, "_worktree_status", side_effect=status):
                    result = self.build(root, planned_paths=["AGENTS.md"])
        self.assertEqual(result["mode"], "WAITING_HANDOFF")
        self.assertEqual(result["worktree_overlaps"][0]["status"], "unknown")

    def test_worktree_listing_error_or_malformed_output_never_means_no_other_worktree(self):
        for failure in (ValueError("injected list error"), b"", b"bad\0\0", b"worktree x\0"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as raw:
                root = Path(raw)
                build_repo(root)
                original = MODULE._git_bytes
                def output(path, arguments):
                    if arguments[:2] == ["worktree", "list"]:
                        if isinstance(failure, Exception):
                            raise failure
                        return failure
                    return original(path, arguments)
                with patch.object(MODULE, "_git_bytes", side_effect=output):
                    result = self.build(root, planned_paths=["AGENTS.md"])
                self.assertEqual(result["mode"], "WAITING_HANDOFF")
                self.assertEqual(result["worktree_overlaps"][0]["status"], "unknown")

    def test_invalid_or_ambiguous_planned_paths_are_rejected(self):
        paths = ("", "../escape", "a/../file", "/absolute", "C:/absolute", "C:relative",
                 "\\\\server\\share", "a/*", "a/?", "a/file:stream", ".git/config",
                 "a/.GIT/file", "a/NUL.txt", "a/CONIN$", "a/COM¹.txt", "a/CON .txt", "a/file.", "a/file ", "a//file", "a/\nfile", "contexts")
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            for path in paths:
                with self.subTest(path=path), self.assertRaises(ValueError):
                    MODULE._planned_paths(root, [path])
            self.assertEqual(MODULE._planned_paths(root, [".\\AGENTS.md", "AGENTS.md"]), ["AGENTS.md"])

    def test_symlink_parent_or_file_is_not_a_planned_file_alias(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            link = root / "alias"
            try:
                link.symlink_to(root / "contexts", target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("symlink creation unavailable on this host")
            with self.assertRaises(ValueError):
                MODULE._planned_paths(root, ["alias/electronics/state.txt"])
            link.unlink()
            link.symlink_to(root.parent / "outside", target_is_directory=True)
            with self.assertRaises(ValueError):
                MODULE._planned_paths(root, ["alias/file.txt"])

    def test_alias_rejection_does_not_require_host_symlink_creation_privileges(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            original = Path.is_symlink
            with patch.object(Path, "is_symlink", lambda path: path.name == "alias" or original(path)):
                with self.assertRaisesRegex(ValueError, "filesystem alias"):
                    MODULE._planned_paths(root, ["alias/file.txt"])

    def test_windows_case_alias_matches_the_dirty_path(self):
        if os.name != "nt":
            self.skipTest("Windows case-insensitive filesystem contract")
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            with self.other_worktree(root) as other:
                (other / "AGENTS.md").write_text("parallel\n", encoding="utf-8")
                result = self.build(root, planned_paths=["agents.MD"])
        self.assertEqual(result["mode"], "WAITING_HANDOFF")

    def test_planned_path_conflicting_with_another_tasks_file_directory_tree_blocks(self):
        for planned, dirty in (("new/child.txt", "new"), ("new", "new/child.txt")):
            with self.subTest(planned=planned), tempfile.TemporaryDirectory() as raw:
                root = Path(raw)
                build_repo(root)
                with self.other_worktree(root) as other:
                    path = other / dirty
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("parallel\n", encoding="utf-8")
                    result = self.build(root, planned_paths=[planned])
                self.assertEqual(result["mode"], "WAITING_HANDOFF")

    def test_literal_posix_backslash_is_not_mistaken_for_an_approved_directory_separator(self):
        if os.name == "nt":
            self.skipTest("Windows cannot store a literal backslash in a file name")
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            base = git(root, "rev-parse", "HEAD")
            (root / "new\\file.txt").write_text("outside plan\n", encoding="utf-8")
            for committed in (False, True):
                with self.subTest(committed=committed):
                    if committed:
                        git(root, "add", "new\\file.txt")
                        git(root, "commit", "-qm", "literal backslash outside plan")
                        self.assertEqual(MODULE._worktree_status(root), [])
                    result = self.build(root, planned_paths=["new/file.txt"], verify_plan=True, diff_base=base)
                    self.assertEqual(result["mode"], "BLOCKED_PLAN")

    def test_committed_git_paths_cannot_alias_the_planned_separator_on_any_host(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            for payload, expected in ((b"new\\file.txt\0", "BLOCKED"), (b"new/file.txt\0", "PASS")):
                with self.subTest(payload=payload), patch.object(MODULE, "_worktree_status", return_value=[]), patch.object(
                    MODULE, "_git_bytes", side_effect=[b"1" * 40 + b"\n", b"", payload]
                ):
                    result = MODULE._check_plan(root, ["new/file.txt"], "known-base")
                self.assertEqual(result["status"], expected)
                if expected == "BLOCKED":
                    self.assertIn("literal backslashes", result["error"])

    def test_planned_paths_do_not_clear_global_safety_failures(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            for verify in (False, True):
                options = {"planned_paths": ["AGENTS.md"], "verify_plan": verify}
                if verify:
                    options["diff_base"] = "HEAD"
                with patch.object(MODULE, "_control_plane", return_value={"status": "FAIL"}):
                    self.assertEqual(self.build(root, **options)["mode"], "BLOCKED_CONTROL_PLANE")
                with patch.object(MODULE, "_refresh_origin_main", return_value={"status": "FAIL"}):
                    self.assertEqual(self.build(root, **options)["mode"], "BLOCKED_GIT_FRESHNESS")
                with patch.object(MODULE, "_execution_blockers", return_value=[{"kind": "execution_blocker"}]):
                    self.assertEqual(self.build(root, **options)["mode"], "BLOCKED_EXECUTION")

    def test_own_planned_dirty_still_requires_recovery_and_verify_is_scope_only(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            (root / "AGENTS.md").write_text("own bounded edit\n", encoding="utf-8")
            startup = self.build(root, planned_paths=["AGENTS.md"])
            verification = self.build(root, planned_paths=["AGENTS.md"], verify_plan=True, diff_base="HEAD")
        self.assertEqual(startup["mode"], "RECOVERY_REQUIRED")
        self.assertEqual(verification["mode"], "PLAN_VALID")
        self.assertEqual(verification["recovery_mode"], "RECOVERY_REQUIRED")
        self.assertNotEqual(verification["mode"], "SAFE_TO_START")

    def test_publication_rejects_unplanned_dirty_and_committed_paths(self):
        for kind in ("staged", "unstaged", "deleted", "untracked", "committed"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as raw:
                root = Path(raw)
                build_repo(root)
                base = git(root, "rev-parse", "HEAD")
                path = root / "AGENTS.md"
                if kind == "deleted":
                    path.unlink()
                elif kind == "untracked":
                    path = root / "new/nested/unplanned.txt"
                    path.parent.mkdir(parents=True)
                    path.write_text("outside plan\n", encoding="utf-8")
                else:
                    path.write_text("outside plan\n", encoding="utf-8")
                if kind in {"staged", "committed"}:
                    git(root, "add", "AGENTS.md")
                if kind == "committed":
                    git(root, "commit", "-qm", "outside plan")
                result = self.build(root, planned_paths=["contexts/electronics/state.txt"], verify_plan=True, diff_base=base)
                self.assertEqual(result["mode"], "BLOCKED_PLAN")
                self.assertIn(path.relative_to(root).as_posix(), result["plan"]["unplanned_paths"])

    def test_publication_rename_requires_both_paths_even_after_commit(self):
        for committed in (False, True):
            with self.subTest(committed=committed), tempfile.TemporaryDirectory() as raw:
                root = Path(raw)
                build_repo(root)
                base = git(root, "rev-parse", "HEAD")
                git(root, "mv", "AGENTS.md", "renamed.md")
                if committed:
                    git(root, "commit", "-qm", "rename")
                rejected = self.build(root, planned_paths=["renamed.md"], verify_plan=True, diff_base=base)
                accepted = self.build(root, planned_paths=["AGENTS.md", "renamed.md"], verify_plan=True, diff_base=base)
                self.assertEqual(rejected["mode"], "BLOCKED_PLAN")
                self.assertIn("AGENTS.md", rejected["plan"]["unplanned_paths"])
                self.assertEqual(accepted["mode"], "PLAN_VALID")

    def test_verification_requires_explicit_plan_and_ancestor_base(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            with self.assertRaises(ValueError):
                self.build(root, verify_plan=True)
            with self.assertRaises(ValueError):
                self.build(root, verify_plan=True, planned_paths=["AGENTS.md"])
            result = self.build(root, verify_plan=True, planned_paths=["AGENTS.md"], diff_base="missing-ref")
            self.assertEqual(result["mode"], "BLOCKED_PLAN")
            git(root, "checkout", "-q", "--orphan", "unrelated")
            git(root, "commit", "-qm", "unrelated baseline")
            git(root, "checkout", "-q", "main")
            result = self.build(root, verify_plan=True, planned_paths=["AGENTS.md"], diff_base="unrelated")
            self.assertEqual(result["mode"], "BLOCKED_PLAN")

    def test_publication_verification_still_blocks_unknown_or_overlapping_worktrees(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            with self.other_worktree(root) as other:
                (other / "AGENTS.md").write_text("parallel\n", encoding="utf-8")
                result = self.build(root, planned_paths=["AGENTS.md"], verify_plan=True, diff_base="HEAD")
                self.assertEqual(result["mode"], "WAITING_HANDOFF")
            with patch.object(MODULE, "_worktree_paths", side_effect=ValueError("unknown")):
                result = self.build(root, planned_paths=["AGENTS.md"], verify_plan=True, diff_base="HEAD")
            self.assertEqual(result["mode"], "WAITING_HANDOFF")

    def test_cli_plan_verification_has_its_own_status_and_rejects_unplanned_commits(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            base = git(root, "rev-parse", "HEAD")
            command = [sys.executable, str(SCRIPT), "--root", str(root), "--scope", "electronics",
                       "--skip-control-plane", "--json", "--verify-plan", "--diff-base", base,
                       "--planned-path", "./AGENTS.md", "--planned-path", "AGENTS.md"]
            clean = subprocess.run(command, cwd=root, capture_output=True, text=True, check=False)
            self.assertEqual(clean.returncode, 0, clean.stderr)
            self.assertEqual(json.loads(clean.stdout)["mode"], "PLAN_VALID")
            (root / "AGENTS.md").write_text("own planned edit\n", encoding="utf-8")
            dirty = subprocess.run(command, cwd=root, capture_output=True, text=True, check=False)
            self.assertEqual(dirty.returncode, 0, dirty.stderr)
            record = json.loads(dirty.stdout)
            self.assertEqual(record["mode"], "PLAN_VALID")
            self.assertEqual(record["recovery_mode"], "RECOVERY_REQUIRED")
            (root / "contexts/electronics/state.txt").write_text("outside plan\n", encoding="utf-8")
            git(root, "add", "contexts/electronics/state.txt")
            git(root, "commit", "-qm", "unplanned commit")
            rejected = subprocess.run(command, cwd=root, capture_output=True, text=True, check=False)
            self.assertEqual(rejected.returncode, 2, rejected.stderr)
            self.assertEqual(json.loads(rejected.stdout)["mode"], "BLOCKED_PLAN")
            startup_command = [part for part in command if part != "--verify-plan"] + ["--check"]
            startup = subprocess.run(startup_command, cwd=root, capture_output=True, text=True, check=False)
            self.assertEqual(startup.returncode, 2, startup.stderr)
            self.assertEqual(json.loads(startup.stdout)["mode"], "BLOCKED_PLAN")

    def test_own_new_directory_is_expanded_to_exact_planned_files(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            build_repo(root)
            (root / "new/nested").mkdir(parents=True)
            (root / "new/nested/file.txt").write_text("planned\n", encoding="utf-8")
            result = self.build(root, planned_paths=["new/nested/file.txt"], verify_plan=True, diff_base="HEAD")
        self.assertEqual(result["mode"], "PLAN_VALID")
        self.assertEqual(result["plan"]["actual_paths"], ["new/nested/file.txt"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
