"""Check online MinIO verification when S3 copy changes the ETag."""

import hashlib
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import backup
from deployment.contracts import Blocked


class BackupObjectBytesTests(unittest.TestCase):
    plain = "a" * 32
    multipart = "b" * 32 + "-2"
    source = "source/asa-blocks"
    target = "snapshot/asa-blocks"
    checksum = hashlib.sha256(b"object data").hexdigest()

    def inventory(self, etag, size=11):
        return {"project.sb3": (size, etag, "2026-11-15T12:00:00Z")}

    def verify(self, source_etag, target_etag, target_size=11):
        backup.verify_object_bytes("temporary", self.source, self.target,
                                   self.inventory(source_etag), self.inventory(target_etag, target_size))

    def test_copy_can_change_etag_in_either_direction(self):
        for source_etag, target_etag in ((self.plain, self.multipart), (self.multipart, self.plain)):
            with self.subTest(source_etag=source_etag, target_etag=target_etag):
                with patch.object(backup, "run", return_value=self.checksum + "  -") as run:
                    self.verify(source_etag, target_etag)
                self.assertEqual([call.args[0][-1] for call in run.call_args_list],
                                 [self.source + "/project.sb3", self.target + "/project.sb3"])

    def test_unmodified_plain_etag_needs_no_download(self):
        with patch.object(backup, "run") as run:
            self.verify(self.plain, self.plain)
        run.assert_not_called()

    def test_same_size_corruption_still_blocks_backup(self):
        with patch.object(backup, "run", side_effect=(self.checksum + "  -", "f" * 64 + "  -")):
            with self.assertRaises(Blocked) as failure:
                self.verify(self.plain, self.multipart)
        self.assertEqual(failure.exception.code, "BACKUP_STORAGE_VERIFY")

    def test_size_mismatch_blocks_before_streaming(self):
        with patch.object(backup, "run") as run:
            with self.assertRaises(Blocked) as failure:
                self.verify(self.plain, self.multipart, target_size=12)
        self.assertEqual(failure.exception.code, "BACKUP_STORAGE_VERIFY")
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
