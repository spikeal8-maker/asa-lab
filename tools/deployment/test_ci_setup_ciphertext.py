"""Publish only a verified synthetic ciphertext; never its private AGE key."""

import copy
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.ci_setup_smoke import preserve_synthetic_ciphertext
from deployment.contracts import Blocked


class SyntheticCiphertextTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary.name) / "workspace"
        self.root = Path(self.temporary.name) / "private-synthetic-install"
        self.workspace.mkdir()
        self.snapshot = "20261104T000000Z-abcdef12"
        self.source = self.root / "backups/encrypted" / ("asa-lab-" + self.snapshot + ".tar.age")
        self.source.parent.mkdir(parents=True)
        # Byte-copy boundary fixture; real AGE encryption/restore runs in CI.
        self.payload = b"age-encryption.org/v1\nsynthetic-encrypted-fixture-bytes"
        self.source.write_bytes(self.payload)
        (self.root / "synthetic-age-identity.txt").write_text("SYNTHETIC_PRIVATE_IDENTITY_MUST_STAY_PRIVATE")
        (self.root / "database.dump").write_bytes(b"synthetic plaintext dump must stay private")
        self.receipt = {"snapshotId": self.snapshot, "local": {"status": "OK"},
                        "encryption": {"status": "OK", "path": str(self.source), "bytes": len(self.payload),
                                       "sha256": hashlib.sha256(self.payload).hexdigest()}}
        self.evidence = {"status": "PASS", "cleanup": {"status": "PASS"}, "snapshotId": self.snapshot,
                         "syntheticProject": "asa-setup-ci-abcdef123456"}

    def tearDown(self):
        self.temporary.cleanup()

    def test_pass_exports_exact_ciphertext_only_with_public_byte_proof(self):
        proof = preserve_synthetic_ciphertext(self.root, self.receipt, self.evidence, self.workspace)
        target = self.workspace / proof["path"]
        self.assertEqual(target.read_bytes(), self.payload)
        self.assertEqual(proof["sha256"], hashlib.sha256(target.read_bytes()).hexdigest())
        self.assertEqual(proof["bytes"], len(self.payload))
        self.assertTrue(proof["synthetic"])
        self.assertFalse(proof["privateIdentityIncluded"])
        self.assertEqual([path for path in self.workspace.rglob("*") if path.is_file()], [target])
        self.assertTrue(target.name.startswith("synthetic-"))
        self.assertTrue(target.name.endswith(".age"))
        if os.name != "nt":
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_failed_acceptance_or_cleanup_never_exports_an_artifact(self):
        for field in ("status", "cleanup"):
            with self.subTest(field=field):
                evidence = copy.deepcopy(self.evidence)
                if field == "status":
                    evidence["status"] = "FAIL"
                else:
                    evidence["cleanup"]["status"] = "FAILED"
                with self.assertRaises(Blocked) as caught:
                    preserve_synthetic_ciphertext(self.root, self.receipt, evidence, self.workspace)
                self.assertEqual(caught.exception.code, "CI_CIPHERTEXT_STATUS")
                self.assertFalse(any(self.workspace.rglob("*.age")))

    def test_tampered_ciphertext_leaves_no_exportable_file(self):
        self.source.write_bytes(self.payload[:-1] + b"X")
        with self.assertRaises(Blocked) as caught:
            preserve_synthetic_ciphertext(self.root, self.receipt, self.evidence, self.workspace)
        self.assertEqual(caught.exception.code, "CI_CIPHERTEXT_HASH")
        self.assertFalse(any(self.workspace.rglob("*.age")))
        self.assertFalse(any(self.workspace.rglob("*.tmp")))

    def test_private_identity_cannot_be_selected_as_the_export_source(self):
        self.receipt["encryption"]["path"] = str(self.root / "synthetic-age-identity.txt")
        with self.assertRaises(Blocked) as caught:
            preserve_synthetic_ciphertext(self.root, self.receipt, self.evidence, self.workspace)
        self.assertEqual(caught.exception.code, "CI_CIPHERTEXT_PATH")
        self.assertFalse(any(self.workspace.rglob("*.age")))

    def test_plaintext_with_a_matching_hash_is_still_not_an_age_artifact(self):
        plaintext = b"synthetic plaintext renamed as an encrypted archive"
        self.source.write_bytes(plaintext)
        self.receipt["encryption"].update(bytes=len(plaintext), sha256=hashlib.sha256(plaintext).hexdigest())
        with self.assertRaises(Blocked) as caught:
            preserve_synthetic_ciphertext(self.root, self.receipt, self.evidence, self.workspace)
        self.assertEqual(caught.exception.code, "CI_CIPHERTEXT_ENVELOPE")
        self.assertFalse(any(self.workspace.rglob("*.age")))

    def test_existing_artifact_is_never_overwritten(self):
        directory = self.workspace / "test-results/setup-synthetic"
        directory.mkdir(parents=True, mode=0o700)
        target = directory / ("synthetic-" + self.source.name)
        target.write_bytes(b"preserved prior artifact")
        with self.assertRaises(Blocked) as caught:
            preserve_synthetic_ciphertext(self.root, self.receipt, self.evidence, self.workspace)
        self.assertEqual(caught.exception.code, "CI_ARTIFACT_EXISTS")
        self.assertEqual(target.read_bytes(), b"preserved prior artifact")


if __name__ == "__main__":
    unittest.main()
