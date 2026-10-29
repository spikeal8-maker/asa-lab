"""Supply-chain and extraction boundary tests for the setup artifact."""

import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock

from setup_bundle import (FORMAT, MANIFEST, OPS_REPOSITORY, OPS_REVISION, REQUIRED,
                          REPOSITORY, WORKFLOW, attest_source, collect_files, inspect_archive,
                          make_archive, plain_bytes, safe_name, stage_archive)


REVISION = "5" * 40


def fixture_files():
    return {path: ("# synthetic test fixture: " + path + "\n").encode() for path in REQUIRED}


def forged_archive(rows):
    memory = io.BytesIO()
    with tarfile.open(fileobj=memory, mode="w:gz", format=tarfile.USTAR_FORMAT) as archive:
        for name, payload, kind in rows:
            member = tarfile.TarInfo(name)
            member.mode = 0o644
            member.type = kind
            if kind == tarfile.SYMTYPE:
                member.linkname = "/etc/passwd"
            else:
                member.size = len(payload)
            archive.addfile(member, io.BytesIO(payload) if member.isfile() else None)
    return memory.getvalue()


class BundleTests(unittest.TestCase):
    def test_deterministic_round_trip_and_exact_revision(self):
        files = fixture_files()
        first, manifest = make_archive(files, REVISION)
        second, _ = make_archive(files, REVISION)
        self.assertEqual(first, second)
        observed, contents = inspect_archive(first, revision=REVISION,
                                             sha256=hashlib.sha256(first).hexdigest())
        self.assertEqual(manifest, observed)
        self.assertEqual(files, contents)
        self.assertEqual(observed["origin"], {"repository": REPOSITORY, "workflow": WORKFLOW})

    def test_wrong_revision_and_digest_rejected(self):
        archive, _ = make_archive(fixture_files(), REVISION)
        for arguments in ({"revision": "6" * 40}, {"sha256": "0" * 64}):
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                inspect_archive(archive, **arguments)

    def test_missing_runtime_entry_rejected(self):
        files = fixture_files()
        del files["tools/asa_setup.py"]
        with self.assertRaisesRegex(ValueError, "BUNDLE_REQUIRED_FILES"):
            make_archive(files, REVISION)

    def test_a_revision_label_cannot_hide_dirty_source_bytes(self):
        with mock.patch("setup_bundle.subprocess.run", return_value=mock.Mock(stdout=b"committed")):
            with self.assertRaisesRegex(ValueError, "BUNDLE_SOURCE_DRIFT"):
                attest_source(Path.cwd(), {"tools/asa_setup.py": b"modified"}, REVISION)

    def test_paths_reject_traversal_absolute_windows_and_ambiguous(self):
        for name in ("../evil.py", "/etc/passwd", "tools//evil.py", "tools/./evil.py",
                     "tools/../evil.py", "C:\\evil.py", "tools/a\nb.py", ""):
            with self.subTest(path=name), self.assertRaises(ValueError):
                safe_name(name)

    def test_archive_rejects_duplicate_members(self):
        archive = forged_archive([("a.py", b"a", tarfile.REGTYPE),
                                  ("a.py", b"b", tarfile.REGTYPE)])
        with self.assertRaisesRegex(ValueError, "BUNDLE_DUPLICATE"):
            inspect_archive(archive)

    def test_archive_rejects_symlink_and_traversal_before_extraction(self):
        for name, kind in (("a.py", tarfile.SYMTYPE), ("../a.py", tarfile.REGTYPE)):
            with self.subTest(name=name), self.assertRaises(ValueError):
                inspect_archive(forged_archive([(name, b"unsafe", kind)]))

    def test_same_size_different_payload_rejected(self):
        files = fixture_files()
        _, manifest = make_archive(files, REVISION)
        name = "tools/asa_setup.py"
        rows = [(path, b"!" * len(data) if path == name else data, tarfile.REGTYPE)
                for path, data in files.items()]
        rows.append((MANIFEST, json.dumps(manifest).encode(), tarfile.REGTYPE))
        with self.assertRaisesRegex(ValueError, "BUNDLE_HASH"):
            inspect_archive(forged_archive(rows))

    def test_unlisted_executable_is_rejected(self):
        files = fixture_files()
        _, manifest = make_archive(files, REVISION)
        rows = [(name, data, tarfile.REGTYPE) for name, data in files.items()]
        rows.extend([(MANIFEST, json.dumps(manifest).encode(), tarfile.REGTYPE),
                     ("tools/deployment/__pycache__/unsafe.pyc", b"bad", tarfile.REGTYPE)])
        with self.assertRaisesRegex(ValueError, "BUNDLE_REQUIRED_FILES"):
            inspect_archive(forged_archive(rows))

    def test_wrong_repository_or_workflow_not_accepted_as_provenance(self):
        files = fixture_files()
        for field, value in (("repository", "other/repository"), ("workflow", "other.yml")):
            _, manifest = make_archive(files, REVISION)
            manifest["origin"][field] = value
            rows = [(name, data, tarfile.REGTYPE) for name, data in files.items()]
            rows.append((MANIFEST, json.dumps(manifest).encode(), tarfile.REGTYPE))
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "BUNDLE_PROVENANCE"):
                inspect_archive(forged_archive(rows))

    def test_hard_link_source_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source"
            path.write_bytes(b"test")
            os.link(path, Path(directory) / "second")
            with self.assertRaisesRegex(ValueError, "BUNDLE_FILE"):
                plain_bytes(path)

    def test_collect_excludes_secrets_and_checks_external_source_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "source"
            ops = Path(directory) / "ops"
            for path, data in fixture_files().items():
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            for name in ("tools/log_collector.py", "tools/owner-admin.py", "tools/platform-admin.mjs"):
                (root / name).write_bytes(b"# synthetic operator\n")
            rows = []
            for source, target in (
                ("scripts/asa_ops/browser_acceptance.py", "tools/deployment/ops/asa_ops/browser_acceptance.py"),
                ("scripts/asa_ops/acceptance_fixture.py", "tools/deployment/ops/asa_ops/acceptance_fixture.py"),
                ("scripts/cloud_storage.py", "tools/deployment/ops/cloud_storage.py"),
            ):
                data = ("# synthetic pinned component " + source).encode()
                path = ops / source
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                rows.append({"path": source, "packagedPath": target,
                             "sha256": hashlib.sha256(data).hexdigest()})
            pin = {"format": "asa-setup-ops-v1", "repository": OPS_REPOSITORY,
                   "revision": OPS_REVISION, "files": rows}
            (root / "tools/deployment/setup_ops_manifest.json").write_text(json.dumps(pin))
            (root / ".env").write_text("SYNTHETIC_SECRET_DO_NOT_PACKAGE=yes")
            files = collect_files(root, ops)
            self.assertNotIn(".env", files)
            self.assertEqual(len([name for name in files if "/ops/" in name]), 3)
            (ops / rows[0]["path"]).write_bytes(b"different component")
            with self.assertRaisesRegex(ValueError, "BUNDLE_OPS_HASH"):
                collect_files(root, ops)

    @unittest.skipUnless(os.name == "posix", "Root-owned Unix bundle staging")
    def test_stage_never_invokes_tar_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "setup.tar.gz"
            data, _ = make_archive(fixture_files(), REVISION)
            archive.write_bytes(data)
            # Temporary test parents have /tmp's sticky world-writable ancestor;
            # isolate only that trust observation, leaving all file operations real.
            original = Path.lstat
            def trusted_parent(path):
                st = original(path)
                if path.is_dir():
                    values = list(st)
                    values[0] = stat_mode(st.st_mode)
                    values[4] = os.geteuid()
                    return os.stat_result(values)
                return st
            with mock.patch.object(Path, "lstat", trusted_parent), \
                    mock.patch.object(tarfile.TarFile, "extractall", side_effect=AssertionError("unsafe extraction")):
                destination = root / REVISION
                previous_umask = os.umask(0o077)
                try:
                    stage_archive(archive, destination, revision=REVISION, sha256=hashlib.sha256(data).hexdigest())
                finally:
                    os.umask(previous_umask)
                self.assertEqual((destination / "tools/asa_setup.py").read_bytes(), fixture_files()["tools/asa_setup.py"])
                self.assertEqual((destination / "tools/asa_setup.py").stat().st_mode & 0o777, 0o644)
                self.assertEqual((destination / "tools").stat().st_mode & 0o777, 0o755)
                stage_archive(archive, destination, revision=REVISION, sha256=hashlib.sha256(data).hexdigest())
                (destination / "tools/asa_setup.py").write_bytes(b"changed")
                with self.assertRaisesRegex(ValueError, "BUNDLE_EXISTING_MISMATCH"):
                    stage_archive(archive, destination, revision=REVISION, sha256=hashlib.sha256(data).hexdigest())


def stat_mode(mode):
    return mode & ~0o022


if __name__ == "__main__":
    unittest.main()
