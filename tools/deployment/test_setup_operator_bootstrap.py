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
        self.metadata_owners = {}
        original_stat = Path.stat
        original_fstat = os.fstat
        def fixture_metadata(info, path):
            if path == self.base or self.base in path.parents:
                values = list(info)
                owner = self.metadata_owners.get(path, 12345 if path == self.home or self.home in path.parents else 0)
                values[4:6] = [owner, owner]
                return os.stat_result(values)
            return info
        def fixture_stat(path, *args, **kwargs):
            return fixture_metadata(original_stat(path, *args, **kwargs), path)
        def fixture_fstat(descriptor):
            info = original_fstat(descriptor)
            # Extend the same ownership model only to descriptors belonging to
            # this fixture. Ordinary CI runners never need to become root.
            for path in (self.base, *self.base.rglob("*")):
                try:
                    candidate = original_stat(path, follow_symlinks=False)
                except FileNotFoundError:
                    continue
                if (candidate.st_dev, candidate.st_ino) == (info.st_dev, info.st_ino):
                    return fixture_metadata(info, path)
            return info
        for target, replacement in (("OPERATOR_STATE", self.state), ("BOOTSTRAP_LOCK", self.base / "bootstrap.lock")):
            context = patch.object(launcher, target, replacement)
            context.start()
            self.addCleanup(context.stop)
        context = patch.object(Path, "stat", fixture_stat)
        context.start()
        self.addCleanup(context.stop)
        context = patch.object(launcher.os, "fstat", fixture_fstat)
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
            comment = args[args.index("--comment") + 1]
            self.assertEqual(comment, intent["marker"])
            # shadow 4.13 src/useradd.c case 'c' requires VALID(comment):
            # https://github.com/shadow-maint/shadow/blob/4.13/src/useradd.c
            # the passwd GECOS field cannot contain ':' or a newline. This is
            # the external command contract, independent of our marker prefix.
            self.assertFalse(any(character in comment for character in ":\n"), "useradd rejects this GECOS comment")
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

    def legacy_intent(self, **changes):
        self.state.mkdir(mode=0o755, exist_ok=True)
        value = {"format": "asa-operator-bootstrap-v1", "name": launcher.OPERATOR_NAME, "home": str(self.home),
                 "root": str(self.root), "marker": "asa-setup:" + "a" * 32, **changes}
        path = self.state / "operator-intent.json"
        path.write_text(json.dumps(value), encoding="utf-8")
        path.chmod(0o600)
        return value

    def test_fresh_creates_one_receipted_account_and_retry_reuses_it(self):
        self.assertEqual(launcher.prepare_default_operator(self.root, self.plan), 12345)
        receipt = (self.state / "operator.json").read_bytes()
        self.assertEqual(launcher.prepare_default_operator(self.root, self.plan), 12345)
        self.assertEqual((self.state / "operator.json").read_bytes(), receipt)
        self.assertEqual(sum(args[0].endswith("useradd") for args in self.commands), 1)
        self.assertFalse(self.root.exists())

    def test_incomplete_legacy_intent_migrates_same_nonce_under_existing_lock(self):
        old = self.legacy_intent()
        descriptor = launcher.bootstrap_lock()
        try:
            self.assertEqual(launcher.prepare_default_operator(self.root, self.plan), 12345)
            current = json.loads((self.state / "operator-intent.json").read_text())
            self.assertEqual(current, {**old, "marker": "asa-setup-" + old["marker"].split(":")[1]})
            self.assertEqual(json.loads((self.state / "operator.json").read_text()), {**current, "uid": 12345, "gid": 12345})
            self.assertEqual(self.account.pw_gecos, current["marker"])
            with self.assertRaises(launcher.SetupBlocked) as caught:
                launcher.bootstrap_lock()
            self.assertEqual(caught.exception.code, "BOOTSTRAP_BUSY")
            self.assertEqual(launcher.prepare_default_operator(self.root, self.plan), 12345)
        finally:
            os.close(descriptor)
        self.assertEqual(sum(args[0].endswith("useradd") for args in self.commands), 1)

    def test_legacy_intent_with_existing_account_is_never_reattributed(self):
        old = self.legacy_intent()
        original = (self.state / "operator-intent.json").read_bytes()
        self.account = SimpleNamespace(pw_uid=12345, pw_gid=12345, pw_name=launcher.OPERATOR_NAME,
                                       pw_dir=str(self.home), pw_gecos=old["marker"], pw_shell="/usr/sbin/nologin")
        with patch.object(launcher.os, "fchown") as chown, patch.object(launcher, "_atomic_root_file") as write, \
             self.assertRaises(launcher.SetupBlocked):
            launcher.prepare_default_operator(self.root, self.plan)
        self.assert_no_account_mutation()
        chown.assert_not_called()
        write.assert_not_called()
        self.assertEqual(self.account.pw_gecos, old["marker"])
        self.assertEqual((self.state / "operator-intent.json").read_bytes(), original)

    def test_legacy_intent_with_any_home_or_receipt_preserves_state(self):
        for conflict in ("home", "dangling-home", "receipt", "empty-receipt"):
            with self.subTest(conflict=conflict):
                self.legacy_intent()
                original = (self.state / "operator-intent.json").read_bytes()
                path = self.home if conflict in ("home", "dangling-home") else self.state / "operator.json"
                if conflict == "home":
                    path.mkdir(mode=0o700)
                elif conflict == "dangling-home":
                    path.symlink_to(self.base / "absent-home")
                else:
                    path.write_bytes(b"{}" if conflict == "empty-receipt" else b'{"uid":12345}')
                    path.chmod(0o600)
                try:
                    with patch.object(launcher.os, "fchown") as chown, self.assertRaises(launcher.SetupBlocked):
                        launcher.prepare_default_operator(self.root, self.plan)
                    self.assert_no_account_mutation()
                    chown.assert_not_called()
                    self.assertEqual((self.state / "operator-intent.json").read_bytes(), original)
                    self.assertTrue(path.exists() or path.is_symlink())
                    if conflict in ("receipt", "empty-receipt"):
                        self.assertEqual(path.read_bytes(), b"{}" if conflict == "empty-receipt" else b'{"uid":12345}')
                finally:
                    path.rmdir() if conflict == "home" else path.unlink()

    def test_migration_rejects_wrong_identity_invalid_marker_or_unprotected_metadata(self):
        invalid = [{key: value} for key, value in (("format", "other"), ("name", "other"), ("uid", 12345),
                   ("home", str(self.base / "other")), ("root", str(self.base / "other")))]
        invalid += [{"marker": value} for value in ("asa-setup:" + "a" * 31, "asa-setup:" + "A" * 32,
                   "asa-setup:" + "a" * 32 + "\n", "asa-setup-" + "a" * 32 + ":", "asa-setup-" + "a" * 31)]
        for changes in invalid:
            with self.subTest(changes=changes):
                self.legacy_intent(**changes)
                original = (self.state / "operator-intent.json").read_bytes()
                with self.assertRaises(launcher.SetupBlocked):
                    launcher.prepare_default_operator(self.root, self.plan)
                self.assertEqual((self.state / "operator-intent.json").read_bytes(), original)
                self.assert_no_account_mutation()
        for path in (self.state, self.state / "operator-intent.json"):
            for owner, mode in ((12345, 0o700 if path == self.state else 0o600), (0, 0o777 if path == self.state else 0o644)):
                with self.subTest(path=path.name, owner=owner, mode=mode):
                    self.legacy_intent()
                    original = (self.state / "operator-intent.json").read_bytes()
                    self.metadata_owners[path] = owner
                    path.chmod(mode)
                    try:
                        with self.assertRaises(launcher.SetupBlocked):
                            launcher.prepare_default_operator(self.root, self.plan)
                        self.assertEqual((self.state / "operator-intent.json").read_bytes(), original)
                        self.assert_no_account_mutation()
                    finally:
                        self.metadata_owners.pop(path)
                        path.chmod(0o755 if path == self.state else 0o600)

    def test_interrupted_migration_preserves_old_intent_and_retries_without_new_nonce(self):
        old = self.legacy_intent()
        original = (self.state / "operator-intent.json").read_bytes()
        with patch.object(launcher.os, "replace", side_effect=OSError("interrupted before atomic replace")), \
             self.assertRaises(OSError):
            launcher.prepare_default_operator(self.root, self.plan)
        self.assertEqual((self.state / "operator-intent.json").read_bytes(), original)
        self.assertEqual({path.name for path in self.state.iterdir()}, {"operator-intent.json"})
        self.assert_no_account_mutation()
        self.assertEqual(launcher.prepare_default_operator(self.root, self.plan), 12345)
        self.assertEqual(self.account.pw_gecos, "asa-setup-" + old["marker"].split(":")[1])

    def test_interruption_after_migration_before_useradd_reuses_durable_marker(self):
        old = self.legacy_intent()
        def interrupted(args, **kwargs):
            if args[0] == "/usr/sbin/useradd":
                raise OSError("interrupted before useradd")
            return self.runner(args, **kwargs)
        self.run_mock.side_effect = interrupted
        with self.assertRaises(OSError):
            launcher.prepare_default_operator(self.root, self.plan)
        migrated = json.loads((self.state / "operator-intent.json").read_text())
        self.assertEqual(migrated["marker"], "asa-setup-" + old["marker"].split(":")[1])
        self.assertFalse(self.home.exists())
        self.assertFalse((self.state / "operator.json").exists())
        self.run_mock.side_effect = self.runner
        self.assertEqual(launcher.prepare_default_operator(self.root, self.plan), 12345)
        self.assertEqual(self.account.pw_gecos, migrated["marker"])

    def test_identity_appearing_before_replace_blocks_migration_without_chown(self):
        sync = os.fsync
        for conflict in ("account", "home", "receipt"):
            with self.subTest(conflict=conflict):
                self.legacy_intent()
                original = (self.state / "operator-intent.json").read_bytes()
                def race(descriptor):
                    sync(descriptor)
                    if conflict == "account":
                        self.account = SimpleNamespace(pw_uid=22222, pw_gecos="foreign")
                    elif conflict == "home":
                        self.home.mkdir(mode=0o700)
                    else:
                        receipt = self.state / "operator.json"
                        receipt.write_bytes(b"{}")
                        receipt.chmod(0o600)
                try:
                    with patch.object(launcher.os, "fsync", side_effect=race), patch.object(launcher.os, "fchown") as chown, \
                         self.assertRaises(launcher.SetupBlocked) as caught:
                        launcher.prepare_default_operator(self.root, self.plan)
                    self.assertEqual(caught.exception.code, "OPERATOR_CONFLICT")
                    self.assertEqual((self.state / "operator-intent.json").read_bytes(), original)
                    self.assert_no_account_mutation()
                    chown.assert_not_called()
                    self.assertFalse(any(path.name.startswith(".asa-operator-intent-") for path in self.state.iterdir()))
                finally:
                    if conflict == "account":
                        self.account = None
                    elif conflict == "home":
                        self.home.rmdir()
                    else:
                        (self.state / "operator.json").unlink()

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
