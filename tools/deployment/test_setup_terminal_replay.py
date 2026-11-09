"""Terminal delivery, without replaying install/update or accepting stale output.

Host discovery and owner UID metadata use a private fixture. The selected setup
branch, journal IO/lock, supervisor and subprocess exits are real. Docker,
package installation, system users and the real CLI registry are never used.
"""

import copy
from contextlib import contextmanager, ExitStack, redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_setup
from deployment import paths as deployment_paths
from deployment.contracts import Blocked
from deployment.setup_config import private_json, save_private
from deployment.setup_operation import Engine, Store, configuration_digest
from deployment.setup_result import result
from deployment.test_setup_operation import FakeRuntime, IDENTITY, REVISION, configuration


OPERATION = "a" * 32
PIN = "sha256:" + "e" * 64


@contextmanager
def fixture_owner(root):
    """Model the non-root fixture owner on root and ordinary CI runners."""
    original_stat, original_fstat = Path.stat, os.fstat

    def owned(info):
        class OwnerView:
            st_uid = st_gid = 12345

            def __getattr__(self, name):
                return getattr(info, name)

            def __len__(self):
                return len(info)

            def __getitem__(self, key):
                fields = list(info)
                fields[4:6] = [self.st_uid, self.st_gid]
                return tuple(fields)[key]

            def __iter__(self):
                return iter(self[:])

        return OwnerView()

    def path_stat(path, *args, **kwargs):
        info = original_stat(path, *args, **kwargs)
        return owned(info) if path == root or root in path.parents else info

    def descriptor_stat(descriptor):
        info = original_fstat(descriptor)
        return owned(info) if stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode) else info

    with patch.object(os, "geteuid", return_value=12345, create=True), \
         patch.object(Path, "stat", path_stat), patch.object(os, "fstat", descriptor_stat):
        yield


def fixture_execute(root, arguments, *, interrupt=False):
    """Exercise the actual public setup routing with no host/application IO."""
    config = private_json(root / ".asa/setup.json")
    runtime = FakeRuntime(root)
    runtime.config = copy.deepcopy(config)
    runtime.old_revision = REVISION
    if interrupt:
        runtime.fail_at = "preflight"
    with fixture_owner(root), ExitStack() as stack:
        stack.enter_context(patch.object(asa_setup.setup_host, "check_owner", return_value={"uid": 12345}))
        stack.enter_context(patch.object(asa_setup, "load_config", return_value=copy.deepcopy(config)))
        stack.enter_context(patch.object(asa_setup, "prepare_config", return_value=copy.deepcopy(config)))
        stack.enter_context(patch.object(asa_setup.setup_discovery, "docker_inventory", return_value={"complete": True}))
        stack.enter_context(patch.object(asa_setup, "installation_discovery", return_value={"state": "MANAGED"}))
        stack.enter_context(patch.object(asa_setup, "Runtime", return_value=runtime))
        stack.enter_context(patch("deployment.setup_operation.backup_schedule.schedule_status",
                                  return_value={"configuration": {"enabled": False}}))
        try:
            return asa_setup.execute(asa_setup.parser().parse_args(arguments))
        finally:
            (root / "runtime-calls.json").write_text(json.dumps(runtime.calls), encoding="utf-8")


CHILD = r"""
import json
from pathlib import Path
import sys
sys.path.insert(0, sys.argv[1])
from deployment.test_setup_terminal_replay import fixture_execute
raise SystemExit(fixture_execute(Path(sys.argv[2]), json.loads(sys.argv[3])))
"""


class ReplayFixture:
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.store = Store(self.root, IDENTITY)
        self.config = configuration(self.root)
        self.config.update(operatorUid=12345, browser={"pythonPath": "/fixture/runtime/python"})
        save_private(self.root / ".asa/setup.json", self.config)
        self.seed()

    def seed(self, outcome="WARNING", code=0):
        if self.store.path(OPERATION).exists():
            self.store.path(OPERATION).unlink()
        journal = self.store.create("update", self.config["project"], operation_id=OPERATION,
            selection={"intent": "update", "deployment_digest": PIN})
        journal["phase"] = "browser" if code == 0 else "preflight"
        journal["stages"] = {"switch": {"status": "done"}, "browser": {"status": "done"}} if code == 0 else {}
        value = result(OPERATION, IDENTITY, "update", outcome=outcome, code=code,
            actionExecuted=code == 0, executionCompleted=code == 0,
            observedAt="2026-01-01T00:00:00+00:00", configurationDigest=configuration_digest(self.config),
            dependencies={"status": "FAILED" if outcome == "ERROR" else "OK"},
            version={"status": "RUNNING", "running": REVISION}, data={"status": "PRESERVED"},
            backup={"policy": "best-effort", "outcome": "WARNING", "snapshotId": "20260101T000000Z-aabbccdd",
                    "local": {"status": "OK"}, "encryption": {"status": "OK"}, "cloud": {"status": "NOT_CONFIGURED"}},
            site={"technical": {"status": "passed"},
                  "browser": {"status": "passed", "instanceId": IDENTITY, "revision": REVISION}},
            diagnostics={"status": "passed"})
        self.store.finish(journal, value)
        self.assertEqual((value["outcome"], value["exitCode"]), (outcome, code))
        self.assertEqual(journal["state"], "TERMINAL")
        return journal

    def private_bytes(self):
        return {str(path.relative_to(self.root)): path.read_bytes()
                for path in (self.root / ".asa").rglob("*.json")}

    def assert_refused_without_writes(self, journal):
        before = self.private_bytes()
        with self.assertRaises(Blocked):
            self.store.replay(journal)
        self.assertEqual(self.private_bytes(), before)

    def arguments(self, *, defer=False, fresh=False):
        argv = ["auto", "--intent", "update", "--deployment-digest", PIN,
                "--root", str(self.root), "--non-interactive", "--json"]
        if not fresh:
            argv += ["--operation-id", OPERATION]
        if defer:
            argv.append("--defer-report")
        return argv


class TerminalReplayTests(ReplayFixture, unittest.TestCase):
    def test_owner_model_preserves_all_other_native_stat_attributes(self):
        original = self.root.stat()
        with fixture_owner(self.root):
            modeled = self.root.stat()
            self.assertEqual((modeled.st_uid, modeled.st_gid), (12345, 12345))
            for name in dir(original):
                if name.startswith("st_") and name not in ("st_uid", "st_gid"):
                    self.assertEqual(getattr(modeled, name), getattr(original, name), name)
            fields = list(original)
            fields[4:6] = [12345, 12345]
            self.assertEqual(tuple(modeled), tuple(fields))

    def test_windows_metadata_model_preserves_path_guard_and_actual_setup_route(self):
        original_stat, original_os = Path.stat, deployment_paths.os

        class WindowsMetadata(tuple):
            pass

        attributes = 0

        def windows_stat(path, *args, **kwargs):
            source = original_stat(path, *args, **kwargs)
            modeled = WindowsMetadata(source)
            for name in dir(source):
                if name.startswith("st_"):
                    setattr(modeled, name, getattr(source, name))
            modeled.st_file_attributes = attributes
            modeled.st_reparse_tag = 0
            return modeled

        modeled_os = SimpleNamespace(**{**vars(original_os), "name": "nt"})
        with patch.object(Path, "stat", windows_stat), patch.object(deployment_paths, "os", modeled_os):
            deployment_paths.plain_paths(self.root, ())
            with fixture_owner(self.root):
                deployment_paths.plain_paths(self.root, ())
                self.assertEqual(self.root.stat().st_file_attributes, 0)
                self.assertEqual(self.root.stat().st_reparse_tag, 0)
                attributes = 0x400
                with self.assertRaisesRegex(ValueError, "reparse"):
                    deployment_paths.plain_paths(self.root, ())
                attributes = 0
            self.assertEqual(fixture_execute(self.root, self.arguments(defer=True)), 0)
        self.assertIs(Path.stat, original_stat)
        self.assertIs(deployment_paths.os, original_os)

    def test_legacy_terminal_result_reissues_with_only_delivery_metadata(self):
        journal = self.store.read(OPERATION)
        original = copy.deepcopy(journal["result"])
        before = (self.root / ".asa/setup-last-attempt.json").read_bytes()
        self.assertNotIn("terminalReplay", original)
        answer = self.store.replay(journal)
        marker = answer.pop("terminalReplay")
        self.assertEqual(answer, original)
        self.assertEqual(marker["format"], "asa-setup-terminal-replay-v1")
        self.assertRegex(marker["invocationId"], r"\A[a-f0-9]{32}\Z")
        self.assertNotEqual((self.root / ".asa/setup-last-attempt.json").read_bytes(), before)
        stored = self.store.read(OPERATION)
        self.assertEqual(stored["state"], "TERMINAL")
        self.assertEqual(stored["stages"], journal["stages"])
        self.assertEqual(stored["result"]["observedAt"], original["observedAt"])
        self.assertEqual(stored["result"], private_json(self.root / ".asa/setup-last-attempt.json"))
        self.assertEqual(stored["result"], private_json(self.root / ".asa/setup-last-successful.json"))

    def test_repeated_delivery_has_new_nonce_without_refreshing_acceptance(self):
        original = self.store.read(OPERATION)["result"]
        first = self.store.replay(self.store.read(OPERATION))
        second = self.store.replay(self.store.read(OPERATION))
        self.assertNotEqual(first["terminalReplay"]["invocationId"], second["terminalReplay"]["invocationId"])
        self.assertEqual({key: value for key, value in second.items() if key != "terminalReplay"}, original)
        self.assertEqual(len(list((self.root / ".asa/setup-operations").glob("*.json"))), 1)

    def test_warning_error_and_blocked_outcomes_and_exits_are_preserved(self):
        for outcome, code in (("WARNING", 0), ("ERROR", 1), ("BLOCKED", 2)):
            with self.subTest(outcome=outcome):
                original = self.seed(outcome, code)["result"]
                answer = self.store.replay(self.store.read(OPERATION))
                self.assertEqual((answer["outcome"], answer["exitCode"]), (outcome, code))
                self.assertIs(type(answer["exitCode"]), int)
                self.assertEqual({key: value for key, value in answer.items() if key != "terminalReplay"}, original)

    def test_wrong_journal_identity_and_mode_are_rejected(self):
        original = self.store.read(OPERATION)
        for key, value in (("operationId", "d" * 32), ("installationId", "d" * 32),
                           ("root", str(self.root / "foreign")), ("mode", "backup")):
            with self.subTest(key=key):
                journal = copy.deepcopy(original)
                journal[key] = value
                save_private(self.store.path(OPERATION), journal)
                self.assert_refused_without_writes(original if key == "operationId" else journal)
        save_private(self.store.path(OPERATION), original)

    def test_result_identity_types_exit_and_aggregate_mismatch_are_rejected(self):
        original = self.store.read(OPERATION)
        variants = [("format", "foreign"), ("operationId", "d" * 32), ("installationId", "d" * 32),
                    ("mode", "install"), ("outcome", []), ("outcome", "UNKNOWN"),
                    ("exitCode", False), ("exitCode", 0.0), ("exitCode", "0"), ("exitCode", 1),
                    ("applicationAccepted", 1), ("dataProtectionConfirmed", 0),
                    ("dependencies", {"status": "FAILED"})]
        for key, value in variants:
            with self.subTest(key=key, value=value):
                journal = copy.deepcopy(original)
                journal["result"][key] = value
                save_private(self.store.path(OPERATION), journal)
                self.assert_refused_without_writes(journal)
        for malformed in (None, [], "secret-sentinel"):
            journal = copy.deepcopy(original)
            journal["result"] = malformed
            save_private(self.store.path(OPERATION), journal)
            self.assert_refused_without_writes(journal)

    def test_stale_memory_and_nonterminal_states_do_not_replay(self):
        original = self.store.read(OPERATION)
        stale = copy.deepcopy(original)
        stale["phase"] = "foreign"
        self.assert_refused_without_writes(stale)
        for state in ("RUNNING", "VERIFY_ONLY", "RECOVERY_REQUIRED"):
            journal = copy.deepcopy(original)
            journal["state"] = state
            save_private(self.store.path(OPERATION), journal)
            self.assert_refused_without_writes(journal)

    def test_later_store_event_cannot_relabel_the_original_receipt_stage(self):
        journal = self.store.read(OPERATION)
        original = copy.deepcopy(journal["result"])
        self.store.event(journal, "acceptance_preflight", "intent")
        self.assertEqual(journal["state"], "TERMINAL")
        self.assertEqual(journal["phase"], "acceptance_preflight")
        self.assertEqual(journal["result"], original)
        self.assertNotEqual(journal["phase"], original["stage"])
        self.assert_refused_without_writes(self.store.read(OPERATION))

    def test_later_backup_verification_cannot_reinterpret_a_terminal_failure(self):
        journal = self.store.create("update", self.config["project"])
        value = result(journal["operationId"], IDENTITY, "update", outcome="BLOCKED", code=2,
            backup={"policy": "best-effort", "outcome": "BLOCKED", "snapshotId": "20260101T000000Z-ddddeeee",
                    "local": {"status": "NOT_RUN", "executionStatus": "NOT_RUN",
                              "error": "BACKUP_RESUME_SNAPSHOT_MISSING"}})
        self.store.finish(journal, value)
        self.assertEqual((journal["state"], value["outcome"], value["exitCode"]), ("TERMINAL", "BLOCKED", 2))
        self.assertNotIn("previouslyVerified", value["backup"]["local"])
        journal["verifiedBackupSnapshots"] = [value["backup"]["snapshotId"]]
        self.store.save(journal)
        self.assert_refused_without_writes(self.store.read(journal["operationId"]))

    def test_previously_recorded_verified_failure_can_be_reissued_unchanged(self):
        journal = self.store.create("update", self.config["project"])
        snapshot = "20260101T000000Z-ddddeeee"
        journal["verifiedBackupSnapshots"] = [snapshot]
        value = result(journal["operationId"], IDENTITY, "update", outcome="BLOCKED", code=2,
            backup={"policy": "best-effort", "outcome": "BLOCKED", "snapshotId": snapshot,
                    "local": {"status": "NOT_RUN", "executionStatus": "NOT_RUN",
                              "error": "BACKUP_RESUME_SNAPSHOT_MISSING"}})
        self.store.finish(journal, value)
        self.assertEqual((journal["state"], value["outcome"], value["exitCode"]), ("TERMINAL", "ERROR", 1))
        self.assertIs(value["backup"]["local"]["previouslyVerified"], True)
        answer = self.store.replay(self.store.read(journal["operationId"]))
        self.assertEqual({key: field for key, field in answer.items() if key != "terminalReplay"}, value)
        changed = self.store.read(journal["operationId"])
        changed["result"]["backup"]["local"]["previouslyVerified"] = 1
        self.store.save(changed)
        self.assert_refused_without_writes(changed)

    def test_invalid_or_reused_delivery_marker_is_rejected(self):
        original = self.store.read(OPERATION)
        for marker in (False, [], {}, {"format": "foreign"},
                       {"format": "asa-setup-terminal-replay-v1", "invocationId": "A" * 32, "reportedAt": "now"},
                       {"format": "asa-setup-terminal-replay-v1", "invocationId": "f" * 32, "reportedAt": ""}):
            journal = copy.deepcopy(original)
            journal["result"]["terminalReplay"] = marker
            save_private(self.store.path(OPERATION), journal)
            self.assert_refused_without_writes(journal)
        save_private(self.store.path(OPERATION), original)
        first = self.store.replay(self.store.read(OPERATION))
        with patch("deployment.setup_operation.uuid.uuid4", return_value=SimpleNamespace(hex=first["terminalReplay"]["invocationId"])):
            self.assert_refused_without_writes(self.store.read(OPERATION))

    @unittest.skipUnless(os.name == "posix", "POSIX private file owner and modes")
    def test_unsafe_mode_and_foreign_owner_are_rejected_before_reissue(self):
        journal = self.store.read(OPERATION)
        path = self.store.path(OPERATION)
        path.chmod(0o644)
        self.assert_refused_without_writes(journal)
        path.chmod(0o600)
        with patch.object(os, "geteuid", return_value=os.geteuid() + 1):
            self.assert_refused_without_writes(journal)

    def test_actual_setup_terminal_route_uses_reissue_without_engine_actions(self):
        before = self.store.read(OPERATION)["result"]
        code = fixture_execute(self.root, self.arguments(defer=True))
        self.assertEqual(code, 0)
        after = private_json(self.root / ".asa/setup-last-attempt.json")
        self.assertEqual({key: value for key, value in after.items() if key != "terminalReplay"}, before)
        self.assertIn("terminalReplay", after)
        self.assertEqual(json.loads((self.root / "runtime-calls.json").read_text()), [])

    def test_actual_setup_rejects_changed_pin_or_intent_before_reissue(self):
        for option, value, reason in (("--intent", "install", "OPERATION_INTENT"),
                                      ("--deployment-digest", "sha256:" + "f" * 64, "RELEASE_SELECTOR_CHANGED")):
            with self.subTest(option=option):
                arguments = self.arguments(defer=True)
                arguments[arguments.index(option) + 1] = value
                before = self.private_bytes()
                with patch.object(Store, "replay", side_effect=AssertionError("Unbound replay")), self.assertRaises(Blocked) as failure:
                    fixture_execute(self.root, arguments)
                self.assertEqual(failure.exception.code, reason)
                self.assertEqual(self.private_bytes(), before)

    def test_no_change_reissue_keeps_original_zero_or_pending_exit_without_backup(self):
        for accepted in (True, False):
            with self.subTest(accepted=accepted):
                if not accepted:
                    (self.root / ".asa/setup-last-successful.json").unlink()
                runtime = FakeRuntime(self.root)
                runtime.config = copy.deepcopy(self.config)
                runtime.old_revision = REVISION
                journal = self.store.create("update", self.config["project"])
                original = Engine(runtime, self.store).execute(journal)
                self.assertEqual((original["outcome"], original["exitCode"]), ("NO_CHANGE", 0 if accepted else 2))
                output = self.store.replay(self.store.read(journal["operationId"]))
                self.assertEqual({key: value for key, value in output.items() if key != "terminalReplay"}, original)
                self.assertFalse(output["applicationAccepted"])
                for action in ("source", "images", "plan", "backup", "switch", "browser"):
                    self.assertNotIn(action, runtime.calls)

    def test_nonterminal_interrupt_keeps_existing_engine_130_path(self):
        journal = self.store.read(OPERATION)
        journal.update(state="RUNNING", phase="created", stages={})
        journal.pop("result")
        save_private(self.store.path(OPERATION), journal)
        with patch.object(Store, "replay", side_effect=AssertionError("Interrupted operation replayed")):
            code = fixture_execute(self.root, self.arguments(defer=True), interrupt=True)
        value = private_json(self.root / ".asa/setup-last-attempt.json")
        self.assertEqual((code, value["outcome"], value["exitCode"]), (130, "INTERRUPTED", 130))
        self.assertNotEqual(self.store.read(OPERATION)["state"], "TERMINAL")
        self.assertNotIn("terminalReplay", value)

@unittest.skipUnless(sys.platform.startswith("linux"), "Linux privileged supervisor subprocess boundary")
class TerminalReplaySupervisorTests(ReplayFixture, unittest.TestCase):
    def supervisor(self, *, no_write_exit=None, fresh=False):
        source = Path(__file__).resolve().parents[1] / "asa_setup_launcher.py"
        spec = importlib.util.spec_from_file_location("terminal_replay_launcher", source)
        launcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(launcher)
        owner = {"uid": 12345, "gid": 12345, "name": "fixture-owner", "home": str(self.root), "root": str(self.root)}
        calls, exits = [], []

        def child(operator, argv, environment, **kwargs):
            calls.append(list(argv))
            if "register" in argv:
                self.assertEqual(operator["uid"], 0)
                return SimpleNamespace(returncode=0)
            self.assertEqual(operator["uid"], 12345)
            entry = str(source.with_name("asa_setup.py"))
            self.assertIn(entry, argv)
            forwarded = argv[argv.index(entry) + 1:]
            if no_write_exit is not None and "--defer-report" in forwarded:
                command = [sys.executable, "-I", "-B", "-c", "import sys; sys.exit(int(sys.argv[1]))", str(no_write_exit)]
            else:
                command = [sys.executable, "-I", "-B", "-c", CHILD, str(source.parent), str(self.root), json.dumps(forwarded)]
            completed = subprocess.run(command, text=True, encoding="utf-8", stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, timeout=30, check=False)
            self.assertEqual(completed.stderr, "")
            exits.append(completed.returncode)
            if not kwargs.get("capture"):
                print(completed.stdout, end="")
            return completed

        with patch.object(launcher.os, "geteuid", return_value=0), \
             patch.object(launcher, "verify_bundle"), \
             patch.object(launcher, "platform_info", return_value={"supported": True}), \
             patch.object(launcher, "validate_owner", return_value=owner), \
             patch.object(launcher, "verify_operator_daemon"), \
             patch.object(launcher, "dependency_plan", return_value={"missing": [], "installDocker": False, "daemonId": "fixture"}), \
             patch.object(launcher, "_owner_call", side_effect=child), redirect_stdout(io.StringIO()) as output:
            code = launcher.main(self.arguments(fresh=fresh))
        return code, output.getvalue(), calls, exits

    def test_actual_launcher_child_replay_then_fresh_no_change_does_not_repeat_backup(self):
        original = self.store.read(OPERATION)["result"]
        deliveries = []
        for _ in range(2):
            code, text, calls, exits = self.supervisor()
            self.assertEqual(code, 0)
            value = json.loads(text)
            self.assertEqual((value["operationId"], value["outcome"]), (OPERATION, "WARNING"))
            self.assertEqual({key: field for key, field in value.items() if key != "terminalReplay"}, original)
            deliveries.append(value["terminalReplay"]["invocationId"])
            self.assertEqual(exits, [0, 0, 0])
            self.assertFalse(any("--root-action" in argv for argv in calls))
        self.assertNotEqual(*deliveries)
        code, text, _calls, exits = self.supervisor(fresh=True)
        value = json.loads(text)
        self.assertEqual((code, value["outcome"], value["exitCode"]), (0, "NO_CHANGE", 0))
        self.assertNotEqual(value["operationId"], OPERATION)
        self.assertNotIn("terminalReplay", value)
        self.assertFalse(value["actionExecuted"])
        self.assertEqual(value["site"]["browser"]["status"], "historical_passed")
        self.assertEqual(exits, [0, 0, 0])
        journals = list((self.root / ".asa/setup-operations").glob("*.json"))
        self.assertEqual(len(journals), 2)
        for path in journals:
            saved = private_json(path)
            if saved["operationId"] != OPERATION:
                self.assertNotIn("backup", saved["stages"])
                self.assertNotIn("switch", saved["stages"])

    def test_actual_launcher_preserves_terminal_failure_exits_and_identity(self):
        for outcome, expected in (("ERROR", 1), ("BLOCKED", 2)):
            with self.subTest(outcome=outcome):
                self.seed(outcome, expected)
                code, text, calls, exits = self.supervisor()
                value = json.loads(text)
                self.assertEqual((code, value["outcome"], value["exitCode"]), (expected, outcome, expected))
                self.assertEqual(value["operationId"], OPERATION)
                self.assertEqual(exits, [0, expected, expected])
                self.assertFalse(any("register" in argv or "--root-action" in argv for argv in calls))

    def test_success_without_a_new_receipt_stays_blocked_with_stale_or_missing_file(self):
        last = self.root / ".asa/setup-last-attempt.json"
        for missing in (False, True):
            with self.subTest(missing=missing):
                if missing:
                    last.unlink()
                before = self.private_bytes()
                code, text, calls, exits = self.supervisor(no_write_exit=0)
                value = json.loads(text)
                self.assertEqual((code, value["reasonCode"]), (2, "OPERATION_RESULT_MISSING"))
                self.assertIsNone(value["operationId"])
                self.assertEqual(exits, [0, 0])
                self.assertEqual(self.private_bytes(), before)
                self.assertFalse(any("--render-last" in argv or "register" in argv or "--root-action" in argv for argv in calls))

    def test_no_write_error_and_interrupt_never_claim_old_success(self):
        for child_code in (1, 2, 130):
            with self.subTest(child_code=child_code):
                before = self.private_bytes()
                code, text, calls, exits = self.supervisor(no_write_exit=child_code)
                self.assertEqual(code, child_code)
                self.assertEqual(exits, [0, child_code])
                self.assertEqual(self.private_bytes(), before)
                self.assertFalse(any("--render-last" in argv or "register" in argv for argv in calls))
                if child_code == 130:
                    value = json.loads(text)
                    self.assertEqual(value["outcome"], "INTERRUPTED")
                    self.assertIsNone(value["operationId"])
                else:
                    self.assertEqual(text, "")


if __name__ == "__main__":
    unittest.main()
