"""Fault/drift tests of the return transaction; native Docker proof is separate."""

import contextlib
import copy
import datetime as dt
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager as manager
from deployment import application_rollback as ar
from deployment import ci_application_rollback as native_driver
from deployment import system
from deployment.contracts import Blocked, inventory_files
from deployment.fresh_install import fresh_options
from deployment.system import run as native_run

DIGEST = "sha256:87acd65905c3cb64c1052ea046926932b1a5e9f42dc52d8b36c05db9f449da68"


def release(revision, images):
    return {"format": "asa-deployment-v2", "repository": "spikeal8-maker/asa-lab",
            "revision": revision, "schema": 304, "platform": "linux/amd64", "publicationRunId": 123,
            "images": {name: f"{ar.REGISTRY}/{name}@sha256:{sha}" for name, sha in images.items()}}


class Crash(BaseException):
    pass


class Fixture:
    """Real private files/journal, simulated Docker and immutable source objects."""
    def __init__(self, root):
        self.root, self.state = root, root / ".asa"
        self.root.mkdir(parents=True, mode=0o700)
        if os.name == 'nt':
            from deployment.ci_application_rollback import protect_new_fixture_root
            protect_new_fixture_root(self.root)
        self.state.mkdir(mode=0o700)
        self.previous, self.selected = release(ar.PREVIOUS, ar.PREVIOUS_IMAGES), release(ar.PRODUCT, ar.PRODUCT_IMAGES)
        self.head = ar.PREVIOUS
        self.profile, self.project = "dev", "asa-lab-p0-return-unit"
        self.env = {"ASA_OBJECT_STORAGE_ENDPOINT": "http://minio:9000", "ASA_SEARCH_SECRET": "synthetic",
                    "ASA_UPDATE_ENTRY_ORIGIN": "http://127.0.0.1:4610"}
        self.settings = {"automaticUpdates": False, "instanceId": "synthetic-instance", "profile": "dev", "project": self.project}
        self.files = ["compose.yaml", "compose.dev.yaml"]
        for name in self.files:
            (root / name).write_bytes(b"services: {}\n")
        (root / ".env").write_bytes(b"SYNTHETIC=private\n")
        ar._write(self.state / "installation.json", self.settings)
        ar._write(self.state / "installed-release.json", self.previous)
        self.process_env = {"ASA_BUILD_REVISION": ar.PREVIOUS, "ASA_EXPECTED_SCHEMA_VERSION": "304"}
        for name, reference in self.previous["images"].items():
            self.process_env[f"ASA_{name.upper()}_IMAGE"] = reference
        self.images = {"ids": {side: {name: "sha256:" + ar.digest(reference) for name, reference in value["images"].items()}
                               for side, value in (("previous", self.previous), ("selected", self.selected))},
                       "objectBinaries": {side: dict(ar.MINIO_BINARIES) for side in ("previous", "selected")}}
        self.records = {name: {"id": "container-" + name, "image": reference, "running": True}
                        for name, reference in self.previous["images"].items()}
        self.records["postgres"] = {"id": "original-postgres", "image": "postgres:17.7-bookworm", "running": True}
        self.pg_image = "sha256:" + "e" * 64
        self.volumes = {name: {"Name": self.project + "-" + name, "Driver": "local", "CreatedAt": "2026-11-06T00:00:00Z"}
                        for name in ("postgres-data", "minio-data", "application-logs")}
        self.history = [{"version": "0304", "checksum": "b" * 64}]
        self.calls, self.source_changes = [], []
        self.crash_phase = None
        self.crash_after_action = False
        self.tool = {"root": str(root.parent / "approved tools"), "revision": "c" * 40,
                     "treeSha256": "d" * 64, "host": sys.platform, "pythonMajorMinor": list(sys.version_info[:2])}
        self.config_drift = False
        self.data = {"before": "retained"}

    def config(self):
        result = {"services": {}, "volumes": {key: {"name": value["Name"]} for key, value in self.volumes.items()}}
        for name in ("api", "web", "scratch", "minio", "search", "migration", "minio-init"):
            service = "api" if name == "migration" else "minio" if name == "minio-init" else name
            result["services"][name] = {"image": self.process_env[f"ASA_{service.upper()}_IMAGE"],
                                        "build": {"args": {"ASA_BUILD_REVISION": self.process_env["ASA_BUILD_REVISION"]}},
                                        "environment": {"PRIVATE": "changed" if self.config_drift else "unchanged"}}
        result["services"]["postgres"] = {"image": "postgres:17.7-bookworm"}
        return result

    def git(self, *args):
        if args == ("rev-parse", "HEAD"):
            return self.head
        if args[0] == "rev-parse":
            return "a" * 40
        if args[0] == "ls-files":
            return args[-1]
        if args[0] == "diff":
            return "".join(f"M\0{name}\0" for name in self.source_changes)
        if args[0] == "switch":
            self.head = args[-1]
            return ""
        if args == ("merge-base", "--is-ancestor", ar.PRODUCT, ar.PREVIOUS):
            raise Blocked("COMMAND", "Refused reverse ancestry", "Preserve data")
        if args == ("remote", "get-url", "origin"):
            return "https://github.com/spikeal8-maker/asa-lab.git"
        return ""

    def identity(self, existing=True):
        return copy.deepcopy(self.records)

    def readiness(self, revision=None, schema=None):
        ready = self.previous if self.records["api"]["image"] == self.previous["images"]["api"] else self.selected
        if revision and ready["revision"] != revision:
            raise Blocked("HEALTH", "Wrong revision", "Retry")
        return {"revision": ready["revision"], "schema": 304}

    def wait_ready(self, revision, schema):
        return self.readiness(revision, schema)

    def receipt(self, value):
        ar._write(self.state / "last-operation.json", value)

    def docker(self, args, **kwargs):
        # Keep ACL attestation native even while ar.run simulates Docker.
        # The imported runner stays independent of nested fixture patches.
        if args and args[0] == "powershell.exe":
            return native_run(args, **kwargs)
        self.calls.append(tuple(args))
        if args[:3] == ["docker", "volume", "inspect"]:
            return json.dumps([next(value for value in self.volumes.values() if value["Name"] == args[-1])])
        if args[:2] == ["docker", "inspect"]:
            if args[-1] == self.records["postgres"]["id"]:
                return self.pg_image
            record = next(value for value in self.records.values() if value["id"] == args[-1])
            for side, release_value in (("previous", self.previous), ("selected", self.selected)):
                for name, reference in release_value["images"].items():
                    if reference == record["image"]:
                        return self.images["ids"][side][name]
        raise AssertionError("Unexpected Docker transport " + str(args))

    def compose(self, *args, **kwargs):
        self.calls.append(args)
        if args[:3] == ("config", "--format", "json"):
            return json.dumps(self.config())
        if args[:3] == ("exec", "-T", "-e"):
            return json.dumps(self.history)
        if args[0] == "exec":
            return ""
        if args[0] == "run" and args[-1] == "--plan":
            return ""
        if args[0] == "stop":
            for name in args[1:]:
                if name in self.records:
                    self.records[name]["running"] = False
            return ""
        if args[0] == "up":
            phase = ar.load_journal(self)["phase"]
            if phase == self.crash_phase and not self.crash_after_action:
                self.crash_phase = None
                raise Crash()
            index = args.index("180") + 1
            for name in args[index:]:
                self.records[name] = {"id": "recreated-" + name, "image": self.process_env[f"ASA_{name.upper()}_IMAGE"], "running": True}
            if phase == self.crash_phase:
                self.crash_phase = None
                raise Crash()
            return ""
        raise AssertionError("Unexpected Compose action " + str(args))

    def backup(self):
        path = self.root.parent / "verified backup"
        path.mkdir(mode=0o700)
        if os.name == 'nt':
            from deployment.ci_application_rollback import protect_new_fixture_root
            protect_new_fixture_root(path)
        (path / "configuration").mkdir()
        (path / "objects").mkdir()
        (path / "database.dump").write_bytes(b"synthetic dump")
        (path / "globals.sql").write_bytes(b"synthetic roles")
        (path / "private.env").write_bytes((self.root / ".env").read_bytes())
        if os.name != 'nt': os.chmod(path / "private.env", 0o600)
        (path / "objects" / "test").write_bytes(b"old object")
        ar._write(path / "configuration" / "installed-release.json", self.previous)
        ar._write(path / "configuration" / "installation.json", self.settings)
        for name in self.files:
            (path / "configuration" / name).write_bytes((self.root / name).read_bytes())
        value = {"format": "asa-backup-v1", "complete": True, "createdAt": dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-synthetic",
                 "runtime": {"revision": ar.PREVIOUS, "schema": 304}, "project": self.project, "profile": self.profile,
                 "postgresImage": self.records["postgres"]["image"],
                 "images": {**{name: {"reference": reference, "imageId": self.images["ids"]["previous"][name]}
                            for name, reference in self.previous["images"].items()},
                            "postgres": {"reference": self.records["postgres"]["image"], "imageId": self.pg_image}},
                 "files": inventory_files(path)}
        ar._write(path / "manifest.json", value)
        return path


class ReturnTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="asa return unit ")
        self.addCleanup(self.temporary.cleanup)
        self.fixture = Fixture(Path(self.temporary.name) / "canonical app")
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        for target, replacement in (("_clean", lambda root: None), ("tool_identity", lambda install: self.fixture.tool),
                                    ("_images", lambda previous, selected: self.fixture.images),
                                    ("_ci_identity", lambda release_value: {"revision": release_value["revision"]}),
                                    ("_tool_ci", lambda *args: {"revision": self.fixture.tool["revision"]}),
                                    ("run", self.fixture.docker), ("Installation", lambda root, profile: self.fixture),
                                    ("verify_embedded_entry_http", lambda *args: None)):
            self.stack.enter_context(patch.object(ar, target, replacement))
        self.stack.enter_context(patch.object(ar.releases, "validate_resolved_images", lambda install, release_value: install.config()))
        self.backup = self.fixture.backup()
        self.candidate = ar.prepare_candidate(self.fixture, self.fixture.selected, DIGEST)

    def arm(self):
        self.fixture.head = ar.PRODUCT
        ar.releases.apply_release_environment(self.fixture, self.fixture.selected)
        self.operation = {"phase": "switch", "previous": {"revision": ar.PREVIOUS, "schema": 304},
                          "selected": self.fixture.selected, "backup": str(self.backup), "deploymentDigest": DIGEST}
        journal = ar.begin(self.fixture, self.candidate, self.backup, self.operation)
        ar._write(self.fixture.state / "maintenance.json", self.operation)
        return journal

    def accept(self, journal):
        ar.switch_forward(self.fixture, journal)
        ar._write(self.fixture.state / "installed-release.json", self.fixture.selected)
        self.fixture.receipt({"status": "success", **self.operation})
        ar.forward_accepted(self.fixture, journal)
        (self.fixture.state / "maintenance.json").unlink()
        self.fixture.data["written_after_update"] = "must survive"

    def test_success_retains_new_writes_and_exact_identity_and_is_idempotent(self):
        journal = self.arm()
        self.accept(journal)
        before = copy.deepcopy(self.fixture.data)
        final = ar.rollback(self.fixture)
        self.assertEqual(final["phase"], "rolled_back")
        self.assertEqual(self.fixture.data, before)
        self.assertEqual(self.fixture.head, ar.PREVIOUS)
        self.assertEqual(ar._read(self.fixture.state / "installed-release.json"), self.fixture.previous)
        self.assertFalse((self.fixture.state / "maintenance.json").exists())
        self.assertFalse(self.fixture.settings["automaticUpdates"])
        up = [call for call in self.fixture.calls if call[0] == "up"]
        self.assertEqual([call[-1] for call in up[-3:]], ["scratch", "api", "web"])
        self.assertTrue(all("--no-deps" in call and "--no-build" in call and "never" in call for call in up))
        self.assertFalse(any(any(value in call for value in ("pg_restore", "down", "--volumes")) or
                             "migration" in call and "--plan" not in call for call in self.fixture.calls))
        count = len(up)
        ar.rollback(self.fixture)
        self.assertEqual(len([call for call in self.fixture.calls if call[0] == "up"]), count)

    def test_real_receipt_publisher_accepts_return_and_never_pending_success(self):
        from deployment.system import Installation as RealInstallation
        journal = self.arm()
        with patch.object(self.fixture, "receipt", side_effect=lambda value: RealInstallation.receipt(self.fixture, value)):
            self.accept(journal)
            ar.rollback(self.fixture)
        receipt = ar._read(self.fixture.state / "last-operation.json")
        self.assertEqual(receipt["status"], "success")
        self.assertEqual(receipt["action"], "rollback")
        self.assertEqual(receipt["selected"]["revision"], ar.PREVIOUS)
        self.assertEqual(ar.load_journal(self.fixture)["phase"], "rolled_back")

    def test_actual_operational_reader_survives_interrupted_forward_and_return(self):
        from deployment import operational
        from deployment.system import Installation as RealInstallation
        RealInstallation.receipt(self.fixture, {"status": "success", "trigger": "manual", "phase": "verify_entry",
                                               "selected": self.fixture.previous, "previous": {"revision": "a" * 40}})
        operational.append_operation(self.fixture.root, {"version": 1, "operation": "backup", "producer": "manager",
            "status": "succeeded", "trigger": "manual", "at": operational.stamp(), "revision": ar.PREVIOUS, "schema": 304})
        prior_bytes = (self.fixture.state / "last-operation.json").read_bytes()
        states, statuses = {}, {}
        collector = SimpleNamespace(root=self.fixture.root, state=lambda key, default=None: states.get(key, default),
            set_state=lambda key, value: states.__setitem__(key, value),
            status=lambda source, state, detail: statuses.__setitem__(source, state), add=lambda value: None)
        def read_real_sources():
            operational.operational_events(collector, lambda *arguments: arguments, {})
            self.assertEqual(statuses["operations:updates"], "ok")
            self.assertEqual(statuses["operations:backup"], "ok")
        journal = self.arm()
        self.fixture.crash_phase = "forward_api"
        with self.assertRaises(Crash): ar.switch_forward(self.fixture, journal)
        self.assertEqual((self.fixture.state / "last-operation.json").read_bytes(), prior_bytes)
        read_real_sources()
        self.fixture.crash_phase = "rollback_api"
        with self.assertRaises(Crash): ar.rollback(self.fixture)
        self.assertEqual((self.fixture.state / "last-operation.json").read_bytes(), prior_bytes)
        read_real_sources()
        with patch.object(self.fixture, "receipt", side_effect=lambda value: RealInstallation.receipt(self.fixture, value)):
            ar.rollback(self.fixture)
        read_real_sources()
        self.assertEqual(ar.load_journal(self.fixture)["phase"], "rolled_back")

    def test_every_service_stage_before_and_after_action_is_restartable(self):
        for phase in ("forward_support", "forward_api", "forward_web", "rollback_support", "rollback_api", "rollback_web"):
            for after in (False, True):
                with self.subTest(phase=phase, after=after):
                    # A separate real journal and state for each hard-stop boundary.
                    with self.fixture_reset():
                        journal = self.arm()
                        self.fixture.crash_phase, self.fixture.crash_after_action = phase, after
                        with self.assertRaises(Crash):
                            if phase.startswith("forward"):
                                ar.switch_forward(self.fixture, journal)
                            else:
                                self.accept(journal)
                                ar.rollback(self.fixture)
                        self.assertEqual(ar.load_journal(self.fixture)["phase"], phase)
                        self.fixture.data["committed_before_crash"] = "preserve"
                        ar.rollback(self.fixture)
                        self.assertEqual(self.fixture.data["committed_before_crash"], "preserve")
                        self.assertEqual(self.fixture.head, ar.PREVIOUS)

    @contextlib.contextmanager
    def fixture_reset(self):
        prior = self.fixture, self.backup, self.candidate
        with tempfile.TemporaryDirectory(prefix="asa fault ") as temporary:
            self.fixture = Fixture(Path(temporary) / "app")
            self.backup = self.fixture.backup()
            # run's bound method must follow this fixture too.
            with patch.object(ar, "run", self.fixture.docker):
                self.candidate = ar.prepare_candidate(self.fixture, self.fixture.selected, DIGEST)
                yield
        self.fixture, self.backup, self.candidate = prior

    def test_api_failure_keeps_web_stopped_and_journal_for_retry(self):
        journal = self.arm()
        self.accept(journal)
        with patch.object(ar, "_api_ready", side_effect=Blocked("ROLLBACK_API", "not ready", "retry")):
            with self.assertRaises(Blocked):
                ar.rollback(self.fixture)
        self.assertEqual(ar.load_journal(self.fixture)["phase"], "rollback_api")
        self.assertFalse(self.fixture.records["web"]["running"])
        ar.rollback(self.fixture)

    def test_plan_has_no_state_or_runtime_mutations(self):
        journal = self.arm()
        self.accept(journal)
        original = (self.fixture.state / ar.JOURNAL).read_bytes()
        self.fixture.calls.clear()
        ar.rollback(self.fixture, check=True)
        self.assertEqual((self.fixture.state / ar.JOURNAL).read_bytes(), original)
        self.assertFalse(any(call[0] in ("stop", "up") for call in self.fixture.calls))

    def test_drift_blocks_before_stop(self):
        cases = ("env", "config", "configbytes", "postgres", "volume", "migration", "tool", "receipt", "marker", "backup", "selection", "auto", "image")
        for case in cases:
            with self.subTest(case=case), self.fixture_reset():
                journal = self.arm()
                self.accept(journal)
                if case == "env": (self.fixture.root / ".env").write_bytes(b"changed")
                if case == "config": self.fixture.config_drift = True
                if case == "configbytes": (self.fixture.root / "compose.yaml").write_bytes(b"services: {}\r\n")
                if case == "postgres": self.fixture.pg_image = "sha256:" + "f" * 64
                if case == "volume": self.fixture.volumes["minio-data"]["CreatedAt"] = "recreated"
                if case == "migration": self.fixture.history[0]["checksum"] = "f" * 64
                if case == "tool": self.fixture.tool = {**self.fixture.tool, "revision": "f" * 40}
                if case == "receipt": self.fixture.receipt({"status": "success", "selected": {"revision": "f" * 40}})
                if case == "marker": ar._write(self.fixture.state / "maintenance.json", {"phase": "backup"})
                if case == "backup": (self.backup / "database.dump").write_bytes(b"changed")
                if case == "selection": ar._write(self.fixture.state / "release-selection.json", {"deploymentDigest": "foreign"})
                if case == "auto": self.fixture.settings["automaticUpdates"] = True
                if case == "image": self.fixture.records["minio"]["image"] = "foreign/minio:latest"
                self.fixture.calls.clear()
                with self.assertRaises(Blocked): ar.rollback(self.fixture)
                self.assertFalse(any(call[0] in ("stop", "up") for call in self.fixture.calls))

    def test_backup_age_and_lineage_are_not_schema_only(self):
        manifest = ar._read(self.backup / "manifest.json")
        manifest["createdAt"] = "20200101T000000Z-old"
        ar._write(self.backup / "manifest.json", manifest)
        with self.assertRaises(Blocked) as denied: self.arm()
        self.assertEqual(denied.exception.code, "ROLLBACK_BACKUP_AGE")
        self.assertFalse((self.fixture.state / ar.JOURNAL).exists())

    def test_canonical_windows_backup_newlines_preserve_live_raw_guard(self):
        for name in self.fixture.files:
            copied = self.backup / "configuration" / name
            copied.write_bytes(copied.read_bytes().replace(b"\n", b"\r\n"))
        manifest = ar._read(self.backup / "manifest.json")
        manifest["files"] = inventory_files(self.backup)
        ar._write(self.backup / "manifest.json", manifest)
        journal = self.arm()
        self.accept(journal)
        ar.rollback(self.fixture)
        self.assertEqual((self.fixture.root / "compose.yaml").read_bytes(), b"services: {}\n")

    def test_only_declared_pair_and_delivery_paths(self):
        previous = copy.deepcopy(self.fixture.previous)
        previous["revision"] = "f" * 40
        with self.assertRaises(Blocked): ar.validate_pair(self.fixture, previous, self.fixture.selected)
        selected = copy.deepcopy(self.fixture.selected)
        selected["revision"] = "f" * 40
        self.fixture.source_changes = ["apps/api/src/projects.controller.ts"]
        with self.assertRaises(Blocked) as denied: ar.validate_pair(self.fixture, self.fixture.previous, selected)
        self.assertEqual(denied.exception.code, "ROLLBACK_PRODUCT")

    def test_previous_policy_capsule_is_not_reinterpreted_by_new_tools(self):
        previous_policy = "asa-p0-98d7-d0bf-application-return-v1"
        self.assert_previous_policy_refused(previous_policy)

    def test_v2_policy_capsule_is_not_reinterpreted_by_v3_tools(self):
        self.assert_previous_policy_refused("asa-p0-98d7-d0bf-application-return-v2")

    def test_v3_policy_capsule_is_not_reinterpreted_by_v4_tools(self):
        self.assert_previous_policy_refused("asa-p0-98d7-d0bf-application-return-v3")

    def test_v4_policy_capsule_is_not_reinterpreted_by_v5_tools(self):
        self.assert_previous_policy_refused("asa-p0-98d7-d0bf-application-return-v4")

    def assert_previous_policy_refused(self, previous_policy):
        self.candidate["policy"] = previous_policy
        with patch.object(ar, "POLICY", previous_policy):
            self.arm()
        original = (self.fixture.state / ar.JOURNAL).read_bytes()
        self.fixture.calls.clear()
        with self.assertRaises(Blocked) as denied:
            ar.rollback(self.fixture)
        self.assertEqual(denied.exception.code, "ROLLBACK_JOURNAL")
        self.assertEqual((self.fixture.state / ar.JOURNAL).read_bytes(), original)
        self.assertFalse(self.fixture.calls)

    def test_journal_tamper_and_unlinked_capsule_refused(self):
        journal = self.arm()
        journal["events"][0]["phase"] = "forward_accepted"
        ar._write(self.fixture.state / ar.JOURNAL, journal)
        with self.assertRaises(Blocked): ar.load_journal(self.fixture)

    def test_prepared_arm_crash_is_recoverable_without_switch_receipt(self):
        self.arm()
        ar.rollback(self.fixture)
        self.assertEqual(self.fixture.head, ar.PREVIOUS)

    def test_pending_journal_cannot_be_acknowledged_or_overwritten(self):
        self.arm()
        with self.assertRaises(Blocked): ar.guard_acknowledge(self.fixture)
        with self.assertRaises(Blocked): ar.guard_update(self.fixture)

    def test_completed_return_never_accepts_clean_source_or_image_drift(self):
        for change in ("source", "minio", "installed"):
            with self.subTest(change=change), self.fixture_reset():
                journal = self.arm()
                self.accept(journal)
                ar.rollback(self.fixture)
                if change == "source": self.fixture.head = ar.PRODUCT
                if change == "minio": self.fixture.records["minio"]["image"] = self.fixture.selected["images"]["minio"]
                if change == "installed": ar._write(self.fixture.state / "installed-release.json", self.fixture.selected)
                self.fixture.calls.clear()
                with self.assertRaises(Blocked) as denied: ar.rollback(self.fixture)
                self.assertEqual(denied.exception.code, "ROLLBACK_COMPLETE_DRIFT")
                self.assertFalse(any(call[0] in ("stop", "up") for call in self.fixture.calls))

    def test_unlinked_prepared_gap_is_rearmable_but_cannot_authorize_return(self):
        self.fixture.head = ar.PRODUCT
        ar.releases.apply_release_environment(self.fixture, self.fixture.selected)
        ar.begin(self.fixture, self.candidate, self.backup, {})
        ar.guard_update(self.fixture)
        with self.assertRaises(Blocked) as denied: ar.rollback(self.fixture)
        self.assertEqual(denied.exception.code, "ROLLBACK_OPERATION")

    def test_normal_forward_guard_still_rejects_selected_to_previous(self):
        self.fixture.head = ar.PRODUCT
        self.fixture.records["api"]["image"] = self.fixture.selected["images"]["api"]
        with patch.object(manager, "clean_checkout"), self.assertRaises(Blocked) as denied:
            manager.selected_source(self.fixture, self.fixture.previous, existing=True)
        self.assertEqual(denied.exception.code, "COMMAND")
        self.assertEqual(self.fixture.head, ar.PRODUCT)


class WindowsOwnerRightsTests(unittest.TestCase):
    def setUp(self):
        self.current = "S-1-5-21-10-20-30-1001"
        self.foreign = "S-1-5-21-10-20-30-1002"
        self.paths = [Path("canonical"), Path("canonical/private state"), Path("canonical/private state/journal.json")]
        # Same root/directory/journal ACL shapes observed on native Windows;
        # only the fixture paths and user SID are synthetic.
        trustees = (("S-1-5-18", "S-1-5-32-544", self.current),
                    ("S-1-3-4", "S-1-5-18", "S-1-5-32-544"),
                    ("S-1-5-18", "S-1-5-32-544", "S-1-3-4"))
        self.payload = {"current": self.current, "rows": [
            {"path": str(path), "owner": self.current, "rules": [self.allow(sid) for sid in sids]}
            for path, sids in zip(self.paths, trustees)
        ]}

    @staticmethod
    def allow(sid, rights=2032127, inherit_only=False):
        return {"sid": sid, "kind": "Allow", "rights": rights, "inheritOnly": inherit_only}

    def journal_payload(self):
        return {"current": self.current, "rows": [copy.deepcopy(self.payload["rows"][2])]}

    def assert_denied(self, payload, paths):
        before = copy.deepcopy(payload)
        with self.assertRaises(Blocked) as denied:
            ar.validate_windows_acls(payload, paths)
        self.assertEqual(denied.exception.code, "ROLLBACK_STATE_ACL")
        self.assertEqual(payload, before)

    def test_observed_private_atomic_acl_shapes_accept_each_attested_owner(self):
        for owner in (self.current, "S-1-5-18", "S-1-5-32-544"):
            with self.subTest(owner=owner):
                payload = copy.deepcopy(self.payload)
                for row in payload["rows"]:
                    row["owner"] = owner
                before = copy.deepcopy(payload)
                ar.validate_windows_acls(payload, [(path, True) for path in self.paths])
                self.assertEqual(payload, before)

    def test_owner_rights_does_not_expand_the_allowed_object_owners(self):
        for owner in (self.foreign, "S-1-1-0", "S-1-3-4", "S-1-3-0", "S-1-3-40"):
            for private in (False, True):
                with self.subTest(owner=owner, private=private):
                    payload = self.journal_payload()
                    payload["rows"][0]["owner"] = owner
                    self.assert_denied(payload, [(self.paths[2], private)])

    def test_each_child_owner_is_attested_independently_of_the_parent(self):
        for child in (1, 2):
            with self.subTest(child=child):
                payload = copy.deepcopy(self.payload)
                payload["rows"][child]["owner"] = self.foreign
                self.assert_denied(payload, [(path, True) for path in self.paths])

    def test_owner_rights_does_not_hide_other_foreign_grants(self):
        for sid, rights in (("S-1-1-0", 1245631), (self.foreign, 2), (self.foreign, 0x40000)):
            for private in (False, True):
                with self.subTest(sid=sid, rights=rights, private=private):
                    payload = self.journal_payload()
                    payload["rows"][0]["rules"].append(self.allow(sid, rights))
                    self.assert_denied(payload, [(self.paths[2], private)])
        payload = self.journal_payload()
        payload["rows"][0]["rules"].append(self.allow(self.foreign, 1179817))
        self.assert_denied(payload, [(self.paths[2], True)])
        ar.validate_windows_acls(payload, [(self.paths[2], False)])

    def test_only_exact_owner_rights_sid_uses_the_attested_owner(self):
        for sid in ("S-1-3-40", "s-1-3-4", "S-1-3-4 ", " S-1-3-4", "S-1-3-0"):
            for private in (False, True):
                with self.subTest(sid=sid, private=private):
                    payload = self.journal_payload()
                    payload["rows"][0]["rules"] = [self.allow(sid)]
                    self.assert_denied(payload, [(self.paths[2], private)])
        payload = self.journal_payload()
        payload["rows"][0]["rules"].append(self.allow("S-1-3-0", inherit_only=True))
        ar.validate_windows_acls(payload, [(self.paths[2], True)])

    def test_owner_rights_does_not_skip_rule_shape_validation(self):
        malformed = (("rights", True), ("rights", "2032127"), ("rights", None),
                     ("inheritOnly", 1), ("sid", None), ("kind", "Allowed"))
        for field, value in malformed:
            with self.subTest(field=field, value=value):
                payload = self.journal_payload()
                rule = next(rule for rule in payload["rows"][0]["rules"] if rule["sid"] == "S-1-3-4")
                rule[field] = value
                self.assert_denied(payload, [(self.paths[2], True)])


class WindowsAclTransportTests(unittest.TestCase):
    def test_windows_acl_child_environment_preserves_inputs_without_inheriting_ps7_modules(self):
        with tempfile.TemporaryDirectory(prefix="asa acl environment ") as temporary:
            path = Path(temporary) / "private '[literal]' $value путь.json"
            path.write_text("{}", encoding="utf-8")
            missing = path.with_name("missing.json")
            current = "S-1-5-21-10-20-30-1001"
            payload = {"current": current, "rows": [{"path": str(path), "owner": current,
                "rules": [{"sid": current, "kind": "Allow", "rights": 2032127, "inheritOnly": False}]}]}
            environment = {"PSModulePath": "PS7 modules", "PSMODULEPATH": "upper modules",
                           "pSmOdUlEpAtH": "mixed modules", "WinPSModulePath": "keep this value",
                           "PATH": "unchanged path", "EMPTY": "", "ASA_RETURN_ACL_PATHS": "parent value"}
            before = dict(environment)
            with patch.object(ar, "os", SimpleNamespace(name="nt", environ=environment)), \
                    patch.object(ar, "run", return_value=json.dumps(payload)) as execute:
                ar.attest_access([(path, True), (missing, False)])
            execute.assert_called_once()
            self.assertEqual(execute.call_args.args[0], ["powershell.exe", "-NoLogo", "-NoProfile",
                             "-NonInteractive", "-Command", ar.WINDOWS_ACL_QUERY])
            child = execute.call_args.kwargs["env"]
            self.assertEqual(child, {"WinPSModulePath": "keep this value", "PATH": "unchanged path",
                                    "EMPTY": "", "ASA_RETURN_ACL_PATHS": json.dumps([str(path)])})
            self.assertTrue(execute.call_args.kwargs["capture"])
            self.assertEqual(environment, before)

    def test_windows_acl_command_failure_and_malformed_results_remain_denied(self):
        with tempfile.TemporaryDirectory(prefix="asa acl failure ") as temporary:
            path = Path(temporary)
            with patch.object(ar, "os", SimpleNamespace(name="nt", environ={})), \
                    patch.object(ar, "run", native_run), patch.object(subprocess, "run", return_value=
                        subprocess.CompletedProcess([], 17, "{}", "synthetic native failure")):
                with self.assertRaises(Blocked) as denied:
                    ar.attest_access([(path, True)])
                self.assertEqual(denied.exception.code, "COMMAND")
            for output, exception in (("not JSON", json.JSONDecodeError), ("{}", Blocked),
                                      ('{"current":"S-1-5-18","rows":[]}', Blocked)):
                with self.subTest(output=output), \
                        patch.object(ar, "os", SimpleNamespace(name="nt", environ={})), \
                        patch.object(ar, "run", return_value=output), self.assertRaises(exception):
                    ar.attest_access([(path, True)])

    def test_fixture_dispatches_only_powershell_to_the_saved_native_transport(self):
        fixture = Fixture.__new__(Fixture)
        fixture.calls, fixture.volumes = [], {"owned": {"Name": "synthetic-owned"}}
        command = ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ar.WINDOWS_ACL_QUERY]
        arguments = {"capture": True, "env": {"ASA_RETURN_ACL_PATHS": "[]"}}
        with patch.object(sys.modules[__name__], "native_run", return_value="native result") as execute, \
                patch.object(ar, "run", fixture.docker):
            self.assertEqual(ar.run(command, **arguments), "native result")
            execute.assert_called_once_with(command, **arguments)
            self.assertEqual(json.loads(ar.run(["docker", "volume", "inspect", "synthetic-owned"])),
                             [{"Name": "synthetic-owned"}])
            for unknown in (["pwsh.exe", "-Command", "unexpected"], ["git", "status"], []):
                with self.subTest(command=unknown), self.assertRaises(AssertionError):
                    ar.run(unknown)
            execute.assert_called_once()

    @unittest.skipUnless(os.name == "nt", "Requires native Windows PowerShell and DACLs")
    def test_native_windows_acl_transport_and_fixture_backup(self):
        execute = subprocess.run
        queries = []
        command = ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ar.WINDOWS_ACL_QUERY]

        def observed_run(args, **kwargs):
            result = execute(args, **kwargs)
            if args == command:
                queries.append({"exitCode": result.returncode, "stderr": (result.stderr or "")[:2048],
                                "inheritedModulePath": any(key.casefold() == "psmodulepath" for key in kwargs["env"])})
            return result

        with tempfile.TemporaryDirectory(prefix="asa native ACL transport ") as temporary:
            with patch.object(subprocess, "run", observed_run):
                try:
                    fixture = Fixture(Path(temporary) / "canonical app")
                    with patch.object(ar, "run", fixture.docker):
                        backup = fixture.backup()
                        ar.attest_access([(fixture.root, True), (fixture.state, True), (backup, True)])
                except Exception as exc:
                    self.fail(f"Native ACL transport: {type(exc).__name__}: {exc}; queries=" + json.dumps(queries))
            self.assertGreaterEqual(len(queries), 3)
            self.assertTrue(all(row["exitCode"] == 0 and not row["inheritedModulePath"] for row in queries))
            # A read-only diagnostic of the original CI launch environment.
            # Its result does not authorize the operation; real guards above do.
            inherited = execute(command, env={**os.environ, "ASA_RETURN_ACL_PATHS": json.dumps([str(fixture.root)])},
                                capture_output=True, text=True, encoding="utf-8", errors="replace")
            print("WINDOWS_ACL_INHERITED_ENV_DIAGNOSTIC " + json.dumps({"exitCode": inherited.returncode,
                  "modulePathPresent": any(key.casefold() == "psmodulepath" for key in os.environ),
                  "stderr": inherited.stderr[:2048] if inherited.returncode else ""}))


class ObserverFixture(Fixture):
    """Exercise the canonical container/volume/private-env guards after stopping."""
    secret = "SYNTHETIC-OBSERVER-SECRET-MUST-NOT-BE-EVIDENCE"

    def __init__(self, root):
        super().__init__(root)
        self.events, self.extra_records, self.manager = [], [], None
        self.records["api"]["id"] = "a" * 64
        for service, record in self.records.items():
            record["labels"] = {"com.docker.compose.project": self.project, "com.docker.compose.service": service,
                                "com.docker.compose.project.working_dir": str(self.root),
                                "com.docker.compose.project.config_files": ",".join(str(self.root / name) for name in self.files)}
            record["mounts"] = []
        for service, destination in (("postgres", "/var/lib/postgresql/data"), ("minio", "/data")):
            self.records[service]["mounts"] = [{"Type": "volume", "Destination": destination,
                                               "Name": self.volumes[service + "-data"]["Name"]}]
        self.database_url = "postgres://synthetic:" + self.secret + "@postgres:5432/asalab"
        self.private_env = {"postgres": {"POSTGRES_DB": "asalab", "POSTGRES_PASSWORD": self.secret},
                            "api": {"APP_DATABASE_URL": self.database_url}}

    def config(self):
        config = super().config()
        config["services"]["postgres"]["environment"] = {"POSTGRES_DB": "asalab"}
        config["services"]["api"]["environment"]["APP_DATABASE_URL"] = self.database_url
        config["services"]["migration"]["environment"].update(
            MIGRATION_DATABASE_URL=self.database_url,
            MIGRATION_EXPECT_DATABASE="asalab", MIGRATION_CONFIRM="APPLY:asalab")
        for service, destination in (("postgres", "/var/lib/postgresql/data"), ("minio", "/data")):
            config["services"][service]["volumes"] = [{"type": "volume", "source": service + "-data", "target": destination}]
        return config

    def stopped(self, event):
        if self.manager is not None and self.manager.poll() is None:
            raise AssertionError("Full installation access while the manager is alive: " + event)
        self.events.append(event)

    def identity(self, existing=True):
        self.stopped("identity")
        return system.Installation.identity(self, existing)

    def containers(self):
        return copy.deepcopy([*self.records.values(), *self.extra_records])

    data_identity = system.Installation.data_identity

    def container_environment(self, record):
        def private_run(command, **kwargs):
            self.stopped("private-env")
            assert command == ["docker", "inspect", "--format", "{{json .Config.Env}}", record["id"]]
            assert kwargs == {"capture": True}
            service = next(name for name, item in self.records.items() if item["id"] == record["id"])
            return json.dumps([key + "=" + value for key, value in self.private_env[service].items()])
        with patch.object(system, "run", private_run):
            return system.Installation.container_environment(self, record)


class ObserverHarness(contextlib.ExitStack):
    """Real eligibility/journal and canonical data guards, simulated transport."""
    def __init__(self, action="rollback"):
        super().__init__()
        temporary = self.enter_context(tempfile.TemporaryDirectory(prefix="asa observer "))
        self.fixture = ObserverFixture(Path(temporary) / "app")
        self.action, self.phase = action, "rollback_api" if action == "rollback" else "forward_api"
        self.output = io.StringIO()
        self.enter_context(contextlib.redirect_stdout(self.output))
        for target, replacement in (("_clean", lambda root: None), ("tool_identity", lambda install: self.fixture.tool),
                                    ("_images", lambda previous, selected: self.fixture.images),
                                    ("_ci_identity", lambda release_value: {"revision": release_value["revision"]}),
                                    ("_tool_ci", lambda *args: {"revision": self.fixture.tool["revision"]}),
                                    ("run", self.fixture.docker)):
            self.enter_context(patch.object(ar, target, replacement))
        self.enter_context(patch.object(ar.releases, "validate_resolved_images", lambda install, release_value: install.config()))
        self.backup = self.fixture.backup()
        self.candidate = ar.prepare_candidate(self.fixture, self.fixture.selected, DIGEST)
        self.expected = self.fixture.previous if action == "rollback" else self.fixture.selected
        self.process = SimpleNamespace(returncode=None, pid=12345)
        self.process.poll = lambda: self.process.returncode
        self.observations, self.after_observation, self.after_stop = [], lambda: None, lambda: None
        self.stop_attempts, self.stop_calls = 0, 0
        self.log = Path(temporary) / "manager.log"
        # Keep native Windows ACL subprocesses and their clock unpatched.
        self.popen = Mock(side_effect=self.spawn)
        child_transport = SimpleNamespace(Popen=self.popen, STDOUT=subprocess.STDOUT,
                                          CREATE_NEW_PROCESS_GROUP=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
        self.enter_context(patch.object(native_driver, "subprocess", child_transport))
        self.enter_context(patch.object(native_driver, "run", self.observe))
        self.enter_context(patch.object(native_driver, "terminate_owned_process", self.stop))
        self.enter_context(patch.object(native_driver, "Installation", self.installation))
        self.clock = SimpleNamespace(monotonic=native_driver.time.monotonic, sleep=lambda seconds: None)
        self.enter_context(patch.object(native_driver, "time", self.clock))
        inspect = ar.inspect
        def guarded_inspect(install):
            self.fixture.stopped("inspect")
            return inspect(install)
        self.enter_context(patch.object(ar, "inspect", guarded_inspect))

    def spawn(self, command, **kwargs):
        assert command[2] == self.action and kwargs.get("stdout") is not None
        if os.name == "nt":
            assert kwargs.get("creationflags") == subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            assert kwargs.get("start_new_session") is True
        fixture = self.fixture
        fixture.head = ar.PRODUCT
        ar.releases.apply_release_environment(fixture, fixture.selected)
        operation = {"phase": "switch", "previous": {"revision": ar.PREVIOUS, "schema": 304},
                     "selected": fixture.selected, "backup": str(self.backup), "deploymentDigest": DIGEST}
        journal = ar.begin(fixture, self.candidate, self.backup, operation)
        ar._write(fixture.state / "maintenance.json", operation)
        ar._advance(fixture, journal, self.phase)
        fixture.head = self.expected["revision"]
        ar.releases.apply_release_environment(fixture, self.expected)
        fixture.records["api"]["image"] = self.expected["images"]["api"]
        fixture.events.clear()
        fixture.manager = self.process
        return self.process

    def observation(self, **changes):
        return json.dumps({"id": "a" * 64, "image": self.expected["images"]["api"], "state": "running",
                           "project": self.fixture.project, "service": "api", **changes})

    def observe(self, command, **kwargs):
        assert command[:4] == ["docker", "ps", "--all", "--no-trunc"]
        assert command[4:8] == ["--filter", "label=com.docker.compose.project=" + self.fixture.project,
                                "--filter", "label=com.docker.compose.service=api"]
        assert command[8] == "--format" and kwargs == {"capture": True}
        assert ".Config.Env" not in command[9]
        self.fixture.events.append("ps")
        result = self.observations.pop(0) if self.observations else self.observation()
        if isinstance(result, Exception):
            raise result
        self.after_observation()
        return result

    def stop(self, process):
        assert process is self.process
        self.stop_calls += 1
        if process.poll() is not None:
            return False
        self.stop_attempts += 1
        self.fixture.events.append("stop")
        process.returncode = -9
        self.after_stop()
        return True

    def installation(self, root, profile):
        assert root == self.fixture.root and profile == "dev"
        self.fixture.stopped("installation")
        return self.fixture

    def run(self, **kwargs):
        return native_driver.cli(self.fixture.root.parent / "tools", self.fixture.root, self.action, self.log,
                                 selected_digest=DIGEST, interruption=self.phase,
                                 expected_revision=kwargs.get("expected_revision", self.expected["revision"]))

    def change_journal(self, key):
        journal = ar.load_journal(self.fixture)
        if key == "phase":
            ar._advance(self.fixture, journal, "rollback_web" if self.action == "rollback" else "forward_web")
        else:
            if key == "id": journal["id"] = "f" * 32
            if key == "eligibility": journal["eligibility"]["binding"]["project"] += "-changed"
            ar._write(self.fixture.state / ar.JOURNAL, journal)


class NativeObserverTests(unittest.TestCase):
    def test_missing_old_or_starting_api_is_polled_before_stop_and_all_canonical_guards(self):
        for action in ("update", "rollback"):
            with self.subTest(action=action), ObserverHarness(action) as trial:
                other = trial.fixture.selected if action == "rollback" else trial.fixture.previous
                trial.observations = ["", trial.observation(image=other["images"]["api"]), trial.observation(state="created")]
                evidence = trial.run()
                events = trial.fixture.events
                self.assertEqual(events[:7], ["ps", "ps", "ps", "ps", "stop", "installation", "inspect"])
                self.assertEqual(events.count("identity"), 2)
                self.assertEqual(events.count("private-env"), 4)
                self.assertEqual((trial.stop_attempts, trial.stop_calls, trial.popen.call_count), (1, 2, 1))
                self.assertEqual(evidence, {"phase": trial.phase, "operationId": ar.load_journal(trial.fixture)["id"],
                                           "source": trial.expected["revision"], "apiImage": trial.expected["images"]["api"],
                                           "apiContainer": "a" * 64, "postgresContainer": "original-postgres", "managerExitCode": -9})
                self.assertNotIn(trial.fixture.secret, json.dumps(evidence) + trial.log.read_text() + trial.output.getvalue()
                                 + json.dumps(trial.fixture.records))

    def test_malformed_duplicate_or_foreign_observation_fails_and_stops_only_owned_child(self):
        for case in ("json", "duplicate", "shape", "id", "state", "project", "service"):
            with self.subTest(case=case), ObserverHarness() as trial:
                outputs = {"json": "{", "duplicate": trial.observation() + "\n" + trial.observation(), "shape": "[]",
                           "id": trial.observation(id="a" * 12), "state": trial.observation(state="unknown"),
                           "project": trial.observation(project="asa-lab-foreign"), "service": trial.observation(service="web")}
                trial.observations = [outputs[case]]
                with self.assertRaises(Blocked) as denied: trial.run()
                self.assertEqual(denied.exception.code, "FIXTURE_OBSERVATION")
                self.assertEqual(trial.fixture.events, ["ps", "stop"])
                self.assertEqual((trial.stop_attempts, trial.popen.call_count), (1, 1))

    def test_unknown_docker_command_error_is_fatal_even_with_a_prior_retry_marker(self):
        for moment in ("observation", "private-env"):
            with self.subTest(moment=moment), ObserverHarness() as trial:
                trial.log.write_text("BLOCKED RETRY_NEW_MANAGER: older synthetic command\n", encoding="utf-8")
                failure = Blocked("COMMAND", "Unknown Docker failure", "Retain fixture")
                if moment == "observation": trial.observations = [failure]
                if moment == "private-env":
                    trial.after_stop = lambda: trial.enter_context(patch.object(trial.fixture, "container_environment", side_effect=failure))
                with self.assertRaises(Blocked) as denied: trial.run()
                self.assertEqual(denied.exception.code, "COMMAND")
                self.assertEqual((trial.stop_attempts, trial.popen.call_count), (1, 1))
                if moment == "observation": self.assertEqual(trial.fixture.events, ["ps", "stop"])

    def test_api_replaced_removed_or_stopped_after_observation_never_becomes_evidence(self):
        for case in ("replaced", "removed", "stopped", "image"):
            with self.subTest(case=case), ObserverHarness() as trial:
                def change():
                    api = trial.fixture.records["api"]
                    if case == "replaced": api["id"] = "b" * 64
                    if case == "removed": del trial.fixture.records["api"]
                    if case == "stopped": api["running"] = False
                    if case == "image": api["image"] = trial.fixture.selected["images"]["api"]
                trial.after_stop = change
                with self.assertRaises(Blocked) as denied: trial.run()
                self.assertEqual(denied.exception.code, "FIXTURE_INTERRUPTION")
                self.assertEqual((trial.stop_attempts, trial.popen.call_count), (1, 1))

    def test_full_canonical_guards_reject_data_source_root_config_and_foreign_drift(self):
        expected_codes = {"postgres": "ROLLBACK_DRIFT", "volume": "ROLLBACK_DRIFT", "mount": "IDENTITY_VOLUME",
                          "env": "ROLLBACK_DRIFT", "database": "DATABASE_TARGET", "source": "ROLLBACK_SOURCE",
                          "root": "IDENTITY_ROOT", "files": "IDENTITY_FILES", "foreign": "IDENTITY_PROJECT",
                          "duplicate": "IDENTITY_DUPLICATE", "config": "ROLLBACK_DRIFT", "backup": "BACKUP_HASH",
                          "schema": "ROLLBACK_DRIFT", "tool": "ROLLBACK_TOOLING", "image": "ROLLBACK_IMAGE"}
        for case, code in expected_codes.items():
            with self.subTest(case=case), ObserverHarness() as trial:
                fixture = trial.fixture
                def drift():
                    if case == "postgres": fixture.records["postgres"]["id"] = "replacement-postgres"
                    if case == "volume": fixture.volumes["minio-data"]["CreatedAt"] = "recreated"
                    if case == "mount": fixture.records["minio"]["mounts"][0]["Name"] = "foreign-volume"
                    if case == "env": (fixture.root / ".env").write_bytes(b"changed\n")
                    if case == "database": fixture.private_env["api"]["APP_DATABASE_URL"] = "postgres://synthetic@postgres:5432/other"
                    if case == "source": fixture.head = "f" * 40
                    if case == "root": fixture.records["api"]["labels"]["com.docker.compose.project.working_dir"] = str(fixture.root.parent)
                    if case == "files": fixture.records["api"]["labels"]["com.docker.compose.project.config_files"] = str(fixture.root / "compose.yaml")
                    if case == "foreign": fixture.records["api"]["labels"]["com.docker.compose.project"] = "asa-lab-foreign"
                    if case == "duplicate": fixture.extra_records.append(copy.deepcopy(fixture.records["api"]))
                    if case == "config": fixture.config_drift = True
                    if case == "backup": (trial.backup / "database.dump").write_bytes(b"changed")
                    if case == "schema": fixture.history[0]["checksum"] = "f" * 64
                    if case == "tool": fixture.tool = {**fixture.tool, "revision": "f" * 40}
                    if case == "image": fixture.images["ids"]["previous"]["api"] = "sha256:" + "f" * 64
                trial.after_stop = drift
                with self.assertRaises(Blocked) as denied: trial.run()
                self.assertEqual(denied.exception.code, code)
                self.assertIn("inspect", fixture.events)
                self.assertEqual((trial.stop_attempts, trial.popen.call_count), (1, 1))

    def test_operation_phase_or_eligibility_change_before_or_after_stop_is_fatal(self):
        for moment in ("after_observation", "after_stop"):
            for key in ("id", "phase", "eligibility"):
                with self.subTest(moment=moment, key=key), ObserverHarness() as trial:
                    setattr(trial, moment, lambda: trial.change_journal(key))
                    with self.assertRaises(Blocked): trial.run()
                    self.assertEqual((trial.stop_attempts, trial.popen.call_count), (1, 1))
                    if moment == "after_observation": self.assertNotIn("installation", trial.fixture.events)

    def test_journal_changed_during_final_identity_is_not_accepted(self):
        with ObserverHarness() as trial:
            identity = trial.fixture.identity
            def changed_identity():
                result = identity()
                if trial.fixture.manager is not None and trial.fixture.events.count("identity") == 2:
                    trial.change_journal("phase")
                return result
            with patch.object(trial.fixture, "identity", changed_identity):
                with self.assertRaises(Blocked) as denied: trial.run()
            self.assertEqual(denied.exception.code, "FIXTURE_INTERRUPTION")

    def test_self_exit_zero_exit_or_missed_window_is_not_an_interruption(self):
        for case in ("self-zero", "self-nonzero", "stop-zero", "missed"):
            with self.subTest(case=case), ObserverHarness() as trial:
                if case.startswith("self"):
                    trial.after_observation = lambda: setattr(trial.process, "returncode", 0 if case == "self-zero" else 7)
                if case == "stop-zero": trial.after_stop = lambda: setattr(trial.process, "returncode", 0)
                if case == "missed":
                    trial.observations = [""]
                    trial.after_observation = lambda: setattr(trial.process, "returncode", 0)
                with self.assertRaises(Blocked) as denied: trial.run()
                self.assertEqual(denied.exception.code, "FIXTURE_INTERRUPTION")
                self.assertNotIn("installation", trial.fixture.events)
                self.assertEqual(trial.stop_attempts, 1 if case == "stop-zero" else 0)

    def test_deadline_before_or_during_observation_stops_child_without_full_inspection(self):
        for times in ([0, 1800], [0, 1, 1800]):
            with self.subTest(times=times), ObserverHarness() as trial:
                with patch.object(trial.clock, "monotonic", side_effect=times):
                    with self.assertRaises(Blocked) as denied: trial.run()
                self.assertEqual(denied.exception.code, "FIXTURE_TIMEOUT")
                self.assertNotIn("installation", trial.fixture.events)
                self.assertEqual(trial.stop_attempts, 1)

    def test_caller_revision_must_match_the_exact_journal_release(self):
        for case in ("caller", "source"):
            with self.subTest(case=case), ObserverHarness() as trial:
                if case == "source": trial.after_stop = lambda: setattr(trial.fixture, "head", ar.PRODUCT)
                with self.assertRaises(Blocked) as denied:
                    trial.run(expected_revision=ar.PRODUCT if case == "caller" else ar.PREVIOUS)
                self.assertEqual(denied.exception.code, "FIXTURE_INTERRUPTION")
                self.assertEqual(trial.stop_attempts, 1)


class NativeBoundaryTests(unittest.TestCase):
    def test_tooling_rejects_nested_git_discovery_and_untracked_or_hidden_bytes(self):
        def git(root, *args):
            return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True).stdout.strip()
        with tempfile.TemporaryDirectory(prefix="asa-tools-proof-") as temporary:
            root = Path(temporary) / "approved"
            root.mkdir()
            git(root, "init")
            git(root, "config", "user.name", "Synthetic return test")
            git(root, "config", "user.email", "synthetic@example.invalid")
            git(root, "remote", "add", "origin", "https://github.com/spikeal8-maker/asa-lab.git")
            paths = ["tools/asa_manager.py", *(f"tools/deployment/{name}.py" for name in
                     ("application_rollback", "contracts", "system", "paths", "releases", "backup", "collector"))]
            for name in paths:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"# synthetic tracked tools\n")
            (root / ".gitignore").write_text("copies/\n", encoding="utf-8")
            git(root, "add", ".")
            git(root, "commit", "-qm", "synthetic pinned tooling")
            git(root, "update-ref", "refs/remotes/origin/main", "HEAD")
            installation = SimpleNamespace(root=Path(temporary) / "installation")
            # ACL enforcement has its own native/policy tests; this test proves
            # Git origin/root/blob attestation on both Windows and Linux.
            with patch.object(ar, "__file__", str(root / "tools/deployment/application_rollback.py")), patch.object(ar, "attest_access"):
                self.assertEqual(ar.tool_identity(installation)["root"], str(root.resolve()))
                git(root, "update-index", "--assume-unchanged", "tools/asa_manager.py")
                (root / "tools/asa_manager.py").write_bytes(b"# hidden modified bytes\n")
                self.assertEqual(git(root, "status", "--porcelain"), "")
                with self.assertRaises(Blocked) as denied: ar.tool_identity(installation)
                self.assertEqual(denied.exception.code, "ROLLBACK_TOOLING")
            nested = root / "copies" / "ignored-tools"
            path = nested / "tools/deployment/application_rollback.py"
            path.parent.mkdir(parents=True)
            path.write_text("# untracked copied tool", encoding="utf-8")
            with patch.object(ar, "__file__", str(path)), patch.object(ar, "attest_access"):
                with self.assertRaises(Blocked) as denied: ar.tool_identity(installation)
                self.assertEqual(denied.exception.code, "ROLLBACK_GIT_ROOT")

    def test_windows_acl_policy_refuses_foreign_modify_and_private_read(self):
        current, other = "S-1-5-21-10-20-30-1001", "S-1-5-11"
        path = Path("canonical")
        trusted = {"sid": current, "kind": "Allow", "rights": 2032127, "inheritOnly": False}
        def record(rights):
            return {"current": current, "rows": [{"path": str(path), "owner": current, "rules": [trusted,
                {"sid": other, "kind": "Allow", "rights": rights, "inheritOnly": False}]}]}
        ar.validate_windows_acls(record(1179817), [(path, False)])  # ReadAndExecute is safe for public source.
        for rights in (1245631, 2, 0x40, 0x40000, 0x80000, 0x40000000):
            with self.subTest(rights=rights), self.assertRaises(Blocked):
                ar.validate_windows_acls(record(rights), [(path, False)])
        with self.assertRaises(Blocked): ar.validate_windows_acls(record(1179817), [(path, True)])
        payload = {"current": current, "rows": [{"path": str(path), "owner": current, "rules": [trusted]}]}
        ar.validate_windows_acls(payload, [(path, True)])
        payload["rows"][0]["owner"] = other
        with self.assertRaises(Blocked): ar.validate_windows_acls(payload, [(path, False)])

    def test_actual_binary_digest_contract_not_dockerfile_text(self):
        correct = "\n".join(f"{sha}  {path}" for path, sha in ar.MINIO_BINARIES.items())
        with patch.object(ar, "run", return_value=correct) as execute:
            self.assertEqual(ar.minio_binaries("sha256:" + "a" * 64), ar.MINIO_BINARIES)
        command = execute.call_args.args[0]
        self.assertIn("--network", command)
        self.assertIn("none", command)
        self.assertNotIn("--volume", command)
        with patch.object(ar, "run", return_value=correct.replace(next(iter(ar.MINIO_BINARIES.values())), "0" * 64)):
            with self.assertRaises(Blocked): ar.minio_binaries("sha256:" + "a" * 64)

    def test_immutable_image_id_and_revision_checked(self):
        reference = ar.REGISTRY + "/api@sha256:" + "a" * 64
        value = {"id": "sha256:" + "b" * 64, "digests": [reference], "os": "linux", "architecture": "amd64",
                 "labels": {"org.opencontainers.image.revision": ar.PREVIOUS}}
        with patch.object(ar, "run", return_value=json.dumps(value)):
            self.assertEqual(ar.image_identity(reference, ar.PREVIOUS), value["id"])
        value["digests"] = []
        with patch.object(ar, "run", return_value=json.dumps(value)), self.assertRaises(Blocked):
            ar.image_identity(reference, ar.PREVIOUS)

    def test_production_requires_exact_successful_native_pair_run(self):
        tool = {"revision": "b" * 40}
        general = {"id": 21, "run_attempt": 1}
        run = {"id": 22, "run_attempt": 1, "run_number": 3, "head_sha": tool["revision"], "head_branch": "main",
               "path": ".github/workflows/application-rollback.yml", "event": "workflow_dispatch", "display_title": "P0 return " + DIGEST}
        with patch.object(ar.releases, "assert_general_ci"), patch.object(ar.releases, "_latest_general", return_value=general), \
                patch.object(ar.releases, "_ci_pages", return_value=[run]), patch.object(ar.releases, "_successful_jobs") as jobs:
            proof = ar._tool_ci(tool, True, DIGEST)
            self.assertEqual(proof["nativeQualification"]["runId"], 22)
            self.assertIn("native official images", jobs.call_args.args[1])
            with self.assertRaises(Blocked): ar._tool_ci(tool, True, "sha256:" + "f" * 64)

    def test_native_path_atomic_replace_and_argument_roundtrip(self):
        with tempfile.TemporaryDirectory(prefix="ASA native path ") as temporary:
            root = Path(temporary)
            path = root / "private state" / "journal.json"
            ar._write(path, {"phase": "first"})
            ar._write(path, {"phase": "second"})
            script = "import json,pathlib,sys; p=pathlib.Path(sys.argv[1]); print(json.dumps({'path':str(p),'value':json.loads(p.read_text())}))"
            completed = subprocess.run([sys.executable, "-c", script, str(path)], check=True, capture_output=True, text=True)
            observed = json.loads(completed.stdout)
            self.assertEqual(observed["path"], str(path))
            self.assertEqual(observed["value"], {"phase": "second"})
            self.assertFalse(list(path.parent.glob("*.tmp")))

    def test_native_owned_process_termination(self):
        from deployment.ci_application_rollback import terminate_owned_process
        options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
        process = subprocess.Popen([sys.executable, "-c", "import time; print('ready',flush=True); time.sleep(60)"],
                                   stdout=subprocess.PIPE, text=True, **options)
        try:
            self.assertEqual(process.stdout.readline().strip(), "ready")
            self.assertTrue(terminate_owned_process(process))
            self.assertIsNotNone(process.returncode)
            self.assertNotEqual(process.returncode, 0)
            self.assertFalse(terminate_owned_process(process))
        finally:
            if process.poll() is None: terminate_owned_process(process)
            process.stdout.close()

    @unittest.skipIf(os.name == "nt", "POSIX process-group disappearance; Windows uses taskkill")
    def test_owned_process_disappearing_before_signal_is_not_an_interruption(self):
        process = Mock(pid=12345)
        process.poll.return_value = None
        with patch.object(native_driver.os, "killpg", side_effect=ProcessLookupError) as signal_group:
            self.assertFalse(native_driver.terminate_owned_process(process))
        signal_group.assert_called_once_with(process.pid, native_driver.signal.SIGKILL)
        process.wait.assert_called_once_with(timeout=30)

    def test_symlink_record_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target, link = root / "target.json", root / "link.json"
            target.write_text("{}", encoding="utf-8")
            try:
                link.symlink_to(target)
            except OSError:
                self.skipTest("This Windows host does not grant symlink creation")
            with self.assertRaises(ValueError): ar._read(link)
            target.unlink()
            with self.assertRaises(ValueError): ar.attest_access([(link, False)])

    def test_cli_requires_explicit_root_and_rejects_unscoped_flags(self):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(manager.main(["rollback"]), 2)
            self.assertEqual(manager.main(["backup", "--require-application-rollback"]), 2)
            self.assertEqual(manager.main(["update", "--scheduled", "--require-application-rollback"]), 2)


class NativeFixtureProjectTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.project = native_driver.new_fixture_project()
        self.nonce = "1" * 32
        (self.root / ".env").write_bytes(b"SYNTHETIC=fixture-only\n")
        self.env_hash = ar.file_digest(self.root / ".env")
        self.current = SimpleNamespace(project=self.project, state=self.root / ".asa",
                                       identity=Mock(), compose=Mock())
        self.marker = {"nonce": self.nonce, "root": str(self.root), "project": self.project}
        ar._write(self.current.state / "qualification-fixture.json", self.marker)
        self.installation = self.enterContext(patch.object(native_driver, "Installation", return_value=self.current))
        self.clean = self.enterContext(patch.object(ar, "_clean"))

    def cleanup_fixture(self):
        native_driver.cleanup_fixture(self.root, self.project, self.nonce, self.env_hash)

    def assert_no_cleanup(self):
        self.clean.assert_not_called()
        self.current.identity.assert_not_called()
        self.current.compose.assert_not_called()

    def test_generated_project_is_accepted_by_real_fresh_install_contract(self):
        spec = fresh_options(self.project, 18610, 18613)
        self.assertEqual(spec["project"], self.project)
        self.assertEqual(spec["origin"], "http://127.0.0.1:18610")
        self.assertNotEqual(self.project, native_driver.new_fixture_project())
        with self.assertRaises(Blocked) as failure:
            fresh_options("asa-p0-return-800f041d4671", 18610, 18613)
        self.assertEqual(failure.exception.code, "FRESH_PROJECT")

    def test_cleanup_accepts_only_its_matching_synthetic_fixture(self):
        self.cleanup_fixture()
        self.installation.assert_called_once_with(self.root, "dev")
        self.clean.assert_called_once_with(self.root)
        self.current.identity.assert_called_once_with(existing=False)
        self.current.compose.assert_called_once_with("down", "--volumes", "--remove-orphans")

    def test_cleanup_rejects_production_legacy_and_malformed_projects(self):
        for project in ("asa-lab-dev", "asa-p0-return-800f041d4671", "asa-lab-p0-return-",
                        "asa-lab-p0-return-g00f041d4671", "asa-lab-p0-return-800f041d4671-extra"):
            with self.subTest(project=project):
                self.project = self.current.project = project
                ar._write(self.current.state / "qualification-fixture.json", {**self.marker, "project": project})
                with self.assertRaises(Blocked) as failure:
                    self.cleanup_fixture()
                self.assertEqual(failure.exception.code, "FIXTURE_CLEANUP")
                self.assert_no_cleanup()

    def test_cleanup_rejects_each_foreign_ownership_field(self):
        for field, value in (("nonce", "2" * 32), ("root", str(self.root / "other")),
                             ("project", native_driver.new_fixture_project())):
            with self.subTest(field=field):
                ar._write(self.current.state / "qualification-fixture.json", {**self.marker, field: value})
                with self.assertRaises(Blocked) as failure:
                    self.cleanup_fixture()
                self.assertEqual(failure.exception.code, "FIXTURE_CLEANUP")
                self.assert_no_cleanup()

    def test_cleanup_rejects_runtime_project_drift(self):
        self.current.project = "asa-lab-dev"
        with self.assertRaises(Blocked) as failure:
            self.cleanup_fixture()
        self.assertEqual(failure.exception.code, "FIXTURE_CLEANUP")
        self.assert_no_cleanup()

    def test_cleanup_rejects_private_configuration_drift(self):
        (self.root / ".env").write_bytes(b"SYNTHETIC=changed\n")
        with self.assertRaises(Blocked) as failure:
            self.cleanup_fixture()
        self.assertEqual(failure.exception.code, "FIXTURE_CLEANUP")
        self.assert_no_cleanup()

    def test_cleanup_preserves_dirty_fixture_before_docker_inspection(self):
        self.clean.side_effect = Blocked("ROLLBACK_DIRTY", "Fixture changed.", "Preserve it.")
        with self.assertRaises(Blocked):
            self.cleanup_fixture()
        self.current.identity.assert_not_called()
        self.current.compose.assert_not_called()

    def test_cleanup_preserves_fixture_when_container_identity_is_unknown(self):
        self.current.identity.side_effect = Blocked("IDENTITY_PROJECT", "Foreign container.", "Preserve it.")
        with self.assertRaises(Blocked):
            self.cleanup_fixture()
        self.current.compose.assert_not_called()


class GitDiffFramingTests(unittest.TestCase):
    def test_empty_diff_and_status_framing_preserve_path_whitespace(self):
        fixture = SimpleNamespace(git=Mock(return_value=""))
        self.assertEqual(ar._changed_paths(fixture, "before", "after"), set())
        paths = (" leading", "\tleading", "\nleading", "trailing \t\n")
        fixture.git.return_value = "".join(f"{status}\0{path}\0" for status, path in zip("ADMT", paths))
        self.assertEqual(ar._changed_paths(fixture, "before", "after"), set(paths))

    def test_malformed_or_unexpected_diff_records_are_refused(self):
        malformed = (" ", "\n", "\0", "A\0", "A\0path", "A\0\0", "A\0path\0M\0",
                     "A\0path\0\0", "A\0path\0M\0other", "R100\0old\0new\0",
                     "C100\0old\0new\0", "R\0path\0", "C\0path\0", "X\0path\0",
                     "U\0path\0", "B\0path\0", "M100\0path\0", "AD\0path\0",
                     "A\0valid\0X\0other\0", "M \0path\0")
        for value in malformed:
            with self.subTest(value=value):
                fixture = SimpleNamespace(git=Mock(return_value=value))
                with self.assertRaises(Blocked) as denied:
                    ar._changed_paths(fixture, "before", "after")
                self.assertEqual(denied.exception.code, "ROLLBACK_PRODUCT")


class SourceHistory:
    """Actual commits/merges in a fresh synthetic Git repository; no Docker."""
    product_path = "apps/api/src/preserved-product.ts"
    delivery_path = "tools/deployment/application_rollback.py"
    database_progress_path = "tools/test_database_progress.py"
    files = ("compose.yaml",)

    def __init__(self, root):
        self.root = root
        self.git("init", "--quiet", "--initial-branch=main", "--object-format=sha1")
        for key, value in (("user.name", "Source boundary test"), ("user.email", "source-test@example.invalid"),
                           ("commit.gpgsign", "false"), ("core.autocrlf", "false"),
                           ("core.filemode", "true"), ("diff.renames", "true")):
            self.git("config", key, value)
        initial = {"compose.yaml": "services: {}\n", "migrations/0304.sql": "select 1;\n",
                   "tools/migrate.mjs": "// unchanged migration runner\n",
                   "infra/minio/Dockerfile": "FROM scratch\n",
                   self.database_progress_path: "# original historical SQL fixture\n",
                   self.product_path: 'export const preservedProduct = "keep this source";\n'}
        initial.update({path: f"before collector: {path}\n" for path in ar.COLLECTOR_BLOBS})
        self.lazy_original_contents = {path: f"before lazy work context: {path}\n" for path in ar.LAZY_CONTEXT_BLOBS}
        initial.update(self.lazy_original_contents)
        for path, content in initial.items():
            self.write(path, content)
        self.previous = self.commit("previous product")
        self.product = self.commit("accepted P0 product")
        for path in ar.BASELINE_DOCS:
            self.write(path, f"accepted baseline: {path}\n")
        self.baseline = self.commit("accepted documentation baseline")
        self.git("switch", "--quiet", "-c", "accepted-collector")
        self.collector_contents = {path: f"accepted collector: {path}\n" for path in ar.COLLECTOR_BLOBS}
        for path, content in self.collector_contents.items():
            self.write(path, content)
        self.collector = self.commit("independently accepted collector")
        self.collector_blobs = {path: self.git("rev-parse", f"{self.collector}:{path}")
                                for path in self.collector_contents}
        self.git("switch", "--quiet", "-c", "accepted-lazy-context", self.baseline)
        self.lazy_contents = {path: f"accepted lazy work context: {path}\n" for path in ar.LAZY_CONTEXT_BLOBS}
        for path, content in self.lazy_contents.items():
            self.write(path, content)
        self.lazy_context = self.commit("independently accepted lazy work context")
        self.lazy_blobs = {path: self.git("rev-parse", f"{self.lazy_context}:{path}")
                           for path in self.lazy_contents}
        self.git("switch", "--quiet", "main")
        self.write(self.delivery_path, "# reviewed return tooling\n")
        self.delivery_only = self.commit("reviewed return tooling")
        self.git("merge", "--no-ff", "--no-edit", "-m", "combined accepted inputs", self.collector)
        self.combined = self.git("rev-parse", "HEAD")

    def git(self, *args):
        return ar._git(self.root, *args)

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content.encode("utf-8"))

    def commit(self, message, *, stage=True):
        # This index belongs only to this newly created temporary fixture.
        if stage:
            self.git("add", "--all")
        self.git("commit", "--quiet", "--allow-empty", "-m", message)
        return self.git("rev-parse", "HEAD")

    def validate(self, target=None):
        target = target or self.git("rev-parse", "HEAD")
        self.git("update-ref", "refs/remotes/origin/main", target)
        return ar.validate_pair(self, release(self.previous, ar.PREVIOUS_IMAGES), release(target, ar.PRODUCT_IMAGES))

    def merge_lazy_context(self):
        self.git("merge", "--quiet", "--no-ff", "--no-edit", self.lazy_context)
        return self.git("rev-parse", "HEAD")

    def add_database_progress_history(self):
        self.git("switch", "--quiet", "-c", "accepted-database-progress", self.baseline)
        self.database_progress_content = "# accepted historical SQL fixture\n"
        self.write(self.database_progress_path, self.database_progress_content)
        self.database_progress = self.commit("independently accepted historical SQL fixture")
        self.database_progress_blob = self.git("rev-parse", f"{self.database_progress}:{self.database_progress_path}")
        self.git("switch", "--quiet", "main")

    def merge_database_progress(self):
        self.git("merge", "--quiet", "--no-ff", "--no-edit", self.database_progress)
        return self.git("rev-parse", "HEAD")

    def commit_extra_blob(self, path, blob):
        # Build only Git objects: these names need not be representable in a
        # Windows worktree. The existing fixture's files/index are untouched.
        def add_entry(tree, parts):
            raw = subprocess.check_output(["git", "ls-tree", "-z", tree], cwd=self.root) if tree else b""
            entries = {row.split(b"\t", 1)[1]: row for row in raw.split(b"\0") if row}
            name = parts[0].encode("utf-8")
            if len(parts) > 1:
                existing = entries.get(name)
                child = existing.split(b"\t", 1)[0].split()[2].decode("ascii") if existing else None
                obj = add_entry(child, parts[1:])
                metadata = b"040000 tree " + obj.encode("ascii")
            else:
                assert name not in entries
                metadata = b"100644 blob " + blob.encode("ascii")
            entries[name] = metadata + b"\t" + name
            result = subprocess.run(["git", "mktree", "-z"], cwd=self.root,
                                    input=b"\0".join(entries.values()) + b"\0",
                                    capture_output=True, check=True)
            return result.stdout.decode("ascii").strip()

        tree = add_entry(self.git("rev-parse", "HEAD^{tree}"), path.split("/"))
        return self.git("commit-tree", tree, "-p", "HEAD", "-m", "unqualified extra path")


class SourceBoundaryTests(unittest.TestCase):
    @contextlib.contextmanager
    def history(self):
        with tempfile.TemporaryDirectory(prefix="asa source boundary ") as temporary:
            fixture = SourceHistory(Path(temporary))
            with patch.multiple(ar, PREVIOUS=fixture.previous, PRODUCT=fixture.product, BASELINE=fixture.baseline,
                                COLLECTOR_REVISION=fixture.collector, COLLECTOR_BLOBS=fixture.collector_blobs,
                                LAZY_CONTEXT_REVISION=fixture.lazy_context, LAZY_CONTEXT_BLOBS=fixture.lazy_blobs):
                yield fixture

    @contextlib.contextmanager
    def database_progress_history(self):
        with self.history() as fixture:
            fixture.add_database_progress_history()
            with patch.multiple(ar, DATABASE_PROGRESS_REVISION=fixture.database_progress,
                                DATABASE_PROGRESS_BLOBS={fixture.database_progress_path: fixture.database_progress_blob}):
                yield fixture

    def assert_refused(self, fixture, target=None):
        with self.assertRaises(Blocked) as denied:
            fixture.validate(target)
        self.assertEqual(denied.exception.code, "ROLLBACK_PRODUCT")

    def test_exact_product_and_complete_collector_merge_remain_supported(self):
        with self.history() as fixture:
            expected = fixture.validate(fixture.product)
            self.assertEqual(fixture.validate(fixture.combined), expected)
            later = fixture.commit("no further source changes")
            self.assertEqual(fixture.validate(later), expected)

    def test_real_rename_cannot_hide_removed_product_source_in_delivery_path(self):
        with self.history() as fixture:
            destination = "docs/deployment/APPLICATION_ROLLBACK.md"
            fixture.git("mv", fixture.product_path, destination)
            target = fixture.commit("move product source into an allowed delivery path")
            vulnerable = fixture.git("diff", "--name-only", fixture.product, target).splitlines()
            self.assertIn(destination, vulnerable)
            self.assertNotIn(fixture.product_path, vulnerable)
            self.assertFalse((fixture.root / fixture.product_path).exists())
            changed = ar._changed_paths(fixture, fixture.product, target)
            self.assertIn(fixture.product_path, changed)
            self.assertIn(destination, changed)
            self.assert_refused(fixture, target)

    def test_whitespace_in_unqualified_git_paths_is_preserved_and_refused(self):
        names = tuple(prefix + SourceHistory.delivery_path for prefix in (" ", "\t", "\n", "\v", "\f", "\u00a0"))
        names += tuple(SourceHistory.delivery_path + suffix for suffix in (" ", "\t", "\n", " \t\n"))
        for name in names:
            with self.subTest(path=name), self.history() as fixture:
                fixture.merge_lazy_context()
                blob = fixture.git("rev-parse", f"HEAD:{fixture.delivery_path}")
                target = fixture.commit_extra_blob(name, blob)
                raw = subprocess.check_output(["git", "diff", "--no-renames", "--no-ext-diff",
                                               "--ignore-submodules=none", "--name-only", "-z",
                                               fixture.product, target, "--"], cwd=fixture.root)
                exact = {path.decode("utf-8") for path in raw.split(b"\0") if path}
                self.assertIn(name, exact)
                self.assertEqual(ar._changed_paths(fixture, fixture.product, target), exact)
                self.assert_refused(fixture, target)

    def test_foreign_source_edit_delete_copy_mode_and_gitlink_are_refused(self):
        for change in ("edit", "delete", "copy", "mode", "gitlink"):
            with self.subTest(change=change), self.history() as fixture:
                stage = True
                if change == "edit":
                    fixture.write(fixture.product_path, "export const changed = true;\n")
                elif change == "delete":
                    fixture.git("rm", "--", fixture.product_path)
                elif change == "copy":
                    fixture.git("config", "diff.renames", "copies")
                    fixture.write("apps/api/src/unqualified-copy.ts", (fixture.root / fixture.delivery_path).read_text())
                elif change == "mode":
                    fixture.git("update-index", "--chmod=+x", "--", fixture.product_path)
                    stage = False
                else:
                    fixture.git("config", "diff.ignoreSubmodules", "all")
                    fixture.git("update-index", "--cacheinfo", f"160000,{fixture.collector},{fixture.product_path}")
                    stage = False
                target = fixture.commit("unqualified product change", stage=stage)
                self.assert_refused(fixture, target)

    def test_baseline_document_rename_into_delivery_path_remains_refused(self):
        with self.history() as fixture:
            original = sorted(ar.BASELINE_DOCS)[0]
            fixture.git("mv", original, "docs/deployment/APPLICATION_ROLLBACK.md")
            self.assert_refused(fixture, fixture.commit("rename a frozen baseline document"))

    def test_every_collector_blob_is_pinned_after_accepted_ancestry(self):
        for path in ar.COLLECTOR_BLOBS:
            with self.subTest(path=path), self.history() as fixture:
                fixture.write(path, "unreviewed follow-up with the same accepted ancestry\n")
                self.assert_refused(fixture, fixture.commit("collector bytes changed after acceptance"))

    def test_missing_executable_and_symlink_collector_entries_are_refused(self):
        for change in ("delete", "executable", "symlink"):
            with self.subTest(change=change), self.history() as fixture:
                path = "tools/collect_logs.py"
                if change == "delete":
                    fixture.git("rm", "--", path)
                elif change == "executable":
                    fixture.git("update-index", "--chmod=+x", "--", path)
                else:
                    # Construct the Git tree type without Windows symlink privilege.
                    fixture.git("update-index", "--cacheinfo", f"120000,{fixture.collector_blobs[path]},{path}")
                target = fixture.commit("collector entry changed", stage=False)
                self.assert_refused(fixture, target)

    def test_copied_exact_collector_blobs_without_accepted_history_are_refused(self):
        with self.history() as fixture:
            fixture.git("switch", "--quiet", "-c", "copied-without-acceptance", fixture.delivery_only)
            for path, content in fixture.collector_contents.items():
                fixture.write(path, content)
            target = fixture.commit("copy accepted bytes without accepted lineage")
            for path, blob in fixture.collector_blobs.items():
                self.assertEqual(fixture.git("rev-parse", f"{target}:{path}"), blob)
            self.assert_refused(fixture, target)

    def test_delivery_only_descendant_is_not_a_combined_release(self):
        with self.history() as fixture:
            self.assert_refused(fixture, fixture.delivery_only)

    def test_complete_lazy_merge_and_unchanged_descendant_preserve_data_boundary(self):
        with self.history() as fixture:
            expected = fixture.validate(fixture.combined)
            self.assertEqual(fixture.validate(fixture.merge_lazy_context()), expected)
            self.assertEqual(fixture.validate(fixture.commit("unchanged lazy descendant")), expected)

    def test_exact_lazy_bytes_without_accepted_history_are_refused(self):
        with self.history() as fixture:
            for path, content in fixture.lazy_contents.items():
                fixture.write(path, content)
            target = fixture.commit("copy exact lazy bytes without accepted lineage")
            for path, blob in fixture.lazy_blobs.items():
                self.assertEqual(fixture.git("rev-parse", f"{target}:{path}"), blob)
            self.assert_refused(fixture, target)

    def test_lazy_history_without_accepted_collector_remains_refused(self):
        with self.history() as fixture:
            self.assert_refused(fixture, fixture.lazy_context)

    def test_every_lazy_input_edit_and_partial_revert_are_refused(self):
        for path in ar.LAZY_CONTEXT_BLOBS:
            for change in ("edit", "revert"):
                with self.subTest(path=path, change=change), self.history() as fixture:
                    fixture.merge_lazy_context()
                    content = fixture.lazy_original_contents[path] if change == "revert" else "unaccepted lazy change\n"
                    fixture.write(path, content)
                    self.assert_refused(fixture, fixture.commit("partial lazy drift after acceptance"))

    def test_every_lazy_missing_executable_symlink_and_gitlink_entry_is_refused(self):
        for path in ar.LAZY_CONTEXT_BLOBS:
            for change in ("delete", "executable", "symlink", "gitlink"):
                with self.subTest(path=path, change=change), self.history() as fixture:
                    fixture.merge_lazy_context()
                    if change == "delete":
                        fixture.git("rm", "--", path)
                    elif change == "executable":
                        fixture.git("update-index", "--chmod=+x", "--", path)
                    else:
                        mode, obj = ("120000", fixture.lazy_blobs[path]) if change == "symlink" else ("160000", fixture.lazy_context)
                        fixture.git("config", "diff.ignoreSubmodules", "all")
                        fixture.git("update-index", "--cacheinfo", f"{mode},{obj},{path}")
                    self.assert_refused(fixture, fixture.commit("lazy entry type or mode changed", stage=False))

    def test_complete_lazy_revert_preserves_the_previously_supported_collector_only_tree(self):
        with self.history() as fixture:
            expected = fixture.validate(fixture.combined)
            fixture.merge_lazy_context()
            for path, content in fixture.lazy_original_contents.items():
                fixture.write(path, content)
            target = fixture.commit("all four lazy files returned to exact product baseline")
            fixture.git("merge-base", "--is-ancestor", fixture.lazy_context, target)
            self.assertFalse(ar._changed_paths(fixture, fixture.product, target) & ar.LAZY_CONTEXT_BLOBS.keys())
            self.assertEqual(fixture.validate(target), expected)

    def test_foreign_product_rename_into_pinned_lazy_path_remains_refused(self):
        with self.history() as fixture:
            fixture.merge_lazy_context()
            destination = "apps/api/src/learning-work-context.controller.ts"
            fixture.git("rm", "--", destination)
            fixture.git("mv", fixture.product_path, destination)
            target = fixture.commit("rename forbidden product into qualified lazy path")
            changed = ar._changed_paths(fixture, fixture.product, target)
            self.assertIn(fixture.product_path, changed)
            self.assertIn(destination, changed)
            self.assert_refused(fixture, target)

    def test_collector_pins_and_shared_inputs_remain_closed_with_lazy_context(self):
        for path in (*ar.COLLECTOR_BLOBS, "migrations/0304.sql", "compose.yaml", "pnpm-lock.yaml"):
            with self.subTest(path=path), self.history() as fixture:
                fixture.merge_lazy_context()
                fixture.write(path, "unreviewed shared or collector change\n")
                self.assert_refused(fixture, fixture.commit("source outside accepted lazy boundary"))

    def test_lazy_source_identity_does_not_waive_schema_identity(self):
        with self.history() as fixture:
            target = fixture.merge_lazy_context()
            fixture.git("update-ref", "refs/remotes/origin/main", target)
            previous = release(fixture.previous, ar.PREVIOUS_IMAGES)
            selected = release(target, ar.PRODUCT_IMAGES)
            selected["schema"] = 305
            with self.assertRaises(Blocked) as denied:
                ar.validate_pair(fixture, previous, selected)
            self.assertEqual(denied.exception.code, "ROLLBACK_PAIR")

    def test_accepted_database_progress_with_and_without_lazy_context_preserves_data_boundary(self):
        for lazy in (False, True):
            with self.subTest(lazy=lazy), self.database_progress_history() as fixture:
                expected = fixture.validate(fixture.combined)
                if lazy:
                    fixture.merge_lazy_context()
                self.assertEqual(fixture.validate(fixture.merge_database_progress()), expected)
                self.assertEqual(fixture.validate(fixture.commit("unchanged historical SQL fixture descendant")), expected)

    def test_database_progress_pin_keeps_the_full_lazy_revert_supported(self):
        with self.database_progress_history() as fixture:
            expected = fixture.validate(fixture.combined)
            fixture.merge_lazy_context()
            fixture.merge_database_progress()
            for path, content in fixture.lazy_original_contents.items():
                fixture.write(path, content)
            target = fixture.commit("full lazy revert with accepted historical SQL fixture")
            fixture.git("merge-base", "--is-ancestor", fixture.database_progress, target)
            self.assertFalse(ar._changed_paths(fixture, fixture.product, target) & ar.LAZY_CONTEXT_BLOBS.keys())
            self.assertEqual(fixture.validate(target), expected)

    def test_database_progress_edit_delete_mode_type_and_directory_are_refused(self):
        for change in ("edit", "delete", "executable", "symlink", "gitlink", "directory"):
            with self.subTest(change=change), self.database_progress_history() as fixture:
                fixture.merge_lazy_context()
                fixture.merge_database_progress()
                path = fixture.database_progress_path
                stage = True
                if change == "edit":
                    fixture.write(path, "unreviewed historical SQL fixture\n")
                elif change == "delete":
                    fixture.git("rm", "--", path)
                elif change == "directory":
                    fixture.git("rm", "--", path)
                    fixture.write(path + "/unreviewed.py", "# redirected historical SQL fixture\n")
                elif change == "executable":
                    fixture.git("update-index", "--chmod=+x", "--", path)
                    stage = False
                else:
                    mode, obj = (("120000", fixture.database_progress_blob) if change == "symlink"
                                 else ("160000", fixture.database_progress))
                    fixture.git("config", "diff.ignoreSubmodules", "all")
                    fixture.git("update-index", "--cacheinfo", f"{mode},{obj},{path}")
                    stage = False
                self.assert_refused(fixture, fixture.commit("historical SQL fixture drift after acceptance", stage=stage))

    def test_exact_database_progress_blob_without_accepted_history_is_refused(self):
        with self.database_progress_history() as fixture:
            fixture.merge_lazy_context()
            fixture.write(fixture.database_progress_path, fixture.database_progress_content)
            target = fixture.commit("copy exact historical SQL fixture without accepted ancestry")
            self.assertEqual(fixture.git("rev-parse", f"{target}:{fixture.database_progress_path}"),
                             fixture.database_progress_blob)
            self.assert_refused(fixture, target)

    def test_database_progress_history_does_not_waive_collector_or_other_source_pins(self):
        with self.database_progress_history() as fixture:
            self.assert_refused(fixture, fixture.database_progress)
        for path in (*ar.COLLECTOR_BLOBS, *ar.LAZY_CONTEXT_BLOBS, "migrations/0304.sql", "compose.yaml",
                     "pnpm-lock.yaml", "tools/test_database_identity.py"):
            with self.subTest(path=path), self.database_progress_history() as fixture:
                fixture.merge_lazy_context()
                fixture.merge_database_progress()
                fixture.write(path, "unreviewed change outside the single historical SQL fixture\n")
                self.assert_refused(fixture, fixture.commit("foreign drift with accepted historical SQL fixture"))

    def test_database_progress_renames_cannot_hide_either_original_path(self):
        for original_is_fixture in (False, True):
            with self.subTest(original_is_fixture=original_is_fixture), self.database_progress_history() as fixture:
                fixture.merge_lazy_context()
                fixture.merge_database_progress()
                if original_is_fixture:
                    original, destination = fixture.database_progress_path, fixture.delivery_path
                else:
                    original, destination = fixture.product_path, fixture.database_progress_path
                fixture.git("rm", "--", destination)
                (fixture.root / destination).parent.mkdir(parents=True, exist_ok=True)
                fixture.git("mv", original, destination)
                target = fixture.commit("rename through the single pinned historical SQL fixture")
                changed = ar._changed_paths(fixture, fixture.product, target)
                self.assertIn(original, changed)
                self.assertIn(destination, changed)
                self.assert_refused(fixture, target)

    def test_database_progress_does_not_accept_whitespace_aliases(self):
        for name in (" " + SourceHistory.database_progress_path,
                     "\t" + SourceHistory.database_progress_path,
                     "\n" + SourceHistory.database_progress_path,
                     SourceHistory.database_progress_path + " "):
            with self.subTest(path=name), self.database_progress_history() as fixture:
                fixture.merge_lazy_context()
                fixture.merge_database_progress()
                target = fixture.commit_extra_blob(name, fixture.database_progress_blob)
                self.assertIn(name, ar._changed_paths(fixture, fixture.product, target))
                self.assert_refused(fixture, target)

    def test_native_qualification_cannot_reuse_old_tools_or_another_deployment_digest(self):
        tool = {"revision": "c" * 40}
        selected_digest = "sha256:" + "e" * 64
        valid = {"path": ".github/workflows/application-rollback.yml", "head_sha": tool["revision"],
                 "head_branch": "main", "event": "workflow_dispatch", "display_title": f"P0 return {selected_digest}",
                 "run_number": 2, "id": 456, "run_attempt": 1}
        with patch.object(ar.releases, "assert_general_ci"), \
             patch.object(ar.releases, "_latest_general", return_value={"id": 123, "run_attempt": 1}), \
             patch.object(ar.releases, "_successful_jobs") as jobs:
            for case, change in (("old tools", {"head_sha": "b" * 40}),
                                 ("original product digest", {"display_title": f"P0 return {DIGEST}"})):
                with self.subTest(case=case), patch.object(ar.releases, "_ci_pages", return_value=[{**valid, **change}]):
                    with self.assertRaises(Blocked) as denied:
                        ar._tool_ci(tool, True, selected_digest)
                    self.assertEqual(denied.exception.code, "ROLLBACK_QUALIFICATION")
                    jobs.assert_not_called()
            with patch.object(ar.releases, "_ci_pages", return_value=[valid]):
                result = ar._tool_ci(tool, True, selected_digest)
            self.assertEqual(result["nativeQualification"]["runId"], 456)
            jobs.assert_called_once_with(valid, ("contracts (ubuntu-latest)", "contracts (windows-latest)", "native official images"))


class HttpAlertsSourceBoundaryTests(unittest.TestCase):
    @staticmethod
    def commit_entries(fixture, base, entries):
        # Reuse only this disposable fixture's index. Each mutant starts from
        # the same accepted tree; no native symlink/worktree mutation is needed.
        fixture.git("read-tree", base)
        for path, entry in entries.items():
            if entry is None:
                fixture.git("update-index", "--force-remove", "--", path)
            else:
                mode, obj = entry
                fixture.git("update-index", "--add", "--cacheinfo", f"{mode},{obj},{path}")
        return fixture.git("commit-tree", fixture.git("write-tree"), "-p", base, "-m", "isolated source mutation")

    @staticmethod
    def altered_blob(fixture):
        path = "source-boundary-untracked-input"
        fixture.write(path, "unreviewed source input\n")
        return fixture.git("hash-object", "-w", "--", path)

    @contextlib.contextmanager
    def history(self, *, lazy=False, database_progress=False, alerts=False):
        # Offline contract fixtures use synthetic pins, as the existing source
        # tests do. Published SHA ancestry needs a separate unpatched Git proof.
        with SourceBoundaryTests().database_progress_history() as fixture:
            fixture.git("switch", "--quiet", "-c", "accepted-http-alerts", fixture.baseline)
            fixture.http_alert_contents = {path: f"accepted HTTP alerts: {path}\n" for path in ar.HTTP_ALERTS_BLOBS}
            for path, content in fixture.http_alert_contents.items():
                fixture.write(path, content)
            fixture.http_alerts = fixture.commit("independently accepted HTTP alerts")
            fixture.http_alert_blobs = {path: fixture.git("rev-parse", f"{fixture.http_alerts}:{path}")
                                        for path in fixture.http_alert_contents}
            fixture.git("switch", "--quiet", "main")
            if lazy:
                fixture.merge_lazy_context()
            if database_progress:
                fixture.merge_database_progress()
            if alerts:
                fixture.git("merge", "--quiet", "--no-ff", "--no-edit", fixture.http_alerts)
            with patch.multiple(ar, HTTP_ALERTS_REVISION=fixture.http_alerts,
                                HTTP_ALERTS_BLOBS=fixture.http_alert_blobs):
                yield fixture

    def assert_refused(self, fixture, target=None):
        with self.assertRaises(Blocked) as denied:
            fixture.validate(target)
        self.assertEqual(denied.exception.code, "ROLLBACK_PRODUCT")

    def test_optional_http_alerts_with_all_lazy_and_sql_fixture_combinations(self):
        for lazy in (False, True):
            for database_progress in (False, True):
                with self.subTest(lazy=lazy, database_progress=database_progress), \
                     self.history(lazy=lazy, database_progress=database_progress) as fixture:
                    expected = fixture.validate()
                    fixture.git("merge", "--quiet", "--no-ff", "--no-edit", fixture.http_alerts)
                    self.assertEqual(fixture.validate(), expected)
                    self.assertEqual(fixture.validate(fixture.commit("unchanged HTTP alerts descendant")), expected)

    def test_exact_http_alert_blobs_without_accepted_history_are_refused(self):
        with self.history(lazy=True, database_progress=True) as fixture:
            for path, content in fixture.http_alert_contents.items():
                fixture.write(path, content)
            target = fixture.commit("copied complete HTTP alerts without accepted ancestry")
            for path, blob in fixture.http_alert_blobs.items():
                self.assertEqual(fixture.git("ls-tree", "--full-tree", "-z", target, "--", path),
                                 f"100644 blob {blob}\t{path}\0")
            self.assert_refused(fixture, target)

    def test_partial_http_alert_transfer_and_revert_are_refused(self):
        with self.history(alerts=True) as fixture:
            base = fixture.git("rev-parse", "HEAD")
            for path in ar.HTTP_ALERTS_BLOBS:
                for transfer in (False, True):
                    with self.subTest(path=path, transfer=transfer):
                        removed = [name for name in ar.HTTP_ALERTS_BLOBS if name != path] if transfer else [path]
                        target = self.commit_entries(fixture, base, dict.fromkeys(removed))
                        self.assert_refused(fixture, target)

    def test_http_alert_edit_delete_mode_type_and_directory_are_refused(self):
        with self.history(alerts=True) as fixture:
            base, altered = fixture.git("rev-parse", "HEAD"), self.altered_blob(fixture)
            fixture.git("config", "diff.ignoreSubmodules", "all")
            for path, blob in fixture.http_alert_blobs.items():
                for change, entries in (
                    ("edit", {path: ("100644", altered)}),
                    ("delete", {path: None}),
                    ("executable", {path: ("100755", blob)}),
                    ("symlink", {path: ("120000", blob)}),
                    ("gitlink", {path: ("160000", fixture.http_alerts)}),
                    ("directory", {path: None, path + "/unreviewed.ts": ("100644", altered)}),
                ):
                    with self.subTest(path=path, change=change):
                        self.assert_refused(fixture, self.commit_entries(fixture, base, entries))

    def test_full_http_alert_revert_is_only_no_alerts_compatibility(self):
        with self.history(lazy=True, database_progress=True) as fixture:
            expected = fixture.validate()
            fixture.git("merge", "--quiet", "--no-ff", "--no-edit", fixture.http_alerts)
            fixture.git("rm", "--", *ar.HTTP_ALERTS_BLOBS)
            target = fixture.commit("complete five-path revert to original no-alerts tree")
            fixture.git("merge-base", "--is-ancestor", fixture.http_alerts, target)
            self.assertFalse(ar._changed_paths(fixture, fixture.product, target) & ar.HTTP_ALERTS_BLOBS.keys())
            self.assertEqual(fixture.validate(target), expected)
            for path in ar.HTTP_ALERTS_BLOBS:
                self.assertEqual(fixture.git("ls-tree", "--full-tree", "-z", target, "--", path), "")

    def test_http_alert_history_does_not_waive_collector_or_other_source_pins(self):
        with self.history() as fixture:
            self.assert_refused(fixture, fixture.http_alerts)
        with self.history(lazy=True, database_progress=True, alerts=True) as fixture:
            base, altered = fixture.git("rev-parse", "HEAD"), self.altered_blob(fixture)
            for path in (*ar.COLLECTOR_BLOBS, *ar.LAZY_CONTEXT_BLOBS, *ar.DATABASE_PROGRESS_BLOBS,
                         *ar.BASELINE_DOCS, SourceHistory.product_path, "migrations/0304.sql",
                         "compose.yaml", "pnpm-lock.yaml"):
                with self.subTest(path=path):
                    self.assert_refused(fixture, self.commit_entries(fixture, base, {path: ("100644", altered)}))

    def test_http_alert_renames_cannot_hide_either_original_path(self):
        for original_is_alert in (False, True):
            with self.subTest(original_is_alert=original_is_alert), self.history(alerts=True) as fixture:
                alert = "apps/api/src/app.factory.ts"
                before = fixture.git("rev-parse", "HEAD")
                original, destination = ((alert, fixture.delivery_path) if original_is_alert
                                         else (fixture.product_path, alert))
                fixture.git("rm", "--", destination)
                (fixture.root / destination).parent.mkdir(parents=True, exist_ok=True)
                fixture.git("mv", original, destination)
                target = fixture.commit("rename through a pinned HTTP alerts path")
                changed = ar._changed_paths(fixture, before, target)
                self.assertIn(original, changed)
                self.assertIn(destination, changed)
                self.assert_refused(fixture, target)

    def test_http_alerts_do_not_accept_whitespace_aliases(self):
        path = "apps/api/src/app.factory.ts"
        for name in (" " + path, "\t" + path, "\n" + path, path + " "):
            with self.subTest(path=name), self.history(alerts=True) as fixture:
                target = fixture.commit_extra_blob(name, fixture.http_alert_blobs[path])
                self.assertIn(name, ar._changed_paths(fixture, fixture.product, target))
                self.assert_refused(fixture, target)

    def test_http_alert_source_identity_does_not_waive_schema_identity(self):
        with self.history(alerts=True) as fixture:
            target = fixture.git("rev-parse", "HEAD")
            fixture.git("update-ref", "refs/remotes/origin/main", target)
            selected = release(target, ar.PRODUCT_IMAGES)
            selected["schema"] = 305
            with self.assertRaises(Blocked) as denied:
                ar.validate_pair(fixture, release(fixture.previous, ar.PREVIOUS_IMAGES), selected)
            self.assertEqual(denied.exception.code, "ROLLBACK_PAIR")


class CiBudgetSourceBoundaryTests(unittest.TestCase):
    @contextlib.contextmanager
    def history(self, *, lazy=False, database_progress=False, alerts=False, budget=False):
        with HttpAlertsSourceBoundaryTests().history(lazy=lazy, database_progress=database_progress,
                                                    alerts=alerts) as fixture:
            fixture.git("switch", "--quiet", "-c", "accepted-ci-budget", fixture.baseline)
            fixture.ci_budget_contents = {path: f"accepted CI contract budget: {path}\n" for path in ar.CI_BUDGET_BLOBS}
            for path, content in fixture.ci_budget_contents.items():
                fixture.write(path, content)
            fixture.ci_budget = fixture.commit("independently accepted CI contract budget")
            fixture.ci_budget_blobs = {path: fixture.git("rev-parse", f"{fixture.ci_budget}:{path}")
                                      for path in fixture.ci_budget_contents}
            fixture.git("switch", "--quiet", "main")
            if budget:
                fixture.git("merge", "--quiet", "--no-ff", "--no-edit", fixture.ci_budget)
            with patch.multiple(ar, CI_BUDGET_REVISION=fixture.ci_budget, CI_BUDGET_BLOBS=fixture.ci_budget_blobs):
                yield fixture

    def assert_refused(self, fixture, target=None):
        with self.assertRaises(Blocked) as denied:
            fixture.validate(target)
        self.assertEqual(denied.exception.code, "ROLLBACK_PRODUCT")

    def test_optional_ci_budget_with_all_other_source_combinations(self):
        for lazy in (False, True):
            for database_progress in (False, True):
                for alerts in (False, True):
                    with self.subTest(lazy=lazy, database_progress=database_progress, alerts=alerts), \
                         self.history(lazy=lazy, database_progress=database_progress, alerts=alerts) as fixture:
                        expected = fixture.validate()
                        fixture.git("merge", "--quiet", "--no-ff", "--no-edit", fixture.ci_budget)
                        self.assertEqual(fixture.validate(), expected)
                        self.assertEqual(fixture.validate(fixture.commit("unchanged CI budget descendant")), expected)

    def test_exact_ci_budget_without_accepted_history_is_refused(self):
        with self.history(lazy=True, database_progress=True, alerts=True) as fixture:
            for path, content in fixture.ci_budget_contents.items():
                fixture.write(path, content)
            target = fixture.commit("copied exact CI budget without accepted ancestry")
            for path, blob in fixture.ci_budget_blobs.items():
                self.assertEqual(fixture.git("ls-tree", "--full-tree", "-z", target, "--", path),
                                 f"100644 blob {blob}\t{path}\0")
            self.assert_refused(fixture, target)

    def test_partial_ci_budget_and_changed_content_mode_type_or_directory_are_refused(self):
        with self.history(alerts=True, budget=True) as fixture:
            base = fixture.git("rev-parse", "HEAD")
            altered = HttpAlertsSourceBoundaryTests.altered_blob(fixture)
            fixture.git("config", "diff.ignoreSubmodules", "all")
            for path, blob in fixture.ci_budget_blobs.items():
                for change, entries in (
                    ("edit", {path: ("100644", altered)}),
                    ("partial transfer or revert", {path: None}),
                    ("executable", {path: ("100755", blob)}),
                    ("symlink", {path: ("120000", blob)}),
                    ("gitlink", {path: ("160000", fixture.ci_budget)}),
                    ("directory", {path: None, path + "/unreviewed.yml": ("100644", altered)}),
                ):
                    with self.subTest(path=path, change=change):
                        target = HttpAlertsSourceBoundaryTests.commit_entries(fixture, base, entries)
                        self.assert_refused(fixture, target)

    def test_full_ci_budget_revert_preserves_only_original_workflow_compatibility(self):
        with self.history(lazy=True, database_progress=True, alerts=True) as fixture:
            expected = fixture.validate()
            fixture.git("merge", "--quiet", "--no-ff", "--no-edit", fixture.ci_budget)
            base = fixture.git("rev-parse", "HEAD")
            target = HttpAlertsSourceBoundaryTests.commit_entries(fixture, base, dict.fromkeys(ar.CI_BUDGET_BLOBS))
            fixture.git("merge-base", "--is-ancestor", fixture.ci_budget, target)
            self.assertFalse(ar._changed_paths(fixture, fixture.product, target) & ar.CI_BUDGET_BLOBS.keys())
            self.assertEqual(fixture.validate(target), expected)

    def test_ci_budget_does_not_waive_any_other_source_boundary(self):
        with self.history() as fixture:
            self.assert_refused(fixture, fixture.ci_budget)
        with self.history(lazy=True, database_progress=True, alerts=True, budget=True) as fixture:
            base = fixture.git("rev-parse", "HEAD")
            altered = HttpAlertsSourceBoundaryTests.altered_blob(fixture)
            for path in (*ar.HTTP_ALERTS_BLOBS, *ar.COLLECTOR_BLOBS, *ar.LAZY_CONTEXT_BLOBS,
                         *ar.DATABASE_PROGRESS_BLOBS, *ar.BASELINE_DOCS, SourceHistory.product_path,
                         "migrations/0304.sql", "compose.yaml", "pnpm-lock.yaml", ".github/workflows/unqualified.yml"):
                with self.subTest(path=path):
                    target = HttpAlertsSourceBoundaryTests.commit_entries(fixture, base, {path: ("100644", altered)})
                    self.assert_refused(fixture, target)

    def test_ci_budget_renames_cannot_hide_either_original_path(self):
        with self.history(alerts=True, budget=True) as fixture:
            base = fixture.git("rev-parse", "HEAD")
            path = ".github/workflows/portable-delivery.yml"
            for original, destination in ((fixture.product_path, path), (path, fixture.delivery_path)):
                with self.subTest(original=original):
                    blob = fixture.git("rev-parse", f"{base}:{original}")
                    target = HttpAlertsSourceBoundaryTests.commit_entries(
                        fixture, base, {original: None, destination: ("100644", blob)})
                    changed = ar._changed_paths(fixture, base, target)
                    self.assertIn(original, changed)
                    self.assertIn(destination, changed)
                    self.assert_refused(fixture, target)

    def test_ci_budget_does_not_accept_whitespace_aliases(self):
        with self.history(alerts=True, budget=True) as fixture:
            path = ".github/workflows/portable-delivery.yml"
            for name in (" " + path, "\t" + path, "\n" + path, path + " "):
                with self.subTest(path=name):
                    target = fixture.commit_extra_blob(name, fixture.ci_budget_blobs[path])
                    self.assertIn(name, ar._changed_paths(fixture, fixture.product, target))
                    self.assert_refused(fixture, target)

    def test_ci_budget_does_not_waive_schema_identity(self):
        with self.history(alerts=True, budget=True) as fixture:
            target = fixture.git("rev-parse", "HEAD")
            fixture.git("update-ref", "refs/remotes/origin/main", target)
            selected = release(target, ar.PRODUCT_IMAGES)
            selected["schema"] = 305
            with self.assertRaises(Blocked) as denied:
                ar.validate_pair(fixture, release(fixture.previous, ar.PREVIOUS_IMAGES), selected)
            self.assertEqual(denied.exception.code, "ROLLBACK_PAIR")


if __name__ == "__main__":
    unittest.main()
