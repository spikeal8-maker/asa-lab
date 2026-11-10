"""Real file traversal with Docker/PG fakes; no installed stack or registry writes."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import backup
from deployment.contracts import (Blocked, _extended_windows_path, backup_path,
                                  inventory_files, safe_member, verify_backup)


class BackupLongPathTests(unittest.TestCase):
    def test_windows_drive_unc_and_existing_extended_prefixes(self):
        cases = [
            ("C:/backups/child/../archive", "\\\\?\\C:\\backups\\archive"),
            ("\\\\server\\share\\backups", "\\\\?\\UNC\\server\\share\\backups"),
            ("\\\\?\\C:\\backups", "\\\\?\\C:\\backups"),
            ("\\\\?\\UNC\\server\\share\\backups", "\\\\?\\UNC\\server\\share\\backups"),
        ]
        for supplied, expected in cases:
            with self.subTest(supplied=supplied):
                self.assertEqual(_extended_windows_path(supplied), expected)
                self.assertEqual(_extended_windows_path(expected), expected)

    def test_short_root_also_uses_extended_paths_on_windows(self):
        with tempfile.TemporaryDirectory() as directory:
            selected = backup_path(directory)
            self.assertEqual(selected, backup_path(selected))
            if os.name == "nt":
                self.assertTrue(str(selected).startswith("\\\\?\\"))
            else:
                self.assertEqual(selected, Path(directory).resolve())

    def test_export_plain_long_root_and_verify_long_objects(self):
        # Windows runners execute this against NTFS; Linux covers the same
        # export/verification path without changing its path representation.
        directory = tempfile.mkdtemp(prefix="asa-backup-long-")
        try:
            root = Path(directory) / "installation"
            state = root / ".asa"
            state.mkdir(parents=True)
            (root / ".env").write_text("POSTGRES_DB=fixture\n", encoding="utf-8")
            destination = Path(directory) / ("backup-" + "a" * 110) / ("b" * 110) / ("c" * 45)
            self.assertGreater(len(str(destination)), 260)
            member = "objects/asa-blocks/ai/private/v1/owners/" + "d" * 36 + "/generated/" + "e" * 64 + "/part.1"
            payload = b"saved-object\x00\xff" * 100
            runtime = {"revision": "a" * 40, "schema": 304}
            records = {name: {"id": name, "image": "image-" + name, "running": True}
                       for name in ("postgres", "minio", "api", "web")}
            commands = []
            streamed_dumps = []

            def compose(*args, **kwargs):
                commands.append(args)
                if args == ("config", "--format", "json"):
                    return json.dumps({"services": {name: {} for name in records}})
                if "output" in kwargs:
                    kwargs["output"].write(b"PGDMP-fixture")
                if "input_file" in kwargs:
                    streamed_dumps.append(kwargs["input_file"].read())
                return ""

            def docker(args, **kwargs):
                if args[:2] == ["docker", "cp"]:
                    objects = Path(args[-1])
                    if os.name == "nt":
                        self.assertTrue(str(objects).startswith("\\\\?\\"))
                    target = objects.parent / member
                    target.parent.mkdir(parents=True)
                    target.write_bytes(payload)
                return "sha256:" + "f" * 64

            install = SimpleNamespace(root=root, state=state, settings={}, files=[],
                env={"ASA_OBJECT_STORAGE_ENDPOINT": "http://minio:9000",
                     "POSTGRES_DB": "fixture", "POSTGRES_USER": "fixture_admin"},
                project="asa-lab-backup-fixture", profile="production",
                identity=lambda: records, readiness=lambda: runtime, compose=compose,
                wait_ready=lambda *args: None)
            with patch.object(backup, "run", docker), patch.object(backup, "privileges", return_value=[]):
                completed = backup._export_backup(install, str(destination))

            # Simulate a later CLI invocation with an ordinary unprefixed path.
            plain = str(completed)
            if os.name == "nt":
                self.assertTrue(plain.startswith("\\\\?\\"))
                plain = plain[4:]
            manifest = verify_backup(plain)
            self.assertEqual(manifest["files"][member], {
                "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()})
            self.assertEqual(inventory_files(plain), manifest["files"])
            self.assertTrue(all("\\" not in name and not name.startswith("/")
                                for name in manifest["files"]))
            self.assertIn(("stop", "web", "api", "minio"), commands)
            self.assertIn(("start", "web", "api", "minio"), commands)
            self.assertFalse((state / "maintenance.json").exists())
            target = completed / member
            self.assertEqual(safe_member(completed, member), target)
            with patch.object(backup, "privileges", return_value=[]), \
                    patch.object(backup, "plan_restore_toc", return_value="fixture TOC"):
                backup.restore_check(install, plain, "asa_path_restore_test")
            self.assertEqual(streamed_dumps, [b"PGDMP-fixture", b"PGDMP-fixture"])
            unexpected = target.with_name("unexpected")
            unexpected.write_bytes(b"extra")
            with self.assertRaises(Blocked) as failure:
                verify_backup(plain)
            self.assertEqual(failure.exception.code, "BACKUP_HASH")
            unexpected.unlink()
            target.write_bytes(b"x" * len(payload))
            with self.assertRaises(Blocked) as failure:
                verify_backup(plain)
            self.assertEqual(failure.exception.code, "BACKUP_HASH")
            target.unlink()
            with self.assertRaises(Blocked) as failure:
                verify_backup(plain)
            self.assertEqual(failure.exception.code, "BACKUP_HASH")
            for escape in ("../outside", "objects/../../outside", "objects\\outside"):
                with self.subTest(escape=escape), self.assertRaises(Blocked) as failure:
                    safe_member(completed, escape)
                self.assertEqual(failure.exception.code, "BACKUP_PATH")
        finally:
            # The owned temporary fixture can itself contain >MAX_PATH children.
            shutil.rmtree(backup_path(directory))


if __name__ == "__main__":
    unittest.main()
