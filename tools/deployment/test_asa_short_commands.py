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

    def test_production_update_requires_immutable_release(self):
        blocked = self.call("update")
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
        env.pop("ASA_INSTALL_ROOT")
        result = subprocess.run([str(bindir / "asa"), "check"], capture_output=True, text=True, env=env, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        args = json.loads(result.stdout)
        self.assertEqual(args[:5], ["check", "--root", str(self.root), "--profile", "production"])


if __name__ == "__main__":
    unittest.main()
