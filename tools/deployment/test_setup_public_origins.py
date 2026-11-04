"""Explicit production loopback origin policy; only owned temporary fixtures."""

import base64
from contextlib import ExitStack, contextmanager, redirect_stdout
import copy
import hashlib
import io
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
import asa_cli
import asa_setup
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
        self.root = Path(temporary.name).resolve()
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

    def test_fixture_resolves_a_directory_alias_before_private_identity_is_written(self):
        with tempfile.TemporaryDirectory(prefix="asa-origin-alias-") as temporary:
            base = Path(temporary).resolve()
            (base / "walk").mkdir()
            canonical = base / "canonical"
            canonical.mkdir()
            alias = base / "walk/../canonical"
            fixture = PublicOriginsTests("test_fresh_production_loopback_emits_literal_empty_overlay")
            owned = SimpleNamespace(name=str(alias), cleanup=lambda: None)
            try:
                with patch.object(tempfile, "TemporaryDirectory", return_value=owned):
                    fixture.setUp()
                self.assertEqual(fixture.root, canonical.resolve())
                self.assertEqual(fixture.config["root"], str(fixture.root))
                self.assertEqual(fixture.runtime().install.root, fixture.root)
                fixture.interrupt_before_marker()
                resumed = fixture.runtime()
                self.assertTrue(resumed.install.public_origins_pending)
                resumed.environment()
                self.assertEqual(resumed.install.root, fixture.root)
            finally:
                fixture.doCleanups()

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
        save_private(self.root / ".asa/setup.json", self.config)
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

    def engine_adapters(self, runtime):
        stack = ExitStack()
        release = self.release("previous")
        for name, value in (("progress", None), ("preflight", {"status": "OK"}), ("select", release),
                            ("source", {"revision": release["revision"]}), ("verify_source", None), ("handoff", None)):
            stack.enter_context(patch.object(runtime, name, return_value=value))
        return stack

    def engine_interrupt_before_marker(self, project):
        (self.root / ".env").unlink()
        self.config["project"] = project
        save_private(self.root / ".asa/setup.json", self.config)
        self.journal["project"] = project
        self.store.save(self.journal)
        runtime = self.runtime()
        write = setup_operation.atomic_bytes

        def interrupted(path, content, **kwargs):
            if Path(path) == self.root / ".env":
                raise KeyboardInterrupt()
            return write(path, content, **kwargs)

        with self.engine_adapters(runtime), patch.object(setup_operation, "atomic_bytes", side_effect=interrupted):
            first = setup_operation.Engine(runtime, self.store).execute(self.journal)
        saved = self.store.read(self.journal["operationId"])
        self.assertEqual((first["outcome"], first["exitCode"]), ("INTERRUPTED", 130))
        self.assertEqual(saved["state"], "RUNNING")
        self.assertEqual(saved["stages"]["environment"]["status"], "intent")
        self.assertIn("publicOriginsEnvironment", saved)
        self.assertNotIn(MARKER, read_env(self.root / ".env"))
        return saved

    def assert_engine_environment_resume(self, project):
        saved = self.engine_interrupt_before_marker(project)
        initial = read_env(self.root / ".env")
        inode = (self.root / OVERLAY).stat().st_ino
        binding = copy.deepcopy(saved["publicOriginsEnvironment"])
        self.assertEqual(initial["COMPOSE_PROJECT_NAME"], "asa-lab-dev")
        self.assertEqual(initial["ASA_WEB_PORT"], "4610")
        resumed = self.runtime()
        self.assertTrue(resumed.install.public_origins_pending)
        with self.engine_adapters(resumed), patch.object(resumed, "settings", side_effect=KeyboardInterrupt()):
            second = setup_operation.Engine(resumed, self.store).execute(saved, resume=True)
        self.assertEqual((second["outcome"], second["exitCode"]), ("INTERRUPTED", 130))
        final = self.store.read(saved["operationId"])
        self.assertEqual(final["stages"]["environment"]["status"], "done")
        self.assertEqual(final["stages"]["settings"]["status"], "intent")
        self.assertEqual(final["publicOriginsEnvironment"], binding)
        for key in ("operationId", "installationId", "root", "project"):
            self.assertEqual(final[key], saved[key], key)
        self.assertEqual((self.root / OVERLAY).stat().st_ino, inode)
        self.assertFalse(resumed.install.public_origins_pending)
        after = read_env(self.root / ".env")
        self.assertEqual(after[MARKER], MODE)
        self.assertEqual(after["COMPOSE_PROJECT_NAME"], self.config["project"])
        self.assertEqual(after["ASA_WEB_PORT"], "4910")
        self.assertEqual(after["ASA_UPDATE_ENTRY_ORIGIN"], self.config["entryOrigin"])
        for key in ("POSTGRES_PASSWORD", "ASA_APP_DB_PASSWORD", "CLASSROOM_CODE_SECRET",
                    "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON", "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON",
                    "ASA_OBJECT_STORAGE_SECRET_KEY", "ASA_SETTINGS_ENCRYPTION_KEY"):
            self.assertEqual(after[key], initial[key], key)

    def test_initial_environment_defaults_resume_with_selected_identity_without_regenerating_keys(self):
        self.assert_engine_environment_resume("school-fixture")

    def test_engine_default_project_resume_still_completes_the_bound_environment(self):
        self.assert_engine_environment_resume("asa-lab-dev")

    def assert_engine_guard_blocks(self, runtime, journal):
        watched = [self.root / name for name in (".env", OVERLAY, ".asa/setup.json")]
        watched.append(self.store.path(self.journal["operationId"]))
        before = {path: (path.read_bytes(), path.stat().st_ino) if path.exists() else None for path in watched}
        with self.engine_adapters(runtime), patch.object(runtime, "environment", wraps=runtime.environment) as environment:
            with self.assertRaises(Blocked) as caught:
                setup_operation.Engine(runtime, self.store).execute(journal, resume=True)
            environment.assert_not_called()
        for path, original in before.items():
            self.assertEqual((path.read_bytes(), path.stat().st_ino) if path.exists() else None, original, str(path))
        return caught.exception.code

    def test_engine_preimage_recovery_rejects_changed_journal_or_stale_caller(self):
        saved = self.engine_interrupt_before_marker("school-fixture")
        cases = (
            ("root", lambda journal: journal.update(root=str(self.root / "foreign"))),
            ("installation", lambda journal: journal.update(installationId="d" * 32)),
            ("project", lambda journal: journal.update(project="other-school")),
            ("mode", lambda journal: journal.update(mode="update")),
            ("state", lambda journal: journal.update(state="TERMINAL")),
            ("phase", lambda journal: journal.update(phase="settings")),
            ("stage", lambda journal: journal["stages"]["environment"].update(status="done")),
            ("switch", lambda journal: journal["stages"].update(switch={"status": "intent"})),
            ("binding", lambda journal: journal.pop("publicOriginsEnvironment")),
            ("before_hash", lambda journal: journal["publicOriginsEnvironment"].update(beforeSha256="0" * 64)),
            ("after_hash", lambda journal: journal["publicOriginsEnvironment"].update(afterSha256="0" * 64)),
        )
        for name, change in cases:
            with self.subTest(change=name):
                save_private(self.store.path(saved["operationId"]), saved)
                runtime = self.runtime()
                changed = copy.deepcopy(saved)
                change(changed)
                save_private(self.store.path(saved["operationId"]), changed)
                self.assert_engine_guard_blocks(runtime, changed)
        save_private(self.store.path(saved["operationId"]), saved)
        runtime = self.runtime()
        stale = copy.deepcopy(saved)
        stale["updatedAt"] = "2000-01-01T00:00:00Z"
        self.assert_engine_guard_blocks(runtime, stale)

    def test_engine_preimage_recovery_rechecks_environment_overlay_and_target_configuration(self):
        saved = self.engine_interrupt_before_marker("school-fixture")
        env_path, overlay = self.root / ".env", self.root / OVERLAY
        original_env, original_config = env_path.read_bytes(), copy.deepcopy(self.config)
        for change in ("environment", "marker", "overlay", "missing_overlay", "target_port", "private_project"):
            with self.subTest(change=change):
                env_path.write_bytes(original_env)
                overlay.write_text(CONTENTS)
                overlay.chmod(0o600)
                self.config.clear()
                self.config.update(copy.deepcopy(original_config))
                save_private(self.root / ".asa/setup.json", self.config)
                runtime = self.runtime()
                if change == "environment":
                    env_path.write_bytes(original_env + b"UNEXPECTED_PRIVATE_SETTING=changed\n")
                elif change == "marker":
                    env_path.write_bytes(original_env + (MARKER + "=" + MODE + "\n").encode())
                elif change == "overlay":
                    overlay.write_text(CONTENTS + "# altered\n")
                elif change == "missing_overlay":
                    overlay.unlink()
                elif change == "target_port":
                    self.config["ports"]["web"] = 4912
                    self.config["entryOrigin"] = "http://127.0.0.1:4912"
                    save_private(self.root / ".asa/setup.json", self.config)
                else:
                    save_private(self.root / ".asa/setup.json", {**self.config, "project": "other-school"})
                self.assert_engine_guard_blocks(runtime, copy.deepcopy(saved))

    def test_engine_preimage_recovery_does_not_adopt_existing_resources_or_state(self):
        saved = self.engine_interrupt_before_marker("school-fixture")
        for project in ("school-fixture", "asa-lab-dev"):
            container = {"id": "d" * 64, "image": "postgres:17", "running": False,
                         "labels": {"project": project, "root": str(self.root / "other"), "service": "postgres"}}
            variants = (
                {**self.inventory, "containers": [container]},
                {**self.inventory, "containers": [{**container, "labels": {"project": "foreign", "root": str(self.root)}}]},
                {**self.inventory, "volumes": [{"name": "owned-data", "labels": {"project": project}}]},
                {**self.inventory, "volumes": [{"name": project + "_postgres-data", "labels": {}}]},
            )
            for index, inventory in enumerate(variants):
                with self.subTest(project=project, variant=index):
                    runtime = self.runtime()
                    with patch("deployment.setup_operation.setup_discovery.docker_inventory", return_value=inventory):
                        self.assert_engine_guard_blocks(runtime, copy.deepcopy(saved))
        with patch("deployment.setup_operation.setup_discovery.docker_inventory", return_value={**self.inventory, "complete": False}):
            self.assert_engine_guard_blocks(self.runtime(), copy.deepcopy(saved))
        for name in ("installation.json", "installed-release.json", "runtime-configuration.json", "maintenance.json",
                     "failed-switch.json", "atomic-active.json", "last-operation.json"):
            with self.subTest(marker=name):
                runtime = self.runtime()
                path = self.root / ".asa" / name
                path.write_text("{}\n")
                try:
                    self.assert_engine_guard_blocks(runtime, copy.deepcopy(saved))
                finally:
                    path.unlink()
        runtime = self.runtime()
        (self.root / "backups").mkdir()
        (self.root / "backups/retained-copy").write_text("preserved\n")
        self.assert_engine_guard_blocks(runtime, copy.deepcopy(saved))

    def test_engine_ordinary_project_drift_still_fails_without_an_authenticated_preimage(self):
        self.config["project"] = "school-fixture"
        save_private(self.root / ".asa/setup.json", self.config)
        self.journal["project"] = self.config["project"]
        self.store.save(self.journal)
        runtime = self.runtime()
        observed = runtime.discovery(self.journal)
        self.assertEqual((observed["state"], observed["reasons"][0]["code"]), ("PARTIAL", "PROJECT_DRIFT"))
        self.assertEqual(self.assert_engine_guard_blocks(runtime, self.journal), "OPERATION_INTENT")

    def public_install_args(self, *, operation_id=None):
        words = ["install", "--root", str(self.root), "--non-interactive", "--json"]
        if operation_id:
            words += ["--operation-id", operation_id]
        options = asa_cli.command_parser().parse_intermixed_args(words)
        # Only the external privilege/launcher boundary is replaced. Its
        # real argv builder feeds the real setup parser and executor below.
        root_os = SimpleNamespace(**vars(os))
        root_os.geteuid = lambda: 0
        with patch.object(asa_cli, "os", root_os), patch.object(asa_cli, "verified_bundle", return_value={}), \
                patch.object(asa_cli, "run_reduced", return_value=0) as launch:
            asa_cli.run_linux("install", {"root": str(self.root), "bundle": str(HERE.parents[1])}, options)
        command = launch.call_args.args[0]
        self.assertEqual(command[4], "auto")
        args = asa_setup.parser().parse_args(command[4:])
        self.assertEqual(args.intent, "install")
        self.assertEqual(args.operation_id, operation_id)
        return args

    def public_install_adapters(self):
        stack = ExitStack()
        # Model the external non-root owner gate without changing the real
        # UID used by private-file/journal/lock checks on this owned fixture.
        operator_os = SimpleNamespace(**vars(os))
        operator_os.geteuid = lambda: UID or 1
        stack.enter_context(patch.object(asa_setup, "os", operator_os))
        stack.enter_context(patch.object(asa_setup.setup_host, "check_owner", return_value={"uid": UID}))
        release = self.release("previous")
        for name, value in (("progress", None), ("preflight", {"status": "OK"}), ("select", release),
                            ("source", {"revision": release["revision"]}), ("verify_source", None), ("handoff", None)):
            stack.enter_context(patch.object(Runtime, name, return_value=value))
        stack.enter_context(redirect_stdout(io.StringIO()))
        return stack

    def prepare_public_install(self, *, project="school-fixture", profile="production", origin=None):
        (self.root / ".env").unlink()
        self.config["project"] = project
        self.config["profile"] = profile
        if origin is not None:
            self.config["entryOrigin"] = origin
        if profile != "base":
            shutil.copyfile(HERE.parents[1] / ("compose." + profile + ".yaml"), self.root / ("compose." + profile + ".yaml"))
        self.config["onboardingFile"] = str(self.root / ".asa/onboarding.json")
        save_private(self.root / ".asa/setup.json", self.config)
        save_private(Path(self.config["onboardingFile"]), {
            "format": "asa-owner-onboarding-v1", "installationId": IDENTITY,
            "email": "fixture@example.test", "accountId": "synthetic-existing-owner"})
        self.journal["project"] = self.config["project"]
        self.journal["stages"], self.journal["events"] = {}, []
        self.store.event(self.journal, "configured", "done")

    def public_install_interrupt_environment(self, *, project="school-fixture", after_marker=False):
        self.prepare_public_install(project=project)
        write = setup_operation.atomic_bytes

        def interrupted(path, content, **kwargs):
            if Path(path) == self.root / ".env":
                raise KeyboardInterrupt()
            return write(path, content, **kwargs)

        args = self.public_install_args()
        with self.public_install_adapters(), ExitStack() as interruption:
            if after_marker:
                interruption.enter_context(patch.object(Runtime, "reload", side_effect=KeyboardInterrupt()))
            else:
                interruption.enter_context(patch.object(setup_operation, "atomic_bytes", side_effect=interrupted))
            self.assertEqual(asa_setup.execute(args), 130)
        saved = self.store.read(self.journal["operationId"])
        self.assertEqual(saved["state"], "RUNNING")
        self.assertEqual(saved["stages"]["environment"]["status"], "intent")
        self.assertEqual(read_env(self.root / ".env").get(MARKER), MODE if after_marker else None)
        self.assertFalse((self.root / ".asa/installation.json").exists())
        return saved

    def public_install_until_settings(self, *, profile="production", origin=None):
        self.prepare_public_install(profile=profile, origin=origin)
        args = self.public_install_args()
        with self.public_install_adapters(), patch.object(Runtime, "settings", side_effect=KeyboardInterrupt()):
            self.assertEqual(asa_setup.execute(args), 130)
        saved = self.store.read(self.journal["operationId"])
        self.assertEqual(saved["state"], "RUNNING")
        self.assertEqual(saved["stages"]["environment"]["status"], "done")
        self.assertEqual(saved["stages"]["settings"]["status"], "intent")
        return saved

    def empty_docker_read(self, arguments, **kwargs):
        self.assertEqual(arguments, ["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project"])
        self.assertEqual(kwargs, {"capture": True})
        return ""

    def assert_new_profile_continuation(self, profile):
        saved = self.public_install_until_settings(profile=profile, origin="https://school.example.test")
        before = ((self.root / ".env").read_bytes(), (self.root / ".env").stat().st_ino)
        args = self.public_install_args(operation_id=saved["operationId"])
        with self.public_install_adapters(), patch.object(system, "run", side_effect=self.empty_docker_read) as reads, \
                patch.object(Runtime, "images", side_effect=KeyboardInterrupt()) as unfinished, \
                patch.object(asa_setup, "replace_legacy_manager_state", wraps=asa_setup.replace_legacy_manager_state) as adopt:
            self.assertEqual(asa_setup.execute(args), 130)
            unfinished.assert_called_once()
            reads.assert_not_called()
            adopt.assert_not_called()
        final = self.store.read(saved["operationId"])
        self.assertEqual(final["stages"]["settings"]["status"], "done")
        self.assertEqual(final["stages"]["images"]["status"], "intent")
        self.assertEqual(final["installEnvironment"], saved["installEnvironment"])
        self.assertEqual(final["installEnvironment"]["format"], setup_operation.ENVIRONMENT_FORMAT)
        self.assertEqual(final["installEnvironment"]["afterSha256"], hashlib.sha256(before[0]).hexdigest())
        self.assertNotIn("publicOriginsEnvironment", final)
        self.assertEqual(((self.root / ".env").read_bytes(), (self.root / ".env").stat().st_ino), before)
        self.assertEqual(read_env(self.root / ".env")["ASA_PUBLIC_WEB_ORIGINS"], "https://school.example.test")
        self.assertNotIn(MARKER, read_env(self.root / ".env"))
        self.assertFalse((self.root / OVERLAY).exists())
        settings = json.loads((self.root / ".asa/installation.json").read_text())
        self.assertEqual((settings["instanceId"], settings["project"], settings["profile"]),
                         (IDENTITY, self.config["project"], profile))

    def test_new_https_production_install_has_a_bound_public_resume(self):
        self.assert_new_profile_continuation("production")

    def test_new_dev_install_has_a_bound_public_resume(self):
        self.assert_new_profile_continuation("dev")

    def test_new_staging_install_has_a_bound_public_resume(self):
        self.assert_new_profile_continuation("staging")

    def test_new_base_install_has_a_bound_public_resume(self):
        self.assert_new_profile_continuation("base")

    def assert_public_https_environment_resume(self, *, after_write):
        self.prepare_public_install(origin="https://school.example.test")
        write = setup_operation.atomic_bytes

        def interrupted(path, content, **kwargs):
            if Path(path) == self.root / ".env":
                raise KeyboardInterrupt()
            return write(path, content, **kwargs)

        with self.public_install_adapters(), ExitStack() as interruption:
            if after_write:
                interruption.enter_context(patch.object(Runtime, "reload", side_effect=KeyboardInterrupt()))
            else:
                interruption.enter_context(patch.object(setup_operation, "atomic_bytes", side_effect=interrupted))
            self.assertEqual(asa_setup.execute(self.public_install_args()), 130)
        saved = self.store.read(self.journal["operationId"])
        self.assertEqual(saved["stages"]["environment"]["status"], "intent")
        before = read_env(self.root / ".env")
        self.assertEqual(before["COMPOSE_PROJECT_NAME"], "school-fixture" if after_write else "asa-lab-dev")
        with self.public_install_adapters(), patch.object(system, "run", side_effect=self.empty_docker_read) as reads, \
                patch.object(Runtime, "settings", side_effect=KeyboardInterrupt()) as unfinished, \
                patch.object(asa_setup, "replace_legacy_manager_state", wraps=asa_setup.replace_legacy_manager_state) as adopt:
            self.assertEqual(asa_setup.execute(self.public_install_args(operation_id=saved["operationId"])), 130)
            unfinished.assert_called_once()
            reads.assert_not_called()
            adopt.assert_not_called()
        after, final = read_env(self.root / ".env"), self.store.read(saved["operationId"])
        self.assertEqual(final["stages"]["environment"]["status"], "done")
        for key in ("operationId", "installationId", "root", "project", "installEnvironment"):
            self.assertEqual(final[key], saved[key], key)
        for key in ("POSTGRES_PASSWORD", "ASA_APP_DB_PASSWORD", "CLASSROOM_CODE_SECRET",
                    "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON", "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON",
                    "ASA_OBJECT_STORAGE_SECRET_KEY", "ASA_SETTINGS_ENCRYPTION_KEY"):
            self.assertEqual(after[key], before[key], key)
        self.assertEqual(after["COMPOSE_PROJECT_NAME"], "school-fixture")
        self.assertEqual(after["ASA_PUBLIC_WEB_ORIGINS"], "https://school.example.test")
        self.assertEqual(final["installEnvironment"]["afterSha256"], hashlib.sha256((self.root / ".env").read_bytes()).hexdigest())
        self.assertNotIn(MARKER, after)
        self.assertFalse((self.root / OVERLAY).exists())
        self.assertFalse((self.root / ".asa/installation.json").exists())

    def test_public_https_resume_replays_its_bound_environment_preimage(self):
        self.assert_public_https_environment_resume(after_write=False)

    def test_public_https_resume_replays_its_bound_environment_afterimage(self):
        self.assert_public_https_environment_resume(after_write=True)

    def assert_public_install_environment_resume(self, *, project="school-fixture", after_marker=False):
        saved = self.public_install_interrupt_environment(project=project, after_marker=after_marker)
        initial, inode = read_env(self.root / ".env"), (self.root / OVERLAY).stat().st_ino
        args = self.public_install_args(operation_id=saved["operationId"])
        with self.public_install_adapters(), patch.object(Runtime, "settings", side_effect=KeyboardInterrupt()), \
                patch.object(asa_setup, "replace_legacy_manager_state", wraps=asa_setup.replace_legacy_manager_state) as adopt:
            self.assertEqual(asa_setup.execute(args), 130)
            adopt.assert_not_called()
        after, final = read_env(self.root / ".env"), self.store.read(saved["operationId"])
        self.assertEqual(after[MARKER], MODE)
        self.assertEqual(after["COMPOSE_PROJECT_NAME"], project)
        self.assertEqual(after["ASA_WEB_PORT"], "4910")
        self.assertEqual(final["stages"]["environment"]["status"], "done")
        self.assertEqual(final["stages"]["settings"]["status"], "intent")
        for key in ("operationId", "installationId", "root", "project", "publicOriginsEnvironment"):
            self.assertEqual(final[key], saved[key], key)
        for key in ("POSTGRES_PASSWORD", "ASA_APP_DB_PASSWORD", "CLASSROOM_CODE_SECRET",
                    "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON", "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON",
                    "ASA_OBJECT_STORAGE_SECRET_KEY", "ASA_SETTINGS_ENCRYPTION_KEY"):
            self.assertEqual(after[key], initial[key], key)
        self.assertEqual((self.root / OVERLAY).stat().st_ino, inode)
        self.assertFalse((self.root / ".asa/installation.json").exists())

    @unittest.skipUnless(os.name == "posix", "Linux setup CLI")
    def test_public_install_argv_resumes_custom_environment_through_real_execute_without_adoption(self):
        self.assert_public_install_environment_resume()

    @unittest.skipUnless(os.name == "posix", "Linux setup CLI")
    def test_public_install_resumes_environment_after_marker_without_adoption(self):
        self.assert_public_install_environment_resume(after_marker=True)

    @unittest.skipUnless(os.name == "posix", "Linux setup CLI")
    def test_public_install_default_project_still_resumes_before_marker_without_adoption(self):
        self.assert_public_install_environment_resume(project="asa-lab-dev")

    def test_public_install_second_resume_reaches_first_unfinished_stage_without_adoption(self):
        self.assert_public_install_environment_resume()
        saved = self.store.read(self.journal["operationId"])
        self.assertEqual(saved["stages"]["environment"]["status"], "done")
        self.assertEqual(saved["stages"]["settings"]["status"], "intent")
        preserved = {self.root / name: ((self.root / name).read_bytes(), (self.root / name).stat().st_ino)
                     for name in (".env", OVERLAY)}
        reads = []

        def empty_docker_read(arguments, **kwargs):
            self.assertEqual(arguments, ["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project"])
            self.assertEqual(kwargs, {"capture": True})
            reads.append(arguments)
            return ""

        args = self.public_install_args(operation_id=saved["operationId"])
        with self.public_install_adapters(), patch.object(system, "run", side_effect=empty_docker_read), \
                patch.object(Runtime, "settings", side_effect=KeyboardInterrupt()) as unfinished, \
                patch.object(asa_setup, "replace_legacy_manager_state", wraps=asa_setup.replace_legacy_manager_state) as adopt:
            self.assertEqual(asa_setup.execute(args), 130)
            unfinished.assert_called_once()
            adopt.assert_not_called()
        self.assertEqual(reads, [])
        final = self.store.read(saved["operationId"])
        for key in ("operationId", "installationId", "root", "project", "publicOriginsEnvironment"):
            self.assertEqual(final[key], saved[key], key)
        self.assertEqual(final["state"], "RUNNING")
        self.assertNotIn("switch", final["stages"])
        self.assertEqual({path: (path.read_bytes(), path.stat().st_ino) for path in preserved}, preserved)
        self.assertFalse((self.root / ".asa/installation.json").exists())

    def continuation_adapters(self):
        stack = self.public_install_adapters()
        stack.enter_context(patch.object(Runtime, "images", return_value=None))
        stack.enter_context(patch.object(setup_operation, "validate_resolved_images", return_value=None))
        stack.enter_context(patch.object(setup_operation.setup_host, "disk_budget", return_value={"status": "OK"}))
        return stack

    def test_public_resumes_the_pre_switch_prefix_without_replaying_completed_stages(self):
        self.prepare_public_install()
        event = Store.event

        def before_settings(store, journal, name, status, **details):
            if name == "settings":
                raise KeyboardInterrupt()
            return event(store, journal, name, status, **details)

        with self.public_install_adapters(), patch.object(Store, "event", new=before_settings):
            self.assertEqual(asa_setup.execute(self.public_install_args()), 130)
        saved = self.store.read(self.journal["operationId"])
        self.assertEqual(saved["phase"], "environment")
        self.assertEqual(saved["stages"]["environment"]["status"], "done")
        self.assertNotIn("settings", saved["stages"])
        preserved = {self.root / name: ((self.root / name).read_bytes(), (self.root / name).stat().st_ino)
                     for name in (".env", OVERLAY)}
        binding, identity = copy.deepcopy(saved["installEnvironment"]), {key: saved[key] for key in
                                                                        ("operationId", "installationId", "root", "project")}
        prepared_settings = None
        for method, stage in (("images", "images"), ("estimate", "space"), ("plan", "migration_plan"),
                              ("backup_preflight", "backup_preflight")):
            with self.subTest(stage=stage):
                args = self.public_install_args(operation_id=saved["operationId"])
                with self.continuation_adapters(), patch.object(Runtime, method, side_effect=KeyboardInterrupt()) as unfinished, \
                        patch.object(asa_setup, "replace_legacy_manager_state", wraps=asa_setup.replace_legacy_manager_state) as adopt:
                    self.assertEqual(asa_setup.execute(args), 130)
                    unfinished.assert_called_once()
                    adopt.assert_not_called()
                saved = self.store.read(saved["operationId"])
                self.assertEqual(saved["stages"][stage]["status"], "intent")
                self.assertEqual(saved["stages"]["settings"]["status"], "done")
                self.assertEqual(saved["state"], "RUNNING")
                self.assertNotIn("switch", saved["stages"])
                self.assertEqual(saved["installEnvironment"], binding)
                self.assertEqual({key: saved[key] for key in identity}, identity)
                self.assertEqual({path: (path.read_bytes(), path.stat().st_ino) for path in preserved}, preserved)
                settings = self.root / ".asa/installation.json"
                current_settings = (settings.read_bytes(), settings.stat().st_ino)
                if prepared_settings is None:
                    prepared_settings = current_settings
                self.assertEqual(current_settings, prepared_settings)
        attempts = []

        def before_switch(store, journal, name, status, **details):
            if name == "switch":
                attempts.append(name)
                raise KeyboardInterrupt()
            return event(store, journal, name, status, **details)

        for attempt in range(2):
            with self.subTest(before_switch_attempt=attempt), self.continuation_adapters(), \
                    patch.object(Store, "event", new=before_switch), \
                    patch.object(Runtime, "images", side_effect=AssertionError("completed images must not replay")), \
                    patch.object(Runtime, "settings", side_effect=AssertionError("completed settings must not replay")), \
                    patch.object(asa_setup, "replace_legacy_manager_state", wraps=asa_setup.replace_legacy_manager_state) as adopt:
                self.assertEqual(asa_setup.execute(self.public_install_args(operation_id=saved["operationId"])), 130)
                adopt.assert_not_called()
            saved = self.store.read(saved["operationId"])
            self.assertEqual(saved["stages"]["backup_preflight"]["status"], "done")
            self.assertEqual(saved["phase"], "backup_preflight")
            self.assertEqual(saved["state"], "RUNNING")
            self.assertNotIn("switch", saved["stages"])
            self.assertEqual({path: (path.read_bytes(), path.stat().st_ino) for path in preserved}, preserved)
        self.assertEqual(attempts, ["switch", "switch"])

    def test_public_resume_accepts_only_its_settings_publication_before_stage_completion(self):
        saved = self.public_install_until_settings()
        before = {self.root / name: ((self.root / name).read_bytes(), (self.root / name).stat().st_ino)
                  for name in (".env", OVERLAY)}
        with self.public_install_adapters(), patch.object(Runtime, "reload", side_effect=KeyboardInterrupt()):
            self.assertEqual(asa_setup.execute(self.public_install_args(operation_id=saved["operationId"])), 130)
        interrupted = self.store.read(saved["operationId"])
        self.assertEqual(interrupted["stages"]["settings"]["status"], "intent")
        settings = self.root / ".asa/installation.json"
        original_settings = settings.read_bytes()
        with self.public_install_adapters(), patch.object(Runtime, "images", side_effect=KeyboardInterrupt()), \
                patch.object(asa_setup, "replace_legacy_manager_state", wraps=asa_setup.replace_legacy_manager_state) as adopt:
            self.assertEqual(asa_setup.execute(self.public_install_args(operation_id=saved["operationId"])), 130)
            adopt.assert_not_called()
        final = self.store.read(saved["operationId"])
        self.assertEqual(final["stages"]["settings"]["status"], "done")
        self.assertEqual(final["stages"]["images"]["status"], "intent")
        self.assertEqual(settings.read_bytes(), original_settings)
        self.assertEqual({path: (path.read_bytes(), path.stat().st_ino) for path in before}, before)
        self.assertEqual(final["installEnvironment"], saved["installEnvironment"])

    def assert_public_continuation_blocked(self, operation_id, *, expected=None):
        watched = [self.root / name for name in (".env", OVERLAY, ".asa/setup.json", ".asa/installation.json")]
        watched.append(self.store.path(operation_id))
        before = {path: (path.read_bytes(), path.stat().st_ino) if path.exists() else None for path in watched}
        args = self.public_install_args(operation_id=operation_id)
        with self.public_install_adapters(), patch.object(system, "run", side_effect=self.empty_docker_read) as identity, \
                patch.object(asa_setup, "save_private", wraps=asa_setup.save_private) as save, \
                patch.object(asa_setup, "replace_legacy_manager_state", wraps=asa_setup.replace_legacy_manager_state) as adopt:
            with self.assertRaises(Blocked) as caught:
                asa_setup.execute(args)
            if expected:
                self.assertEqual(caught.exception.code, expected)
            save.assert_not_called()
            adopt.assert_not_called()
        self.assertEqual({path: (path.read_bytes(), path.stat().st_ino) if path.exists() else None for path in watched}, before)
        return identity.call_count

    def test_continuation_rejects_unknown_proof_or_broken_preparation_sequence(self):
        saved = self.public_install_until_settings()
        cases = (
            ("identity", lambda value: value.update(installationId="d" * 32)),
            ("root", lambda value: value.update(root=str(self.root / "foreign"))),
            ("project", lambda value: value.update(project="other-school")),
            ("mode", lambda value: value.update(mode="update")),
            ("state", lambda value: value.update(state="RECOVERY_REQUIRED")),
            ("phase", lambda value: value.update(phase="unknown")),
            ("missing_hash", lambda value: value["installEnvironment"].pop("beforeSha256")),
            ("changed_hash", lambda value: value["installEnvironment"].update(afterSha256="0" * 64)),
            ("configuration_hash", lambda value: value["installEnvironment"].update(configurationSha256="0" * 64)),
            ("unknown_format", lambda value: value["installEnvironment"].update(format="unknown-v2")),
            ("extra_proof_field", lambda value: value["installEnvironment"].update(unknown=True)),
            ("missing_settings", lambda value: value["stages"]["settings"].update(status="done")),
            ("gap", lambda value: value["stages"].update(images={"status": "intent"})),
            ("unknown_stage", lambda value: value["stages"].update(unknown={"status": "done"})),
            ("source", lambda value: value["stages"]["source"]["evidence"].update(revision="0" * 40)),
            ("previous_data", lambda value: value.update(storageIdentity={"old": "installation"})),
            ("handoff", lambda value: value.update(handoffs=2)),
            ("backup_policy", lambda value: value["backupPolicy"].update(policy="required")),
        )
        for name, change in cases:
            with self.subTest(change=name):
                altered = copy.deepcopy(saved)
                change(altered)
                save_private(self.store.path(saved["operationId"]), altered)
                self.assert_public_continuation_blocked(saved["operationId"])

    def test_old_verified_overlay_proof_remains_usable_for_its_own_pre_switch_continuation(self):
        saved = self.public_install_until_settings()
        saved.pop("installEnvironment")
        save_private(self.store.path(saved["operationId"]), saved)
        before = ((self.root / ".env").read_bytes(), (self.root / OVERLAY).stat().st_ino)
        with self.public_install_adapters(), patch.object(Runtime, "images", side_effect=KeyboardInterrupt()), \
                patch.object(asa_setup, "replace_legacy_manager_state", wraps=asa_setup.replace_legacy_manager_state) as adopt:
            self.assertEqual(asa_setup.execute(self.public_install_args(operation_id=saved["operationId"])), 130)
            adopt.assert_not_called()
        final = self.store.read(saved["operationId"])
        self.assertEqual(final["stages"]["settings"]["status"], "done")
        self.assertNotIn("installEnvironment", final)
        self.assertEqual(final["publicOriginsEnvironment"], saved["publicOriginsEnvironment"])
        self.assertEqual(((self.root / ".env").read_bytes(), (self.root / OVERLAY).stat().st_ino), before)

    def test_unbound_https_journal_keeps_the_existing_runtime_identity_requirement(self):
        saved = self.public_install_until_settings(origin="https://school.example.test")
        saved.pop("installEnvironment")
        save_private(self.store.path(saved["operationId"]), saved)
        self.assertEqual(self.assert_public_continuation_blocked(saved["operationId"], expected="IDENTITY_MISSING"), 1)

    def test_real_switch_intent_keeps_the_existing_runtime_identity_requirement(self):
        saved = self.public_install_until_settings()
        with self.continuation_adapters(), patch.object(Runtime, "switch", side_effect=KeyboardInterrupt()):
            self.assertEqual(asa_setup.execute(self.public_install_args(operation_id=saved["operationId"])), 130)
        final = self.store.read(saved["operationId"])
        self.assertEqual(final["stages"]["switch"]["status"], "intent")
        self.assertEqual(final["state"], "VERIFY_ONLY")
        self.assertEqual(self.assert_public_continuation_blocked(saved["operationId"], expected="IDENTITY_MISSING"), 1)

    def test_continuation_rejects_changed_environment_configuration_and_existing_resources(self):
        saved = self.public_install_until_settings()
        env, config = self.root / ".env", self.root / ".asa/setup.json"
        env_before, config_before = env.read_bytes(), config.read_bytes()
        for name in ("environment", "configuration"):
            with self.subTest(change=name):
                if name == "environment":
                    env.write_bytes(env_before + b"UNEXPECTED_PRIVATE_SETTING=changed\n")
                else:
                    value = json.loads(config_before)
                    value["backup"]["retention"] = {"localKeep": 2}
                    save_private(config, value)
                self.assert_public_continuation_blocked(saved["operationId"])
                env.write_bytes(env_before)
                config.write_bytes(config_before)
        inventories = (
            {**self.inventory, "complete": False},
            {**self.inventory, "volumes": [{"name": "school-fixture_postgres-data", "labels": {}}]},
            {**self.inventory, "volumes": [{"name": "unrelated-name", "labels": {"project": "school-fixture"}}]},
            {**self.inventory, "containers": [{"id": "e" * 64, "image": "postgres:17", "running": False,
                "labels": {"project": "foreign", "root": str(self.root), "service": "postgres"}, "mounts": []}]},
            {**self.inventory, "containers": [{"id": "e" * 64, "image": "postgres:17", "running": False,
                "labels": {"project": "school-fixture", "root": str(self.root / "other"), "service": "postgres"}, "mounts": []}]},
        )
        for index, inventory in enumerate(inventories):
            with self.subTest(inventory=index), patch("deployment.setup_operation.setup_discovery.docker_inventory", return_value=inventory):
                self.assert_public_continuation_blocked(saved["operationId"])

    def test_continuation_rejects_unknown_settings_state_and_backup_contents(self):
        saved = self.public_install_until_settings()
        with self.public_install_adapters(), patch.object(Runtime, "images", side_effect=KeyboardInterrupt()):
            self.assertEqual(asa_setup.execute(self.public_install_args(operation_id=saved["operationId"])), 130)
        settings = self.root / ".asa/installation.json"
        original = settings.read_bytes()
        changes = ({"instanceId": "d" * 32}, {"project": "other-school"}, {"profile": "dev"},
                   {"automaticUpdates": True}, {"automaticUpdates": 0}, {"unexpected": "state"},
                   {"backupDirectory": str(self.root / "other-backups")})
        for change in changes:
            with self.subTest(settings=change):
                save_private(settings, {**json.loads(original), **change})
                self.assert_public_continuation_blocked(saved["operationId"])
                settings.write_bytes(original)
        for name in ("installed-release.json", "maintenance.json", "failed-switch.json", "atomic-active.json", "last-operation.json"):
            with self.subTest(state=name):
                path = self.root / ".asa" / name
                save_private(path, self.release("previous") if name == "installed-release.json" else {})
                try:
                    self.assert_public_continuation_blocked(saved["operationId"])
                finally:
                    path.unlink()
        retained = self.root / "backups/retained-copy"
        retained.write_bytes(b"synthetic previous archive; never remove automatically")
        self.assert_public_continuation_blocked(saved["operationId"])
        self.assertTrue(retained.exists())

    def test_generic_environment_proof_requires_the_same_confirmed_fresh_target_before_writes(self):
        self.config["entryOrigin"] = "https://school.example.test"
        save_private(self.root / ".asa/setup.json", self.config)
        before = (self.root / ".env").read_bytes()
        runtime = self.runtime()
        existing = self.root / ".asa/installation.json"
        existing.write_text("{}\n")
        with self.assertRaises(Blocked):
            runtime.environment()
        self.assertEqual((self.root / ".env").read_bytes(), before)
        self.assertNotIn("installEnvironment", self.store.read(self.journal["operationId"]))
        existing.unlink()
        self.inventory["complete"] = False
        with self.assertRaises(Blocked):
            runtime.environment()
        self.assertEqual((self.root / ".env").read_bytes(), before)
        self.assertNotIn("installEnvironment", self.store.read(self.journal["operationId"]))

    def test_continuation_rechecks_metadata_and_journal_under_real_lock_before_writes(self):
        saved = self.public_install_until_settings(origin="https://school.example.test")
        with self.public_install_adapters(), patch.object(Runtime, "images", side_effect=KeyboardInterrupt()):
            self.assertEqual(asa_setup.execute(self.public_install_args(operation_id=saved["operationId"])), 130)
        saved = self.store.read(saved["operationId"])
        config, settings = self.root / ".asa/setup.json", self.root / ".asa/installation.json"
        journal, backup = self.store.path(saved["operationId"]), self.root / "backups"
        original = {path: path.read_bytes() for path in (self.root / ".env", config, settings, journal)}
        real_lock = asa_setup.operation_lock
        for change in ("settings", "settings_inode", "configuration", "journal", "backup", "inventory"):
            with self.subTest(change=change):
                for path, content in original.items():
                    path.write_bytes(content)
                before = {path: (path.read_bytes(), path.stat().st_ino) for path in original}
                inventory = [copy.deepcopy(self.inventory)]
                after_injection = {}
                retained = backup / "retained-copy"

                @contextmanager
                def racing_lock(*args, **kwargs):
                    self.assertEqual({path: (path.read_bytes(), path.stat().st_ino) for path in original}, before)
                    with real_lock(*args, **kwargs) as descriptor:
                        if change == "settings":
                            save_private(settings, {**json.loads(original[settings]), "instanceId": "d" * 32})
                        elif change == "settings_inode":
                            paths.atomic_bytes(settings, original[settings], mode=0o600)
                        elif change == "configuration":
                            value = json.loads(original[config])
                            value["backup"]["retention"] = {"localKeep": 2}
                            save_private(config, value)
                        elif change == "journal":
                            value = copy.deepcopy(saved)
                            value["stages"]["images"]["status"] = "done"
                            save_private(journal, value)
                        elif change == "backup":
                            retained.write_bytes(b"synthetic previous archive; preserve")
                        else:
                            inventory[0]["volumes"] = [{"name": "school-fixture_postgres-data", "labels": {}}]
                        after_injection.update({path: (path.read_bytes(), path.stat().st_ino) for path in original})
                        yield descriptor

                try:
                    with self.public_install_adapters(), patch.object(asa_setup, "operation_lock", side_effect=racing_lock), \
                            patch("deployment.setup_operation.setup_discovery.docker_inventory", side_effect=lambda: copy.deepcopy(inventory[0])), \
                            patch.object(asa_setup, "save_private", wraps=asa_setup.save_private) as save, \
                            patch.object(asa_setup, "replace_legacy_manager_state", wraps=asa_setup.replace_legacy_manager_state) as adopt:
                        with self.assertRaises(Blocked):
                            asa_setup.execute(self.public_install_args(operation_id=saved["operationId"]))
                        save.assert_not_called()
                        adopt.assert_not_called()
                    self.assertTrue(after_injection)
                    self.assertEqual({path: (path.read_bytes(), path.stat().st_ino) for path in original}, after_injection)
                    if change == "backup":
                        self.assertEqual(retained.read_bytes(), b"synthetic previous archive; preserve")
                finally:
                    if retained.exists():
                        retained.unlink()

    @unittest.skipUnless(os.name == "posix", "Linux setup CLI")
    def test_public_install_keeps_ordinary_config_runtime_drift_guard_before_lock(self):
        self.config["entryOrigin"] = "https://different.example.test"
        save_private(self.root / ".asa/setup.json", self.config)
        before = (self.root / ".env").read_bytes()
        args = self.public_install_args(operation_id=self.journal["operationId"])
        with self.public_install_adapters(), \
                patch.object(asa_setup, "operation_lock", wraps=asa_setup.operation_lock) as lock, \
                patch.object(asa_setup, "save_private", wraps=asa_setup.save_private) as save, \
                patch.object(asa_setup, "replace_legacy_manager_state", wraps=asa_setup.replace_legacy_manager_state) as adopt:
            with self.assertRaises(Blocked) as caught:
                asa_setup.execute(args)
            self.assertEqual(caught.exception.code, "CONFIG_RUNTIME_DRIFT")
            lock.assert_not_called()
            save.assert_not_called()
            adopt.assert_not_called()
        self.assertEqual((self.root / ".env").read_bytes(), before)
        self.assertFalse((self.root / ".asa/installation.json").exists())

    @unittest.skipUnless(os.name == "posix", "Linux setup CLI")
    def test_public_install_rejects_unbound_drift_before_lock_or_configuration_writes(self):
        saved = self.public_install_interrupt_environment()
        env_path, journal_path = self.root / ".env", self.store.path(saved["operationId"])
        original_env = env_path.read_bytes()
        for change in ("environment", "journal", "overlay"):
            with self.subTest(change=change):
                env_path.write_bytes(original_env)
                save_private(journal_path, saved)
                (self.root / OVERLAY).write_text(CONTENTS)
                if change == "environment":
                    env_path.write_bytes(original_env + b"UNEXPECTED_PRIVATE_SETTING=changed\n")
                elif change == "journal":
                    altered = copy.deepcopy(saved)
                    altered.pop("publicOriginsEnvironment")
                    save_private(journal_path, altered)
                else:
                    (self.root / OVERLAY).write_text(CONTENTS + "# unknown\n")
                watched = (env_path, journal_path, self.root / ".asa/setup.json", self.root / OVERLAY)
                before = {path: (path.read_bytes(), path.stat().st_ino) for path in watched}
                args = self.public_install_args(operation_id=saved["operationId"])
                with self.public_install_adapters(), \
                        patch.object(asa_setup, "operation_lock", wraps=asa_setup.operation_lock) as lock, \
                        patch.object(asa_setup, "save_private", wraps=asa_setup.save_private) as save, \
                        patch.object(asa_setup, "replace_legacy_manager_state", wraps=asa_setup.replace_legacy_manager_state) as adopt:
                    with self.assertRaises(Blocked):
                        asa_setup.execute(args)
                    lock.assert_not_called()
                    save.assert_not_called()
                    adopt.assert_not_called()
                self.assertEqual({path: (path.read_bytes(), path.stat().st_ino) for path in watched}, before)
                self.assertFalse((self.root / ".asa/installation.json").exists())

    @unittest.skipUnless(os.name == "posix", "Linux setup CLI")
    def test_public_install_rechecks_exact_pending_state_under_real_lock_before_writes(self):
        saved = self.public_install_interrupt_environment()
        env_path, config_path = self.root / ".env", self.root / ".asa/setup.json"
        journal_path, overlay = self.store.path(saved["operationId"]), self.root / OVERLAY
        original = {path: path.read_bytes() for path in (env_path, config_path, journal_path, overlay)}
        real_lock = asa_setup.operation_lock
        for change in ("environment", "configuration", "journal", "overlay_inode", "environment_inode", "inventory"):
            with self.subTest(change=change):
                for path, content in original.items():
                    path.write_bytes(content)
                before = {path: (path.read_bytes(), path.stat().st_ino) for path in original}
                inventory = [copy.deepcopy(self.inventory)]
                after_injection = {}

                @contextmanager
                def racing_lock(*args, **kwargs):
                    # The full public pre-lock path has only read private state.
                    self.assertEqual({path: (path.read_bytes(), path.stat().st_ino) for path in original}, before)
                    with real_lock(*args, **kwargs) as descriptor:
                        if change == "environment":
                            env_path.write_bytes(original[env_path] + b"UNEXPECTED_PRIVATE_SETTING=changed\n")
                        elif change == "configuration":
                            configured = json.loads(original[config_path])
                            configured["backup"]["retention"] = {"localKeep": 2}
                            save_private(config_path, configured)
                        elif change == "journal":
                            changed = copy.deepcopy(saved)
                            changed["state"] = "TERMINAL"
                            save_private(journal_path, changed)
                        elif change == "overlay_inode":
                            paths.atomic_bytes(overlay, original[overlay], mode=0o600)
                        elif change == "environment_inode":
                            paths.atomic_bytes(env_path, original[env_path], mode=0o600)
                        else:
                            inventory[0]["volumes"] = [{"name": "school-fixture_postgres-data", "labels": {}}]
                        after_injection.update({path: (path.read_bytes(), path.stat().st_ino) for path in original})
                        yield descriptor

                args = self.public_install_args(operation_id=saved["operationId"])
                with self.public_install_adapters(), patch.object(asa_setup, "operation_lock", side_effect=racing_lock), \
                        patch("deployment.setup_operation.setup_discovery.docker_inventory", side_effect=lambda: copy.deepcopy(inventory[0])), \
                        patch.object(asa_setup, "save_private", wraps=asa_setup.save_private) as save, \
                        patch.object(asa_setup, "replace_legacy_manager_state", wraps=asa_setup.replace_legacy_manager_state) as adopt:
                    with self.assertRaises(Blocked):
                        asa_setup.execute(args)
                    save.assert_not_called()
                    adopt.assert_not_called()
                self.assertTrue(after_injection)
                self.assertEqual({path: (path.read_bytes(), path.stat().st_ino) for path in original}, after_injection)
                self.assertFalse((self.root / ".asa/installation.json").exists())

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
