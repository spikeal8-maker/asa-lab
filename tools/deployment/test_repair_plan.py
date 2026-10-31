"""Isolated, host-independent WIN-03A recovery-plan contracts."""
import io
import json
from pathlib import Path
import sys
import tempfile
from unittest import TestCase
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager


SELECTED = "a" * 40
PREVIOUS = "b" * 40
UNKNOWN = "c" * 40


class RecoveryPlanTests(TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="asa-repair-plan-")
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.state = self.root / ".asa"
        self.state.mkdir()
        self.install = MagicMock()
        self.install.root = self.root
        self.install.state = self.state
        self.install.readiness.return_value = {"revision": SELECTED, "schema": 286}

    def marker(self, name, payload):
        path = self.state / name
        path.write_text(json.dumps(payload, sort_keys=True), encoding="utf8")
        return path

    def run_plan(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with (patch.object(asa_manager, "Installation", return_value=self.install),
              patch("sys.stdout", stdout), patch("sys.stderr", stderr)):
            code = asa_manager.main(["repair-plan", "--root", str(self.root)])
        self.install.compose.assert_not_called()
        self.install.git.assert_not_called()
        self.install.wait_ready.assert_not_called()
        self.install.receipt.assert_not_called()
        self.install.identity.assert_not_called()
        output = stdout.getvalue()
        payload = json.loads(output.split("REPAIR_PLAN ", 1)[1]) if "REPAIR_PLAN " in output else None
        return code, payload, stderr.getvalue()

    @staticmethod
    def switch():
        return {"phase": "switch", "selected": {"revision": SELECTED, "schema": 286},
                "previous": {"revision": PREVIOUS, "schema": 285},
                "backup": "private backup directory must not be printed",
                "privateKey": "NEVER_LOG_SECRET"}

    def test_empty_state_is_no_pending_without_runtime_probe(self):
        code, report, err = self.run_plan()
        self.assertEqual(code, 0, err)
        self.assertEqual(report["status"], "NO_PENDING")
        self.assertIs(report["mutated"], False)
        self.install.readiness.assert_not_called()

    def test_running_selected_is_not_auto_acknowledged(self):
        original = self.marker("maintenance.json", self.switch())
        before = original.read_bytes()
        code, report, err = self.run_plan()
        self.assertEqual(code, 2, err)
        self.assertEqual(report["status"], "SELECTED_RUNNING_VERIFY_REQUIRED")
        self.assertEqual(report["selectedRevision"], SELECTED)
        self.assertEqual(report["runtimeSchema"], 286)
        self.assertTrue(original.exists())
        self.assertEqual(original.read_bytes(), before)
        self.assertNotIn("NEVER_LOG_SECRET", json.dumps(report))
        self.assertNotIn("private backup directory", json.dumps(report))

    def test_running_previous_or_unknown_are_manual(self):
        for running, expected in ((PREVIOUS, "PREVIOUS_RUNNING_MANUAL_REVIEW"),
                                  (UNKNOWN, "UNEXPECTED_RUNTIME_MANUAL_REVIEW")):
            with self.subTest(running=running):
                original = self.marker("maintenance.json", self.switch())
                self.install.readiness.return_value = {"revision": running, "schema": 286}
                code, report, err = self.run_plan()
                self.assertEqual(code, 2, err)
                self.assertEqual(report["status"], expected)
                self.assertEqual(original.read_text(encoding="utf8"),
                                 json.dumps(self.switch(), sort_keys=True))

    def test_backup_requires_manual_recovery_without_readiness(self):
        self.marker("maintenance.json", {
            "phase": "backup", "partial": "backups/incomplete",
            "resumeServices": ["web", "api", "minio"]
        })
        code, report, err = self.run_plan()
        self.assertEqual(code, 2, err)
        self.assertEqual(report["status"], "MANUAL_BACKUP_RECOVERY")
        self.assertTrue(report["partialBackupRecorded"])
        self.install.readiness.assert_not_called()

    def test_markers_conflict_blocks_before_runtime(self):
        self.marker("maintenance.json", self.switch())
        different = self.switch()
        different["selected"] = {"revision": UNKNOWN}
        self.marker("failed-switch.json", different)
        code, report, err = self.run_plan()
        self.assertEqual(code, 2)
        self.assertIsNone(report)
        self.assertIn("REPAIR_CONFLICT", err)
        self.install.readiness.assert_not_called()

    def test_corrupt_and_unknown_marker_block(self):
        bad = self.marker("maintenance.json", {"phase": "unknown"})
        code, report, err = self.run_plan()
        self.assertEqual(code, 2)
        self.assertIsNone(report)
        self.assertIn("REPAIR_MARKER_PHASE", err)
        bad.write_text("not valid JSON", encoding="utf8")
        code, report, err = self.run_plan()
        self.assertEqual(code, 2)
        self.assertIsNone(report)
        self.assertIn("REPAIR_MARKER_JSON", err)

    def test_unavailable_runtime_is_report_only(self):
        from deployment.contracts import Blocked
        self.marker("failed-switch.json", self.switch())
        self.install.readiness.side_effect = Blocked("HEALTH", "unavailable", "Review service health")
        code, report, err = self.run_plan()
        self.assertEqual(code, 2, err)
        self.assertEqual(report["status"], "RUNTIME_UNAVAILABLE")
        self.assertTrue((self.state / "failed-switch.json").exists())

    def test_oversized_record_never_parsed(self):
        file = self.state / "maintenance.json"
        file.write_text("x" * 65537, encoding="utf8")
        code, report, err = self.run_plan()
        self.assertEqual(code, 2)
        self.assertIsNone(report)
        self.assertIn("REPAIR_MARKER_SIZE", err)

    def test_symlink_record_never_followed(self):
        external = self.root / "external-private-state.json"
        external.write_text(json.dumps(self.switch()), encoding="utf8")
        link = self.state / "maintenance.json"
        try:
            link.symlink_to(external)
        except (OSError, NotImplementedError):
            self.skipTest("Host does not allow symlinks without permission changes")
        code, report, err = self.run_plan()
        self.assertEqual(code, 2)
        self.assertIsNone(report)
        self.assertIn("REPAIR_MARKER_PATH", err)
        self.assertTrue(external.is_file())
