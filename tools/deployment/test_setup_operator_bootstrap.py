"""Privilege-boundary regressions without useradd, Docker, or host changes."""

import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_setup_launcher as launcher


@unittest.skipUnless(os.name == "posix", "Linux account bootstrap")
class OperatorBootstrapTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.root = self.base / "installation"
        self.state = self.base / "bootstrap"
        self.home = self.state / "operator"
        self.account = None
        self.commands = []
        self.plan = {"missing": [], "installDocker": False, "daemonId": "original-daemon"}
        self.containers, self.volumes = [], []
        original_stat = Path.stat
        def fixture_stat(path, *args, **kwargs):
            info = original_stat(path, *args, **kwargs)
            if path == self.base or self.base in path.parents:
                values = list(info)
                values[4:6] = [12345, 12345] if path == self.home or self.home in path.parents else [0, 0]
                return os.stat_result(values)
            return info
        for target, replacement in (("OPERATOR_STATE", self.state), ("BOOTSTRAP_LOCK", self.base / "bootstrap.lock")):
            context = patch.object(launcher, target, replacement)
            context.start()
            self.addCleanup(context.stop)
        context = patch.object(Path, "stat", fixture_stat)
        context.start()
        self.addCleanup(context.stop)
        context = patch.object(launcher.pwd, "getpwnam", side_effect=self.lookup)
        context.start()
        self.addCleanup(context.stop)
        context = patch.object(launcher.grp, "getgrgid", return_value=SimpleNamespace(gr_name=launcher.OPERATOR_NAME))
        context.start()
        self.addCleanup(context.stop)
        context = patch.object(launcher, "_run", side_effect=self.runner)
        self.run_mock = context.start()
        self.addCleanup(context.stop)
        context = patch.object(launcher, "verify_operator_daemon")
        self.probe = context.start()
        self.addCleanup(context.stop)

    def lookup(self, name):
        if self.account is None:
            raise KeyError(name)
        return self.account

    def runner(self, args, **kwargs):
        self.commands.append(args)
        if args[0] == "/usr/sbin/usermod":
            return ""
        if args[0] == "/usr/sbin/useradd":
            intent_path = self.state / "operator-intent.json"
            self.assertTrue(intent_path.exists(), "durable intent must precede useradd")
            self.assertEqual(intent_path.stat().st_mode & 0o777, 0o600)
            intent = json.loads(intent_path.read_text())
            self.assertEqual(args[args.index("--comment") + 1], intent["marker"])
            self.home.mkdir(mode=0o700)
            self.account = SimpleNamespace(pw_uid=12345, pw_gid=12345, pw_name=launcher.OPERATOR_NAME,
                                           pw_dir=str(self.home), pw_gecos=intent["marker"], pw_shell="/usr/sbin/nologin")
            return ""
        if args[:3] == ["docker", "info", "--format"]:
            return self.plan["daemonId"]
        if args[:3] == ["docker", "ps", "-aq"]:
            return "\n".join(record["id"] for record in self.containers)
        if args[:4] == ["docker", "volume", "ls", "-q"]:
            return "\n".join(record["id"] for record in self.volumes)
        if args[:2] == ["docker", "inspect"]:
            return "\n".join(json.dumps(record) for record in self.containers)
        if args[:3] == ["docker", "volume", "inspect"]:
            return "\n".join(json.dumps(record) for record in self.volumes)
        raise AssertionError(args)

    def assert_no_account_mutation(self):
        self.assertFalse(any(args[0].endswith(("useradd", "usermod")) for args in self.commands))

    def test_fresh_creates_one_receipted_account_and_retry_reuses_it(self):
        self.assertEqual(launcher.prepare_default_operator(self.root, self.plan), 12345)
        receipt = (self.state / "operator.json").read_bytes()
        self.assertEqual(launcher.prepare_default_operator(self.root, self.plan), 12345)
        self.assertEqual((self.state / "operator.json").read_bytes(), receipt)
        self.assertEqual(sum(args[0].endswith("useradd") for args in self.commands), 1)
        self.assertFalse(self.root.exists())

    def test_crash_after_useradd_recovers_from_intent_without_new_uid(self):
        write = launcher._atomic_root_file
        def interrupt_receipt(path, *args, **kwargs):
            if path.name == "operator.json":
                raise OSError("simulated interruption")
            return write(path, *args, **kwargs)
        with patch.object(launcher, "_atomic_root_file", side_effect=interrupt_receipt):
            with self.assertRaises(OSError):
                launcher.prepare_default_operator(self.root, self.plan)
        self.assertEqual(launcher.prepare_default_operator(self.root, self.plan), 12345)
        self.assertEqual(sum(args[0].endswith("useradd") for args in self.commands), 1)

    def test_foreign_same_name_account_is_never_adopted(self):
        self.account = SimpleNamespace(pw_uid=22222, pw_gid=22222, pw_name=launcher.OPERATOR_NAME,
                                       pw_dir="/home/unrelated", pw_gecos="existing user", pw_shell="/bin/bash")
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.prepare_default_operator(self.root, self.plan)
        self.assertEqual(caught.exception.code, "OPERATOR_CONFLICT")
        self.assert_no_account_mutation()
        self.assertFalse(self.state.exists())

    def test_changed_receipted_uid_is_not_repaired(self):
        launcher.prepare_default_operator(self.root, self.plan)
        self.commands.clear()
        self.account.pw_uid = 22222
        with self.assertRaises(launcher.SetupBlocked):
            launcher.prepare_default_operator(self.root, self.plan)
        self.assert_no_account_mutation()

    def test_empty_env_backup_and_repository_remnants_block_before_useradd(self):
        for marker in (".env", "backups", ".git", ".asa"):
            with self.subTest(marker=marker):
                self.root.mkdir(exist_ok=True)
                entry = self.root / marker
                entry.touch()
                with self.assertRaises(launcher.SetupBlocked) as caught:
                    launcher.prepare_default_operator(self.root, self.plan)
                self.assertEqual(caught.exception.code, "BOOTSTRAP_NOT_FRESH")
                self.assertTrue(entry.exists())
                self.assert_no_account_mutation()
                entry.unlink()

    def test_external_backup_remnant_blocks_before_useradd(self):
        backup = self.base / "saved-backups"
        backup.mkdir()
        (backup / "archive.age").write_bytes(b"preserved")
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.prepare_default_operator(self.root, self.plan, str(backup))
        self.assertEqual(caught.exception.code, "BOOTSTRAP_NOT_FRESH")
        self.assertEqual((backup / "archive.age").read_bytes(), b"preserved")
        self.assert_no_account_mutation()

    def test_asa_container_and_orphan_custom_project_volume_block(self):
        observations = (([{"id": "a" * 64, "image": "ghcr.io/spikeal8-maker/asa-lab/api:older", "labels": {}}], []),
                        ([], [{"id": "school_blocks-object-data", "labels": {}}]),
                        ([], [{"id": "opaque-data", "labels": {"com.docker.compose.project": "school", "com.docker.compose.volume": "blocks-object-data"}}]),
                        ([], [{"id": "asa-lab-dev_postgres-data", "labels": {}}]))
        for self.containers, self.volumes in observations:
            with self.subTest(containers=self.containers, volumes=self.volumes):
                with self.assertRaises(launcher.SetupBlocked) as caught:
                    launcher.prepare_default_operator(self.root, self.plan)
                self.assertEqual(caught.exception.code, "BOOTSTRAP_NOT_FRESH")
                self.assert_no_account_mutation()

    def test_unrelated_panel_resources_are_preserved_and_allowed(self):
        self.containers = [{"id": "a" * 64, "image": "nginx:stable", "labels": {"com.docker.compose.project": "panel"}}]
        self.volumes = [{"id": "panel-config", "labels": {}}]
        self.assertEqual(launcher.prepare_default_operator(self.root, self.plan), 12345)
        self.assertFalse(any("rm" in args or "down" in args for args in self.commands))

    def test_incomplete_docker_inspection_blocks_before_useradd(self):
        self.containers = [{"id": "a" * 64, "image": "nginx:stable", "labels": {}}]
        def incomplete(args, **kwargs):
            return "" if args[:2] == ["docker", "inspect"] else self.runner(args, **kwargs)
        self.run_mock.side_effect = incomplete
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.prepare_default_operator(self.root, self.plan)
        self.assertEqual(caught.exception.code, "DOCKER_UNKNOWN")
        self.assert_no_account_mutation()

    def test_inventory_change_blocks_before_useradd(self):
        listings = 0
        def changing(args, **kwargs):
            nonlocal listings
            if args[:3] == ["docker", "ps", "-aq"]:
                listings += 1
                return "a" * 64 if listings > 1 else ""
            return self.runner(args, **kwargs)
        self.run_mock.side_effect = changing
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.prepare_default_operator(self.root, self.plan)
        self.assertEqual(caught.exception.code, "DOCKER_CHANGED")
        self.assert_no_account_mutation()

    def test_target_change_after_account_creation_prevents_chown(self):
        original = self.runner
        def racing(args, **kwargs):
            output = original(args, **kwargs)
            if args[0].endswith("useradd"):
                self.root.mkdir()
                (self.root / ".env").write_bytes(b"preserve")
            return output
        self.run_mock.side_effect = racing
        with patch.object(launcher.os, "fchown") as chown, self.assertRaises(launcher.SetupBlocked):
            launcher.prepare_default_operator(self.root, self.plan)
        chown.assert_not_called()
        self.assertEqual((self.root / ".env").read_bytes(), b"preserve")

    def test_read_only_commands_create_no_lock_account_or_target(self):
        for command in ("check", "status", "doctor", "diagnose", "restore-plan"):
            with self.subTest(command=command), patch.object(launcher, "verify_bundle"), \
                 patch.object(launcher, "platform_info", return_value={"supported": True}), \
                 patch.object(launcher.os, "geteuid", return_value=0), \
                 patch.object(launcher, "bootstrap_lock") as lock, \
                 patch.object(launcher, "prepare_default_operator") as create, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(launcher.main([command, "--root", str(self.root), "--non-interactive"]), 2)
                lock.assert_not_called()
                create.assert_not_called()
        self.assertFalse(self.root.exists())
        self.assertFalse(self.state.exists())

    def test_root_noninteractive_preparation_chooses_default_without_operator_flag(self):
        account = SimpleNamespace(pw_uid=12345, pw_gid=12345, pw_name=launcher.OPERATOR_NAME, pw_dir=str(self.home))
        with patch.object(launcher, "verify_bundle"), patch.object(launcher, "platform_info", return_value={"supported": True}), \
             patch.object(launcher.os, "geteuid", return_value=0), patch.object(launcher, "bootstrap_lock", return_value=None), \
             patch.object(launcher.pwd, "getpwuid", return_value=account), \
             patch.object(launcher, "dependency_plan", return_value=self.plan), \
             patch.object(launcher, "prepare_default_operator", return_value=12345) as create, \
             patch.object(launcher, "verify_operator_daemon") as verify, \
             patch.object(launcher, "_run") as run, contextlib.redirect_stdout(io.StringIO()):
            code = launcher.main(["--root", str(self.root), "--prepare-host", "--non-interactive"])
        self.assertEqual(code, 0)
        create.assert_called_once_with(self.root, self.plan, None)
        verify.assert_called_once()
        self.assertEqual(verify.call_args.args[1], "original-daemon")
        run.assert_not_called()  # Group access belongs to the verified bootstrap helper.

    def test_existing_empty_target_changes_owner_only_after_operator_daemon_probe(self):
        self.root.mkdir()
        def assign(descriptor, uid, gid):
            self.probe.assert_called_once()
            self.assertEqual(self.probe.call_args.args[1], "original-daemon")
            self.assertEqual((uid, gid), (12345, 12345))
            self.assertEqual(sum(args[0].endswith("usermod") for args in self.commands), 1)
        with patch.object(launcher.os, "fchown", side_effect=assign) as chown:
            launcher.prepare_default_operator(self.root, self.plan)
        chown.assert_called_once()

    def test_operator_daemon_failure_preserves_empty_target_owner_and_can_resume(self):
        self.root.mkdir()
        self.probe.side_effect = launcher.SetupBlocked("DOCKER_OWNER_ACCESS", "unavailable", "check")
        with patch.object(launcher.os, "fchown") as chown, self.assertRaises(launcher.SetupBlocked):
            launcher.prepare_default_operator(self.root, self.plan)
        chown.assert_not_called()
        self.probe.side_effect = None
        with patch.object(launcher.os, "fchown"):
            launcher.prepare_default_operator(self.root, self.plan)
        self.assertEqual(sum(args[0].endswith("useradd") for args in self.commands), 1)

    def test_root_config_is_copied_privately_with_generated_uid_without_changing_input(self):
        source = self.base / "input.json"
        source.write_text(json.dumps({"format": "asa-setup-config-v1", "root": str(self.root)}))
        source.chmod(0o600)
        original = source.read_bytes()
        with patch.object(launcher, "verify_bundle"), patch.object(launcher, "platform_info", return_value={"supported": True}), \
             patch.object(launcher.os, "geteuid", return_value=0), patch.object(launcher, "bootstrap_lock", return_value=None), \
             patch.object(launcher.pwd, "getpwuid", side_effect=lambda uid: self.account), \
             patch.object(launcher, "dependency_plan", return_value=self.plan), \
             patch.object(launcher, "verify_operator_daemon"), patch.object(launcher, "_write_owner_json") as stage, \
             contextlib.redirect_stdout(io.StringIO()):
            code = launcher.main(["--config", str(source), "--prepare-host", "--non-interactive"])
        self.assertEqual(code, 0)
        self.assertEqual(stage.call_args.args[0], self.home / "setup-input.json")
        self.assertEqual(stage.call_args.args[1]["operatorUid"], 12345)
        self.assertEqual(source.read_bytes(), original)
        self.assertEqual(source.stat().st_mode & 0o777, 0o600)

    def test_genuinely_missing_engine_is_prepared_before_account_or_target_assignment(self):
        absent = {"missing": ["docker-ce"], "installDocker": True, "daemonId": None}
        account = SimpleNamespace(pw_uid=12345, pw_gid=12345, pw_name=launcher.OPERATOR_NAME, pw_dir=str(self.home))
        def prepare(plan):
            self.assertEqual(plan, absent)
            self.assert_no_account_mutation()
            self.assertFalse(self.root.exists())
            return {"dockerInstalled": True, "daemonId": "original-daemon"}
        with patch.object(launcher, "verify_bundle"), patch.object(launcher, "platform_info", return_value={"supported": True}), \
             patch.object(launcher.os, "geteuid", return_value=0), patch.object(launcher, "bootstrap_lock", return_value=None), \
             patch.object(launcher.pwd, "getpwuid", return_value=account), \
             patch.object(launcher, "dependency_plan", side_effect=[absent, self.plan]), \
             patch.object(launcher, "provision_dependencies", side_effect=prepare) as provision, \
             patch.object(launcher, "prepare_default_operator", return_value=12345) as create, \
             contextlib.redirect_stdout(io.StringIO()):
            code = launcher.main(["--root", str(self.root), "--prepare-host", "--non-interactive"])
        self.assertEqual(code, 0)
        provision.assert_called_once()
        create.assert_called_once_with(self.root, self.plan, None)

    def test_empty_foreign_owned_directory_is_not_reassigned(self):
        self.root.mkdir()
        original_stat = Path.stat
        def foreign_stat(path, *args, **kwargs):
            info = original_stat(path, *args, **kwargs)
            if path == self.root:
                values = list(info)
                values[4:6] = [22222, 22222]
                return os.stat_result(values)
            return info
        with patch.object(Path, "stat", foreign_stat), patch.object(launcher.os, "fchown") as chown, \
             self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.prepare_default_operator(self.root, self.plan)
        self.assertEqual(caught.exception.code, "BOOTSTRAP_NOT_FRESH")
        self.assert_no_account_mutation()
        chown.assert_not_called()

    def test_lock_rejects_symlink_and_hardlink(self):
        target = self.base / "foreign-lock"
        target.write_bytes(b"preserved")
        launcher.BOOTSTRAP_LOCK.symlink_to(target)
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.bootstrap_lock()
        self.assertEqual(caught.exception.code, "PATH_LINK")
        launcher.BOOTSTRAP_LOCK.unlink()
        os.link(target, launcher.BOOTSTRAP_LOCK)
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.bootstrap_lock()
        self.assertEqual(caught.exception.code, "PATH_HARDLINK")
        self.assertEqual(target.read_bytes(), b"preserved")

    @unittest.skipUnless(hasattr(os, "getuid") and os.getuid() == 0, "real root-owned lock fixture")
    def test_global_lock_serializes_bootstrap_without_truncating_receipt(self):
        descriptor = launcher.bootstrap_lock()
        try:
            with self.assertRaises(launcher.SetupBlocked) as caught:
                launcher.bootstrap_lock()
            self.assertEqual(caught.exception.code, "BOOTSTRAP_BUSY")
        finally:
            os.close(descriptor)
        descriptor = launcher.bootstrap_lock()
        os.close(descriptor)


@unittest.skipUnless(os.name == "posix", "Linux UID/group daemon probe")
class OperatorDaemonTests(unittest.TestCase):
    def setUp(self):
        self.owner = {"uid": 12345, "gid": 12345, "name": "asa-setup", "home": "/var/lib/asa-setup/operator"}

    def test_probe_uses_operator_identity_and_original_daemon(self):
        with patch.object(launcher.os, "geteuid", return_value=0), \
             patch.object(launcher.os, "getgrouplist", return_value=[12345, 998]), \
             patch.object(launcher.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "original\n", "")) as run:
            launcher.verify_operator_daemon(self.owner, "original")
        options = run.call_args.kwargs
        self.assertEqual((options["user"], options["group"], options["extra_groups"]), (12345, 12345, [12345, 998]))
        self.assertEqual(options["env"]["HOME"], self.owner["home"])
        self.assertEqual(options["env"]["ASA_SETUP_DAEMON_ID"], "original")

    def test_different_or_inaccessible_daemon_is_blocked(self):
        for code, output in ((0, "different"), (1, "")):
            with self.subTest(code=code), patch.object(launcher.os, "geteuid", return_value=12345), \
                 patch.object(launcher.subprocess, "run", return_value=subprocess.CompletedProcess([], code, output, "private error")), \
                 self.assertRaises(launcher.SetupBlocked) as caught:
                launcher.verify_operator_daemon(self.owner, "original")
            self.assertEqual(caught.exception.code, "DOCKER_OWNER_ACCESS")
            self.assertNotIn("private error", str(caught.exception))


@unittest.skipUnless(os.name == "posix", "Linux root cloud boundary")
class RootCloudPolicyTests(unittest.TestCase):
    def test_only_explicit_availability_can_warn_for_best_effort(self):
        fatal = ("CLOUD_ROOT_IDENTITY", "CLOUD_EXISTING_CONFIGURATION", "CLOUD_PARENT", "CLOUD_SOURCE",
                 "CLOUD_IDENTITY", "CLOUD_CREDENTIAL_SCHEMA", "CLOUD_INSTALL", "HOST_COMMAND", "CLOUD_UNKNOWN")
        for code in (*fatal, "CLOUD_UNAVAILABLE"):
            for policy in ("required", "best-effort", None):
                with self.subTest(code=code, policy=policy), patch.object(launcher, "prepare_cloud_transport",
                     side_effect=launcher.SetupBlocked(code, "private details hidden", "retry")):
                    if code == "CLOUD_UNAVAILABLE" and policy == "best-effort":
                        proof = launcher.prepare_cloud_for_policy(Path("/bundle"), owner={"uid": 12345}, policy=policy)
                        self.assertEqual(proof["status"], "WARNING")
                        self.assertFalse(proof["deliveryVerified"])
                        self.assertEqual(proof["reasonCode"], code)
                    else:
                        with self.assertRaises(launcher.SetupBlocked) as caught:
                            launcher.prepare_cloud_for_policy(Path("/bundle"), owner={"uid": 12345}, policy=policy)
                        self.assertEqual(caught.exception.code, code)

    def test_pinned_helper_security_codes_survive_root_wrapper(self):
        failures = [(ValueError(code), code) for code in ("CLOUD_ROOT_IDENTITY", "CLOUD_EXISTING_CONFIGURATION", "CLOUD_PARENT")]
        failures += [(ValueError("untyped private details"), "CLOUD_INSTALL"),
                     (RuntimeError("private details"), "CLOUD_INSTALL"),
                     (subprocess.CalledProcessError(1, ["docker"]), "CLOUD_UNAVAILABLE")]
        for failure, expected in failures:
            module = SimpleNamespace(PROJECT="asa-cloud", IMAGE="pinned")
            with self.subTest(expected=expected), patch.object(launcher.os, "geteuid", return_value=0), \
                 patch.object(launcher, "_trusted_cloud", return_value=module), patch.object(launcher, "_run", return_value=""), \
                 patch.object(module, "install", side_effect=failure, create=True), self.assertRaises(launcher.SetupBlocked) as caught:
                launcher.prepare_cloud_transport(Path("/bundle"), owner={"uid": 12345})
            self.assertEqual(caught.exception.code, expected)
            self.assertNotIn("private details", str(caught.exception))


class LauncherOutputTests(unittest.TestCase):
    def test_blocked_schema_has_matching_code_and_six_unaccepted_sections(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = launcher.emit_blocked(launcher.SetupBlocked("DOCKER_UNKNOWN", "blocked", "check"), as_json=True)
        result = json.loads(output.getvalue())
        self.assertEqual(code, result["exitCode"])
        self.assertEqual(result["outcome"], "BLOCKED")
        self.assertFalse(result["applicationAccepted"])
        for name in ("dependencies", "version", "data", "backup", "site", "diagnostics"):
            self.assertIn(result[name]["status"], ("BLOCKED", "NOT_RUN"))

    def test_help_includes_canonical_commands_and_aliases(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(launcher.main(["--help"]), 0)
        for name in ("schedule", "retry-cloud", "doctor", "cloud-retry", "diagnose", "asa-setup"):
            self.assertIn(name, output.getvalue())


if __name__ == "__main__":
    unittest.main()
