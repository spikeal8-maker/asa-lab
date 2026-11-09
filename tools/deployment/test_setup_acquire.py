"""Acquisition ordering and filesystem boundaries; no claim of live Sigstore acceptance."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest import mock

from setup_bundle import REQUIRED, make_archive

SOURCE = Path(__file__).resolve().parents[1] / "asa_setup_acquire.py"
SPEC = importlib.util.spec_from_file_location("asa_setup_acquire", SOURCE)
acquire = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(acquire)
REVISION = "5" * 40


@unittest.skipUnless(os.name == "posix", "Acquisition target requires Unix sudo and protected filesystem modes")
class AcquisitionOrderingTests(unittest.TestCase):
    def simulate(self, *, identity=None, missing_release=False, verification_error=False):
        calls = []
        payload = b"synthetic archive bytes, never executed"
        archive = acquire.BASE / "acquire-abcdefgh" / f"asa-setup-{REVISION}.tar.gz"

        def command(arguments, *, data=None):
            calls.append(arguments)
            if arguments[1:3] == ["release", "download"]:
                if missing_release:
                    raise subprocess.CalledProcessError(1, arguments)
                directory = Path(arguments[arguments.index("--dir") + 1])
                (directory / f"asa-setup-{REVISION}.tar.gz").write_bytes(payload)
                return b""
            if acquire.ROOT_SNAPSHOT in arguments:
                self.assertEqual(data, payload)
                return json.dumps({"archive": str(archive), "sha256": hashlib.sha256(data).hexdigest()}).encode()
            if arguments[1:3] == ["attestation", "verify"]:
                self.assertEqual(arguments[3], str(archive))
                # Simulate the trusted CLI rejecting a different signing identity;
                # this exercises our constraints/order, not Sigstore cryptography.
                for flag, value in (identity or {}).items():
                    if arguments[arguments.index(flag) + 1] != value:
                        raise subprocess.CalledProcessError(1, arguments)
                if verification_error:
                    raise subprocess.CalledProcessError(1, arguments)
                return b"verified"
            if acquire.ROOT_STAGE in arguments:
                self.assertEqual(arguments[-3:], [str(archive), REVISION, hashlib.sha256(payload).hexdigest()])
                return json.dumps({"destination": str(acquire.BASE / REVISION), "revision": REVISION,
                                   "provenanceVerified": True}).encode()
            raise AssertionError("Unexpected command")

        with mock.patch.object(acquire.os, "geteuid", return_value=1000), \
                mock.patch.object(acquire, "trusted_program", side_effect=lambda value: value), \
                mock.patch.object(acquire, "run", side_effect=command):
            try:
                result = acquire.acquire(REVISION)
            except acquire.AcquisitionError as error:
                return calls, error
        return calls, result

    def test_root_snapshot_then_exact_attestation_then_staging_without_install(self):
        calls, result = self.simulate()
        self.assertEqual(len(calls), 4)
        self.assertIn(acquire.ROOT_SNAPSHOT, calls[1])
        self.assertEqual(calls[2][1:3], ["attestation", "verify"])
        self.assertEqual(calls[2][4:], ["--repo", "spikeal8-maker/asa-lab", "--signer-workflow",
                                      "spikeal8-maker/asa-lab/.github/workflows/setup-release.yml",
                                      "--source-ref", "refs/heads/main", "--source-digest", REVISION,
                                      "--deny-self-hosted-runners"])
        self.assertIn(acquire.ROOT_STAGE, calls[3])
        self.assertEqual(result["destination"], str(acquire.BASE / REVISION))
        self.assertFalse(any("bash" in command or "asa-setup.sh" in command for command in calls))

    def test_wrong_repository_workflow_ref_or_digest_stops_before_downloaded_code(self):
        for flag, value in (("--repo", "attacker/asa-lab"),
                            ("--signer-workflow", "spikeal8-maker/asa-lab/.github/workflows/other.yml"),
                            ("--source-ref", "refs/heads/untrusted"),
                            ("--source-digest", "6" * 40)):
            with self.subTest(flag=flag):
                calls, error = self.simulate(identity={flag: value})
                self.assertEqual(str(error), "ACQUIRE_ATTESTATION_REJECTED")
                self.assertEqual(len(calls), 3)
                self.assertFalse(any(acquire.ROOT_STAGE in command for command in calls))

    def test_missing_release_and_failed_verifier_are_fail_closed(self):
        calls, error = self.simulate(missing_release=True)
        self.assertEqual(str(error), "ACQUIRE_PUBLISHED_RELEASE_REQUIRED")
        self.assertEqual(len(calls), 1)
        calls, error = self.simulate(verification_error=True)
        self.assertEqual(str(error), "ACQUIRE_ATTESTATION_REJECTED")
        self.assertFalse(any(acquire.ROOT_STAGE in command for command in calls))

    def test_root_invocation_and_invalid_revision_do_not_request_privilege(self):
        with mock.patch.object(acquire, "run") as run:
            with mock.patch.object(acquire.os, "geteuid", return_value=0):
                with self.assertRaisesRegex(acquire.AcquisitionError, "WITHOUT_SUDO"):
                    acquire.acquire(REVISION)
            with mock.patch.object(acquire.os, "geteuid", return_value=1000):
                for revision in ("main", "5" * 39, "A" * 40, "../" + REVISION):
                    with self.subTest(revision=revision), self.assertRaisesRegex(acquire.AcquisitionError, "REVISION"):
                        acquire.acquire(revision)
            run.assert_not_called()

    def test_download_links_special_files_and_oversize_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plain = root / "archive"
            plain.write_bytes(b"test")
            link = root / "symlink"
            link.symlink_to(plain)
            with self.assertRaisesRegex(acquire.AcquisitionError, "LINK"):
                acquire.read_download(link)
            hardlink = root / "hardlink"
            os.link(plain, hardlink)
            with self.assertRaisesRegex(acquire.AcquisitionError, "FILE"):
                acquire.read_download(plain)
            fifo = root / "fifo"
            os.mkfifo(fifo)
            with self.assertRaisesRegex(acquire.AcquisitionError, "FILE"):
                acquire.read_download(fifo)
            oversized = root / "oversized"
            with oversized.open("wb") as stream:
                stream.truncate(acquire.MAX_BYTES + 1)
            with self.assertRaisesRegex(acquire.AcquisitionError, "SIZE"):
                acquire.read_download(oversized)

    def test_user_writable_program_is_not_a_trusted_verifier(self):
        with tempfile.TemporaryDirectory() as directory:
            program = Path(directory) / "gh"
            program.write_text("#!/bin/sh\nexit 0\n")
            program.chmod(0o777)
            with mock.patch.object(acquire.shutil, "which", return_value=str(program)), \
                    self.assertRaisesRegex(acquire.AcquisitionError, "UNTRUSTED_PROGRAM"):
                acquire.trusted_program("gh")

class PlatformContractTests(unittest.TestCase):
    def test_unsupported_platform_stops_before_uid_or_command_access(self):
        with mock.patch.object(acquire.os, "name", "nt"), mock.patch.object(acquire, "run") as run:
            with self.assertRaisesRegex(acquire.AcquisitionError, "ACQUIRE_PLATFORM"):
                acquire.acquire(REVISION)
            run.assert_not_called()

    def test_exact_attestation_constraints_are_platform_independent(self):
        arguments = acquire.verify_command("gh", "archive.tar.gz", REVISION)
        self.assertEqual(arguments, ["gh", "attestation", "verify", "archive.tar.gz",
                                    "--repo", "spikeal8-maker/asa-lab", "--signer-workflow",
                                    "spikeal8-maker/asa-lab/.github/workflows/setup-release.yml",
                                    "--source-ref", "refs/heads/main", "--source-digest", REVISION,
                                    "--deny-self-hosted-runners"])

    def test_root_failure_reports_only_bounded_diagnostic_codes(self):
        for stderr, expected in ((b'{"code":"BUNDLE_INCOMPLETE"}', "BUNDLE_INCOMPLETE"),
                                 (b'password prompt or path', "ACQUIRE_PROTECTED_STAGE_FAILED"),
                                 (b'{"code":"unexpected secret text"}', "ACQUIRE_PROTECTED_STAGE_FAILED")):
            error = subprocess.CalledProcessError(2, ["sudo"], stderr=stderr)
            with self.subTest(stderr=stderr), mock.patch.object(acquire, "run", side_effect=error):
                with self.assertRaisesRegex(acquire.AcquisitionError, "^" + expected + "$"):
                    acquire.root_step(["sudo"])


@unittest.skipUnless(os.name == "posix", "Models root ownership over real Unix file operations; no host acceptance claim")
class ProtectedSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.namespace = {}
        exec(acquire.ROOT_COMMON, self.namespace)
        self.real_prepare = self.namespace["prepare"]
        self.prepared = []
        self.namespace["prepare"] = self.prepared.append
        self.base = self.root / "setup"
        self.namespace["BASE"] = self.base
        original_lstat = Path.lstat
        original_fstat = os.fstat

        def trusted_metadata(metadata, parent=False):
            values = list(metadata)
            values[4] = 0
            if parent:
                values[0] &= ~0o022
            return os.stat_result(values)

        def observed_lstat(path):
            # Keep real types/modes in the fixture. Only ambient /tmp parents and
            # test-user ownership are mapped to a trusted host for portable CI.
            return trusted_metadata(original_lstat(path), path in self.root.parents)

        self.patches = [mock.patch.object(Path, "lstat", observed_lstat),
                        mock.patch.object(os, "fstat", side_effect=lambda descriptor: trusted_metadata(original_fstat(descriptor))),
                        mock.patch.object(os, "geteuid", return_value=0)]
        for patch in self.patches:
            patch.start()

    def tearDown(self):
        for patch in reversed(self.patches):
            patch.stop()
        for directory, _, _ in os.walk(self.root):
            Path(directory).chmod(0o700)
        self.temporary.cleanup()

    def bundle(self):
        files = {name: ("# synthetic " + name + "\n").encode() for name in REQUIRED}
        files["tools/deployment/setup_bundle.py"] = (SOURCE.parent / "deployment/setup_bundle.py").read_bytes()
        return make_archive(files, REVISION)[0]

    def snapshot(self, data):
        return self.namespace["snapshot"](REVISION, data)

    def stage(self, snapshot):
        return self.namespace["stage"](snapshot["archive"], REVISION, snapshot["sha256"])

    def test_staging_prepares_public_cli_without_an_installed_release(self):
        result = self.stage(self.snapshot(self.bundle()))
        destination = Path(result["destination"])
        self.assertEqual(self.prepared, [destination])
        self.assertFalse((destination / ".asa/installed-release.json").exists())
        proof = json.dumps({"command": "prepare", "status": "OK", "executable": "/usr/local/bin/asa"}).encode()
        with mock.patch.object(self.namespace["subprocess"], "run", return_value=mock.Mock(returncode=0, stdout=proof)) as launch:
            self.real_prepare(destination)
        argv = launch.call_args.args[0]
        self.assertEqual(argv[1:3], ["-I", "-B"])
        self.assertEqual(argv[3:], [str(destination / "tools/asa_cli.py"), "prepare", "--bundle", str(destination), "--json"])
        self.assertNotIn("installed-release", " ".join(argv))
        self.assertEqual(launch.call_args.kwargs["env"]["PATH"], "/usr/sbin:/usr/bin:/sbin:/bin")

    def test_snapshot_is_read_only_before_any_verification(self):
        previous_umask = os.umask(0o077)
        try:
            snapshot = self.snapshot(b"synthetic opaque archive")
        finally:
            os.umask(previous_umask)
        archive = Path(snapshot["archive"])
        self.assertEqual(archive.read_bytes(), b"synthetic opaque archive")
        self.assertEqual(stat.S_IMODE(archive.stat().st_mode), 0o444)
        self.assertEqual(stat.S_IMODE(archive.parent.stat().st_mode), 0o555)
        self.assertEqual(stat.S_IMODE(self.base.stat().st_mode), 0o755)

    def test_unsafe_or_symlink_parent_never_creates_snapshot(self):
        self.base.mkdir(mode=0o777)
        self.base.chmod(0o777)
        with self.assertRaisesRegex(ValueError, "UNSAFE_DIRECTORY"):
            self.snapshot(b"test")
        self.assertEqual(list(self.base.iterdir()), [])
        self.base.rmdir()
        elsewhere = self.root / "elsewhere"
        elsewhere.mkdir()
        self.base.symlink_to(elsewhere)
        with self.assertRaisesRegex(ValueError, "UNSAFE_DIRECTORY"):
            self.snapshot(b"test")
        self.assertEqual(list(elsewhere.iterdir()), [])
        self.base.unlink()

    def test_changed_digest_and_links_never_execute_packaged_code(self):
        snapshot = self.snapshot(self.bundle())
        with mock.patch("builtins.compile", side_effect=AssertionError("Unverified code executed")):
            with self.assertRaisesRegex(ValueError, "SNAPSHOT_CHANGED"):
                self.namespace["stage"](snapshot["archive"], REVISION, "0" * 64)
            archive = Path(snapshot["archive"])
            archive.parent.chmod(0o755)
            os.link(archive, archive.parent / "hardlink")
            with self.assertRaisesRegex(ValueError, "UNSAFE_ARCHIVE"):
                self.stage(snapshot)
        self.assertFalse((self.base / REVISION).exists())

    def test_complete_existing_target_retry_preserves_files_and_changed_target_is_rejected(self):
        snapshot = self.snapshot(self.bundle())
        self.stage(snapshot)
        target = self.base / REVISION / "asa-setup.sh"
        before = target.stat()
        self.stage(snapshot)
        after = target.stat()
        self.assertEqual((before.st_ino, before.st_mtime_ns), (after.st_ino, after.st_mtime_ns))
        target.write_bytes(b"changed bytes must not be overwritten")
        with self.assertRaisesRegex(ValueError, "BUNDLE_EXISTING_MISMATCH"):
            self.stage(snapshot)
        self.assertEqual(target.read_bytes(), b"changed bytes must not be overwritten")

    def test_incomplete_or_symlink_target_is_not_overwritten(self):
        snapshot = self.snapshot(self.bundle())
        target = self.base / REVISION
        target.mkdir()
        sentinel = target / "unrelated"
        sentinel.write_bytes(b"keep")
        with self.assertRaisesRegex(ValueError, "BUNDLE_INCOMPLETE"):
            self.stage(snapshot)
        self.assertEqual(sentinel.read_bytes(), b"keep")
        sentinel.unlink()
        target.rmdir()
        target.symlink_to(self.root)
        with self.assertRaisesRegex(ValueError, "BUNDLE_DESTINATION"):
            self.stage(snapshot)
        target.unlink()


if __name__ == "__main__":
    unittest.main()
