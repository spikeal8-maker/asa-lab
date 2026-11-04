"""Caller regressions for retention, disabled timers and read-only host evidence."""

from contextlib import redirect_stdout
import copy
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_setup
from deployment import backup_schedule, backup_workflow as flow
from deployment.contracts import Blocked
from deployment.setup_config import private_json, save_private
from deployment.setup_operation import Store
from deployment.setup_result import render
from deployment.test_backup_policy_regressions import BackupRuntime, export_fixture
from deployment.test_backup_retention_regressions import copies
from deployment.test_backup_workflow import ID, MemoryCloud, fake_age


def rendered(value):
    output = io.StringIO()
    render(value, stream=output)
    return output.getvalue()


def cli_saved_report(root, config):
    output = io.StringIO()
    with patch.object(asa_setup, "os", SimpleNamespace(geteuid=lambda: 1000)), \
         patch("asa_setup.setup_host.check_owner", return_value={"uid": 1000}), \
         patch("asa_setup.load_config", return_value=config), redirect_stdout(output):
        code = asa_setup.main(["status", "--root", str(root), "--render-last", "--json"])
    return code, json.loads(output.getvalue())


class RetentionResultRegressionTests(unittest.TestCase):
    def run_backup(self, runtime, store, provider):
        args = asa_setup.parser().parse_args(["backup", "--root", str(runtime.root)])
        def command(arguments, **kwargs):
            return fake_age(arguments, **kwargs) if arguments[0] == "age" else b""
        with patch.object(flow, "CloudTransport", return_value=provider), \
             patch.object(flow, "_command", side_effect=command), \
             patch.object(flow, "export_backup", side_effect=export_fixture), \
             patch.object(backup_schedule, "schedule_status", return_value={"configuration": {"enabled": False}}):
            return asa_setup._auxiliary(args, runtime.config, runtime, store, None)

    def test_old_ciphertext_integrity_failure_is_red_without_discarding_the_new_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = BackupRuntime(directory)
            runtime.config["backup"]["retention"] = {"localKeep": 1}
            provider = MemoryCloud()
            old, previous = copies(runtime.install, provider=provider)
            Path(old["encryption"]["path"]).write_bytes(b"changed synthetic ciphertext")
            store = Store(runtime.root, ID)
            answer = self.run_backup(runtime, store, provider)
            self.assertEqual((answer["outcome"], answer["exitCode"], answer["backup"]["status"]),
                             ("ERROR", 1, "FAILED"))
            self.assertEqual(answer["retention"]["status"], "FAILED")
            self.assertEqual(answer["retention"]["reasonCode"], "BACKUP_CIPHERTEXT_DRIFT")
            self.assertFalse(answer["executionCompleted"])
            self.assertTrue(answer["dataProtectionConfirmed"])
            self.assertEqual(answer["backup"]["outcome"], "ACCEPTED")
            for component in ("local", "encryption", "cloud"):
                self.assertEqual(answer["backup"][component]["status"], "OK")
            saved = flow.verify_receipt(runtime.install, snapshot_id=answer["backup"]["snapshotId"], installation_id=ID)
            self.assertEqual(saved["outcome"], "ACCEPTED")
            self.assertTrue(Path(old["local"]["path"]).is_dir())
            self.assertTrue(Path(previous["local"]["path"]).is_dir())
            self.assertNotIn("deletedAt", flow.load_receipt(runtime.install, old["snapshotId"], ID)["local"])
            journal = store.read(answer["operationId"])
            self.assertEqual(journal["state"], "TERMINAL")
            self.assertEqual(journal["stages"]["retention"]["evidence"], answer["retention"])
            self.assertEqual(journal["result"], private_json(runtime.root / ".asa/setup-last-attempt.json"))
            self.assertIsNone(store.pending())
            code, machine = cli_saved_report(runtime.root, runtime.config)
            self.assertEqual((code, machine["exitCode"]), (1, 1))
            self.assertEqual(machine, answer)
            text = rendered(machine)
            self.assertIn("4. [X] Резервирование", text)
            self.assertIn("Очистка старых копий: ошибка", text)
            self.assertIn("BACKUP_CIPHERTEXT_DRIFT", text)

    def test_optional_retention_outage_keeps_successful_new_delivery_and_warning_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = BackupRuntime(directory)
            runtime.config["backup"]["retention"] = {"remoteKeep": 1}
            provider = MemoryCloud()
            old, previous = copies(runtime.install, provider=provider)
            store = Store(runtime.root, ID)
            readback = provider.readback
            def unavailable_old(remote, *args, **kwargs):
                if remote == old["cloud"]["remote"]:
                    raise Blocked("CLOUD_TIMEOUT", "synthetic offline", "retry")
                return readback(remote, *args, **kwargs)
            with patch.object(provider, "readback", side_effect=unavailable_old):
                answer = self.run_backup(runtime, store, provider)
            self.assertEqual((answer["outcome"], answer["exitCode"], answer["backup"]["status"]),
                             ("WARNING", 0, "WARNING"))
            self.assertEqual(answer["retention"]["status"], "DEFERRED")
            self.assertEqual(answer["retention"]["reasonCode"], "CLOUD_TIMEOUT")
            self.assertTrue(answer["dataProtectionConfirmed"])
            self.assertTrue(answer["executionCompleted"])
            self.assertEqual(answer["backup"]["cloud"]["status"], "OK")
            self.assertEqual(store.read(answer["operationId"])["state"], "TERMINAL")
            self.assertIsNone(store.pending())
            code, machine = cli_saved_report(runtime.root, runtime.config)
            self.assertEqual((code, machine["exitCode"]), (0, 0))
            self.assertEqual(machine, answer)
            self.assertIn("4. [!] Резервирование", rendered(machine))
            self.assertIn("Очистка старых копий отложена: CLOUD_TIMEOUT", rendered(machine))
            for saved in (old, previous):
                self.assertTrue(Path(saved["local"]["path"]).is_dir())
                self.assertIn(saved["cloud"]["remote"], provider.objects)


class ScheduleResultRegressionTests(unittest.TestCase):
    def report(self, root, schedule, *, status="OK"):
        identity = "c" * 32
        save_private(root / ".asa/setup-root-actions.json", {
            "format": "asa-setup-root-actions-v1", "installationId": identity, "operationId": "a" * 32,
            "kind": "schedule", "status": status, "schedule": schedule})
        args = asa_setup.parser().parse_args(["status", "--root", str(root), "--render-last", "--render-action", "schedule", "--json"])
        output = io.StringIO()
        with redirect_stdout(output):
            code = asa_setup.render_last(args, {"installationId": identity, "project": "asa-lab-dev"})
        return code, json.loads(output.getvalue()), Store(root, identity)

    def test_confirmed_disabled_schedule_finishes_and_does_not_block_next_operation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            code, answer, store = self.report(root, {"configuration": {"enabled": False}, "installed": True, "running": False})
            self.assertEqual((code, answer["exitCode"], answer["outcome"], answer["backup"]["status"]),
                             (0, 0, "ACCEPTED", "OK"))
            self.assertEqual(store.read(answer["operationId"])["state"], "TERMINAL")
            self.assertIsNone(store.pending())
            self.assertEqual(answer, private_json(root / ".asa/setup-last-attempt.json"))
            self.assertIn("Расписание: отключено", rendered(answer))

    def test_enabled_schedule_still_requires_installed_running_and_error_free_observation(self):
        for running, expected in ((True, 0), (False, 2)):
            with self.subTest(running=running), tempfile.TemporaryDirectory() as directory:
                code, answer, store = self.report(Path(directory), {
                    "configuration": {"enabled": True}, "installed": True, "running": running})
                self.assertEqual((code, answer["exitCode"]), (expected, expected))
                if expected == 0:
                    self.assertIsNone(store.pending())
                    self.assertIn("Расписание: активно", rendered(answer))

    def test_disabled_configuration_alone_cannot_hide_unknown_or_failed_observation(self):
        cases = (
            {"configuration": {"enabled": False}, "installed": True, "running": True},
            {"configuration": {"enabled": False}, "installed": False, "running": False},
            {"configuration": {"enabled": False}, "installed": True},
            {"configuration": {"enabled": False}, "installed": True, "running": False, "error": "BACKUP_SYSTEMD_UNAVAILABLE"},
            {"configuration": {}, "installed": True, "running": False},
            {"configuration": {}, "installed": True, "running": True},
        )
        for schedule in cases:
            with self.subTest(schedule=schedule), tempfile.TemporaryDirectory() as directory:
                code, answer, store = self.report(Path(directory), schedule)
                self.assertEqual((code, answer["exitCode"], answer["backup"]["status"]), (2, 2, "INCOMPLETE"))
                self.assertNotIn("Расписание: отключено", rendered(answer))
        with tempfile.TemporaryDirectory() as directory:
            code, answer, store = self.report(Path(directory), {
                "configuration": {"enabled": False}, "installed": True, "running": False}, status="FAILED")
            self.assertEqual((code, answer["backup"]["status"]), (1, "FAILED"))


class ReadOnlyDependencyResultRegressionTests(unittest.TestCase):
    def test_read_only_cli_uses_host_and_tool_evidence_without_more_host_calls_or_writes(self):
        healthy_host = {"systemd": True, "onePanel": "ACTIVE", "timeSynchronized": True}
        healthy_tools = {"format": "asa-host-dependency-plan-v1", "missing": [], "installDocker": False,
                         "daemonId": "synthetic-daemon"}
        cases = (
            (healthy_host, {**healthy_tools, "missing": ["git"]}, "INCOMPLETE", 2, "[!]"),
            ({}, healthy_tools, "INCOMPLETE", 2, "[!]"),
            (healthy_host, {}, "INCOMPLETE", 2, "[!]"),
            ({**healthy_host, "timeSynchronized": "UNVERIFIED"}, healthy_tools, "INCOMPLETE", 2, "[!]"),
            ({**healthy_host, "timeSynchronized": False}, healthy_tools, "FAILED", 1, "[X]"),
            ({**healthy_host, "timeSynchronized": False}, {**healthy_tools, "missing": ["git"]}, "FAILED", 1, "[X]"),
            (healthy_host, healthy_tools, "OBSERVED", 2, "[OK]"),
        )
        for host, tools, status, expected_code, marker in cases:
            with self.subTest(host=host, tools=tools), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                inventory = {"complete": True, "containers": [], "volumes": [], "images": [], "daemon": {"id": "fixture"}}
                stdout = io.StringIO()
                with patch.object(asa_setup, "os", SimpleNamespace(geteuid=lambda: 1000)), \
                     patch("asa_setup.setup_host.check_owner", return_value={"uid": 1000}), \
                     patch("asa_setup.setup_host.system_state", return_value=copy.deepcopy(host)) as system_state, \
                     patch("asa_setup.setup_host.inspect_dependencies", return_value=copy.deepcopy(tools)) as dependencies, \
                     patch("asa_setup.setup_host.check_platform", side_effect=AssertionError("extra host call")), \
                     patch("asa_setup.setup_discovery.docker_inventory", return_value=inventory), \
                     patch("asa_setup.operation_lock", side_effect=AssertionError("read-only acquired mutation lock")), \
                     redirect_stdout(stdout):
                    code = asa_setup.main(["doctor", "--root", directory, "--json"])
                answer = json.loads(stdout.getvalue())
                self.assertEqual((code, answer["exitCode"], answer["dependencies"]["status"]), (expected_code, expected_code, status))
                self.assertIn("1. " + marker + " Зависимости и владелец", rendered(answer))
                system_state.assert_called_once_with()
                dependencies.assert_called_once_with()
                self.assertEqual(list(root.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
