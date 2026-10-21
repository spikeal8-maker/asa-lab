#!/usr/bin/env python3
"""Real Windows MAX_PATH regression: public synthetic backup paths only."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("asa_age_prepare", HERE / "prepare-age-backup.py")
age = importlib.util.module_from_spec(spec)
spec.loader.exec_module(age)


@unittest.skipUnless(sys.platform == "win32", "Windows extended-length path contract")
class WindowsLongPathContract(unittest.TestCase):
    def test_nested_object_longer_than_260_characters_can_be_written_and_cleaned(self):
        with tempfile.TemporaryDirectory() as outer:
            root = Path(outer) / "asa-private-restore-root"
            root.mkdir()
            target = None
            try:
                long_name = "a" * 120 + ".wav"
                member = tarfile.TarInfo(
                    "snapshot/objects/asa-blocks/tenants/" + "b" * 36 +
                    "/blocks/assets/fe/" + long_name + "/" + "c" * 36
                )
                member.size = 4
                target = age.safe_destination(root, member)
                self.assertGreater(len(str(root / Path(*member.name.split("/")[1:]))), 260)
                self.assertTrue(str(target).startswith("\\\\?\\"))
                target.parent.mkdir(parents=True, exist_ok=True)
                descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write(b"test")
                self.assertEqual(target.read_bytes(), b"test")
            finally:
                # Never leave synthetic temp files even on a failed assertion.
                shutil.rmtree(age.host_path(root))
            self.assertFalse(root.exists())

    def test_root_directory_stays_inside_selected_restore_path(self):
        with tempfile.TemporaryDirectory() as outer:
            root = Path(outer) / "restore"
            root.mkdir()
            directory = tarfile.TarInfo("snapshot/")
            directory.type = tarfile.DIRTYPE
            resolved = age.safe_destination(root, directory)
            self.assertEqual(resolved, age.host_path(root.resolve()))
            nested = tarfile.TarInfo("snapshot/manifest.json")
            self.assertEqual(age.safe_destination(root, nested).name, "manifest.json")


if __name__ == "__main__":
    unittest.main(verbosity=2)
