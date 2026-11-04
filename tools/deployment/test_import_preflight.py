"""WIN-04A complete archive preflight, all data synthetic and disposable."""
import base64
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager
from deployment.contracts import Blocked, REGISTRY, SERVICES, inventory_files
from deployment.import_preflight import validate_import_archive


SHA = "a" * 40


class ImportPreflightTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix="asa-win04a-")
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "complete-archive"
        self.root.mkdir()
        (self.root / "configuration").mkdir()
        (self.root / "objects" / "asa-blocks" / "synthetic").mkdir(parents=True)
        (self.root / "database.dump").write_bytes(b"synthetic postgresql custom format bytes")
        (self.root / "globals.sql").write_text("-- synthetic role list", encoding="utf8")
        (self.root / "objects" / "asa-blocks" / "synthetic" / "xl.meta").write_bytes(b"fake-object-not-a-real-secret")
        self.release = {
            "format": "asa-deployment-v2",
            "repository": "spikeal8-maker/asa-lab",
            "revision": SHA,
            "schema": 286,
            "platform": "linux/amd64",
            "publicationRunId": 12345,
            "images": {
                name: f"{REGISTRY}/{name}@sha256:" + "b" * 64
                for name in SERVICES
            },
        }
        self.recovery = {
            "revision": SHA,
            "files": {
                "compose.yaml": "services:\n  postgres:\n    image: pinned\n",
                "compose.production.yaml": "services:\n  api:\n    environment:\n      ASA_SEED_DEV: false\n",
                ".asa/docker-networks.yaml": "networks:\n  database:\n    driver: bridge\n",
            },
            "installedRelease": self.release,
        }
        self.env = {
            "POSTGRES_DB": "asalab",
            "POSTGRES_USER": "synthetic_administrator",
            "POSTGRES_PASSWORD": "synthetic_postgres_secret",
            "ASA_OBJECT_STORAGE_ENDPOINT": "http://minio:9000",
            "ASA_OBJECT_STORAGE_BUCKET": "asa-blocks",
            "ASA_OBJECT_STORAGE_ACCESS_KEY": "synthetic_minio_id",
            "ASA_OBJECT_STORAGE_SECRET_KEY": "synthetic_minio_key",
            "ASA_SETTINGS_ENCRYPTION_KEY": "synthetic_settings_original_key",
            "CLASSROOM_CODE_SECRET": "synthetic_classroom_code_secret_strict_32bytes",
            "ASA_STUDENT_CODE_PROTECTION_MODE": "compat",
            "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON": json.dumps({"enc1": base64.b64encode(b"E" * 32).decode("ascii")}),
            "ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID": "enc1",
            "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON": json.dumps({"look1": base64.b64encode(b"L" * 32).decode("ascii")}),
            "ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID": "look1",
        }
        self.manifest = {
            "format": "asa-backup-v1", "complete": True,
            "runtime": {"revision": SHA, "schema": 286},
            "project": "asa-lab-synthetic-import",
            "profile": "production",
        }
        self.save()

    def save(self):
        (self.root / "private.env").write_text(
            "\n".join(f"{k}={v}" for k, v in self.env.items()) + "\n", encoding="utf8")
        (self.root / "configuration" / "installed-release.json").write_text(
            json.dumps(self.release), encoding="utf8")
        (self.root / "configuration" / "runtime-configuration.json").write_text(
            json.dumps(self.recovery), encoding="utf8")
        for relative, content in self.recovery["files"].items():
            member = self.root / "configuration" / relative
            member.parent.mkdir(parents=True, exist_ok=True)
            member.write_text(content, encoding="utf8")
        self.manifest["files"] = inventory_files(self.root)
        (self.root / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf8")

    def test_all_components_attested_without_secrets(self):
        response = validate_import_archive(self.root)
        self.assertEqual(response["status"], "ARCHIVE_VERIFIED_NO_IMPORT")
        self.assertEqual(response["sourceRevision"], SHA)
        self.assertEqual(response["bucketFileCount"], 1)
        self.assertEqual(response["composeFileCount"], 3)
        self.assertTrue(response["preservesOriginalKeys"])
        self.assertFalse(response["writesPerformed"])
        self.assertFalse(response["targetProvisioned"])
        self.assertFalse(response["publisherSignatureVerified"])
        rendered = json.dumps(response)
        for secret in self.env.values():
            if "synthetic" in secret:
                self.assertNotIn(secret, rendered)

    def test_cli_does_not_construct_installation_or_call_docker(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with (patch.object(asa_manager, "Installation", side_effect=AssertionError("must not call Docker installation")),
              patch.object(asa_manager, "run", side_effect=AssertionError("unexpected shell mutation")),
              patch("sys.stdout", stdout), patch("sys.stderr", stderr)):
            code = asa_manager.main(["import-preflight", "--backup", str(self.root)])
        self.assertEqual(code, 0, stderr.getvalue())
        self.assertIn("ARCHIVE_VERIFIED_NO_IMPORT", stdout.getvalue())
        self.assertNotIn("synthetic_settings_original_key", stdout.getvalue())

    def test_missing_production_compose_overlay_is_blocked(self):
        self.recovery["files"].pop("compose.production.yaml")
        self.save()
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertEqual(caught.exception.code, "IMPORT_CONFIGURATION")

    def test_compose_bytes_mismatch_even_if_inventory_hashes_are_rebased(self):
        profile_file = self.root / "configuration" / "compose.production.yaml"
        profile_file.write_text("services:\n  api:\n    image: foreign\n", encoding="utf8")
        # Forge a matching hash inventory: recovered JSON must still match the
        # actual Compose file used by a later importer, not only its SHA listing.
        self.manifest["files"] = inventory_files(self.root)
        (self.root / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf8")
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertEqual(caught.exception.code, "IMPORT_CONFIGURATION")

    def test_legacy_windows_crlf_archive_is_accepted_when_hashes_match(self):
        profile_file = self.root / "configuration" / "compose.production.yaml"
        expected = self.recovery["files"]["compose.production.yaml"]
        profile_file.write_bytes(expected.replace("\n", "\r\n").encode("utf8"))
        self.manifest["files"] = inventory_files(self.root)
        (self.root / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf8")
        self.assertEqual(validate_import_archive(self.root)["status"],
                         "ARCHIVE_VERIFIED_NO_IMPORT")

    def test_portable_lf_compose_archive_is_accepted(self):
        for relative, content in self.recovery["files"].items():
            (self.root / "configuration" / relative).write_bytes(content.encode("utf8"))
        self.manifest["files"] = inventory_files(self.root)
        (self.root / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf8")
        self.assertEqual(validate_import_archive(self.root)["status"],
                         "ARCHIVE_VERIFIED_NO_IMPORT")

    def test_mixed_line_endings_rejected_even_if_hash_inventory_rebased(self):
        profile_file = self.root / "configuration" / "compose.production.yaml"
        expected = self.recovery["files"]["compose.production.yaml"]
        self.assertGreater(expected.count("\n"), 1)
        profile_file.write_bytes(expected.replace("\n", "\r\n", 1).encode("utf8"))
        # Text-mode newline normalization would conceal this mixed encoding.
        self.assertEqual(profile_file.read_text(encoding="utf8"), expected)
        self.manifest["files"] = inventory_files(self.root)
        (self.root / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf8")
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertEqual(caught.exception.code, "IMPORT_CONFIGURATION")

    def test_manifest_parent_traversal_is_blocked_before_archive_read(self):
        self.manifest["files"]["../outside-archive-secret.txt"] = {
            "bytes": 1,
            "sha256": "0" * 64,
        }
        (self.root / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf8")
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertEqual(caught.exception.code, "BACKUP_PATH")

    def test_missing_original_secret_blocks(self):
        self.env.pop("ASA_SETTINGS_ENCRYPTION_KEY")
        self.save()
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertEqual(caught.exception.code, "IMPORT_PRIVATE_KEYS")

    def test_missing_student_keyring_or_active_key_blocks(self):
        self.env["ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID"] = "unavailable"
        self.save()
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertEqual(caught.exception.code, "IMPORT_STUDENT_KEYS")

    def test_student_keys_reject_wrong_length_and_shared_material(self):
        self.env["ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON"] = json.dumps({
            "enc1": base64.b64encode(b"E" * 8).decode("ascii")
        })
        self.save()
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertEqual(caught.exception.code, "IMPORT_STUDENT_KEYS")

        shared = base64.b64encode(b"same-material-across-both-keyrings!"[:32]).decode("ascii")
        self.env["ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON"] = json.dumps({"enc1": shared})
        self.env["ASA_STUDENT_CODE_LOOKUP_KEYS_JSON"] = json.dumps({"look1": shared})
        self.save()
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertEqual(caught.exception.code, "IMPORT_STUDENT_KEYS")

    def test_noncanonical_base64_padding_bits_are_rejected(self):
        canonical = base64.b64encode(b"E" * 32).decode("ascii")
        alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        self.assertEqual(canonical[-1], "=")
        bit_variant = alphabet[alphabet.index(canonical[-2]) + 1]
        noncanonical = canonical[:-2] + bit_variant + "="
        self.assertEqual(base64.b64decode(noncanonical), b"E" * 32)
        self.env["ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON"] = json.dumps({
            "enc1": noncanonical
        })
        self.save()
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertEqual(caught.exception.code, "IMPORT_STUDENT_KEYS")

    def test_student_key_id_syntax_matches_runtime_contract(self):
        self.env["ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON"] = json.dumps({
            "../unsafe-id": base64.b64encode(b"E" * 32).decode("ascii")
        })
        self.env["ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID"] = "../unsafe-id"
        self.save()
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertEqual(caught.exception.code, "IMPORT_STUDENT_KEYS")

    def test_production_cannot_import_off_mode(self):
        self.env["ASA_STUDENT_CODE_PROTECTION_MODE"] = "off"
        self.save()
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertEqual(caught.exception.code, "IMPORT_STUDENT_KEYS")

    def test_different_config_release_cannot_be_accepted(self):
        self.recovery["revision"] = "c" * 40
        self.save()
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertEqual(caught.exception.code, "IMPORT_RELEASE_IDENTITY")

    def test_modified_object_hash_is_blocked(self):
        (self.root / "objects" / "asa-blocks" / "synthetic" / "xl.meta").write_bytes(b"tampered")
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertEqual(caught.exception.code, "BACKUP_HASH")

    def test_unknown_source_profile_or_project_is_not_trusted(self):
        self.manifest["profile"] = "silently-off"
        self.save()
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertEqual(caught.exception.code, "IMPORT_PROFILE")
        self.manifest["profile"] = "production"
        self.manifest["project"] = "asa-lab-../../foreign"
        self.save()
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertEqual(caught.exception.code, "IMPORT_PROJECT")

    def test_missing_minio_bucket_blocks(self):
        item = self.root / "objects" / "asa-blocks" / "synthetic" / "xl.meta"
        item.unlink()
        self.save()
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root)
        self.assertIn(caught.exception.code, {"IMPORT_OBJECTS_MISSING", "IMPORT_BUCKET_MISSING"})

    def test_partial_backup_is_refused(self):
        self.root.rename(self.root.with_name(self.root.name + ".incomplete"))
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(self.root.with_name(self.root.name + ".incomplete"))
        self.assertEqual(caught.exception.code, "IMPORT_SOURCE")

    def test_malicious_symlink_root_is_refused(self):
        alias = self.root.with_name("archive-symlink")
        try:
            alias.symlink_to(self.root, target_is_directory=True)
        except (NotImplementedError, OSError):
            self.skipTest("Windows symlink privileges unavailable; host settings unchanged.")
        with self.assertRaises(Blocked) as caught:
            validate_import_archive(alias)
        self.assertEqual(caught.exception.code, "IMPORT_SOURCE")


if __name__ == "__main__":
    unittest.main()
