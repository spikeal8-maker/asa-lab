"""Runner cleanup contracts. Actual deletion is confined to temporary fixture FDs."""

import contextlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import signal
import stat
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ci_prepare_realhost_runner as runner


def environment():
    return {**runner.EXPECTED_ENV, "SOURCE_REVISION": "a" * 40, "GITHUB_RUN_ID": "41881035885",
        "GITHUB_RUN_ATTEMPT": "1", "GITHUB_EVENT_NAME": "pull_request",
        "GITHUB_WORKFLOW_REF": runner.REPOSITORY + "/.github/workflows/setup-realhost.yml@refs/pull/984/merge",
        "GITHUB_WORKSPACE": "/home/runner/work/asa-lab/asa-lab", "RUNNER_TEMP": "/home/runner/work/_temp",
        "ImageVersion": "20261018.96.1"}


class ContextTests(unittest.TestCase):
    def test_opt_in_repo_workflow_job_and_hosted_platform_are_all_mandatory(self):
        runner.guard_environment(environment())
        for key in runner.EXPECTED_ENV:
            for value in (None, "PRIVATE", ""):
                with self.subTest(key=key, value=value), self.assertRaises(runner.Blocked):
                    runner.guard_environment({**environment(), key: value})

    def test_event_ref_run_revision_and_protected_paths_reject_near_matches(self):
        for key, value in (("GITHUB_EVENT_NAME", "pull_request_target"), ("SOURCE_REVISION", "a" * 39),
                ("GITHUB_RUN_ID", "0"), ("GITHUB_RUN_ATTEMPT", "1 PRIVATE"),
                ("GITHUB_WORKFLOW_REF", "foreign/asa-lab/.github/workflows/setup-realhost.yml@refs/pull/984/merge"),
                ("GITHUB_WORKFLOW_REF", runner.REPOSITORY + "/.github/workflows/other.yml@refs/pull/984/merge"),
                ("GITHUB_WORKSPACE", "/usr/local/lib/android/project"), ("RUNNER_TEMP", "/usr/share"),
                ("RUNNER_TEMP", "/home/../usr/share"), ("RUNNER_TEMP", "relative"), ("RUNNER_TEMP", "/tmp//private")):
            with self.subTest(key=key, value=value), self.assertRaises(runner.Blocked):
                runner.guard_environment({**environment(), key: value})
        runner.guard_environment({**environment(), "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_WORKFLOW_REF": runner.REPOSITORY + "/.github/workflows/setup-realhost.yml@refs/heads/main"})

    def test_double_root_anchor_is_rejected_before_opening_protected_paths(self):
        workspace, temporary = runner.guard_environment(environment())
        self.assertEqual(str(workspace), environment()["GITHUB_WORKSPACE"])
        self.assertEqual(str(temporary), environment()["RUNNER_TEMP"])
        self.assertEqual((workspace.anchor, temporary.anchor), ("/", "/"))
        for key in ("GITHUB_WORKSPACE", "RUNNER_TEMP"):
            for value in ("//usr/local/lib/android/sdk/workspace", "//usr/share/dotnet/inside"):
                with self.subTest(key=key, value=value), patch.object(runner.os, "open") as opened, \
                        patch.object(runner.Tree, "remove_sdk") as removed:
                    candidate = {**environment(), key: value}
                    with self.assertRaisesRegex(runner.Blocked, "BLOCKED_RUNNER_PATH"):
                        runner.guard_environment(candidate)
                    result = runner.prepare(candidate)
                    self.assertEqual((result["status"], result["reasonCode"]), ("BLOCKED", "BLOCKED_RUNNER_PATH"))
                    opened.assert_not_called()
                    removed.assert_not_called()

    def test_platform_and_privilege_are_real_requirements_without_image_version_pin(self):
        release = {"ID": "ubuntu", "VERSION_ID": "24.04"}
        with patch.object(runner.sys, "platform", "linux"), patch.object(runner.os, "O_PATH", 1, create=True), \
                patch.object(runner.os, "O_NOFOLLOW", 2, create=True):
            runner.guard_platform(release, "x86_64", 0)
            for os_release, machine, uid in ((release, "aarch64", 0), (release, "x86_64", 1001),
                    ({"ID": "ubuntu", "VERSION_ID": "22.04"}, "x86_64", 0), ({"ID": "debian"}, "x86_64", 0)):
                with self.assertRaises(runner.Blocked):
                    runner.guard_platform(os_release, machine, uid)
        # Observed image versions are not proof of available disk and do not authorize cleanup.
        runner.guard_environment({**environment(), "ImageVersion": "future-version"})

    def test_invalid_context_never_opens_or_removes_a_host_path_and_output_is_closed(self):
        with patch.object(runner.os, "open") as opened, patch.object(runner.Tree, "remove_sdk") as removed:
            result = runner.prepare({"GH_TOKEN": "PRIVATE", "RUNNER_ENVIRONMENT": "self-hosted"})
        opened.assert_not_called()
        removed.assert_not_called()
        self.assertEqual((result["status"], result["reasonCode"]), ("BLOCKED", "BLOCKED_RUNNER_CONTEXT"))
        self.assertNotIn("PRIVATE", json.dumps(result))
        for error in (RuntimeError("PRIVATE"), runner.Blocked("PRIVATE")):
            with patch.object(runner, "guard_environment", side_effect=error):
                result = runner.prepare(environment())
            self.assertEqual(result["reasonCode"], "BLOCKED_CLEANUP_IO")
            self.assertNotIn("PRIVATE", json.dumps(result))

    def test_workflow_runs_focused_gate_then_cleanup_then_original_preflight_and_exact_artifacts(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/setup-realhost.yml").read_text()
        command = "python3 -B -m unittest discover -s tools/deployment -p 'test_ci_prepare_realhost_runner.py' -v"
        self.assertLess(workflow.index(command), workflow.index("sudo -n --preserve-env="))
        self.assertLess(workflow.index("sudo -n --preserve-env="), workflow.index('--revision "$SOURCE_REVISION" --preflight-only'))
        self.assertLess(workflow.index("--preflight-only"), workflow.index("sudo apt-get update"))
        self.assertIn("runs-on: ubuntu-24.04", workflow)
        self.assertIn("timeout-minutes: 180", workflow)
        self.assertIn("if: always()", workflow)
        self.assertIn("            test-results/setup-realhost/evidence.json\n            test-results/setup-realhost/runner-preparation.json\n", workflow)
        self.assertEqual((runner.REQUIRED_FREE, runner.RESERVE), (24 * 1024**3, 3 * 1024**3))
        self.assertEqual(runner.TARGETS, (("android", "/usr/local/lib/android"), ("dotnet", "/usr/share/dotnet")))


class PreparationTests(unittest.TestCase):
    def prepare(self, readings, *, remove_error=None):
        tree = Mock(root=SimpleNamespace(st_uid=0, st_mode=stat.S_IFDIR | 0o755))
        tree.directory.side_effect = (11, 12)
        def removed(path, result):
            result.update(status="REMOVING", auditedEntries=3, auditedAllocatedBytes=1024, removedEntries=1, symlinkEntries=0)
            if remove_error:
                raise remove_error
            result["status"] = "REMOVED"
        tree.remove_sdk.side_effect = removed
        with patch.object(runner, "guard_platform"), patch.object(runner.platform, "freedesktop_os_release", return_value={}, create=True), \
                patch.object(runner.os, "geteuid", return_value=0, create=True), \
                patch.object(runner, "deadline_alarm", side_effect=contextlib.nullcontext), \
                patch.object(runner.os, "O_DIRECTORY", 0, create=True), patch.object(runner.os, "O_NOFOLLOW", 0, create=True), \
                patch.object(runner.os, "O_CLOEXEC", 0, create=True), patch.object(runner.os, "open", return_value=10), \
                patch.object(runner.os, "close"), patch.object(runner, "Tree", return_value=tree), \
                patch.object(runner, "free_bytes", side_effect=readings):
            result = runner.prepare(environment())
        return result, tree

    def test_enough_space_skips_every_sdk_and_low_space_stops_after_first_sufficient_sdk(self):
        result, tree = self.prepare([91_313_197_056, 91_313_197_056])
        self.assertEqual((result["status"], result["reasonCode"]), ("PASS", "ALREADY_SUFFICIENT"))
        tree.remove_sdk.assert_not_called()
        self.assertTrue(all(value["status"] == "NOT_NEEDED" for value in result["targets"].values()))
        result, tree = self.prepare([13_769_789_440, runner.REQUIRED_FREE, runner.REQUIRED_FREE])
        self.assertEqual((result["status"], result["reasonCode"]), ("PASS", "SPACE_READY"))
        self.assertEqual(tree.remove_sdk.call_args.args[0], PurePosixPath("/usr/local/lib/android"))
        self.assertEqual(tree.remove_sdk.call_count, 1)
        self.assertEqual(result["targets"]["dotnet"]["status"], "NOT_NEEDED")

    def test_still_short_and_decreasing_free_space_never_pass(self):
        result, tree = self.prepare([13_769_789_440, 18 * runner.GIB, 23 * runner.GIB, 23 * runner.GIB])
        self.assertEqual(tree.remove_sdk.call_count, 2)
        self.assertEqual((result["status"], result["reasonCode"]), ("BLOCKED", "BLOCKED_HOST_FREE_DISK"))
        result, _ = self.prepare([runner.REQUIRED_FREE, runner.REQUIRED_FREE - 1])
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["afterFreeBytes"], runner.REQUIRED_FREE - 1)

    def test_partial_cleanup_deadline_is_reported_without_raw_messages_or_false_pass(self):
        result, tree = self.prepare([1, 2], remove_error=runner.Blocked("BLOCKED_CLEANUP_DEADLINE"))
        self.assertEqual((result["status"], result["reasonCode"]), ("BLOCKED", "BLOCKED_CLEANUP_DEADLINE"))
        self.assertEqual(result["targets"]["android"]["status"], "PARTIAL")
        self.assertEqual(result["targets"]["dotnet"]["status"], "NOT_ATTEMPTED")
        self.assertEqual(tree.remove_sdk.call_count, 1)
        result, _ = self.prepare([1, 2], remove_error=OSError("PRIVATE"))
        self.assertEqual(result["reasonCode"], "BLOCKED_CLEANUP_IO")
        self.assertNotIn("PRIVATE", json.dumps(result))

    def test_main_preserves_exit_two_and_one_closed_json_object(self):
        with patch.object(runner, "prepare", return_value={"status": "BLOCKED", "reasonCode": "BLOCKED_HOST_FREE_DISK"}), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            code = runner.main()
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output.getvalue())["status"], "BLOCKED")


@unittest.skipUnless(sys.platform == "linux", "Native no-follow FD traversal and mount identity require Linux")
class TemporaryTreeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.fixture = Path(temporary.name)
        self.target = self.fixture / "usr/local/lib/android"
        (self.target / "sdk/tools").mkdir(parents=True)
        (self.target / "sdk/tools/payload").write_bytes(b"synthetic-sdk" * 1024)
        self.outside = self.fixture / "protected-project"
        self.outside.mkdir()
        (self.outside / "keep").write_text("synthetic-protected-data")
        self.root_fd = os.open(self.fixture, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, self.root_fd)
        self.tree = runner.Tree(self.root_fd, runner.Budget())
        self.result = {"status": "NOT_ATTEMPTED"}

    def delete(self):
        # Absolute production contract is resolved only below this temporary root FD.
        self.tree.remove_sdk(PurePosixPath("/usr/local/lib/android"), self.result)

    def test_real_fixture_removal_unlinks_descendant_symlink_without_following_it(self):
        (self.target / "sdk/tools/outside-link").symlink_to(self.outside, target_is_directory=True)
        (self.target / "sdk").chmod(0o777)  # Official Android image has writable SDK descendants.
        self.delete()
        self.assertFalse(self.target.exists())
        self.assertEqual((self.outside / "keep").read_text(), "synthetic-protected-data")
        self.assertEqual(self.result["status"], "REMOVED")
        self.assertEqual(self.result["symlinkEntries"], 1)
        self.assertEqual(self.result["auditedEntries"], self.result["removedEntries"])

    def test_root_and_ancestor_symlinks_are_rejected_before_any_removal(self):
        for ancestor in (False, True):
            path = self.target.parent if ancestor else self.target
            moved = path.with_name(path.name + "-saved")
            path.rename(moved)
            path.symlink_to(moved, target_is_directory=True)
            try:
                with self.assertRaises(runner.Blocked):
                    self.delete()
                self.assertTrue((moved / ("android/sdk/tools/payload" if ancestor else "sdk/tools/payload")).is_file())
            finally:
                path.unlink()
                moved.rename(path)

    def test_hardlink_special_node_and_root_permissions_block_the_entire_tree(self):
        bad = self.target / "sdk/unsafe"
        for case in ("hardlink", "fifo", "permissions", "owner"):
            if case == "hardlink":
                os.link(self.outside / "keep", bad)
            elif case == "fifo":
                os.mkfifo(bad)
            elif case == "permissions":
                self.target.chmod(0o777)
            original_root = self.tree.root
            if case == "owner":
                self.tree.root = SimpleNamespace(st_dev=original_root.st_dev, st_uid=original_root.st_uid + 1)
            try:
                with self.subTest(case=case), self.assertRaises(runner.Blocked):
                    self.delete()
                self.assertTrue((self.target / "sdk/tools/payload").is_file())
                self.assertEqual((self.outside / "keep").read_text(), "synthetic-protected-data")
            finally:
                if bad.exists():
                    bad.unlink()
                self.target.chmod(0o755)
                self.tree.root = original_root

    def test_same_device_mount_alias_and_changed_identity_are_rejected(self):
        native = runner.mount_id
        for mounted_path in (self.target, self.target / "sdk/tools", self.target / "sdk/tools/payload"):
            target_inode = mounted_path.stat().st_ino
            def mounted(descriptor):
                value = native(descriptor)
                return value + 1 if os.fstat(descriptor).st_ino == target_inode else value
            with self.subTest(mounted_path=mounted_path.name), patch.object(runner, "mount_id", side_effect=mounted), \
                    self.assertRaisesRegex(runner.Blocked, "BLOCKED_SDK_MOUNT_ALIAS"):
                self.delete()
            self.assertTrue((self.target / "sdk/tools/payload").is_file())
            self.assertEqual(self.result.get("removedEntries", 0), 0)
        parent = self.tree.directory(PurePosixPath("/usr/local/lib"), protected=True)
        target = self.tree.open_child(parent, "android", protected=True)
        try:
            self.target.rename(self.target.with_name("saved"))
            self.target.mkdir()
            with self.assertRaisesRegex(runner.Blocked, "BLOCKED_SDK_IDENTITY_CHANGED"):
                self.tree.unchanged(parent, "android", target)
        finally:
            os.close(target)
            os.close(parent)

    def test_deadline_entry_bound_and_missing_sdk_leave_protected_data_untouched(self):
        for setting, value, reason in (("deadline", 0, "BLOCKED_CLEANUP_DEADLINE"),
                                       ("entries", runner.MAX_ENTRIES, "BLOCKED_CLEANUP_ENTRY_LIMIT")):
            budget = runner.Budget()
            setattr(budget, setting, value)
            self.tree.budget = budget
            with self.subTest(setting=setting), self.assertRaisesRegex(runner.Blocked, reason):
                self.delete()
            self.assertTrue((self.target / "sdk/tools/payload").is_file())
        self.tree.budget = runner.Budget()
        self.tree.remove_sdk(PurePosixPath("/usr/local/lib/missing"), self.result)
        self.assertEqual(self.result["status"], "ABSENT")
        self.assertEqual((self.outside / "keep").read_text(), "synthetic-protected-data")

    def test_real_deadline_alarm_interrupts_a_harmless_wait_and_restores_handler(self):
        previous = signal.getsignal(signal.SIGALRM)
        started = time.monotonic()
        with patch.object(runner, "SECONDS", 0.03), self.assertRaisesRegex(runner.Blocked, "BLOCKED_CLEANUP_DEADLINE"):
            with runner.deadline_alarm():
                time.sleep(1)
        self.assertLess(time.monotonic() - started, 2)
        self.assertEqual(signal.getsignal(signal.SIGALRM), previous)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))
        self.assertTrue((self.target / "sdk/tools/payload").is_file())


if __name__ == "__main__":
    unittest.main()
