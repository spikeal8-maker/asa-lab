"""Pure source/temporary-file tests; never touches Docker or an installation."""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.contracts import Blocked, LEGACY_SERVICES, REGISTRY, SERVICES, read_env, validate_release
from deployment.search_secret import InvalidSearchSecret, ensure_secret, inspect_secret

ROOT = Path(__file__).resolve().parents[2]


def candidate(version=2):
    services = LEGACY_SERVICES if version == 1 else SERVICES
    return {"format": f"asa-deployment-v{version}", "repository": "spikeal8-maker/asa-lab",
            "revision": "a" * 40, "schema": 253, "platform": "linux/amd64", "publicationRunId": 1,
            "images": {name: f"{REGISTRY}/{name}@sha256:" + "b" * 64 for name in services}}


class SearchComponentTests(unittest.TestCase):
    def test_manifest_versions_preserve_legacy_and_require_new_component(self):
        self.assertEqual(validate_release(candidate(1)), candidate(1))
        self.assertEqual(validate_release(candidate(2)), candidate(2))
        for version, changed in ((1, candidate(2)), (2, candidate(1))):
            changed["format"] = f"asa-deployment-v{version}"
            with self.assertRaises(Blocked):
                validate_release(changed)
        changed = candidate(2)
        changed["images"]["search"] = "searxng/searxng:latest"
        with self.assertRaises(Blocked):
            validate_release(changed)

    def test_component_has_closed_free_engines_and_no_query_log_or_plugins(self):
        settings = json.loads((ROOT / "infra/search/settings.json").read_text())
        names = ["bing", "duckduckgo", "wikipedia", "bing images", "duckduckgo images"]
        self.assertEqual(settings["use_default_settings"]["engines"]["keep_only"], names)
        self.assertEqual([x["name"] for x in settings["engines"]], names)
        self.assertEqual(settings["search"]["safe_search"], 2)
        self.assertEqual(settings["search"]["formats"], ["json"])
        self.assertEqual(settings["search"]["default_lang"], "ru-RU")
        self.assertEqual(settings["search"]["autocomplete"], "")
        self.assertFalse(settings["server"]["image_proxy"])
        self.assertFalse(settings["server"]["public_instance"])
        self.assertTrue(all(not p["active"] for p in settings["plugins"].values()))
        self.assertLessEqual(settings["outgoing"]["max_request_timeout"], 8)
        self.assertNotIn("secret_key", settings["server"])
        dockerfile = (ROOT / "infra/search/Dockerfile").read_text()
        self.assertRegex(dockerfile, r"FROM .*:2026\.10\.25-54ca1d9cf@sha256:[a-f0-9]{64}")
        self.assertIn('org.opencontainers.image.revision="${ASA_BUILD_REVISION}"', dockerfile)
        self.assertIn("GRANIAN_ACCESS_LOG=false", dockerfile)

    def test_private_secret_created_once_preserves_bytes_and_check_is_read_only(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            original = b"# synthetic fixture\r\nEXISTING=preserve\r\n"
            path.write_bytes(original)
            self.assertEqual(inspect_secret(path), ("missing", original))
            result = subprocess.run([sys.executable, str(ROOT / "tools/deployment/search_secret.py"),
                                     "--file", str(path)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0)
            self.assertIn("MISSING", result.stdout)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(list(Path(directory).iterdir()), [path])
            self.assertTrue(ensure_secret(path))
            saved = path.read_bytes()
            self.assertTrue(saved.startswith(original))
            self.assertRegex(saved, rb"ASA_SEARCH_SECRET=[a-f0-9]{64}\r\n$")
            self.assertFalse(ensure_secret(path))
            self.assertEqual(path.read_bytes(), saved)
            self.assertEqual(inspect_secret(path)[0], "valid")
            if os.name != "nt":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_existing_quoted_and_unquoted_keys_are_never_rewritten(self):
        synthetic_key = b"Ab" * 32
        for quote, ending in (
            (b"", b"\n"),
            (b"'", b"\r\n"),
            (b'"', b"\n"),
        ):
            with self.subTest(quote=quote), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / ".env"
                original = b"# synthetic, not a real key" + ending
                original += b"ASA_SEARCH_SECRET=" + quote + synthetic_key + quote + ending
                original += b"AFTER_KEY=unchanged" + ending
                path.write_bytes(original)
                before = path.stat()
                self.assertEqual(inspect_secret(path), ("valid", original))
                self.assertEqual(read_env(path)["ASA_SEARCH_SECRET"], synthetic_key.decode())
                self.assertFalse(ensure_secret(path))
                self.assertFalse(ensure_secret(path))
                after = path.stat()
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual((after.st_mtime_ns, after.st_ino, after.st_mode),
                                 (before.st_mtime_ns, before.st_ino, before.st_mode))
                self.assertEqual(list(Path(directory).iterdir()), [path])
                result = subprocess.run([sys.executable, str(ROOT / "tools/deployment/search_secret.py"),
                                         "--create", "--file", str(path)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout.strip(), "SEARCH_SECRET_PRESERVED")
                self.assertNotIn(synthetic_key.decode(), result.stdout + result.stderr)
                self.assertEqual(path.read_bytes(), original)

    def test_invalid_or_duplicate_key_never_rotated(self):
        key = b"Ab" * 32
        for raw in (
            b"ASA_SEARCH_SECRET=\n",
            b"ASA_SEARCH_SECRET=bad\n",
            b"ASA_SEARCH_SECRET=" + b"a" * 64 + b"\nASA_SEARCH_SECRET=" + b"b" * 64 + b"\n",
            b"ASA_SEARCH_SECRET='" + key + b"\n",
            b"ASA_SEARCH_SECRET=\"" + key + b"'\n",
            b"ASA_SEARCH_SECRET='" + key + b"' # comment\n",
            b"ASA_SEARCH_SECRET='" + key + b" '\n",
            b"ASA_SEARCH_SECRET='" + key[:-1] + b"'\n",
            b"ASA_SEARCH_SECRET='" + key + b"0'\n",
            b"ASA_SEARCH_SECRET = '" + key + b"'\n",
            b"export ASA_SEARCH_SECRET='" + key + b"'\n",
            b" ASA_SEARCH_SECRET='" + key + b"'\n",
            b"ASA_SEARCH_SECRET=$(printf dangerous)\n",
            b"ASA_SEARCH_SECRET=$" + b"{INJECTED}\n",
            b"ASA_SEARCH_SECRET=" + key + b"\rOTHER=1\n",
            b"ASA_SEARCH_SECRET=" + key + b"\xe2\x80\xa8OTHER=1\n",
            b"ASA_SEARCH_SECRET=\"" + key[:32] + b"\n" + key[32:] + b"\"\n",
            b"ASA_SEARCH_SECRET=" + key + b"\nexport ASA_SEARCH_SECRET='" + key + b"'\n",
        ):
            with self.subTest(raw=raw), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / ".env"
                path.write_bytes(raw)
                with self.assertRaises(InvalidSearchSecret):
                    ensure_secret(path)
                self.assertEqual(path.read_bytes(), raw)
                self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_manager_exposes_only_stable_search_secret_error_code(self):
        manager_source = (ROOT / "tools/asa_manager.py").read_text()
        self.assertIn('"SEARCH_SECRET_INVALID" if isinstance(exc, InvalidSearchSecret)', manager_source)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_bytes(b"ASA_SEARCH_SECRET='synthetic-not-a-key'\n")
            with self.assertRaises(InvalidSearchSecret) as raised:
                inspect_secret(path)
            self.assertNotIn("synthetic-not-a-key", str(raised.exception))

    def test_manager_emits_search_secret_invalid_without_exposing_value(self):
        import contextlib
        import io
        from unittest.mock import patch
        import asa_manager

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            invalid = "unique-secret-value-must-not-leak"
            path.write_text("ASA_SEARCH_SECRET='" + invalid + "'\n")
            stderr = io.StringIO()
            with patch.object(asa_manager, "Installation", return_value=type("MockInstall", (), {"root": Path(directory)})()), \
                 patch.object(asa_manager, "operation_lock", return_value=contextlib.nullcontext()), \
                 patch.object(asa_manager, "update", side_effect=lambda *a, **k: inspect_secret(path)), \
                 contextlib.redirect_stderr(stderr):
                code = asa_manager.main(["update", "--root", directory, "--profile", "staging"])
            self.assertEqual(code, 2)
            self.assertIn("BLOCKED SEARCH_SECRET_INVALID:", stderr.getvalue())
            self.assertNotIn(invalid, stderr.getvalue())

    def test_manager_continues_after_backup_with_existing_quoted_key(self):
        import contextlib
        from unittest.mock import patch
        import asa_manager

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".asa").mkdir()
            key = "Ab" * 32
            path = root / ".env"
            original = ("# untouched config\r\nASA_SEARCH_SECRET='" + key +
                        "'\r\nASA_UPDATE_ENTRY_ORIGIN=http://127.0.0.1:4610\r\n").encode()
            path.write_bytes(original)
            release = {"revision": "b" * 40, "schema": 256, "images": {"search": "synthetic-image"}}
            previous = {"revision": "a" * 40, "schema": 255}
            stages = []

            class FakeInstallation:
                def __init__(self):
                    self.root = root
                    self.state = root / ".asa"
                    self.profile = "staging"
                    self.settings = {}
                    self.env = read_env(path)
                    self.process_env = {}
                    self.recorded_receipt = None

                def git(self, *args):
                    return ""

                def readiness(self):
                    return previous

                def compose(self, *args, **kwargs):
                    stages.append(tuple(args))
                    return ""

                def identity(self, **kwargs):
                    return {}

                def wait_ready(self, *args):
                    stages.append(("ready",))

                def receipt(self, value):
                    self.recorded_receipt = value
                    stages.append(("receipt",))

            install = FakeInstallation()
            def make_backup(*args, **kwargs):
                stages.append(("backup",))
                return root / "backups" / "synthetic"

            stubs = {
                "doctor": lambda *a, **k: None,
                "clean_checkout": lambda *a, **k: None,
                "backup_directory": lambda *a, **k: root / "backups",
                "attest_editor_env": lambda *a, **k: None,
                "discover_release": lambda *a, **k: release,
                "assert_ci": lambda *a, **k: None,
                "fetch_images": lambda *a, **k: None,
                "selected_source": lambda *a, **k: None,
                "prepare_collector": lambda *a, **k: {"readerGroupChanged": False},
                "apply_release_environment": lambda *a, **k: None,
                "validate_resolved_images": lambda *a, **k: None,
                "check_resources": lambda *a, **k: None,
                "prepare_support_images": lambda *a, **k: None,
                "export_backup": make_backup,
                "verify_embedded_entry_http": lambda *a, **k: None,
                "save_settings": lambda *a, **k: None,
                "reconcile_collector": lambda *a, **k: None,
                "Installation": lambda *a, **k: install,
            }
            with contextlib.ExitStack() as stack:
                for name, replacement in stubs.items():
                    stack.enter_context(patch.object(asa_manager, name, replacement))
                asa_manager.update(install)

            self.assertIn(("backup",), stages)
            self.assertIn(("up", "-d", "--no-build"), stages)
            self.assertIn(("receipt",), stages)
            self.assertLess(stages.index(("backup",)), stages.index(("up", "-d", "--no-build")))
            self.assertEqual(install.recorded_receipt["status"], "success")
            self.assertEqual(install.env["ASA_SEARCH_SECRET"], key)
            self.assertEqual(install.process_env["ASA_SEARCH_SECRET"], key)
            self.assertEqual(path.read_bytes(), original)
            self.assertFalse((root / ".asa" / "maintenance.json").exists())

    def test_runtime_template_never_gets_default_or_shared_key(self):
        spec = importlib.util.spec_from_file_location("asa_search_start", ROOT / "infra/search/start.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        template = (ROOT / "infra/search/settings.json").read_text()
        for value in (None, "", "test", "a" * 63):
            with self.assertRaises(ValueError):
                module.configuration(template, value)
        configured = module.configuration(template, "a" * 64)
        self.assertEqual(configured["server"]["secret_key"], "a" * 64)
        self.assertNotIn("secret_key", json.loads(template)["server"])
        source = (ROOT / "infra/search/start.py").read_text()
        self.assertNotIn("ASA_SETTINGS_ENCRYPTION_KEY", source)
        self.assertNotIn("CLASSROOM_CODE_SECRET", source)

    def test_source_updaters_provision_only_after_verified_backup(self):
        for path, backup, create, switch in (
            ("tools/docker-update.sh", 'backup_database "$backup_path"',
             'python3 tools/deployment/search_secret.py --create', 'compose up -d --no-build'),
            ("tools/docker-update.ps1", 'New-DatabaseBackup $backupPath',
             "Invoke-Native python @('tools/deployment/search_secret.py', '--create')",
             "Invoke-Compose -Arguments @('up', '-d', '--no-build')"),
        ):
            with self.subTest(path=path):
                source = (ROOT / path).read_text()
                self.assertLess(source.index(backup), source.index(create))
                self.assertLess(source.index(create), source.index(switch))
                # The preflight invocation does not carry --create.
                self.assertIn('search_secret.py', source[:source.index(backup)])

    def test_private_search_has_no_volume_or_public_port(self):
        compose = (ROOT / "compose.yaml").read_text()
        section = compose.split("  search:\n", 1)[1].split("\n  web:", 1)[0]
        self.assertNotIn("\n    ports:", section)
        self.assertNotIn("\n    volumes:", section)
        self.assertNotIn("database", section)
        self.assertIn("ASA_SEARCH_SECRET: ${ASA_SEARCH_SECRET:-}", section)
        self.assertIn("read_only: true", section)


if __name__ == "__main__":
    unittest.main()
