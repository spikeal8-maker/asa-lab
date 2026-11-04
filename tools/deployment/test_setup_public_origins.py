"""Explicit production loopback origin policy; only owned temporary fixtures."""

import base64
import copy
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import backup, system, setup_operation, paths
from deployment.contracts import Blocked, REGISTRY, SERVICES, inventory_files, read_env, verify_backup
from deployment.import_preflight import validate_import_archive
from deployment.setup_config import replace_legacy_manager_state, save_installed_release, save_private
from deployment.setup_operation import Runtime, Store
from deployment.system import Installation


HERE = Path(__file__).resolve().parent
OVERLAY = ".asa/public-origins.yaml"
MARKER = "ASA_SETUP_PUBLIC_ORIGINS"
MODE = "empty-overlay-v1"
CONTENTS = '{"services":{"api":{"environment":{"ASA_PUBLIC_WEB_ORIGINS":""}}}}\n'
IDENTITY = "c" * 32
UID = getattr(os, "geteuid", lambda: 0)()


class PublicOriginsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="asa-public-origins-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / ".asa").mkdir(mode=0o700)
        for name in ("compose.yaml", "compose.production.yaml"):
            shutil.copyfile(HERE.parents[1] / name, self.root / name)
        self.config = {
            "format": "asa-setup-config-v1", "installationId": IDENTITY,
            "root": str(self.root), "operatorUid": UID, "profile": "production",
            "project": "asa-lab-origin-fixture", "entryOrigin": "http://127.0.0.1:4910",
            "ports": {"web": 4910, "api": 4911, "blocks": 4913},
            "backup": {"policy": "best-effort", "cloud": {"enabled": False}},
        }
        self.values = {
            "COMPOSE_PROJECT_NAME": self.config["project"],
            "POSTGRES_PASSWORD": "synthetic-postgres", "ASA_APP_DB_PASSWORD": "synthetic-app",
            "POSTGRES_DB": "asalab", "POSTGRES_USER": "synthetic-owner",
            "MIGRATION_DATABASE_URL": "postgres://fixture:synthetic@postgres:5432/asalab",
            "CLASSROOM_CODE_SECRET": "synthetic-classroom-key-original-32bytes-long", "ASA_OBJECT_STORAGE_SECRET_KEY": "synthetic-object-key",
            "ASA_OBJECT_STORAGE_ACCESS_KEY": "synthetic-object-id", "ASA_OBJECT_STORAGE_ENDPOINT": "http://minio:9000",
            "ASA_OBJECT_STORAGE_BUCKET": "asa-blocks", "ASA_STUDENT_CODE_PROTECTION_MODE": "compat",
            "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON": json.dumps({"fixture": base64.b64encode(b"E" * 32).decode()}),
            "ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID": "fixture",
            "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON": json.dumps({"fixture": base64.b64encode(b"L" * 32).decode()}),
            "ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID": "fixture",
            "ASA_SEARCH_SECRET": "synthetic-search-key", "ASA_SETTINGS_ENCRYPTION_KEY": "synthetic-settings-key",
            "ASA_WEB_PORT": "4910", "ASA_API_PORT": "4911", "ASA_BLOCKS_PORT": "4913",
            "ASA_UPDATE_ENTRY_ORIGIN": self.config["entryOrigin"],
            "ASA_BLOCKS_PARENT_ORIGIN": self.config["entryOrigin"],
            "ASA_BLOCKS_RUNTIME_ORIGIN": self.config["entryOrigin"],
            "UNRELATED_PRIVATE_SETTING": "preserved",
        }
        self.save_environment()
        save_private(self.root / ".asa/setup.json", self.config)
        self.store = Store(self.root, IDENTITY)
        self.journal = self.store.create("install", self.config["project"])
        self.store.event(self.journal, "environment", "intent")
        self.inventory = {"complete": True, "containers": [], "volumes": [], "images": []}
        self.inventory_patch = patch("deployment.setup_operation.setup_discovery.docker_inventory", return_value=self.inventory)
        self.inventory_patch.start()
        self.addCleanup(self.inventory_patch.stop)
        self.process_patch = patch("deployment.system.run", side_effect=AssertionError("fixture must not execute Docker or a service"))
        self.process_patch.start()
        self.addCleanup(self.process_patch.stop)

    def save_environment(self):
        path = self.root / ".env"
        path.write_text("".join(f"{key}={value}\n" for key, value in self.values.items()), encoding="utf-8")
        path.chmod(0o600)

    def runtime(self):
        runtime = Runtime(self.root, self.config, intent="install")
        runtime.operation_id = self.journal["operationId"]
        return runtime

    def test_fresh_production_loopback_emits_literal_empty_overlay(self):
        before = read_env(self.root / ".env")
        runtime = self.runtime()
        runtime.environment()
        values = read_env(self.root / ".env")
        self.assertEqual(values.get("ASA_PUBLIC_WEB_ORIGINS"), "")
        self.assertEqual(values.get(MARKER), MODE)
        self.assertEqual((self.root / OVERLAY).read_text(), CONTENTS)
        self.assertEqual(runtime.install.files[-1], OVERLAY)
        self.assertEqual({key: values[key] for key in before}, before)

    def test_https_keeps_explicit_public_origins(self):
        self.config["entryOrigin"] = "https://school.example.test"
        public = "https://school.example.test,https://portal.example.test"
        self.values["ASA_PUBLIC_WEB_ORIGINS"] = public
        self.save_environment()
        save_private(self.root / ".asa/setup.json", self.config)
        runtime = self.runtime()
        runtime.environment()
        self.assertEqual(read_env(self.root / ".env")["ASA_PUBLIC_WEB_ORIGINS"], public)
        self.assertFalse((self.root / OVERLAY).exists())

    def test_unknown_overlay_rejected_before_private_environment_write(self):
        path = self.root / OVERLAY
        path.write_text("services: {}\n")
        path.chmod(0o600)
        before = (self.root / ".env").read_bytes()
        with self.assertRaises(Blocked):
            self.runtime().environment()
        self.assertEqual((self.root / ".env").read_bytes(), before)
        self.assertEqual(path.read_text(), "services: {}\n")

    def test_loopback_preserves_explicit_public_origins_without_an_overlay(self):
        self.values["ASA_PUBLIC_WEB_ORIGINS"] = "https://school.example.test,https://portal.example.test"
        self.save_environment()
        self.runtime().environment()
        self.assertEqual(read_env(self.root / ".env")["ASA_PUBLIC_WEB_ORIGINS"], self.values["ASA_PUBLIC_WEB_ORIGINS"])
        self.assertNotIn(MARKER, read_env(self.root / ".env"))
        self.assertFalse((self.root / OVERLAY).exists())

    def test_https_adds_only_the_selected_entry_and_keeps_existing_origins(self):
        self.config["entryOrigin"] = "https://school.example.test"
        self.values["ASA_PUBLIC_WEB_ORIGINS"] = "https://portal.example.test"
        self.save_environment()
        self.runtime().environment()
        self.assertEqual(read_env(self.root / ".env")["ASA_PUBLIC_WEB_ORIGINS"],
                         "https://portal.example.test,https://school.example.test")
        self.assertFalse((self.root / OVERLAY).exists())

    def test_exact_configured_loopback_port_is_required_before_writes(self):
        before = (self.root / ".env").read_bytes()
        for origin in ("http://127.0.0.1:4610", "http://localhost:4910", "http://127.0.0.2:4910", "http://school.example.test"):
            with self.subTest(origin=origin):
                self.config["entryOrigin"] = origin
                with self.assertRaises(Blocked) as caught:
                    self.runtime().environment()
                self.assertEqual(caught.exception.code, "PUBLIC_ORIGINS_ENTRY")
                self.assertEqual((self.root / ".env").read_bytes(), before)
                self.assertFalse((self.root / OVERLAY).exists())

    def test_invalid_public_lists_are_rejected_without_rewriting_private_settings(self):
        values = (",", " , , ", "http://school.example.test", "https://localhost:4910", "https://127.0.0.1:4910",
                  "https://school.example.test/path", "https://user:password@school.example.test", "https://school.example.test#fragment",
                  "https://school.example.test\\path", ",".join(f"https://school{number}.example.test" for number in range(9)))
        for public in values:
            with self.subTest(public=public):
                self.values["ASA_PUBLIC_WEB_ORIGINS"] = public
                self.save_environment()
                before = (self.root / ".env").read_bytes()
                with self.assertRaises(Blocked):
                    self.runtime().environment()
                self.assertEqual((self.root / ".env").read_bytes(), before)
                self.assertFalse((self.root / OVERLAY).exists())

    def test_fresh_overlay_requires_complete_empty_target_inventory(self):
        cases = (
            {"complete": False, "containers": [], "volumes": []},
            {"complete": True, "containers": []},
            {"complete": True, "containers": [{"labels": {"project": self.config["project"], "root": "/elsewhere"}}], "volumes": []},
            {"complete": True, "containers": [{"labels": {"project": "foreign", "root": str(self.root)}}], "volumes": []},
            {"complete": True, "containers": [], "volumes": [{"name": "other", "labels": {"project": self.config["project"]}}]},
            {"complete": True, "containers": [], "volumes": [{"name": self.config["project"] + "_postgres-data", "labels": {}}]},
        )
        before = (self.root / ".env").read_bytes()
        for inventory in cases:
            with self.subTest(inventory=inventory), patch("deployment.setup_operation.setup_discovery.docker_inventory", return_value=inventory):
                with self.assertRaises(Blocked):
                    self.runtime().environment()
                self.assertEqual((self.root / ".env").read_bytes(), before)
                self.assertFalse((self.root / OVERLAY).exists())

    def test_existing_installation_records_prevent_new_overlay(self):
        runtime = self.runtime()
        before = (self.root / ".env").read_bytes()
        for name in ("installation.json", "installed-release.json", "runtime-configuration.json", "maintenance.json"):
            with self.subTest(name=name):
                path = self.root / ".asa" / name
                path.write_text("{}\n")
                try:
                    with self.assertRaises(Blocked) as caught:
                        runtime.environment()
                    self.assertEqual(caught.exception.code, "PUBLIC_ORIGINS_EXISTING")
                    self.assertEqual((self.root / ".env").read_bytes(), before)
                    self.assertFalse((self.root / OVERLAY).exists())
                finally:
                    path.unlink()

    def test_non_install_or_non_environment_journal_cannot_change_identity(self):
        before = (self.root / ".env").read_bytes()
        for change in (lambda journal: journal.update(mode="update"),
                       lambda journal: journal.update(state="TERMINAL"),
                       lambda journal: journal["stages"].update(switch={"status": "intent"}),
                       lambda journal: journal["stages"]["environment"].update(status="done")):
            journal = copy.deepcopy(self.journal)
            change(journal)
            self.store.save(journal)
            with self.assertRaises(Blocked):
                self.runtime().environment()
            self.assertEqual((self.root / ".env").read_bytes(), before)
            self.assertFalse((self.root / OVERLAY).exists())

    def interrupt_before_marker(self):
        runtime = self.runtime()
        journal = self.store.read(self.journal["operationId"])
        runtime.guard(journal)
        self.store.save(journal)
        write = setup_operation.atomic_bytes

        def interrupted(path, content, **kwargs):
            if Path(path) == self.root / ".env":
                raise KeyboardInterrupt()
            return write(path, content, **kwargs)

        with patch.object(setup_operation, "atomic_bytes", side_effect=interrupted):
            with self.assertRaises(KeyboardInterrupt):
                runtime.environment()
        # Engine.finish sees the same journal object after an interruption.
        self.assertIn("publicOriginsEnvironment", journal)
        self.store.save(journal)
        return runtime

    def test_overlay_before_marker_interrupt_resumes_only_the_same_bound_operation(self):
        before = read_env(self.root / ".env")
        self.interrupt_before_marker()
        self.assertNotIn(MARKER, read_env(self.root / ".env"))
        overlay_before = (self.root / OVERLAY).stat()
        resumed = self.runtime()
        self.assertTrue(resumed.install.public_origins_pending)
        with self.assertRaises(Blocked) as caught:
            resumed.install.compose("up", "-d")
        self.assertEqual(caught.exception.code, "PUBLIC_ORIGINS_RECOVERY")
        resumed.environment()
        self.assertFalse(resumed.install.public_origins_pending)
        self.assertEqual(read_env(self.root / ".env")[MARKER], MODE)
        self.assertEqual({key: read_env(self.root / ".env")[key] for key in before}, before)
        self.assertEqual((self.root / OVERLAY).stat().st_ino, overlay_before.st_ino)

    def test_unbound_or_changed_interrupted_overlay_is_not_adopted(self):
        path = self.root / OVERLAY
        path.write_text(CONTENTS)
        path.chmod(0o600)
        before = (self.root / ".env").read_bytes()
        with self.assertRaises(Blocked) as caught:
            self.runtime()
        self.assertEqual(caught.exception.code, "PUBLIC_ORIGINS_RECOVERY")
        path.unlink()
        self.interrupt_before_marker()
        (self.root / ".env").write_bytes(before + b"UNEXPECTED_PRIVATE_SETTING=changed\n")
        altered = (self.root / ".env").read_bytes()
        with self.assertRaises(Blocked):
            self.runtime()
        self.assertEqual((self.root / ".env").read_bytes(), altered)

    def test_initial_environment_defaults_resume_with_selected_identity_without_regenerating_keys(self):
        (self.root / ".env").unlink()
        self.config["project"] = "school-fixture"
        save_private(self.root / ".asa/setup.json", self.config)
        self.journal["project"] = self.config["project"]
        self.store.save(self.journal)
        self.interrupt_before_marker()
        initial = read_env(self.root / ".env")
        self.assertEqual(initial["COMPOSE_PROJECT_NAME"], "asa-lab-dev")
        self.assertEqual(initial["ASA_WEB_PORT"], "4610")
        resumed = self.runtime()
        self.assertTrue(resumed.install.public_origins_pending)
        resumed.environment()
        after = read_env(self.root / ".env")
        self.assertEqual(after["COMPOSE_PROJECT_NAME"], self.config["project"])
        self.assertEqual(after["ASA_WEB_PORT"], "4910")
        self.assertEqual(after["ASA_UPDATE_ENTRY_ORIGIN"], self.config["entryOrigin"])
        for key in ("POSTGRES_PASSWORD", "ASA_APP_DB_PASSWORD", "CLASSROOM_CODE_SECRET",
                    "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON", "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON",
                    "ASA_OBJECT_STORAGE_SECRET_KEY", "ASA_SETTINGS_ENCRYPTION_KEY"):
            self.assertEqual(after[key], initial[key], key)

    def test_existing_empty_overlay_cannot_silently_change_to_https_entry(self):
        self.runtime().environment()
        before = (self.root / ".env").read_bytes()
        inode = (self.root / OVERLAY).stat().st_ino
        self.config["entryOrigin"] = "https://school.example.test"
        with self.assertRaises(Blocked) as caught:
            self.runtime().environment()
        self.assertEqual(caught.exception.code, "PUBLIC_ORIGINS_POLICY")
        self.assertEqual((self.root / ".env").read_bytes(), before)
        self.assertEqual((self.root / OVERLAY).stat().st_ino, inode)

    def test_interrupt_after_marker_is_idempotent_without_replacing_overlay_or_keys(self):
        runtime = self.runtime()
        with patch.object(runtime, "reload", side_effect=KeyboardInterrupt()):
            with self.assertRaises(KeyboardInterrupt):
                runtime.environment()
        before, inode = (self.root / ".env").read_bytes(), (self.root / OVERLAY).stat().st_ino
        resumed = self.runtime()
        self.assertFalse(resumed.install.public_origins_pending)
        resumed.environment()
        self.assertEqual((self.root / ".env").read_bytes(), before)
        self.assertEqual((self.root / OVERLAY).stat().st_ino, inode)

    def test_marker_without_overlay_blocks_without_recreating_keys_or_configuration(self):
        self.runtime().environment()
        before = (self.root / ".env").read_bytes()
        (self.root / OVERLAY).unlink()
        with self.assertRaises(Blocked) as caught:
            self.runtime()
        self.assertEqual(caught.exception.code, "PUBLIC_ORIGINS_MISSING")
        self.assertEqual((self.root / ".env").read_bytes(), before)
        self.assertFalse((self.root / OVERLAY).exists())

    def test_known_overlay_does_not_override_an_existing_public_list_or_changed_entry(self):
        self.runtime().environment()
        saved = read_env(self.root / ".env")
        for changes in ({"ASA_PUBLIC_WEB_ORIGINS": "https://school.example.test"},
                        {"ASA_UPDATE_ENTRY_ORIGIN": "http://127.0.0.1:4610"},
                        {MARKER: "unknown-v2"}):
            self.values = {**saved, **changes}
            self.save_environment()
            before = (self.root / ".env").read_bytes()
            with self.assertRaises(Blocked):
                Installation(self.root, "production")
            self.assertEqual((self.root / ".env").read_bytes(), before)

    @unittest.skipUnless(os.name == "posix", "POSIX permissions and links")
    def test_overlay_permissions_symlinks_and_hardlinks_are_rejected(self):
        self.runtime().environment()
        path = self.root / OVERLAY
        path.chmod(0o644)
        with self.assertRaises(Blocked):
            Installation(self.root, "production")
        path.chmod(0o600)
        alias = self.root / "overlay-alias"
        os.link(path, alias)
        with self.assertRaises(Blocked):
            Installation(self.root, "production")
        alias.unlink()
        path.rename(alias)
        path.symlink_to(alias)
        with self.assertRaises(Blocked):
            Installation(self.root, "production")
        self.assertEqual(alias.read_text(), CONTENTS)

    def test_snapshot_completeness_is_checked_before_replacement_or_backup_reader(self):
        runtime = self.runtime()
        runtime.environment()
        complete = {"revision": "a" * 40, "files": {name: (self.root / name).read_text() for name in runtime.install.files}}
        replace_legacy_manager_state(self.root, "runtime-configuration.json", complete)
        path = self.root / ".asa/runtime-configuration.json"
        before = path.read_bytes()
        incomplete = copy.deepcopy(complete)
        incomplete["files"].pop(OVERLAY)
        with self.assertRaises(Blocked):
            replace_legacy_manager_state(self.root, "runtime-configuration.json", incomplete)
        self.assertEqual(path.read_bytes(), before)
        path.write_text(json.dumps(incomplete))
        with self.assertRaises(Blocked) as caught:
            Installation(self.root, "production")
        self.assertEqual(caught.exception.code, "PUBLIC_ORIGINS_SNAPSHOT")

    def release(self, name):
        pin = json.loads((HERE / "fixtures/setup-realhost-pins.json").read_text())[name]
        return {"format": "asa-deployment-v2", "repository": "spikeal8-maker/asa-lab", "revision": pin["revision"],
                "schema": pin["schema"], "platform": "linux/amd64", "publicationRunId": pin["publicationRunId"],
                "images": {service: f"{REGISTRY}/{service}@sha256:" + "e" * 64 for service in SERVICES}}

    def archive(self, runtime, release):
        archive = self.root / "backup-fixture"
        archive.mkdir()
        (archive / "configuration").mkdir(mode=0o700)
        recovery = backup.recovery_configuration(runtime.install, {"revision": release["revision"], "schema": release["schema"]})
        backup.write_recovery_compose_files(archive / "configuration", recovery, runtime.install.files)
        (archive / "private.env").write_bytes((self.root / ".env").read_bytes())
        (archive / "database.dump").write_bytes(b"synthetic postgresql custom format fixture")
        (archive / "globals.sql").write_text("-- synthetic role fixture\n")
        objects = archive / "objects/asa-blocks/fixture"
        objects.mkdir(parents=True)
        (objects / "xl.meta").write_bytes(b"synthetic object fixture")
        (archive / "configuration/runtime-configuration.json").write_text(json.dumps(recovery))
        (archive / "configuration/installed-release.json").write_text(json.dumps(release))
        manifest = {"format": "asa-backup-v1", "complete": True, "runtime": {"revision": release["revision"], "schema": release["schema"]},
                    "project": self.config["project"], "profile": "production"}
        self.reinventory(archive, manifest)
        return archive, recovery, manifest

    def reinventory(self, archive, manifest):
        manifest["files"] = inventory_files(archive)
        (archive / "manifest.json").write_text(json.dumps(manifest))

    def test_previous_current_update_and_retry_keep_overlay_in_actual_backup_import_chain(self):
        runtime = self.runtime()
        runtime.environment()
        previous, current = self.release("previous"), self.release("current")
        save_installed_release(self.root, previous)
        old = backup.recovery_configuration(runtime.install, {"revision": previous["revision"]})
        replace_legacy_manager_state(self.root, "runtime-configuration.json", old)
        before, inode = (self.root / ".env").read_bytes(), (self.root / OVERLAY).stat().st_ino
        self.assertEqual(backup.recovery_configuration(runtime.install, {"revision": previous["revision"]}), old)
        archive, recovery, manifest = self.archive(runtime, previous)
        self.assertEqual(recovery["files"][OVERLAY], CONTENTS)
        self.assertEqual((archive / "configuration" / OVERLAY).read_text(), CONTENTS)
        self.assertTrue(verify_backup(archive)["complete"])
        proof = validate_import_archive(archive)
        self.assertEqual(proof["status"], "ARCHIVE_VERIFIED_NO_IMPORT")
        self.assertEqual(proof["composeFileCount"], 3)
        self.assertFalse(proof["writesPerformed"])
        self.assertNotIn("synthetic", json.dumps(proof))
        save_installed_release(self.root, current)
        updated = Installation(self.root, "production")
        new = backup.recovery_configuration(updated, {"revision": current["revision"]})
        replace_legacy_manager_state(self.root, "runtime-configuration.json", new)
        self.assertEqual(new["files"][OVERLAY], CONTENTS)
        self.assertEqual(Installation(self.root, "production").files, runtime.install.files)
        self.assertEqual(backup.recovery_configuration(updated, {"revision": current["revision"]}), new)
        self.assertEqual((self.root / ".env").read_bytes(), before)
        self.assertEqual((self.root / OVERLAY).stat().st_ino, inode)

    def test_import_rejects_missing_changed_unbound_and_unknown_origin_configuration(self):
        runtime = self.runtime()
        runtime.environment()
        previous = self.release("previous")
        save_installed_release(self.root, previous)
        archive, recovery, manifest = self.archive(runtime, previous)
        record = archive / "configuration/runtime-configuration.json"
        original_env = (archive / "private.env").read_bytes()
        for change in ("missing", "changed", "unknown", "unbound", "bytes"):
            with self.subTest(change=change):
                edited = copy.deepcopy(recovery)
                (archive / "private.env").write_bytes(original_env)
                (archive / "configuration" / OVERLAY).write_text(CONTENTS)
                if change == "missing":
                    edited["files"].pop(OVERLAY)
                elif change == "changed":
                    edited["files"][OVERLAY] = '{"services":{"api":{"environment":{"ASA_PUBLIC_WEB_ORIGINS":"https://foreign.example.test"}}}}\n'
                    (archive / "configuration" / OVERLAY).write_text(edited["files"][OVERLAY])
                elif change == "unknown":
                    edited["files"][".asa/unknown.yaml"] = "services: {}\n"
                    (archive / "configuration/.asa/unknown.yaml").write_text("services: {}\n")
                elif change == "unbound":
                    (archive / "private.env").write_bytes(original_env.replace((MARKER + "=" + MODE + "\n").encode(), b""))
                else:
                    (archive / "configuration" / OVERLAY).write_text(CONTENTS + "# changed\n")
                record.write_text(json.dumps(edited))
                self.reinventory(archive, manifest)
                with self.assertRaises(Blocked):
                    validate_import_archive(archive)

    def test_import_accepts_exact_windows_crlf_overlay_without_relaxing_content(self):
        runtime = self.runtime()
        runtime.environment()
        previous = self.release("previous")
        save_installed_release(self.root, previous)
        archive, recovery, manifest = self.archive(runtime, previous)
        (archive / "configuration" / OVERLAY).write_bytes(CONTENTS.replace("\n", "\r\n").encode())
        self.reinventory(archive, manifest)
        self.assertEqual(validate_import_archive(archive)["status"], "ARCHIVE_VERIFIED_NO_IMPORT")

    def test_windows_reader_boundary_does_not_require_posix_uid_apis(self):
        self.runtime().environment()
        facade = SimpleNamespace(name="nt", environ=os.environ, open=os.open, fdopen=os.fdopen, fstat=os.fstat, O_RDONLY=os.O_RDONLY)
        with patch.object(system, "os", facade):
            self.assertIn(OVERLAY, Installation(self.root, "production").files)

    def test_windows_reparse_boundary_stays_fail_closed(self):
        self.runtime().environment()
        original = Path.lstat

        def metadata(path, *args, **kwargs):
            info = original(path, *args, **kwargs)
            fields = {name: getattr(info, name) for name in dir(info) if name.startswith("st_")}
            fields["st_file_attributes"] = 0x400 if path == self.root / OVERLAY else 0
            return SimpleNamespace(**fields)

        with patch.object(paths, "os", SimpleNamespace(name="nt", path=os.path)), patch.object(Path, "lstat", metadata):
            with self.assertRaises(Blocked) as caught:
                Installation(self.root, "production")
        self.assertEqual(caught.exception.code, "PUBLIC_ORIGINS_PATH")


@unittest.skipUnless(os.name == "posix", "Realhost diagnostics are Linux-only")
class HarnessPublicOriginsTests(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, str(HERE))
        import ci_setup_realhost
        self.harness = ci_setup_realhost

    def test_native_assertion_reads_compose_and_bound_api_without_exporting_environment(self):
        install = SimpleNamespace(env={MARKER: MODE, "ASA_PUBLIC_WEB_ORIGINS": ""},
            compose=Mock(return_value=json.dumps({"services": {"api": {"environment": {"ASA_PUBLIC_WEB_ORIGINS": "", "PRIVATE": "synthetic-private"}}}})),
            identity=Mock(return_value={"api": {"id": "bound-api"}}),
            container_environment=Mock(return_value={"ASA_PUBLIC_WEB_ORIGINS": "", "PRIVATE": "synthetic-private"}))
        self.assertEqual(self.harness.require_empty_public_origins(install), {"status": "PASS", "additionalPublicOrigins": 0})
        install.compose.assert_called_once_with("config", "--format", "json", capture=True, timeout=30)
        install.container_environment.assert_called_once_with({"id": "bound-api"})
        for stage in ("resolved", "container"):
            with self.subTest(stage=stage):
                if stage == "resolved":
                    install.compose.return_value = json.dumps({"services": {"api": {"environment": {"ASA_PUBLIC_WEB_ORIGINS": "https://asa-lab.ru"}}}})
                else:
                    install.compose.return_value = json.dumps({"services": {"api": {"environment": {"ASA_PUBLIC_WEB_ORIGINS": ""}}}})
                    install.container_environment.return_value = {}
                with self.assertRaises(self.harness.Failure):
                    self.harness.require_empty_public_origins(install)

    def test_native_expected_compose_identity_includes_only_known_origin_overlay(self):
        with tempfile.TemporaryDirectory(prefix="asa-origin-native-") as directory:
            root = Path(directory)
            (root / ".asa").mkdir(mode=0o700)
            path = root / OVERLAY
            path.write_text(CONTENTS)
            path.chmod(0o600)
            with patch.object(self.harness, "INSTALL_ROOT", root):
                self.assertEqual(self.harness.switch_expected_files({"profile": "production"}, UID),
                                 [str(root / name) for name in ("compose.yaml", "compose.production.yaml", OVERLAY)])
                path.write_text("services: {}\n")
                with self.assertRaises(self.harness.Failure):
                    self.harness.switch_expected_files({"profile": "production"}, UID)


if __name__ == "__main__":
    unittest.main()
