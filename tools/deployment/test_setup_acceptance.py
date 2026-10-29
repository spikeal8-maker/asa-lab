"""Acceptance evidence boundaries; no live application, Docker or credentials."""

import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import setup_acceptance as acceptance
from deployment.contracts import Blocked, REGISTRY, SERVICES


REVISION = "a" * 40
OPERATION = "b" * 32
INSTANCE = "c" * 32
ORIGIN = "https://asa-test.example.invalid"
IMAGE_ID = "sha256:" + "d" * 64
RELEASE = {"format": "asa-deployment-v2", "repository": "spikeal8-maker/asa-lab",
           "revision": REVISION, "schema": 275, "platform": "linux/amd64", "publicationRunId": 123,
           "images": {name: f"{REGISTRY}/{name}@sha256:" + "e" * 64 for name in SERVICES}}


def installation(root):
    class FakeInstallation:
        def __init__(self):
            self.root = Path(root)
            self.state = self.root / ".asa"
            self.settings = {"instanceId": INSTANCE}
            self.profile = "production"
            self.project = "asa-test-custom"
            self.process_env = {}
            self.env = dict(ASA_UPDATE_ENTRY_ORIGIN=ORIGIN, ASA_BLOCKS_PARENT_ORIGIN=ORIGIN,
                            ASA_BLOCKS_RUNTIME_ORIGIN=ORIGIN)
            self.records = {name: {"id": name, "image": image, "running": True, "mounts": []}
                            for name, image in RELEASE["images"].items()}
            self.records["postgres"] = {"id": "postgres", "image": "postgres:17.7-bookworm", "running": True}
            for name, destination in (("postgres", "/var/lib/postgresql/data"), ("minio", "/data")):
                self.records[name]["mounts"] = [{"Type": "volume", "Name": "fixture-" + name,
                        "Source": "/var/lib/docker/volumes/fixture-" + name + "/_data",
                        "Destination": destination, "Driver": "local"}]

        def identity(self):
            return self.records

        def readiness(self, revision, schema):
            if (revision, schema) != (REVISION, 275):
                raise Blocked("HEALTH", "Runtime mismatch", "Inspect")
            return {"revision": REVISION, "schema": 275}

    return FakeInstallation()


class BrowserEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.binding = {"operationId": OPERATION, "installationId": INSTANCE, "instanceId": INSTANCE,
                        "revision": REVISION, "entryOrigin": ORIGIN, "invocationId": "f" * 32,
                        "componentSha256": acceptance.BROWSER_SHA256, "fixtureSha256": acceptance.FIXTURE_SHA256}
        self.payload = {"format": "asa-browser-invocation-v1", **self.binding, "status": "completed", "returncode": 0,
                        "report": {"revision": REVISION, "entry_origin": ORIGIN, "error": None,
                                   "checks": {name: True for name in acceptance.REQUIRED_CHECKS}}}

    def test_only_complete_current_invocation_can_pass(self):
        report = acceptance.validate_browser_report(self.payload, self.binding, 0)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(set(report["checks"].values()), {"passed"})
        for name in self.binding:
            with self.subTest(name=name):
                changed = copy.deepcopy(self.payload)
                changed[name] = "other"
                with self.assertRaises(Blocked) as caught:
                    acceptance.validate_browser_report(changed, self.binding, 0)
                self.assertEqual(caught.exception.code, "BROWSER_REPORT_BINDING")

    def test_report_inside_envelope_must_match_the_target(self):
        for name in ("revision", "entry_origin"):
            with self.subTest(name=name):
                changed = copy.deepcopy(self.payload)
                changed["report"][name] = "foreign"
                with self.assertRaises(Blocked):
                    acceptance.validate_browser_report(changed, self.binding, 0)

    def test_missing_check_and_truthy_string_or_integer_do_not_pass(self):
        for value in (None, "true", 1, False):
            with self.subTest(value=value):
                changed = copy.deepcopy(self.payload)
                if value is None:
                    del changed["report"]["checks"]["student_login"]
                else:
                    changed["report"]["checks"]["student_login"] = value
                with self.assertRaises(Blocked):
                    acceptance.validate_browser_report(changed, self.binding, 0)

    def test_nonzero_exit_cannot_accept_a_success_report(self):
        for code in (1, 2, 3, 130):
            with self.subTest(code=code), self.assertRaises(Blocked):
                acceptance.validate_browser_report(self.payload, self.binding, code)

    def test_failed_scenario_stays_failed_and_suppresses_error_secrets(self):
        changed = copy.deepcopy(self.payload)
        changed["returncode"] = 2
        changed["report"]["checks"]["scratch_save_reopen"] = False
        changed["report"]["error"] = {"stage": "blocks_save", "code": "RuntimeError",
                                       "detail": "password=never-publish", "token": "private-token"}
        result = acceptance.validate_browser_report(changed, self.binding, 2)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error"], {"stage": "blocks_save", "code": "RuntimeError"})
        self.assertNotIn("never-publish", json.dumps(result))

    def test_environment_failure_is_distinct_from_failed_user_flow(self):
        value = {"format": "asa-browser-invocation-v1", **self.binding, "status": "environment_failed",
                 "reasonCode": "BROWSER_RUNTIME_UNAVAILABLE"}
        report = acceptance.validate_browser_report(value, self.binding, 3)
        self.assertEqual(report["status"], "environment_failed")
        self.assertEqual(set(report["checks"].values()), {"not_run"})
        with self.assertRaises(Blocked):
            acceptance.validate_browser_report(value, self.binding, 0)


class TechnicalAcceptanceTests(unittest.TestCase):
    def test_exact_images_schema_public_entry_and_data_are_independent(self):
        with tempfile.TemporaryDirectory() as temporary:
            install = installation(temporary)
            data = acceptance.storage_identity(install.records)
            with patch.object(acceptance, "validate_resolved_images") as config, \
                 patch.object(acceptance, "run", return_value=IMAGE_ID) as run, \
                 patch.object(acceptance, "verify_embedded_entry_http") as entry:
                result = acceptance.technical_acceptance(install, RELEASE, OPERATION, expected_data=data)
            self.assertEqual(result["status"], "passed")
            self.assertEqual(result["dataIdentity"], data)
            self.assertEqual(result["entry"]["tls"], "verified")
            self.assertEqual(run.call_count, 2 * len(SERVICES))
            config.assert_called_once_with(install, RELEASE)
            entry.assert_called_once_with(ORIGIN, REVISION)
            self.assertFalse(install.state.exists())

    def test_replaced_actual_image_is_rejected_even_when_configured_digest_matches(self):
        with tempfile.TemporaryDirectory() as temporary:
            install = installation(temporary)
            with patch.object(acceptance, "validate_resolved_images"), \
                 patch.object(acceptance, "run", side_effect=[IMAGE_ID, "sha256:" + "f" * 64]), \
                 patch.object(acceptance, "verify_embedded_entry_http") as entry:
                result = acceptance.technical_acceptance(install, RELEASE, OPERATION)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["reasonCode"], "IMAGE_DRIFT")
            self.assertEqual(result["checks"]["entry"], "not_run")
            entry.assert_not_called()

    def test_substituted_volume_is_not_data_preservation(self):
        with tempfile.TemporaryDirectory() as temporary:
            install = installation(temporary)
            original = acceptance.storage_identity(install.records)
            install.records["postgres"]["mounts"][0]["Name"] = "another-empty-volume"
            with patch.object(acceptance, "validate_resolved_images"), patch.object(acceptance, "run", return_value=IMAGE_ID), \
                 patch.object(acceptance, "verify_embedded_entry_http") as entry:
                result = acceptance.technical_acceptance(install, RELEASE, OPERATION, expected_data=original)
            self.assertEqual(result["reasonCode"], "DATA_IDENTITY_CHANGED")
            entry.assert_not_called()

    def test_stopped_service_or_public_tls_failure_never_green(self):
        with tempfile.TemporaryDirectory() as temporary:
            install = installation(temporary)
            install.records["api"]["running"] = False
            with patch.object(acceptance, "validate_resolved_images"), patch.object(acceptance, "run") as run:
                result = acceptance.technical_acceptance(install, RELEASE, OPERATION)
            self.assertEqual(result["reasonCode"], "SERVICE_STOPPED")
            run.assert_not_called()
            install.records["api"]["running"] = True
            with patch.object(acceptance, "validate_resolved_images"), patch.object(acceptance, "run", return_value=IMAGE_ID), \
                 patch.object(acceptance, "verify_embedded_entry_http", side_effect=OSError("token secret")):
                result = acceptance.technical_acceptance(install, RELEASE, OPERATION)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["checks"]["runtime"], "passed")
            self.assertEqual(result["checks"]["entry"], "failed")
            self.assertNotIn("secret", json.dumps(result))


class PinnedComponentTests(unittest.TestCase):
    def test_manifest_pins_the_runtime_components_and_exact_source_commit(self):
        manifest = json.loads((Path(__file__).parent / "setup_ops_manifest.json").read_text())
        self.assertEqual(manifest["revision"], acceptance.OPS_REVISION)
        self.assertEqual(manifest["browserRuntime"]["version"], acceptance.PLAYWRIGHT_VERSION)
        entries = {item["path"]: item for item in manifest["files"]}
        self.assertEqual(entries["scripts/asa_ops/browser_acceptance.py"]["sha256"], acceptance.BROWSER_SHA256)
        self.assertEqual(entries["scripts/asa_ops/acceptance_fixture.py"]["sha256"], acceptance.FIXTURE_SHA256)

    def test_tampered_source_never_executes_even_with_its_hash_in_config(self):
        with tempfile.TemporaryDirectory() as temporary:
            install = installation(temporary)
            component = Path(temporary) / "browser_acceptance.py"
            component.write_text("raise RuntimeError('must never execute')")
            config = {"componentPath": str(component), "componentSha256": hashlib.sha256(component.read_bytes()).hexdigest(),
                      "pythonPath": sys.executable, "fixturePath": str(Path(temporary) / "private" / "fixture.json")}
            with patch.object(acceptance.subprocess, "run") as run:
                result = acceptance.browser_acceptance(install, RELEASE, OPERATION, config)
            self.assertEqual(result["reasonCode"], "BROWSER_COMPONENT_PIN")
            run.assert_not_called()
            config["componentSha256"] = acceptance.BROWSER_SHA256
            with patch.object(acceptance.subprocess, "run") as run:
                result = acceptance.browser_acceptance(install, RELEASE, OPERATION, config)
            self.assertEqual(result["reasonCode"], "BROWSER_COMPONENT_HASH")
            run.assert_not_called()

    @unittest.skipIf(os.name == "nt", "POSIX symlink ownership boundary")
    def test_symlink_or_multiply_linked_component_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            original = Path(temporary) / "source.py"
            original.write_bytes(b"pass\n")
            expected = hashlib.sha256(original.read_bytes()).hexdigest()
            linked = Path(temporary) / "linked.py"
            linked.symlink_to(original)
            with self.assertRaises(Blocked):
                acceptance._read_pinned(linked, expected)
            linked.unlink()
            os.link(original, linked)
            with self.assertRaises(Blocked):
                acceptance._read_pinned(linked, expected)

    def test_missing_runtime_is_incomplete_and_not_acceptance(self):
        with tempfile.TemporaryDirectory() as temporary:
            install = installation(temporary)
            result = acceptance.browser_acceptance(install, RELEASE, OPERATION, None)
            self.assertEqual(result["status"], "incomplete")
            self.assertEqual(set(result["checks"].values()), {"not_run"})
            self.assertFalse(install.state.exists())

    def test_wrapper_timeout_remains_environment_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            install = installation(temporary)
            config = {"componentPath": str(Path(temporary) / "browser_acceptance.py"),
                      "componentSha256": acceptance.BROWSER_SHA256,
                      "pythonPath": sys.executable,
                      "fixturePath": str(Path(temporary) / "private" / "fixture.json")}
            with patch.object(acceptance, "_read_pinned", return_value=b"pass\n"), \
                 patch.object(acceptance, "_python_path", return_value=Path(sys.executable)), \
                 patch.object(acceptance, "_run_browser", side_effect=subprocess.TimeoutExpired("python", 600)):
                result = acceptance.browser_acceptance(install, RELEASE, OPERATION, config)
            self.assertEqual(result["status"], "environment_failed")
            self.assertEqual(result["reasonCode"], "BROWSER_TIMEOUT")

    def test_real_child_without_runtime_returns_safe_bound_environment_failure(self):
        binding = {"operationId": OPERATION, "instanceId": INSTANCE, "installationId": INSTANCE}
        payload = {"binding": binding, "runtimeVersion": acceptance.PLAYWRIGHT_VERSION}
        # -S intentionally supplies no third-party packages. This is an actual
        # child, demonstrating the missing-runtime outcome, not a browser PASS.
        process = subprocess.run([sys.executable, "-I", "-B", "-S", "-c", acceptance._BROWSER_LAUNCHER],
                                 input=json.dumps(payload), capture_output=True, text=True, timeout=15)
        self.assertEqual(process.returncode, 3)
        value = json.loads(process.stdout)
        self.assertEqual(value["operationId"], OPERATION)
        self.assertEqual(value["reasonCode"], "BROWSER_RUNTIME_UNAVAILABLE")
        self.assertEqual(process.stderr, "")

    @unittest.skipUnless(os.name == "posix", "POSIX process-group cleanup")
    def test_timeout_terminates_only_the_created_group_before_return(self):
        with tempfile.TemporaryDirectory() as temporary, \
             patch.object(acceptance.subprocess, "Popen") as popen, \
             patch.object(acceptance.os, "killpg") as killpg:
            process = popen.return_value
            process.pid = 123456
            process.communicate.side_effect = subprocess.TimeoutExpired("browser", 30)
            process.wait.return_value = -9
            with self.assertRaises(subprocess.TimeoutExpired):
                acceptance._run_browser([sys.executable], cwd=temporary, payload={}, stdout=None,
                                        stderr=None, environment={}, timeout=30)
            self.assertTrue(popen.call_args.kwargs["start_new_session"])
            self.assertEqual([call.args for call in killpg.call_args_list],
                             [(123456, acceptance.signal.SIGTERM), (123456, acceptance.signal.SIGKILL)])
            self.assertEqual(process.wait.call_count, 1)


class DiagnosticAndRestoreTests(unittest.TestCase):
    def test_collector_observation_never_prepares_or_repairs(self):
        with tempfile.TemporaryDirectory() as temporary:
            install = installation(temporary)
            with patch.object(acceptance.collector, "status", return_value={"state": "unavailable"}), \
                 patch.object(acceptance.collector, "prepare") as prepare, \
                 patch.object(acceptance.collector, "reconcile") as reconcile:
                result = acceptance.collector_observation(install, OPERATION)
            self.assertEqual(result["status"], "warning")
            self.assertFalse(result["required"])
            prepare.assert_not_called()
            reconcile.assert_not_called()
            self.assertFalse(install.state.exists())

    @unittest.skipIf(os.name == "nt", "systemd observation is POSIX-only")
    def test_systemd_pid_and_cycle_coverage_must_both_match(self):
        with tempfile.TemporaryDirectory() as temporary:
            install = installation(temporary)
            observation = {"state": "running", "mode": "system", "process": {"pid": os.getpid()},
                           "cycle": {"state": "ok", "checkedAt": acceptance.now(), "coverageComplete": True}}
            properties = "ActiveState=active\nLoadState=loaded\nMainPID=" + str(os.getpid()) + "\n"
            with patch.object(acceptance.collector, "status", return_value=observation), \
                 patch.object(acceptance.collector, "read_json", return_value={"name": "asa-log-collector.service"}), \
                 patch.object(acceptance.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=properties)):
                self.assertEqual(acceptance.collector_observation(install, OPERATION)["status"], "passed")
                observation["cycle"]["coverageComplete"] = False
                degraded = acceptance.collector_observation(install, OPERATION)
                self.assertEqual(degraded["status"], "warning")
                self.assertEqual(degraded["checks"]["process"], "passed")
                self.assertEqual(degraded["checks"]["cycle"], "warning")
                observation["cycle"]["coverageComplete"] = True
                observation["process"]["pid"] = -1
                self.assertEqual(acceptance.collector_observation(install, OPERATION)["status"], "warning")

    def test_expired_or_future_cycle_is_not_fresh(self):
        for offset in (-3600, 3600):
            value = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=offset)).isoformat()
            self.assertFalse(acceptance._fresh(value))

    def test_real_restore_stays_blocked_without_owner_pin_and_images(self):
        report = acceptance.restore_status(OPERATION, "20261026T231505Z-038beee0")
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["recoverability"], "UNVERIFIED")
        self.assertFalse(report["executionAllowed"])
        self.assertFalse(report["ownerPinProvisioned"])
        self.assertEqual(report["approvedImageSets"], [])
        self.assertEqual(report["blockingCodes"], ["BLOCKED_PLAN", "BLOCKED_KEY_ACCESS"])
        self.assertEqual(acceptance.restore_status(OPERATION)["status"], "not_run")


if __name__ == "__main__":
    unittest.main()
