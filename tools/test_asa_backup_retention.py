"""Offline fail-closed tests for local ASA Lab backup retention.

No Docker, GitHub, MinIO or live data are accessed. Run:
    python3 -m unittest tools.test_asa_backup_retention -v
"""
from __future__ import annotations

import fcntl
import json
from pathlib import Path
from types import SimpleNamespace
import os
import tempfile
import unittest
from unittest.mock import patch

from tools.asa_backup_retention import (
    Blocked, apply_prune, enumerate_plan, main, no_update_in_progress,
    refresh_lock, root_state, stat_tree,
)


LIVE_SHA = "a" * 40
STAMP_OLD = "20261024T231505Z-a6ecd41d"
STAMP_MID = "20261025T231505Z-15a27bd0"
STAMP_NEW = "20261026T190000Z-abcdefgh".replace("gh", "ab")
ORIGIN = "https://test.asa-lab.ru"


class BackupRetentionFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "asa-lab"
        self.root.mkdir()
        (self.root / "compose.yaml").write_text("services: {}\n")
        (self.root / "compose.production.yaml").write_text("services: {}\n")
        (self.root / ".env").write_text(
            "ASA_UPDATE_ENTRY_ORIGIN='" + ORIGIN + "'\n"
            "COMPOSE_PROJECT_NAME='asa-lab-dev'\n"
            "ASA_BUILD_REVISION='" + LIVE_SHA + "'\n"
            "ASA_EXPECTED_SCHEMA_VERSION='260'\n",
            encoding="utf-8",
        )
        (self.root / ".asa" / "test-refresh").mkdir(parents=True)
        (self.root / ".asa" / "test-refresh" / "lock").write_text("")
        (self.root / ".asa" / "installation.json").write_text(json.dumps({
            "profile": "production",
            "project": "asa-lab-dev",
            "backupDirectory": str(self.root / "backups"),
        }))
        self.backups = self.root / "backups"
        self.backups.mkdir(mode=0o700)
        os.chmod(self.backups, 0o700)

    def snapshot(self, name, revision=LIVE_SHA, schema=260, project="asa-lab-dev"):
        path = self.backups / name
        path.mkdir()
        (path / "database.dump").write_bytes(b"test dump bytes")
        (path / "private.env").write_text("fake=do-not-use\n")
        (path / "manifest.json").write_text(json.dumps({
            "format": "asa-backup-v1",
            "complete": True,
            "createdAt": name,
            "project": project,
            "profile": "production",
            "runtime": {"revision": revision, "schema": schema},
            "files": {"database.dump": {"sha256": "placeholder"}},
        }))
        return path

    def plan(self, retain=None):
        b, project, profile = root_state(self.root, ORIGIN)
        return enumerate_plan(self.root, b, project, profile, retain)

    def test_plan_proposes_removing_only_older_verified_same_installation(self):
        self.snapshot(STAMP_OLD)
        self.snapshot(STAMP_MID)
        self.snapshot(STAMP_NEW)
        (self.backups / "yandex-inspect-20261026").mkdir()
        (self.backups / "20261026T192345Z-deadbeef.incomplete").mkdir()
        result = self.plan()
        self.assertEqual(result["retain"], STAMP_NEW)
        self.assertEqual([x["name"] for x in result["candidates"]], [STAMP_OLD, STAMP_MID])
        self.assertIn("yandex-inspect-20261026", result["ignored"])
        self.assertGreater(result["estimated_reclaim_bytes"], 0)
        self.assertEqual(len(result["plan_sha256"]), 64)
        self.assertTrue((self.backups / STAMP_OLD).is_dir())

    def test_foreign_and_unknown_directories_are_not_selected(self):
        self.snapshot(STAMP_OLD, project="foreign-project")
        self.snapshot(STAMP_NEW)
        p = self.plan()
        self.assertEqual(p["candidates"], [])
        self.assertIn(STAMP_OLD, p["ignored"])

    def test_cannot_retain_an_old_snapshot_while_newer_one_exists(self):
        self.snapshot(STAMP_OLD)
        self.snapshot(STAMP_NEW)
        with self.assertRaisesRegex(Blocked, "newer"):
            self.plan(STAMP_OLD)

    def test_stale_snapshot_cannot_justify_deletion(self):
        self.snapshot(STAMP_OLD)
        self.snapshot(STAMP_NEW, revision="b" * 40)
        with self.assertRaisesRegex(Blocked, "current|installed"):
            self.plan()

    def test_no_plan_if_only_incomplete_snapshot(self):
        (self.backups / (STAMP_OLD + ".incomplete")).mkdir()
        with self.assertRaisesRegex(Blocked, "No complete"):
            self.plan()

    def test_symlink_is_ignored_if_unrecognized_but_refused_inside_backup(self):
        self.snapshot(STAMP_OLD)
        protected = self.snapshot(STAMP_NEW)
        (self.backups / "unrelated-backup").symlink_to(protected, target_is_directory=True)
        self.assertIn("unrelated-backup", self.plan()["ignored"])
        (protected / "linked_secret").symlink_to("/etc/passwd")
        with self.assertRaisesRegex(Blocked, "Symlink"):
            self.plan()

    def test_active_writer_lock_blocks_prune(self):
        self.snapshot(STAMP_NEW)
        lock_path = self.root / ".asa" / "test-refresh" / "lock"
        with lock_path.open("rb") as writer:
            fcntl.flock(writer.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(Blocked, "updater owns"):
                with refresh_lock(self.root):
                    pass
        with refresh_lock(self.root) as locked:
            self.assertTrue(locked)

    def test_unfinished_refresh_receipt_blocks_prune(self):
        self.snapshot(STAMP_NEW)
        folder = self.root / ".asa" / "test-refresh" / "running-job"
        folder.mkdir()
        (folder / "status.json").write_text(json.dumps({"phase": "switching"}))
        with self.assertRaisesRegex(Blocked, "Unfinished refresh"):
            no_update_in_progress(self.root)

    def test_unrecognized_origin_is_blocked(self):
        self.snapshot(STAMP_NEW)
        with self.assertRaisesRegex(Blocked, "test origin"):
            root_state(self.root, "https://asa-lab.ru")

    def test_prune_needs_exact_plan_digest_and_confirmation(self):
        self.snapshot(STAMP_OLD)
        self.snapshot(STAMP_NEW)
        plan = self.plan()
        options = SimpleNamespace(root=self.root, retain=STAMP_NEW,
                                  plan_sha256="b" * 64, ack_prune=True)
        with patch("tools.asa_backup_retention.os.geteuid", return_value=0), \
             patch("tools.asa_backup_retention.verify_backup", return_value={"complete": True}):
            with self.assertRaisesRegex(Blocked, "Plan changed"):
                apply_prune(options, plan, self.backups, True)
            options.plan_sha256 = plan["plan_sha256"]
            options.ack_prune = False
            with self.assertRaisesRegex(Blocked, "Explicit"):
                apply_prune(options, plan, self.backups, True)
        self.assertTrue((self.backups / STAMP_OLD).exists())

    def test_prune_keeps_verified_snapshot_and_records_audit(self):
        self.snapshot(STAMP_OLD)
        self.snapshot(STAMP_NEW)
        plan = self.plan()
        options = SimpleNamespace(root=self.root, retain=STAMP_NEW,
                                  plan_sha256=plan["plan_sha256"], ack_prune=True)
        with patch("tools.asa_backup_retention.os.geteuid", return_value=0), \
             patch("tools.asa_backup_retention.verify_backup", return_value={"complete": True}):
            with refresh_lock(self.root) as held:
                result = apply_prune(options, plan, self.backups, held)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["deleted"], [STAMP_OLD])
        self.assertTrue((self.backups / STAMP_NEW).exists())
        self.assertFalse((self.backups / STAMP_OLD).exists())
        self.assertEqual(json.loads(Path(result["audit_receipt"]).read_text())["status"], "complete")

    def test_actual_cli_plan_is_read_only(self):
        self.snapshot(STAMP_OLD)
        self.snapshot(STAMP_NEW)
        with patch("builtins.print") as print_call:
            result = main(["plan", "--root", str(self.root), "--origin", ORIGIN])
        self.assertEqual(result, 0)
        self.assertTrue((self.backups / STAMP_OLD).exists())
        self.assertGreater(print_call.call_count, 0)


if __name__ == "__main__":
    unittest.main()
