"""Unit/negative tests for the explicit, fail-closed encrypted Yandex backup sender."""
from pathlib import Path
import importlib.util
import json
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import asa_offsite


class OffsiteBackupPreflightTests(unittest.TestCase):
    def test_unsafe_remote_paths_rejected(self):
        for value in ("https://example.org/backup", "yandex:ASA-Backups/../keys",
                      "yandex:ASA-Backups//school", "yandex:/school", "yandex:"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                asa_offsite.remote_base(value)

    def test_normal_remote_accepted(self):
        self.assertEqual(asa_offsite.remote_base("yandex:ASA-Backups/asa-school-01"),
                         "yandex:ASA-Backups/asa-school-01")

    def test_missing_public_recipient_blocks_before_any_transfer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".asa").mkdir()
            backup = root / "backups" / "20261108T214015Z-404d8510"
            backup.mkdir(parents=True)
            missing = root / "missing-recipients"
            with mock.patch.object(asa_offsite, "rclone_prefix") as rclone:
                with self.assertRaises(ValueError):
                    asa_offsite.send(root, backup, missing, "yandex:ASA-Backups/school", None, None)
                rclone.assert_not_called()

    def test_rejects_backup_not_matching_current_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".asa").mkdir()
            (root / ".asa" / "installed-release.json").write_text(
                json.dumps({"revision": "a" * 40, "schema": 307}), encoding="utf-8"
            )
            (root / ".asa" / "installation.json").write_text(
                json.dumps({"project": "asa-lab-school", "profile": "production"}), encoding="utf-8"
            )
            backup = root / "backups" / "20261108T214015Z-404d8510"
            backup.mkdir(parents=True)
            recipient = root / "recipient.pub"
            recipient.write_text("age1" + "q" * 58 + "\n", encoding="utf-8")
            with mock.patch.object(asa_offsite, "verify_backup", return_value={
                "runtime": {"revision": "a" * 40, "schema": 300},
                "profile": "production", "createdAt": "20261108T214015Z-404d8510",
            }):
                with self.assertRaisesRegex(ValueError, "не соответствует"):
                    asa_offsite.verify_current_backup(root, backup, recipient)

    def test_rejects_password_or_private_key_as_recipient(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".asa").mkdir()
            backup = root / "backups" / "valid"
            backup.mkdir(parents=True)
            recipient = root / "secret"
            recipient.write_text("AGE-SECRET-KEY-1ABCDE\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "публичные"):
                asa_offsite.verify_current_backup(root, backup, recipient)


if __name__ == "__main__":
    unittest.main()
