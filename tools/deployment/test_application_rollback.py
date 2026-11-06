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
from deployment.contracts import Blocked, inventory_files

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
        self.profile, self.project = "dev", "asa-p0-return-unit"
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
            return "\n".join(self.source_changes)
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
                self.assertEqual(ar.tool_identity(installation)["root"], str(root))
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
            terminate_owned_process(process)
            self.assertIsNotNone(process.returncode)
            self.assertNotEqual(process.returncode, 0)
            terminate_owned_process(process)
        finally:
            if process.poll() is None: terminate_owned_process(process)
            process.stdout.close()

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


class SourceHistory:
    """Actual commits/merges in a fresh synthetic Git repository; no Docker."""
    product_path = "apps/api/src/preserved-product.ts"
    delivery_path = "tools/deployment/application_rollback.py"
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
                   self.product_path: 'export const preservedProduct = "keep this source";\n'}
        initial.update({path: f"before collector: {path}\n" for path in ar.COLLECTOR_BLOBS})
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


class SourceBoundaryTests(unittest.TestCase):
    @contextlib.contextmanager
    def history(self):
        with tempfile.TemporaryDirectory(prefix="asa source boundary ") as temporary:
            fixture = SourceHistory(Path(temporary))
            with patch.multiple(ar, PREVIOUS=fixture.previous, PRODUCT=fixture.product, BASELINE=fixture.baseline,
                                COLLECTOR_REVISION=fixture.collector, COLLECTOR_BLOBS=fixture.collector_blobs):
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


if __name__ == "__main__":
    unittest.main()
