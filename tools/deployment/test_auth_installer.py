"""Synthetic-file regression tests for AUTH-C5 installer preflight.

No Docker, network, database or installation environment is accessed. The native
bootstrap function is executed from the shipped script in a temporary directory;
lifecycle commands and installation discovery are deliberately outside this unit.
"""
import base64
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
KEY = "ASA_SETTINGS_ENCRYPTION_KEY"
HEX_KEY = "0123456789aBcDeF" * 4
URL_KEY = base64.urlsafe_b64encode(bytes(range(32))).decode().rstrip("=")
MIGRATION = (
    "# Synthetic fixture, never an installation environment.\n"
    "MIGRATION_DATABASE_URL=postgres://fixture:fixture@postgres:5432/fixture\n"
    "MIGRATION_EXPECT_DATABASE=fixture\n"
    "MIGRATION_CONFIRM=APPLY:fixture\n"
)
COMPLETE = (
    MIGRATION
    + "ASA_BLOCKS_RUNTIME_SIGNING_KEY=" + "a" * 64 + "\n"
    + "ASA_OBJECT_STORAGE_ENDPOINT=http://minio:9000\n"
    + "ASA_OBJECT_STORAGE_REGION=us-east-1\n"
    + "ASA_OBJECT_STORAGE_BUCKET=fixture\n"
    + "ASA_OBJECT_STORAGE_ACCESS_KEY=fixture\n"
    + "ASA_OBJECT_STORAGE_SECRET_KEY=fixture\n"
    + "ASA_OBJECT_STORAGE_FORCE_PATH_STYLE=true\n"
    + "ASA_SEED_DEV=false\n"
)


def valid_entries():
    return (
        ("hex", f"{KEY}={HEX_KEY}\n", HEX_KEY),
        ("base64url", f"{KEY}={URL_KEY}\n", URL_KEY),
        ("quoted", f"  {KEY} = '{HEX_KEY}' # retained comment\n", HEX_KEY),
        ("export", f'export {KEY}="{URL_KEY}"\r\n', URL_KEY),
    )


def invalid_entries():
    return (
        ("missing", "", "missing"),
        ("empty", f"{KEY}=\n", "invalid"),
        ("placeholder", f"{KEY}=CHANGE_ME_32_BYTE_BASE64URL_KEY\n", "invalid"),
        ("unclosed quote", f'{KEY}="{HEX_KEY}\n', "invalid"),
        ("mismatched quote", f'{KEY}="{HEX_KEY}\'\n', "invalid"),
        ("short", f"{KEY}={URL_KEY[:-1]}\n", "invalid"),
        ("unassigned", f"{KEY}\n", "invalid"),
        ("duplicate", f"{KEY}={HEX_KEY}\n{KEY}={URL_KEY}\n", "duplicated"),
        ("duplicate invalid", f"{KEY}=invalid\nexport {KEY}={HEX_KEY}\n", "duplicated"),
        ("empty followed by valid", f"{KEY}=\n{KEY}={HEX_KEY}\n", "duplicated"),
    )


class NativeBootstrapTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # CI runs this suite on both Ubuntu and Windows. A missing native shell
        # is an infrastructure failure, not a silently skipped implementation.
        if os.name == "nt":
            cls.shell = shutil.which("pwsh") or shutil.which("powershell")
            if not cls.shell:
                raise RuntimeError("PowerShell is required for the Windows installer fixture.")
            source = (ROOT / "tools/asa-lab.ps1").read_text(encoding="utf-8")
            begin = source.index("function New-RandomHex {")
            end = source.index("function Get-EnvironmentValue {", begin)
            cls.harness = (
                "Set-StrictMode -Version Latest\n"
                "$ErrorActionPreference = 'Stop'\n"
                "$Profile = 'test'\n"
                "$EnvPath = Join-Path (Get-Location) '.env'\n"
                + source[begin:end]
                + "\nNew-PrivateEnvironment\n"
            )
            cls.suffix = ".ps1"
        else:
            cls.shell = shutil.which("sh")
            if not cls.shell:
                raise RuntimeError("A POSIX shell is required for the installer fixture.")
            source = (ROOT / "tools/asa-lab.sh").read_text(encoding="utf-8")
            begin = source.index("random_hex() {")
            end = source.index("\nenvironment_value() {", begin)
            cls.harness = "#!/bin/sh\nset -eu\nprofile=test\n" + source[begin:end] + "\ncreate_environment\n"
            cls.suffix = ".sh"

    def run_bootstrap(self, directory):
        command = [self.shell]
        if os.name == "nt":
            # Execute the trusted, extracted function in this child process.
            # A temporary .ps1 file may be blocked by the host's file execution
            # policy; no host/global ExecutionPolicy is changed by this command.
            child_script = (
                "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n"
                "$OutputEncoding = [Console]::OutputEncoding\n"
                + self.harness
            )
            encoded = base64.b64encode(child_script.encode("utf-16le")).decode("ascii")
            command += ["-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-EncodedCommand", encoded]
        else:
            script = directory / ("bootstrap-fixture" + self.suffix)
            script.write_text(self.harness, encoding="utf-8", newline="\n")
            command += [str(script)]
        return subprocess.run(
            command, cwd=directory, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=15, check=False,
        )

    def test_existing_valid_keys_are_preserved_byte_for_byte(self):
        for label, entry, key in valid_entries():
            with self.subTest(label=label), tempfile.TemporaryDirectory(prefix="asa-auth-installer-") as tmp:
                directory = Path(tmp)
                env = directory / ".env"
                before = (COMPLETE + entry).encode()
                env.write_bytes(before)
                result = self.run_bootstrap(directory)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(env.read_bytes(), before)
                self.assertNotIn(key, result.stdout + result.stderr)

    def test_existing_bad_or_missing_key_fails_before_any_other_env_update(self):
        # Blocks signing/storage entries are deliberately absent: they must not
        # be appended before the settings-key failure.
        for label, entry, reason in invalid_entries():
            with self.subTest(label=label), tempfile.TemporaryDirectory(prefix="asa-auth-installer-") as tmp:
                directory = Path(tmp)
                env = directory / ".env"
                before = (MIGRATION + entry).encode()
                env.write_bytes(before)
                result = self.run_bootstrap(directory)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(env.read_bytes(), before)
                output = result.stdout + result.stderr
                self.assertIn(reason, output)
                self.assertIn("Restore the original key", output)
                self.assertNotIn(HEX_KEY, output)
                self.assertNotIn(URL_KEY, output)

    def test_empty_existing_file_is_not_a_new_configuration(self):
        with tempfile.TemporaryDirectory(prefix="asa-auth-installer-") as tmp:
            directory = Path(tmp)
            env = directory / ".env"
            env.write_bytes(b"")
            result = self.run_bootstrap(directory)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(env.read_bytes(), b"")
            self.assertIn("Restore the original key", result.stdout + result.stderr)

    def test_other_placeholder_requires_correction_while_preserving_the_key(self):
        with tempfile.TemporaryDirectory(prefix="asa-auth-installer-") as tmp:
            directory = Path(tmp)
            env = directory / ".env"
            before = (MIGRATION + f"{KEY}={HEX_KEY}\nPOSTGRES_PASSWORD=CHANGE_ME\n").encode()
            env.write_bytes(before)
            result = self.run_bootstrap(directory)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(env.read_bytes(), before)
            output = result.stdout + result.stderr
            self.assertIn("correct them in the saved configuration", output)
            self.assertIn(f"preserve the existing {KEY}", output)
            self.assertIn("Do not delete .env or generate a replacement key", output)
            self.assertNotIn("remove .env and rerun", output)
            self.assertNotIn(HEX_KEY, output)

    def test_new_configuration_generates_once_then_preserves_key(self):
        with tempfile.TemporaryDirectory(prefix="asa-auth-installer-") as tmp:
            directory = Path(tmp)
            env = directory / ".env"
            first = self.run_bootstrap(directory)
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            before = env.read_bytes()
            keys = re.findall(rb"^ASA_SETTINGS_ENCRYPTION_KEY=([a-f0-9]{64})\r?$", before, re.M)
            self.assertEqual(len(keys), 1)
            self.assertNotIn(keys[0].decode(), first.stdout + first.stderr)
            second = self.run_bootstrap(directory)
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            self.assertEqual(env.read_bytes(), before)
            self.assertNotIn(keys[0].decode(), second.stdout + second.stderr)


class ProvisionKeyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node = shutil.which("node")
        if not cls.node:
            raise RuntimeError("Node is required to execute the settings-key provision CLI.")

    def provision(self, target, new_store=False):
        command = [self.node, str(ROOT / "tools/provision-settings-key.mjs"), "--env-file", str(target)]
        if new_store:
            command.append("--new-store")
        return subprocess.run(command, capture_output=True, text=True, timeout=10, check=False)

    def test_existing_valid_keys_are_preserved_even_with_new_store_flag(self):
        for label, entry, key in valid_entries():
            with self.subTest(label=label), tempfile.TemporaryDirectory(prefix="asa-auth-provision-") as tmp:
                target = Path(tmp) / ".env.local"
                before = (MIGRATION + entry).encode()
                target.write_bytes(before)
                for flag in (False, True):
                    result = self.provision(target, flag)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertEqual(target.read_bytes(), before)
                    self.assertNotIn(key, result.stdout + result.stderr)

    def test_invalid_and_duplicate_keys_cannot_be_replaced_by_new_store_flag(self):
        for label, entry, reason in invalid_entries()[1:]:
            with self.subTest(label=label), tempfile.TemporaryDirectory(prefix="asa-auth-provision-") as tmp:
                target = Path(tmp) / ".env.local"
                before = (MIGRATION + entry).encode()
                target.write_bytes(before)
                result = self.provision(target, True)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(target.read_bytes(), before)
                output = result.stdout + result.stderr
                self.assertIn(reason, output)
                self.assertIn("Restore the original key", output)
                self.assertNotIn(HEX_KEY, output)
                self.assertNotIn(URL_KEY, output)

    def test_missing_key_requires_explicit_new_store_attestation(self):
        for before in (b"", MIGRATION.encode()):
            with self.subTest(empty=not before), tempfile.TemporaryDirectory(prefix="asa-auth-provision-") as tmp:
                target = Path(tmp) / ".env.local"
                target.write_bytes(before)
                refused = self.provision(target)
                self.assertNotEqual(refused.returncode, 0)
                self.assertEqual(target.read_bytes(), before)
                self.assertIn("--new-store", refused.stderr)
                created = self.provision(target, True)
                self.assertEqual(created.returncode, 0, created.stdout + created.stderr)
                generated = target.read_bytes()
                self.assertTrue(generated.startswith(before))
                keys = re.findall(rb"^ASA_SETTINGS_ENCRYPTION_KEY=([A-Za-z0-9_-]{43})\r?$", generated, re.M)
                self.assertEqual(len(keys), 1)
                self.assertEqual(len(base64.urlsafe_b64decode(keys[0] + b"=")), 32)
                self.assertNotIn(keys[0].decode(), created.stdout + created.stderr)
                repeated = self.provision(target, True)
                self.assertEqual(repeated.returncode, 0, repeated.stdout + repeated.stderr)
                self.assertEqual(target.read_bytes(), generated)

    def test_copying_template_does_not_create_a_placeholder_key(self):
        with tempfile.TemporaryDirectory(prefix="asa-auth-provision-") as tmp:
            target = Path(tmp) / ".env.local"
            template = (ROOT / ".env.example").read_bytes()
            self.assertIsNone(re.search(rb"^[ \t]*ASA_SETTINGS_ENCRYPTION_KEY[ \t]*=", template, re.M))
            self.assertIn(b"--new-store", template)
            target.write_bytes(template)
            refused = self.provision(target)
            self.assertNotEqual(refused.returncode, 0)
            self.assertEqual(target.read_bytes(), template)
            created = self.provision(target, True)
            self.assertEqual(created.returncode, 0, created.stdout + created.stderr)
            self.assertEqual(target.read_bytes().count(b"\nASA_SETTINGS_ENCRYPTION_KEY="), 1)


class StagingOriginContractTest(unittest.TestCase):
    def test_staging_forwards_saved_origin_without_a_domain_default(self):
        source = (ROOT / "compose.staging.yaml").read_text(encoding="utf-8")
        api_environment = source.split("\n  api:\n", 1)[1].split("\n  web:\n", 1)[0]
        self.assertIn("      NODE_ENV: production\n", api_environment)
        self.assertRegex(api_environment, r"(?m)^      ASA_PUBLIC_WEB_ORIGINS: \$\{ASA_PUBLIC_WEB_ORIGINS:-\}$")
        # Blank public config must not add a discovered LAN host or another
        # installation's domain to the API's existing origin/CSRF allowlist.
        self.assertNotIn("https://", api_environment)
        self.assertNotIn("*", api_environment)


if __name__ == "__main__":
    unittest.main()
