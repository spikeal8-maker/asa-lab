"""Portable ASA command contract: no live Docker, Git, data or host writes."""
from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_cli


class PortableCLIContracts(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.base = Path(tmp.name)
        self.root = self.base / "real-install"
        (self.root / ".asa").mkdir(parents=True)
        self.revision = "a" * 40
        (self.root / ".asa/installed-release.json").write_text(
            json.dumps({"format": "asa-deployment-v2", "revision": self.revision, "schema": 304}),
            encoding="utf-8",
        )
        (self.root / ".asa/installation.json").write_text(
            json.dumps({"project": "asa-lab-campus", "profile": "production"}),
            encoding="utf-8",
        )
        self.entry = {"root": str(self.root), "project": "asa-lab-campus",
                      "profile": "production", "bundle": str(self.base / ("b" * 40))}

    def test_root_identity_is_derived_not_fixed_to_h03(self):
        self.assertEqual(asa_cli.installation_record(self.root)["project"], "asa-lab-campus")
        self.assertEqual(asa_cli.installation_record(self.root)["profile"], "production")
        self.assertEqual(asa_cli.installation_record(self.root)["root"], str(self.root))

    def test_source_without_installed_receipt_is_not_a_live_installation(self):
        (self.root / ".asa/installed-release.json").unlink()
        with self.assertRaises(asa_cli.CLIError):
            asa_cli.installation_record(self.root)

    def test_untrusted_project_or_version_rejected_before_dispatch(self):
        p = self.root / ".asa/installation.json"
        p.write_text(json.dumps({"project": "../foreign", "profile": "production"}))
        with self.assertRaises(asa_cli.CLIError):
            asa_cli.installation_record(self.root)
        p.write_text(json.dumps({"project": "asa-lab-campus", "profile": "production"}))
        (self.root / ".asa/installed-release.json").write_text(json.dumps(
            {"revision": "not-sha", "schema": 304}))
        with self.assertRaises(asa_cli.CLIError):
            asa_cli.installation_record(self.root)

    def test_path_symlink_is_not_adopted(self):
        path = self.base / "linked-install"
        try:
            path.symlink_to(self.root, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("This runner does not permit symlink creation")
        with self.assertRaises(asa_cli.CLIError):
            asa_cli.installation_record(path)

    def test_registry_repeat_keeps_identity_and_changes_only_versioned_bundle(self):
        original = {"format": asa_cli.FORMAT, "installations": [self.entry]}
        alternate = {**self.entry, "bundle": str(self.base / ("c" * 40))}
        result = asa_cli.upsert_registry(original, alternate)
        self.assertEqual(len(result["installations"]), 1)
        self.assertEqual(result["installations"][0]["bundle"], alternate["bundle"])
        self.assertEqual(asa_cli.choose_root(result, None), alternate)
        with self.assertRaises(asa_cli.CLIError):
            asa_cli.upsert_registry(result, {**self.entry, "project": "different-project"})

    def test_multiple_installations_must_be_selected_explicitly(self):
        entry2 = {**self.entry, "root": str(self.base / "second"), "project": "asa-lab-second"}
        doc = {"format": asa_cli.FORMAT, "installations": [self.entry, entry2]}
        with self.assertRaises(asa_cli.CLIError):
            asa_cli.choose_root(doc, None)
        self.assertEqual(asa_cli.choose_root(doc, str(self.root)), self.entry)
        with self.assertRaises(asa_cli.CLIError):
            asa_cli.choose_root(doc, str(self.base / "unknown"))

    def test_status_reads_only_and_reports_real_health(self):
        (self.root / ".asa/last-operation.json").write_text(json.dumps({
            "status": "success", "backup": str(self.root / "backups" / "verified")}))
        fake = SimpleNamespace(returncode=0, stdout="\n".join(
            f"asa-lab-campus-{name}|Up 6 minutes (healthy)" for name in
            ("web", "api", "postgres", "minio", "search", "scratch")), stderr="")
        buf = io.StringIO()
        with patch.object(asa_cli.subprocess, "run", return_value=fake) as run, contextlib.redirect_stdout(buf):
            result = asa_cli.status(self.root, "asa-lab-campus")
        self.assertEqual(result, 0)
        self.assertIn("Контейнеры: 6/6 healthy", buf.getvalue())
        self.assertIn(self.revision[:8], buf.getvalue())
        self.assertEqual(run.call_args.args[0][:2], ["docker", "ps"])

    def test_status_does_not_report_unhealthy_as_ok(self):
        (self.root / ".asa/last-operation.json").write_text('{"status":"success"}')
        fake = SimpleNamespace(returncode=0, stdout="asa-lab-campus-web|Up (unhealthy)\n")
        with patch.object(asa_cli.subprocess, "run", return_value=fake), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(asa_cli.status(self.root, "asa-lab-campus"), 1)

    @unittest.skipUnless(sys.platform.startswith("linux"), "POSIX verified bundle dispatch")
    def test_linux_check_update_share_immutable_setup_and_never_fresh_install(self):
        bundle = Path(self.entry["bundle"])
        bundle.mkdir()
        (bundle / "asa-setup.sh").write_text("#!/bin/bash\n")
        (bundle / "setup-bundle.json").write_text('{"format":"asa-setup-bundle-v1"}')
        (self.root / ".asa/setup.json").write_text("{}")
        captures = []
        with patch.object(asa_cli.os, "geteuid", return_value=0), patch.object(
            asa_cli, "run_reduced", side_effect=lambda args, op: captures.append((args, op)) or 0
        ):
            self.assertEqual(asa_cli.run_linux("check", self.entry), 0)
            self.assertEqual(asa_cli.run_linux("update", self.entry), 0)
        self.assertEqual([call[1] for call in captures], ["check", "update"])
        self.assertEqual([call[0][2] for call in captures], ["check", "auto"])
        self.assertEqual([call[0][-1] for call in captures], [str(self.root)] * 2)
        (self.root / ".asa/setup.json").unlink()
        with patch.object(asa_cli.os, "geteuid", return_value=0), self.assertRaises(asa_cli.CLIError):
            asa_cli.run_linux("update", self.entry)

    def test_manager_failure_is_not_claimed_as_success_or_retried(self):
        process = SimpleNamespace(stdout=io.StringIO(
            "RESOURCE_BUDGET {large}\nBLOCKED COMMAND: SOURCE_CHANGED\n"),
            wait=lambda: 77)
        buf = io.StringIO()
        with patch.object(asa_cli.subprocess, "Popen", return_value=process) as runner, \
                patch.object(asa_cli, "log_directory", return_value=self.base / "logs"), \
                patch.object(asa_cli, "require_secure_log_directory", return_value=None), \
                contextlib.redirect_stdout(buf):
            self.assertEqual(asa_cli.run_reduced(["python", "manager"], "update"), 77)
        self.assertIn("[X] Остановлено", buf.getvalue())
        self.assertIn("BLOCKED COMMAND", buf.getvalue())
        self.assertNotIn("RESOURCE_BUDGET", buf.getvalue())
        self.assertIn("RESOURCE_BUDGET", next((self.base / "logs").glob("*.log")).read_text(encoding="utf-8"))
        self.assertEqual(runner.call_count, 1)

    @unittest.skipUnless(sys.platform.startswith("linux"), "Linux private log boundary")
    def test_runtime_log_directory_rejects_unprivileged_owner(self):
        folder = self.base / "unprivileged-logs"
        folder.mkdir(mode=0o700)
        with self.assertRaises(asa_cli.CLIError):
            asa_cli.require_secure_log_directory(folder)

    def test_registry_corruption_is_not_treated_as_empty_host(self):
        p = self.base / "commands.json"
        p.write_text('{"format":"wrong","installations":[]}')
        with self.assertRaises(asa_cli.CLIError):
            asa_cli.read_registry(p)


class PortableDeliveryIntegrationContracts(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[2]

    def test_signed_linux_bundle_includes_cli(self):
        source = (self.root / "tools/deployment/setup_bundle.py").read_text(encoding="utf-8")
        self.assertIn('"tools/asa_cli.py"', source)
        setup = (self.root / "tools/asa_setup_launcher.py").read_text(encoding="utf-8")
        self.assertIn('"register", "--root", str(root), "--bundle", str(bundle)', setup)
        self.assertIn('successful.get("applicationAccepted") is True', setup)

    def test_windows_bootstrap_and_setup_include_cli(self):
        bootstrap = (self.root / "tools/asa-bootstrap.ps1").read_text(encoding="utf-8")
        self.assertIn("'asa_cli.py'", bootstrap)
        setup = (self.root / "tools/asa-setup.ps1").read_text(encoding="utf-8")
        self.assertIn("asa_cli.py", setup)
        self.assertIn("register --root $TargetRoot", setup)
        self.assertIn('if(-not $Apply)', setup)

    def test_windows_and_linux_ci_include_exact_source_changes(self):
        workflow = (self.root / ".github/workflows/portable-delivery.yml").read_text(encoding="utf-8")
        self.assertIn("'tools/asa_cli.py'", workflow)
        release = (self.root / ".github/workflows/setup-release.yml").read_text(encoding="utf-8")
        self.assertIn("'tools/asa_cli.py'", release)


if __name__ == "__main__":
    unittest.main()
