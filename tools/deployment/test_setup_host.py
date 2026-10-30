"""Host and bootstrap boundaries tested without installing packages or changing UID."""

import contextlib
import hashlib
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
from deployment.setup_host import disk_budget, check_ports


@unittest.skipUnless(os.name == "posix", "Linux privilege/owner contract")
class OwnerBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / ".git").mkdir(mode=0o755)
        (self.root / ".asa").mkdir(mode=0o700)
        (self.root / ".env").write_text("COMPOSE_PROJECT_NAME=synthetic\n", encoding="utf-8")
        (self.root / ".env").chmod(0o600)
        (self.root / "backups").mkdir(mode=0o700)

    def test_owner_comes_from_files_not_sudo_user(self):
        with patch.dict(os.environ, {"SUDO_USER": "unrelated-account", "SUDO_UID": "99999"}):
            actual = launcher.validate_owner(self.root)
        self.assertEqual(actual["uid"], os.getuid())

    def test_explicit_other_owner_does_not_repair_files(self):
        before = (self.root / ".env").stat()
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.validate_owner(self.root, operator_uid=os.getuid() + 1)
        self.assertEqual(caught.exception.code, "OWNER_MISMATCH")
        after = (self.root / ".env").stat()
        self.assertEqual((before.st_uid, before.st_mode), (after.st_uid, after.st_mode))

    def test_symlink_env_rejected(self):
        (self.root / ".env").rename(self.root / "actual.env")
        (self.root / ".env").symlink_to(self.root / "actual.env")
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.validate_owner(self.root)
        self.assertEqual(caught.exception.code, "PATH_LINK")

    def test_hardlinked_config_rejected(self):
        os.link(self.root / ".env", self.root / "linked.env")
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.validate_owner(self.root)
        self.assertEqual(caught.exception.code, "PATH_HARDLINK")

    def test_public_private_state_is_not_silently_chmodded(self):
        (self.root / ".asa").chmod(0o755)
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.validate_owner(self.root)
        self.assertEqual(caught.exception.code, "OWNER_PRIVATE")
        self.assertEqual((self.root / ".asa").stat().st_mode & 0o777, 0o755)

    def test_group_writable_repository_rejected(self):
        (self.root / ".git").chmod(0o775)
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.validate_owner(self.root)
        self.assertEqual(caught.exception.code, "OWNER_WRITABLE")

    def test_root_owned_existing_installation_is_identified_without_chown(self):
        if os.getuid() != 0:
            self.skipTest("requires synthetic root-owned fixture")
        self.assertEqual(launcher.validate_owner(self.root)["uid"], 0)

    def test_unprotected_bundle_is_not_a_root_trust_anchor(self):
        with self.assertRaises(launcher.SetupBlocked):
            launcher.verify_bundle(self.root)

    def legacy_fixture(self):
        from deployment.contracts import atomic_json, DEFAULT_WINDOW
        metadata = self.root / ".asa/installation.json"
        lock = self.root / ".asa/operation.lock"
        # Match asa_manager.save_settings and the old operation_lock writer
        # under a typical 022 umask, including the real legacy field names.
        previous_umask = os.umask(0o022)
        try:
            atomic_json(metadata, {"format": "asa-installation-v1", "profile": "production", "project": "synthetic",
                "automaticUpdates": False, "window": dict(DEFAULT_WINDOW), "backupDirectory": str(self.root / "backups"),
                "instanceId": "a" * 32})
            with lock.open("a+b") as stream:
                stream.write(b"0")
        finally:
            os.umask(previous_umask)
        return metadata, lock

    def test_actual_legacy_metadata_and_lock_0644_discover_without_chmod(self):
        metadata, lock = self.legacy_fixture()
        before = metadata.read_bytes()
        for permissions in (0o644, 0o640):
            with self.subTest(permissions=oct(permissions)):
                metadata.chmod(permissions)
                lock.chmod(permissions)
                owner = launcher.validate_owner(self.root)
                self.assertEqual(owner["uid"], os.getuid())
                self.assertEqual(owner["backupDirectory"], str(self.root / "backups"))
                self.assertEqual(metadata.read_bytes(), before)
                self.assertEqual(metadata.stat().st_mode & 0o777, permissions)
                self.assertEqual(lock.stat().st_mode & 0o777, permissions)
        from deployment.system import operation_lock
        with operation_lock(self.root) as descriptor:
            self.assertEqual(os.fstat(descriptor).st_mode & 0o777, 0o600)
        self.assertEqual(metadata.read_bytes(), before)
        self.assertEqual(metadata.stat().st_mode & 0o777, 0o640)

    def test_legacy_metadata_external_write_is_rejected_without_repair(self):
        metadata, _ = self.legacy_fixture()
        metadata.chmod(0o664)
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.validate_owner(self.root)
        self.assertEqual(caught.exception.code, "LEGACY_PERMISSIONS")
        self.assertEqual(metadata.stat().st_mode & 0o777, 0o664)

    def test_legacy_lock_external_write_is_rejected_without_repair(self):
        _, lock = self.legacy_fixture()
        lock.chmod(0o664)
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.validate_owner(self.root)
        self.assertEqual(caught.exception.code, "OWNER_WRITABLE")
        self.assertEqual(lock.stat().st_mode & 0o777, 0o664)

    def test_legacy_reader_still_rejects_links_and_foreign_schema(self):
        metadata, _ = self.legacy_fixture()
        alias = metadata.with_suffix(".copy")
        os.link(metadata, alias)
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.read_legacy_installation(self.root)
        self.assertEqual(caught.exception.code, "PATH_HARDLINK")
        alias.unlink()
        metadata.rename(alias)
        metadata.symlink_to(alias)
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.read_legacy_installation(self.root)
        self.assertEqual(caught.exception.code, "PATH_LINK")
        metadata.unlink()
        metadata.write_text('{"format":"asa-setup-config-v1"}', encoding="utf-8")
        metadata.chmod(0o644)
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.read_legacy_installation(self.root)
        self.assertEqual(caught.exception.code, "LEGACY_SCHEMA")

    def test_legacy_exception_never_allows_public_secret_config(self):
        self.legacy_fixture()
        for name in ("setup.json", "onboarding.json", "setup-last-attempt.json"):
            path = self.root / ".asa" / name
            path.write_text("{}", encoding="utf-8")
            path.chmod(0o644)
            with self.subTest(name=name), self.assertRaises(launcher.SetupBlocked) as caught:
                launcher.read_private_json(path)
            self.assertEqual(caught.exception.code, "CONFIG_PERMISSIONS")
        (self.root / ".env").chmod(0o644)
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.validate_owner(self.root)
        self.assertEqual(caught.exception.code, "OWNER_PRIVATE")


class HostPreflightTests(unittest.TestCase):
    def test_exact_platform_profile_and_architecture(self):
        with tempfile.TemporaryDirectory() as temporary:
            release = Path(temporary) / "os-release"
            release.write_text('ID=ubuntu\nVERSION_ID="24.04"\n', encoding="utf-8")
            self.assertTrue(launcher.platform_info(release, "x86_64")["supported"])
            self.assertFalse(launcher.platform_info(release, "aarch64")["supported"])
            release.write_text('ID=ubuntu\nVERSION_ID="22.04"\n', encoding="utf-8")
            self.assertFalse(launcher.platform_info(release, "x86_64")["supported"])

    def test_docker_failure_never_selects_engine_install(self):
        def fail(args):
            raise launcher.SetupBlocked("HOST_COMMAND", "socket", "inspect")
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher.dependency_plan(runner=fail, which=lambda name: "/usr/bin/" + name)
        self.assertEqual(caught.exception.code, "DOCKER_UNKNOWN")

    def test_existing_healthy_engine_is_not_added_to_package_plan(self):
        def runner(args):
            return "daemon-one" if "info" in args else "2.39.4"
        result = launcher.dependency_plan(cloud=False, runner=runner, which=lambda name: "/usr/bin/" + name)
        self.assertFalse(result["installDocker"])
        self.assertFalse(set(result["missing"]) & set(launcher.DOCKER_PACKAGES))

    def test_shared_docker_cloud_transport_does_not_require_host_rclone(self):
        def which(name):
            return None if name == "rclone" else "/usr/bin/" + name
        result = launcher.dependency_plan(cloud=True, runner=lambda args: "ok", which=which)
        self.assertNotIn("rclone", result["missing"])

    def test_missing_compose_plans_only_plugin_without_engine_upgrade(self):
        def runner(args):
            if "compose" in args:
                raise launcher.SetupBlocked("HOST_COMMAND", "missing", "install")
            if "dpkg-query" in args[0]:
                return "docker-ce\tinstall ok installed\n"
            return "daemon-one"
        plan = launcher.dependency_plan(runner=runner, which=lambda name: "/usr/bin/" + name)
        self.assertEqual(set(plan["missing"]) & set(launcher.DOCKER_PACKAGES), {"docker-compose-plugin"})
        self.assertFalse(plan["installDocker"])

    def test_package_database_failure_is_not_missing_package(self):
        with self.assertRaises(launcher.SetupBlocked):
            launcher._installed("docker-ce", lambda args: (_ for _ in ()).throw(launcher.SetupBlocked("HOST_COMMAND", "failed", "inspect")))

    def test_browser_dependencies_add_only_missing_official_packages(self):
        missing = "libnss3"
        def runner(args):
            if "dpkg-query" in args[0]:
                return "\n".join(package + "\tinstall ok installed" for package in launcher.CHROMIUM_PACKAGES if package != missing)
            return "daemon-one"
        plan = launcher.dependency_plan(browser=True, runner=runner, which=lambda name: "/usr/bin/" + name)
        self.assertEqual(set(plan["missing"]) & set(launcher.CHROMIUM_PACKAGES), {missing})

    def test_package_simulation_blocks_upgrades_and_never_installs(self):
        calls = []
        def runner(args, **kwargs):
            calls.append(args)
            if "policy" in args:
                return "Candidate: 1.2.3-1\n"
            return "Inst libc6 [2.38] (2.39 Ubuntu)\n"
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher._apt_install(["age"], runner)
        self.assertEqual(caught.exception.code, "PACKAGE_EXISTING_CHANGE")
        self.assertFalse(any("-y" in args for args in calls))

    def test_package_versions_are_pinned_at_install(self):
        calls = []
        def runner(args, **kwargs):
            calls.append(args)
            return "Candidate: 1.2.3-1\n" if "policy" in args else "Inst age (1.2.3-1 Ubuntu)\n"
        self.assertEqual(launcher._apt_install(["age"], runner), {"age": "1.2.3-1"})
        self.assertIn("age=1.2.3-1", calls[-1])
        self.assertIn("--no-remove", calls[-1])
        self.assertIn("--no-upgrade", calls[-1])

    def test_arbitrary_package_is_rejected_before_apt(self):
        with self.assertRaises(launcher.SetupBlocked):
            launcher._apt_install(["arbitrary-owner-input"], lambda args: self.fail("apt must not run"))

    def test_environment_drops_dynamic_import_and_git_overrides(self):
        owner = {"uid": 1000, "gid": 1000, "name": "operator", "home": "/home/operator"}
        with patch.dict(os.environ, {"PYTHONPATH": "/untrusted", "LD_PRELOAD": "/untrusted.so", "GIT_CONFIG_GLOBAL": "/untrusted.cfg"}):
            environment = launcher.operator_environment(owner, "expected-daemon")
        self.assertNotIn("PYTHONPATH", environment)
        self.assertNotIn("LD_PRELOAD", environment)
        self.assertNotIn("GIT_CONFIG_GLOBAL", environment)
        self.assertEqual(environment["HOME"], "/home/operator")
        self.assertEqual(environment["ASA_SETUP_DAEMON_ID"], "expected-daemon")

    def test_early_block_json_has_six_honest_checks(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = launcher.emit_blocked(launcher.SetupBlocked("OWNER", "Владелец не подтверждён", "Проверьте владельца"), as_json=True)
        result = json.loads(output.getvalue())
        self.assertEqual(code, 2)
        self.assertEqual(len(result["checks"]), 6)
        self.assertFalse(result["accepted"])
        self.assertNotIn("OK", [check["status"] for check in result["checks"]])

    def test_help_is_read_only_and_needs_no_docker_or_root_import(self):
        with patch.object(launcher, "verify_bundle", side_effect=AssertionError("help must not load application")), \
             patch.object(launcher, "dependency_plan", side_effect=AssertionError("help must not inspect Docker")), \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(launcher.main(["--help"]), 0)

    def test_invalid_port_is_rejected_without_binding(self):
        from deployment.contracts import Blocked
        with self.assertRaises(Blocked):
            check_ports([80])

    @unittest.skipUnless(hasattr(os, "statvfs"), "POSIX filesystem budget")
    def test_impossible_space_budget_is_blocked_before_data_mutation(self):
        from deployment.contracts import Blocked
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(Blocked) as caught:
                disk_budget(temporary, snapshot_bytes=10 ** 18)
        self.assertEqual(caught.exception.code, "SPACE")

    @unittest.skipUnless(hasattr(os, "statvfs"), "POSIX filesystem budget")
    def test_many_tiny_objects_need_actual_inode_budget_even_with_plenty_of_bytes(self):
        from deployment.contracts import Blocked
        with tempfile.TemporaryDirectory() as temporary, \
                patch("deployment.setup_host.shutil.disk_usage", return_value=SimpleNamespace(free=20 * 1024 ** 3)), \
                patch("deployment.setup_host.os.statvfs", return_value=SimpleNamespace(f_favail=2000, f_files=1_000_000)):
            with self.assertRaises(Blocked) as caught:
                disk_budget(temporary, snapshot_bytes=1024 * 1024, snapshot_entries=100_000)
            self.assertEqual(caught.exception.code, "SPACE")
        with tempfile.TemporaryDirectory() as temporary, \
                patch("deployment.setup_host.shutil.disk_usage", return_value=SimpleNamespace(free=20 * 1024 ** 3)), \
                patch("deployment.setup_host.os.statvfs", return_value=SimpleNamespace(f_favail=200_000, f_files=1_000_000)):
            observed = disk_budget(temporary, snapshot_bytes=1024 * 1024, snapshot_entries=100_000)
            self.assertTrue(observed["sufficient"])
            self.assertGreater(observed["requiredInodes"], 100_000)


@unittest.skipUnless(os.name == "posix", "Linux private runtime")
class BrowserPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / ("playwright-" + launcher.BROWSER_VERSION)

    def test_pinned_wheels_real_runtime_probe_and_atomic_promotion(self):
        calls = []
        def command(args, browsers, **kwargs):
            calls.append(args)
            if "venv" in args:
                python = Path(args[-1]) / "bin/python"
                python.parent.mkdir()
                python.write_text("synthetic executable is never run", encoding="utf-8")
            if "-c" in args:
                return json.dumps({"playwright": launcher.BROWSER_VERSION, "chromium": launcher.CHROMIUM_VERSION})
            return ""
        with patch.object(launcher, "_browser_command", side_effect=command):
            receipt = launcher.prepare_browser_runtime(self.root)
        self.assertEqual(receipt["state"], "READY")
        self.assertTrue((self.root / "asa-runtime.json").is_file())
        self.assertFalse((self.root.parent / ("." + self.root.name + ".staging")).exists())
        pip = next(args for args in calls if "pip" in args)
        self.assertIn("--require-hashes", pip)
        self.assertIn("--no-deps", pip)
        self.assertIn("--only-binary=:all:", pip)
        probe = next(args[-1] for args in calls if "-c" in args)
        self.assertIn("chromium.launch(headless=True)", probe)
        self.assertNotIn("chromium_sandbox=", probe)
        self.assertNotIn("--no-sandbox", probe)
        self.assertNotIn("ignore_https_errors", probe)

    def test_existing_unidentified_runtime_is_never_overwritten(self):
        self.root.mkdir()
        foreign = self.root / "unrelated-owner-file"
        foreign.write_text("preserve", encoding="utf-8")
        with patch.object(launcher, "_browser_command", side_effect=AssertionError("must not execute")):
            with self.assertRaises(launcher.SetupBlocked):
                launcher.prepare_browser_runtime(self.root)
        self.assertEqual(foreign.read_text(encoding="utf-8"), "preserve")

    def test_cloud_source_digest_checked_before_code_exec(self):
        source = self.root / "tools/deployment/ops/cloud_storage.py"
        source.parent.mkdir(parents=True)
        source.write_text("raise AssertionError('untrusted code executed')\n", encoding="utf-8")
        with self.assertRaises(launcher.SetupBlocked) as caught:
            launcher._trusted_cloud(self.root)
        self.assertEqual(caught.exception.code, "CLOUD_SOURCE")

    def test_existing_cloud_service_uses_full_docker_ids_and_is_reused(self):
        module = launcher.types.SimpleNamespace(PROJECT="asa-cloud-storage", IMAGE="rclone/rclone@sha256:" + "c" * 64,
            ROOT=Path("/srv/asa-cloud-storage"), connected=lambda: True,
            install=lambda: self.fail("existing verified running transport must not be recreated"))
        calls = []
        def docker(args):
            calls.append(args)
            if args[1] == "ps":
                # Docker -q normally returns a 12-character ID. This mock models
                # the real distinction so omitting --no-trunc cannot pass.
                return "d" * (64 if "--no-trunc" in args else 12)
            self.assertEqual(args[1], "inspect")
            self.assertEqual(args[-1], "d" * 64)
            return json.dumps({"image": module.IMAGE, "user": "1000:1000", "running": True,
                "owner": module.PROJECT, "ports": {}, "readonly": True, "mounts": [
                    {"Type": "bind", "Source": "/srv/asa-cloud-storage/config", "Destination": "/config/rclone"},
                    {"Type": "bind", "Source": "/srv/asa-cloud-storage/data", "Destination": "/data"}]})
        with patch.object(launcher, "_trusted_cloud", return_value=module), \
             patch.object(launcher, "_run", side_effect=docker), patch.object(launcher.os, "geteuid", return_value=0):
            receipt = launcher.prepare_cloud_transport(Path("/verified/bundle"), owner={"uid": 1000})
        self.assertTrue(receipt["reused"])
        self.assertTrue(receipt["tokenConfigured"])
        self.assertFalse(receipt["deliveryVerified"])
        self.assertIn("--no-trunc", calls[0])


@unittest.skipUnless(os.name == "posix", "Linux immutable bundle verification")
class ImmutableBundleTests(unittest.TestCase):
    def test_unlisted_python_bytecode_cannot_enter_verified_bundle(self):
        with tempfile.TemporaryDirectory() as temporary:
            bundle = Path(temporary)
            files = {}
            for name in ("asa-setup.sh", "tools/asa_setup_launcher.py", "tools/asa_setup.py"):
                path = bundle / name
                path.parent.mkdir(exist_ok=True)
                path.write_bytes(b"# fixture; never executed\n")
                path.chmod(0o644)
                files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
            manifest = {"format": "asa-setup-bundle-v1", "revision": "a" * 40, "files": files,
                        "origin": {"repository": launcher.REPOSITORY, "workflow": launcher.WORKFLOW}}
            (bundle / "setup-bundle.json").write_text(json.dumps(manifest), encoding="utf-8")
            (bundle / "setup-bundle.json").chmod(0o644)
            original_stat = Path.stat
            def protected_metadata(path, *args, **kwargs):
                info = original_stat(path, *args, **kwargs)
                values = list(info)
                values[4] = 0
                if path in bundle.parents:
                    # Only the fixture's external /tmp ancestry is simulated;
                    # the bundle's actual member set and modes remain real.
                    values[0] &= ~0o022
                return os.stat_result(values)
            with patch.object(Path, "stat", protected_metadata):
                self.assertEqual(launcher.verify_bundle(bundle)["revision"], "a" * 40)
                bytecode = bundle / "tools/__pycache__/asa_setup.cpython-312.pyc"
                bytecode.parent.mkdir()
                bytecode.write_bytes(b"unlisted bytecode")
                bytecode.chmod(0o644)
                with self.assertRaises(launcher.SetupBlocked) as caught:
                    launcher.verify_bundle(bundle)
                self.assertEqual(caught.exception.code, "BOOTSTRAP_EXTRA_FILES")


@unittest.skipUnless(os.name == "posix", "Linux supervisor privilege protocol")
class SupervisorBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.uid = launcher.pwd.getpwnam("nobody").pw_uid if os.getuid() == 0 else os.getuid()
        self.gid = launcher.pwd.getpwuid(self.uid).pw_gid
        (self.root / ".env").write_text("COMPOSE_PROJECT_NAME=synthetic\n", encoding="utf-8")
        (self.root / ".env").chmod(0o600)
        (self.root / ".asa").mkdir(mode=0o700)
        # CI may map only UID 0 in its user namespace. Model the fixture owner
        # metadata without chown/setuid; real path/permission safety is covered
        # separately by OwnerBoundaryTests above.
        original_stat = Path.stat
        def fixture_stat(path, *args, **kwargs):
            info = original_stat(path, *args, **kwargs)
            if path == self.root or self.root in path.parents:
                values = list(info)
                values[4:6] = [self.uid, self.gid]
                return os.stat_result(values)
            return info
        self.stat_patch = patch.object(Path, "stat", fixture_stat)
        self.stat_patch.start()
        self.addCleanup(self.stat_patch.stop)
        self.config = {"format": "asa-setup-config-v1", "root": str(self.root), "operatorUid": self.uid,
                       "installationId": "b" * 32, "project": "synthetic",
                       "backup": {"cloud": {"enabled": False}}, "browser": {"pythonPath": "/existing/runtime/python"}}
        self.config_path = self.root / ".asa/setup.json"
        self.save(self.config_path, self.config)

    def save(self, path, value):
        path.write_text(json.dumps(value), encoding="utf-8")
        path.chmod(0o600)

    def run_result(self, result, *, drift=False, command="auto"):
        calls = []
        def owner_call(owner, args, environment, **kwargs):
            calls.append(args)
            self.save(self.root / ".asa/setup-last-attempt.json", result)
            if drift:
                self.save(self.config_path, {**self.config, "installationId": "changed-installation"})
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
        with patch.object(launcher, "verify_bundle", return_value={}), \
             patch.object(launcher, "platform_info", return_value={"supported": True}), \
             patch.object(launcher.os, "geteuid", return_value=0), \
             patch.object(launcher, "dependency_plan", return_value={"missing": [], "installDocker": False, "daemonId": "daemon"}), \
             patch.object(launcher, "_owner_call", side_effect=owner_call), contextlib.redirect_stdout(io.StringIO()):
            code = launcher.main([command, "--root", str(self.root), "--config", str(self.config_path), "--non-interactive"])
        return code, calls

    def test_foreign_installation_result_cannot_install_root_timer(self):
        result = {"format": "asa-setup-result-v1", "operationId": "a" * 32, "installationId": "b" * 32,
                  "mode": "install", "outcome": "ACCEPTED", "postActions": [{"kind": "schedule"}]}
        code, calls = self.run_result(result, drift=True)
        self.assertEqual(code, 2)
        self.assertFalse(any("--root-action" in args for args in calls))

    def test_unrecognized_root_action_is_rejected(self):
        result = {"format": "asa-setup-result-v1", "operationId": "a" * 32, "installationId": "b" * 32,
                  "mode": "install", "outcome": "ACCEPTED", "postActions": [{"kind": "arbitrary-command"}]}
        code, calls = self.run_result(result)
        self.assertEqual(code, 2)
        self.assertEqual(len(calls), 1)

    def test_no_change_does_not_perform_hidden_schedule_repair(self):
        result = {"format": "asa-setup-result-v1", "operationId": "a" * 32, "installationId": "b" * 32,
                  "mode": "install", "outcome": "NO_CHANGE", "postActions": [{"kind": "schedule"}]}
        code, calls = self.run_result(result)
        self.assertEqual(code, 2)
        self.assertFalse(any("--root-action" in args for args in calls))

    def test_read_only_check_never_enters_supervision_post_actions(self):
        code, calls = self.run_result({"untrusted": "ignored"}, command="check")
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("--defer-report", calls[0])
        self.assertNotIn("--root-action", calls[0])

    def test_root_owned_legacy_blocks_before_any_child_or_package_preparation(self):
        self.uid = 0
        self.gid = 0
        self.config["operatorUid"] = 0
        self.save(self.config_path, self.config)
        code, calls = self.run_result({})
        self.assertEqual(code, 2)
        self.assertEqual(calls, [])

    def run_preparation(self, *, repeated=False, drift=False):
        calls, preparations = [], []
        outcome = {"format": "asa-setup-result-v1", "operationId": "a" * 32, "installationId": "b" * 32,
                   "mode": "install", "outcome": "PREPARATION_REQUIRED", "postActions": [],
                   "preparation": {"packages": True, "cloud": True, "browser": False}}
        def owner_call(owner, args, environment, **kwargs):
            calls.append(args)
            if "--defer-report" in args:
                result = {**outcome, "attempt": len(calls)}
                if len(calls) > 1 and not repeated:
                    result["outcome"] = "ACCEPTED"
                if len(calls) > 1 and drift:
                    result["operationId"] = "c" * 32
                self.save(self.root / ".asa/setup-last-attempt.json", result)
            return subprocess.CompletedProcess(args, 2 if len(calls) == 1 else 0, stdout="", stderr="")
        def prepare(root, owner, bundle, result, environment, **kwargs):
            preparations.append(result["operationId"])
            return environment
        output = io.StringIO()
        with patch.object(launcher, "verify_bundle", return_value={}), \
             patch.object(launcher, "platform_info", return_value={"supported": True}), \
             patch.object(launcher.os, "geteuid", return_value=0), \
             patch.object(launcher, "dependency_plan", return_value={"missing": [], "installDocker": False, "daemonId": "daemon"}), \
             patch.object(launcher, "prepare_handoff", side_effect=prepare), \
             patch.object(launcher, "_owner_call", side_effect=owner_call), contextlib.redirect_stdout(output):
            code = launcher.main(["auto", "--root", str(self.root), "--non-interactive", "--json"])
        return code, calls, preparations, output.getvalue()

    def test_preparation_resumes_same_operation_inside_same_invocation(self):
        code, calls, preparations, _ = self.run_preparation()
        self.assertEqual(code, 0)
        self.assertEqual(preparations, ["a" * 32])
        self.assertIn("auto", calls[0])
        self.assertIn("resume", calls[1])
        self.assertIn("--operation-id", calls[1])
        self.assertIn("a" * 32, calls[1])
        self.assertIn("--render-last", calls[2])
        self.assertTrue(all("-I" in args and "-B" in args for args in calls))
        self.assertFalse(any("--root-action" in args for args in calls))

    def test_preparation_cannot_loop_forever_or_select_new_operation(self):
        code, calls, preparations, output = self.run_preparation(repeated=True)
        self.assertEqual(code, 2)
        self.assertEqual(preparations, ["a" * 32] * 3)
        self.assertEqual(len(calls), 4)
        self.assertEqual(json.loads(output)["error"]["code"], "PREPARATION_LIMIT")
        self.assertEqual(json.loads(output)["operationId"], "a" * 32)

    def test_preparation_resume_cannot_change_operation_identity(self):
        code, calls, preparations, output = self.run_preparation(drift=True)
        self.assertEqual(code, 2)
        self.assertEqual(len(calls), 2)
        self.assertEqual(json.loads(output)["error"]["code"], "PREPARATION_IDENTITY")
        self.assertEqual(json.loads(output)["operationId"], "a" * 32)

    def prepare_fixture(self, *, switched=False):
        directory = self.root / ".asa/setup-operations"
        directory.mkdir(mode=0o700)
        journal = {"format": "asa-setup-operation-v1", "operationId": "a" * 32,
                   "installationId": "b" * 32, "root": str(self.root), "project": "synthetic",
                   "state": "RUNNING", "stages": {"switch": {"status": "intent"}} if switched else {}}
        self.save(directory / ("a" * 32 + ".json"), journal)
        return {"operationId": "a" * 32, "installationId": "b" * 32,
                "preparation": {"packages": True, "cloud": False, "browser": False}}

    def test_preparation_after_switch_intent_is_forbidden(self):
        request = self.prepare_fixture(switched=True)
        owner = launcher.validate_owner(self.root)
        with patch.object(launcher, "dependency_plan", side_effect=AssertionError("must not prepare after switch")):
            with self.assertRaises(launcher.SetupBlocked) as caught:
                launcher.prepare_handoff(self.root, owner, Path("/verified/bundle"), request, {})
        self.assertEqual(caught.exception.code, "PREPARATION_IDENTITY")

    def test_preparation_never_installs_replacement_daemon(self):
        request = self.prepare_fixture()
        owner = launcher.validate_owner(self.root)
        with patch.object(launcher, "dependency_plan", return_value={"missing": ["docker-ce"], "installDocker": True}), \
             patch.object(launcher, "provision_dependencies", side_effect=AssertionError("must preserve original daemon")):
            with self.assertRaises(launcher.SetupBlocked) as caught:
                launcher.prepare_handoff(self.root, owner, Path("/verified/bundle"), request, {})
        self.assertEqual(caught.exception.code, "DOCKER_UNKNOWN")

    def test_preparation_cannot_enable_unselected_cloud(self):
        request = self.prepare_fixture()
        request["preparation"]["cloud"] = True
        owner = launcher.validate_owner(self.root)
        with patch.object(launcher, "prepare_cloud_transport", side_effect=AssertionError("cloud was not selected")):
            with self.assertRaises(launcher.SetupBlocked) as caught:
                launcher.prepare_handoff(self.root, owner, Path("/verified/bundle"), request, {})
        self.assertEqual(caught.exception.code, "CLOUD_POLICY")


if __name__ == "__main__":
    unittest.main()
