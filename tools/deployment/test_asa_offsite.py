"""Unit/negative tests for the explicit, fail-closed encrypted Yandex backup sender."""
from pathlib import Path
import importlib.util
import json
import sys
import tempfile
import unittest
from unittest import mock
from types import SimpleNamespace

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

    def test_remote_auth_or_network_failure_blocks_before_upload(self):
        with mock.patch.object(asa_offsite.subprocess, "run",
                               return_value=SimpleNamespace(returncode=5, stdout="")) as command:
            with self.assertRaisesRegex(ValueError, "доступ"):
                asa_offsite.assert_remote_file_absent(["rclone"], "yandex:ASA-Backups",
                                                      "existing.tar.age")
            self.assertEqual(command.call_count, 1)
            self.assertEqual(command.call_args.args[0][1:3], ["lsjson", "yandex:ASA-Backups"])

    def test_remote_existing_archive_blocks_overwrite(self):
        with mock.patch.object(asa_offsite.subprocess, "run",
                               return_value=SimpleNamespace(returncode=0,
                                                              stdout='[{"Name":"existing.tar.age"}]')):
            with self.assertRaisesRegex(ValueError, "уже существует"):
                asa_offsite.assert_remote_file_absent(["rclone"], "yandex:ASA-Backups",
                                                      "existing.tar.age")

    def test_remote_listing_malformed_blocks_upload(self):
        for payload in ("not-json", "{}", '[{"unexpected":"missing Name"}]'):
            with self.subTest(payload=payload):
                with mock.patch.object(asa_offsite.subprocess, "run",
                                       return_value=SimpleNamespace(returncode=0, stdout=payload)):
                    with self.assertRaises(ValueError):
                        asa_offsite.assert_remote_file_absent(["rclone"], "yandex:ASA-Backups",
                                                              "new.tar.age")

    def test_remote_listing_excludes_new_archive(self):
        with mock.patch.object(asa_offsite.subprocess, "run",
                               return_value=SimpleNamespace(returncode=0,
                                                              stdout='[{"Name":"another.tar.age"}]')):
            asa_offsite.assert_remote_file_absent(["rclone"], "yandex:ASA-Backups",
                                                  "new.tar.age")

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
