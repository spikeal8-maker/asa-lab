"""Closed restore diagnostics; all Docker/network boundaries are fixtures."""

import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import ci_setup_smoke as smoke, system
from deployment.contracts import Blocked


SECRET = "PRIVATE_RESTORE_DIAGNOSTIC_SECRET"
STAGES = (
    "PG_VOLUME_CREATE", "PG_IMAGE_INSPECT", "PG_CONTAINER_CREATE", "PG_START", "PG_READY",
    "PG_GLOBALS", "PG_DATABASE_CREATE", "PG_DUMP_COPY", "PG_RESTORE", "PG_ROWS_CHECK",
    "PG_ROLES_CHECK", "PG_ACL_RLS_CHECK",
)


class RestoreStageTests(unittest.TestCase):
    def test_actual_runner_error_keeps_identity_and_only_numeric_exit_is_projected(self):
        for code in (1, 17, -9, 3221225786):
            with self.subTest(code=code):
                evidence = {"status": "FAIL", "lastCompletedStage": "PG_DUMP_COPY"}
                result = SimpleNamespace(returncode=code, stdout=SECRET, stderr=SECRET)
                with patch.object(system.subprocess, "run", return_value=result), self.assertRaises(Blocked) as original:
                    system.run(["docker", "exec", SECRET, "pg_restore", SECRET], capture=True)
                with self.assertRaises(Blocked) as caught:
                    with smoke.restore_stage(evidence, "PG_RESTORE"):
                        raise original.exception
                self.assertIs(caught.exception, original.exception)
                self.assertEqual(evidence, {"status": "FAIL", "currentStage": "PG_RESTORE",
                    "lastCompletedStage": "PG_DUMP_COPY",
                    "failedCommand": {"category": "POSTGRES_ARCHIVE_RESTORE", "exitCode": code}})
                self.assertNotIn(SECRET, json.dumps(evidence))

    def test_unknown_error_forms_never_export_text_or_invent_an_exit_code(self):
        messages = (SECRET, "docker exec failed (exit 0).", "docker exec failed (exit 01).",
                    "docker exec failed (exit 4294967296).", "docker exec failed (exit -2147483649).",
                    "docker exec failed (exit 1).\n" + SECRET, "docker volume failed (exit 1).",
                    "docker exec failed (exit 1). " + SECRET, SECRET * 1000, {"password": SECRET})
        for message in messages:
            with self.subTest(kind=type(message).__name__):
                evidence = {"status": "FAIL"}
                error = Blocked("COMMAND", message, SECRET)
                with self.assertRaises(Blocked) as caught:
                    with smoke.restore_stage(evidence, "PG_GLOBALS"):
                        raise error
                self.assertIs(caught.exception, error)
                self.assertEqual(evidence["failedCommand"], {"category": "POSTGRES_GLOBALS_IMPORT", "exitCode": None,
                                                             "reasonCode": "UNRECOGNIZED_COMMAND_ERROR"})
                self.assertNotIn(SECRET, json.dumps(evidence))

    def test_only_the_closed_stage_set_can_enter_the_diagnostic(self):
        for stage in (SECRET, "PG_" + SECRET, "pg_restore", None, [], {}):
            evidence = {"status": "FAIL"}
            with self.subTest(kind=type(stage).__name__), self.assertRaises(Blocked) as caught:
                with smoke.restore_stage(evidence, stage):
                    self.fail("Unknown stage entered its body")
            self.assertEqual(caught.exception.code, "CI_RESTORE_DIAGNOSTIC_STAGE")
            self.assertEqual(evidence, {"status": "FAIL"})
            self.assertNotIn(SECRET, str(caught.exception))

    def test_readiness_retry_success_does_not_become_a_failed_command(self):
        evidence = {"status": "FAIL", "lastCompletedStage": "PG_START"}
        transient = Blocked("COMMAND", "docker exec failed (exit 1).", SECRET)
        with patch.object(smoke, "run", side_effect=[transient, ""]), patch.object(smoke.time, "sleep"):
            with smoke.restore_stage(evidence, "PG_READY"):
                smoke.wait_command(["docker", "exec", "fixture", "pg_isready"])
        self.assertEqual(evidence, {"status": "FAIL", "currentStage": None, "lastCompletedStage": "PG_READY"})

    def test_readiness_exhaustion_keeps_service_timeout_instead_of_command(self):
        evidence = {"status": "FAIL", "lastCompletedStage": "PG_START"}
        transient = Blocked("COMMAND", "docker exec failed (exit 1).", SECRET)
        with patch.object(smoke, "run", side_effect=transient), patch.object(smoke.time, "sleep"), \
                patch.object(smoke.time, "monotonic", side_effect=[0, 1, 121]), self.assertRaises(Blocked) as caught:
            with smoke.restore_stage(evidence, "PG_READY"):
                smoke.wait_command(["docker", "exec", "fixture", "pg_isready"])
        self.assertEqual(caught.exception.code, "CI_SERVICE_TIMEOUT")
        self.assertEqual(evidence, {"status": "FAIL", "currentStage": "PG_READY", "lastCompletedStage": "PG_START"})

    def test_other_errors_are_rethrown_without_command_metadata_or_success(self):
        failures = (Blocked("COMMAND_TIMEOUT", SECRET, SECRET), Blocked("CI_ROW_FINGERPRINTS", SECRET, SECRET),
                    OSError(SECRET), KeyboardInterrupt(SECRET))
        for error in failures:
            evidence = {"status": "FAIL", "lastCompletedStage": "PG_RESTORE"}
            with self.subTest(kind=type(error).__name__), self.assertRaises(type(error)) as caught:
                with smoke.restore_stage(evidence, "PG_ROWS_CHECK"):
                    raise error
            self.assertIs(caught.exception, error)
            self.assertEqual(evidence, {"status": "FAIL", "currentStage": "PG_ROWS_CHECK", "lastCompletedStage": "PG_RESTORE"})
            self.assertNotIn(SECRET, json.dumps(evidence))


class AfterPostgresBoundary(RuntimeError):
    """Stop the fixture before MinIO; no real restore or provider is exercised."""


class SmokeRestoreBoundaryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name)
        self.trace, self.calls = [], []
        self.evidence = None
        self.fail_stage, self.failure, self.mismatch = None, None, None
        self.cleanup_failure = False
        self.control = {"accounts": {"rows": 1, "sha256": "b" * 64}}
        self.manifest = {"roleCredentialsIncluded": True, "applicationPrivileges": []}

    def observed(self):
        stage = self.evidence.get("currentStage")
        if stage and (not self.trace or self.trace[-1] != stage):
            self.trace.append(stage)
        if stage == self.fail_stage and stage is not None:
            raise self.failure
        return stage

    def run_command(self, arguments, **options):
        args = [str(item) for item in arguments]
        self.calls.append((args, options))
        stage = self.observed()
        if args == ["git", "rev-parse", "HEAD"]:
            return "a" * 40
        if args[:2] == ["age-keygen", "--output"]:
            Path(args[2]).write_text(SECRET)
            return ""
        if args[:2] == ["age-keygen", "-y"]:
            return "synthetic-recipient"
        if stage:
            self.assertEqual(args[0], "docker")
            if stage == "PG_IMAGE_INSPECT":
                return "sha256:" + "c" * 64
            if stage == "PG_GLOBALS":
                self.assertEqual(options["input_file"].read(), SECRET.encode())
                self.assertEqual(options["timeout"], 60)
            if stage == "PG_DUMP_COPY":
                self.assertEqual(options["input_file"].read(), b"synthetic-database-dump")
                self.assertEqual(options["timeout"], 120)
            if stage == "PG_RESTORE":
                self.assertEqual(args[3:6], ["pg_restore", "--exit-on-error", "--single-transaction"])
                self.assertEqual(options["timeout"], 180)
            return ""
        if args[:3] == ["docker", "volume", "create"] and args[-1].endswith("-restore-minio-data"):
            raise AfterPostgresBoundary()
        self.fail("Unexpected fixture command; no native process may be started")

    def installation(self, root, profile):
        project = (root / ".env").read_text().splitlines()[0].split("=", 1)[1]
        return SimpleNamespace(root=root, project=project, settings={"instanceId": "d" * 32},
            env={"POSTGRES_USER": "fixture-owner", "POSTGRES_DB": "fixture-db"},
            compose=lambda *args, **options: None, wait_ready=lambda *args: None,
            identity=lambda: {"postgres": {"id": "fixture-source-postgres"}})

    def backup(self, install, **options):
        snapshot = "20261104T010101Z-abcdef12"
        folder = install.root / "backups" / snapshot
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "manifest.json").write_text("{}")
        return {"snapshotId": snapshot, "snapshotAt": "2026-11-04T01:01:01+00:00", "outcome": "WARNING",
                "local": {"status": "OK"}, "cloud": {"status": "NOT_CONFIGURED"},
                "encryption": {"status": "OK", "sha256": "e" * 64, "path": str(folder / "synthetic.age")}}

    def decrypt(self, ciphertext, identity, root):
        restored = root / "decrypted-fixture"
        restored.mkdir()
        (restored / "private.env").write_bytes((root / ".env").read_bytes())
        (restored / "globals.sql").write_text(SECRET)
        (restored / "database.dump").write_bytes(b"synthetic-database-dump")
        return restored

    def rows(self, *args):
        stage = self.observed()
        return {} if stage == self.mismatch == "PG_ROWS_CHECK" else self.control

    def roles(self, *args):
        stage = self.observed()
        return "changed" if stage == self.mismatch == "PG_ROLES_CHECK" else "f" * 64

    def privileges(self, *args):
        stage = self.observed()
        return "[1]" if stage == self.mismatch == "PG_ACL_RLS_CHECK" else "[]"

    def remove(self, *args):
        if self.cleanup_failure:
            raise Blocked("COMMAND", "docker rm failed (exit 1).", SECRET)

    def invoke(self):
        original = smoke.run_smoke
        saved = {}
        def scenario(evidence):
            self.evidence = evidence
            return original(evidence)
        def save(destination, evidence):
            saved.update(copy.deepcopy(evidence))
        def first_environment(root, profile):
            (root / ".env").write_text("COMPOSE_PROJECT_NAME=asa-lab-dev\nPOSTGRES_PASSWORD=" + SECRET + "\n")
        component = b"synthetic browser component"
        patches = {
            "run_smoke": scenario, "run": self.run_command, "source_file": lambda *args: component,
            "discover_release": lambda: {"revision": "a" * 40, "schema": 304, "publicationRunId": 1},
            "assert_ci": lambda *args: None, "fetch_images": lambda *args: None,
            "first_environment": first_environment, "Installation": self.installation, "save_settings": lambda *args, **kwargs: None,
            "apply_release_environment": lambda *args: None, "validate_resolved_images": lambda *args: None,
            "browser_acceptance": lambda *args: {"status": "passed"}, "run_backup": self.backup,
            "operation_lock": lambda *args: contextlib.nullcontext(), "database_fingerprints": self.rows,
            "role_fingerprint": self.roles, "sql_container": self.privileges,
            "consume_backup_hold": lambda *args: None, "resume_backup_writers": lambda *args: None,
            "decrypt_bundle": self.decrypt, "verify_backup": lambda *args: self.manifest,
            "owned_remove": self.remove, "atomic_json": save,
        }
        with contextlib.ExitStack() as stack:
            for name, callback in patches.items():
                stack.enter_context(patch.object(smoke, name, side_effect=callback))
            stack.enter_context(patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "RUNNER_OS": "Linux", "ASA_SETUP_CI_BROWSER_PYTHON": "fixture-python"}))
            stack.enter_context(patch.object(smoke.os, "uname", return_value=SimpleNamespace(machine="x86_64"), create=True))
            stack.enter_context(patch.object(smoke.Path, "cwd", return_value=self.workspace))
            stack.enter_context(patch.object(smoke, "BROWSER_SHA256", hashlib.sha256(component).hexdigest()))
            stack.enter_context(patch.object(smoke, "FIXTURE_SHA256", hashlib.sha256(component).hexdigest()))
            stack.enter_context(patch.object(smoke.subprocess, "run", side_effect=AssertionError("Native process forbidden")))
            stack.enter_context(patch.object(smoke.urllib.request, "urlopen", side_effect=AssertionError("Network forbidden")))
            if self.fail_stage == "PG_READY":
                stack.enter_context(patch.object(smoke, "wait_command", side_effect=lambda *args: self.observed()))
            with contextlib.redirect_stdout(io.StringIO()) as output:
                code = smoke.main()
        self.assertEqual(code, 1)
        self.assertEqual(saved["status"], "FAIL")
        self.assertNotIn(SECRET, json.dumps(saved) + output.getvalue())
        return saved

    def test_actual_smoke_stage_order_and_later_failure_are_not_misattributed(self):
        result = self.invoke()
        self.assertEqual(self.trace, list(STAGES))
        self.assertIsNone(result["currentStage"])
        self.assertEqual(result["lastCompletedStage"], "PG_ACL_RLS_CHECK")
        self.assertNotIn("failedCommand", result)
        self.assertEqual(result["errorCode"], "AfterPostgresBoundary")
        self.assertEqual(result["checks"]["freshPostgresRestore"], "PASS")
        self.assertNotIn("freshMinioAuthenticatedS3Restore", result["checks"])
        self.assertEqual(result["cleanup"], {"status": "PASS", "errors": []})

    def test_command_failure_at_each_nonreadiness_stage_stops_before_the_next_stage(self):
        for index, stage in enumerate(STAGES):
            if stage == "PG_READY":
                continue
            with self.subTest(stage=stage):
                self.trace, self.calls = [], []
                self.fail_stage = stage
                operation = {"PG_VOLUME_CREATE": "volume", "PG_IMAGE_INSPECT": "inspect",
                             "PG_CONTAINER_CREATE": "create", "PG_START": "start"}.get(stage, "exec")
                self.failure = Blocked("COMMAND", "docker " + operation + " failed (exit 17).", SECRET)
                result = self.invoke()
                self.assertEqual(self.trace, list(STAGES[:index + 1]))
                self.assertEqual(result["currentStage"], stage)
                self.assertEqual(result["lastCompletedStage"], STAGES[index - 1] if index else None)
                self.assertEqual(result["errorCode"], "COMMAND")
                self.assertEqual(result["failedCommand"]["exitCode"], 17)
                self.assertNotIn("freshPostgresRestore", result["checks"])
                self.assertEqual(result["cleanup"], {"status": "PASS", "errors": []})

    def test_actual_smoke_keeps_readiness_timeout_and_no_false_postgres_pass(self):
        self.fail_stage = "PG_READY"
        self.failure = Blocked("CI_SERVICE_TIMEOUT", SECRET, SECRET)
        result = self.invoke()
        self.assertEqual(result["currentStage"], "PG_READY")
        self.assertEqual(result["lastCompletedStage"], "PG_START")
        self.assertEqual(result["errorCode"], "CI_SERVICE_TIMEOUT")
        self.assertNotIn("failedCommand", result)
        self.assertNotIn("freshPostgresRestore", result["checks"])

    def test_actual_fingerprint_mismatches_keep_their_original_codes(self):
        for stage, code in (("PG_ROWS_CHECK", "CI_ROW_FINGERPRINTS"), ("PG_ROLES_CHECK", "CI_ROLE_IDENTITIES"),
                            ("PG_ACL_RLS_CHECK", "CI_ACL_RLS")):
            with self.subTest(stage=stage):
                self.trace, self.calls = [], []
                self.mismatch = stage
                result = self.invoke()
                self.assertEqual(result["currentStage"], stage)
                self.assertEqual(result["errorCode"], code)
                self.assertNotIn("failedCommand", result)
                self.assertNotIn("freshPostgresRestore", result["checks"])

    def test_cleanup_failure_is_separate_and_cannot_replace_the_original_failure(self):
        self.mismatch = "PG_ROLES_CHECK"
        self.cleanup_failure = True
        result = self.invoke()
        self.assertEqual(result["currentStage"], "PG_ROLES_CHECK")
        self.assertEqual(result["lastCompletedStage"], "PG_ROWS_CHECK")
        self.assertEqual(result["errorCode"], "CI_ROLE_IDENTITIES")
        self.assertEqual(result["cleanup"], {"status": "FAILED", "errors": ["COMMAND", "COMMAND"]})
        self.assertNotIn("failedCommand", result)


if __name__ == "__main__":
    unittest.main()
