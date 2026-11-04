"""Harness safety gates and isolated manager faults; no VM or live cloud claim."""

import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import socket
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.request


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import ci_setup_realhost as harness
import test_backup_workflow as fixture
from deployment import backup_workflow as flow
from deployment.contracts import Blocked
from deployment.paths import atomic_json


class HarnessContractTests(unittest.TestCase):
    def host(self, **overrides):
        values = {"environment": {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted", "RUNNER_OS": "Linux",
                                  "GITHUB_REPOSITORY": "spikeal8-maker/asa-lab"},
                  "revision": "a" * 40, "actual_revision": "a" * 40, "free": 24 * harness.GIB,
                  "memory": 16 * harness.GIB, "cpus": 4, "os_release": {"ID": "ubuntu", "VERSION_ID": "24.04"}}
        values.update(overrides)
        with patch.object(harness.platform, "machine", return_value="x86_64"):
            return harness.host_environment(**values)

    def test_resource_gate_requires_real_space_memory_and_exact_head(self):
        self.host()
        for difference, code in (({"free": 24 * harness.GIB - 1}, "BLOCKED_HOST_FREE_DISK"),
                                 ({"memory": 12 * harness.GIB}, "BLOCKED_HOST_RAM_CPU"),
                                 ({"cpus": 3}, "BLOCKED_HOST_RAM_CPU"),
                                 ({"actual_revision": "b" * 40}, "SOURCE_REVISION")):
            with self.subTest(difference=difference), self.assertRaises(harness.Failure) as caught:
                self.host(**difference)
            self.assertEqual(caught.exception.code, code)

    def test_live_or_self_hosted_surface_cannot_start_harness(self):
        for environment in ({}, {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "self-hosted", "RUNNER_OS": "Linux",
                                  "GITHUB_REPOSITORY": "spikeal8-maker/asa-lab"}):
            with self.subTest(environment=environment), self.assertRaises(harness.Failure) as caught:
                self.host(environment=environment)
            self.assertEqual(caught.exception.code, "BLOCKED_DISPOSABLE_RUNNER_REQUIRED")

    def test_qmp_enabled_is_observed_not_inferred_from_device_presence(self):
        harness.verify_acceleration({"enabled": True, "present": True}, "kvm")
        harness.verify_acceleration({"enabled": False, "present": True}, "tcg")
        for observed in ({"enabled": False, "present": True}, {"enabled": "true"}, {}):
            with self.subTest(observed=observed), self.assertRaisesRegex(harness.Failure, "QMP_KVM_PROOF"):
                harness.verify_acceleration(observed, "kvm")

    def test_boot_id_must_change_for_reboot_evidence(self):
        before, after = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        harness.verify_boot_change(before, after)
        for value in (before, "service-restarted", ""):
            with self.subTest(value=value), self.assertRaisesRegex(harness.Failure, "GUEST_DID_NOT_REBOOT"):
                harness.verify_boot_change(before, value)

    def test_successful_manual_start_is_not_automatic_retry_after_error(self):
        failed = {"result": "exit-code", "execMainStatus": 2, "autoRestartPending": True, "nRestarts": 0}
        completed = {"result": "success", "execMainStatus": 0, "completed": True, "nRestarts": 1}
        self.assertTrue(harness.automatic_retry_proved(failed, completed))
        self.assertFalse(harness.automatic_retry_proved({**failed, "result": "success"}, completed))
        self.assertFalse(harness.automatic_retry_proved(failed, {**completed, "nRestarts": 0}))
        self.assertFalse(harness.automatic_retry_proved(failed, {**completed, "completed": False}))
        self.assertFalse(harness.automatic_retry_proved(failed, {**completed, "execMainStatus": 2}))

    def test_disk_reserve_stops_only_owned_vm_before_remaining_three_gib(self):
        runner = object.__new__(harness.HostRun)
        runner.deadline = time.monotonic() + 60
        runner.bootstrap_deadline = None
        runner.workspace = HERE
        runner.evidence = {"resources": {"minimumObservedFreeBytes": 30 * harness.GIB}}
        runner.vm = Mock()
        runner.vm.process.poll.return_value = None
        with patch.object(harness.shutil, "disk_usage", return_value=SimpleNamespace(free=harness.RESERVE - 1)), \
                self.assertRaisesRegex(harness.Failure, "BLOCKED_HOST_DISK_RESERVE"):
            runner.guard()
        runner.vm.query.assert_called_once_with("stop")

    def test_tcg_bootstrap_has_a_hard_twenty_minute_budget(self):
        self.assertEqual(harness.BOOTSTRAP_TCG_SECONDS, 1200)
        runner = object.__new__(harness.HostRun)
        runner.deadline = time.monotonic() + 60
        runner.bootstrap_deadline = time.monotonic() - 1
        runner.workspace = None
        with self.assertRaisesRegex(harness.Failure, "BLOCKED_TCG_BUDGET"):
            runner.guard()

    def test_corrupt_download_is_never_promoted(self):
        class Response(io.BytesIO):
            status = 200

            def geturl(self):
                return "https://cloud-images.ubuntu.com/test.img"

        runner = object.__new__(harness.HostRun)
        runner.guard = Mock()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "ubuntu.img"
            with patch.object(harness.urllib.request, "urlopen", return_value=Response(b"wrong bytes")), \
                    self.assertRaisesRegex(harness.Failure, "DOWNLOAD_SHA256"):
                runner.download("https://cloud-images.ubuntu.com/test.img", target, expected=hashlib.sha256(b"approved bytes").hexdigest())
            self.assertFalse(target.exists())
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_equal_runtime_pins_cannot_be_presented_as_update(self):
        original = json.loads((HERE / "fixtures/setup-realhost-pins.json").read_text())
        original["previous"] = dict(original["current"])
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "pins.json"
            target.write_text(json.dumps(original))
            with self.assertRaisesRegex(harness.Failure, "PINS_NO_UPDATE"):
                harness.pin_manifest(target)

    def test_phase_exception_cannot_become_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = object.__new__(harness.HostRun)
            runner.output = Path(directory) / "evidence.json"
            runner.evidence = harness.initial_evidence("a" * 40)
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(harness.Failure):
                runner.phase("actual_guest", Mock(side_effect=harness.Failure("GUEST_FAILED")))
            observed = json.loads(runner.output.read_text())
            self.assertEqual(observed["phases"][0]["status"], "FAIL")
            self.assertNotEqual(observed["status"], "PASS")

    def test_guest_exception_never_prints_raw_secret_or_false_pass(self):
        output = io.StringIO()
        with patch.object(harness, "guest_guard", return_value={}), \
                patch.object(harness, "guest_phase", side_effect=RuntimeError("private-password-not-for-output")), \
                contextlib.redirect_stdout(output):
            code = harness.guest_main("bootstrap")
        result = json.loads(output.getvalue())
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["reasonCode"], "HARNESS_EXCEPTION")
        self.assertNotIn("private-password", output.getvalue())

    def test_returned_failure_or_block_is_never_promoted_to_pass(self):
        for status, expected_code in (("FAIL", 1), ("BLOCKED", 2)):
            output = io.StringIO()
            with self.subTest(status=status), patch.object(harness, "guest_guard", return_value={}), \
                    patch.object(harness, "guest_phase", return_value={"status": status, "reasonCode": "INCOMPLETE"}), \
                    contextlib.redirect_stdout(output):
                code = harness.guest_main("bootstrap")
            self.assertEqual(code, expected_code)
            self.assertEqual(json.loads(output.getvalue())["status"], status)

    def test_receipt_projection_excludes_private_payload(self):
        value = {"operationId": "a" * 32, "installationId": "b" * 32, "outcome": "WARNING", "mode": "install",
                 "password": "must-not-appear", "rawLog": "must-not-appear", "environment": {"GH_TOKEN": "must-not-appear"},
                 "site": {"technical": {"status": "passed"}, "browser": {"status": "passed"}}}
        projected = harness.receipt_projection(value)
        self.assertNotIn("must-not-appear", json.dumps(projected))
        self.assertTrue(projected["technicalStatus"])
        self.assertTrue(projected["browserStatus"])
        self.assertFalse(projected["dataProtectionConfirmed"])


class PostFailureDiagnosticTests(unittest.TestCase):
    def test_projection_drops_nested_and_uppercase_secrets(self):
        secret = "PRIVATE_CREDENTIAL_MUST_NEVER_APPEAR"
        value = {"status": "OBSERVED", "observedAt": "2026-11-04T10:00:00+00:00", "raw": secret,
            "intentCheck": {"exitCode": 2, "reasonCode": secret, "errorClass": secret, "stderr": secret,
                            "actualUid": 0, "state": secret},
            "ownerObservation": {"actualUid": 999, "exitCode": 0, "environment": {"GH_TOKEN": secret}},
            "paths": {"setup": {"mode": "0644", "readable": True, "content": secret}, secret: {"mode": "0600"}},
            "docker": {"compose": {"exitCode": 1, "stdout": secret, "args": [secret]}, secret: {"exitCode": 0}},
            "inventory": {"complete": False, "state": "UNKNOWN", "reasonCodes": ["DOCKER_UNKNOWN", secret],
                          "containers": [{"environment": secret}]}}
        result = harness.post_failure_projection(value)
        self.assertNotIn(secret, json.dumps(result))
        self.assertEqual(result["intentCheck"]["reasonCode"], "UNRECOGNIZED_REASON")
        self.assertNotIn("actualUid", result["intentCheck"])
        self.assertEqual(result["ownerObservation"]["actualUid"], 999)
        self.assertEqual(result["inventory"]["reasonCodes"][0], "DOCKER_UNKNOWN")
        self.assertEqual(result["observation"], "AFTER_PUBLIC_FAILURE")

    def test_child_json_emits_only_typed_reason_and_exception_class(self):
        secret = "private-token-and-password"
        raw = json.dumps({"reasonCode": "PermissionError", "outcome": "ERROR", "message": secret,
                          "traceback": [secret], "environment": {"GH_TOKEN": secret}}).encode()
        result = harness.diagnostic_json(raw, {"exitCode": 1, "actualUid": 999})
        self.assertEqual(result["errorClass"], "PermissionError")
        self.assertEqual(result["exitCode"], 1)
        self.assertNotIn(secret, json.dumps(result))
        malformed = harness.diagnostic_json(json.dumps({"reasonCode": [secret]}).encode(), {"exitCode": 1})
        self.assertNotIn(secret, json.dumps(malformed))
        self.assertEqual(harness.diagnostic_json(b"not-json secret", {"exitCode": 1})["reasonCode"], "DIAGNOSTIC_JSON")
        limited = harness.diagnostic_json(b'{"status":"OK","reasonCode":"OPERATION_INTENT"}',
                                          {"reasonCode": "DIAGNOSTIC_OUTPUT_LIMIT", "exitCode": -15})
        self.assertEqual((limited["status"], limited["reasonCode"]), ("UNAVAILABLE", "DIAGNOSTIC_OUTPUT_LIMIT"))

    @unittest.skipUnless(sys.platform == "linux", "Native disposable-VM probe requires Linux process groups and pipe selectors")
    def test_real_probe_streams_and_time_are_bounded(self):
        environment = {"PATH": "/usr/bin:/bin"}
        result, raw = harness.diagnostic_command([sys.executable, "-I", "-c",
            "import sys; sys.stderr.write('private-data-' * 20000); sys.stderr.flush()"], timeout=3, environment=environment)
        self.assertEqual(result["reasonCode"], "DIAGNOSTIC_OUTPUT_LIMIT")
        self.assertLessEqual(len(raw), harness.DIAGNOSTIC_LIMIT)
        self.assertNotIn("private-data", json.dumps(harness.diagnostic_command_projection(result)))
        started = time.monotonic()
        result, _ = harness.diagnostic_command([sys.executable, "-I", "-c", "import time; time.sleep(10)"],
                                                timeout=0.15, environment=environment)
        self.assertEqual(result["reasonCode"], "DIAGNOSTIC_TIMEOUT")
        self.assertLess(time.monotonic() - started, 5)

    @unittest.skipUnless(sys.platform == "linux", "Native disposable-VM probe requires Linux cwd, process groups and pipe selectors")
    def test_probe_uses_slash_cwd_and_only_known_traceback_class(self):
        result, raw = harness.diagnostic_command([sys.executable, "-I", "-c",
            "import os; print(os.getcwd(), flush=True); raise PermissionError('private-password')"],
            timeout=3, environment={"PATH": "/usr/bin:/bin"})
        self.assertEqual(raw.strip(), b"/")
        self.assertEqual(result["exitCode"], 1)
        self.assertEqual(result["errorClass"], "PermissionError")
        self.assertNotIn("private-password", json.dumps(result))

    def test_diagnostic_observation_cannot_be_root(self):
        with patch.object(harness.os, "geteuid", return_value=0, create=True), self.assertRaisesRegex(harness.Failure, "DIAGNOSTIC_UID"):
            harness.owner_diagnostic({})

    def test_successful_or_failed_probe_preserves_original_public_failure(self):
        original = {"command": "asa install", "exitCode": 2, "status": "BLOCKED", "reasonCodes": ["OPERATION_INTENT"]}
        for diagnostic in ({"status": "OBSERVED", "intentCheck": {"exitCode": 0, "status": "OK", "state": "FRESH"}},
                           RuntimeError("private-password")):
            output = io.StringIO()
            with self.subTest(diagnostic=type(diagnostic).__name__), tempfile.TemporaryDirectory() as directory, \
                    patch.object(harness, "INSTALL_ROOT", Path(directory) / "absent"), \
                    patch.object(harness, "CLI_ACTIONS", [original]), \
                    patch.object(harness, "guest_guard", return_value={}), \
                    patch.object(harness, "public_cli", return_value={"reasonCode": "OPERATION_INTENT"}), \
                    patch.object(harness, "post_failure_diagnostic", **({"side_effect": diagnostic} if isinstance(diagnostic, Exception)
                                                                        else {"return_value": diagnostic})), \
                    patch.object(harness, "guest_phase", side_effect=lambda *_: harness.first_install_attempt({}, [])), \
                    contextlib.redirect_stdout(output):
                code = harness.guest_main("install")
            result = json.loads(output.getvalue())
            self.assertEqual((code, result["status"], result["reasonCode"]), (1, "FAIL", "FRESH_ONBOARDING_BOUNDARY"))
            self.assertEqual(result["cliActions"], [original])
            self.assertEqual(result["postFailureDiagnostic"]["observation"], "AFTER_PUBLIC_FAILURE")
            self.assertNotIn("private-password", output.getvalue())

    def test_expected_owner_input_boundary_does_not_run_probe_or_create_target(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "absent"
            with patch.object(harness, "INSTALL_ROOT", target), \
                    patch.object(harness, "public_cli", return_value={"reasonCode": "OWNER_INPUT_REQUIRED"}), \
                    patch.object(harness, "post_failure_diagnostic") as probe:
                harness.first_install_attempt({}, [])
            probe.assert_not_called()
            self.assertFalse(target.exists())


class CommandFailureDiagnosticTests(unittest.TestCase):
    def records(self):
        ids = {"operationId": "a" * 32, "installationId": "b" * 32}
        receipt = {"format": "asa-setup-result-v1", **ids, "mode": "install", "stage": "release", "outcome": "BLOCKED",
                   "exitCode": 2, "reasonCode": "COMMAND", "applicationAccepted": False, "executionCompleted": False,
                   "actionExecuted": False, "dataProtectionConfirmed": False, "site": {"technical": {"status": "not_run"}}}
        journal = {"format": "asa-setup-operation-v1", **ids, "root": str(harness.INSTALL_ROOT), "mode": "install",
                   "state": "TERMINAL", "phase": "release", "stages": {"preflight": {"status": "done"}, "release": {"status": "intent"}},
                   "result": json.loads(json.dumps(receipt))}
        config = {"format": "asa-setup-config-v1", "installationId": ids["installationId"], "root": str(harness.INSTALL_ROOT), "operatorUid": 999}
        public = {"format": "asa-cli-result-v1", "exitCode": 2, "managerExitCode": 2, "status": "BLOCKED", "reasonCode": "COMMAND",
                  "reasonCodes": ["COMMAND"], "operation": {**ids, "outcome": "BLOCKED", "reasonCode": "COMMAND"}}
        pins = json.loads((HERE / "fixtures/setup-realhost-pins.json").read_text())
        return public, config, journal, receipt, pins

    def project(self, values):
        return harness.command_operation_projection(*values, mode="install", code=2, uid=999)

    def test_nested_public_ids_bind_current_stage_and_acceptance_without_guessing_release(self):
        projected = self.project(self.records())
        self.assertEqual(projected["binding"], "VERIFIED")
        self.assertEqual(projected["operationId"], "a" * 32)
        self.assertEqual((projected["receiptStage"], projected["journalPhase"]), ("release", "release"))
        self.assertEqual(projected["stages"], {"preflight": "done", "release": "intent"})
        self.assertEqual(projected["selectedRelease"], {"status": "NOT_CONFIRMED"})
        self.assertFalse(projected["acceptance"]["applicationAccepted"])
        self.assertFalse(projected["acceptance"]["firstBackupCompleted"])

    def test_mismatched_identity_mode_root_and_stale_receipt_are_not_bound(self):
        for index, key, value in ((0, "operation", {"operationId": "c" * 32, "installationId": "b" * 32}),
                                  (1, "installationId", "c" * 32), (1, "operatorUid", 0),
                                  (1, "root", "/somewhere-else"), (2, "root", "/somewhere-else"),
                                  (2, "mode", "update"), (3, "operationId", "c" * 32), (3, "exitCode", 0),
                                  (2, "result", {"format": "asa-setup-result-v1", "secret": "PRIVATE"})):
            values = self.records()
            values[index][key] = value
            with self.subTest(index=index, key=key), self.assertRaisesRegex(harness.Failure, "DIAGNOSTIC_BINDING"):
                self.project(values)

    def test_closed_projection_excludes_unknown_uppercase_and_nested_secrets(self):
        secret = "PRIVATE_CREDENTIAL_MUST_NEVER_APPEAR"
        values = self.records()
        public, config, journal, receipt, pins = values
        public["operation"]["reasonCode"] = receipt["reasonCode"] = secret
        receipt.update(stage=secret, executionCompleted=secret, raw=secret, diagnostics={"token": secret})
        receipt["site"].update(browser={"status": secret, "password": secret}, owner={"status": [secret]})
        config.update(password=secret, cloud={"token": secret})
        journal.update(phase=secret, bootstrapConfig=config, events=[{"raw": secret}], result=json.loads(json.dumps(receipt)))
        journal["stages"].update({secret: {"status": "done"}, "images": {"status": secret, "raw": secret}})
        projected = self.project(values)
        self.assertNotIn(secret, json.dumps(projected))
        self.assertEqual(projected["reasonCode"], "UNRECOGNIZED_REASON")
        self.assertEqual(projected["journalPhase"], "UNRECOGNIZED_STAGE")
        self.assertEqual(projected["stages"]["images"], "UNRECOGNIZED_STATUS")
        self.assertEqual(projected["unrecognizedStageCount"], 1)
        self.assertNotIn("executionCompleted", projected["acceptance"])

    def test_selected_pin_requires_completed_release_and_matching_revision_schema_digest(self):
        values = self.records()
        journal, pin = values[2], values[4]["previous"]
        journal["release"] = {"revision": pin["revision"], "schema": pin["schema"], "private": "SECRET"}
        journal["requestedDeploymentDigest"] = pin["deploymentDigest"]
        self.assertEqual(self.project(values)["selectedRelease"]["status"], "NOT_CONFIRMED")
        journal["stages"]["release"] = {"status": "done", "revision": pin["revision"]}
        projected = self.project(values)["selectedRelease"]
        self.assertEqual(projected, {"status": "CONFIRMED", "pin": "previous", "revision": pin["revision"],
                                     "schema": pin["schema"], "deploymentDigest": pin["deploymentDigest"]})
        journal["requestedDeploymentDigest"] = "sha256:" + "a" * 64
        self.assertNotIn("deploymentDigest", self.project(values)["selectedRelease"])
        journal["release"]["schema"] += 1
        self.assertEqual(self.project(values)["selectedRelease"]["status"], "NOT_CONFIRMED")

    def test_log_classifier_outputs_only_fixed_rules_and_observed_numeric_codes(self):
        secret = "PRIVATE_CREDENTIAL_MUST_NEVER_APPEAR"
        raw = ('Error response from daemon: Head "https://ghcr.io/v2/repository/manifests/tag": unauthorized\n'
               'Error response from daemon: Get "https://ghcr.io/v2/": dial tcp: lookup ghcr.io: no such host\n'
               'Error response from daemon: Get "https://ghcr.io/v2/": tls: failed to verify certificate: x509: certificate expired\n'
               'Error response from daemon: unexpected status from HEAD request to "https://ghcr.io/v2/": 405 Method Not Allowed\n'
               'docker pull failed (exit 1).\n' + secret + '\n').encode()
        projected = harness.command_log_classification(raw, "release")
        self.assertEqual(set(projected["ruleIds"]), {"REGISTRY_ACCESS_DENIED", "REGISTRY_DNS_FAILURE", "REGISTRY_TLS_FAILURE",
                                                    "REGISTRY_HTTP_FAILURE", "DOCKER_PULL_EXIT"})
        self.assertEqual(projected["exitCodes"], [1])
        self.assertEqual(projected["httpStatusCodes"], [405])  # Unauthorized text is not an observed HTTP 401.
        self.assertNotIn(secret, json.dumps(projected))
        self.assertEqual(harness.command_log_classification(raw, "source")["ruleIds"], [])
        self.assertEqual(harness.command_log_classification(b"git fetch failed (exit 128).\n", "source")["exitCodes"], [128])

    def test_unknown_log_lines_json_headers_and_secret_bodies_are_not_classified(self):
        raw = b'Authorization: Bearer PRIVATE\n{"error":"docker pull failed (exit 1)."}\nPRIVATE HTTP 401 unauthorized\n'
        raw += b'Error response from daemon: PRIVATE BODY HTTP 403\n' + b'X' * 9000 + b'\n'
        projected = harness.command_log_classification(raw, "release")
        self.assertEqual(projected, {"status": "NO_MATCH", "ruleIds": [], "exitCodes": [], "httpStatusCodes": []})

    def test_cli_log_filename_binds_action_pid_and_invocation_time(self):
        timestamp = harness.dt.datetime(2026, 11, 4, 12, 0, tzinfo=harness.dt.timezone.utc)
        start = int(timestamp.timestamp()) * 10**9
        invocation = {"pid": 1234, "startedNs": start, "finishedNs": start + 3 * 10**9}
        name = "install-20261104T120000Z-1234.log"
        public = {"logPath": str(harness.OPERATOR_LOG_ROOT / name)}
        self.assertEqual(harness.cli_log_path(public, ["install"], invocation).name, name)
        for value in ("install-20261104T120000Z-1235.log", "backup-create-20261104T120000Z-1234.log",
                      "install-20261104T115959Z-1234.log", "install-20261104T120004Z-1234.log"):
            with self.subTest(value=value), self.assertRaises(harness.Failure):
                harness.cli_log_path({"logPath": str(harness.OPERATOR_LOG_ROOT / value)}, ["install"], invocation)
        with self.assertRaises(harness.Failure):
            harness.cli_log_path({"logPath": str(harness.OPERATOR_LOG_ROOT.parent / name)}, ["install"], invocation)

    def test_diagnostic_failure_or_success_never_changes_original_public_failure(self):
        public, *_ = self.records()
        for diagnostic in (self.project(self.records()), RuntimeError("PRIVATE_CREDENTIAL")):
            output = io.StringIO()
            with self.subTest(diagnostic=type(diagnostic).__name__), patch.object(harness, "CLI_ACTIONS", []), \
                    patch.object(harness, "guest_guard", return_value={}), \
                    patch.object(harness, "command_failure_diagnostic", **({"side_effect": diagnostic} if isinstance(diagnostic, Exception)
                                                                            else {"return_value": diagnostic})), \
                    patch.object(harness, "guest_phase", side_effect=lambda *_: harness.public_cli_result(["install"], 2, json.dumps(public))), \
                    contextlib.redirect_stdout(output):
                code = harness.guest_main("install")
            observed = json.loads(output.getvalue())
            self.assertEqual((code, observed["status"], observed["reasonCode"]), (1, "FAIL", "COMMAND"))
            self.assertEqual(observed["cliActions"][0]["exitCode"], 2)
            self.assertIn("commandFailureDiagnostic", observed)
            self.assertNotIn("PRIVATE_CREDENTIAL", output.getvalue())

    def test_unknown_public_reason_cannot_leak_and_expected_exit_does_not_probe(self):
        public, *_ = self.records()
        secret = "PRIVATE_CREDENTIAL_MUST_NEVER_APPEAR"
        public.update(reasonCode=secret, reasonCodes=[secret], status={"raw": secret})
        with patch.object(harness, "CLI_ACTIONS", []), patch.object(harness, "command_failure_diagnostic") as probe:
            harness.public_cli_result(["install"], 2, json.dumps(public), allowed=(2,))
            probe.assert_not_called()
            self.assertNotIn(secret, json.dumps(harness.CLI_ACTIONS))
            self.assertEqual(harness.CLI_ACTIONS[0]["status"], "UNVERIFIED")

    def test_bound_current_receipt_survives_unavailable_private_log_without_raw_output(self):
        public, config, journal, receipt, pins = self.records()
        invocation = {"startedNs": 1_700_000_000 * 10**9, "finishedNs": 1_700_000_005 * 10**9,
                      "setupLogsBefore": {"status": "OBSERVED", "entries": {}}}
        private = {"setup.json": config, "a" * 32 + ".json": journal, "setup-last-attempt.json": receipt}
        def read(path, *_args, **_kwargs):
            self.assertTrue(path.is_relative_to(harness.INSTALL_ROOT))
            if path.name not in private:
                raise PermissionError("PRIVATE_PASSWORD")
            return json.dumps(private[path.name]).encode(), SimpleNamespace(st_mtime_ns=invocation["finishedNs"] - 10**9), False
        with patch.object(harness, "guest_guard", return_value={"pins": pins}), \
                patch.object(harness, "diagnostic_owner", return_value=({"uid": 999}, {})), \
                patch.object(harness, "diagnostic_read", side_effect=read):
            observed = harness.command_failure_diagnostic(["install"], 2, public, invocation)
        self.assertEqual(observed["binding"], "VERIFIED")
        self.assertEqual(observed["journalPhase"], "release")
        self.assertEqual(observed["logs"]["cli"]["status"], "UNAVAILABLE")
        self.assertEqual(observed["logs"]["setup"]["status"], "UNAVAILABLE")
        self.assertNotIn("PRIVATE_PASSWORD", json.dumps(observed))

    def test_old_last_attempt_is_rejected_before_reading_or_classifying_logs(self):
        public, config, journal, receipt, pins = self.records()
        private = {"setup.json": config, "a" * 32 + ".json": journal, "setup-last-attempt.json": receipt}
        def read(path, *_args, **_kwargs):
            return json.dumps(private[path.name]).encode(), SimpleNamespace(st_mtime_ns=10**9), False
        with patch.object(harness, "guest_guard", return_value={"pins": pins}), \
                patch.object(harness, "diagnostic_owner", return_value=({"uid": 999}, {})), \
                patch.object(harness, "diagnostic_read", side_effect=read), patch.object(harness, "command_log_classification") as classifier, \
                self.assertRaisesRegex(harness.Failure, "DIAGNOSTIC_INVOCATION"):
            harness.command_failure_diagnostic(["install"], 2, public, {"startedNs": 10 * 10**9, "finishedNs": 20 * 10**9})
        classifier.assert_not_called()

    @unittest.skipUnless(sys.platform == "linux", "Private guest file proof uses Linux openat, O_NOFOLLOW and inode ownership")
    def test_native_private_reads_reject_links_permissions_owner_and_oversize(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            target = base / "journal.json"
            target.write_bytes(b'{"token":"PRIVATE"}')
            target.chmod(0o600)
            self.assertEqual(harness.diagnostic_read(target, base, os.geteuid())[0], target.read_bytes())
            for change in ("symlink", "hardlink", "permissions", "owner", "size", "fifo"):
                with self.subTest(change=change):
                    candidate = target
                    uid, maximum = os.geteuid(), 1024
                    if change == "symlink":
                        candidate = base / "link.json"
                        candidate.symlink_to(target)
                    elif change == "hardlink":
                        os.link(target, base / "hard.json")
                    elif change == "permissions":
                        target.chmod(0o644)
                    elif change == "owner":
                        uid += 1
                    elif change == "size":
                        maximum = 2
                    else:
                        candidate = base / "fifo"
                        os.mkfifo(candidate, 0o600)
                    with self.assertRaises((OSError, harness.Failure)):
                        harness.diagnostic_read(candidate, base, uid, maximum=maximum)
                    target.chmod(0o600)
                    if (base / "hard.json").exists():
                        (base / "hard.json").unlink()

    @unittest.skipUnless(sys.platform == "linux", "Operation-log append proof uses Linux openat, pread and inode ownership")
    def test_native_log_projection_ignores_old_bytes_and_rejects_replaced_inode(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            target = base / "operation.log"
            target.write_bytes(b"Error response from daemon: unauthorized: OLD_PRIVATE\n")
            target.chmod(0o600)
            before = harness.diagnostic_metadata(target.stat())
            with target.open("ab") as output:
                output.write(b"docker pull failed (exit 1).\n")
            observed = harness.command_log_projection(target, base, os.geteuid(), phase="release", offset=before[2], identity=before)
            self.assertEqual(observed["ruleIds"], ["DOCKER_PULL_EXIT"])
            target.rename(base / "previous.log")
            target.write_bytes(b"Error response from daemon: unauthorized: NEW_PRIVATE\n" * 2)
            target.chmod(0o600)
            with self.assertRaisesRegex(harness.Failure, "DIAGNOSTIC_CHANGED"):
                harness.command_log_projection(target, base, os.geteuid(), phase="release", offset=before[2], identity=before)


class RuntimeFaultContractTests(unittest.TestCase):
    def owner_result(self, code, result):
        account = SimpleNamespace(pw_name="asa-setup", pw_dir="/var/lib/asa-setup/operator")
        with patch.dict(sys.modules, {"pwd": SimpleNamespace(getpwnam=Mock(return_value=account))}), \
                patch.object(harness.Commands, "run", return_value=(code, json.dumps(result).encode())):
            return harness.owner_call("owner-fault-prepare", timeout=360)

    def test_recognized_owner_blocker_preserves_blocked_through_guest_result(self):
        child = {"format": "asa-realhost-guest-v1", "phase": "owner-fault-prepare", "status": "BLOCKED"}
        for reason in ("BLOCKED_FAULT_GUEST_DISK", "COMMAND_TIMEOUT"):
            output = io.StringIO()
            with self.subTest(reason=reason), patch.object(harness, "guest_guard", return_value={}), \
                    patch.object(harness, "guest_phase", side_effect=lambda *_: self.owner_result(2, {**child, "reasonCode": reason})), \
                    patch.object(harness, "CLI_ACTIONS", []), contextlib.redirect_stdout(output):
                code = harness.guest_main("partial-fault")
            observed = json.loads(output.getvalue())
            self.assertEqual((code, observed["status"], observed["reasonCode"]), (2, "BLOCKED", reason))

    def test_owner_fail_unknown_and_inconsistent_results_remain_fail(self):
        child = {"format": "asa-realhost-guest-v1", "phase": "owner-fault-prepare", "status": "FAIL", "reasonCode": "FAULT_OBJECT_READBACK_SHA256"}
        cases = ((1, child),
                 (1, {**child, "status": "BLOCKED", "reasonCode": "BLOCKED_FAULT_GUEST_DISK"}),
                 (0, {**child, "status": "BLOCKED", "reasonCode": "BLOCKED_FAULT_GUEST_DISK"}),
                 (2, child), (2, {**child, "status": "PASS"}),
                 (2, {**child, "status": "UNKNOWN"}), (2, {**child, "status": {"private": "data"}}),
                 (2, {**child, "status": "BLOCKED", "reasonCode": "UNRECOGNIZED_BLOCKER"}),
                 (2, {**child, "status": "BLOCKED", "reasonCode": None}),
                 (2, {**child, "status": "BLOCKED", "reasonCode": ["BLOCKED_FAULT_GUEST_DISK"]}))
        for code, result in cases:
            with self.subTest(code=code, status=result["status"]), self.assertRaises(harness.Failure) as caught:
                self.owner_result(code, result)
            self.assertEqual(caught.exception.status, "FAIL")
        with self.assertRaises(harness.Failure) as caught:
            self.owner_result(1, child)
        self.assertEqual(caught.exception.code, "FAULT_OBJECT_READBACK_SHA256")

    def test_owner_envelope_and_phase_must_match_even_when_exit_is_zero(self):
        child = {"format": "asa-realhost-guest-v1", "phase": "owner-fault-prepare", "status": "PASS", "fixtureUploaderExitedBeforeBackup": True}
        self.assertEqual(self.owner_result(0, child), child)
        for result in ([], None, {}, {**child, "format": "unknown"}, {**child, "phase": "owner-fault-remove"}):
            for code in (0, 2):
                with self.subTest(code=code, result=result), self.assertRaises(harness.Failure) as caught:
                    self.owner_result(code, result)
                self.assertEqual((caught.exception.code, caught.exception.status), ("OWNER_REPORT_INVALID", "FAIL"))

    def test_file_limit_requires_actual_large_part_and_small_database_files(self):
        harness.fault_size_gate(1000, 2000, harness.FAULT_FILE_LIMIT + 1)
        for values, code in (((1000, 2000, harness.FAULT_FILE_LIMIT), "BLOCKED_FAULT_OBJECT_PART_TOO_SMALL"),
                             ((harness.FAULT_FILE_LIMIT, 2000, harness.FAULT_OBJECT_BYTES), "BLOCKED_FAULT_DATABASE_TOO_LARGE"),
                             ((1000, 0, harness.FAULT_OBJECT_BYTES), "BLOCKED_FAULT_DATABASE_TOO_LARGE")):
            with self.subTest(values=values), self.assertRaises(harness.Failure) as caught:
                harness.fault_size_gate(*values)
            self.assertEqual((caught.exception.code, caught.exception.status), (code, "BLOCKED"))

    def test_completed_or_not_started_export_is_never_an_injection_window(self):
        proof = {"databaseBytes": 1000, "globalsBytes": 2000, "objectsDirectory": True,
                 "manifestPresent": False, "finalPresent": False, "ciphertextPresent": False}
        self.assertTrue(harness.export_window(proof, harness.FAULT_OBJECT_BYTES))
        for changed in ({"databaseBytes": 0}, {"globalsBytes": 0}, {"objectsDirectory": False},
                        {"manifestPresent": True}, {"finalPresent": True}, {"ciphertextPresent": True},
                        {"syntheticPartBytes": harness.FAULT_OBJECT_BYTES}):
            self.assertFalse(harness.export_window({**proof, **changed}, harness.FAULT_OBJECT_BYTES))

    def test_fault_receipt_projection_preserves_uncertainty_and_drops_secrets(self):
        secret = "PRIVATE_CREDENTIAL_MUST_NEVER_APPEAR"
        receipt = {"outcome": "PENDING", "local": {"status": "PENDING", "executionStatus": "RUNNING", "error": secret},
                   "environment": secret, "cloud": {"token": secret}}
        result = harness.fault_receipt_projection(receipt, {"state": "RECOVERY_REQUIRED", "rawLog": secret})
        self.assertEqual(result["journalState"], "RECOVERY_REQUIRED")
        self.assertEqual(result["localExecutionStatus"], "RUNNING")
        self.assertNotIn(secret, json.dumps(result))
        malformed = harness.fault_receipt_projection({"outcome": [secret], "local": secret}, {"state": {"token": secret}})
        self.assertNotIn(secret, json.dumps(malformed))
        self.assertEqual(malformed["outcome"], "UNVERIFIED")

    def test_same_id_recovery_must_block_and_never_accept_a_new_export(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(harness, "INSTALL_ROOT", Path(directory)), \
                patch.object(harness, "completed_fault_command", return_value=({"status": "OK"}, {})), \
                patch.object(harness, "fault_receipt", return_value={"outcome": "BLOCKED", "localReasonCode": "BACKUP_RESUME_SNAPSHOT_MISSING"}), \
                patch.object(harness, "owner_call") as observer, self.assertRaisesRegex(harness.Failure, "FAULT_RECOVERY_CONTRACT"):
            harness.recover_partial({}, "a" * 32, {}, time.monotonic() + 60)
        observer.assert_not_called()

    def test_recovery_budget_exhaustion_is_blocked_acceptance(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(harness, "INSTALL_ROOT", Path(directory)), \
                patch.object(harness, "completed_fault_command", side_effect=harness.Failure("BLOCKED_FAULT_QUIESCENCE_BUDGET", status="BLOCKED")), \
                self.assertRaises(harness.Failure) as caught:
            harness.recover_partial({}, "a" * 32, {}, time.monotonic() + 60)
        self.assertEqual((caught.exception.code, caught.exception.status), ("BLOCKED_FAULT_RECOVERY_BUDGET", "BLOCKED"))
        self.assertGreaterEqual(harness.FAULT_RECOVERY_SECONDS, 90 + 300 + 90)

    def test_total_fault_budget_cannot_extend_the_existing_job(self):
        runner = object.__new__(harness.HostRun)
        runner.fault_deadline = time.monotonic() - 1
        runner.deadline = time.monotonic() + 1000
        with self.assertRaises(harness.Failure) as caught:
            runner.guard()
        self.assertEqual((caught.exception.code, caught.exception.status), ("BLOCKED_FAULT_TOTAL_BUDGET", "BLOCKED"))
        self.assertLess(harness.FAULT_TOTAL_SECONDS, harness.TOTAL_SECONDS)

    def test_process_identity_requires_starttime_pgid_and_sid(self):
        original = {"pid": 42, "startTime": 100, "pgid": 42, "sid": 42}
        self.assertTrue(harness.same_process(original, dict(original)))
        for key in original:
            self.assertFalse(harness.same_process(original, {**original, key: original[key] + 1}))

    def test_mismatched_proc_namespace_blocks_before_starting_a_child(self):
        with patch.object(harness, "native_proc_namespace", return_value=False), \
                patch.object(harness.subprocess, "Popen") as start, patch.object(harness.tempfile, "TemporaryFile") as temporary, \
                self.assertRaises(harness.Failure) as caught:
            harness.OwnedFaultProcess([sys.executable], environment={})
        self.assertEqual((caught.exception.code, caught.exception.status), ("BLOCKED_FAULT_PROC_NAMESPACE", "BLOCKED"))
        start.assert_not_called()
        temporary.assert_not_called()

    def test_namespace_evidence_requires_distinct_observed_inode(self):
        with patch.object(harness, "root_json", return_value={"namespaceInode": 123}), \
                patch.object(harness, "network_namespace_inode", return_value=123), \
                patch.object(harness, "public_cli") as command, self.assertRaisesRegex(harness.Failure, "FAULT_NETWORK_NAMESPACE"):
            harness.network_fault_child({})
        command.assert_not_called()


@unittest.skipUnless(sys.platform == "linux", "Owned runtime fault primitives require Linux /proc, inotify and POSIX signals")
class LinuxRuntimeFaultTests(unittest.TestCase):
    def test_size_limit_is_child_only_and_leaves_actual_partial_bytes(self):
        import resource
        before = resource.getrlimit(resource.RLIMIT_FSIZE)
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "synthetic-part.bin"
            script = ("import os,signal,sys; signal.signal(signal.SIGXFSZ, signal.SIG_IGN); "
                      "f=open(sys.argv[1],'wb',buffering=0)\n"
                      "try:\n while True: f.write(b'x' * 1048576)\n"
                      "except OSError as e: print(e.errno,flush=True); sys.exit(2)\n")
            with harness.subprocess.Popen([sys.executable, "-I", "-c", script, str(target)],
                    env={"PATH": "/usr/bin:/bin"}, stdout=harness.subprocess.PIPE,
                    stderr=harness.subprocess.PIPE, preexec_fn=harness.file_fault_limits) as child:
                raw, _ = child.communicate(timeout=5)
                self.assertEqual(child.returncode, 2)
                self.assertEqual(raw.strip(), b"27")
                self.assertEqual(target.stat().st_size, harness.FAULT_FILE_LIMIT)
        self.assertEqual(resource.getrlimit(resource.RLIMIT_FSIZE), before)

    def test_outer_exit_does_not_hide_a_live_descendant_or_allow_stale_signal(self):
        if not harness.native_proc_namespace():
            self.skipTest("Local /proc is mounted for a different PID namespace; real group ownership cannot be verified")
        script = ("import os,time\n"
                  "pid=os.fork()\n"
                  "if pid: os._exit(130)\n"
                  "time.sleep(0.4); os._exit(0)\n")
        with harness.OwnedFaultProcess([sys.executable, "-I", "-c", script], environment={"PATH": "/usr/bin:/bin"}) as child:
            started = time.monotonic()
            code, _ = child.wait(5)
            self.assertEqual(code, 130)
            self.assertGreater(time.monotonic() - started, 0.3)
            self.assertGreaterEqual(child.proof()["observedProcessCount"], 2)
            with patch.object(harness.os, "killpg") as signal_group:
                self.assertFalse(child.signal(signal.SIGINT))
            signal_group.assert_not_called()

    def test_group_stop_interrupt_continue_are_real_and_owned(self):
        if not harness.native_proc_namespace():
            self.skipTest("Local /proc is mounted for a different PID namespace; real group ownership cannot be verified")
        script = ("import os,signal,time\n"
                  "signal.signal(signal.SIGINT, lambda *args: os._exit(130))\n"
                  "os.fork()\n"
                  "while True: time.sleep(0.1)\n")
        with harness.OwnedFaultProcess([sys.executable, "-I", "-c", script], environment={"PATH": "/usr/bin:/bin"}) as child:
            deadline = time.monotonic() + 3
            while len(child.members()) < 2 and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(len(child.members()), 2)
            self.assertTrue(child.signal(signal.SIGSTOP))
            while any(item["state"] not in ("T", "t") for item in child.members()) and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(all(item["state"] in ("T", "t") for item in child.members()))
            self.assertTrue(child.signal(signal.SIGINT))
            self.assertTrue(child.signal(signal.SIGCONT))
            code, _ = child.wait(5)
            self.assertEqual(code, 130)

    def test_changed_anchor_identity_is_never_signalled(self):
        if not harness.native_proc_namespace():
            self.skipTest("Local /proc is mounted for a different PID namespace; real group ownership cannot be verified")
        with harness.OwnedFaultProcess([sys.executable, "-I", "-c", "import time; time.sleep(10)"],
                environment={"PATH": "/usr/bin:/bin"}) as child:
            changed = {**child.anchor, "startTime": child.anchor["startTime"] + 1}
            with patch.object(harness, "proc_identity", return_value=changed), patch.object(harness.os, "killpg") as signal_group, \
                    self.assertRaisesRegex(harness.Failure, "BLOCKED_FAULT_PROCESS_IDENTITY"):
                child.signal(signal.SIGINT)
            signal_group.assert_not_called()

    def test_inotify_watches_real_directory_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            watcher = harness.ExportWatcher(Path(directory))
            try:
                target = Path(directory) / "objects"
                target.mkdir()
                watcher.wait()
                watcher.watch(target)
                self.assertIn(target, watcher.paths)
            finally:
                watcher.close()


class CloudFailurePolicyTests(unittest.TestCase):
    def test_connection_refusal_retains_backup_and_distinguishes_required_from_best_effort(self):
        # A bound, non-listening loopback socket cannot accept a connection and
        # cannot be claimed by another local listener. No provider credentials,
        # shared network settings, actual Yandex or live backup are involved.
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as refusal:
            refusal.bind(("127.0.0.1", 0))
            port = refusal.getsockname()[1]
            failures = []

            def unavailable(*_args, **_kwargs):
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                try:
                    opener.open("http://127.0.0.1:" + str(port), timeout=1)
                except (OSError, urllib.error.URLError):
                    failures.append(True)
                    raise Blocked("CLOUD_TRANSFER_FAILED", "Synthetic loopback connection refused", "Retry") from None
                self.fail("The deliberately non-listening socket accepted a connection")

            for policy_name in ("required", "best-effort"):
                with self.subTest(policy=policy_name), tempfile.TemporaryDirectory() as directory:
                    install = fixture.fake_install(directory)
                    receipt = fixture.receipt(install)
                    receipt["policy"] = policy_name
                    flow._save(install, receipt)
                    atomic_json(flow._receipt_root(install) / ("operation-" + fixture.OP + ".json"),
                                {"installationId": fixture.ID, "snapshotId": fixture.SNAP, "operationId": fixture.OP})
                    atomic_json(install.state / "maintenance.json", {"operationId": fixture.OP})
                    hold = {"deadlineEpoch": time.time() + 900, "deadlineMonotonic": time.monotonic() + 900,
                            "containers": {"api": "synthetic-api"}}
                    with patch.object(flow, "consume_backup_hold", return_value=hold), \
                            patch.object(flow, "_command", side_effect=fixture.fake_age), \
                            patch.object(flow, "_deliver", side_effect=unavailable), \
                            patch.object(flow, "resume_backup_writers", return_value={"status": "OK", "previousRuntimeVerified": True}) as resume:
                        result = flow.run_backup(install, operation_id=fixture.OP, installation_id=fixture.ID,
                                                 hold_writers=True, policy={"policy": policy_name, "ageRecipient": fixture.RECIPIENT,
                                                                            "cloud": {"enabled": True}})
                    self.assertEqual(result["outcome"], "BLOCKED" if policy_name == "required" else "WARNING")
                    self.assertEqual(resume.call_count, 1 if policy_name == "required" else 0)
                    self.assertEqual(result["local"]["status"], "OK")
                    self.assertEqual(result["encryption"]["status"], "OK")
                    self.assertNotEqual(result["cloud"]["status"], "OK")
                    self.assertFalse(result["protectionConfirmed"])
                    self.assertTrue(Path(result["local"]["path"]).is_dir())
                    self.assertEqual(result["restore"]["status"], "UNVERIFIED")
            self.assertEqual(len(failures), 2)


if __name__ == "__main__":
    if sys.argv[1:] == ["--evidence"]:
        suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
        result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)
        skipped_ownership = any("LinuxRuntimeFaultTests" in test.id() and "proc" in reason for test, reason in result.skipped)
        print(json.dumps({"status": "PASS" if result.wasSuccessful() else "FAIL", "testsRun": result.testsRun,
                          "testsSkipped": len(result.skipped), "nativeProcessOwnership": "NOT_RUN" if skipped_ownership else "PASS" if result.wasSuccessful() else "FAIL",
                          "connectionFault": "isolated loopback refusal at mocked transport boundary",
                          "requiredPolicy": "BLOCKED with old writers resumed", "bestEffortPolicy": "WARNING with local backup retained",
                          "ageCryptography": "mocked in policy tests; not cryptographic acceptance"}))
        raise SystemExit(0 if result.wasSuccessful() else 1)
    unittest.main()
