"""WIN-04B2A: deterministic, read-only original-secret relocation tests."""
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager
from deployment.contracts import Blocked
from deployment.import_env_projection import (
    ORIGIN_KEYS, PRESERVED_KEYS, PRIVATE_FIELDS, TRANSPORT_KEYS,
    project_private_environment,
)


SOURCE_SHA = "a" * 40
ORIGINAL_ORIGIN = "http://127.0.0.1:28730"


class EnvironmentProjectionTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix="asa-win04b2-")
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "source"
        self.root.mkdir()
        self.env = {
            "COMPOSE_PROJECT_NAME": "asa-lab-original-qa",
            "POSTGRES_DB": "asalab",
            "POSTGRES_USER": "asalab_admin",
            "POSTGRES_PASSWORD": "SYNTHETIC_DB_PASSWORD_12345678",
            "ASA_APP_DB_PASSWORD": "SYNTHETIC_APP_PASSWORD_12345678",
            "APP_DATABASE_URL": "postgres://asalab_app:SYNTHETIC_APP_PASSWORD_12345678@postgres:5432/asalab",
            "MIGRATION_DATABASE_URL": "postgres://asalab_admin:SYNTHETIC_DB_PASSWORD_12345678@postgres:5432/asalab",
            "MIGRATION_EXPECT_DATABASE": "asalab",
            "MIGRATION_CONFIRM": "APPLY:asalab",
            "ASA_WEB_PORT": "28730",
            "ASA_API_PORT": "28731",
            "ASA_BLOCKS_PORT": "28733",
            "ASA_BLOCKS_PARENT_ORIGIN": ORIGINAL_ORIGIN,
            "ASA_BLOCKS_RUNTIME_ORIGIN": ORIGINAL_ORIGIN,
            "ASA_UPDATE_ENTRY_ORIGIN": ORIGINAL_ORIGIN,
            "ASA_OBJECT_STORAGE_ENDPOINT": "http://minio:9000",
            "ASA_OBJECT_STORAGE_BUCKET": "asa-blocks",
            "ASA_OBJECT_STORAGE_ACCESS_KEY": "SYNTHETIC_S3_ACCESS",
            "ASA_OBJECT_STORAGE_SECRET_KEY": "SYNTHETIC_S3_SECRET",
            "ASA_SETTINGS_ENCRYPTION_KEY": "SYNTHETIC_ENCRYPTION_KEY",
            "ASA_BLOCKS_RUNTIME_SIGNING_KEY": "SYNTHETIC_BLOCK_SIGNING_KEY",
            "ASA_SEARCH_SECRET": "SYNTHETIC_SEARCH_SECRET",
            "CLASSROOM_CODE_SECRET": "SYNTHETIC_CLASSROOM_SECRET",
            "ASA_STUDENT_CODE_PROTECTION_MODE": "compat",
            "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON": '{"enc":"SYNTHETIC_STUDENT_ENCRYPTION_KEY"}',
            "ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID": "enc",
            "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON": '{"lookup":"SYNTHETIC_STUDENT_LOOKUP_KEY"}',
            "ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID": "lookup",
            "ASA_SEED_DEV": "false",
            "ASA_SEED_TEACHER_PASSWORD": "SYNTHETIC_TEACHER_PASSWORD",
            "ASA_SEED_TEACHER_EMAIL": "teacher@example.test",
        }
        self.manifest = {
            "profile": "production",
            "project": "asa-lab-original-qa",
            "files": {},
        }
        self.save()

    def save(self, extra=""):
        raw = "".join(f"{k}={v}\n" for k, v in self.env.items()).encode("utf8")
        raw += extra.encode("utf8")
        (self.root / "private.env").write_bytes(raw)
        self.manifest["files"]["private.env"] = {
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
        (self.root / "manifest.json").write_text(
            json.dumps(self.manifest), encoding="utf8",
        )

    def call(self, *, source_check=None, project="asa-lab-new-qa",
             web=28780, blocks=28783):
        if source_check is None:
            source_check = {
                "status": "ARCHIVE_VERIFIED_NO_IMPORT",
                "sourceRevision": SOURCE_SHA,
                "writesPerformed": False,
            }
        with patch(
            "deployment.import_env_projection.validate_import_archive",
            return_value=source_check,
        ) as verifier:
            result = project_private_environment(
                self.root, project=project, web_port=web, blocks_port=blocks,
            )
        verifier.assert_called_once_with(self.root)
        return result

    def expect_blocked(self, code):
        with self.assertRaises(Blocked) as caught:
            self.call()
        self.assertEqual(caught.exception.code, code)

    def test_only_transport_values_change_all_original_keys_remain(self):
        before = (self.root / "private.env").read_bytes()
        private, report = self.call()
        self.assertEqual(report["status"], "PRIVATE_ENV_PROJECTION_ONLY")
        self.assertTrue(report["preservesOriginalKeys"])
        self.assertEqual(report["targetProject"], "asa-lab-new-qa")
        self.assertEqual(report["targetWebPort"], 28780)
        self.assertEqual(report["targetApiPort"], 28781)
        self.assertEqual(report["targetBlocksPort"], 28783)
        self.assertEqual(private["COMPOSE_PROJECT_NAME"], "asa-lab-new-qa")
        self.assertTrue(all(private[key] == "http://127.0.0.1:28780"
                            for key in ORIGIN_KEYS))
        self.assertEqual(
            {key for key in private if private[key] != self.env.get(key)},
            TRANSPORT_KEYS,
        )
        self.assertTrue(all(private[key] == self.env[key]
                            for key in PRESERVED_KEYS | (PRIVATE_FIELDS & set(self.env))))
        self.assertFalse(report["secretsWritten"])
        self.assertFalse(report["targetProvisioned"])
        self.assertFalse(report["writesPerformed"])
        self.assertFalse(report["publisherSignatureVerified"])
        self.assertEqual((self.root / "private.env").read_bytes(), before)
        for secret in self.env.values():
            if "SYNTHETIC_" in secret:
                self.assertNotIn(secret, json.dumps(report))

    def test_missing_required_secret_is_rejected(self):
        self.env.pop("ASA_SETTINGS_ENCRYPTION_KEY")
        self.save()
        self.expect_blocked("IMPORT_ORIGINAL_KEYS")

    def test_invalid_postgres_connection_host_and_password_rejected(self):
        for bad in (
            "postgres://asalab_admin:SYNTHETIC_DB_PASSWORD_12345678@localhost:5432/asalab",
            "postgres://asalab_admin:wrong@postgres:5432/asalab",
            "postgres://asalab_admin:SYNTHETIC_DB_PASSWORD_12345678@postgres:5432/other",
        ):
            with self.subTest(bad=bad.split("@")[-1]):
                self.env["MIGRATION_DATABASE_URL"] = bad
                self.save()
                self.expect_blocked("IMPORT_SOURCE_DATABASE")

    def test_original_migration_confirm_does_not_match_db(self):
        self.env["MIGRATION_CONFIRM"] = "APPLY:anotherdb"
        self.save()
        self.expect_blocked("IMPORT_SOURCE_DATABASE")

    def test_wrong_app_db_password_rejected(self):
        self.env["APP_DATABASE_URL"] = (
            "postgres://asalab_app:wrong@postgres:5432/asalab"
        )
        self.save()
        self.expect_blocked("IMPORT_SOURCE_DATABASE")

    def test_wrong_scratch_or_portal_origin_rejected(self):
        self.env["ASA_BLOCKS_PARENT_ORIGIN"] = "http://127.0.0.1:9999"
        self.save()
        self.expect_blocked("IMPORT_ENV_ORIGINS")

    def test_hidden_old_origin_reference_rejected(self):
        self.env["ASA_UNEXPECTED_PORTAL"] = ORIGINAL_ORIGIN + "/old"
        self.save()
        self.expect_blocked("IMPORT_ENV_REFERENCE")

    def test_duplicate_key_refused_even_if_manifest_rehashed(self):
        self.save(extra="POSTGRES_PASSWORD=EVIL_DUPLICATE_VALUE\n")
        self.expect_blocked("IMPORT_ENV_FORMAT")

    def test_broken_line_without_equal_sign_rejected(self):
        self.save(extra="MALFORMED_LINE_WITHOUT_VALUE\n")
        self.expect_blocked("IMPORT_ENV_FORMAT")

    def test_modified_private_env_after_full_validation_is_rejected(self):
        def tamper(_archive):
            private = self.root / "private.env"
            private.write_bytes(private.read_bytes() + b"\n# modified after verification")
            return {
                "status": "ARCHIVE_VERIFIED_NO_IMPORT",
                "sourceRevision": SOURCE_SHA,
                "writesPerformed": False,
            }
        with patch("deployment.import_env_projection.validate_import_archive",
                   side_effect=tamper):
            with self.assertRaises(Blocked) as caught:
                project_private_environment(
                    self.root, project="asa-lab-new-qa",
                    web_port=28780, blocks_port=28783,
                )
        self.assertEqual(caught.exception.code, "IMPORT_ENV_RACE")

    def test_source_and_destination_project_must_be_distinct(self):
        with self.assertRaises(Blocked) as caught:
            self.call(project="asa-lab-original-qa")
        self.assertEqual(caught.exception.code, "IMPORT_ENV_PROJECT")

    def test_mismatched_source_project_rejected(self):
        self.env["COMPOSE_PROJECT_NAME"] = "asa-lab-foreign"
        self.save()
        self.expect_blocked("IMPORT_ENV_PROJECT")

    def test_dev_seed_cannot_be_imported_as_production(self):
        self.env["ASA_SEED_DEV"] = "true"
        self.save()
        self.expect_blocked("IMPORT_ENV_PROFILE")

    def test_old_ports_must_be_consistent(self):
        self.env["ASA_API_PORT"] = "4611"
        self.save()
        self.expect_blocked("IMPORT_ENV_PORTS")

    def test_preflight_must_have_succeeded_without_writes(self):
        with self.assertRaises(Blocked) as caught:
            self.call(source_check={
                "status": "ARCHIVE_VERIFIED_NO_IMPORT",
                "sourceRevision": SOURCE_SHA,
                "writesPerformed": True,
            })
        self.assertEqual(caught.exception.code, "IMPORT_UNVERIFIED")

    def test_cli_does_not_print_or_write_synthetic_private_values(self):
        public_report = {
            "status": "PRIVATE_ENV_PROJECTION_ONLY",
            "targetProject": "asa-lab-new-qa",
            "preservesOriginalKeys": True,
            "writesPerformed": False,
        }
        stdout, stderr = io.StringIO(), io.StringIO()
        with (
            patch.object(asa_manager, "Installation",
                  side_effect=AssertionError("No installation allowed")),
            patch.object(asa_manager, "run",
                  side_effect=AssertionError("No Docker command allowed")),
            patch.object(asa_manager, "project_private_environment",
                  return_value=(
                      {"POSTGRES_PASSWORD": "SYNTHETIC_NOT_TO_BE_PRINTED"},
                      public_report,
                  )) as projection,
            patch("sys.stdout", stdout), patch("sys.stderr", stderr),
        ):
            code = asa_manager.main([
                "import-private-plan", "--backup", str(self.root),
                "--install-project", "asa-lab-new-qa",
                "--install-web-port", "28780",
                "--install-blocks-port", "28783",
            ])
        self.assertEqual(code, 0, stderr.getvalue())
        projection.assert_called_once()
        self.assertIn("PRIVATE_ENV_PROJECTION_ONLY", stdout.getvalue())
        self.assertNotIn("SYNTHETIC_NOT_TO_BE_PRINTED", stdout.getvalue())
        self.assertFalse((self.root / ".env").exists())

    def test_staging_function_itself_writes_nothing(self):
        before = sorted(str(x.relative_to(self.root)) for x in self.root.rglob("*"))
        stdout = io.StringIO()
        with patch("sys.stdout", stdout):
            private, summary = self.call()
        after = sorted(str(x.relative_to(self.root)) for x in self.root.rglob("*"))
        self.assertEqual(before, after)
        self.assertFalse(stdout.getvalue())
        self.assertEqual(len(private), len(self.env))


if __name__ == "__main__":
    unittest.main()
