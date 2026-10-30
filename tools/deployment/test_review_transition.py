"""Cheap fail-closed checks for the one-time local fresh namespace transition."""

import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from deployment.backup import attest_backup_mounts
from deployment.contracts import Blocked, file_hash
from deployment.review_transition import (APPROVED_RELEASE_REVISION, REVIEW_BINDS, _read_plan,
                                          attest_blank_database, digest,
                                          private_destination, replacement_env,
                                          review_snapshot, selected_release, validate_names,
                                          verify_source_archive)


class FreshNamespaceTests(unittest.TestCase):
    def test_names_must_be_new_and_safe(self):
        validate_names("asalab", "asa-blocks", "asalab_fresh_20261030", "asa-blocks-fresh-20261030")
        for database, bucket in (("asalab", "fresh-bucket"), ("bad-name", "fresh-bucket"),
                                 ("asalab_test", "fresh-bucket"), ("fresh_db", "asa-blocks"),
                                 ("fresh_db", "bad..bucket")):
            with self.subTest(database=database, bucket=bucket), self.assertRaises(Blocked):
                validate_names("asalab", "asa-blocks", database, bucket)

    def test_environment_changes_only_namespaces(self):
        old = {"POSTGRES_DB": "asalab", "MIGRATION_EXPECT_DATABASE": "asalab",
               "MIGRATION_CONFIRM": "APPLY:asalab", "ASA_OBJECT_STORAGE_BUCKET": "asa-blocks",
               "APP_DATABASE_URL": "postgres://app:secret@postgres:5432/asalab",
               "MIGRATION_DATABASE_URL": "postgres://admin:secret@postgres:5432/asalab"}
        raw = ("# private\n" + "".join(f"{key}={value}\n" for key, value in old.items())
               + "ASA_SETTINGS_ENCRYPTION_KEY=unchanged-secret\n").encode()
        result = replacement_env(raw, old, "asalab_fresh", "asa-blocks-fresh")
        self.assertIn(b"ASA_SETTINGS_ENCRYPTION_KEY=unchanged-secret\n", result)
        self.assertIn(b"APP_DATABASE_URL=postgres://app:secret@postgres:5432/asalab_fresh\n", result)
        self.assertIn(b"ASA_OBJECT_STORAGE_BUCKET=asa-blocks-fresh\n", result)
        self.assertNotIn(b"POSTGRES_DB=asalab\n", result)
        for changed in (raw.replace(b"POSTGRES_DB=asalab\n", b""),
                        raw + b"POSTGRES_DB=asalab\n",
                        raw.replace(b"/asalab\n", b"/other\n", 1)):
            with self.assertRaises(Blocked):
                replacement_env(changed, old, "asalab_fresh", "asa-blocks-fresh")

    def test_review_binds_are_exact_and_default_export_stays_strict(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            volumes = []
            config = {"services": {"api": {"volumes": []}, "web": {"volumes": []}}}
            for service, target, source in REVIEW_BINDS:
                mount = {"type": "bind", "target": target,
                         "source": str(root / source), "read_only": True}
                config["services"][service]["volumes"].append(mount)
                volumes.append(mount)
            with self.assertRaises(Blocked):
                attest_backup_mounts(root, config)
            self.assertFalse(attest_backup_mounts(root, config, readonly_bind_allowlist=REVIEW_BINDS))
            volumes[0]["read_only"] = False
            with self.assertRaises(Blocked):
                attest_backup_mounts(root, config, readonly_bind_allowlist=REVIEW_BINDS)
            volumes[0]["read_only"] = True
            volumes[0]["source"] = str(root / "foreign")
            with self.assertRaises(Blocked):
                attest_backup_mounts(root, config, readonly_bind_allowlist=REVIEW_BINDS)

    def test_private_destination_rejects_live_root_and_existing_archive(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "live"
            root.mkdir()
            with self.assertRaises(Blocked):
                private_destination(root, root / "backup")
            private = Path(folder) / "private"
            private.mkdir(mode=0o700)
            target = private / "new"
            if os.name == "nt":
                with patch("deployment.review_transition.subprocess.run") as process:
                    process.return_value.returncode = 0
                    self.assertEqual(private_destination(root, target), target.resolve())
                    process.return_value.returncode = 3
                    with self.assertRaises(Blocked):
                        private_destination(root, target)
            else:
                self.assertEqual(private_destination(root, target), target.resolve())
            target.mkdir()
            with self.assertRaises(Blocked):
                private_destination(root, target)

    def test_plan_hash_and_source_archive_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            plan = {"format": "asa-review-fresh-plan-v1", "snapshot": {}, "release": {}}
            plan["sha256"] = digest(plan)
            path = root / "plan.json"
            path.write_text(json.dumps(plan))
            self.assertEqual(_read_plan(path), plan)
            plan["snapshot"] = {"tampered": True}
            path.write_text(json.dumps(plan))
            with self.assertRaises(Blocked):
                _read_plan(path)
            archive = root / "archive"
            archive.mkdir()
            (archive / "file").write_bytes(b"old")
            (archive / "manifest.json").write_text(json.dumps({"format": "asa-review-source-v1",
                                                               "files": {"file": file_hash(archive / "file")}}))
            verify_source_archive(archive)
            (archive / "file").write_bytes(b"new")
            with self.assertRaises(Blocked):
                verify_source_archive(archive)

    def test_stale_release_is_rejected_before_ci(self):
        selected = APPROVED_RELEASE_REVISION
        with patch("deployment.review_transition.pinned_release", return_value={"revision": "b" * 40}), \
             patch("deployment.review_transition.assert_ci") as ci:
            with self.assertRaises(Blocked):
                selected_release(None, selected)
            ci.assert_not_called()

    def test_new_database_must_be_blank(self):
        with patch("deployment.review_transition.table_counts", return_value={}):
            attest_blank_database(None, "new_db")
        with patch("deployment.review_transition.table_counts", return_value={"schema_migrations": 1}):
            with self.assertRaises(Blocked):
                attest_blank_database(None, "new_db")

    def test_observed_review_identity_rejects_image_mount_port_and_shared_volume(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            overlay = root / ".asa/local-review/compose.review.yaml"
            overlay.parent.mkdir(parents=True)
            overlay.write_text("services: {}\n")
            (overlay.parent / "api-watch.sh").write_text("#!/bin/sh\n")
            (overlay.parent / "vite.config.mts").write_text("export default {}\n")
            env = {"ASA_UPDATE_ENTRY_ORIGIN": "http://127.0.0.1:4610",
                   "ASA_BLOCKS_PARENT_ORIGIN": "http://127.0.0.1:4610",
                   "ASA_BLOCKS_RUNTIME_ORIGIN": "http://127.0.0.1:4610",
                   "POSTGRES_DB": "asalab", "ASA_OBJECT_STORAGE_BUCKET": "asa-blocks",
                   "APP_DATABASE_URL": "postgres://app:secret@postgres:5432/asalab",
                   "ASA_OBJECT_STORAGE_ACCESS_KEY": "private-key",
                   "ASA_OBJECT_STORAGE_SECRET_KEY": "private-secret",
                   "POSTGRES_USER": "admin", "POSTGRES_PASSWORD": "db-secret",
                   "ASA_SEARCH_SECRET": "search-secret"}
            for key in ("ASA_SETTINGS_ENCRYPTION_KEY", "CLASSROOM_CODE_SECRET",
                        "ASA_STUDENT_CODE_PROTECTION_MODE", "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON",
                        "ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID", "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON",
                        "ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID", "ASA_BLOCKS_RUNTIME_SIGNING_KEY",
                        "ASA_OBJECT_STORAGE_ENDPOINT", "ASA_OBJECT_STORAGE_REGION",
                        "ASA_OBJECT_STORAGE_FORCE_PATH_STYLE"):
                env[key] = "private-" + key
            (root / ".env").write_text("POSTGRES_DB=asalab\n")
            records = {name: {"id": name, "image": "old-image", "mounts": [], "running": True}
                       for name in ("postgres", "minio", "search", "scratch", "api", "web")}
            records["postgres"]["mounts"] = [{"Type": "volume", "Name": "asa-lab-dev_postgres-data",
                                                   "Destination": "/var/lib/postgresql/data"}]
            records["minio"]["mounts"] = [{"Type": "volume", "Name": "asa-lab-dev_blocks-object-data",
                                                "Destination": "/data"}]
            records["api"]["mounts"] = [{"Type": "volume", "Name": "asa-lab-dev_application-logs",
                                              "Destination": "/var/lib/asa-application-logs"}]
            image = "review-workspace:known"
            config = {"services": {name: {"image": image, "volumes": []}
                                   for name in ("postgres", "migration", "minio", "minio-init",
                                                "api", "web", "scratch", "search")}}
            config["services"]["api"]["environment"] = dict(env)
            api_runtime = dict(env)
            for service, key in (("scratch", "ASA_BLOCKS_PARENT_ORIGIN"),
                                 ("web", "ASA_BLOCKS_RUNTIME_ORIGIN"),
                                 ("search", "ASA_SEARCH_SECRET")):
                config["services"][service]["environment"] = {key: env[key]}
            config["services"]["postgres"]["image"] = "postgres:17.7-bookworm"
            config["services"]["api"]["entrypoint"] = ["/bin/sh", "/workspace/.asa/local-review/api-watch.sh"]
            config["services"]["web"]["entrypoint"] = ["node", "/workspace/node_modules/vite/bin/vite.js",
                                                         "--config", "/workspace/.asa/local-review/vite.config.mts"]
            for service, target, source in REVIEW_BINDS:
                config["services"][service]["volumes"].append(
                    {"type": "bind", "target": target, "source": str(root / source), "read_only": True})
            for service, published, target in (("web", "4610", "8080"),
                                                ("api", "4611", "4611"), ("scratch", "4613", "8080")):
                config["services"][service]["ports"] = [
                    {"published": published, "target": target, "host_ip": "127.0.0.1"}]

            class FakeInstallation:
                profile = "dev"
                project = "asa-lab-dev"
                files = ["compose.yaml", "compose.dev.yaml", ".asa/local-review/compose.review.yaml"]

                def __init__(self):
                    self.root, self.env = root, env

                def identity(self):
                    return records

                def compose(self, *args, **_kwargs):
                    return json.dumps(config)

                def readiness(self):
                    return {"revision": "a" * 40, "schema": 261}

                def containers(self):
                    return list(records.values())

                def container_environment(self, record):
                    if record["id"] == "api":
                        return dict(api_runtime)
                    if record["id"] == "postgres":
                        return {key: env[key] for key in ("POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD")}
                    if record["id"] == "minio":
                        return {"MINIO_ROOT_USER": env["ASA_OBJECT_STORAGE_ACCESS_KEY"],
                                "MINIO_ROOT_PASSWORD": env["ASA_OBJECT_STORAGE_SECRET_KEY"]}
                    if record["id"] == "scratch":
                        return dict(config["services"]["scratch"]["environment"])
                    if record["id"] == "web":
                        return dict(config["services"]["web"]["environment"])
                    if record["id"] == "search":
                        return dict(config["services"]["search"]["environment"])
                    return {}

            fake = FakeInstallation()
            patches = [patch("deployment.review_transition.APPROVED_OVERLAY_SHA256", file_hash(overlay)),
                       patch("deployment.review_transition.APPROVED_OLD_REVISION", "a" * 40),
                       patch("deployment.review_transition.APPROVED_REVIEW_IMAGE", image),
                       patch("deployment.review_transition.database_names", return_value=["asalab"]),
                       patch("deployment.review_transition.bucket_names", return_value=["asa-blocks"]),
                       patch("deployment.review_transition.table_counts", return_value={"schema_migrations": 256}),
                       patch("deployment.review_transition.schema_hash", return_value="schema-sha"),
                       patch("deployment.review_transition.wip_snapshot", return_value={"branch": "review", "files": {"x": {}}}),
                       patch("deployment.review_transition.tree_fingerprint", return_value={"files": 1, "sha256": "x"}),
                       patch("deployment.review_transition.run", return_value="image-id")]
            for context in patches:
                context.__enter__()
            try:
                inputs = {"overlay_sha256": file_hash(overlay), "database": "asalab_fresh",
                          "bucket": "asa-blocks-fresh", "expected_old_revision": "a" * 40}
                review_snapshot(fake, **inputs)
                missing_defaults = ("CLASSROOM_CODE_SECRET", "ASA_STUDENT_CODE_PROTECTION_MODE",
                                    "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON",
                                    "ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID",
                                    "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON",
                                    "ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID")
                saved = {key: env.pop(key) for key in missing_defaults}
                review_snapshot(fake, **inputs)
                missing_default = missing_defaults[1]
                config["services"]["api"]["environment"][missing_default] = "changed-default"
                with self.assertRaises(Blocked):
                    review_snapshot(fake, **inputs)
                config["services"]["api"]["environment"][missing_default] = saved[missing_default]
                env.update(saved)
                changes = [
                    (config["services"]["postgres"], "image", "postgres:18"),
                    (config["services"]["api"]["volumes"][0], "read_only", False),
                    (config["services"]["web"]["ports"][0], "host_ip", "0.0.0.0"),
                ]
                for item, key, value in changes:
                    original = item[key]
                    item[key] = value
                    with self.assertRaises(Blocked):
                        review_snapshot(fake, **inputs)
                    item[key] = original
                original_environment = fake.container_environment
                fake.container_environment = lambda record: ({**original_environment(record),
                    **({"ASA_SEARCH_SECRET": "unreviewed-secret"} if record["id"] == "search" else {})})
                with self.assertRaises(Blocked):
                    review_snapshot(fake, **inputs)
                fake.container_environment = original_environment
                records["foreign"] = {"id": "foreign", "image": "foreign", "mounts":
                                      [{"Type": "volume", "Name": "asa-lab-dev_postgres-data"}], "running": True}
                with self.assertRaises(Blocked):
                    review_snapshot(fake, **inputs)
            finally:
                for context in reversed(patches):
                    context.__exit__(None, None, None)


if __name__ == "__main__":
    unittest.main()
