"""WIN-03B: synthetic proof that resume touches only fully verified receipts."""
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager
from deployment.contracts import Blocked, REGISTRY, SERVICES


SELECTED = "a" * 40
PREVIOUS = "b" * 40


def release(revision=SELECTED, schema=286):
    return {
        "format": "asa-deployment-v2",
        "repository": "spikeal8-maker/asa-lab",
        "revision": revision, "schema": schema,
        "platform": "linux/amd64", "publicationRunId": 123,
        "images": {
            name: f"{REGISTRY}/{name}@sha256:" + "c" * 64
            for name in SERVICES
        },
    }


class ResumeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="asa-win03b-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / ".asa"
        self.state.mkdir()
        self.backup = self.root / "backups" / "verified-qa-backup"
        self.backup.mkdir(parents=True)
        self.selected = release()
        self.previous = release(PREVIOUS, schema=285)
        self.maintenance = self.state / "maintenance.json"
        self.failure = self.state / "failed-switch.json"
        self.installed = self.state / "installed-release.json"
        self.installed.write_text(json.dumps(self.previous), encoding="utf8")
        self.record = {
            "phase": "verify_entry", "previous": {"revision": PREVIOUS, "schema": 285},
            "selected": self.selected, "backup": str(self.backup),
        }
        self.maintenance.write_text(json.dumps(self.record), encoding="utf8")
        self.failure.write_text(json.dumps(self.record), encoding="utf8")
        self.install = MagicMock()
        self.install.root = self.root
        self.install.state = self.state
        self.install.settings = {}
        self.install.env = {"ASA_UPDATE_ENTRY_ORIGIN": "http://127.0.0.1:28730"}
        self.install.readiness.return_value = {
            "revision": SELECTED, "schema": 286,
        }
        self.install.identity.return_value = {
            name: {"image": ref, "running": True}
            for name, ref in self.selected["images"].items()
        }

    def invoke(self, confirm=True, *, backup_record=None, entry_error=None, backup_callback=None, ci_error=None):
        if backup_record is None:
            backup_record = {"runtime": {
                "revision": PREVIOUS, "schema": 285,
            }}
        stdout, stderr = io.StringIO(), io.StringIO()
        with (patch.object(asa_manager, "Installation", return_value=self.install),
              patch("deployment.repair_resume.verify_backup", return_value=backup_record,
                    side_effect=backup_callback) as backup,
              patch("deployment.repair_resume.assert_ci", side_effect=ci_error) as ci_verification,
              patch("deployment.repair_resume.validate_resolved_images") as compose,
              patch("deployment.repair_resume.verify_embedded_entry_http",
                    side_effect=entry_error) as entry,
              patch("sys.stdout", stdout), patch("sys.stderr", stderr)):
            argv = ["resume", "--root", str(self.root)]
            if confirm:
                argv.append("--confirm-resume")
            code = asa_manager.main(argv)
        self.ci_verification = ci_verification
        self.install.compose.assert_not_called()
        self.install.git.assert_not_called()
        self.install.wait_ready.assert_not_called()
        self.assertFalse(any(name in stdout.getvalue() for name in
                             ("POSTGRES_PASSWORD", "MINIO_ROOT_PASSWORD")))
        return code, stdout.getvalue(), stderr.getvalue(), backup, compose, entry

    def test_explicit_resume_finishes_selected_without_restart_or_restore(self):
        code, stdout, stderr, backup, compose, entry = self.invoke()
        self.assertEqual(code, 0, stderr)
        self.assertIn("RESUMED_VERIFIED", stdout)
        self.assertIn('"databaseRestore": false', stdout)
        self.assertFalse(self.maintenance.exists())
        self.assertFalse(self.failure.exists())
        self.assertEqual(json.loads(self.installed.read_text())["revision"], SELECTED)
        self.assertEqual(len(list(self.state.glob("reviewed-*.json"))), 1)
        self.assertEqual(len(list(self.state.glob("acknowledged-*.json"))), 1)
        self.assertEqual(backup.call_count, 2)
        self.ci_verification.assert_called_once_with(self.selected)
        compose.assert_called_once()
        entry.assert_called_once_with("http://127.0.0.1:28730", SELECTED)
        self.install.receipt.assert_called_once()

    def test_unverified_official_release_prevents_receipt_finalization(self):
        failure = Blocked("CI_BLOCKED", "Release publication not verified", "Review GitHub release and CI")
        previous_receipt = self.installed.read_bytes()
        code, _, stderr, backup, compose, entry = self.invoke(ci_error=failure)
        self.assertEqual(code, 2)
        self.assertIn("CI_BLOCKED", stderr)
        self.assertTrue(self.maintenance.exists())
        self.assertTrue(self.failure.exists())
        self.assertEqual(self.installed.read_bytes(), previous_receipt)
        self.ci_verification.assert_called_once_with(self.selected)
        backup.assert_not_called()
        compose.assert_not_called()
        entry.assert_not_called()

    def test_missing_explicit_consent_is_fail_closed(self):
        before = self.installed.read_bytes()
        code, stdout, stderr, backup, compose, entry = self.invoke(confirm=False)
        self.assertEqual(code, 2)
        self.assertIn("RESUME_CONFIRM_REQUIRED", stderr)
        self.assertEqual(self.installed.read_bytes(), before)
        self.assertTrue(self.maintenance.exists())
        self.assertTrue(self.failure.exists())
        backup.assert_not_called()
        compose.assert_not_called()
        entry.assert_not_called()
        self.install.identity.assert_not_called()
        self.install.receipt.assert_not_called()

    def test_phase_backup_never_replays_database(self):
        self.record["phase"] = "backup"
        self.maintenance.write_text(json.dumps(self.record), encoding="utf8")
        self.failure.write_text(json.dumps(self.record), encoding="utf8")
        code, _, stderr, *_ = self.invoke()
        self.assertEqual(code, 2)
        self.assertIn("RESUME_PHASE", stderr)
        self.assertTrue(self.maintenance.exists())
        self.install.receipt.assert_not_called()

    def test_previous_runtime_prevents_finalizing_selected(self):
        self.install.readiness.return_value = {
            "revision": PREVIOUS, "schema": 285,
        }
        original = self.installed.read_bytes()
        code, _, stderr, *_ = self.invoke()
        self.assertEqual(code, 2)
        self.assertIn("RESUME_RUNTIME", stderr)
        self.assertEqual(self.installed.read_bytes(), original)
        self.assertTrue(self.maintenance.exists())

    def test_missing_or_mismatched_backup_prevents_data_state_change(self):
        self.record.pop("backup")
        self.maintenance.write_text(json.dumps(self.record), encoding="utf8")
        self.failure.write_text(json.dumps(self.record), encoding="utf8")
        code, _, stderr, *_ = self.invoke()
        self.assertEqual(code, 2)
        self.assertIn("RESUME_BACKUP", stderr)
        self.assertTrue(self.maintenance.exists())

    def test_foreign_backup_path_is_blocked_before_reading(self):
        self.record["backup"] = str(self.root.parent / "unrelated-secret-location")
        self.maintenance.write_text(json.dumps(self.record), encoding="utf8")
        self.failure.write_text(json.dumps(self.record), encoding="utf8")
        code, _, stderr, backup, *_ = self.invoke()
        self.assertEqual(code, 2)
        self.assertIn("RESUME_BACKUP_PATH", stderr)
        backup.assert_not_called()
        self.assertTrue(self.maintenance.exists())
        self.assertEqual(json.loads(self.installed.read_text())["revision"], PREVIOUS)

    def test_fresh_claim_with_a_backup_is_not_accepted(self):
        self.record["previous"] = None
        self.maintenance.write_text(json.dumps(self.record), encoding="utf8")
        self.failure.write_text(json.dumps(self.record), encoding="utf8")
        code, _, stderr, backup, *_ = self.invoke()
        self.assertEqual(code, 2)
        self.assertIn("RESUME_BACKUP", stderr)
        backup.assert_not_called()
        self.assertTrue(self.failure.exists())

    def test_backup_replaced_during_hash_verification_cannot_finalize(self):
        def concurrent_replacement(_path):
            moved = self.backup.with_name("old-verified-qa-backup")
            self.backup.rename(moved)
            self.backup.mkdir()
            return {"runtime": {"revision": PREVIOUS, "schema": 285}}

        code, _, stderr, *_ = self.invoke(backup_callback=concurrent_replacement)
        self.assertEqual(code, 2)
        self.assertIn("RESUME_BACKUP_RACE", stderr)
        self.assertTrue(self.maintenance.exists())
        self.assertEqual(json.loads(self.installed.read_text())["revision"], PREVIOUS)

    def test_backup_tampered_after_initial_hash_blocks_before_receipt(self):
        calls = 0
        def concurrent_tampering(_path):
            nonlocal calls
            calls += 1
            if calls == 1:
                return {"runtime": {"revision": PREVIOUS, "schema": 285}}
            raise Blocked("BACKUP_HASH", "Backup changed during validation", "Preserve source")

        original = self.installed.read_bytes()
        code, _, stderr, backup, _, _ = self.invoke(backup_callback=concurrent_tampering)
        self.assertEqual(code, 2)
        self.assertIn("BACKUP_HASH", stderr)
        self.assertEqual(backup.call_count, 2)
        self.assertTrue(self.maintenance.exists())
        self.assertTrue(self.failure.exists())
        self.assertEqual(self.installed.read_bytes(), original)
        self.install.receipt.assert_not_called()

    def test_marker_changed_during_external_http_blocks(self):
        def mutate_state(_entry, _sha):
            altered = dict(self.record)
            altered["phase"] = "backup"
            self.maintenance.write_text(json.dumps(altered), encoding="utf8")

        code, _, stderr, *_ = self.invoke(entry_error=mutate_state)
        self.assertEqual(code, 2)
        self.assertIn("RESUME_MARKER_CHANGED", stderr)
        self.assertTrue(self.failure.exists())
        self.assertEqual(json.loads(self.installed.read_text())["revision"], PREVIOUS)
        self.install.receipt.assert_not_called()

    def test_wrong_backup_runtime_blocks(self):
        code, _, stderr, *_ = self.invoke(backup_record={
            "runtime": {"revision": SELECTED, "schema": 286}
        })
        self.assertEqual(code, 2)
        self.assertIn("RESUME_BACKUP_IDENTITY", stderr)
        self.assertTrue(self.failure.exists())

    def test_unhealthy_http_entry_blocks_without_acknowledgement(self):
        problem = Blocked("EDITOR_ENTRY", "wrong public revision", "Fix entry")
        code, _, stderr, _, _, entry = self.invoke(entry_error=problem)
        self.assertEqual(code, 2)
        self.assertIn("EDITOR_ENTRY", stderr)
        entry.assert_called_once()
        self.assertTrue(self.failure.exists())
        self.assertEqual(json.loads(self.installed.read_text())["revision"], PREVIOUS)

    def test_unpinned_or_unhealthy_images_block(self):
        self.install.identity.return_value["web"]["image"] = "untrusted:latest"
        code, _, stderr, *_ = self.invoke()
        self.assertEqual(code, 2)
        self.assertIn("RESUME_IMAGE", stderr)
        self.assertEqual(json.loads(self.installed.read_text())["revision"], PREVIOUS)

    def test_two_markers_must_have_same_selected_identity(self):
        other = dict(self.record)
        other["selected"] = release("d" * 40)
        self.failure.write_text(json.dumps(other), encoding="utf8")
        code, _, stderr, *_ = self.invoke()
        self.assertEqual(code, 2)
        self.assertIn("RESUME_CONFLICT", stderr)
        self.assertTrue(self.maintenance.exists())
        self.install.identity.assert_not_called()

    def test_stale_receipt_cannot_be_overwritten(self):
        other = release("d" * 40, 284)
        self.installed.write_text(json.dumps(other), encoding="utf8")
        code, _, stderr, *_ = self.invoke()
        self.assertEqual(code, 2)
        self.assertIn("RESUME_RECEIPT", stderr)
        self.assertEqual(json.loads(self.installed.read_text()), other)

    def test_no_state_is_not_a_successful_resume(self):
        self.maintenance.unlink()
        self.failure.unlink()
        code, _, stderr, *_ = self.invoke()
        self.assertEqual(code, 2)
        self.assertIn("RESUME_NOT_PENDING", stderr)

    def test_repeat_after_partial_marker_archive_is_idempotent(self):
        # Simulate successful receipt write followed by a crash while archiving
        # maintenance.json, leaving only the failed-switch marker.
        self.maintenance.unlink()
        self.installed.write_text(json.dumps(self.selected), encoding="utf8")
        code, _, stderr, *_ = self.invoke()
        self.assertEqual(code, 0, stderr)
        self.assertFalse(self.failure.exists())
        self.assertEqual(json.loads(self.installed.read_text())["revision"], SELECTED)


if __name__ == "__main__":
    unittest.main()
