"""WIN-02A safety: Windows prerequisites never modify the host in preflight.

All negative provisioning tests mock Get-Command and, if needed, call a
temporary fake winget CMD, never the actual host's Winget/Docker engine.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "asa-prerequisites.ps1"
PS = shutil.which("powershell.exe") or shutil.which("powershell")


@unittest.skipUnless(os.name == "nt" and PS, "Windows PowerShell required")
class PrerequisitesTests(unittest.TestCase):
    def invoke(self, args=(), mock=None):
        def quote(value):
            return "'" + str(value).replace("'", "''") + "'"
        arguments = " ".join(str(arg) if str(arg).startswith("-") else quote(arg) for arg in args)
        script = (mock or "") + " & " + quote(SCRIPT) + " " + arguments + "; exit $LASTEXITCODE"
        return subprocess.run(
            [PS, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
             "-Command", script],
            capture_output=True, text=True, encoding="utf8", errors="replace",
            timeout=25, check=False)

    @staticmethod
    def missing_all():
        return "function Get-Command { param($Name,$CommandType,$ErrorAction) return $null }; "

    def test_powershell_syntax(self):
        cmd = (
            "$tokens=$null; $errors=$null;"
            "[System.Management.Automation.Language.Parser]::ParseFile('"
            + str(SCRIPT).replace("'", "''") +
            "',[ref]$tokens,[ref]$errors)|Out-Null;"
            "if(@($errors).Count){$errors | ForEach-Object{$_.Message};exit 2}"
        )
        r = subprocess.run(
            [PS, "-NoProfile", "-NonInteractive", "-Command", cmd],
            capture_output=True, text=True, encoding="utf8", errors="replace",
            timeout=15)
        self.assertEqual(r.returncode, 0, r.stdout+r.stderr)

    def test_dry_run_without_tools_is_read_only_and_explicit(self):
        r = self.invoke(mock=self.missing_all())
        self.assertEqual(r.returncode, 2, r.stdout+r.stderr)
        for phrase in ("GIT_REQUIRED", "PYTHON_REQUIRED", "DOCKER_MISSING",
                       "PLAN_ONLY", "WIN02_NOT_READY"):
            self.assertIn(phrase, r.stdout)

    def test_apply_without_two_factors_of_consent_never_installs(self):
        r = self.invoke(args=["-Apply"], mock=self.missing_all())
        self.assertEqual(r.returncode, 2, r.stdout+r.stderr)
        self.assertIn("EXPLICIT_CONSENT_REQUIRED", r.stdout)
        self.assertNotIn("Installing explicitly authorized", r.stdout)

    def test_multiple_command_candidates_selects_one_executable(self):
        with tempfile.TemporaryDirectory(prefix="asa-win02-multiple-") as td:
            valid = Path(td) / "git.cmd"
            valid.write_text("@echo off\r\necho git version 2.52.0\r\nexit /b 0\r\n", encoding="utf8")
            good = str(valid).replace("'", "''")
            fake_alias = str(Path(td) / "missing-alias.exe").replace("'", "''")
            mock = (
                "function Get-Command {param($Name,$CommandType,$ErrorAction) "
                "if($Name -eq 'git.exe'){"
                "[pscustomobject]@{Source='" + good + "'};"
                "[pscustomobject]@{Source='" + fake_alias + "'};"
                "return }; return $null }; "
            )
            result = self.invoke(mock=mock)
            self.assertEqual(result.returncode, 2, result.stdout+result.stderr)
            self.assertIn("[PASS] Git for Windows is available", result.stdout)
            self.assertIn("PYTHON_REQUIRED", result.stdout)

    def test_python_zero_exit_without_version_proof_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="asa-win02-python-") as td:
            fake = Path(td) / "python.cmd"
            fake.write_text("@echo off\r\nexit /b 0\r\n", encoding="utf8")
            shim = str(fake).replace("'", "''")
            mock = (
                "function Get-Command {param($Name,$CommandType,$ErrorAction) "
                "if($Name -eq 'python.exe'){return [pscustomobject]@{Source='" +
                shim + "'}}; return $null}; "
            )
            result = self.invoke(mock=mock)
            self.assertEqual(result.returncode, 2, result.stdout+result.stderr)
            self.assertIn("PYTHON_REQUIRED", result.stdout)
            self.assertNotIn("Python 3.11+ is available", result.stdout)

    def test_explicit_apply_requires_real_winget(self):
        r = self.invoke(args=["-Apply", "-ConfirmWingetTools"],
                        mock=self.missing_all())
        self.assertEqual(r.returncode, 2, r.stdout+r.stderr)
        self.assertIn("WINGET_REQUIRED", r.stdout)

    def test_untrusted_winget_is_refused_without_invoking_it(self):
        with tempfile.TemporaryDirectory(prefix="asa-win02-winget-") as root:
            folder = Path(root)
            log = folder / "winget.calls.txt"
            winget = folder / "winget.cmd"
            winget.write_text(
                "@echo off\r\n"
                "echo %* >> \"" + str(log) + "\"\r\n"
                "exit /b 0\r\n", encoding="utf8")
            mock = (
                "function Get-Command { param($Name,$CommandType,$ErrorAction) "
                "if($Name -eq 'winget.exe') { "
                "return [pscustomobject]@{Source='" +
                str(winget).replace("'", "''") +
                "'} }; return $null }; "
            )
            r = self.invoke(args=["-Apply", "-ConfirmWingetTools"], mock=mock)
            self.assertEqual(r.returncode, 2, r.stdout+r.stderr)
            self.assertIn("WINGET_UNTRUSTED_PATH", r.stdout)
            self.assertFalse(log.exists(), "An executable from an untrusted PATH was invoked")


if __name__ == "__main__":
    unittest.main()
