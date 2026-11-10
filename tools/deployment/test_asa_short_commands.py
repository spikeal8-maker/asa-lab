"""Portable ASA CLI: identity, read-only commands and safe installation."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipIf(os.name == "nt", "The portable POSIX operator command runs on Linux")
class PortableASACommandTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "school"
        self.tools = self.root / "tools"
        self.state = self.root / ".asa"
        self.tools.mkdir(parents=True)
        self.state.mkdir()
        shutil.copy2(ROOT / "tools" / "asa", self.tools / "asa")
        shutil.copy2(ROOT / "tools" / "install-asa-command.sh", self.tools / "install-asa-command.sh")
        (self.tools / "asa").chmod(0o755)
        (self.tools / "install-asa-command.sh").chmod(0o755)
        (self.tools / "asa_manager.py").write_text(
            "import json,sys\nprint(json.dumps(sys.argv[1:]))\n", encoding="utf-8"
        )
        (self.tools / "asa_status.py").write_text(
            "import json,sys\nprint(json.dumps(sys.argv[1:]))\n", encoding="utf-8"
        )
        (self.state / "installation.json").write_text(
            json.dumps({"format": "asa-installation-v1", "project": "asa-lab-school", "profile": "production"}),
            encoding="utf-8",
        )
        self.env = {**os.environ, "ASA_INSTALL_ROOT": str(self.root), "ASA_PYTHON": sys.executable}

    def call(self, *args, script="asa", env=None):
        return subprocess.run(
            ["sh", str(self.tools / script), *args], capture_output=True, text=True,
            env=env or self.env, timeout=10,
        )

    def test_help_does_not_run_manager(self):
        result = self.call("help")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("asa check", result.stdout)

    def test_status_read_only_routes_to_status_module(self):
        result = self.call("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), ["status", "--root", str(self.root)])

    def test_explicit_digest_is_forwarded_to_manager(self):
        digest = "sha256:" + "a" * 64
        result = self.call("check", "--deployment-digest", digest)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [
            "check", "--root", str(self.root), "--profile", "production",
            "--deployment-digest", digest,
        ])

    def test_production_update_with_advanced_options_requires_immutable_release(self):
        blocked = self.call("update", "--scheduled")
        self.assertEqual(blocked.returncode, 64)
        self.assertIn("--deployment-digest", blocked.stderr)
        digest = "sha256:" + "b" * 64
        guarded = self.call("update", "--deployment-digest", digest)
        self.assertEqual(guarded.returncode, 0, guarded.stderr)
        arguments = json.loads(guarded.stdout)
        self.assertIn("--require-application-rollback", arguments)
        self.assertEqual(arguments.count("--require-application-rollback"), 1)
        explicit = self.call("update", "--deployment-digest", digest, "--require-application-rollback")
        self.assertEqual(explicit.returncode, 0, explicit.stderr)
        self.assertEqual(json.loads(explicit.stdout).count("--require-application-rollback"), 1)

    def test_plain_production_rejects_external_manager_environment_override(self):
        external = Path(self.temp.name) / "approved"
        (external / "tools").mkdir(parents=True)
        (external / "tools" / "asa_manager.py").write_text(
            "import json,sys\nprint(json.dumps(['external', *sys.argv[1:]]))\n", encoding="utf-8"
        )
        env = {**self.env, "ASA_UPDATE_TOOLS_ROOT": str(external)}
        for action in ("check", "update"):
            with self.subTest(action=action):
                result = self.call(action, env=env)
                self.assertEqual(result.returncode, 64)
                self.assertFalse(result.stdout)
                self.assertIn("постоянную команду", result.stderr)

    def test_without_profile_does_not_update_unknown_installation(self):
        (self.state / "installation.json").unlink()
        result = self.call("update")
        self.assertEqual(result.returncode, 64)
        self.assertIn("ASA_PROFILE", result.stderr)

    def test_profile_and_root_cannot_be_overridden_as_late_arguments(self):
        for extra in (("--profile", "dev"), ("--profile=dev",), ("--root", "/tmp"),
                      ("--root=/tmp",)):
            with self.subTest(extra=extra):
                blocked = self.call("check", *extra)
                self.assertEqual(blocked.returncode, 64)
        unsafe_env = {**self.env, "ASA_PROFILE": "dev"}
        blocked = self.call("update", env=unsafe_env)
        self.assertEqual(blocked.returncode, 64)
        self.assertIn("не совпадает", blocked.stderr)

    def test_unknown_command_fails_closed(self):
        result = self.call("up-force")
        self.assertEqual(result.returncode, 64)

    def test_installer_is_idempotent_and_does_not_overwrite(self):
        bindir = Path(self.temp.name) / "bin"
        bindir.mkdir()
        env = {**self.env, "ASA_BIN_DIR": str(bindir)}
        first = self.call(script="install-asa-command.sh", env=env)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual((bindir / "asa").resolve(), self.tools / "asa")
        second = self.call(script="install-asa-command.sh", env=env)
        self.assertEqual(second.returncode, 0, second.stderr)
        (bindir / "asa").unlink()
        (bindir / "asa").write_text("do not replace\n", encoding="utf-8")
        third = self.call(script="install-asa-command.sh", env=env)
        self.assertEqual(third.returncode, 64)
        self.assertEqual((bindir / "asa").read_text(), "do not replace\n")

    def test_installed_symlink_resolves_same_repository(self):
        bindir = Path(self.temp.name) / "bin"
        bindir.mkdir()
        env = {**self.env, "ASA_BIN_DIR": str(bindir)}
        self.assertEqual(self.call(script="install-asa-command.sh", env=env).returncode, 0)
        (self.state / "installation.json").write_text('{"profile":"dev"}', encoding="utf-8")
        env.pop("ASA_INSTALL_ROOT")
        result = subprocess.run([str(bindir / "asa"), "check"], capture_output=True, text=True, env=env, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        args = json.loads(result.stdout)
        self.assertEqual(args[:5], ["check", "--root", str(self.root), "--profile", "dev"])

    @unittest.skipUnless(os.name == "posix" and os.geteuid() == 0, "Production launcher is installed by root")
    def test_production_launcher_survives_application_switch_and_rejects_writable_tools(self):
        with tempfile.TemporaryDirectory(dir="/root", prefix="asa-launcher-test-") as work:
            external = Path(work) / "tools-checkout"
            bindir = Path(work) / "bin"
            bindir.mkdir()
            shutil.copytree(self.tools, external / "tools")
            def git(*args):
                return subprocess.check_output(["git", "-C", str(external), *args], text=True, stderr=subprocess.PIPE)
            git("init", "--quiet")
            git("remote", "add", "origin", "https://github.com/spikeal8-maker/asa-lab.git")
            git("add", "tools")
            git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture")
            git("update-ref", "refs/remotes/origin/main", "HEAD")
            launcher = bindir / "asa"
            launcher.symlink_to(self.tools / "asa")
            result = subprocess.run(["sh", str(external / "tools" / "install-asa-command.sh"), "--production"],
                                    env={**self.env, "ASA_BIN_DIR": str(bindir)}, text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(launcher.is_symlink())
            (self.tools / "asa").write_text("#!/bin/sh\nexit 97\n", encoding="utf-8")
            def launch(*args):
                return subprocess.run([str(launcher), *args], capture_output=True, text=True, timeout=10,
                                      env={**self.env, "ASA_INSTALL_ROOT": "/invalid", "ASA_PROFILE": "dev"})
            self.assertEqual(launch("--launcher-verify", str(self.root)).stdout.strip(), "ASA_LAUNCHER_OFFSITE_V1")
            self.assertEqual(launch("--launcher-verify", "/another-installation").returncode, 64)
            for action in ("check", "update"):
                with self.subTest(action=action):
                    result = launch(action)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(json.loads(result.stdout), [
                        action, "--root", str(self.root), "--profile", "production", "--operator",
                    ])
            manager = external / "tools" / "asa_manager.py"
            manager.chmod(0o666)
            result = launch("check")
            self.assertEqual(result.returncode, 64)
            self.assertFalse(result.stdout)
            self.assertIn("Небезопасный файл", result.stderr)
            manager.chmod(0o644)
            manager.write_text("raise RuntimeError('unapproved source')\n", encoding="utf-8")
            result = launch("check")
            self.assertEqual(result.returncode, 64)
            self.assertIn("отличаются от установленного коммита", result.stderr)


if __name__ == "__main__":
    unittest.main()
