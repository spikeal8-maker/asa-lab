"""Closed artifact exporter contracts; these fixtures are not native acceptance."""
from __future__ import annotations

import ast
import contextlib
import copy
import hashlib
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
from unittest import mock

MODULE = Path(__file__).with_name("ci_realhost_evidence_report.py")
SPEC = importlib.util.spec_from_file_location("asa_realhost_evidence_report_test_subject", MODULE)
report = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = report
SPEC.loader.exec_module(report)

REVISION = "a" * 40
OPERATION = "b" * 32
INSTALLATION = "c" * 32
SECRET = "PRIVATE_TOKEN_email_cookie_password_DO_NOT_PRINT"
RUN = 123456789
ATTEMPT = 2


def runner_fixture():
    # Shape also observed in the earlier native f45 runner artifact. Values
    # below are synthetic and do not claim a new runner execution.
    return {"format": "asa-realhost-runner-preparation-v1", "sourceRevision": REVISION,
        "runId": RUN, "runAttempt": ATTEMPT, "runnerVerified": True, "status": "PASS",
        "reasonCode": "ALREADY_SUFFICIENT", "requiredFreeBytes": 24 * 1024**3,
        "reserveBytes": 3 * 1024**3, "cleanupDeadlineSeconds": 120,
        "beforeFreeBytes": 90 * 1024**3, "afterFreeBytes": 90 * 1024**3, "elapsedSeconds": 0.001,
        "targets": {"android": {"status": "NOT_NEEDED"}, "dotnet": {"status": "NOT_NEEDED"}}}


def native_fixture(phases=None):
    return {"format": "asa-realhost-evidence-v1", "sourceRevision": REVISION, "status": "FAIL",
        "reasonCode": "PUBLIC_CLI_FAILED", "acquisitionMode": "candidate", "cleanup": "NOT_RUN",
        "publicHTTPS": "NOT_RUN", "realYandexFromGuest": "NOT_RUN", "productionRestore": "NOT_RUN",
        "publishedSetupAcquisition": {"status": "BLOCKED", "reasonCode": "CANDIDATE_NOT_PUBLISHED_ATTESTED"},
        "checks": {}, "phases": phases or []}


def diagnostic_fixture():
    missing = {"state": "MISSING"}
    details = {"topReason": missing.copy(),
        "rows": {"backup": "WARNING", "data": "INITIALIZED", "dependencies": "OK",
                 "diagnostics": "warning", "site": "FAILED", "version": "RUNNING"},
        "browser": {"binding": "VERIFIED_PARENT_OPERATION", "runtimeProvenance": "PINNED_INVOCATION",
            "status": "failed", "reason": {"state": "RECOGNIZED", "code": "BROWSER_USER_FLOW_FAILED"},
            "checks": {name: "failed" for name in ("teacher_login", "student_login", "course_open",
                "existing_project_open", "scratch_save_reopen", "electronics_save_reopen")},
            "error": {"stage": "teacher_login_submit", "code": {"state": "RECOGNIZED", "code": "RuntimeError"}}},
        "backup": {"binding": "VERIFIED_PARENT_OPERATION", "policy": "best-effort", "outcome": "WARNING",
            "local": {"status": "OK", "error": missing.copy(), "reason": missing.copy()},
            "encryption": {"status": "OK", "error": missing.copy(), "reason": missing.copy()},
            "cloud": {"status": "NOT_CONFIGURED", "error": missing.copy(), "reason": missing.copy()},
            "errors": {"state": "OBSERVED", "codes": [], "truncated": False}}}
    diagnostic = {"status": "OBSERVED", "binding": "VERIFIED", "observation": "AFTER_PUBLIC_FAILURE",
        "operationId": OPERATION, "installationId": INSTALLATION, "mode": "install",
        "publicExitCode": 1, "managerExitCode": 1, "journalPhase": "first_backup", "receiptStage": "first_backup",
        "journalState": "VERIFY_ONLY", "outcome": "ERROR", "reasonCode": "UNRECOGNIZED_REASON",
        "stages": {"release": "done", "switch": "done", "browser": "done", "first_backup": "done"},
        "unrecognizedStageCount": 0, "selectedRelease": {"status": "CONFIRMED", "pin": "previous",
            "revision": "d" * 40, "schema": 304},
        "acceptance": {"actionExecuted": True, "executionCompleted": True, "technicalCompleted": True,
            "ownerCompleted": True, "firstBackupCompleted": True, "browserCompleted": False,
            "applicationAccepted": False, "dataProtectionConfirmed": False},
        "receiptDetails": details}
    action = {"command": "asa install", "exitCode": 1, "status": "FAILED", "reasonCodes": [],
        "operationOutcome": "ERROR", "operationId": OPERATION, "installationId": INSTALLATION}
    return {"name": "public_asa_install", "status": "FAIL",
            "evidence": {"cliActions": [action], "commandFailureDiagnostic": diagnostic}}


def export(native=None, runner=None, **overrides):
    expected = {"revision": REVISION, "run_id": RUN, "run_attempt": ATTEMPT, "native_conclusion": "failure"}
    expected.update(overrides)
    return report.project_documents(native_fixture() if native is None else native,
        runner_fixture() if runner is None else runner, **expected)


def emitted(value):
    return report.encoded_report(value).decode("ascii")


def projected_failure(value):
    return value["native"]["data"]["phases"][0]["data"]["commandFailureDiagnostic"]


def disk_fixture():
    return {"status": "OK", "filesystems": {name: {"status": "OK", "path": "/" + SECRET,
        "totalBytes": 10000000000, "freeBytes": 8000000000, "usedBytes": 2000000000,
        "freeInodes": 10000, "totalInodes": 20000}
        for name in ("application", "backups", "docker", "postgres", "minio")},
        "database": {"status": "OK", "schema": 304, "bytes": 1024},
        "physicalHealth": {"status": "UNAVAILABLE", "reasonCode": "USE_DISK_HEALTH"}}


def backup_item_fixture():
    return {"status": "RECORDED", "snapshotId": "20261105T010000Z-1234abcd", "ageHours": 1,
        "local": {"status": "OK", "bytes": 2000, "present": True, "deleted": False},
        "encryption": {"status": "OK", "bytes": 1000},
        "cloud": {"status": "NOT_CONFIGURED", "deleted": False}}


def backup_fixture():
    return {"status": "RECORDED", "lastAttempt": backup_item_fixture(), "lastLocalSuccess": backup_item_fixture(),
        "lastCloudSuccess": {"status": "UNAVAILABLE", "reasonCode": "BACKUP_EVIDENCE_MISSING"},
        "schedule": {"status": "OK", "enabled": False}}


def example_fixtures():
    current = {"status": "RECORDED", "revision": "d" * 40, "schema": 304}
    database = {"status": "OK", "schema": 304, "bytes": 1024}
    services = {"status": "OK", "containers": [{"service": name, "running": True, "health": "healthy"}
        for name in ("api", "web", "postgres", "minio", "scratch", "search")]}
    status = {"format": "asa-cli-result-v1", "command": "status", "status": "OK", "exitCode": 0,
        "root": "/" + SECRET, "access": "OBSERVED", "installed": current, "database": database,
        "services": services, "backup": backup_fixture(),
        "updates": {"status": "UNAVAILABLE", "checkedAt": None, "reasonCode": "USE_UPDATE_CHECK"},
        "site": {"status": "OK", "origin": "https://" + SECRET, "https": "UNAVAILABLE",
            "revision": "d" * 40, "reportedSchema": 304,
            "browserAcceptance": {"status": "NOT_RUN", "reasonCode": "READ_ONLY",
                "historical": {"status": "RECORDED", "applicationAccepted": True, "operationId": OPERATION}}}}
    help_value = {"format": "asa-cli-result-v1", "command": "help", "status": "OK", "exitCode": 0, "topic": "",
        "commands": [{"command": "asa " + name, "changesData": changes} for name, changes in report.COMMANDS.items()],
        "exitCodes": [0, 1, 2, 130], "description": SECRET, "parameters": [SECRET]}
    disk = {**disk_fixture(), "format": "asa-cli-result-v1", "command": "disk", "exitCode": 0}
    update = {"format": "asa-cli-result-v1", "command": "update check", "status": "PLANNED", "exitCode": 0,
        "current": current, "currentDatabase": database,
        "target": {"revision": "e" * 40, "schema": 304, "deploymentDigest": "sha256:" + "f" * 64,
            "manifestDigest": "sha256:" + "1" * 64, "ci": "VERIFIED"},
        "available": True, "migrations": {"status": "SCHEMA_RANGE_ONLY", "fromSchema": 304, "toSchema": 304,
            "exactList": None, "reasonCode": "EXACT_PLAN_REQUIRES_VERIFIED_MIGRATION_RUNTIME"},
        "requiredSpaceBytes": None, "estimatedDowntimeSeconds": None,
        "spaceReasonCode": "NEW_IMAGE_UNPACKED_BYTES_UNKNOWN", "downtimeReasonCode": "NO_MEASURED_DURATION",
        "backupSpaceEstimate": {"status": "UNAVAILABLE", "reasonCode": "STORAGE_MEASUREMENT_UNAVAILABLE"},
        "blockers": [], "applyRechecksUnderLock": True, "apply": SECRET,
        "cloud": {"status": "UNAVAILABLE", "configured": False, "policy": "best-effort",
            "transport": {"status": "UNAVAILABLE", "reasonCode": "CLOUD_NOT_CONFIGURED"},
            "remote": {"status": "UNAVAILABLE", "reasonCode": "NO_READ_ONLY_PROVIDER_PROBE"},
            "lastDelivery": {"status": "UNAVAILABLE", "reasonCode": "BACKUP_EVIDENCE_MISSING"}}}
    return {"help": help_value, "status": status, "disk": disk, "update-check": update}


def cli_fixture():
    reads = ("version", "status", "doctor", "disk", "disk usage", "disk health", "services", "services status",
        "update", "update check", "update plan", "update history", "backup status", "backup list",
        "backup verify", "backup schedule", "cloud status", "config show", "history", "logs",
        "logs update", "logs backup", "restore plan")
    cases = [{"case": label, "command": "help", "status": "OK", "exitCode": 0} for label in
        ("help", "help-option", "help-update", "update-help-option", "backup-help-option")]
    cases.append({"case": "bare-json", "command": "status", "status": "OK", "exitCode": 0})
    for command in reads:
        state = ("PLANNED" if command in ("update", "update check", "update plan") else
                 "UNAVAILABLE" if command in ("disk health", "cloud status") else
                 "BLOCKED_PLAN" if command == "restore plan" else
                 "RECORDED" if command in ("backup status", "backup list", "update history", "history", "logs", "logs update", "logs backup")
                 else "OK")
        cases.append({"case": command.replace(" ", "-"), "command": command, "status": state,
                      "exitCode": 2 if state == "BLOCKED_PLAN" else 1 if state == "UNAVAILABLE" else 0})
    control = {"databaseSha256": "1" * 64, "databaseRows": 10, "objectsSha256": "2" * 64, "objectCount": 1, "objectBytes": 32}
    filesystem = {"files": 14, "directories": 4, "absent": 1, "sha256": "3" * 64}
    bare = {}
    for name, mode in (("pipe", "PIPE"), ("pty", "PTY")):
        bare[name] = {"status": "OK", "exitCode": 0, "mode": mode,
            "stdin": "ENTER_AFTER_PROMPT" if mode == "PTY" else "CLOSED", "menuObserved": mode == "PTY",
            "root": "/" + SECRET, "revision": "d" * 40, "schema": 304,
            "healthyServices": 6, "containers": 8, "compactLines": 7}
    examples = example_fixtures()
    observations = {
        "doctor": {"format": "asa-cli-result-v1", "command": "doctor", "status": "OK", "exitCode": 0,
            "diskHealth": {"status": "UNAVAILABLE", "reasonCode": "SMART_UNAVAILABLE"},
            "cloud": examples["update-check"]["cloud"], "optionalUnavailableChecks": ["diskHealth", "cloud", "cloud.transport", "cloud.remote"]},
        "disk-health": {"format": "asa-cli-result-v1", "command": "disk health", "status": "UNAVAILABLE", "exitCode": 1,
            "reasonCode": "SMART_UNAVAILABLE"},
        "cloud-status": {**examples["update-check"]["cloud"], "format": "asa-cli-result-v1", "command": "cloud status", "exitCode": 1},
        "restore-plan": {"format": "asa-cli-result-v1", "command": "restore plan", "status": "BLOCKED_PLAN", "exitCode": 2,
            "reasonCode": "P1_R3A_REQUIRED", "applyAllowed": False, "snapshotId": "20261105T010000Z-1234abcd",
            "restore": {"status": "UNAVAILABLE", "reasonCode": "NOT_RESTORED"}, "nextAction": SECRET},
    }
    return {"status": "PASS", "publicProcessCases": 31,
        "cliReadBinding": {"status": "VERIFIED", "sourceRevision": REVISION, "bundleSha256": "4" * 64, "wrapperSha256": "5" * 64},
        "cliReadEvidence": {"format": "asa-realhost-cli-runtime-v1", "status": "PASS", "cases": cases,
            "examples": examples, "observations": observations, "bare": bare,
            "filesystem": {"status": "UNCHANGED", "unchanged": True, "before": filesystem, "after": filesystem.copy()},
            "control": {"status": "UNCHANGED", "unchanged": True, "before": control, "after": control.copy()}}}


class BindingAndReceiptTests(unittest.TestCase):
    def test_historical_failure_shape_stays_failure_with_known_inner_details(self):
        value = export(native_fixture([diagnostic_fixture()]))
        self.assertEqual(value["binding"], "SOURCE_RUN_ATTEMPT")
        self.assertEqual(value["nativeConclusion"], "failure")
        self.assertEqual(value["native"]["data"]["sourceStatus"], "FAIL")
        diagnostic = projected_failure(value)["data"]
        details = diagnostic["receiptDetails"]["data"]
        self.assertEqual(details["topReason"], {"state": "MISSING"})
        self.assertEqual(details["browser"]["error"]["stage"], "teacher_login_submit")
        self.assertEqual(details["browser"]["runtimeProvenance"], "PINNED_INVOCATION")
        self.assertEqual(details["backup"]["encryption"]["status"], "OK")
        self.assertEqual(details["backup"]["cloud"]["status"], "NOT_CONFIGURED")
        self.assertFalse(diagnostic["acceptance"]["browserCompleted"])
        self.assertFalse(diagnostic["acceptance"]["dataProtectionConfirmed"])
        self.assertFalse(value["revalidatedRuntime"])

    def test_old_attempt_missing_identity_wrong_sha_and_bool_ids_never_bind(self):
        for field, bad in (("runAttempt", 1), ("runId", RUN + 1), ("sourceRevision", "f" * 40),
                           ("runnerVerified", 1), ("runId", True), ("runAttempt", True)):
            with self.subTest(field=field, bad=bad):
                runner = runner_fixture()
                runner[field] = bad
                result = export(native_fixture([diagnostic_fixture()]), runner)
                self.assertEqual(result["binding"], "UNAVAILABLE")
                self.assertEqual(result["reportStatus"], "UNAVAILABLE")
                self.assertNotIn("receiptDetails", emitted(result))
        for field in ("sourceRevision", "runAttempt", "runId", "runnerVerified"):
            runner = runner_fixture()
            del runner[field]
            self.assertEqual(export(runner=runner)["reasonCode"], "IDENTITY_MISSING")

    def test_native_source_revision_must_match_independent_context(self):
        native = native_fixture([diagnostic_fixture()])
        native["sourceRevision"] = "f" * 40
        result = export(native)
        self.assertEqual(result["binding"], "UNAVAILABLE")
        self.assertEqual(result["reasonCode"], "SOURCE_BINDING")
        self.assertNotIn("receiptDetails", emitted(result))

    def test_receipt_requires_matching_recorded_public_ids_exit_mode_and_outcome(self):
        for key, bad in (("operationId", "f" * 32), ("installationId", "f" * 32),
                         ("publicExitCode", 2), ("mode", "update"), ("outcome", "WARNING")):
            phase = diagnostic_fixture()
            phase["evidence"]["commandFailureDiagnostic"][key] = bad
            with self.subTest(key=key):
                result = projected_failure(export(native_fixture([phase])))
                self.assertEqual(result["availability"], "UNAVAILABLE")
        phase = diagnostic_fixture()
        phase["evidence"]["commandFailureDiagnostic"]["binding"] = "UNVERIFIED"
        diagnostic = projected_failure(export(native_fixture([phase])))["data"]
        self.assertEqual(diagnostic["binding"], "UNAVAILABLE")
        self.assertNotIn("receiptDetails", diagnostic)

    def test_closed_marker_http_limits_unknown_and_nested_values(self):
        for code in ("RuntimeError", "SYNTHETIC_LOGIN_IDENTITY_MISMATCH", "SAVE_NOT_OBSERVED",
                     "REOPEN_VALUE_MISMATCH", "REOPEN_DRAFT_MISMATCH"):
            phase = diagnostic_fixture()
            phase["evidence"]["commandFailureDiagnostic"]["receiptDetails"]["browser"]["error"]["code"]["code"] = code
            details = projected_failure(export(native_fixture([phase])))["data"]["receiptDetails"]
            self.assertEqual(details["data"]["browser"]["error"]["code"]["code"], code)
        for code in ("SYNTHETIC_LOGIN_IDENTITY_MISMATCH_" + SECRET, "RuntimeErro\u0440", SECRET, {}, True):
            phase = diagnostic_fixture()
            phase["evidence"]["commandFailureDiagnostic"]["receiptDetails"]["browser"]["error"]["code"]["code"] = code
            value = export(native_fixture([phase]))
            self.assertEqual(projected_failure(value)["data"]["receiptDetails"]["availability"], "UNAVAILABLE")
            self.assertNotIn(SECRET, emitted(value))
        for status in (100, 200, 599, 99, 600, True):
            phase = diagnostic_fixture()
            error = phase["evidence"]["commandFailureDiagnostic"]["receiptDetails"]["browser"]["error"]
            error["code"] = {"state": "RECOGNIZED", "code": "API_STATUS", "httpStatus": status}
            details = projected_failure(export(native_fixture([phase])))["data"]["receiptDetails"]
            self.assertEqual(details["availability"], "RECORDED" if type(status) is int and 100 <= status <= 599 else "UNAVAILABLE")

    def test_early_browser_and_top_reason_presence_are_not_promoted(self):
        phase = diagnostic_fixture()
        details = phase["evidence"]["commandFailureDiagnostic"]["receiptDetails"]
        details["browser"].update(status="environment_failed", runtimeProvenance="NOT_RECORDED",
            checks={name: "not_run" for name in details["browser"]["checks"]}, error={"state": "MISSING"})
        for state in ("MISSING", "NULL"):
            details["topReason"] = {"state": state}
            observed = projected_failure(export(native_fixture([phase])))["data"]["receiptDetails"]["data"]
            self.assertEqual(observed["topReason"]["state"], state)
            self.assertEqual(observed["browser"]["runtimeProvenance"], "NOT_RECORDED")
        details["browser"]["status"] = "passed"
        self.assertEqual(projected_failure(export(native_fixture([phase])))["data"]["receiptDetails"]["availability"], "UNAVAILABLE")

    def test_declared_child_is_not_new_child_journal_verification(self):
        phase = diagnostic_fixture()
        phase["evidence"]["commandFailureDiagnostic"]["receiptDetails"]["backup"]["binding"] = "DECLARED_FIRST_BACKUP_CHILD"
        result = projected_failure(export(native_fixture([phase])))["data"]["receiptDetails"]["data"]
        self.assertEqual(result["backup"]["binding"], "DECLARED_FIRST_BACKUP_CHILD")
        phase["evidence"]["commandFailureDiagnostic"]["mode"] = "update"
        phase["evidence"]["cliActions"][0]["command"] = "asa update apply"
        self.assertEqual(projected_failure(export(native_fixture([phase])))["data"]["receiptDetails"]["availability"], "UNAVAILABLE")

    def test_unknown_private_values_and_extra_payload_are_not_copied(self):
        phase = diagnostic_fixture()
        phase["evidence"].update(stdout=SECRET, stderr=SECRET, message=SECRET, env={"GH_TOKEN": SECRET})
        phase["evidence"]["commandFailureDiagnostic"]["receiptDetails"]["browser"]["componentSha256"] = SECRET
        native = native_fixture([phase])
        native.update(reasonCode=SECRET, private={"token": SECRET})
        value = export(native)
        self.assertEqual(value["native"]["data"]["reason"]["state"], "UNRECOGNIZED")
        self.assertNotIn(SECRET, emitted(value))
        self.assertEqual(projected_failure(value)["data"]["receiptDetails"]["availability"], "UNAVAILABLE")

    def test_unknown_failed_phase_is_unavailable_without_echo(self):
        value = native_fixture([{"name": SECRET, "status": "FAIL", "evidence": {"reasonCode": SECRET}}])
        result = export(value)
        self.assertEqual(result["native"]["availability"], "UNAVAILABLE")
        self.assertNotIn(SECRET, emitted(result))


class CLIProjectionTests(unittest.TestCase):
    def test_recorded_cases_four_examples_optional_unavailable_and_blocked_restore(self):
        value = report.cli_read(cli_fixture(), REVISION)
        self.assertEqual(value["recordedJsonCases"], 29)
        self.assertEqual(value["recordedBareModes"], 2)
        self.assertEqual(value["declaredPublicProcessCases"], 31)
        self.assertEqual(set(value["examples"]), {"help", "status", "disk", "update-check"})
        self.assertNotIn("update-plan", value["examples"])
        self.assertEqual(value["observations"]["disk-health"]["data"]["status"], "UNAVAILABLE")
        self.assertEqual(value["observations"]["restore-plan"]["data"]["exitCode"], 2)
        self.assertFalse(value["observations"]["restore-plan"]["data"]["applyAllowed"])
        self.assertEqual(value["observations"]["doctor"]["data"]["optionalUnavailableChecks"],
                         ["diskHealth", "cloud", "cloud.transport", "cloud.remote"])
        self.assertNotIn(SECRET, emitted(value))

    def test_partial_suite_keeps_checked_example_and_changed_control_without_success(self):
        value = cli_fixture()
        evidence = value["cliReadEvidence"]
        value.pop("publicProcessCases")
        evidence.update(status="FAIL", cases=evidence["cases"][:2], failedCase="help-update",
                        reasonCode="CLI_SEMANTICS", semanticCode="HELP_CONTRACT", bare={})
        evidence["control"]["after"] = {**evidence["control"]["after"], "databaseRows": 11}
        evidence["control"].update(status="CHANGED", unchanged=False)
        evidence["filesystem"] = {"status": "UNAVAILABLE", "reasonCode": "FILESYSTEM_READ"}
        observed = report.cli_read(value, REVISION)
        self.assertEqual(observed["status"], "FAIL")
        self.assertEqual(observed["recordedJsonCases"], 2)
        self.assertEqual(observed["recordedBareModes"], 0)
        self.assertEqual(observed["examples"]["help"]["availability"], "RECORDED")
        self.assertEqual(observed["examples"]["status"]["availability"], "NOT_RECORDED")
        self.assertEqual(observed["control"]["data"]["status"], "CHANGED")
        self.assertEqual(observed["filesystem"]["data"]["status"], "UNAVAILABLE")
        self.assertNotIn("declaredPublicProcessCases", observed)
        self.assertEqual(len(observed["examples"]["help"]["data"]["projection"]["advertisedCommands"]), 29)
        self.assertEqual(len(observed["notRecordedCases"]), 27)

    def test_case_order_command_exit_type_and_binding_changes_are_rejected(self):
        mutations = (
            lambda x: x["cliReadEvidence"]["cases"][0].update(case="status"),
            lambda x: x["cliReadEvidence"]["cases"][0].update(command="install"),
            lambda x: x["cliReadEvidence"]["cases"][0].update(exitCode=True),
            lambda x: x["cliReadEvidence"]["cases"][0].update(status="FAILED"),
            lambda x: x["cliReadBinding"].update(sourceRevision="f" * 40),
            lambda x: x["cliReadEvidence"].update(failedCase=SECRET),
        )
        for mutation in mutations:
            value = cli_fixture()
            mutation(value)
            with self.subTest(mutation=mutation), self.assertRaises(report.ReportError):
                report.cli_read(value, REVISION)

    def test_examples_require_matching_completed_case_and_reject_bool_numeric_fields(self):
        value = cli_fixture()
        value["cliReadEvidence"]["examples"]["status"]["exitCode"] = 1
        self.assertEqual(report.cli_read(value, REVISION)["examples"]["status"]["availability"], "UNAVAILABLE")
        for key in ("schema", "bytes"):
            value = cli_fixture()
            value["cliReadEvidence"]["examples"]["status"]["database"][key] = True
            database = report.cli_read(value, REVISION)["examples"]["status"]["data"]["projection"]["database"]
            self.assertEqual(database["availability"], "UNAVAILABLE")

    def test_unmeasured_totals_stay_null_and_false_measured_values_are_rejected(self):
        value = report.cli_read(cli_fixture(), REVISION)["examples"]["update-check"]["data"]["projection"]
        self.assertIsNone(value["requiredSpaceBytes"])
        self.assertIsNone(value["estimatedDowntimeSeconds"])
        self.assertEqual(value["backupSpaceEstimate"]["data"]["status"], "UNAVAILABLE")
        for key in ("requiredSpaceBytes", "estimatedDowntimeSeconds"):
            fixture = cli_fixture()
            fixture["cliReadEvidence"]["examples"]["update-check"][key] = 1
            self.assertEqual(report.cli_read(fixture, REVISION)["examples"]["update-check"]["availability"], "UNAVAILABLE")

    def test_control_exact_five_fields_and_comparison_consistency(self):
        fixture = cli_fixture()
        before = fixture["cliReadEvidence"]["control"]["before"]
        for key, bad in (("databaseRows", True), ("objectBytes", -1), ("databaseSha256", SECRET)):
            changed = {**before, key: bad}
            with self.subTest(key=key), self.assertRaises(report.ReportError):
                report.control_five(changed)
        with self.assertRaises(report.ReportError):
            report.control_five({**before, "environment": SECRET})
        fixture["cliReadEvidence"]["control"]["after"] = {**before, "databaseRows": 12}
        self.assertEqual(report.cli_read(fixture, REVISION)["control"]["availability"], "UNAVAILABLE")



class LifecycleAndReaderContracts(unittest.TestCase):
    def test_required_cloud_negative_case_keeps_expected_nonzero_and_no_egress(self):
        value = {"credentialKind": "DUMMY_ONLY", "realProviderAuthentication": "NOT_RUN",
            "realYandexUploadReadback": "NOT_RUN", "specificProviderError": "UNAVAILABLE",
            "cases": {"required": {"status": "PASS", "operationId": OPERATION, "observedPublicExitCode": 1,
                "completeSnapshotsBefore": 1, "completeSnapshotsAfter": 2, "completeSnapshotsDelta": 1,
                "result": {"publicStatus": "FAILED", "publicExitCode": 1, "setupOutcome": "ERROR",
                    "receiptOutcome": "BLOCKED", "journalState": "TERMINAL", "local": "OK", "encryption": "OK",
                    "cloud": "FAILED", "cloudReasonCode": "CLOUD_TRANSFER_FAILED",
                    "dataProtectionConfirmed": False, "receiptProtectionConfirmed": False},
                "transport": {"status": "OBSERVED", "command": "PINNED_RCLONE_MKDIR", "exitCode": 5,
                    "completeCreateStartDie": True, "naturalCompletion": True, "healthExecutions": 0,
                    "classification": "TRANSPORT_FAILURE_UNDER_PROVEN_NO_EGRESS", "specificErrno": "UNAVAILABLE"}}},
            "cleanup": {"status": "PASS", "hostProcessesQuiescent": True, "containerExecsQuiescent": True,
                "sourceDummyRemoved": True, "egressRestored": False, "rawError": SECRET}}
        result = report.cloud_fault(value)
        required = result["cases"]["required"]["data"]
        self.assertEqual(required["status"], "PASS")
        self.assertEqual(required["result"]["publicStatus"], "FAILED")
        self.assertEqual(required["observedPublicExitCode"], 1)
        self.assertFalse(result["cleanup"]["egressRestored"])
        self.assertNotIn(SECRET, emitted(result))

    def test_same_id_recovery_refusal_is_distinct_from_new_backup(self):
        value = {"injection": "OWNED_PUBLIC_PROCESS_GROUP_SIGINT", "operationId": OPERATION, "publicExitCode": 130,
            "realYandexFault": "NOT_RUN",
            "sameIdRecovery": {"publicExitCode": 2, "sameSnapshotAndPartialBytes": True,
                "allOwnedProcessesExited": True, "lastLocalSuccessPreserved": True,
                "receipt": {"journalState": "RECOVERY_REQUIRED", "outcome": "BLOCKED", "localStatus": "FAILED",
                    "localExecutionStatus": "UNKNOWN", "localReasonCode": "BACKUP_RESUME_SNAPSHOT_MISSING"}}}
        result = report.backup_fault(value)
        recovery = result["sameIdRecovery"]["data"]
        self.assertEqual(recovery["publicExitCode"], 2)
        self.assertEqual(recovery["receipt"]["data"]["localReason"]["code"], "BACKUP_RESUME_SNAPSHOT_MISSING")
        self.assertNotIn("newSuccessfulBackup", result)
        self.assertNotIn("interruptedDuringCopy", emitted(result))

    def test_reboot_timer_and_actual_actions_keep_context_without_paths(self):
        value = {"beforeBootId": "a" * 8 + "-aaaa-aaaa-aaaa-" + "a" * 12,
            "afterBootId": "b" * 8 + "-bbbb-bbbb-bbbb-" + "b" * 12,
            "sameVirtualDisk": True, "clockChanged": False,
            "fixtureSchedulePreparation": {"unit": SECRET, "timezone": SECRET,
                "fixtureOnlyTimeSelection": True, "publicCliTimeSetterClaimed": False, "enableDisableEnable": "PASS",
                "cliActions": [{"command": "asa backup schedule enable", "exitCode": 0, "status": "OK", "reasonCodes": []}]},
            "persistentRecovery": {"persistentTimerRecoveredMissedSlot": True, "attemptsInDailySlot": 1},
            "boundedRetry": {"fourthStartRefusedOrSkipped": True, "fourthStartExitCode": 1,
                "restartSecUnchanged": 300, "attemptsInDailySlot": 3, "publicDisableCompleted": True,
                "cliActions": [{"command": "asa backup schedule disable", "exitCode": 0, "status": "OK", "reasonCodes": []}]}}
        phase = report.phase_projection({"name": "real_persistent_timer", "status": "PASS", "evidence": value}, REVISION)
        self.assertEqual(phase["fixtureSchedulePreparation"]["data"]["cliActions"]["data"][0]["command"], "asa backup schedule enable")
        self.assertEqual(phase["boundedRetry"]["data"]["fourthStartExitCode"], 1)
        self.assertFalse(phase["details"]["data"]["clockChanged"])
        self.assertNotIn(SECRET, emitted(phase))

    def test_unknown_successful_receipt_reason_does_not_escape_via_code_pattern(self):
        value = {"operationId": OPERATION, "installationId": INSTALLATION, "outcome": "WARNING", "mode": "install",
            "reasonCode": "PRIVATE_" + SECRET, "applicationAccepted": True, "dataProtectionConfirmed": False,
            "technicalStatus": True, "browserStatus": True}
        result = report.lifecycle_receipt(value)
        self.assertEqual(result["reason"]["state"], "UNRECOGNIZED")
        self.assertNotIn(SECRET, emitted(result))
        value["outcome"] = SECRET
        with self.assertRaises(report.ReportError):
            report.lifecycle_receipt(value)

    def test_strict_json_rejects_duplicate_nonfinite_utf8_depth_and_node_budget(self):
        inputs = (b'{"x":1,"x":2}', b'{"nested":{"x":1,"x":2}}', b'{"x":NaN}',
                  b'{"x":Infinity}', b'{"x":1e309}', b'{"x":"\xff"}', b'[]')
        for raw in inputs:
            with self.subTest(raw=raw), self.assertRaises(report.ReportError):
                report.strict_json(raw, 65536)
        nested = (b'{"x":' * 34) + b'0' + (b'}' * 34)
        with self.assertRaisesRegex(report.ReportError, "JSON_LIMIT"):
            report.strict_json(nested, 65536)
        with mock.patch.object(report, "MAX_NODES", 10):
            with self.assertRaisesRegex(report.ReportError, "JSON_LIMIT"):
                report.strict_json(b'{"x":[0,0,0,0,0,0,0,0,0,0]}', 65536)
        with self.assertRaisesRegex(report.ReportError, "INPUT_SIZE"):
            report.strict_json(b'{"x":12345}', 8)

    def test_numbers_do_not_accept_bools_or_nonfinite_values(self):
        for value in (True, False, "1", -1, 2**63):
            with self.subTest(value=value), self.assertRaises(report.ReportError):
                report.integer(value)
        for value in (True, float("nan"), float("inf"), -0.1):
            with self.subTest(value=value), self.assertRaises(report.ReportError):
                report.number(value)

    def test_normalized_metadata_accepts_0644_and_rejects_foreign_owner_links_and_writes(self):
        info = SimpleNamespace(st_mode=stat.S_IFREG | 0o644, st_uid=os.getuid() if hasattr(os, "getuid") else 1,
                               st_nlink=1, st_size=128)
        uid = info.st_uid
        with mock.patch.object(report.os, "geteuid", return_value=uid, create=True):
            report.file_metadata(info, 1024)
            for field, value in (("st_mode", stat.S_IFREG | 0o666), ("st_uid", uid + 1),
                                 ("st_nlink", 2), ("st_mode", stat.S_IFIFO | 0o600), ("st_size", 1025)):
                mutated = SimpleNamespace(**{**vars(info), field: value})
                with self.subTest(field=field, value=value), self.assertRaises(report.ReportError):
                    report.file_metadata(mutated, 1024)

    def test_output_budget_and_fixed_error_frame_never_echo_exception_text(self):
        with self.assertRaisesRegex(report.ReportError, "OUTPUT_LIMIT"):
            report.encoded_report({"value": "x" * report.OUTPUT_LIMIT})
        stdout = io.StringIO()
        expected = {"revision": REVISION, "run_id": RUN, "run_attempt": ATTEMPT, "native_conclusion": "failure"}
        with mock.patch.object(report.sys, "argv", ["reporter"]), \
             mock.patch.object(report, "expected_context", return_value=(expected, "/unused")), \
             mock.patch.object(report, "read_artifacts", side_effect=RuntimeError(SECRET)), \
             contextlib.redirect_stdout(stdout):
            self.assertEqual(report.main(), 2)
        lines = stdout.getvalue().splitlines()
        self.assertEqual(lines[0], "ASA_REALHOST_REPORT_BEGIN")
        self.assertEqual(lines[-1], "ASA_REALHOST_REPORT_END")
        parsed = json.loads("\n".join(lines[1:-1]))
        self.assertEqual(parsed["reasonCode"], "REPORT_ERROR")
        self.assertNotIn(SECRET, stdout.getvalue())

    def test_source_vocabularies_match_producers_without_importing_them(self):
        here = Path(__file__).parent
        module = ast.parse(MODULE.read_text(encoding="utf-8"))
        harness = ast.parse((here / "ci_setup_realhost.py").read_text(encoding="utf-8"))
        runtime = ast.parse((here / "realhost_cli_runtime.py").read_text(encoding="utf-8"))
        checker = ast.parse((here / "realhost_cli_checks.py").read_text(encoding="utf-8"))

        def assignment(tree, name):
            return next(node.value for node in tree.body if isinstance(node, ast.Assign)
                        and any(isinstance(target, ast.Name) and target.id == name for target in node.targets))

        names = ("DIAGNOSTIC_REASONS", "COMMAND_DIAGNOSTIC_STAGES", "COMMAND_DIAGNOSTIC_REASONS",
                 "COMMAND_DIAGNOSTIC_OUTCOMES", "RECEIPT_ROWS", "RECEIPT_ROW_STATUSES", "RECEIPT_BROWSER_CHECKS",
                 "RECEIPT_BROWSER_REASONS", "RECEIPT_BROWSER_STAGES", "RECEIPT_BROWSER_ERRORS", "RECEIPT_BACKUP_ERRORS")
        for name in names:
            self.assertEqual(ast.dump(assignment(module, name)), ast.dump(assignment(harness, name)), name)
        for name in ("READ_COMMANDS", "HELP_FORMS"):
            self.assertEqual(ast.dump(assignment(module, name)), ast.dump(assignment(runtime, name)), name)
        self.assertEqual(ast.dump(assignment(module, "COMMANDS")), ast.dump(assignment(checker, "COMMANDS")))
        host = next(node for node in harness.body if isinstance(node, ast.ClassDef) and node.name == "HostRun")
        run = next(node for node in host.body if isinstance(node, ast.FunctionDef) and node.name == "run")
        calls = sorted((node.lineno, node.args[0].value) for node in ast.walk(run)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "phase"
            and node.args and isinstance(node.args[0], ast.Constant))
        self.assertEqual(tuple(name for _, name in calls), report.PHASES)
        producers = [harness, runtime, checker]
        for filename in ("ci_prepare_realhost_runner.py", "cli_observe.py", "release_readonly.py"):
            producers.append(ast.parse((here / filename).read_text(encoding="utf-8")))
        literals = {node.value for tree in producers for node in ast.walk(tree)
                    if isinstance(node, ast.Constant) and type(node.value) is str}
        self.assertLessEqual(report.EXTRA_REASONS, literals)

    def test_new_job_is_optional_and_runs_report_after_failed_download_without_cross_run_input(self):
        workflow = MODULE.parents[2] / ".github/workflows/setup-realhost.yml"
        source = workflow.read_text(encoding="utf-8")
        before, job = source.split("\n  evidence_report:\n")
        self.assertNotIn("continue-on-error:", before)
        self.assertIn("    needs: realhost\n    if: always()\n    continue-on-error: true\n", job)
        self.assertIn("    permissions:\n      contents: read\n      actions: read\n", job)
        self.assertIn("actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093", job)
        self.assertIn("name: asa-realhost-evidence-${{ github.event.pull_request.head.sha || github.sha }}", job)
        self.assertIn("path: ${{ runner.temp }}/asa-realhost-report", job)
        self.assertIn("if: always() && steps.source.outcome == 'success'", job)
        self.assertIn("run: python3 -I -B tools/deployment/ci_realhost_evidence_report.py", job)
        self.assertNotIn("github-token:", job)
        self.assertNotIn("run-id:", job)
        self.assertNotIn("repository:", job)
        for forbidden in ("sudo ", "docker ", "apt-get", "GH_TOKEN:", "packages: write", "attestations: write"):
            self.assertNotIn(forbidden, job)


@unittest.skipUnless(sys.platform.startswith("linux"), "The reporter's descriptor reader runs only on its Linux job")
class DescriptorReaderTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.directory = self.root / report.DIRECTORY
        self.directory.mkdir(mode=0o755)
        self.native = self.directory / "evidence.json"
        self.runner = self.directory / "runner-preparation.json"
        self.native.write_text(json.dumps(native_fixture([diagnostic_fixture()])), encoding="utf-8")
        self.runner.write_text(json.dumps(runner_fixture()), encoding="utf-8")
        self.native.chmod(0o644)
        self.runner.chmod(0o644)

    def observation(self):
        return {path.name: (report.metadata(path.stat()), hashlib.sha256(path.read_bytes()).hexdigest())
                for path in (self.native, self.runner)}

    def test_actual_normalized_files_are_read_without_changes(self):
        before = self.observation()
        documents, inputs = report.read_artifacts(str(self.directory))
        self.assertEqual(set(documents), {"native", "runner"})
        self.assertTrue(all(row["availability"] == "RECORDED" for row in inputs.values()))
        self.assertEqual(self.observation(), before)
        self.assertEqual(export(documents["native"], documents["runner"])["binding"], "SOURCE_RUN_ATTEMPT")

    def test_actual_symlink_hardlink_writable_and_unexpected_members_are_rejected(self):
        saved = self.root / "outside.json"
        self.native.replace(saved)
        self.native.symlink_to(saved)
        _, inputs = report.read_artifacts(str(self.directory))
        self.assertEqual(inputs["native"]["availability"], "UNAVAILABLE")
        self.native.unlink()
        os.link(saved, self.native)
        _, inputs = report.read_artifacts(str(self.directory))
        self.assertEqual(inputs["native"]["reasonCode"], "INPUT_LINK")
        self.native.unlink()
        saved.replace(self.native)
        self.native.chmod(0o666)
        _, inputs = report.read_artifacts(str(self.directory))
        self.assertEqual(inputs["native"]["reasonCode"], "INPUT_PERMISSIONS")
        self.native.chmod(0o644)
        (self.directory / "raw.log").write_text(SECRET, encoding="utf-8")
        documents, inputs = report.read_artifacts(str(self.directory))
        self.assertEqual(documents, {})
        self.assertTrue(all(row["reasonCode"] == "INPUT_LAYOUT" for row in inputs.values()))

    def test_symlink_directory_cannot_redirect_reader(self):
        alias = self.root / "alias"
        alias.symlink_to(self.directory, target_is_directory=True)
        documents, inputs = report.read_artifacts(str(alias))
        self.assertEqual(documents, {})
        self.assertTrue(all(row["availability"] == "UNAVAILABLE" for row in inputs.values()))

    def test_fd_metadata_race_is_detected_during_real_read(self):
        original_read = os.read
        target_inode = self.native.stat().st_ino
        changed = False

        def change_after_first_read(descriptor, length):
            nonlocal changed
            data = original_read(descriptor, length)
            if not changed and os.fstat(descriptor).st_ino == target_inode and data:
                with self.native.open("ab") as stream:
                    stream.write(b" ")
                changed = True
            return data

        with mock.patch.object(report.os, "read", side_effect=change_after_first_read):
            documents, inputs = report.read_artifacts(str(self.directory))
        self.assertTrue(changed)
        self.assertNotIn("native", documents)
        self.assertEqual(inputs["native"]["reasonCode"], "INPUT_CHANGED")

    def test_oversize_file_is_refused_before_content_read(self):
        with self.native.open("wb") as stream:
            stream.truncate(report.FILES["native"][1] + 1)
        directory = report.open_directory(str(self.directory))
        try:
            with mock.patch.object(report.os, "read", side_effect=AssertionError("oversize content was read")):
                with self.assertRaisesRegex(report.ReportError, "INPUT_SIZE"):
                    report.read_file(directory, "evidence.json", report.FILES["native"][1])
        finally:
            os.close(directory)

    def run_reporter(self):
        environment = {"CI": "true", "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "spikeal8-maker/asa-lab",
            "GITHUB_WORKFLOW": "ASA Real Host Acceptance", "GITHUB_JOB": "evidence_report",
            "SOURCE_REVISION": REVISION, "GITHUB_RUN_ID": str(RUN), "GITHUB_RUN_ATTEMPT": str(ATTEMPT),
            "NATIVE_RESULT": "failure", "RUNNER_TEMP": str(self.root)}
        completed = subprocess.run([sys.executable, "-I", "-B", str(MODULE)], env=environment, cwd="/",
                                   stdin=subprocess.DEVNULL, capture_output=True, timeout=15, check=False)
        self.assertEqual(completed.stderr, b"")
        lines = completed.stdout.decode("ascii").splitlines()
        self.assertEqual(lines[0], "ASA_REALHOST_REPORT_BEGIN")
        self.assertEqual(lines[-1], "ASA_REALHOST_REPORT_END")
        self.assertEqual(lines.count("ASA_REALHOST_REPORT_BEGIN"), 1)
        self.assertEqual(lines.count("ASA_REALHOST_REPORT_END"), 1)
        self.assertNotIn(SECRET, completed.stdout.decode("ascii"))
        return completed.returncode, json.loads("\n".join(lines[1:-1]))

    def test_actual_isolated_entry_prints_indented_frame_without_reclassifying_native_failure(self):
        before = self.observation()
        code, value = self.run_reporter()
        self.assertEqual(code, 0)
        self.assertEqual(value["nativeConclusion"], "failure")
        self.assertEqual(value["native"]["data"]["sourceStatus"], "FAIL")
        self.assertEqual(value["binding"], "SOURCE_RUN_ATTEMPT")
        self.assertEqual(self.observation(), before)

    def test_missing_and_fifo_inputs_produce_unavailable_without_hanging(self):
        self.native.unlink()
        code, value = self.run_reporter()
        self.assertEqual(code, 2)
        self.assertEqual(value["inputs"]["native"]["reasonCode"], "INPUT_MISSING")
        os.mkfifo(self.native, 0o600)
        code, value = self.run_reporter()
        self.assertEqual(code, 2)
        self.assertEqual(value["inputs"]["native"]["reasonCode"], "INPUT_TYPE")


if __name__ == "__main__":
    unittest.main()
