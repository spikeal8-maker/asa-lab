import datetime as dt
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.contracts import (Blocked, DEFAULT_WINDOW, REGISTRY, SERVICES, atomic_json,
                                  attest_database_targets, exact_origin, in_window, inventory_files, read_env, safe_member,
                                  validate_release, verify_backup)
from deployment.backup import recovery_configuration
from deployment.system import Installation, operation_lock, run
from deployment.releases import assert_ci
import asa_manager


def release():
    return {"format": "asa-deployment-v1", "repository": "spikeal8-maker/asa-lab",
            "revision": "a" * 40, "schema": 159, "platform": "linux/amd64", "publicationRunId": 12,
            "images": {name: f"{REGISTRY}/{name}@sha256:" + "b" * 64 for name in SERVICES}}


def compose_config():
    return {"services": {
        "postgres": {"environment": {"POSTGRES_DB": "asalab"}, "volumes": [{"type": "volume", "target": "/var/lib/postgresql/data", "source": "postgres-data"}]},
        "minio": {"volumes": [{"type": "volume", "target": "/data", "source": "objects"}]},
        "api": {"environment": {"APP_DATABASE_URL": "postgres://asalab_app:synthetic@postgres:5432/asalab"}},
        "migration": {"environment": {"MIGRATION_DATABASE_URL": "postgres://admin:synthetic@postgres:5432/asalab", "MIGRATION_EXPECT_DATABASE": "asalab", "MIGRATION_CONFIRM": "APPLY:asalab"}},
    }, "volumes": {"postgres-data": {"name": "asa-lab-dev_postgres-data"}, "objects": {"name": "asa-lab-dev_objects"}}}


class WindowTests(unittest.TestCase):
    def test_exact_moscow_boundaries_independent_of_host_timezone(self):
        for timestamp, expected in [
            ("2026-09-26T23:59:59+00:00", False),
            ("2026-09-27T00:00:00+00:00", True),
            ("2026-09-27T01:59:59+00:00", True),
            ("2026-09-27T02:00:00+00:00", False),
            ("2026-09-28T00:30:00+00:00", False),
        ]:
            with self.subTest(timestamp=timestamp):
                self.assertEqual(in_window(DEFAULT_WINDOW, dt.datetime.fromisoformat(timestamp)), expected)

    def test_late_download_does_not_start_maintenance(self):
        self.assertFalse(in_window(DEFAULT_WINDOW, dt.datetime.fromisoformat("2026-09-27T01:46:00+00:00"), 15))

    def test_invalid_window_is_not_silently_defaulted(self):
        for field, value in [("start", "03:99"), ("end", "02:00"), ("weekday", 7), ("utcOffsetMinutes", "180")]:
            with self.subTest(field=field), self.assertRaises(Blocked):
                in_window({**DEFAULT_WINDOW, field: value})


class ReleaseTests(unittest.TestCase):
    def test_publication_and_general_ci_must_both_match(self):
        publication = {"name": "ASA Portable Release", "path": ".github/workflows/portable-release.yml",
                       "display_title": "Release " + "a" * 40, "head_branch": "main",
                       "status": "completed", "conclusion": "success"}
        general = {"name": "ASA Lab Governance and Code Gates", "head_sha": "a" * 40,
                   "head_branch": "main", "status": "completed", "conclusion": "success", "run_number": 1}
        for change in ({}, {"conclusion": "failure"}, {"head_branch": "feature"}, {"display_title": "Release " + "b" * 40}):
            responses = [io.BytesIO(json.dumps({"workflow_runs": [general]}).encode()),
                         io.BytesIO(json.dumps({**publication, **change}).encode())]
            with self.subTest(change=change), patch("deployment.releases.urllib.request.urlopen", side_effect=responses):
                if change:
                    with self.assertRaises(Blocked):
                        assert_ci(release())
                else:
                    assert_ci(release())
        newer_red = {**general, "run_number": 2, "conclusion": "failure"}
        responses = [io.BytesIO(json.dumps({"workflow_runs": [general, newer_red]}).encode()),
                     io.BytesIO(json.dumps(publication).encode())]
        with patch("deployment.releases.urllib.request.urlopen", side_effect=responses), self.assertRaises(Blocked):
            assert_ci(release())

    def test_pinned_set(self):
        self.assertEqual(validate_release(release())["schema"], 159)

    def test_mutable_and_foreign_images_are_refused(self):
        for image in [f"{REGISTRY}/api:latest", "evil.example/api@sha256:" + "b" * 64,
                      f"{REGISTRY}/web@sha256:" + "b" * 64]:
            candidate = release()
            candidate["images"]["api"] = image
            with self.subTest(image=image), self.assertRaises(Blocked):
                validate_release(candidate)

    def test_incomplete_manifest(self):
        for field in ["schema", "revision", "publicationRunId", "platform", "images"]:
            candidate = release()
            del candidate[field]
            with self.subTest(field=field), self.assertRaises(Blocked):
                validate_release(candidate)

    def test_origin_rejects_injection_credentials_and_path(self):
        for value in ["https://host/path", "https://user:pass@host", "https://host\";alert(1)",
                      "https://host?x", "https://host#x", "https://host:99999", "*"]:
            with self.subTest(value=value), self.assertRaises((Blocked, ValueError)):
                exact_origin(value)
        self.assertEqual(exact_origin("http://localhost:4613"), "http://localhost:4613")


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for name in ["database.dump", "globals.sql", "private.env"]:
            (self.root / name).write_bytes(b"fixture")
        (self.root / "objects").mkdir()
        (self.root / "objects" / "saved-media").write_bytes(b"user-media")
        atomic_json(self.root / "manifest.json", {"format": "asa-backup-v1", "complete": True,
                    "files": inventory_files(self.root), "runtime": {"revision": "a" * 40}})

    def tearDown(self):
        self.temp.cleanup()

    def test_complete_backup(self):
        self.assertEqual(len(verify_backup(self.root)["files"]), 4)

    def test_binary_dump_stream_is_not_text_decoded(self):
        payload = b"PGDMP\x00\xff\r\n\x1a\x80" * 1024
        source = self.root / "binary-source"
        destination = self.root / "binary-copy"
        source.write_bytes(payload)
        with source.open("rb") as incoming, destination.open("wb") as outgoing:
            run([sys.executable, "-c", "import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())"], input_file=incoming, output=outgoing)
        self.assertEqual(destination.read_bytes(), payload)

    def test_corrupt_database(self):
        (self.root / "database.dump").write_bytes(b"changed")
        with self.assertRaises(Blocked):
            verify_backup(self.root)

    def test_missing_media_is_not_success(self):
        (self.root / "objects" / "saved-media").unlink()
        with self.assertRaises(Blocked):
            verify_backup(self.root)

    def test_added_file_is_not_ignored(self):
        (self.root / "unexpected").write_bytes(b"x")
        with self.assertRaises(Blocked):
            verify_backup(self.root)

    def test_traversal_and_windows_paths(self):
        for value in ["../private.env", "C:/secret", "/etc/passwd", "objects/../../secret", "..\\secret", "objects//file"]:
            with self.subTest(value=value), self.assertRaises(Blocked):
                safe_member(self.root, value)

    def test_duplicate_environment_rejected(self):
        file = self.root / ".env"
        file.write_text("POSTGRES_DB=one\nPOSTGRES_DB=two\n")
        with self.assertRaises(Blocked):
            read_env(file)

    def test_second_operation_cannot_acquire_lock(self):
        with operation_lock(self.root):
            with self.assertRaises(Blocked):
                with operation_lock(self.root):
                    self.fail("Second lock was admitted")


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / ".env").write_text("COMPOSE_PROJECT_NAME=asa-lab-dev\n")
        self.install = Installation(self.root, "dev")
        from unittest.mock import MagicMock
        self.install.compose = MagicMock(return_value=json.dumps(compose_config()))
        self.install.container_environment = MagicMock(return_value={"POSTGRES_DB": "asalab"})

    def tearDown(self):
        self.temp.cleanup()

    def record(self, **overrides):
        labels = {"com.docker.compose.project": "asa-lab-dev", "com.docker.compose.service": "postgres",
                  "com.docker.compose.project.working_dir": str(self.root),
                  "com.docker.compose.project.config_files": ",".join(str(self.root / p) for p in self.install.files)}
        labels.update(overrides)
        return {"labels": labels, "running": True, "mounts": [{"Type": "volume", "Destination": "/var/lib/postgresql/data", "Name": "asa-lab-dev_postgres-data"}]}

    def test_renamed_and_external_database_volumes_are_refused(self):
        for name in ("asa-lab-dev_new-data", "external-other-database"):
            config = compose_config()
            config["volumes"]["postgres-data"]["name"] = name
            self.install.compose.return_value = json.dumps(config)
            with self.subTest(name=name), patch.object(self.install, "containers", return_value=[self.record()]), self.assertRaisesRegex(Blocked, "Persistent volume identity changed"):
                self.install.identity()

    def test_changed_object_volume_is_refused(self):
        minio = self.record(**{"com.docker.compose.service": "minio"})
        minio["mounts"] = [{"Type": "volume", "Destination": "/data", "Name": "different-objects"}]
        with patch.object(self.install, "containers", return_value=[self.record(), minio]), self.assertRaises(Blocked):
            self.install.identity()

    def test_database_targets_match_backup(self):
        config = compose_config()
        attest_database_targets(config, {"POSTGRES_DB": "asalab"}, config["services"]["api"]["environment"])
        for service, key in (("api", "APP_DATABASE_URL"), ("migration", "MIGRATION_DATABASE_URL")):
            for url in ("postgres://user:synthetic@external:5432/asalab", "postgres://user:synthetic@postgres:5432/other"):
                candidate = compose_config()
                candidate["services"][service]["environment"][key] = url
                with self.subTest(service=service, url=url), self.assertRaises(Blocked):
                    attest_database_targets(candidate, {"POSTGRES_DB": "asalab"})
        with self.assertRaises(Blocked):
            attest_database_targets(config, {"POSTGRES_DB": "asalab"}, {"APP_DATABASE_URL": "postgres://user:synthetic@postgres:5432/other"})

    def test_backup_configuration_uses_running_revision(self):
        (self.root / ".git").mkdir()
        for file in self.install.files:
            (self.root / file).write_text("candidate configuration")
        calls = []
        def git(*args):
            calls.append(args)
            return args[-1] if args[0] == "ls-files" else "old runtime configuration"
        with patch.object(self.install, "git", side_effect=git):
            snapshot = recovery_configuration(self.install, {"revision": "a" * 40})
        self.assertTrue(all(text == "old runtime configuration\n" for text in snapshot["files"].values()))
        self.assertTrue(all(args[1].startswith("a" * 40 + ":") for args in calls if args[0] == "show"))
        atomic_json(self.install.state / "runtime-configuration.json", snapshot)
        with patch.object(self.install, "git", side_effect=AssertionError("must preserve snapshot across manager restart")):
            self.assertEqual(recovery_configuration(self.install, {"revision": "a" * 40}), snapshot)

    def test_canonical_directory(self):
        with patch.object(self.install, "containers", return_value=[self.record()]):
            self.assertIn("postgres", self.install.identity())

    def test_equivalent_compose_file_paths_are_canonicalized(self):
        record = self.record()
        record["labels"]["com.docker.compose.project.config_files"] = ",".join(str(self.root) + os.sep + "." + os.sep + p for p in self.install.files)
        with patch.object(self.install, "containers", return_value=[record]):
            self.assertIn("postgres", self.install.identity())

    def test_old_checkout_different_profile_and_duplicate_refused(self):
        inventories = [[self.record(**{"com.docker.compose.project.working_dir": str(self.root / "old")})],
                       [self.record(**{"com.docker.compose.project.config_files": "compose.yaml"})],
                       [self.record(), self.record()]]
        for records in inventories:
            with patch.object(self.install, "containers", return_value=records), self.assertRaises(Blocked):
                self.install.identity()

    def test_external_shell_cannot_redirect_project(self):
        with patch.dict(os.environ, {"COMPOSE_PROJECT_NAME": "wrong", "ASA_API_IMAGE": "evil:latest"}):
            install = Installation(self.root, "dev")
        self.assertEqual(install.process_env["COMPOSE_PROJECT_NAME"], "asa-lab-dev")
        self.assertNotIn("ASA_API_IMAGE", install.process_env)


class UpdateBoundaryTests(unittest.TestCase):
    def test_same_release_does_not_stop_or_back_up(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as root:
            install = MagicMock()
            install.state = Path(root)
            candidate = release()
            atomic_json(install.state / "installed-release.json", candidate)
            install.readiness.return_value = {"revision": candidate["revision"], "schema": candidate["schema"]}
            install.identity.return_value = {name: {"image": ref} for name, ref in candidate["images"].items()}
            with patch.object(asa_manager, "doctor"), patch.object(asa_manager, "clean_checkout"), \
                    patch.object(asa_manager, "discover_release", return_value=candidate), \
                    patch.object(asa_manager, "assert_ci"), patch.object(asa_manager, "export_backup") as backup, \
                    patch.object(asa_manager, "selected_source") as switch:
                asa_manager.update(install)
            backup.assert_not_called()
            switch.assert_not_called()
            install.compose.assert_not_called()

    def test_backup_failure_never_switches_running_services(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as root:
            install = MagicMock()
            install.root = install.state = Path(root)
            with patch.object(asa_manager, "doctor"), patch.object(asa_manager, "clean_checkout"), \
                    patch.object(asa_manager, "discover_release", return_value=release()), \
                    patch.object(asa_manager, "assert_ci"), patch.object(asa_manager, "fetch_images"), \
                    patch.object(asa_manager, "selected_source"), patch.object(asa_manager, "Installation", return_value=install), \
                    patch.object(asa_manager, "apply_release_environment"), patch.object(asa_manager, "validate_resolved_images"), \
                    patch.object(asa_manager, "export_backup", side_effect=Blocked("BACKUP", "disk full", "free space")), \
                    self.assertRaises(Blocked):
                asa_manager.update(install)
            self.assertFalse(any(call.args[0] in ("up", "stop") for call in install.compose.call_args_list))
            self.assertFalse((install.state / "installed-release.json").exists())

    def test_outside_window_does_not_touch_docker_or_network(self):
        from unittest.mock import MagicMock
        install = MagicMock()
        install.settings = {"automaticUpdates": True, "window": DEFAULT_WINDOW}
        with patch.object(asa_manager, "in_window", return_value=False), patch.object(asa_manager, "doctor") as doctor, patch.object(asa_manager, "discover_release") as discover:
            asa_manager.update(install, scheduled=True)
            doctor.assert_not_called()
            discover.assert_not_called()

    def test_red_ci_never_creates_backup_or_switches_services(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as root:
            install = MagicMock()
            install.state = Path(root)
            with patch.object(asa_manager, "doctor"), patch.object(asa_manager, "clean_checkout"), \
                    patch.object(asa_manager, "discover_release", return_value=release()), \
                    patch.object(asa_manager, "assert_ci", side_effect=Blocked("CI_BLOCKED", "red", "repair")), \
                    patch.object(asa_manager, "export_backup") as backup, self.assertRaises(Blocked):
                asa_manager.update(install)
            backup.assert_not_called()
            install.compose.assert_not_called()

    def test_previous_failed_switch_is_not_retried(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as root:
            install = MagicMock()
            install.state = Path(root)
            (install.state / "failed-switch.json").write_text("{}")
            with patch.object(asa_manager, "discover_release") as discover, self.assertRaises(Blocked):
                asa_manager.update(install)
            discover.assert_not_called()


if __name__ == "__main__":
    unittest.main()
