"""Hermetic Windows tests for the persistent, integrity-checked ASA Lab bootstrap.

Tests use a synthetic Git repository and a stub setup script in TemporaryDirectory.
No real ASA containers, Docker resources, host settings or user installations are touched.
"""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

BOOTSTRAP = Path(__file__).resolve().parents[1] / "asa-bootstrap.ps1"
POWERSHELL = shutil.which("powershell.exe") or shutil.which("powershell")
GIT = shutil.which("git")


@unittest.skipUnless(os.name == "nt" and POWERSHELL and GIT, "Windows PowerShell and Git required")
class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="asa-bootstrap-qa-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.tools = self.source / "tools"
        (self.tools / "deployment").mkdir(parents=True)
        self.installer = self.root / "persistent-installer"
        self.app = self.root / "target-app"
        shutil.copyfile(BOOTSTRAP, self.tools / "asa-bootstrap.ps1")
        (self.tools / "asa-setup.ps1").write_text(
            '[CmdletBinding()] param([Parameter(Mandatory=$true)][string]$Root,'
            '[string]$Mode="auto",[switch]$Apply)\n'
            "Write-Output ('STUB_ROOT=' + $Root)\n"
            "Write-Output ('STUB_MODE=' + $Mode)\n"
            "exit 0\n", encoding="utf-8")
        (self.tools / "asa_manager.py").write_text(
            '# Synthetic manager for isolated bootstrap tests\n', encoding="utf-8")
        (self.tools / "deployment" / "__init__.py").write_text(
            '# synthetic module\n', encoding="utf-8")
        self.git("init", "-q")
        self.git("config", "user.name", "ASA Windows QA")
        self.git("config", "user.email", "qa@example.invalid")
        self.git("remote", "add", "origin", "https://github.com/spikeal8-maker/asa-lab.git")
        self.git("add", ".")
        self.git("commit", "-qm", "QA synthetic source")
        self.commit = self.git("rev-parse", "HEAD").stdout.strip()

    def git(self, *args):
        result = subprocess.run(
            [GIT, "-C", str(self.source), *args],
            text=True, encoding="utf-8", errors="replace",
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=25,
            check=False)
        if result.returncode:
            self.fail("Git fixture failed: " + result.stdout)
        return result

    def ps(self, script, *args, official_sha=None, official_unavailable=False):
        command = [POWERSHELL, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"]
        if "-InstallBootstrap" in args:
            # Mock only the external HTTPS GitHub API at the PowerShell command
            # boundary. Production Bootstrap has no caller-settable URL or bypass.
            sha = official_sha if official_sha is not None else self.commit
            if official_unavailable:
                stub = "function Invoke-RestMethod { throw 'QA network unavailable' }; "
            else:
                stub = ("function Invoke-RestMethod { param($Method,$Uri,$TimeoutSec,$Headers) "
                        "if ($Uri -cne 'https://api.github.com/repos/spikeal8-maker/asa-lab/branches/main') "
                        "{ throw 'Wrong official endpoint' }; "
                        "return [pscustomobject]@{name='main';commit=[pscustomobject]@{sha='" + sha + "'}} }; ")
            def quoted(value):
                return "'" + str(value).replace("'", "''") + "'"
            arguments = " ".join(
                value if isinstance(value, str) and value.startswith("-") else quoted(value)
                for value in args
            )
            command += ["-Command", stub + "& " + quoted(script) + " " + arguments]
        else:
            command += ["-File", str(script), *map(str, args)]
        return subprocess.run(
            command, text=True, encoding="utf-8", errors="replace",
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=45, check=False)

    def stage(self, sha=None):
        return self.ps(
            self.tools / "asa-bootstrap.ps1", "-InstallBootstrap", "-InstallerHome",
            self.installer, "-ExpectedCommit", sha or self.commit)

    def test_staged_installer_survives_source_removal(self):
        stage = self.stage()
        self.assertEqual(stage.returncode, 0, stage.stdout)
        self.assertIn("[PASS]", stage.stdout)
        launcher = self.installer / "asa-bootstrap.ps1"
        self.assertTrue(launcher.is_file())
        self.assertTrue((self.installer / "active.json").is_file())
        # The source disappears, simulating a checkout switching to an older SHA.
        (self.tools / "asa-setup.ps1").unlink()
        running = self.ps(launcher, "-InstallerHome", self.installer,
                          "-Root", self.app, "-Mode", "update")
        self.assertEqual(running.returncode, 0, running.stdout)
        self.assertIn("STUB_ROOT=" + str(self.app), running.stdout)
        self.assertIn("STUB_MODE=update", running.stdout)
        version = self.ps(launcher, "-InstallerHome", self.installer, "-ShowVersion")
        self.assertEqual(version.returncode, 0, version.stdout)
        self.assertIn(self.commit, version.stdout)

    def test_bootstrap_hash_works_without_get_filehash_cmdlet(self):
        # Regression for Windows CI shells without Microsoft.PowerShell.Utility.
        # A function deliberately disables the cmdlet in this synthetic process.
        quoted = str(self.tools / "asa-bootstrap.ps1").replace("'", "''")
        home = str(self.installer).replace("'", "''")
        cmd = (
            "function Get-FileHash { throw 'GET_FILEHASH_FORBIDDEN' }; "
            "function Invoke-RestMethod { param($Method,$Uri,$TimeoutSec,$Headers) "
            "return [pscustomobject]@{name='main';commit="
            "[pscustomobject]@{sha='" + self.commit + "'}} }; "
            "& '" + quoted + "' -InstallBootstrap -InstallerHome '" + home +
            "' -ExpectedCommit '" + self.commit + "'"
        )
        result = subprocess.run(
            [POWERSHELL, "-NoProfile", "-NonInteractive", "-ExecutionPolicy",
             "Bypass", "-Command", cmd],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
            timeout=50, check=False)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertNotIn("GET_FILEHASH_FORBIDDEN", result.stdout)
        self.assertTrue((self.installer / "active.json").is_file())

    def test_real_manager_imports_from_independent_package(self):
        original = Path(__file__).resolve().parents[1]
        shutil.copyfile(original / "asa_manager.py", self.tools / "asa_manager.py")
        shutil.rmtree(self.tools / "deployment")
        shutil.copytree(
            original / "deployment", self.tools / "deployment",
            ignore=shutil.ignore_patterns("test_*.py", "__pycache__", "*.pyc"))
        self.git("add", ".")
        self.git("commit", "-qm", "QA real manager dependencies")
        self.commit = self.git("rev-parse", "HEAD").stdout.strip()
        staged = self.stage()
        self.assertEqual(staged.returncode, 0, staged.stdout)
        shutil.rmtree(self.tools)
        manager = self.installer / "packages" / self.commit / "asa_manager.py"
        probe = subprocess.run(
            [sys.executable, str(manager), "--help"],
            text=True, encoding="utf-8", errors="replace",
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            timeout=20, check=False)
        self.assertEqual(probe.returncode, 0, probe.stdout)
        self.assertIn("install", probe.stdout)
        self.assertIn("update", probe.stdout)

    def test_initial_stage_and_run_is_one_explicit_command(self):
        result = self.ps(self.tools / "asa-bootstrap.ps1", "-InstallBootstrap",
                         "-InstallerHome", self.installer, "-ExpectedCommit", self.commit,
                         "-Root", self.app, "-Mode", "clean")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("STUB_MODE=clean", result.stdout)
        self.assertIn("STUB_ROOT=" + str(self.app), result.stdout)

    def test_corrupt_package_fails_closed(self):
        staged = self.stage()
        self.assertEqual(staged.returncode, 0, staged.stdout)
        package_file = self.installer / "packages" / self.commit / "asa-setup.ps1"
        with package_file.open("a", encoding="utf-8") as stream:
            stream.write("\n# tampered\n")
        launched = self.ps(self.installer / "asa-bootstrap.ps1", "-InstallerHome",
                           self.installer, "-Root", self.app)
        self.assertNotEqual(launched.returncode, 0)
        self.assertIn("PACKAGE_HASH", launched.stdout)

    def test_local_sha_not_official_main_fails_closed(self):
        # Caller supplies the exact Git HEAD, but trusted GitHub main differs.
        result = self.ps(
            self.tools / "asa-bootstrap.ps1", "-InstallBootstrap", "-InstallerHome",
            self.installer, "-ExpectedCommit", self.commit,
            official_sha="f" * 40)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("SOURCE_NOT_OFFICIAL_MAIN", result.stdout)
        self.assertFalse((self.installer / "active.json").exists())

    def test_official_github_unavailable_fails_closed(self):
        result = self.ps(
            self.tools / "asa-bootstrap.ps1", "-InstallBootstrap", "-InstallerHome",
            self.installer, "-ExpectedCommit", self.commit,
            official_unavailable=True)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("OFFICIAL_SOURCE_UNAVAILABLE", result.stdout)
        self.assertFalse((self.installer / "active.json").exists())

    def test_unexpected_package_executable_or_bytecode_fails_closed(self):
        staged = self.stage()
        self.assertEqual(staged.returncode, 0, staged.stdout)
        package = self.installer / "packages" / self.commit
        launcher = self.installer / "asa-bootstrap.ps1"
        for relative in ("injected.ps1", "injected.exe", "deployment/extra.py",
                         "deployment/__pycache__/extra.pyc", "hidden.cmd"):
            with self.subTest(relative=relative):
                unwanted = package / relative
                unwanted.parent.mkdir(parents=True, exist_ok=True)
                unwanted.write_bytes(b"nonempty synthetic file")
                run = self.ps(launcher, "-InstallerHome", self.installer,
                              "-Root", self.app)
                self.assertNotEqual(run.returncode, 0, run.stdout)
                self.assertIn("PACKAGE_EXTRA_PATH", run.stdout)
                unwanted.unlink()
                if unwanted.parent.name == "__pycache__":
                    unwanted.parent.rmdir()

    def test_unexpected_empty_directory_fails_closed(self):
        staged = self.stage()
        self.assertEqual(staged.returncode, 0, staged.stdout)
        package = self.installer / "packages" / self.commit
        (package / "unlisted").mkdir()
        run = self.ps(self.installer / "asa-bootstrap.ps1", "-InstallerHome",
                      self.installer, "-ShowVersion")
        self.assertNotEqual(run.returncode, 0, run.stdout)
        self.assertIn("PACKAGE_EXTRA_PATH", run.stdout)

    def test_concurrent_activation_is_serialized(self):
        self.installer.mkdir(parents=True)
        lock = self.installer / ".bootstrap-stage.lock"
        quoted = str(lock).replace("'", "''")
        holder = subprocess.Popen(
            [POWERSHELL, "-NoProfile", "-NonInteractive", "-ExecutionPolicy",
             "Bypass", "-Command",
             "$lock=[IO.File]::Open('" + quoted +
             "',[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,"
             "[IO.FileShare]::None); Write-Output 'LOCK_HELD'; "
             "Start-Sleep -Seconds 4; $lock.Dispose()"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace")
        try:
            self.assertEqual(holder.stdout.readline().strip(), "LOCK_HELD")
            attempt = self.stage()
            self.assertNotEqual(attempt.returncode, 0, attempt.stdout)
            self.assertIn("BOOTSTRAP_LOCKED", attempt.stdout)
            self.assertFalse((self.installer / "active.json").exists())
        finally:
            holder.communicate(timeout=10)

    def test_unexpected_package_symlink_is_rejected(self):
        staged = self.stage()
        self.assertEqual(staged.returncode, 0, staged.stdout)
        target = self.root / "outside.py"
        target.write_text("print('not executable')", encoding="utf-8")
        linked = self.installer / "packages" / self.commit / "deployment" / "linked.py"
        try:
            linked.symlink_to(target)
        except (OSError, NotImplementedError):
            self.skipTest("Symlink creation requires Windows permission; host unchanged")
        run = self.ps(self.installer / "asa-bootstrap.ps1", "-InstallerHome",
                      self.installer, "-ShowVersion")
        self.assertNotEqual(run.returncode, 0, run.stdout)
        self.assertTrue("REPARSE_PATH" in run.stdout or "PACKAGE_EXTRA_PATH" in run.stdout)

    def test_wrong_pin_and_dirty_source_do_not_activate(self):
        wrong = self.stage("0" * 40)
        self.assertNotEqual(wrong.returncode, 0)
        self.assertIn("SOURCE_SHA", wrong.stdout)
        self.assertFalse((self.installer / "active.json").exists())
        with (self.tools / "asa_manager.py").open("a", encoding="utf-8") as stream:
            stream.write("# modified after commit\n")
        dirty = self.stage()
        self.assertNotEqual(dirty.returncode, 0)
        self.assertIn("SOURCE_DIRTY", dirty.stdout)
        self.assertFalse((self.installer / "active.json").exists())

    def test_repeat_staging_same_verified_version(self):
        first = self.stage()
        self.assertEqual(first.returncode, 0, first.stdout)
        active = self.installer / "active.json"
        baseline = active.read_bytes()
        second = self.stage()
        self.assertEqual(second.returncode, 0, second.stdout)
        self.assertEqual(active.read_bytes(), baseline)

    def test_upgrade_retains_old_verified_package(self):
        first = self.stage()
        self.assertEqual(first.returncode, 0, first.stdout)
        old_commit = self.commit
        with (self.tools / "asa_manager.py").open("a", encoding="utf-8") as stream:
            stream.write("# next verified version\n")
        self.git("add", ".")
        self.git("commit", "-qm", "QA new installer manager")
        self.commit = self.git("rev-parse", "HEAD").stdout.strip()
        second = self.stage()
        self.assertEqual(second.returncode, 0, second.stdout)
        self.assertTrue((self.installer / "packages" / old_commit / "manifest.json").is_file())
        self.assertTrue((self.installer / "packages" / self.commit / "manifest.json").is_file())
        version = self.ps(self.installer / "asa-bootstrap.ps1",
                          "-InstallerHome", self.installer, "-ShowVersion")
        self.assertEqual(version.returncode, 0, version.stdout)
        self.assertIn(self.commit, version.stdout)


if __name__ == "__main__":
    unittest.main()
