"""Focused regression tests for the ASA test-only Docker refresh operator.

All tests are local and never touch Docker, GitHub, credentials or live data.
Run: python3 -m unittest tools.test_asa_test_refresh -v
"""
import io
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from tools.asa_test_refresh import (
    Blocked, SAFE_DB, env_read, env_replace, extract_snapshot, image_overrides,
    merge_student_keys, sha256, source_services, ensure_source_service_secrets,
)


def base_env():
    return {
        "POSTGRES_DB": "asalab",
        "COMPOSE_PROJECT_NAME": "asa-lab-dev",
        "ASA_SETTINGS_ENCRYPTION_KEY": "shared-1",
        "CLASSROOM_CODE_SECRET": "shared-2",
        "ASA_BLOCKS_RUNTIME_SIGNING_KEY": "shared-3",
        "ASA_OBJECT_STORAGE_ACCESS_KEY": "shared-4",
        "ASA_OBJECT_STORAGE_SECRET_KEY": "shared-5",
        "ASA_OBJECT_STORAGE_BUCKET": "asa-blocks",
        "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON": json.dumps({"local": "aaa"}),
        "ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID": "local",
        "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON": json.dumps({"local": "bbb"}),
        "ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID": "local",
    }


class EnvironmentSafetyTests(unittest.TestCase):
    def test_env_read_keeps_quoted_json_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / ".env"
            p.write_text("FOO='{\"a\":\"b\"}'\nBAR=123\n")
            self.assertEqual(env_read(p), {"FOO": '{"a":"b"}', "BAR": "123"})

    def test_duplicate_environment_key_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / ".env"
            p.write_text("A=x\nA=y\n")
            with self.assertRaises(Blocked):
                env_read(p)

    def test_replace_preserves_unrelated_secrets_and_0600_permissions(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = Path(tmp) / ".env"
            old.write_text("ASA_BUILD_REVISION='old'\nUNTOUCHED_PASSWORD='private-secret'\n")
            candidate = Path(tmp) / "candidate.env"
            env_replace(old, {"ASA_BUILD_REVISION": "new"}, candidate)
            self.assertIn("UNTOUCHED_PASSWORD='private-secret'", candidate.read_text())
            self.assertIn("ASA_BUILD_REVISION='new'", candidate.read_text())
            self.assertEqual(stat.S_IMODE(candidate.stat().st_mode), 0o600)
            self.assertEqual(old.read_text(), "ASA_BUILD_REVISION='old'\nUNTOUCHED_PASSWORD='private-secret'\n")

    def test_missing_replace_key_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = Path(tmp) / ".env"
            old.write_text("EXISTING=x\n")
            with self.assertRaises(Blocked):
                env_replace(old, {"MISSING": "x"}, Path(tmp) / "next")

    def test_newlines_quotes_are_not_permitted_in_replacement(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = Path(tmp) / ".env"
            old.write_text("EXISTING=x\n")
            for malicious in ("x\nUNTRUSTED=1", "a'b", "value\r\n"):
                with self.subTest(malicious=malicious), self.assertRaises(Blocked):
                    env_replace(old, {"EXISTING": malicious}, Path(tmp) / "next")

    def test_merge_uses_both_local_and_archive_keyrings(self):
        live = base_env()
        archived = {**live,
                    "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON": json.dumps({"backup": "ccc"}),
                    "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON": json.dumps({"backup": "ddd"}),
                    "ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID": "backup",
                    "ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID": "backup"}
        candidate = merge_student_keys(live, archived)
        self.assertEqual(json.loads(candidate["ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON"]),
                         {"local": "aaa", "backup": "ccc"})
        self.assertEqual(json.loads(candidate["ASA_STUDENT_CODE_LOOKUP_KEYS_JSON"]),
                         {"local": "bbb", "backup": "ddd"})
        self.assertNotIn("POSTGRES_PASSWORD", candidate)

    def test_conflicting_key_ids_block_restore(self):
        live = base_env()
        archived = {**live, "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON": json.dumps({"local": "different"})}
        with self.assertRaisesRegex(Blocked, "Conflicting"):
            merge_student_keys(live, archived)

    def test_secret_mismatch_blocks_restore(self):
        live = base_env()
        archived = {**live, "ASA_SETTINGS_ENCRYPTION_KEY": "wrong-key"}
        with self.assertRaisesRegex(Blocked, "Protected secret"):
            merge_student_keys(live, archived)

    def test_different_compose_identity_blocks_restore(self):
        live = base_env()
        archived = {**live, "COMPOSE_PROJECT_NAME": "another-service"}
        with self.assertRaises(Blocked):
            merge_student_keys(live, archived)

    def test_deterministic_sha_tag_and_schema(self):
        sha = "a" * 40
        result = image_overrides(sha, 255)
        self.assertEqual(result["ASA_EXPECTED_SCHEMA_VERSION"], "255")
        self.assertEqual(result["ASA_BUILD_REVISION"], sha)
        self.assertEqual(result["ASA_WEB_IMAGE"], "asa-lab-web:git-aaaaaaaaaaaa")
        self.assertEqual(len(result), 7)

    def test_database_name_restrictions(self):
        self.assertTrue(SAFE_DB.fullmatch("asa_refresh_1234_test"))
        for value in ("asalab", "asa_refresh_foo", "'; DROP DATABASE;", "/tmp/test", "A_TEST"):
            self.assertIsNone(SAFE_DB.fullmatch(value))


class SnapshotSafetyTests(unittest.TestCase):
    def write_tar(self, path: Path, name: str, *, symlink: bool = False) -> None:
        with tarfile.open(path, "w") as tar:
            info = tarfile.TarInfo(name)
            if symlink:
                info.type = tarfile.SYMTYPE
                info.linkname = "/etc/passwd"
                tar.addfile(info)
            else:
                data = b"not a real backup"
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))

    def test_rejects_parent_directory_traversal_before_extraction(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            archive = parent / "bad.tar"
            self.write_tar(archive, "snapshot/../../escaped-file")
            with self.assertRaises(Blocked):
                extract_snapshot(archive, None, parent / "out", None)
            self.assertFalse((parent / "escaped-file").exists())

    def test_rejects_symlink_members(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            archive = parent / "link.tar"
            self.write_tar(archive, "snapshot/link", symlink=True)
            with self.assertRaises(Blocked):
                extract_snapshot(archive, None, parent / "out", None)

    def test_rejects_bad_archive_digest_without_extraction(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            archive = parent / "good.tar"
            self.write_tar(archive, "snapshot/file")
            with self.assertRaisesRegex(Blocked, "SHA256 mismatch"):
                extract_snapshot(archive, None, parent / "out", "f" * 64)
            self.assertFalse((parent / "out").exists())

    def test_accepted_simple_archive_calls_canonical_backup_validator(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            archive = parent / "archive.tar"
            self.write_tar(archive, "snapshot/marker.txt")
            with patch("tools.asa_test_refresh.verify_backup", return_value={"complete": True}) as verify:
                result = extract_snapshot(archive, None, parent / "out", sha256(archive))
            self.assertEqual(result.name, "snapshot")
            verify.assert_called_once()




class ComposeEvolutionTests(unittest.TestCase):
    def test_new_search_service_is_detected_for_build_and_health(self):
        sha = "a" * 40
        tag = ":git-" + sha[:12]
        services = {
            "postgres": {"image": "postgres:17.7", "restart": "always"},
            "api": {"image": "asa-lab-api" + tag, "restart": "always", "build": {}},
            "migration": {"image": "asa-lab-api" + tag, "restart": "no", "build": {}},
            "scratch": {"image": "asa-lab-scratch" + tag, "restart": "unless-stopped", "build": {}},
            "web": {"image": "asa-lab-web" + tag, "restart": "always", "build": {}},
            "minio": {"image": "asa-lab-minio" + tag, "restart": "unless-stopped", "build": {}},
            "minio-init": {"image": "asa-lab-minio" + tag, "restart": "no"},
            "search": {"image": "asa-lab-search" + tag, "restart": "unless-stopped", "build": {}},
        }
        with patch("tools.asa_test_refresh.docker",
                   return_value=json.dumps({"services": services})):
            builds, runtime, refs = source_services(Path("/nonexistent"), Path("/absent"),
                                                   Path("/absent/overlay"), sha)
        self.assertIn("search", builds)
        self.assertIn("search", runtime)
        self.assertNotIn("migration", builds)
        self.assertNotIn("minio-init", runtime)
        self.assertEqual(len(refs), 5)

    def test_search_secret_is_private_and_stable_across_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".asa" / "test-refresh").mkdir(parents=True)
            overlay = root / "candidate.env"
            overlay.write_text("FOO='bar'\n")
            config = json.dumps({"services": {"search": {"image": "tag"}}})
            with patch("tools.asa_test_refresh.docker", return_value=config):
                ensure_source_service_secrets(root, root, overlay, "a" * 40)
                first = env_read(overlay)["ASA_SEARCH_SECRET"]
                ensure_source_service_secrets(root, root, overlay, "a" * 40)
            self.assertRegex(first, r"^[a-f0-9]{64}$")
            self.assertEqual(overlay.read_text().count("ASA_SEARCH_SECRET="), 1)
            keyfile = root / ".asa" / "test-refresh" / "search-secret"
            self.assertEqual(keyfile.read_text().strip(), first)
            self.assertEqual(stat.S_IMODE(keyfile.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(overlay.stat().st_mode), 0o600)

    def test_invalid_existing_search_secret_blocks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".asa" / "test-refresh").mkdir(parents=True)
            overlay = root / "candidate.env"
            overlay.write_text("ASA_SEARCH_SECRET='bad'\n")
            with patch("tools.asa_test_refresh.docker",
                       return_value=json.dumps({"services": {"search": {}}})):
                with self.assertRaisesRegex(Blocked, "invalid"):
                    ensure_source_service_secrets(root, root, overlay, "a" * 40)

    def test_unpinned_new_service_image_is_rejected(self):
        sha = "b" * 40
        services = {
            "postgres": {"image": "postgres:17.7", "restart": "always"},
            "api": {"image": "asa-lab-api:git-" + sha[:12], "restart": "always", "build": {}},
            "scratch": {"image": "asa-lab-scratch:git-" + sha[:12], "restart": "always", "build": {}},
            "web": {"image": "asa-lab-web:git-" + sha[:12], "restart": "always", "build": {}},
            "minio": {"image": "asa-lab-minio:git-" + sha[:12], "restart": "always", "build": {}},
            "search": {"image": "asa-lab-search:latest", "restart": "always", "build": {}},
        }
        with patch("tools.asa_test_refresh.docker",
                   return_value=json.dumps({"services": services})):
            with self.assertRaisesRegex(Blocked, "Unpinned"):
                source_services(Path("/none"), Path("/none"), Path("/none"), sha)

if __name__ == "__main__":
    unittest.main()
