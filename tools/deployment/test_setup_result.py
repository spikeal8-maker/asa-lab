"""Regression coverage for six operator rows, machine status and process outcome."""

import copy
from contextlib import redirect_stdout
import io
import json
import os
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.setup_result import finalize, render, result
from deployment.setup_config import private_json, save_private
from deployment.setup_operation import Engine, Store
from deployment import backup_workflow
from deployment.test_setup_operation import FakeRuntime, IDENTITY, RELEASE, ProcessKilled, receipt, fixture_zone_info
from deployment.test_backup_workflow import fake_install, ID as BACKUP_ID, OP, SNAP
import asa_setup


LABELS = {
    "dependencies": "Зависимости и владелец",
    "version": "Версия приложения",
    "data": "PostgreSQL и файлы",
    "backup": "Резервирование",
    "site": "Сайт и пользовательский путь",
    "diagnostics": "Диагностика",
}


def completed():
    return result("a" * 32, "c" * 32, "update", actionExecuted=True, executionCompleted=True,
                  dependencies={"status": "OK"}, version={"status": "RUNNING"},
                  data={"status": "PRESERVED"},
                  backup={"outcome": "ACCEPTED", "policy": "required", "local": {"status": "OK"},
                          "encryption": {"status": "OK"}, "cloud": {"status": "OK"},
                          "restore": {"status": "UNVERIFIED"}},
                  site={"technical": {"status": "passed"}, "browser": {"status": "passed"},
                        "owner": {"status": "READY"}}, diagnostics={"status": "passed"})


def output(value, *, as_json=False, stream=None):
    stream = stream if stream is not None else io.StringIO()
    render(value, as_json=as_json, stream=stream)
    return stream.getvalue()


class Terminal(io.StringIO):
    @property
    def encoding(self):
        return "utf-8"

    def isatty(self):
        return True


class SetupResultTests(unittest.TestCase):
    def test_all_six_success_rows_agree_with_json_and_exit(self):
        value = finalize(completed())
        self.assertEqual((value["outcome"], value["exitCode"]), ("ACCEPTED", 0))
        self.assertTrue(value["applicationAccepted"])
        self.assertTrue(value["dataProtectionConfirmed"])
        text = output(value)
        self.assertEqual(text.count(". [OK]"), 6)
        machine = json.loads(output(value, as_json=True))
        for key, label in LABELS.items():
            with self.subTest(row=key):
                self.assertIn("[OK] " + label, text)
                self.assertEqual(machine[key]["status"], value[key]["status"])

    def test_each_performed_mandatory_row_failure_is_error_one(self):
        for key in ("dependencies", "version", "data", "backup", "site"):
            with self.subTest(row=key):
                value = completed()
                value[key]["status"] = "FAILED"
                finalize(value)
                self.assertEqual((value["outcome"], value["exitCode"]), ("ERROR", 1))
                self.assertIn("[X] " + LABELS[key], output(value))
                self.assertEqual(json.loads(output(value, as_json=True))["exitCode"], 1)

    def test_each_missing_mandatory_row_is_incomplete_two(self):
        for key in ("dependencies", "version", "data", "backup", "site"):
            with self.subTest(row=key):
                value = completed()
                value[key] = {"status": "NOT_RUN"}
                finalize(value)
                self.assertEqual((value["outcome"], value["exitCode"]), ("INCOMPLETE", 2))
                self.assertIn("[!] " + LABELS[key], output(value))

    def test_each_failed_site_subcheck_overrides_green_parent(self):
        for key in ("technical", "browser", "owner"):
            for state in ("failed", "ERROR", "environment_failed"):
                with self.subTest(check=key, state=state):
                    value = completed()
                    value["site"]["status"] = "TECHNICAL_OK"
                    value["site"][key]["status"] = state
                    finalize(value)
                    self.assertEqual((value["site"]["status"], value["exitCode"]), ("FAILED", 1))
                    self.assertFalse(value["applicationAccepted"])

    def test_missing_site_subcheck_never_becomes_green(self):
        for key in ("technical", "browser", "owner"):
            with self.subTest(check=key):
                value = completed()
                value["site"][key]["status"] = "not_run"
                finalize(value)
                self.assertEqual((value["site"]["status"], value["exitCode"]), ("INCOMPLETE", 2))

    def test_fresh_install_requires_owner_evidence(self):
        value = completed()
        value["mode"] = "install"
        del value["site"]["owner"]
        self.assertEqual(finalize(value)["exitCode"], 2)
        self.assertFalse(value["applicationAccepted"])

    def test_each_failed_mandatory_backup_subcheck_is_error_one(self):
        for key in ("local", "encryption", "cloud"):
            with self.subTest(check=key):
                value = completed()
                value["backup"][key]["status"] = "FAILED"
                finalize(value)
                self.assertEqual((value["backup"]["status"], value["exitCode"]), ("FAILED", 1))
                self.assertFalse(value["dataProtectionConfirmed"])

    def test_nested_backup_failure_cannot_claim_data_protection(self):
        value = completed()
        value["backup"]["local"]["checks"] = {"manifest": "failed"}
        self.assertEqual(finalize(value)["exitCode"], 1)
        self.assertFalse(value["dataProtectionConfirmed"])

    def test_missing_mandatory_backup_subcheck_is_incomplete_two(self):
        for key in ("local", "encryption", "cloud"):
            with self.subTest(check=key):
                value = completed()
                del value["backup"][key]
                finalize(value)
                self.assertEqual((value["backup"]["status"], value["exitCode"]), ("INCOMPLETE", 2))

    def test_optional_backup_cloud_failure_is_yellow_zero(self):
        value = completed()
        value["backup"].update(policy="best-effort", outcome="WARNING")
        value["backup"]["cloud"]["status"] = "FAILED"
        finalize(value)
        self.assertEqual((value["outcome"], value["backup"]["status"], value["exitCode"]),
                         ("WARNING", "WARNING", 0))
        self.assertTrue(value["applicationAccepted"])
        self.assertFalse(value["dataProtectionConfirmed"])
        self.assertIn("[!] Резервирование", output(value))

    def test_best_effort_policy_does_not_downgrade_a_blocked_integrity_failure(self):
        value = completed()
        value["backup"].update(policy="best-effort", outcome="BLOCKED")
        value["backup"]["cloud"] = {"status": "FAILED", "error": "BACKUP_CLOUD_PROOF"}
        self.assertEqual((finalize(value)["exitCode"], value["backup"]["status"]), (1, "FAILED"))

    def test_schedule_action_does_not_hide_a_performed_failure(self):
        value = result("a" * 32, "c" * 32, "schedule", outcome="BLOCKED", code=2,
                       backup={"status": "FAILED", "schedule": {"installed": True, "running": True}})
        self.assertEqual((finalize(value)["exitCode"], value["backup"]["status"]), (1, "FAILED"))

    def test_optional_collector_has_separate_yellow_row_and_header(self):
        for state in ("warning", "FAILED", "NOT_RUN", "UNVERIFIED"):
            with self.subTest(state=state):
                value = completed()
                value["diagnostics"] = {"status": state, "reasonCode": "COLLECTOR_UNAVAILABLE"}
                finalize(value)
                self.assertEqual((value["outcome"], value["exitCode"]), ("WARNING", 0))
                self.assertTrue(value["applicationAccepted"])
                text = output(value)
                self.assertTrue(text.startswith("[!] ASA Setup:"))
                self.assertIn("6. [!] Диагностика", text)
                self.assertIn("COLLECTOR_UNAVAILABLE", text)
                self.assertEqual(text.count(". [OK]"), 5)
                self.assertEqual(json.loads(output(value, as_json=True))["diagnostics"]["status"], "warning")

    def test_selected_schedule_requires_installed_and_running(self):
        for installed, running in ((False, False), (False, True), (True, False)):
            with self.subTest(installed=installed, running=running):
                value = completed()
                value["backup"]["schedule"] = {"configuration": {"enabled": True},
                                                "installed": installed, "running": running}
                finalize(value)
                self.assertEqual((value["backup"]["status"], value["exitCode"]), ("INCOMPLETE", 2))
                self.assertNotIn("Расписание: активно", output(value))
                value["backup"]["schedule"].update(installed=True, running=True)
                self.assertEqual(finalize(value)["exitCode"], 0)

    def test_green_parent_cannot_hide_failed_explicit_checks(self):
        for key in ("dependencies", "version", "data"):
            with self.subTest(row=key):
                value = completed()
                value[key]["checks"] = {"mandatory": {"status": "FAILED"}}
                finalize(value)
                self.assertEqual((value[key]["status"], value["exitCode"]), ("FAILED", 1))

    def test_read_only_outcomes_and_interruption_keep_command_exit_codes(self):
        for outcome, code in (("STATUS", 0), ("CHECKED", 0), ("NO_CHANGE", 2),
                              ("BLOCKED", 2), ("ERROR", 1), ("INTERRUPTED", 130)):
            with self.subTest(outcome=outcome):
                value = result("a" * 32, "c" * 32, "status", outcome=outcome, code=code)
                self.assertEqual(finalize(value)["exitCode"], code)
                self.assertEqual(json.loads(output(value, as_json=True))["exitCode"], code)

    def test_terminal_warning_is_yellow_even_with_success_exit_code(self):
        value = completed()
        value["diagnostics"]["status"] = "warning"
        finalize(value)
        with patch.dict(os.environ, {"TERM": "xterm-256color"}, clear=True):
            text = output(value, stream=Terminal())
        self.assertTrue(text.startswith("\033[33m⚠\033[0m ASA Setup:"))
        self.assertIn("6. \033[33m⚠\033[0m Диагностика", text)

    def test_non_tty_no_color_and_dumb_terminal_are_escape_free(self):
        value = finalize(completed())
        for environment, terminal in (({"TERM": "xterm"}, io.StringIO()),
                                      ({"TERM": "xterm", "NO_COLOR": ""}, Terminal()),
                                      ({"TERM": "dumb"}, Terminal())):
            with self.subTest(environment=environment):
                with patch.dict(os.environ, environment, clear=True):
                    self.assertNotIn("\033[", output(value, stream=terminal))
        self.assertNotIn("\033[", output(value, as_json=True, stream=Terminal()))

    def test_render_does_not_mutate_a_saved_report(self):
        value = completed()
        original = copy.deepcopy(value)
        output(value)
        output(value, as_json=True)
        self.assertEqual(value, original)

    def test_nested_acceptance_and_collector_checks_cannot_hide_in_green_parent(self):
        for name in ("technical", "browser"):
            with self.subTest(check=name):
                value = completed()
                value["site"][name]["checks"] = {"required": "failed"}
                self.assertEqual(finalize(value)["exitCode"], 1)
        value = completed()
        value["diagnostics"]["checks"] = {"cycle": "warning"}
        self.assertEqual((finalize(value)["outcome"], value["exitCode"]), ("WARNING", 0))

    def test_current_technical_evidence_overrides_previous_version_and_data_green(self):
        for row, check in (("version", "images"), ("data", "data")):
            for state, expected, marker in (("failed", 1, "[X]"), ("not_run", 2, "[!]")):
                with self.subTest(row=row, check=check, state=state):
                    value = completed()
                    value["site"]["technical"]["checks"] = {check: state}
                    finalize(value)
                    self.assertEqual(value["exitCode"], expected)
                    self.assertEqual(value[row]["technicalChecks"][check], state)
                    self.assertIn(marker + " " + LABELS[row], output(value))

    def test_deferred_optional_retention_is_visible_yellow_without_pending_backup(self):
        value = completed()
        value.update(mode="backup", retention={"status": "DEFERRED", "reasonCode": "CLOUD_UNAVAILABLE",
                                              "nextAction": "Повторите очистку после восстановления связи."})
        finalize(value)
        self.assertEqual((value["outcome"], value["exitCode"], value["backup"]["status"]), ("WARNING", 0, "WARNING"))
        self.assertIn("Очистка старых копий отложена: CLOUD_UNAVAILABLE", output(value))

    def test_missing_copy_requires_durable_unstarted_export_proof(self):
        for local, expected in (({"executionStatus": "NOT_RUN"}, 2),
                                ({}, 1), ({"executionStatus": "RUNNING"}, 1),
                                ({"executionStatus": "NOT_RUN", "verifiedAt": "2026-11-04T00:00:00Z"}, 1),
                                ({"executionStatus": "NOT_RUN", "previouslyVerified": True}, 1)):
            with self.subTest(evidence=local):
                value = completed()
                value.update(mode="backup", outcome="BLOCKED", exitCode=2)
                value["backup"].update(outcome="BLOCKED", local={"status": "FAILED",
                    "error": "BACKUP_RESUME_SNAPSHOT_MISSING", **local})
                finalize(value)
                self.assertEqual(value["exitCode"], expected)
                self.assertIn(("[!]" if expected == 2 else "[X]") + " Резервирование", output(value))


class SetupResultCallerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.store = Store(self.root, IDENTITY)
        self.runtime = FakeRuntime(self.root)
        zones = patch("deployment.backup_schedule.ZoneInfo", side_effect=fixture_zone_info)
        zones.start()
        self.addCleanup(zones.stop)

    def journal(self, mode="update"):
        return self.store.create(mode, self.runtime.config["project"])

    def test_store_persists_failure_and_keeps_switched_operation_verification_only(self):
        journal = self.journal()
        self.store.event(journal, "switch", "done")
        value = completed()
        value.update(operationId=journal["operationId"], installationId=IDENTITY, outcome="ACCEPTED", exitCode=0)
        value["site"]["browser"]["status"] = "failed"
        answer = self.store.finish(journal, value)
        self.assertEqual((answer["outcome"], answer["exitCode"]), ("ERROR", 1))
        saved = self.store.read(journal["operationId"])
        self.assertEqual(saved["state"], "VERIFY_ONLY")
        self.assertEqual(saved["result"], private_json(self.root / ".asa/setup-last-attempt.json"))
        self.assertFalse((self.root / ".asa/setup-last-successful.json").exists())

    def test_real_cli_render_last_returns_the_same_code_as_json_and_saved_journal(self):
        for state, expected in (("failed", 1), ("not_run", 2)):
            with self.subTest(browser=state):
                journal = self.journal()
                self.store.event(journal, "switch", "done")
                stale = completed()
                stale.update(operationId=journal["operationId"], installationId=IDENTITY,
                             outcome="ACCEPTED", exitCode=0, applicationAccepted=True)
                stale["site"]["browser"]["status"] = state
                save_private(self.root / ".asa/setup-last-attempt.json", stale)
                stream = io.StringIO()
                with patch.object(asa_setup, "os", SimpleNamespace(geteuid=lambda: 1000)), \
                     patch("asa_setup.setup_host.check_owner", return_value={"uid": 1000}), \
                     patch("asa_setup.load_config", return_value=self.runtime.config), redirect_stdout(stream):
                    code = asa_setup.main(["status", "--root", str(self.root), "--render-last", "--json"])
                machine = json.loads(stream.getvalue())
                self.assertEqual(code, expected)
                self.assertEqual(machine["exitCode"], code)
                self.assertEqual(machine, private_json(self.root / ".asa/setup-last-attempt.json"))
                self.assertEqual(self.store.read(journal["operationId"])["result"], machine)
                self.assertFalse(machine["applicationAccepted"])

    def test_resume_recovers_durable_preflight_after_process_death_without_final_result(self):
        journal = self.journal("install")
        evidence = {"status": "OK", "operatorUid": 19001}
        with patch.object(self.runtime, "preflight", return_value=evidence), \
             patch.object(self.runtime, "backup", side_effect=ProcessKilled):
            with self.assertRaises(ProcessKilled):
                Engine(self.runtime, self.store).execute(journal)
        interrupted = self.store.read(journal["operationId"])
        self.assertNotIn("result", interrupted)
        self.runtime.calls.clear()
        answer = Engine(self.runtime, self.store).execute(interrupted, resume=True)
        self.assertEqual(answer["exitCode"], 0)
        self.assertEqual(answer["dependencies"], evidence)
        self.assertEqual(answer["version"]["running"], RELEASE["revision"])
        self.assertEqual(answer["data"]["status"], "INITIALIZED")
        for forbidden in ("select", "source", "plan", "switch", "backup"):
            self.assertNotIn(forbidden, self.runtime.calls)

    def test_no_change_acceptance_verifies_saved_receipt_without_creating_backup(self):
        self.runtime.old_revision = RELEASE["revision"]
        journal = self.journal()
        Engine(self.runtime, self.store).execute(journal)
        saved = receipt()
        save_private(self.root / ".asa/setup-backups/last-local-success.json",
                     {"snapshotId": saved["snapshotId"], "operationId": journal["operationId"], "at": "2026-11-04T00:00:00Z"})
        self.runtime.calls.clear()
        with patch("deployment.setup_operation.backup_workflow.verify_receipt", return_value=saved) as verify:
            answer = Engine(self.runtime, self.store).execute(self.store.read(journal["operationId"]), acceptance_only=True)
        verify.assert_called_once_with(self.runtime.install, snapshot_id=saved["snapshotId"], installation_id=IDENTITY)
        self.assertEqual(answer["exitCode"], 0)
        self.assertTrue(answer["applicationAccepted"])
        self.assertTrue(answer["dataProtectionConfirmed"])
        for forbidden in ("select", "source", "plan", "switch", "backup"):
            self.assertNotIn(forbidden, self.runtime.calls)

    def test_overwritten_stage_cannot_hide_loss_of_a_previously_verified_snapshot(self):
        journal = self.journal("backup")
        saved = receipt()
        self.store.event(journal, "backup", "done", evidence=saved)
        missing = {**saved, "outcome": "BLOCKED", "local": {"status": "FAILED", "executionStatus": "NOT_RUN",
                   "error": "BACKUP_RESUME_SNAPSHOT_MISSING"}}
        self.store.event(journal, "backup", "done", evidence=missing)
        answer = self.store.finish(journal, result(journal["operationId"], IDENTITY, "backup",
                                  outcome="BLOCKED", backup=missing))
        self.assertEqual((answer["backup"]["status"], answer["exitCode"]), ("FAILED", 1))
        self.assertTrue(answer["backup"]["local"]["previouslyVerified"])


class BackupExecutionEvidenceTests(unittest.TestCase):
    def test_crash_before_export_and_after_export_intent_have_different_outcomes(self):
        for before_export, expected in ((True, 2), (False, 1)):
            with self.subTest(before_export=before_export), tempfile.TemporaryDirectory() as directory:
                install = fake_install(directory)
                policy = {"policy": "best-effort", "cloud": {"enabled": False}}
                actual_save = backup_workflow._save
                def persist_then_kill(target, value):
                    actual_save(target, value)
                    if before_export and value["local"].get("executionStatus") == "NOT_RUN":
                        raise ProcessKilled()
                with patch.object(backup_workflow, "_save", side_effect=persist_then_kill), \
                     patch.object(backup_workflow, "export_backup", side_effect=ProcessKilled):
                    with self.assertRaises(ProcessKilled):
                        backup_workflow.run_backup(install, operation_id=OP, installation_id=BACKUP_ID,
                                                   snapshot_id=SNAP, policy=policy)
                with patch.object(backup_workflow, "export_backup") as export:
                    receipt = backup_workflow.run_backup(install, operation_id=OP, installation_id=BACKUP_ID,
                                                        snapshot_id=SNAP, policy=policy, allow_export=False)
                export.assert_not_called()
                answer = finalize(result(OP, BACKUP_ID, "backup", outcome=receipt["outcome"], backup=receipt))
                self.assertEqual(answer["exitCode"], expected)


class BootstrapResultTests(unittest.TestCase):
    def run_bootstrap_report(self, *, as_json, code):
        source = (Path(__file__).resolve().parents[2] / "asa-setup.sh").read_text(encoding="utf-8")
        function = source.split("asa_setup_bootstrap_failure() {", 1)[1].split("\n}\n", 1)[0]
        script = "set -euo pipefail\nasa_setup_json=" + ("true" if as_json else "false")
        script += "\nasa_setup_bootstrap_failure() {" + function + "\n}\nasa_setup_bootstrap_failure " + str(code)
        return subprocess.run(["bash", "-c", script], capture_output=True, text=True, encoding="utf-8", check=False)

    def test_bootstrap_json_and_text_match_actual_exit_without_preparing_host(self):
        for code, outcome, marker in ((2, "BLOCKED", "[!]"), (1, "ERROR", "[X]")):
            with self.subTest(code=code):
                process = self.run_bootstrap_report(as_json=True, code=code)
                value = json.loads(process.stdout)
                self.assertEqual((process.returncode, value["exitCode"], value["outcome"]), (code, code, outcome))
                self.assertFalse(value["applicationAccepted"])
                self.assertFalse(value["actionExecuted"])
                self.assertEqual(set(LABELS) - value.keys(), set())
                text = self.run_bootstrap_report(as_json=False, code=code)
                self.assertEqual(text.returncode, code)
                self.assertTrue(text.stdout.startswith(marker + " ASA Setup:"))
                self.assertIn("6. [!] Диагностика", text.stdout)
                self.assertNotIn("\033[", text.stdout)


if __name__ == "__main__":
    unittest.main()
