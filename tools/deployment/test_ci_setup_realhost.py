"""Harness safety gates and isolated manager faults; no VM or live cloud claim."""

import ast
import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import shutil
import signal
import socket
import stat
import subprocess
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
from deployment import realhost_cli_checks as cli_checks, realhost_cli_runtime as cli_runtime, setup_bundle


def cli_read_fixture():
    pins = harness.pin_manifest(HERE / "fixtures/setup-realhost-pins.json")
    selections = {}
    for name, letter in (("previous", "a"), ("current", "b")):
        pin = pins[name]
        selections[name] = {"ci": "VERIFIED", "deploymentDigest": pin["deploymentDigest"],
            "manifestDigest": pin["amd64ManifestDigest"], "release": {"format": "asa-deployment-v2",
            "repository": harness.REPOSITORY, "platform": "linux/amd64", "revision": pin["revision"],
            "schema": pin["schema"], "publicationRunId": pin["publicationRunId"],
            "images": {service: "ghcr.io/" + harness.REPOSITORY + "/" + service + "@sha256:" + letter * 64
                       for service in harness.CLI_IMAGES}}}
    context = {"pins": pins, "sourceRevision": "d" * 40, "ageRecipient": fixture.RECIPIENT,
               "cliReleaseExpectations": harness.cli_release_expectations(selections, pins)}
    context["acquisition"] = {"mode": "candidate", "approvedRevision": "", "sourceRevision": context["sourceRevision"]}
    context["cliDefaultTargetExpectation"] = {"revision": "f" * 40, "schema": pins["current"]["schema"] + 1,
        "images": {service: "ghcr.io/" + harness.REPOSITORY + "/" + service + "@sha256:" + "c" * 64
                   for service in harness.CLI_IMAGES}, "deploymentDigest": "sha256:" + "e" * 64,
        "manifestDigest": "sha256:" + "f" * 64, "ci": "VERIFIED", "publicationRunId": 123, "selector": "stable-before-vm"}
    owner = {"uid": 1001, "gid": 1001, "name": "asa-setup", "home": "/var/lib/asa-setup/operator",
             "root": str(harness.INSTALL_ROOT)}
    config = {"root": str(harness.INSTALL_ROOT), "installationId": "e" * 32, "operatorUid": owner["uid"],
        "project": "asa-lab-dev", "profile": "production", "entryOrigin": harness.ORIGIN,
        "ports": {"web": 4610, "api": 4611, "blocks": 4613}, "backupDirectory": str(harness.INSTALL_ROOT / "backups"),
        "backup": {"policy": "best-effort", "ageRecipient": fixture.RECIPIENT, "cloud": {"enabled": False},
                   "schedule": {"enabled": False, "time": "03:00", "timezone": "UTC", "maxAgeHours": 26}}}
    operation, snapshot, stamp = "c" * 32, "20261104T010101Z-abcdef12", "2026-11-04T01:01:01+00:00"
    previous = context["cliReleaseExpectations"]["previous"]
    receipt = {"format": "asa-setup-result-v1", "operationId": operation, "installationId": config["installationId"],
        "mode": "install", "exitCode": 0, "applicationAccepted": True, "outcome": "WARNING", "reasonCode": None,
        "version": {"selected": previous["revision"]}, "backup": {"snapshotId": snapshot},
        "site": {"url": harness.ORIGIN, "technical": {"status": "passed"}, "browser": {"status": "passed"}}}
    backup = {"operationId": operation, "installationId": config["installationId"], "snapshotId": snapshot, "snapshotAt": stamp,
              "local": {"status": "OK"}, "encryption": {"status": "OK"}, "cloud": {"status": "NOT_CONFIGURED"}, "outcome": "WARNING"}
    inputs = {"input": copy.deepcopy(config), "config": copy.deepcopy(config), "installed": copy.deepcopy(previous),
        "receipt": receipt, "attempt": copy.deepcopy(receipt), "journal": {"result": copy.deepcopy(receipt),
        "root": str(harness.INSTALL_ROOT), "project": "asa-lab-dev", "state": "TERMINAL",
        "requestedDeploymentDigest": previous["deploymentDigest"], "release": copy.deepcopy(previous),
        "operationId": operation, "installationId": config["installationId"], "mode": "install",
        "stages": {name: {"status": "done"} for name in ("release", "switch", "browser", "first_backup")}},
        "binding": {"snapshotId": snapshot, "operationId": operation, "installationId": config["installationId"]},
        "backup": backup, "backupAttempt": {"snapshotId": snapshot, "operationId": operation, "at": stamp},
        "backupSuccess": {"snapshotId": snapshot, "at": stamp}}
    paths = {"application": str(harness.INSTALL_ROOT), "backups": str(harness.INSTALL_ROOT / "backups"),
             "docker": "/var/lib/docker", "postgres": "/var/lib/docker/volumes/pg/_data",
             "minio": "/var/lib/docker/volumes/objects/_data"}
    return context, owner, inputs, paths, selections


class CLIReadWiringTests(unittest.TestCase):
    def setUp(self):
        root = patch.object(harness, "INSTALL_ROOT", PurePosixPath("/srv/asa-lab"))
        root.start()
        self.addCleanup(root.stop)
        self.context, self.owner, self.inputs, self.paths, self.selections = cli_read_fixture()

    def expected(self):
        return harness.cli_fixture_context(cli_checks, self.context, self.owner, self.inputs, self.paths)

    def test_immutable_release_inputs_reject_pin_image_type_and_ci_drift(self):
        for change in (
            lambda value: value["current"].update(deploymentDigest="sha256:" + "9" * 64),
            lambda value: value["current"].update(manifestDigest="sha256:" + "9" * 64),
            lambda value: value["current"].update(ci="UNKNOWN"),
            lambda value: value["previous"]["release"].update(schema=True),
            lambda value: value["previous"]["release"].update(publicationRunId=True),
            lambda value: value["current"]["release"]["images"].update(api="PRIVATE_TOKEN_SENTINEL"),
            lambda value: value["current"]["release"].update(revision="9" * 40),
        ):
            value = copy.deepcopy(self.selections)
            change(value)
            with self.subTest(value_hash=harness.canonical_hash(value)), self.assertRaises(harness.Failure) as caught:
                harness.cli_release_expectations(value, self.context["pins"])
            self.assertEqual(caught.exception.code, "CLI_READ_RELEASE_PIN")
            self.assertNotIn("PRIVATE_TOKEN_SENTINEL", str(caught.exception))

    def test_expected_context_comes_from_pins_and_bound_private_records(self):
        self.inputs["config"]["ignoredSecret"] = "PRIVATE_TOKEN_SENTINEL"
        expected, stamp = self.expected()
        self.assertEqual(expected.installed.revision, self.context["pins"]["previous"]["revision"])
        target = self.context["cliDefaultTargetExpectation"]
        self.assertEqual(expected.target.revision, target["revision"])
        self.assertEqual(expected.deployment_digest, target["deploymentDigest"])
        self.assertNotIn(expected.target.revision, (self.context["sourceRevision"], self.context["pins"]["current"]["revision"]))
        self.assertEqual(expected.snapshot_ids, (self.inputs["backup"]["snapshotId"],))
        self.assertEqual(expected.accepted_operation_id, self.inputs["receipt"]["operationId"])
        self.assertEqual(stamp, self.inputs["backup"]["snapshotAt"])
        self.assertNotIn("PRIVATE_TOKEN_SENTINEL", repr(expected))
        self.assertEqual(len(cli_runtime.command_plan(expected)) + 2, 31)
        updates = [case for case in cli_runtime.command_plan(expected) if case[2] in ("update", "update check", "update plan")]
        self.assertEqual(len(updates), 3)
        for case in updates:
            arguments = case[1]
            self.assertNotIn("apply", arguments)
            self.assertNotIn("--deployment-digest", arguments)  # Stable drift remains observable.

    def test_context_rejects_cross_operation_snapshot_and_release_substitution(self):
        changes = (
            lambda data: data["journal"].update(requestedDeploymentDigest="sha256:" + "f" * 64),
            lambda data: data["installed"].update(schema=305),
            lambda data: data["journal"]["release"].update(revision="f" * 40),
            lambda data: data["binding"].update(installationId="f" * 32),
            lambda data: data["backupAttempt"].update(operationId="f" * 32),
            lambda data: data["backupSuccess"].update(snapshotId="20261104T010102Z-abcdef12"),
            lambda data: data["journal"]["stages"]["first_backup"].update(status="intent"),
            lambda data: data["attempt"].update(outcome="NO_CHANGE"),
            lambda data: data["config"]["backup"]["cloud"].update(enabled=True),
        )
        for change in changes:
            original = copy.deepcopy(self.inputs)
            change(self.inputs)
            with self.subTest(change=changes.index(change)), self.assertRaises(harness.Failure):
                self.expected()
            self.inputs = original

    def test_filesystem_expectations_reject_unknown_or_relabelled_paths(self):
        self.paths["application"] = "/srv/foreign"
        with self.assertRaisesRegex(harness.Failure, "CLI_READ_STORAGE"):
            self.expected()

    def run_host_order(self, fail=False):
        runner = object.__new__(harness.HostRun)
        runner.args = SimpleNamespace(revision="d" * 40, preflight_only=False)
        runner.evidence = harness.initial_evidence(runner.args.revision)
        runner.deadline, runner.vm = time.monotonic() + 900, None
        runner.save = Mock()
        runner.guest = Mock(return_value={"status": "PASS"})
        names = []
        def phase(name, action):
            names.append(name)
            if name == "installed_cli_read_acceptance":
                if fail:
                    raise harness.Failure("CLI_SEMANTICS")
                return action()
        runner.phase = phase
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"RUNNER_TEMP": directory}), \
                contextlib.redirect_stdout(io.StringIO()):
            code = runner.run()
        return code, names, runner

    def test_mandatory_phase_executes_between_seed_and_update_with_outer_timeout(self):
        code, names, runner = self.run_host_order()
        self.assertEqual(code, 0)
        index = names.index("installed_cli_read_acceptance")
        self.assertEqual(names[index - 1:index + 2],
            ["independent_control_fixture", "installed_cli_read_acceptance", "published_runtime_update"])
        runner.guest.assert_called_once_with("cli-read", timeout=1200)

    def test_failed_cli_phase_prevents_all_later_mutations(self):
        code, names, runner = self.run_host_order(fail=True)
        self.assertEqual(code, 1)
        self.assertEqual(runner.evidence["reasonCode"], "CLI_SEMANTICS")
        self.assertNotIn("published_runtime_update", names)
        self.assertNotIn("public_backup_and_retry", names)
        runner.guest.assert_not_called()

    def invoke_suite(self, failure=None):
        expected, stamp = self.expected()
        evidence = {"format": "asa-realhost-cli-runtime-v1", "status": "PASS",
                    "cases": [{} for _ in range(29)], "bare": {"pipe": {}, "pty": {}}}
        if failure:
            evidence = {"format": "asa-realhost-cli-runtime-v1", "status": "FAIL", "failedCase": "update",
                        "reasonCode": "CLI_SEMANTICS", "semanticCode": "RELEASE_PIN_MISMATCH",
                        "observations": {"disk-health": {"status": "UNAVAILABLE"},
                                         "restore-plan": {"status": "BLOCKED_PLAN", "exitCode": 2}}}
        run = Mock(side_effect=cli_runtime.CLIRuntimeError("CLI_SEMANTICS",
            semantic_code="RELEASE_PIN_MISMATCH", evidence=evidence) if failure else None, return_value=evidence)
        runtime = SimpleNamespace(RuntimeExpectations=cli_runtime.RuntimeExpectations,
            CLIRuntimeError=cli_runtime.CLIRuntimeError, run_cli_suite=run)
        binding = {"status": "VERIFIED", "sourceRevision": self.context["sourceRevision"]}
        with tempfile.TemporaryDirectory() as directory, patch.object(harness, "GUEST_HOME", Path(directory)), \
                patch.object(harness.os, "geteuid", return_value=0, create=True), \
                patch.object(harness, "cli_trusted_bytes", return_value=json.dumps(self.context).encode()), \
                patch.object(harness, "cli_trusted_module", side_effect=[object(), cli_checks, runtime]), \
                patch.object(harness, "cli_candidate_binding", return_value=binding) as trusted, \
                patch.object(harness, "diagnostic_owner", return_value=(self.owner, {})), \
                patch.object(harness, "cli_context_inputs", return_value=self.inputs), \
                patch.object(harness, "root_json", return_value={"daemonIdentitySha256": "f" * 64}), \
                patch.object(harness, "cli_storage_observation", return_value=(self.paths, {})), \
                patch.object(harness, "guest_environment", return_value={"GH_TOKEN": "PRIVATE_TOKEN_SENTINEL"}):
            result = harness.installed_cli_read_guest(self.context)
            trusted.assert_called_once()
            prepared = json.loads((Path(directory) / "cli-control-context.json").read_text())
        self.assertEqual(prepared["operatorUid"], self.owner["uid"])
        args, options = run.call_args
        self.assertEqual(args, (expected, cli_runtime.RuntimeExpectations(self.owner["uid"], stamp)))
        self.assertIs(options["checker"], cli_checks.check_read_result)
        self.assertEqual(options["timeout"], 900)
        self.assertEqual(options["tokens"], {"GH_TOKEN": "PRIVATE_TOKEN_SENTINEL"})
        self.assertNotIn("PRIVATE_TOKEN_SENTINEL", json.dumps(result))
        return result, evidence

    def test_suite_preserves_closed_failure_and_optional_non_green_observations(self):
        result, evidence = self.invoke_suite(failure=True)
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["reasonCode"], "CLI_SEMANTICS")
        self.assertIs(result["cliReadEvidence"], evidence)
        self.assertEqual(evidence["observations"]["restore-plan"]["exitCode"], 2)

    def test_suite_reports_thirty_one_actual_coordinator_cases(self):
        result, _ = self.invoke_suite()
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["publicProcessCases"], 31)

    def test_root_registration_failure_stops_before_coordinator_or_callback(self):
        with patch.object(harness.os, "geteuid", return_value=0, create=True), \
                patch.object(harness, "cli_trusted_bytes", return_value=json.dumps(self.context).encode()), \
                patch.object(harness, "cli_trusted_module", return_value=object()), \
                patch.object(harness, "cli_candidate_binding", side_effect=harness.Failure("CLI_READ_REGISTRATION")), \
                patch.object(harness, "diagnostic_owner") as owner:
            with self.assertRaisesRegex(harness.Failure, "CLI_READ_REGISTRATION"):
                harness.installed_cli_read_guest(self.context)
            owner.assert_not_called()

    def test_callback_shared_deadline_owner_and_exact_five_field_projection(self):
        proof = {"databaseSha256": "a" * 64, "databaseRows": 6, "objectsSha256": "b" * 64, "objectCount": 1, "objectBytes": 19}
        result = {"format": "asa-realhost-guest-v1", "phase": "owner-cli-control", "status": "PASS",
                  "operatorUid": self.owner["uid"], "control": proof, "cliActions": []}
        child = Mock()
        child.__enter__ = Mock(return_value=child)
        child.__exit__ = Mock(return_value=False)
        child.wait.return_value = (0, json.dumps(result).encode())
        # One exactly representable clock keeps this contract independent of tick rounding.
        with patch.object(harness.time, "monotonic", return_value=1000.0):
            deadline = time.monotonic() + 60
            with patch.object(harness, "OwnedFaultProcess", return_value=child) as created:
                self.assertEqual(harness.cli_control_snapshot(self.owner, "before", deadline), proof)
            args, options = created.call_args
            self.assertEqual(options["owner"], self.owner)
            self.assertEqual(options["deadline"], deadline - 12)
            self.assertEqual(float(args[0][-1]), deadline - 16)
            self.assertLessEqual(child.wait.call_args.args[0], 48)
            for malformed in ({**proof, "secret": "PRIVATE_TOKEN_SENTINEL"}, {**proof, "databaseRows": True}):
                child.wait.return_value = (0, json.dumps({**result, "control": malformed}).encode())
                with patch.object(harness, "OwnedFaultProcess", return_value=child), self.assertRaisesRegex(harness.Failure, "CLI_CONTROL_CALLBACK"):
                    harness.cli_control_snapshot(self.owner, "after", time.monotonic() + 60)

    def test_callback_refuses_exhausted_budget_without_starting_a_process(self):
        with patch.object(harness, "OwnedFaultProcess") as created, self.assertRaisesRegex(harness.Failure, "CLI_CONTROL_DEADLINE"):
            harness.cli_control_snapshot(self.owner, "before", time.monotonic() + 10)
        created.assert_not_called()

    @unittest.skipUnless(os.name == "posix", "Initial Docker observations use Linux guest paths and credentials")
    def test_initial_info_and_inspect_drop_root_before_operator_plugin_discovery(self):
        class InspectionReached(Exception):
            pass
        calls, groups = [], [self.owner["gid"], 987]
        daemon = "fixture-daemon"
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory) / "operator-home"
            plugin = home / ".docker/cli-plugins/docker-probe"
            plugin.parent.mkdir(parents=True)
            plugin.write_text("#!/bin/sh\nexit 97\n")
            plugin.chmod(0o700)  # An adversarial HOME fixture; it is never executed.
            owner = {**self.owner, "home": str(home)}
            environment = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "HOME": str(home), "USER": owner["name"]}
            def popen(command, **options):
                self.assertEqual(command[0], "docker")
                calls.append((command, options))
                if command[1] == "inspect":
                    raise InspectionReached()
                self.assertIn(command[1], ("info", "ps"))
                raw = json.dumps({"id": daemon, "root": "/var/lib/docker"}).encode() if command[1] == "info" else b"a" * 64 + b"\n"
                options["stdout"].write(raw)
                return SimpleNamespace(returncode=0, poll=lambda: 0)
            with patch.object(harness.os, "geteuid", return_value=0), \
                    patch.object(harness.os, "getgrouplist", return_value=groups), \
                    patch.object(harness, "cli_trusted_bytes", return_value=json.dumps(self.context).encode()), \
                    patch.object(harness, "cli_trusted_module", return_value=object()), \
                    patch.object(harness, "cli_candidate_binding", return_value={"status": "VERIFIED"}), \
                    patch.object(harness, "diagnostic_owner", return_value=(owner, environment)), \
                    patch.object(harness, "cli_context_inputs", return_value=self.inputs), \
                    patch.object(harness, "root_json", return_value={"daemonIdentitySha256": hashlib.sha256(daemon.encode()).hexdigest()}), \
                    patch.object(harness, "switch_expected_files", return_value=["/srv/asa-lab/compose.yaml", "/srv/asa-lab/compose.production.yaml"]), \
                    patch.object(harness.subprocess, "Popen", side_effect=popen), \
                    self.assertRaises(InspectionReached):
                harness.installed_cli_read_guest(self.context)
            self.assertTrue(plugin.is_file())
            self.assertEqual([command[1] for command, _ in calls], ["info", "ps", "inspect"])
            for command, options in calls:
                with self.subTest(verb=command[1]):
                    self.assertEqual(options["env"]["HOME"], str(home))
                    self.assertNotIn("DOCKER_CONFIG", options["env"])
                    self.assertEqual((options.get("user"), options.get("group"), options.get("extra_groups")),
                                     (owner["uid"], owner["gid"], groups))
                    self.assertEqual(options["cwd"], "/")
                    self.assertEqual(options["env"]["DOCKER_HOST"], "unix:///var/run/docker.sock")
                    self.assertNotIn("start_new_session", options)

    def test_owned_callback_uses_native_credentials_without_changing_default_spawn(self):
        process = Mock(pid=12001)
        anchor = {"pid": process.pid, "pgid": process.pid, "sid": process.pid, "startTime": 123}
        for owner in (None, self.owner):
            with patch.object(harness, "native_proc_namespace", return_value=True), \
                    patch.object(harness, "proc_identity", return_value=anchor), \
                    patch.object(harness.os, "getgrouplist", return_value=[1001, 999], create=True) as groups, \
                    patch.object(harness.subprocess, "Popen", return_value=process) as popen:
                child = harness.OwnedFaultProcess(["/usr/bin/python3", "-I", "-B", "trusted.py"], environment={}, owner=owner)
                child.closed = True  # The Popen boundary is modeled; no process was created.
                child.close()
            options = popen.call_args.kwargs
            self.assertTrue(options["start_new_session"])
            self.assertEqual(options["cwd"], "/")
            self.assertNotIn("runuser", popen.call_args.args[0])
            if owner is None:
                groups.assert_not_called()
                self.assertFalse({"user", "group", "extra_groups"} & options.keys())
            else:
                groups.assert_called_once_with("asa-setup", owner["gid"])
                self.assertEqual((options["user"], options["group"], options["extra_groups"]),
                                 (owner["uid"], owner["gid"], [1001, 999]))


class CLIDefaultTargetTests(unittest.TestCase):
    def setUp(self):
        root = patch.object(harness, "INSTALL_ROOT", PurePosixPath("/srv/asa-lab"))
        root.start()
        self.addCleanup(root.stop)
        self.context, self.owner, self.inputs, self.paths, self.selections = cli_read_fixture()

    def expected(self):
        return harness.cli_fixture_context(cli_checks, self.context, self.owner, self.inputs, self.paths)[0]

    def selected_stable(self):
        target = self.context["cliDefaultTargetExpectation"]
        return {"ci": target["ci"], "deploymentDigest": target["deploymentDigest"], "manifestDigest": target["manifestDigest"],
            "release": {"format": "asa-deployment-v2", "repository": harness.REPOSITORY, "platform": "linux/amd64",
                        **{key: target[key] for key in ("revision", "schema", "images", "publicationRunId")}}}

    def test_pre_vm_selector_resolves_stable_independently_in_both_modes(self):
        for mode in ("candidate", "published"):
            selected = {**self.selections, "stable": self.selected_stable()}
            resolve = Mock(side_effect=[selected[name] for name in ("previous", "current", "stable")])
            output = io.StringIO()
            with self.subTest(mode=mode), patch.dict(sys.modules, {
                    "deployment.release_readonly": SimpleNamespace(resolve_release=resolve)}), \
                    patch.object(sys, "argv", ["selector", str(HERE.parent), mode]), \
                    patch.object(sys, "path", list(sys.path)), \
                    patch.object(sys, "stdin", SimpleNamespace(buffer=io.BytesIO(json.dumps(self.context["pins"]).encode()))), \
                    contextlib.redirect_stdout(output):
                exec(compile(harness.CLI_RELEASE_PROGRAM, "<pre-vm-release-selector>", "exec"), {})
            self.assertEqual([call.args for call in resolve.call_args_list], [
                (self.context["pins"]["previous"]["deploymentDigest"],),
                (self.context["pins"]["current"]["deploymentDigest"],), ()])
            self.assertEqual(json.loads(output.getvalue()), selected)

    def test_all_update_forms_bind_stable_and_reject_controlled_or_source_substitution(self):
        import test_realhost_cli_checks as examples
        expected = self.expected()
        target, controlled = self.context["cliDefaultTargetExpectation"], self.context["cliReleaseExpectations"]["current"]
        self.assertEqual((expected.target.revision, expected.target.schema, expected.target.images),
                         (target["revision"], target["schema"], target["images"]))
        self.assertEqual((expected.deployment_digest, expected.manifest_digest),
                         (target["deploymentDigest"], target["manifestDigest"]))
        self.assertEqual(expected.installed.revision, self.context["pins"]["previous"]["revision"])
        self.assertEqual(controlled["revision"], "959d52079d8c5659e86f084ad2453bd3eb68fe34")
        for command in ("update", "update check", "update plan"):
            document = examples.envelope(command, examples.update(expected))
            with self.subTest(command=command):
                cli_checks.check_read_result(command, document, returncode=0, expected=expected)
            for field, value, code in (
                    ("revision", controlled["revision"], "RELEASE_PIN_MISMATCH"),
                    ("revision", self.context["sourceRevision"], "RELEASE_PIN_MISMATCH"),
                    ("deploymentDigest", controlled["deploymentDigest"], "RELEASE_PIN_MISMATCH"),
                    ("manifestDigest", controlled["manifestDigest"], "RELEASE_PIN_MISMATCH"),
                    ("images", controlled["images"], "RELEASE_PIN_MISMATCH"),
                    ("schema", controlled["schema"], "SCHEMA_MISMATCH")):
                changed = copy.deepcopy(document)
                changed["target"][field] = value
                with self.subTest(command=command, field=field, value=value), self.assertRaisesRegex(cli_checks.CLIReadCheckError, code):
                    cli_checks.check_read_result(command, changed, returncode=0, expected=expected)

    def test_missing_or_malformed_default_never_falls_back_to_controlled_target(self):
        target = self.context.pop("cliDefaultTargetExpectation")
        with self.assertRaisesRegex(harness.Failure, "CLI_READ_DEFAULT_TARGET"):
            self.expected()
        for value in (None, [], {}, *({**target, **change} for change in (
                {"revision": self.context["sourceRevision"][:-1]}, {"revision": True}, {"schema": True},
                {"deploymentDigest": "stable"}, {"manifestDigest": None}, {"ci": "UNVERIFIED"},
                {"images": self.context["pins"]["current"]}, {"publicationRunId": False},
                {"selector": "from-cli"}, {"extra": "PRIVATE_TOKEN"}))):
            self.context["cliDefaultTargetExpectation"] = value
            with self.subTest(value=value), self.assertRaisesRegex(harness.Failure, "CLI_READ_DEFAULT_TARGET"):
                self.expected()

    def test_default_expectation_cannot_replace_controlled_or_published_setup_identity(self):
        original = copy.deepcopy(self.context)
        self.context["cliReleaseExpectations"]["current"] = copy.deepcopy(self.context["cliDefaultTargetExpectation"])
        with self.assertRaisesRegex(harness.Failure, "CLI_READ_RELEASE_PIN"):
            self.expected()
        for acquisition, code in ((None, "ACQUISITION_MODE_BINDING"), ({}, "ACQUISITION_MODE_BINDING"),
                ({**original["acquisition"], "approvedRevision": original["sourceRevision"]}, "ACQUISITION_MODE_BINDING"),
                ({**original["acquisition"], "sourceRevision": original["cliDefaultTargetExpectation"]["revision"]}, "ACQUISITION_MODE_BINDING"),
                ({**original["acquisition"], "mode": "published"}, "PUBLISHED_CONTEXT")):
            self.context = copy.deepcopy(original)
            self.context["acquisition"] = acquisition
            with self.subTest(acquisition=acquisition), self.assertRaisesRegex(harness.Failure, code):
                self.expected()
        published, _, _ = published_fixture()
        self.context = copy.deepcopy(original)
        self.context["acquisition"] = published["acquisition"]
        with self.assertRaisesRegex(harness.Failure, "CLI_READ_DEFAULT_TARGET"):
            self.expected()

    def materials(self, mode, *, stable_revision=None):
        runner = object.__new__(harness.HostRun)
        runner.args, runner.pins = SimpleNamespace(revision=self.context["sourceRevision"]), self.context["pins"]
        runner.acquisition = copy.deepcopy(self.context["acquisition"])
        if mode == "published":
            runner.acquisition = {"mode": mode, "approvedRevision": runner.args.revision, "sourceRevision": runner.args.revision}
        selected = {**self.selections, "stable": self.selected_stable()}
        selected["stable"]["release"]["revision"] = stable_revision or (
            runner.args.revision if mode == "published" else selected["stable"]["release"]["revision"])
        digest, helper = "a" * 64, b"# immutable published helper fixture\n"

        def command(arguments, **options):
            if arguments[0] == "gpgv":
                return 0, ("[GNUPG:] VALIDSIG " + runner.pins["ubuntu"]["signingFingerprint"] + "\n").encode()
            if arguments[:2] == ["git", "show"]:
                return 0, helper
            if arguments[:2] == ["age-keygen", "-y"]:
                return 0, fixture.RECIPIENT.encode()
            if arguments[:2] == ["age-keygen", "-o"]:
                return 0, b""
            if len(arguments) > 4 and arguments[4] == harness.CLI_RELEASE_PROGRAM:
                self.assertEqual(json.loads(options["source"]), runner.pins)
                return 0, json.dumps(selected).encode()
            self.assertEqual(arguments[1], "tools/deployment/setup_bundle.py")
            return 0, json.dumps({"revision": runner.args.revision, "sha256": digest, "attested": False}).encode()

        def download(url, destination, **options):
            if destination.name == "SHA256SUMS":
                destination.write_text(runner.pins["ubuntu"]["sha256"] + "  " + runner.pins["ubuntu"]["url"].rsplit("/", 1)[1] + "\n")
            return {"url": url, "sha256": options.get("expected", digest), "bytes": (
                harness.GH_PIN["bytes"] if destination.name == "github-cli.tar.gz" else runner.pins["onePanel"]["bytes"])}

        with tempfile.TemporaryDirectory() as temporary:
            runner.workspace, runner.source = Path(temporary), Path(temporary) / "source"
            runner.commands, runner.download = SimpleNamespace(run=Mock(side_effect=command)), Mock(side_effect=download)
            with patch.object(harness, "hash_file", side_effect=lambda path: (
                    hashlib.sha256(helper).hexdigest() if path.name == "asa_setup_acquire.py" else digest)), \
                    patch.object(harness, "cli_helper_hashes", return_value={name: digest for name in harness.CLI_HELPERS}):
                evidence = runner.materials()
            saved = json.loads((runner.workspace / "context.json").read_text())
        return runner, evidence, saved

    def test_materials_freeze_independent_default_without_changing_acquisition_or_controlled_pins(self):
        for mode in ("candidate", "published"):
            with self.subTest(mode=mode):
                runner, evidence, saved = self.materials(mode)
                self.assertEqual(saved, runner.context)
                self.assertEqual(saved["acquisition"]["mode"], mode)
                self.assertEqual(saved["acquisition"]["approvedRevision"], runner.args.revision if mode == "published" else "")
                self.assertIs(evidence["candidateBundle"]["attested"], False)
                self.assertEqual(evidence["candidateBundle"]["sourceOracleOnly"], mode == "published")
                self.assertEqual(evidence["defaultCliTarget"], saved["cliDefaultTargetExpectation"])
                self.assertEqual(evidence["defaultCliTarget"]["revision"], runner.args.revision if mode == "published"
                                 else self.context["cliDefaultTargetExpectation"]["revision"])
                self.assertEqual(saved["cliReleaseExpectations"], self.context["cliReleaseExpectations"])
                self.assertEqual(evidence["controlledUpdateTarget"], self.context["cliReleaseExpectations"]["current"])
                self.assertEqual(harness.guest_acquisition_mode(saved), mode)
                self.assertEqual(evidence["githubCliArchive"] is not None, mode == "published")

    def test_published_materials_reject_independent_stable_revision(self):
        with self.assertRaisesRegex(harness.Failure, "CLI_READ_DEFAULT_TARGET"):
            self.materials("published", stable_revision=self.context["cliDefaultTargetExpectation"]["revision"])


@unittest.skipUnless(os.name == "posix", "POSIX process and filesystem boundary")
class CLIReadNativeCommandTests(unittest.TestCase):
    def test_actual_harmless_child_uses_private_streams_and_supplied_cwd(self):
        raw = harness.cli_control_command([sys.executable, "-I", "-B", "-c", "import os; print(os.getcwd())"],
            deadline=time.monotonic() + 3, environment={"PATH": os.defpath}, cwd="/")
        self.assertEqual(raw.strip(), b"/")

    def test_actual_child_failure_never_exports_stderr_or_exception_text(self):
        with self.assertRaises(harness.Failure) as caught:
            harness.cli_control_command([sys.executable, "-I", "-B", "-c",
                "import sys; sys.stderr.write('PRIVATE_TOKEN_SENTINEL'); sys.exit(7)"],
                deadline=time.monotonic() + 3, environment={"PATH": os.defpath})
        self.assertEqual(caught.exception.code, "CLI_CONTROL_COMMAND")
        self.assertNotIn("PRIVATE_TOKEN_SENTINEL", str(caught.exception))

    def test_actual_timeout_is_bounded_and_child_is_reaped(self):
        started = time.monotonic()
        with self.assertRaisesRegex(harness.Failure, "CLI_CONTROL_TIMEOUT"):
            harness.cli_control_command([sys.executable, "-I", "-B", "-c", "import time; time.sleep(30)"],
                deadline=started + 0.15, environment={"PATH": os.defpath})
        self.assertLess(time.monotonic() - started, 2.5)


class FixtureRootStat:
    """Only the test fixture models root ownership; file type/link metadata stays real."""
    def __init__(self, original, *, directory):
        self.original = original
        self.st_uid = 0
        self.st_mode = original.st_mode & ~0o022 if directory else original.st_mode

    def __getattr__(self, name):
        return getattr(self.original, name)

    def __iter__(self):
        values = list(self.original)
        values[0], values[4] = self.st_mode, self.st_uid
        return iter(values)


@contextlib.contextmanager
def fixture_root_metadata(directory):
    original_fstat, original_lstat = os.fstat, Path.lstat
    paths = [directory, *directory.parents, *directory.rglob("*")]
    records = {(info.st_dev, info.st_ino): stat.S_ISDIR(info.st_mode)
               for info in (original_lstat(path) for path in paths)}
    def model(info):
        kind = records.get((info.st_dev, info.st_ino))
        return FixtureRootStat(info, directory=kind) if kind is not None else info
    with patch.object(harness.os, "fstat", side_effect=lambda fd: model(original_fstat(fd))), \
            patch.object(Path, "lstat", lambda path: model(original_lstat(path))):
        yield


@unittest.skipUnless(os.name == "posix", "Root ownership model and O_NOFOLLOW are POSIX")
class CLIReadTrustTests(unittest.TestCase):
    def test_safe_open_ignores_access_time_but_rejects_write_metadata_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root, calls = Path(directory), []
            source = root / "module.py"
            source.write_bytes(b"value = 7\n")
            source.chmod(0o644)
            inode = source.stat().st_ino
            class AccessChanged(FixtureRootStat):
                def __iter__(self):
                    values = list(super().__iter__())
                    values[7] += 1
                    return iter(values)
            for changed_field, accepted in (("st_atime_ns", True), ("st_mtime_ns", False)):
                calls.clear()
                with fixture_root_metadata(root):
                    modeled_fstat = harness.os.fstat
                    def observed(fd):
                        info = modeled_fstat(fd)
                        if info.st_ino == inode:
                            calls.append(True)
                            if len(calls) >= 3:
                                if changed_field == "st_atime_ns":
                                    info = AccessChanged(info.original, directory=False)
                                setattr(info, changed_field, getattr(info, changed_field) + 1000000000)
                        return info
                    with patch.object(harness.os, "fstat", side_effect=observed):
                        if accepted:
                            self.assertEqual(harness.cli_trusted_bytes(source), b"value = 7\n")
                        else:
                            with self.assertRaisesRegex(harness.Failure, "CLI_READ_TRUST"):
                                harness.cli_trusted_bytes(source)

    def test_real_safe_open_rejects_links_wrong_mode_size_and_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "module.py"
            source.write_text("value = 7\n")
            source.chmod(0o644)
            with fixture_root_metadata(root):
                self.assertEqual(harness.cli_trusted_bytes(source), b"value = 7\n")
                with self.assertRaisesRegex(harness.Failure, "CLI_READ_TRUST"):
                    harness.cli_trusted_bytes(source, maximum=3)
                with self.assertRaisesRegex(harness.Failure, "CLI_READ_TRUST"):
                    harness.cli_trusted_bytes(root / ".." / source.name)
                link = root / "symlink.py"
                link.symlink_to(source)
                with self.assertRaisesRegex(harness.Failure, "CLI_READ_TRUST"):
                    harness.cli_trusted_bytes(link)
                hard = root / "hard.py"
                os.link(source, hard)
                with self.assertRaisesRegex(harness.Failure, "CLI_READ_TRUST"):
                    harness.cli_trusted_bytes(source)
                hard.unlink()
                source.chmod(0o666)
                with self.assertRaisesRegex(harness.Failure, "CLI_READ_TRUST"):
                    harness.cli_trusted_bytes(source)

    def test_trusted_import_rejects_wrong_hash_before_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            module = root / "realhost_cli_checks.py"
            module.write_text("raise RuntimeError('PRIVATE_TOKEN_SENTINEL')\n")
            module.chmod(0o644)
            context = {"cliHelperSha256": {name: "f" * 64 for name in harness.CLI_HELPERS}}
            with patch.object(harness, "GUEST_HOME", root), fixture_root_metadata(root), \
                    self.assertRaisesRegex(harness.Failure, "CLI_READ_TRUST"):
                harness.cli_trusted_module(module.name, context)

    def test_actual_isolated_import_registers_dataclass_module_and_ignores_hostile_cwd(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "realhost_cli_checks.py"
            source.write_text("from dataclasses import dataclass\n@dataclass\nclass Probe:\n    value: int\n")
            source.chmod(0o644)
            (root / "json.py").write_text("raise RuntimeError('PRIVATE_TOKEN_SENTINEL')\n")
            program = (
                "import importlib.util, pathlib, sys\n"
                "spec=importlib.util.spec_from_file_location('cli_trust_fixture',sys.argv[1])\n"
                "tests=importlib.util.module_from_spec(spec)\n"
                "sys.modules[spec.name]=tests\n"
                "spec.loader.exec_module(tests)\n"
                "root=pathlib.Path(sys.argv[2]); tests.harness.GUEST_HOME=root\n"
                "context={'cliHelperSha256':{name:sys.argv[3] for name in tests.harness.CLI_HELPERS}}\n"
                "with tests.fixture_root_metadata(root):\n"
                "    loaded=tests.harness.cli_trusted_module('realhost_cli_checks.py',context)\n"
                "assert loaded.Probe(7).value == 7\n"
                "print('TRUSTED_IMPORT_OK')\n"
            )
            result = subprocess.run([sys.executable, "-I", "-B", "-c", program, str(Path(__file__).resolve()),
                str(root), hashlib.sha256(source.read_bytes()).hexdigest()], cwd=root,
                env={"PATH": os.defpath, "PYTHONPATH": str(root), "PYTHONHOME": str(root)},
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
            self.assertEqual(result.stdout, b"TRUSTED_IMPORT_OK\n")
            self.assertEqual(result.stderr, b"")
            self.assertFalse((root / "__pycache__").exists())

    def bundle(self, root):
        context = {"sourceRevision": "d" * 40}
        public, private = root / "public", root / "private"
        public.mkdir(mode=0o755)
        private.mkdir(mode=0o700)
        source_root = HERE.parents[1]
        names = setup_bundle.REQUIRED | {"tools/deployment/" + name for name in harness.CLI_HELPERS}
        files = {name: (source_root / name).read_bytes() for name in names}
        archive, manifest = setup_bundle.make_archive(files, context["sourceRevision"])
        context["bundleSha256"] = hashlib.sha256(archive).hexdigest()
        context["cliHelperSha256"] = {name: hashlib.sha256(files["tools/deployment/" + name]).hexdigest()
                                      for name in harness.CLI_HELPERS}
        (private / "candidate.tar.gz").write_bytes(archive)
        (private / "candidate.tar.gz").chmod(0o600)
        bundle = root / context["sourceRevision"]
        for name, raw in {**files, "setup-bundle.json": json.dumps(manifest).encode()}.items():
            path = bundle / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
            path.chmod(0o755 if name.endswith(".sh") else 0o644)
        registry = public / "commands.json"
        registry.write_text(json.dumps({"format": "asa-command-v1", "preparedBundle": str(bundle), "installations": [
            {"root": str(harness.INSTALL_ROOT), "project": "asa-lab-dev", "profile": "production", "bundle": str(bundle)}]}))
        registry.chmod(0o644)
        wrapper = public / "asa"
        wrapper.write_text("#!/bin/sh\n# ASA Lab verified setup CLI; use the official pinned bundle only.\n"
            "PATH=/usr/sbin:/usr/bin:/sbin:/bin; export PATH\n"
            "unset PYTHONPATH PYTHONHOME LD_PRELOAD LD_LIBRARY_PATH ENV BASH_ENV\n"
            "exec /usr/bin/python3 -I -B " + harness.shlex.quote(str(bundle / "tools/asa_cli.py")) + ' "$@"\n')
        wrapper.chmod(0o755)
        return context, private, bundle, registry, wrapper

    def test_real_archive_binding_rejects_changed_bytes_extra_module_registry_and_wrapper(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            context, private, bundle, registry, wrapper = self.bundle(root)
            read = harness.cli_trusted_bytes
            def mapped(path, **options):
                path = {"/etc/asa-lab/commands.json": registry, "/usr/local/bin/asa": wrapper}.get(str(path), path)
                return read(path, **options)
            with fixture_root_metadata(root), patch.object(harness, "GUEST_PRIVATE", private), \
                    patch.object(harness, "candidate_bundle", return_value=bundle), \
                    patch.object(harness, "cli_trusted_bytes", side_effect=mapped):
                proof = harness.cli_candidate_binding(context, setup_bundle)
                self.assertEqual(proof["status"], "VERIFIED")
                original = (bundle / "tools/asa_cli.py").read_bytes()
                (bundle / "tools/asa_cli.py").write_bytes(original + b"\n")
                with self.assertRaisesRegex(harness.Failure, "CLI_READ_BUNDLE"):
                    harness.cli_candidate_binding(context, setup_bundle)
                (bundle / "tools/asa_cli.py").write_bytes(original)
                extra = bundle / "extra.py"
                extra.write_text("value = 1\n")
                with self.assertRaisesRegex(harness.Failure, "CLI_READ_BUNDLE"):
                    harness.cli_candidate_binding(context, setup_bundle)
                extra.unlink()
                saved = registry.read_text()
                registry.write_text(saved.replace("asa-lab-dev", "foreign-project"))
                with self.assertRaisesRegex(harness.Failure, "CLI_READ_REGISTRATION"):
                    harness.cli_candidate_binding(context, setup_bundle)
                registry.write_text(saved)
                wrapper.write_text(wrapper.read_text().replace("-I -B", "-B"))
                with self.assertRaisesRegex(harness.Failure, "CLI_READ_REGISTRATION"):
                    harness.cli_candidate_binding(context, setup_bundle)
                with self.assertRaisesRegex(harness.Failure, "CLI_READ_BUNDLE"):
                    harness.cli_candidate_binding({**context, "bundleSha256": "f" * 64}, setup_bundle)


class CLIReadControlTests(unittest.TestCase):
    def setUp(self):
        root = patch.object(harness, "INSTALL_ROOT", PurePosixPath("/srv/asa-lab"))
        root.start()
        self.addCleanup(root.stop)
        self.context, self.owner, self.inputs, self.paths, _ = cli_read_fixture()

    def rows(self):
        identities, rows = {}, {}
        for index, table in enumerate(harness.TABLES, 1):
            identity = str(index) * 8 + "-aaaa-bbbb-cccc-" + str(index) * 12
            identities[table] = [identity]
            rows[table] = [{"id": identity, "value": "PRIVATE_TOKEN_SENTINEL"}]
        rows["project_drafts"] = [{"project_id": identities["projects"][0], "value": "CONTROL_DRAFT"}]
        return identities, rows

    def test_control_rows_hash_actual_complete_records_and_reject_missing_or_foreign_ids(self):
        identities, values = self.rows()
        proof = harness.cli_rows_projection(json.dumps(values).encode(), identities)
        self.assertEqual(sum(item["rows"] for item in proof.values()), 6)
        self.assertNotIn("PRIVATE_TOKEN_SENTINEL", json.dumps(proof))
        self.assertEqual(proof["accounts"]["sha256"], harness.canonical_hash(values["accounts"]))
        values["project_drafts"] = []
        with self.assertRaisesRegex(harness.Failure, "CLI_CONTROL_ROWS"):
            harness.cli_rows_projection(json.dumps(values).encode(), identities)

    def test_owner_callback_has_one_read_only_sql_snapshot_and_exact_measured_s3_fields(self):
        identities, values = self.rows()
        rows = harness.cli_rows_projection(json.dumps(values).encode(), identities)
        content = b"independent-control-object"
        saved = {"ids": identities, "fingerprint": {"rows": rows, "authenticatedS3Sha256": hashlib.sha256(content).hexdigest()}}
        config = self.inputs["config"]
        module = SimpleNamespace(load_config=Mock(return_value=config), private_json=Mock(return_value=saved))
        install = SimpleNamespace(process_env={"POSTGRES_PASSWORD": "PRIVATE_TOKEN_SENTINEL"},
                                  env={"POSTGRES_USER": "fixture_owner", "POSTGRES_DB": "fixture_database"})
        prepared = {"format": "asa-realhost-cli-control-v1", "sourceRevision": self.context["sourceRevision"],
                    "operatorUid": self.owner["uid"], "daemonIdentitySha256": "f" * 64}
        deadline = time.monotonic() + 40
        with patch.object(harness.os, "geteuid", return_value=self.owner["uid"], create=True), \
                patch.object(harness, "product_modules", return_value=(module, None, None, Mock(return_value=install), object())), \
                patch.object(harness, "cli_trusted_bytes", return_value=json.dumps(prepared).encode()), \
                patch.object(harness, "cli_storage_observation", return_value=(self.paths, {"postgres": "a" * 64})) as storage, \
                patch.object(harness, "cli_control_command", return_value=json.dumps(values).encode()) as sql, \
                patch.object(harness, "cli_s3_read", return_value=content) as s3:
            result = harness.owner_cli_control(self.context, deadline)
        self.assertEqual(result["control"], {"databaseSha256": harness.canonical_hash(rows), "databaseRows": 6,
            "objectsSha256": hashlib.sha256(content).hexdigest(), "objectCount": 1, "objectBytes": len(content)})
        self.assertEqual(storage.call_args.kwargs["deadline"], deadline - 10)
        self.assertEqual(sql.call_args.kwargs["deadline"], deadline - 10)
        self.assertEqual(s3.call_args.kwargs["deadline"], deadline)
        command = sql.call_args.args[0]
        self.assertTrue(any("default_transaction_read_only=on" in part and "statement_timeout=" in part for part in command))
        statement = sql.call_args.kwargs["source"].decode()
        self.assertTrue(statement.startswith("SELECT json_build_object("))
        self.assertEqual(statement.count(";"), 1)
        self.assertNotIn("PRIVATE_TOKEN_SENTINEL", statement + json.dumps(command) + json.dumps(result))

    def test_storage_probe_requires_operator_uid_or_matching_explicit_owner_before_spawn(self):
        images = self.context["cliReleaseExpectations"]["previous"]["images"]
        for uid, owner in ((self.owner["uid"], None), (self.owner["uid"], {**self.owner, "uid": 1002}),
                           (self.owner["uid"], {**self.owner, "uid": True}), (True, self.owner), (0, self.owner)):
            with self.subTest(uid=uid, owner_uid=None if owner is None else owner["uid"]), \
                    patch.object(harness.os, "geteuid", return_value=0, create=True), \
                    patch.object(harness.subprocess, "Popen") as spawned, \
                    self.assertRaisesRegex(harness.Failure, "CLI_CONTROL_OWNER"):
                harness.cli_storage_observation(self.inputs["config"], images, uid, owner=owner,
                    deadline=time.monotonic() + 8, environment={"HOME": self.owner["home"]}, daemon_identity="f" * 64)
            spawned.assert_not_called()

    def test_control_command_rejects_invalid_drop_credentials_before_spawn(self):
        owners = ({**self.owner, "uid": 0}, {**self.owner, "uid": True}, {**self.owner, "gid": 0},
                  {**self.owner, "gid": True}, {**self.owner, "name": "root"}, {})
        for owner in owners:
            with self.subTest(owner=owner), patch.object(harness.subprocess, "Popen") as spawned, \
                    patch.object(harness.os, "getgrouplist", create=True) as groups, \
                    self.assertRaisesRegex(harness.Failure, "CLI_CONTROL_OWNER"):
                harness.cli_control_command(["docker", "info"], deadline=time.monotonic() + 8,
                    environment={"HOME": self.owner["home"]}, owner=owner)
            spawned.assert_not_called()
            groups.assert_not_called()

    def test_credential_drop_failure_is_preserved_without_root_retry_and_deadline_prevents_spawn(self):
        original = PermissionError("PRIVATE_TOKEN_SENTINEL")
        with patch.object(harness.os, "getgrouplist", return_value=[1001, 987], create=True), \
                patch.object(harness.subprocess, "Popen", side_effect=original) as spawned:
            with self.assertRaises(PermissionError) as caught:
                harness.cli_control_command(["docker", "info"], deadline=time.monotonic() + 8,
                    environment={"HOME": self.owner["home"]}, owner=self.owner)
            self.assertIs(caught.exception, original)
            spawned.assert_called_once()
            self.assertEqual(spawned.call_args.kwargs["user"], self.owner["uid"])
            spawned.reset_mock()
            with self.assertRaisesRegex(harness.Failure, "CLI_CONTROL_TIMEOUT"):
                harness.cli_control_command(["docker", "info"], deadline=time.monotonic() - 1,
                    environment={"HOME": self.owner["home"]}, owner=self.owner)
            spawned.assert_not_called()

    @unittest.skipUnless(os.name == "posix", "Docker volume paths are native Linux guest paths")
    def test_storage_paths_bind_to_daemon_project_service_working_directory_and_images(self):
        images = self.context["cliReleaseExpectations"]["previous"]["images"]
        files = ["/srv/asa-lab/compose.yaml", "/srv/asa-lab/compose.production.yaml"]
        foreign = False
        def read(command, **options):
            if command[1] == "info":
                return b'{"id":"fixture-daemon","root":"/var/lib/docker"}'
            if command[1] == "ps":
                return (("a" if command[-1].endswith("postgres") else "b") * 64 + "\n").encode()
            self.assertEqual(command[1], "inspect")
            service = "postgres" if command[-1] == "a" * 64 else "minio"
            return json.dumps({"id": command[-1], "project": "asa-lab-dev", "service": service,
                "root": "/srv/foreign" if foreign else str(harness.INSTALL_ROOT), "files": ",".join(files), "oneoff": "False",
                "image": "postgres:17.7-bookworm" if service == "postgres" else images[service],
                "mounts": [{"Destination": "/var/lib/postgresql/data" if service == "postgres" else "/data",
                            "Type": "volume", "Source": self.paths[service]}]}).encode()
        options = {"deadline": time.monotonic() + 60, "environment": {},
                   "daemon_identity": hashlib.sha256(b"fixture-daemon").hexdigest()}
        with patch.object(harness.os, "geteuid", return_value=self.owner["uid"], create=True), \
                patch.object(harness, "cli_control_command", side_effect=read), patch.object(harness, "switch_expected_files", return_value=files):
            paths, selected = harness.cli_storage_observation(self.inputs["config"], images, self.owner["uid"], **options)
            self.assertEqual(paths, self.paths)
            self.assertEqual(selected, {"postgres": "a" * 64, "minio": "b" * 64})
            foreign = True
            with self.assertRaisesRegex(harness.Failure, "CLI_READ_STORAGE"):
                harness.cli_storage_observation(self.inputs["config"], images, self.owner["uid"], **options)

    def s3_read(self, *, foreign=False, original_failure=None):
        nonce, container = "e" * 32, "a" * 64
        name, calls, scans = "asa-realhost-cli-read-" + nonce, [], []
        install = SimpleNamespace(process_env={"SECRET": "PRIVATE_TOKEN_SENTINEL"},
            compose_args=["docker", "compose", "--project-directory", str(harness.INSTALL_ROOT), "-p", "asa-lab-dev"])
        helpers = SimpleNamespace(OBJECT_NAME="control-object.txt", OBJECT_CONTENT="control-object-content")
        deadline = time.monotonic() + 30
        def command(arguments, **options):
            calls.append(arguments)
            self.assertLessEqual(options["deadline"], deadline)
            self.assertNotIn("PRIVATE_TOKEN_SENTINEL", json.dumps(arguments))
            if arguments[1] == "ps":
                scans.append(True)
                return (container + "\n").encode() if len(scans) == 2 else b""
            if arguments[1] == "compose":
                self.assertIn("--rm", arguments)
                self.assertIn("asa.realhost.control-read=" + nonce, arguments)
                self.assertNotIn("mc pipe", arguments[-1])
                if original_failure:
                    raise original_failure
                return helpers.OBJECT_CONTENT.encode()
            if arguments[1] == "inspect":
                return json.dumps({"id": container, "name": "/" + name,
                    "image": self.context["cliReleaseExpectations"]["previous"]["images"]["minio"],
                    "nonce": "f" * 32 if foreign else nonce, "project": "asa-lab-dev", "root": str(harness.INSTALL_ROOT)}).encode()
            self.assertEqual(arguments, ["docker", "rm", "-f", container])
            return b""
        with patch.object(harness.uuid, "uuid4", return_value=SimpleNamespace(hex=nonce)), \
                patch.object(harness, "cli_control_command", side_effect=command):
            try:
                result = harness.cli_s3_read(install, helpers, self.context, deadline=deadline)
            except BaseException as error:
                return None, calls, error
        return result, calls, None

    def test_ephemeral_s3_reader_removes_only_the_exact_nonce_bound_container(self):
        value, calls, error = self.s3_read()
        self.assertIsNone(error)
        self.assertEqual(value, b"control-object-content")
        self.assertEqual([command for command in calls if command[1] == "rm"], [["docker", "rm", "-f", "a" * 64]])

    def test_ephemeral_cleanup_refuses_foreign_identity_and_preserves_original_failure(self):
        value, calls, error = self.s3_read(foreign=True)
        self.assertIsNone(value)
        self.assertEqual(error.code, "CLI_CONTROL_CLEANUP")
        self.assertFalse(any(command[1] == "rm" for command in calls))
        original = harness.Failure("CLI_CONTROL_COMMAND")
        _, calls, error = self.s3_read(foreign=True, original_failure=original)
        self.assertIs(error, original)
        self.assertTrue(error.owned_cleanup_failed)
        self.assertFalse(any(command[1] == "rm" for command in calls))

    def test_helper_hashes_are_bound_to_exact_git_bytes_before_delivery(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "tools/deployment"
            folder.mkdir(parents=True)
            for name in harness.CLI_HELPERS:
                (folder / name).write_bytes(b"verified-source-file\n")
            commands = SimpleNamespace(run=Mock(return_value=(0, b"verified-source-file\n")))
            hashes = harness.cli_helper_hashes(root, "a" * 40, commands)
            self.assertEqual(set(hashes), set(harness.CLI_HELPERS))
            for call in commands.run.call_args_list:
                self.assertTrue(call.args[0][2].startswith("a" * 40 + ":tools/deployment/"))
                self.assertEqual(call.kwargs["timeout"], 30)
            (folder / harness.CLI_HELPERS[0]).write_bytes(b"changed-source-file\n")
            with self.assertRaisesRegex(harness.Failure, "CLI_READ_SOURCE"):
                harness.cli_helper_hashes(root, "a" * 40, commands)

    def test_stage_delivers_all_hashed_helpers_with_root_public_modes(self):
        runner = object.__new__(harness.HostRun)
        runner.source = HERE.parents[1]
        runner.context = {"sourceRevision": "d" * 40, "acquisition": {
            "mode": "candidate", "approvedRevision": "", "sourceRevision": "d" * 40}}
        runner.vm = SimpleNamespace(ssh=Mock(), upload=Mock())
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"GH_TOKEN": "PRIVATE_TOKEN_SENTINEL"}):
            runner.workspace = Path(directory)
            for name in ("context.json", "candidate.tar.gz", "onepanel.tar.gz"):
                (runner.workspace / name).write_bytes(b"synthetic-stage-input\n")
            result = runner.stage_guest()
            self.assertFalse((runner.workspace / "github-read-token").exists())
        names = {call.args[1].rsplit("/", 1)[-1] for call in runner.vm.upload.call_args_list}
        self.assertTrue(set(harness.CLI_HELPERS) <= names)
        instructions = " ".join(call.args[0] for call in runner.vm.ssh.call_args_list)
        self.assertIn("sudo install -m 644", instructions)
        self.assertIn("realhost_cli_runtime.py /opt/asa-realhost/", instructions)
        self.assertNotIn("PRIVATE_TOKEN_SENTINEL", instructions + json.dumps(result))

    def test_guest_phase_keeps_partial_runtime_failure_in_public_evidence(self):
        proof = {"status": "FAIL", "reasonCode": "CLI_SEMANTICS",
                 "cliReadEvidence": {"status": "FAIL", "failedCase": "update", "semanticCode": "RELEASE_PIN_MISMATCH"}}
        with patch.object(harness, "guest_guard", return_value=self.context), \
                patch.object(harness, "guest_phase", return_value=proof), patch.object(harness, "CLI_ACTIONS", []), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            code = harness.guest_main("cli-read")
        value = json.loads(output.getvalue())
        self.assertEqual(code, 1)
        self.assertEqual(value["status"], "FAIL")
        self.assertEqual(value["cliReadEvidence"], proof["cliReadEvidence"])


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

    @unittest.skipUnless(sys.platform == "linux", "Native WNOWAIT ownership checks require Linux waitid and process groups")
    def test_exited_leader_remains_waitable_at_every_cleanup_signal_then_is_reaped(self):
        signals, native_killpg = [], os.killpg
        def signal_owned(pid, number):
            observed = os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
            self.assertIsNotNone(observed)
            self.assertEqual(observed.si_pid, pid)
            self.assertEqual((os.getpgid(pid), os.getsid(pid)), (pid, pid))
            signals.append((pid, number))
            native_killpg(pid, number)
        with patch.object(harness.os, "killpg", side_effect=signal_owned):
            result, raw = harness.diagnostic_command([sys.executable, "-I", "-c", "raise SystemExit(7)"],
                timeout=3, environment={"PATH": "/usr/bin:/bin"})
        self.assertEqual(result.get("exitCode"), 7)
        self.assertNotIn("reasonCode", result)
        self.assertEqual(raw, b"")
        self.assertEqual([number for _, number in signals], [signal.SIGTERM, signal.SIGKILL])
        with self.assertRaises(ChildProcessError):
            os.waitid(os.P_PID, signals[0][0], os.WEXITED | os.WNOHANG | os.WNOWAIT)

    @unittest.skipUnless(sys.platform == "linux", "Native descendant cleanup requires Linux fork, WNOWAIT and process groups")
    def test_descendant_retaining_pipes_is_killed_before_leader_reap(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "descendant-survived"
            script = ("import os,signal,sys,time\n"
                "if os.fork()==0:\n"
                " signal.signal(signal.SIGTERM,signal.SIG_IGN)\n"
                " print('child-ready',flush=True)\n"
                " time.sleep(1)\n"
                " open(sys.argv[1],'w').write('unexpected')\n"
                " os._exit(0)\n"
                "os._exit(7)\n")
            signals, native_killpg = [], os.killpg
            def signal_owned(pid, number):
                observed = os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
                self.assertIsNotNone(observed)
                self.assertEqual(observed.si_pid, pid)
                signals.append(number)
                native_killpg(pid, number)
            started = time.monotonic()
            with patch.object(harness.os, "killpg", side_effect=signal_owned):
                result, raw = harness.diagnostic_command([sys.executable, "-I", "-c", script, str(marker)],
                    timeout=0.25, environment={"PATH": "/usr/bin:/bin"})
            self.assertLess(time.monotonic() - started, 5)
            self.assertEqual(result.get("reasonCode"), "DIAGNOSTIC_TIMEOUT")
            self.assertEqual(result.get("exitCode"), 7)
            self.assertIn(b"child-ready", raw)
            self.assertEqual(signals, [signal.SIGTERM, signal.SIGKILL])
            time.sleep(1.1)
            self.assertFalse(marker.exists())

    @unittest.skipUnless(sys.platform == "linux", "Native nested probes signal a direct Linux child without its inherited group")
    def test_nested_probe_never_signals_its_inherited_process_group(self):
        signals, native_kill = [], os.kill
        def signal_owned(pid, number):
            self.assertIsNotNone(os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT))
            signals.append(number)
            native_kill(pid, number)
        with patch.object(harness.os, "killpg") as group, patch.object(harness.os, "kill", side_effect=signal_owned):
            result, _ = harness.diagnostic_command([sys.executable, "-I", "-c", "raise SystemExit(4)"],
                timeout=3, environment={"PATH": "/usr/bin:/bin"}, own_group=False)
        self.assertEqual(result.get("exitCode"), 4)
        self.assertEqual(signals, [signal.SIGTERM, signal.SIGKILL])
        group.assert_not_called()

    def test_unproven_or_already_reaped_child_is_never_signalled(self):
        for returncode in (None, 0):
            process = SimpleNamespace(pid=12345, returncode=returncode, stdout=io.BytesIO(), stderr=io.BytesIO())
            with self.subTest(returncode=returncode), patch.object(harness.sys, "platform", "linux"), \
                    patch.object(harness.subprocess, "Popen", return_value=process), \
                    patch.object(harness.os, "WNOWAIT", 0x1000000, create=True), \
                    patch.object(harness.os, "P_PID", 1, create=True), \
                    patch.object(harness.os, "WEXITED", 4, create=True), \
                    patch.object(harness.os, "WNOHANG", 1, create=True), \
                    patch.object(harness.os, "waitid", side_effect=ChildProcessError("PRIVATE"), create=True) as waited, \
                    patch.object(harness.os, "killpg", create=True) as group, patch.object(harness.os, "kill") as child:
                result, raw = harness.diagnostic_command(["synthetic"], timeout=1, environment={})
            self.assertEqual(result["reasonCode"], "DIAGNOSTIC_PROCESS_OWNERSHIP")
            self.assertLessEqual(waited.call_count, 1)  # Lost authority is never reacquired in finally.
            group.assert_not_called()
            child.assert_not_called()
            self.assertNotIn("PRIVATE", json.dumps(result))
            self.assertEqual(raw, b"")

    def test_cleanup_reason_projection_is_closed_and_preserves_primary_failure(self):
        for cleanup in ("DIAGNOSTIC_PROCESS_OWNERSHIP", "DIAGNOSTIC_PROCESS_CLEANUP", "PRIVATE"):
            observed = harness.diagnostic_command_projection({"reasonCode": "DIAGNOSTIC_TIMEOUT",
                "cleanupReasonCode": cleanup, "stdout": "PRIVATE", "stderr": "PRIVATE"})
            self.assertEqual(observed["reasonCode"], "DIAGNOSTIC_TIMEOUT")
            self.assertEqual("cleanupReasonCode" in observed, cleanup != "PRIVATE")
            self.assertNotIn("PRIVATE", json.dumps(observed))

    @unittest.skipUnless(sys.platform == "linux", "Native cleanup-error preservation requires a directly owned Linux child")
    def test_cleanup_error_does_not_replace_original_timeout_or_leak_message(self):
        children, native_popen, native_killpg = [], subprocess.Popen, os.killpg
        def spawn(*args, **kwargs):
            child = native_popen(*args, **kwargs)
            children.append(child)
            return child
        def sent_then_failed(pid, number):
            os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
            native_killpg(pid, number)
            raise PermissionError("PRIVATE")
        try:
            with patch.object(harness.subprocess, "Popen", side_effect=spawn), \
                    patch.object(harness.os, "killpg", side_effect=sent_then_failed):
                result, _ = harness.diagnostic_command([sys.executable, "-I", "-c", "import time; time.sleep(10)"],
                    timeout=0.15, environment={"PATH": "/usr/bin:/bin"})
            self.assertEqual(result["reasonCode"], "DIAGNOSTIC_TIMEOUT")
            self.assertEqual(result["cleanupReasonCode"], "DIAGNOSTIC_PROCESS_CLEANUP")
            self.assertNotIn("PRIVATE", json.dumps(result))
        finally:
            for child in children:
                child.wait(timeout=2)  # TERM above was delivered; test reaps its retained harmless child.

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


class ControlBrowserDiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.root = patch.object(harness, "INSTALL_ROOT", PurePosixPath("/srv/asa-lab"))
        self.root.start()
        self.addCleanup(self.root.stop)
        self.context = {"pins": harness.pin_manifest(HERE / "fixtures/setup-realhost-pins.json")}
        self.operation, self.instance = "c" * 32, "a" * 32
        self.browser = {"fixturePath": str(harness.INSTALL_ROOT / ".asa/acceptance/realhost-control.json"),
                        "componentSha256": self.context["pins"]["browser"]["componentSha256"]}
        self.install = SimpleNamespace(settings={"instanceId": self.instance})
        self.secret = "PRIVATE_CREDENTIAL_NEVER_REPORT"

    def report(self, phase="BEFORE", *, status="failed", runtime=True):
        target = self.context["pins"]["previous" if phase == "BEFORE" else "current"]
        value = {"format": "asa-setup-acceptance-v1", "kind": "browser",
                 "operationId": self.operation, "installationId": self.instance, "instanceId": self.instance,
                 "status": status, "reasonCode": "BROWSER_USER_FLOW_FAILED" if status == "failed" else "BROWSER_ENVIRONMENT_FAILED",
                 "checks": {name: "failed" if status == "failed" else "not_run" for name in harness.RECEIPT_BROWSER_CHECKS}}
        if runtime:
            value.update(revision=target["revision"], entryOrigin=harness.ORIGIN, invocationId="d" * 32,
                         componentSha256=self.context["pins"]["browser"]["componentSha256"],
                         componentRevision=self.context["pins"]["browser"]["opsRevision"])
        if status == "failed":
            value["error"] = {"stage": "blocks_save", "code": "SAVE_NOT_OBSERVED"}
        return value

    def project(self, value, phase="BEFORE", **changes):
        arguments = {"phase": phase, "operation_id": self.operation, "instance_id": self.instance,
                     "browser": self.browser, "release": self.context["pins"]["previous" if phase == "BEFORE" else "current"],
                     "context": self.context}
        arguments.update(changes)
        return harness.control_browser_projection(value, **arguments)

    @contextlib.contextmanager
    def owner(self, phase, value):
        saved = {"ids": {}, "fingerprint": {"known": True}, "browser": self.browser}
        config_module = SimpleNamespace(private_json=Mock(return_value=saved), save_private=Mock())
        acceptance = SimpleNamespace(browser_acceptance=Mock(return_value=value))
        config = {"installationId": "e" * 32, "browser": {**self.browser, "fixturePath": "/srv/asa-lab/.asa/acceptance/fixture.json"}}
        release = self.context["pins"]["previous" if phase == "BEFORE" else "current"]
        with patch.object(harness, "owner_installation", return_value=(config_module, acceptance, None, self.install, None, config, release)), \
                patch.object(harness, "control_rows", return_value=({}, {})) as rows, \
                patch.object(harness, "control_fingerprint", return_value=saved["fingerprint"]) as fingerprint, \
                patch.object(harness, "s3_command") as s3, \
                patch.object(harness.uuid, "uuid4", return_value=SimpleNamespace(hex=self.operation)) as identifier:
            yield SimpleNamespace(config_module=config_module, acceptance=acceptance, config=config, saved=saved,
                                  release=release, rows=rows, fingerprint=fingerprint, s3=s3, identifier=identifier)

    def owner_json(self, phase, value):
        name = "owner-seed" if phase == "BEFORE" else "owner-final"
        output = io.StringIO()
        with self.owner(phase, value), patch.object(harness, "guest_guard", return_value=self.context), \
                patch.object(harness.os, "geteuid", create=True, return_value=1001), \
                patch.object(harness, "CLI_ACTIONS", []), contextlib.redirect_stdout(output):
            code = harness.guest_main(name)
        return code, json.loads(output.getvalue())

    def relay(self, phase, code, child):
        name = "owner-seed" if phase == "BEFORE" else "owner-final"
        account = SimpleNamespace(pw_name="asa-setup", pw_dir="/var/lib/asa-setup/operator")
        with patch.dict(sys.modules, {"pwd": SimpleNamespace(getpwnam=Mock(return_value=account))}), \
                patch.object(harness.Commands, "run", return_value=(code, json.dumps(child).encode())) as command:
            with self.assertRaises(harness.Failure) as caught:
                harness.owner_call(name, timeout=73)
        self.assertEqual(command.call_args.kwargs["timeout"], 73)
        self.assertEqual(command.call_args.kwargs["allowed"], (0, 1, 2))
        self.assertEqual(command.call_args.args[0][:5], ["runuser", "-u", "asa-setup", "--", "/usr/bin/python3"])
        return caught.exception

    def test_direct_before_and_after_binding_omits_private_identifiers(self):
        for phase in ("BEFORE", "AFTER"):
            with self.subTest(phase=phase):
                value = self.project(self.report(phase), phase)
                self.assertEqual(value["binding"], "DIRECT_INVOCATION")
                self.assertEqual(value["phase"], phase)
                self.assertEqual(value["target"], "PREVIOUS_RUNTIME" if phase == "BEFORE" else "CURRENT_RUNTIME")
                self.assertEqual(value["fixtureArgument"], "REALHOST_CONTROL")
                self.assertEqual(value["runtimeProvenance"], "PINNED_INVOCATION")
                for private in (self.operation, self.instance, "d" * 32, harness.ORIGIN, self.browser["fixturePath"],
                                self.context["pins"]["browser"]["componentSha256"], self.context["pins"]["browser"]["opsRevision"]):
                    self.assertNotIn(private, json.dumps(value))
                self.assertNotIn("VERIFIED_PARENT_OPERATION", json.dumps(value))

    def test_replayed_or_foreign_report_and_call_arguments_are_unavailable(self):
        original = self.report()
        for key, value in (("format", "foreign"), ("kind", "technical"), ("operationId", "f" * 32),
                           ("installationId", "e" * 32), ("instanceId", "b" * 32),
                           ("revision", self.context["pins"]["current"]["revision"]), ("entryOrigin", "https://private.invalid"),
                           ("componentSha256", "b" * 64), ("componentRevision", "f" * 40),
                           ("invocationId", True), ("invocationId", "d" * 31 + "\u0430")):
            with self.subTest(key=key, value=value):
                self.assertEqual(self.project({**original, key: value})["binding"], "UNAVAILABLE")
        for changes in ({"operation_id": "f" * 32}, {"operation_id": True}, {"instance_id": "b" * 32},
                        {"browser": {**self.browser, "fixturePath": "/private/other.json"}},
                        {"browser": {**self.browser, "componentSha256": "f" * 64}},
                        {"release": {**self.context["pins"]["previous"], "schema": True}},
                        {"release": self.context["pins"]["current"]}):
            with self.subTest(changes=changes):
                self.assertEqual(self.project(original, **changes)["binding"], "UNAVAILABLE")

    def test_before_and_after_cannot_exchange_report_target_or_relay(self):
        for phase, other in (("BEFORE", "AFTER"), ("AFTER", "BEFORE")):
            with self.subTest(phase=phase):
                self.assertEqual(self.project(self.report(other), phase)["binding"], "UNAVAILABLE")
                value = self.project(self.report(other), other)
                self.assertEqual(harness.control_browser_evidence(value, phase)["binding"], "UNAVAILABLE")
                release = self.context["pins"]["current" if phase == "BEFORE" else "previous"]
                self.assertEqual(self.project(self.report(phase), phase, release=release)["binding"], "UNAVAILABLE")

    def test_early_and_bound_environment_failures_keep_actual_provenance(self):
        for phase in ("BEFORE", "AFTER"):
            for status, runtime in (("incomplete", False), ("environment_failed", False), ("environment_failed", True)):
                with self.subTest(phase=phase, status=status, runtime=runtime):
                    report = self.report(phase, status=status, runtime=runtime)
                    report["reasonCode"] = "BROWSER_FIXTURE_PERMISSIONS" if status == "incomplete" else "BROWSER_RUNTIME_UNAVAILABLE"
                    value = self.project(report, phase)
                    self.assertEqual(value["binding"], "DIRECT_INVOCATION")
                    self.assertEqual(value["status"], status)
                    self.assertEqual(value["runtimeProvenance"], "PINNED_INVOCATION" if runtime else "NOT_RECORDED")
                    self.assertEqual(set(value["checks"].values()), {"not_run"})
                    self.assertEqual(value["reason"]["code"], report["reasonCode"])

    def test_reason_and_error_missing_null_unknown_are_distinct_and_private(self):
        for key in ("reasonCode", "error"):
            for mode in ("missing", "null", "string", "object"):
                report = self.report()
                report.pop(key)
                if mode != "missing":
                    report[key] = None if mode == "null" else self.secret if mode == "string" else {"secret": self.secret}
                value = self.project(report)
                projected = value["reason" if key == "reasonCode" else "error"]
                if key == "error" and mode == "object":
                    self.assertEqual(projected["stage"], "UNAVAILABLE")
                    self.assertEqual(projected["code"]["state"], "MISSING")
                else:
                    self.assertEqual(projected["state"], {"missing": "MISSING", "null": "NULL", "string": "UNRECOGNIZED", "object": "UNRECOGNIZED"}[mode])
                self.assertNotIn(self.secret, json.dumps(value))
        report = self.report()
        report.update(reasonCode="\u0412ROWSER_USER_FLOW_FAILED", secret=self.secret)
        report["error"] = {"stage": self.secret, "code": self.secret, "message": self.secret, "cookie": self.secret}
        value = self.project(report)
        self.assertEqual(value["reason"]["state"], "UNRECOGNIZED")
        self.assertEqual(value["error"]["stage"], "UNRECOGNIZED")
        self.assertEqual(value["error"]["code"]["state"], "UNRECOGNIZED")
        self.assertNotIn(self.secret, json.dumps(value))

    def test_exact_error_codes_and_ascii_http_statuses_only(self):
        for code in (*harness.RECEIPT_BROWSER_ERRORS, "API_STATUS_100", "API_STATUS_401", "API_STATUS_599"):
            report = self.report()
            report["error"]["code"] = code
            result = self.project(report)["error"]["code"]
            self.assertEqual(result["state"], "RECOGNIZED")
            if code.startswith("API_STATUS_"):
                self.assertEqual(result, {"state": "RECOGNIZED", "code": "API_STATUS", "httpStatus": int(code[-3:])})
        for code in ("API_STATUS_099", "API_STATUS_600", "API_STATUS_\u0664\u0660\u0661", "API_STATUS_401\n",
                     "SAVE_NOT_OBSERVED " + self.secret, True, [self.secret], {"token": self.secret}):
            report = self.report()
            report["error"]["code"] = code
            result = self.project(report)
            self.assertEqual(result["error"]["code"]["state"], "UNRECOGNIZED")
            self.assertNotIn(self.secret, json.dumps(result))

    def test_inconsistent_checks_and_partial_runtime_fail_closed(self):
        changes = [
            {"status": "passed"}, {"status": True}, {"checks": {name: "passed" for name in harness.RECEIPT_BROWSER_CHECKS}},
            {"checks": {name: "not_run" for name in harness.RECEIPT_BROWSER_CHECKS}},
            {"checks": {}}, {"checks": {name: True for name in harness.RECEIPT_BROWSER_CHECKS}},
            {"checks": {**self.report()["checks"], "private": self.secret}}, {"status": "incomplete"}]
        for change in changes:
            self.assertEqual(self.project({**self.report(), **change})["binding"], "UNAVAILABLE")
        for key in ("revision", "entryOrigin", "invocationId", "componentSha256", "componentRevision"):
            report = self.report()
            report.pop(key)
            self.assertEqual(self.project(report)["binding"], "UNAVAILABLE")

    def test_closed_relay_rejects_extra_fields_and_false_numeric_types(self):
        original = self.project(self.report())
        cases = [{**original, "secret": self.secret}, {**original, "status": "passed"},
                 {**original, "reason": {"state": "RECOGNIZED", "code": self.secret}},
                 {**original, "reason": {"state": "UNRECOGNIZED", "type": self.secret}},
                 {**original, "error": {"stage": "blocks_save", "code": {"state": "RECOGNIZED", "code": "API_STATUS", "httpStatus": True}}},
                 {**original, "error": {"stage": "blocks_save", "code": {"state": "RECOGNIZED", "code": "API_STATUS", "httpStatus": float("nan")}}},
                 {**original, "error": {"stage": "blocks_save", "code": {"state": "MISSING"}, "message": self.secret}},
                 {**original, "checks": {**original["checks"], "teacher_login": {"private": self.secret}}}]
        for case in cases:
            result = harness.control_browser_evidence(case, "BEFORE")
            self.assertEqual(result["binding"], "UNAVAILABLE")
            self.assertNotIn(self.secret, json.dumps(result))
        result = harness.control_browser_evidence(original, "BEFORE")
        original["checks"]["teacher_login"] = self.secret
        original["error"]["code"]["code"] = self.secret
        self.assertNotIn(self.secret, json.dumps(result))

    def test_before_guard_keeps_new_operation_and_stops_following_writes(self):
        with self.owner("BEFORE", self.report()) as state, self.assertRaises(harness.Failure) as caught:
            harness.owner_seed(self.context)
        self.assertEqual((caught.exception.code, caught.exception.status), ("CONTROL_BROWSER_BEFORE", "FAIL"))
        self.assertEqual(caught.exception.control_browser_diagnostic["binding"], "DIRECT_INVOCATION")
        state.identifier.assert_called_once_with()
        call = state.acceptance.browser_acceptance.call_args
        self.assertEqual(call.args[2], self.operation)
        self.assertEqual(call.kwargs, {})
        self.assertEqual(call.args[3]["fixturePath"], self.browser["fixturePath"])
        self.assertNotEqual(state.config["browser"]["fixturePath"], self.browser["fixturePath"])
        self.assertEqual(state.rows.call_count, 1)
        state.s3.assert_not_called()
        state.fingerprint.assert_not_called()
        state.config_module.save_private.assert_not_called()

    def test_after_guard_uses_saved_browser_and_default_instance_binding(self):
        with self.owner("AFTER", self.report("AFTER")) as state, self.assertRaises(harness.Failure) as caught:
            harness.owner_observe(self.context, browser=True)
        self.assertEqual((caught.exception.code, caught.exception.status), ("CONTROL_BROWSER_AFTER", "FAIL"))
        self.assertEqual(caught.exception.control_browser_diagnostic["binding"], "DIRECT_INVOCATION")
        call = state.acceptance.browser_acceptance.call_args
        self.assertIs(call.args[3], state.saved["browser"])
        self.assertEqual(call.args[2], self.operation)
        self.assertEqual(call.kwargs, {})
        state.identifier.assert_called_once_with()
        state.fingerprint.assert_called_once()
        state.s3.assert_not_called()
        state.config_module.save_private.assert_not_called()

    def test_fingerprint_failure_and_readonly_observe_never_run_browser(self):
        with self.owner("AFTER", self.report("AFTER")) as state:
            result = harness.owner_observe(self.context)
            self.assertTrue(result["preserved"])
            state.acceptance.browser_acceptance.assert_not_called()
            state.identifier.assert_not_called()
            state.fingerprint.return_value = {"changed": True}
            with self.assertRaises(harness.Failure) as caught:
                harness.owner_observe(self.context, browser=True)
            self.assertEqual(caught.exception.code, "CONTROL_DATA_CHANGED")
            self.assertFalse(hasattr(caught.exception, "control_browser_diagnostic"))
            state.acceptance.browser_acceptance.assert_not_called()

    def test_successful_owner_paths_do_not_project_or_change_proofs(self):
        for phase in ("BEFORE", "AFTER"):
            report = self.report(phase)
            report.update(status="passed", checks={key: "passed" for key in harness.RECEIPT_BROWSER_CHECKS})
            report.pop("reasonCode")
            report.pop("error")
            with self.owner(phase, report) as state, patch.object(harness, "control_browser_projection") as projector:
                if phase == "BEFORE":
                    before = {table: [] for table in harness.TABLES}
                    after = {table: ["first", "second"] if table == "projects" else ["first"] for table in harness.TABLES}
                    state.rows.side_effect = [({}, before), ({}, after)]
                    observed = harness.owner_seed(self.context)
                    self.assertTrue(observed["independentCohort"])
                    state.s3.assert_called_once_with(self.install, None, create=True)
                    state.config_module.save_private.assert_called_once()
                else:
                    observed = harness.owner_observe(self.context, browser=True)
                    self.assertTrue(observed["preserved"])
                self.assertEqual(observed["browser"]["status"], "PASS")
                self.assertNotIn("controlBrowserDiagnostic", observed)
                projector.assert_not_called()

    def test_actual_guest_json_and_owner_relay_preserve_both_failure_paths(self):
        for phase in ("BEFORE", "AFTER"):
            for status, runtime in (("failed", True), ("incomplete", False), ("environment_failed", False), ("environment_failed", True)):
                with self.subTest(phase=phase, status=status, runtime=runtime):
                    code, child = self.owner_json(phase, self.report(phase, status=status, runtime=runtime))
                    self.assertEqual((code, child["status"]), (1, "FAIL"))
                    expected = "CONTROL_BROWSER_" + phase
                    self.assertEqual(child["reasonCode"], expected)
                    output = io.StringIO()
                    account = SimpleNamespace(pw_name="asa-setup", pw_dir="/var/lib/asa-setup/operator")
                    with patch.object(harness, "guest_guard", return_value=self.context), \
                            patch.dict(sys.modules, {"pwd": SimpleNamespace(getpwnam=Mock(return_value=account))}), \
                            patch.object(harness.Commands, "run", return_value=(code, json.dumps(child).encode())) as command, \
                            patch.object(harness.os, "geteuid", create=True, return_value=0), \
                            patch.object(harness, "panel_and_docker_identity") as later, patch.object(harness, "CLI_ACTIONS", []), \
                            contextlib.redirect_stdout(output):
                        outer_code = harness.guest_main("seed" if phase == "BEFORE" else "final")
                    outer = json.loads(output.getvalue())
                    self.assertEqual((outer_code, outer["status"], outer["reasonCode"], outer["cliActions"]), (1, "FAIL", expected, []))
                    self.assertEqual(outer["controlBrowserDiagnostic"], child["controlBrowserDiagnostic"])
                    self.assertNotIn(self.operation, output.getvalue())
                    command.assert_called_once()
                    later.assert_not_called()

    def test_owner_phase_exit_status_reason_and_cross_point_are_checked(self):
        code, original = self.owner_json("BEFORE", self.report())
        cases = [
            (True, original, "OWNER_REPORT_INVALID"), (1, {**original, "phase": "owner-final"}, "OWNER_REPORT_INVALID"),
            (1, {**original, "format": "foreign"}, "OWNER_REPORT_INVALID"),
            (2, original, "CONTROL_BROWSER_BEFORE"), (1, {**original, "status": "BLOCKED"}, "CONTROL_BROWSER_BEFORE"),
            (1, {**original, "reasonCode": "CONTROL_BROWSER_AFTER"}, "CONTROL_BROWSER_AFTER")]
        for actual_code, child, reason in cases:
            error = self.relay("BEFORE", actual_code, child)
            self.assertEqual(error.code, reason)
            self.assertFalse(hasattr(error, "control_browser_diagnostic"))
        foreign = self.project(self.report("AFTER"), "AFTER")
        error = self.relay("BEFORE", code, {**original, "controlBrowserDiagnostic": foreign})
        self.assertEqual(error.control_browser_diagnostic["binding"], "UNAVAILABLE")

    def test_diagnostic_exceptions_cannot_replace_original_failure_or_leak(self):
        for phase in ("BEFORE", "AFTER"):
            with patch.object(harness, "control_browser_projection", side_effect=RuntimeError(self.secret)):
                code, child = self.owner_json(phase, self.report(phase))
            self.assertEqual((code, child["reasonCode"]), (1, "CONTROL_BROWSER_" + phase))
            self.assertEqual(child["controlBrowserDiagnostic"]["binding"], "UNAVAILABLE")
            self.assertNotIn(self.secret, json.dumps(child))
            with patch.object(harness, "control_browser_evidence", side_effect=RuntimeError(self.secret)):
                error = self.relay(phase, code, child)
                self.assertEqual(error.code, "CONTROL_BROWSER_" + phase)
                output = io.StringIO()
                with patch.object(harness, "guest_guard", return_value={}), patch.object(harness, "guest_phase", side_effect=error), \
                        contextlib.redirect_stdout(output):
                    outer_code = harness.guest_main("seed" if phase == "BEFORE" else "final")
            outer = json.loads(output.getvalue())
            self.assertEqual((outer_code, outer["reasonCode"]), (1, "CONTROL_BROWSER_" + phase))
            self.assertEqual(outer["controlBrowserDiagnostic"]["binding"], "UNAVAILABLE")
            self.assertNotIn(self.secret, output.getvalue())

    def test_unrelated_phase_or_error_never_adopts_browser_diagnostic(self):
        for phase, reason in (("install", "CONTROL_BROWSER_BEFORE"), ("seed", "CONTROL_BROWSER_AFTER"),
                              ("final", "CONTROL_BROWSER_BEFORE"), ("owner-observe", "CONTROL_BROWSER_AFTER"),
                              ("seed", "CONTROL_DATA_CHANGED")):
            error = harness.Failure(reason)
            error.control_browser_diagnostic = {**self.project(self.report()), "secret": self.secret}
            output = io.StringIO()
            with patch.object(harness, "guest_guard", return_value={}), patch.object(harness, "guest_phase", side_effect=error), \
                    contextlib.redirect_stdout(output):
                code = harness.guest_main(phase)
            result = json.loads(output.getvalue())
            self.assertEqual((code, result["status"], result["reasonCode"]), (1, "FAIL", reason))
            self.assertNotIn("controlBrowserDiagnostic", result)
            self.assertNotIn(self.secret, output.getvalue())

    def test_consecutive_owner_failures_do_not_reuse_diagnostic(self):
        code, child = self.owner_json("BEFORE", self.report())
        self.assertEqual(self.relay("BEFORE", code, child).control_browser_diagnostic["binding"], "DIRECT_INVOCATION")
        child.pop("controlBrowserDiagnostic")
        self.assertEqual(self.relay("BEFORE", code, child).control_browser_diagnostic["binding"], "UNAVAILABLE")
        child["reasonCode"] = "CONTROL_DATA_CHANGED"
        self.assertFalse(hasattr(self.relay("BEFORE", code, child), "control_browser_diagnostic"))


class PublicStatusDiagnosticTests(unittest.TestCase):
    SECRET = "PRIVATE_COOKIE_EMAIL_PASSWORD_MUST_NOT_APPEAR"

    def public(self):
        return {"format": "asa-cli-result-v1", "command": "status", "exitCode": 1,
                "status": "UNAVAILABLE", "root": "/private/" + self.SECRET,
                "services": {"status": "UNAVAILABLE", "reasonCode": "DOCKER_IDENTITY",
                    "docker": {"status": "OK", "version": self.SECRET},
                    "compose": {"status": "OK", "version": self.SECRET}, "containers": []},
                "database": {"status": "UNAVAILABLE", "reasonCode": "POSTGRES_UNAVAILABLE"},
                "site": {"status": "OK", "origin": "https://" + self.SECRET, "revision": self.SECRET,
                    "reportedSchema": 304, "https": "UNAVAILABLE", "editorEndpoint": {"status": "OK"},
                    "browserAcceptance": {"status": "NOT_RUN", "historical": {"password": self.SECRET}}},
                "history": {"password": self.SECRET}, "backup": {"password": self.SECRET}}

    def invocation(self):
        return {"pid": 1234, "startedNs": 1_800_000_000_000_000_000,
                "finishedNs": 1_800_000_001_000_000_000, "setupLogsBefore": {"status": "NOT_REQUIRED"}}

    def project(self, public=None, *, words=("status",), code=1, raw=None, invocation=None):
        value = self.public() if public is None else public
        return harness.public_status_failure_projection(words, code,
            json.dumps(value).encode("utf-8") if raw is None else raw,
            self.invocation() if invocation is None else invocation)

    def test_captured_status_components_are_closed_and_do_not_claim_manager_binding(self):
        with patch("builtins.open", side_effect=AssertionError("no follow-up files")), \
             patch.object(harness.os, "open", side_effect=AssertionError("no follow-up descriptors")), \
             patch.object(harness.subprocess, "Popen", side_effect=AssertionError("no follow-up process")):
            result = self.project()
        self.assertEqual((result["status"], result["source"], result["publicStatus"], result["publicExitCode"]),
                         ("OBSERVED", "CAPTURED_PUBLIC_STDOUT", "UNAVAILABLE", 1))
        self.assertEqual(result["services"]["reason"], {"state": "RECOGNIZED", "code": "DOCKER_IDENTITY"})
        self.assertEqual(result["database"]["reason"], {"state": "RECOGNIZED", "code": "POSTGRES_UNAVAILABLE"})
        self.assertEqual(result["site"]["status"], {"state": "OBSERVED", "value": "OK"})
        self.assertEqual(result["site"]["reportedSchema"], {"state": "OBSERVED", "value": 304})
        self.assertEqual(result["site"]["reason"], {"state": "MISSING"})
        self.assertNotIn(self.SECRET, json.dumps(result))
        for name in ("binding", "operationId", "installationId", "pid", "startedNs", "root", "origin"):
            self.assertNotIn('"' + name + '"', json.dumps(result))

    def test_reason_presence_types_unknown_and_unicode_values_remain_distinct(self):
        expected = (
            ({}, {"state": "MISSING"}),
            ({"reasonCode": None}, {"state": "NULL"}),
            ({"reasonCode": "DOCKER_IDENTITY"}, {"state": "RECOGNIZED", "code": "DOCKER_IDENTITY"}),
            ({"reasonCode": "DOCKER_IDENTIT\u0423"}, {"state": "UNRECOGNIZED", "type": "STRING"}),
            ({"reasonCode": self.SECRET}, {"state": "UNRECOGNIZED", "type": "STRING"}),
            ({"reasonCode": True}, {"state": "UNRECOGNIZED", "type": "NON_STRING"}),
            ({"reasonCode": {"raw": self.SECRET}}, {"state": "UNRECOGNIZED", "type": "NON_STRING"}),
        )
        for supplied, outcome in expected:
            with self.subTest(outcome=outcome):
                public = self.public()
                public["services"].pop("reasonCode")
                public["services"].update(supplied)
                result = self.project(public)
                self.assertEqual(result["services"]["reason"], outcome)
                self.assertNotIn(self.SECRET, json.dumps(result))
        public = self.public()
        public["site"]["reasonCode"] = "HTTP_UNAVAILABLE"
        self.assertEqual(self.project(public)["site"]["reason"],
                         {"state": "UNRECOGNIZED", "type": "STRING"})

    def test_only_actual_component_reason_codes_are_recognized(self):
        for component, codes in (
                ("services", ("INSTALLATION_IDENTITY", "NO_CONTAINERS", "OUTPUT_LIMIT",
                              "PROBE_FAILED", "TOOL_OR_ACCESS", "DOCKER_IDENTITY")),
                ("database", ("POSTGRES_UNAVAILABLE", "POSTGRES_QUERY_UNAVAILABLE")),
                ("site", ("ENTRY_ORIGIN_UNAVAILABLE",))):
            for code in codes:
                with self.subTest(component=component, code=code):
                    public = self.public()
                    public[component]["reasonCode"] = code
                    self.assertEqual(self.project(public)[component]["reason"],
                                     {"state": "RECOGNIZED", "code": code})
        public = self.public()
        for name in ("docker", "compose"):
            public["services"][name] = {"status": "UNAVAILABLE", "reasonCode": "TOOL_OR_ACCESS"}
            result = self.project(public)["services"][name]
            self.assertEqual(result["status"], {"state": "OBSERVED", "value": "UNAVAILABLE"})
            self.assertEqual(result["reason"], {"state": "RECOGNIZED", "code": "TOOL_OR_ACCESS"})

    def test_missing_null_and_malformed_components_do_not_become_success(self):
        for component in ("services", "database", "site"):
            for value, state in ((None, "NULL"), ([], "UNRECOGNIZED"), (True, "UNRECOGNIZED")):
                with self.subTest(component=component, state=state):
                    public = self.public()
                    public[component] = value
                    self.assertEqual(self.project(public)[component], {"state": state})
            public = self.public()
            public.pop(component)
            self.assertEqual(self.project(public)[component], {"state": "MISSING"})
            public[component] = {"status": "\u041eK", "reasonCode": self.SECRET, "raw": self.SECRET}
            result = self.project(public)
            self.assertEqual(result[component]["status"], {"state": "UNRECOGNIZED"})
            self.assertEqual(result["publicStatus"], "UNAVAILABLE")
            self.assertNotIn(self.SECRET, json.dumps(result))

    def test_health_running_and_schema_are_typed_without_raw_names(self):
        public = self.public()
        public["services"]["containers"] = [
            {"service": "minio-init", "running": False, "health": None, "secret": self.SECRET},
            {"service": "api", "running": True, "health": "healthy", "id": self.SECRET},
            {"service": self.SECRET, "running": 1, "health": True},
            {"service": {"raw": self.SECRET}, "running": "true", "health": "HEALTHY"},
            self.SECRET,
        ]
        result = self.project(public)
        rows = result["services"]["containers"]["items"]
        self.assertEqual(rows[0]["running"], {"state": "OBSERVED", "value": False})
        self.assertEqual(rows[0]["health"], {"state": "NULL"})
        self.assertEqual(rows[1]["health"], {"state": "OBSERVED", "value": "healthy"})
        for key in ("service", "running", "health"):
            self.assertEqual(rows[2][key], {"state": "UNRECOGNIZED"})
            self.assertEqual(rows[3][key], {"state": "UNRECOGNIZED"})
        self.assertEqual(rows[4], {"state": "UNRECOGNIZED"})
        self.assertNotIn(self.SECRET, json.dumps(result))
        for invalid in (True, -1, 100_000_000, 304.0, "304", {"raw": self.SECRET}):
            public["database"]["schema"] = public["site"]["reportedSchema"] = invalid
            result = self.project(public)
            self.assertEqual(result["database"]["schema"], {"state": "UNRECOGNIZED"})
            self.assertEqual(result["site"]["reportedSchema"], {"state": "UNRECOGNIZED"})
        public["services"]["containers"] = [{"raw": self.SECRET}] * 65
        self.assertEqual(self.project(public)["services"]["containers"], {"state": "LIMIT_EXCEEDED"})

    def test_failed_top_status_is_not_upgraded_when_all_component_statuses_are_ok(self):
        public = self.public()
        public["status"] = "FAILED"
        for component in ("services", "database", "site"):
            public[component]["status"] = "OK"
            public[component].pop("reasonCode", None)
        public["database"]["schema"] = 304
        result = self.project(public)
        self.assertEqual(result["publicStatus"], "FAILED")
        self.assertEqual(result["publicExitCode"], 1)
        self.assertEqual(result["status"], "OBSERVED")

    def test_envelope_and_actual_exit_are_strictly_bound(self):
        for key, value in (("command", "doctor"), ("command", None), ("format", "asa-setup-result-v1"),
                           ("exitCode", True), ("exitCode", 0), ("exitCode", 1.0),
                           ("status", "OK"), ("status", "UNAVAILABL\u0415"), ("status", [])):
            public = self.public()
            public[key] = value
            with self.subTest(key=key, value=value), self.assertRaisesRegex(harness.Failure, "READ_DIAGNOSTIC_BINDING"):
                self.project(public)
        for code in (True, 1.0, 0, 2, "1"):
            with self.subTest(code=code), self.assertRaisesRegex(harness.Failure, "READ_DIAGNOSTIC_BINDING"):
                self.project(code=code)
        for words in (["version"], ["status", "extra"], "status", [], None):
            with self.subTest(words=words), self.assertRaisesRegex(harness.Failure, "READ_DIAGNOSTIC_BINDING"):
                self.project(words=words)
        for key in ("format", "command", "exitCode", "status"):
            public = self.public()
            public.pop(key)
            with self.subTest(missing=key), self.assertRaisesRegex(harness.Failure, "READ_DIAGNOSTIC_BINDING"):
                self.project(public)

    def test_missing_or_malformed_capture_metadata_is_unverified(self):
        for invocation in ({}, {"pid": 1}, None, [], True):
            with self.subTest(invocation=invocation), self.assertRaisesRegex(harness.Failure, "READ_DIAGNOSTIC_INVOCATION"):
                harness.public_status_failure_projection(["status"], 1, json.dumps(self.public()), invocation)
        for key, value in (("pid", True), ("pid", 0), ("pid", -1), ("pid", 2**31),
                           ("startedNs", True), ("startedNs", 0), ("finishedNs", 1.0),
                           ("finishedNs", 1), ("finishedNs", 2**63)):
            invocation = self.invocation()
            invocation[key] = value
            with self.subTest(key=key, value=value), self.assertRaisesRegex(harness.Failure, "READ_DIAGNOSTIC_INVOCATION"):
                self.project(invocation=invocation)

    def test_duplicate_nonfinite_invalid_utf8_and_oversized_json_are_rejected(self):
        raw = json.dumps(self.public())
        for malformed in (raw[:-1] + ', "command":"status"}',
                          raw.replace('"reportedSchema": 304', '"reportedSchema":304,"reportedSchema":304'),
                          raw[:-1] + ', "unused":NaN}', raw[:-1] + ', "unused":Infinity}',
                          raw + "\n{}", b"\xff", raw.encode()[:-1]):
            with self.subTest(kind=type(malformed).__name__), self.assertRaisesRegex(harness.Failure, "READ_DIAGNOSTIC_JSON"):
                self.project(raw=malformed)
        for oversized in (b" " * (harness.DIAGNOSTIC_LIMIT + 1),
                          "\u0410" * (harness.DIAGNOSTIC_LIMIT // 2 + 1)):
            with self.subTest(kind=type(oversized).__name__), self.assertRaisesRegex(harness.Failure, "READ_DIAGNOSTIC_SIZE"):
                self.project(raw=oversized)

    def test_failed_status_keeps_closed_diagnostic_and_original_phase_failure(self):
        public = self.public()
        output = io.StringIO()
        with patch.object(harness, "CLI_ACTIONS", []), patch.object(harness, "guest_guard", return_value={}), \
             patch.object(harness, "command_failure_diagnostic", side_effect=AssertionError("no manager read")) as manager, \
             patch.object(harness, "guest_phase", side_effect=lambda *_: harness.public_cli_result(
                 ["status"], 1, json.dumps(public), invocation=self.invocation())), \
             contextlib.redirect_stdout(output):
            code = harness.guest_main("install")
        recorded = json.loads(output.getvalue())
        self.assertEqual((code, recorded["status"], recorded["reasonCode"]), (1, "FAIL", "PUBLIC_CLI_FAILED"))
        self.assertEqual(recorded["cliActions"][0]["exitCode"], 1)
        diagnostic = recorded["cliActions"][0]["readCommandDiagnostic"]
        self.assertEqual(diagnostic["services"]["reason"]["code"], "DOCKER_IDENTITY")
        self.assertEqual(diagnostic["publicStatus"], "UNAVAILABLE")
        self.assertNotIn("commandFailureDiagnostic", recorded)
        self.assertNotIn(self.SECRET, output.getvalue())
        manager.assert_not_called()

    @unittest.skipUnless(sys.platform.startswith("linux"), "Actual child requires Linux process-group cleanup")
    def test_real_child_stdout_and_exit_are_used_without_followup_probe(self):
        public = json.dumps(self.public())
        commands = harness.Commands()
        code, raw = commands.run([sys.executable, "-I", "-B", "-c",
            "import sys; print(" + repr(public) + "); sys.exit(1)"], timeout=10, allowed=(1,))
        with patch.object(harness, "CLI_ACTIONS", []), \
             patch.object(harness, "command_failure_diagnostic", side_effect=AssertionError("no manager read")) as manager:
            with self.assertRaisesRegex(harness.Failure, "PUBLIC_CLI_FAILED"):
                harness.public_cli_result(["status"], code, raw, invocation=commands.last_invocation)
            diagnostic = harness.CLI_ACTIONS[0]["readCommandDiagnostic"]
        self.assertEqual((code, diagnostic["status"], diagnostic["source"]),
                         (1, "OBSERVED", "CAPTURED_PUBLIC_STDOUT"))
        self.assertEqual(diagnostic["database"]["reason"]["code"], "POSTGRES_UNAVAILABLE")
        self.assertNotIn(self.SECRET, json.dumps(diagnostic))
        manager.assert_not_called()

    def test_projection_exception_cannot_replace_primary_failure_or_leak_its_message(self):
        secret = self.SECRET

        class PrivateError(RuntimeError):
            @property
            def code(self):
                raise RuntimeError(secret)

        for failure in (RuntimeError(secret), PrivateError(secret)):
            output = io.StringIO()
            with self.subTest(kind=type(failure).__name__), \
                 patch.object(harness, "CLI_ACTIONS", []), patch.object(harness, "guest_guard", return_value={}), \
                 patch.object(harness, "public_status_failure_projection", side_effect=failure), \
                 patch.object(harness, "guest_phase", side_effect=lambda *_: harness.public_cli_result(
                     ["status"], 1, json.dumps(self.public()), invocation=self.invocation())), \
                 contextlib.redirect_stdout(output):
                code = harness.guest_main("install")
            recorded = json.loads(output.getvalue())
            self.assertEqual((code, recorded["status"], recorded["reasonCode"]), (1, "FAIL", "PUBLIC_CLI_FAILED"))
            self.assertEqual(recorded["cliActions"][0]["readCommandDiagnostic"],
                {"format": "asa-public-status-diagnostic-v1", "status": "UNAVAILABLE", "source": "UNVERIFIED",
                 "reasonCode": "READ_DIAGNOSTIC_UNAVAILABLE"})
            self.assertNotIn(secret, output.getvalue())

    def test_invalid_capture_records_unavailable_and_allowed_exit_does_not_project(self):
        public = self.public()
        with patch.object(harness, "CLI_ACTIONS", []):
            with self.assertRaisesRegex(harness.Failure, "PUBLIC_CLI_FAILED"):
                harness.public_cli_result(["status"], 1, json.dumps(public), invocation={})
            self.assertEqual(harness.CLI_ACTIONS[0]["readCommandDiagnostic"]["reasonCode"],
                             "READ_DIAGNOSTIC_INVOCATION")
        with patch.object(harness, "CLI_ACTIONS", []), \
             patch.object(harness, "public_status_failure_projection") as projection:
            self.assertEqual(harness.public_cli_result(["status"], 1, json.dumps(public), allowed=(1,)), public)
            projection.assert_not_called()
            self.assertNotIn("readCommandDiagnostic", harness.CLI_ACTIONS[0])


class CommandFailureDiagnosticTests(unittest.TestCase):
    def test_operator_log_root_is_under_protected_var_lib(self):
        # Ubuntu /var/log is commonly root:syslog mode 0775. Its group-write
        # ancestor must never be exempted from diagnostic_open's trust rule.
        self.assertEqual(harness.OPERATOR_LOG_ROOT, Path("/var/lib/asa-lab-operator"))
        self.assertFalse(harness.OPERATOR_LOG_ROOT.is_relative_to(Path("/var/log")))

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

    @contextlib.contextmanager
    def diagnostic_timestamp_fixture(self, *, switch=False, **timestamps):
        public, config, journal, receipt, pins = self.records()
        if switch:
            config.update(project="asa-lab-dev", profile="production")
            receipt["stage"] = "switch"
            journal.update(project=config["project"], phase="switch", state="VERIFY_ONLY", release=dict(pins["previous"]),
                           result=json.loads(json.dumps(receipt)))
            journal["stages"]["release"] = {"status": "done", "revision": pins["previous"]["revision"]}
            journal["stages"]["switch"] = {"status": "intent"}
        second = int(harness.dt.datetime(2026, 11, 4, 12, 0, tzinfo=harness.dt.timezone.utc).timestamp()) * 10**9
        invocation = {"pid": 1234, "startedNs": second + 200_000_000, "finishedNs": second + 800_000_000,
                      "setupLogsBefore": {"status": "OBSERVED", "entries": {}}}
        logfile = harness.OPERATOR_LOG_ROOT / "install-20261104T120000Z-1234.log"
        public["logPath"] = str(logfile)
        private = {"setup.json": config, "a" * 32 + ".json": journal, "setup-last-attempt.json": receipt}
        def read(path, *_args, **_kwargs):
            if path == logfile:
                metadata = SimpleNamespace(st_ctime_ns=second + timestamps.get("cli_ctime", 500_000_000),
                                           st_mtime_ns=second + timestamps.get("cli_mtime", 500_000_000))
                return b"docker pull failed (exit 1).\n", metadata, False
            if path.name in private:
                metadata = SimpleNamespace(st_mtime_ns=second + timestamps.get("receipt_mtime", 500_000_000))
                return json.dumps(private[path.name]).encode(), metadata, False
            self.assertEqual(path, harness.INSTALL_ROOT / ".asa/setup-logs" / ("a" * 32 + ".log"))
            return b"", SimpleNamespace(), False
        with patch.object(harness, "guest_guard", return_value={"pins": pins}), \
                patch.object(harness, "diagnostic_owner", return_value=({"uid": 999}, {})), \
                patch.object(harness, "diagnostic_read", side_effect=read):
            yield public, invocation

    def test_receipt_metadata_outside_ns_interval_in_same_second_is_rejected(self):
        for timestamp in (199_999_999, 800_000_001):
            with self.subTest(timestamp=timestamp), self.diagnostic_timestamp_fixture(receipt_mtime=timestamp) as (public, invocation), \
                    patch.object(harness, "command_log_classification") as classify, \
                    self.assertRaisesRegex(harness.Failure, "DIAGNOSTIC_INVOCATION"):
                harness.command_failure_diagnostic(["install"], 2, public, invocation)
            classify.assert_not_called()

    def test_each_cli_metadata_timestamp_outside_ns_interval_in_same_second_is_unavailable(self):
        for field in ("cli_ctime", "cli_mtime"):
            for timestamp in (199_999_999, 800_000_001):
                with self.subTest(field=field, timestamp=timestamp), self.diagnostic_timestamp_fixture(**{field: timestamp}) as (public, invocation):
                    observed = harness.command_failure_diagnostic(["install"], 2, public, invocation)
                self.assertEqual(observed["binding"], "VERIFIED")
                self.assertEqual(observed["journalPhase"], "release")
                self.assertEqual(observed["logs"]["cli"]["status"], "UNAVAILABLE")
                self.assertEqual(observed["logs"]["cli"]["reasonCode"], "DIAGNOSTIC_INVOCATION")

    def test_metadata_inside_closed_ns_interval_and_second_precision_filename_are_accepted(self):
        for timestamp in (200_000_000, 500_000_000, 800_000_000):
            with self.subTest(timestamp=timestamp), self.diagnostic_timestamp_fixture(
                    receipt_mtime=timestamp, cli_ctime=timestamp, cli_mtime=timestamp) as (public, invocation):
                observed = harness.command_failure_diagnostic(["install"], 2, public, invocation)
            self.assertEqual(observed["binding"], "VERIFIED")
            self.assertEqual(observed["logs"]["cli"]["status"], "OBSERVED")
            self.assertEqual(observed["logs"]["cli"]["exitCodes"], [1])

    def test_ns_freshness_rejection_preserves_original_command_exit_and_guest_failure(self):
        for field in ("receipt_mtime", "cli_ctime", "cli_mtime"):
            for timestamp in (199_999_999, 800_000_001):
                output = io.StringIO()
                with self.subTest(field=field, timestamp=timestamp), self.diagnostic_timestamp_fixture(**{field: timestamp}) as (public, invocation), \
                        patch.object(harness, "CLI_ACTIONS", []), \
                        patch.object(harness, "guest_phase", side_effect=lambda *_: harness.public_cli_result(
                            ["install"], 2, json.dumps(public), invocation=invocation)), contextlib.redirect_stdout(output):
                    code = harness.guest_main("install")
                observed = json.loads(output.getvalue())
                self.assertEqual((code, observed["status"], observed["reasonCode"]), (1, "FAIL", "COMMAND"))
                self.assertEqual(observed["cliActions"][0]["exitCode"], 2)
                diagnostic = observed["commandFailureDiagnostic"]
                unavailable = diagnostic if field == "receipt_mtime" else diagnostic["logs"]["cli"]
                self.assertEqual((unavailable["status"], unavailable["reasonCode"]), ("UNAVAILABLE", "DIAGNOSTIC_INVOCATION"))

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


class PostSwitchReasonTests(unittest.TestCase):
    # Independent literal expectations, with source provenance rather than a
    # claim that a particular producer was observed in a failed guest.
    PRODUCERS = {
        ("deployment/setup_operation.py", "Runtime.commit_runtime"): ("DATA_IDENTITY", "MAINTENANCE_IDENTITY"),
        ("deployment/setup_operation.py", "onboard_owner"): ("OWNER_FRESH_ONLY", "OWNER_IDENTITY", "OWNER_PASSWORD",
            "OWNER_EXISTING_ACCOUNTS", "OWNER_REGISTRATION_AMBIGUOUS", "OWNER_REGISTRATION_IDENTITY", "OWNER_PLAN", "OWNER_ACCESS"),
        ("deployment/setup_operation.py", "_NoRedirect.redirect_request"): ("OWNER_HTTP_REDIRECT",),
        ("deployment/setup_operation.py", "_owner_request"): ("OWNER_RESPONSE", "OWNER_HTTP"),
        ("deployment/setup_operation.py", "_bot_proof"): ("OWNER_BOT_CHALLENGE",),
        ("deployment/setup_operation.py", "_owner_admin"): ("OWNER_API", "OWNER_ADMIN", "OWNER_ADMIN_IDENTITY"),
        ("deployment/setup_config.py", "private_json"): ("PRIVATE_FILE", "PRIVATE_PERMISSIONS", "PRIVATE_FORMAT"),
        ("deployment/setup_config.py", "save_private"): ("PRIVATE_DIRECTORY",),
        ("deployment/setup_config.py", "read_installed_release"): ("RELEASE_FILE", "RELEASE_PERMISSIONS"),
        ("deployment/setup_config.py", "replace_legacy_manager_state"): ("LEGACY_STATE_PATH", "LEGACY_STATE_FORMAT",
            "LEGACY_STATE_FILE", "LEGACY_STATE_PERMISSIONS"),
        ("asa_manager.py", "backup_directory"): ("BACKUP_PATH", "BACKUP_DIRECTORY", "BACKUP_PERMISSIONS"),
        ("deployment/contracts.py", "read_env"): ("ENV",),
        ("deployment/contracts.py", "attest_proxy_policy"): ("PROXY_POLICY",),
        ("deployment/resources.py", "pool_configuration"): ("RESOURCE_CONFIG",),
        ("deployment/system.py", "Installation.__init__"): ("PROFILE", "PROJECT", "PUBLIC_ORIGINS_MISSING"),
        ("deployment/system.py", "public_origins_snapshot"): ("PUBLIC_ORIGINS_SNAPSHOT",),
        ("deployment/system.py", "public_origins_environment"): ("PUBLIC_ORIGINS_POLICY",),
        ("deployment/system.py", "_origin_private_read"): ("PUBLIC_ORIGINS_PERMISSIONS", "PUBLIC_ORIGINS_PATH"),
        ("deployment/system.py", "public_origins_overlay"): ("PUBLIC_ORIGINS_CONTENT",),
        ("deployment/system.py", "public_origins_recovery"): ("PUBLIC_ORIGINS_RECOVERY",),
        ("deployment/setup_operation.py", "Store.path"): ("OPERATION_ID",),
        ("deployment/setup_operation.py", "Store.read"): ("OPERATION_IDENTITY",),
        ("deployment/setup_operation.py", "Store.pending"): ("OPERATIONS_AMBIGUOUS",),
        ("deployment/setup_operation.py", "Store.validate_child"): ("DEPENDENT_IDENTITY", "DEPENDENT_BINDING"),
        ("deployment/setup_operation.py", "Store._catalog"): ("DEPENDENT_PARENT_MISSING", "DEPENDENT_SOURCE",
            "DEPENDENT_PARENT_STATE", "DEPENDENTS_AMBIGUOUS"),
        ("deployment/system.py", "Installation.identity"): ("IDENTITY_PROJECT", "IDENTITY_ENV", "IDENTITY_ROOT",
            "IDENTITY_FILES", "IDENTITY_DUPLICATE", "IDENTITY_MISSING"),
        ("deployment/system.py", "Installation.data_identity"): ("IDENTITY_VOLUME", "DATABASE_ENGINE"),
        ("deployment/contracts.py", "attest_database_targets"): ("DATABASE_TARGET",),
    }

    def records(self, reason):
        values = CommandFailureDiagnosticTests.records(self)
        public, config, journal, receipt, pins = values
        public.update(reasonCode=reason, reasonCodes=[reason], message="PRIVATE_SECRET_CANARY")
        public["operation"]["reasonCode"] = reason
        receipt.update(reasonCode=reason, stage="switch", actionExecuted=True, executionCompleted=True,
                       site={"technical": {"status": "passed"}}, nextAction="PRIVATE_SECRET_CANARY")
        config["private"] = {"password": "PRIVATE_SECRET_CANARY"}
        pin = pins["previous"]
        journal.update(phase="switch", state="VERIFY_ONLY", result=copy.deepcopy(receipt), release=dict(pin),
                       requestedDeploymentDigest=pin["deploymentDigest"])
        journal["stages"]["release"] = {"status": "done", "revision": pin["revision"]}
        journal["stages"]["switch"] = {"status": "done"}
        return values

    @contextlib.contextmanager
    def observation(self, values, *, receipt_mtime=15 * 10**9):
        public, config, journal, receipt, pins = values
        invocation = {"startedNs": 10 * 10**9, "finishedNs": 20 * 10**9,
                      "setupLogsBefore": {"status": "OBSERVED", "entries": {}}}
        private = {".asa/setup.json": config, ".asa/setup-operations/" + "a" * 32 + ".json": journal,
                   ".asa/setup-last-attempt.json": receipt}
        def read(path, *_args, **_kwargs):
            self.assertTrue(path.is_relative_to(harness.INSTALL_ROOT))
            relative = path.relative_to(harness.INSTALL_ROOT).as_posix()
            if relative not in private:
                raise PermissionError("PRIVATE_SECRET_CANARY")
            return json.dumps(private[relative]).encode(), SimpleNamespace(st_mtime_ns=receipt_mtime), False
        with patch.object(harness, "guest_guard", return_value={"pins": pins}), \
                patch.object(harness, "diagnostic_owner", return_value=({"uid": 999}, {})), \
                patch.object(harness, "diagnostic_read", side_effect=read), \
                patch.object(harness, "switch_failure_observation") as switch_probe:
            yield public, invocation
        switch_probe.assert_not_called()

    def public_failure(self, public, invocation):
        output = io.StringIO()
        with patch.object(harness, "CLI_ACTIONS", []), \
                patch.object(harness, "guest_phase", side_effect=lambda *_: harness.public_cli_result(
                    ["install"], 2, json.dumps(public), invocation=invocation)), contextlib.redirect_stdout(output):
            code = harness.guest_main("install")
        self.assertNotIn("PRIVATE_SECRET_CANARY", output.getvalue())
        observed = json.loads(output.getvalue())
        self.assertEqual((code, observed["status"]), (1, "FAIL"))
        self.assertEqual((observed["cliActions"][0]["exitCode"], observed["cliActions"][0]["status"]), (2, "BLOCKED"))
        self.assertEqual(observed["cliActions"][0]["operationOutcome"], "BLOCKED")
        return observed

    def test_expected_codes_are_literal_guards_of_the_named_producers(self):
        sources = {}
        for (relative, name), expected in self.PRODUCERS.items():
            if relative not in sources:
                sources[relative] = ast.parse((HERE.parent / relative).read_text(encoding="utf-8"))
            definition = sources[relative]
            for part in name.split("."):
                definition = next(node for node in definition.body if getattr(node, "name", None) == part)
            literals = set()
            for node in ast.walk(definition):
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ("require", "Blocked"):
                    index = 1 if node.func.id == "require" else 0
                    if len(node.args) > index and isinstance(node.args[index], ast.Constant):
                        literals.add(node.args[index].value)
            with self.subTest(source=relative, function=name):
                self.assertLessEqual(set(expected), literals)

    def test_known_post_switch_codes_survive_public_and_bound_receipt_failure(self):
        reasons = {reason for group in self.PRODUCERS.values() for reason in group}
        for reason in sorted(reasons):
            with self.subTest(reason=reason):
                with self.observation(self.records(reason)) as (public, invocation):
                    observed = self.public_failure(public, invocation)
                self.assertEqual(observed["reasonCode"], reason)
                self.assertEqual(set(observed["cliActions"][0]["reasonCodes"]), {reason})
                proof = observed["commandFailureDiagnostic"]
                self.assertEqual((proof["status"], proof["binding"], proof["reasonCode"]), ("OBSERVED", "VERIFIED", reason))
                self.assertEqual((proof["journalPhase"], proof["receiptStage"], proof["stages"]["switch"]), ("switch", "switch", "done"))
                self.assertEqual((proof["selectedRelease"]["status"], proof["selectedRelease"]["pin"]), ("CONFIRMED", "previous"))
                self.assertTrue(proof["acceptance"]["technicalCompleted"])
                self.assertTrue(proof["acceptance"]["executionCompleted"])
                self.assertFalse(proof["acceptance"]["applicationAccepted"])
                self.assertNotIn("ownerCompleted", proof["acceptance"])
                self.assertFalse(proof["acceptance"]["dataProtectionConfirmed"])
                self.assertNotIn("owner_registration", proof["stages"])
                self.assertNotIn("owner_grant", proof["stages"])
                self.assertEqual(proof["logs"]["setup"]["status"], "UNAVAILABLE")

    def test_unknown_and_non_string_post_switch_codes_remain_closed(self):
        for reason in ("PRIVATE_SECRET_CANARY", "OWNER_IDENTITY_PRIVATE_SECRET_CANARY", "owner_identity",
                       "OWNER_IDENTITY PRIVATE_SECRET_CANARY", None, True, 42, ["OWNER_IDENTITY"], {"code": "OWNER_IDENTITY"}):
            with self.subTest(reason=reason):
                values = self.records(reason)
                projected = harness.command_operation_projection(*values, mode="install", code=2, uid=999)
                self.assertEqual(projected["reasonCode"], "UNRECOGNIZED_REASON")
                self.assertNotIn("PRIVATE_SECRET_CANARY", json.dumps(projected))
                if isinstance(reason, str):
                    with self.observation(values) as (public, invocation):
                        observed = self.public_failure(public, invocation)
                    self.assertEqual(observed["reasonCode"], "UNRECOGNIZED_REASON")
                    self.assertEqual(observed["commandFailureDiagnostic"]["reasonCode"], "UNRECOGNIZED_REASON")

    def test_new_code_never_binds_a_mismatched_or_stale_receipt(self):
        changes = ((0, "operation", {"operationId": "a" * 32, "installationId": "b" * 32,
                                    "outcome": "BLOCKED", "reasonCode": "OWNER_PASSWORD"}),
                   (1, "installationId", "c" * 32), (1, "operatorUid", 0), (1, "root", "/foreign"),
                   (2, "mode", "update"), (2, "root", "/foreign"), (2, "result", {}),
                   (3, "operationId", "c" * 32), (3, "reasonCode", "OWNER_PASSWORD"), (3, "exitCode", 1),
                   (None, "mtime", 10 * 10**9 - 1), (None, "mtime", 20 * 10**9 + 1))
        for index, key, value in changes:
            values = self.records("OWNER_IDENTITY")
            if index is not None:
                values[index][key] = value
            with self.subTest(index=index, key=key, value=value), \
                    self.observation(values, receipt_mtime=value if index is None else 15 * 10**9) as (public, invocation):
                observed = self.public_failure(public, invocation)
            self.assertEqual(observed["reasonCode"], "OWNER_IDENTITY")
            proof = observed["commandFailureDiagnostic"]
            self.assertEqual(proof["status"], "UNAVAILABLE")
            self.assertEqual(proof["reasonCode"], "DIAGNOSTIC_INVOCATION" if index is None else "DIAGNOSTIC_BINDING")
            self.assertEqual(proof["binding"], "UNVERIFIED")
            self.assertNotIn("operationId", observed["cliActions"][0])


class AcceptanceReceiptDiagnosticTests(unittest.TestCase):
    """Pure finalizer -> bound observer checks; no browser, backup or new IO."""

    def records(self, *, browser_failed=True):
        from deployment import setup_result
        public, config, journal, receipt, pins = CommandFailureDiagnosticTests.records(self)
        pin = pins["previous"]
        config.update(entryOrigin="http://127.0.0.1:4610", browser={"componentSha256": pins["browser"]["componentSha256"]})
        technical = {"format": "asa-setup-acceptance-v1", "kind": "technical", "operationId": receipt["operationId"],
            "installationId": "c" * 32, "instanceId": "c" * 32, "status": "passed", "revision": pin["revision"],
            "schema": pin["schema"], "entryOrigin": config["entryOrigin"], "checks": {"runtime": "passed"}}
        browser = {"format": "asa-setup-acceptance-v1", "kind": "browser", "operationId": receipt["operationId"],
            "installationId": receipt["installationId"], "instanceId": "c" * 32,
            "status": "failed" if browser_failed else "incomplete",
            "reasonCode": "BROWSER_USER_FLOW_FAILED" if browser_failed else "BROWSER_COMPONENT_MISSING",
            "checks": {key: "failed" if browser_failed else "not_run" for key in harness.RECEIPT_BROWSER_CHECKS}}
        if browser_failed:
            browser.update(revision=pin["revision"], entryOrigin=config["entryOrigin"], invocationId="d" * 32,
                componentSha256=pins["browser"]["componentSha256"], componentRevision=pins["browser"]["opsRevision"],
                error={"stage": "course_open", "code": "API_STATUS_403"})
        backup = {"format": "asa-backup-operation-v1", "operationId": receipt["operationId"],
            "installationId": receipt["installationId"], "snapshotId": "20261104T120000Z-1234abcd", "policy": "best-effort",
            "outcome": "WARNING" if browser_failed else "BLOCKED", "local": {"status": "OK"},
            "encryption": {"status": "OK"} if browser_failed else {"status": "FAILED", "error": "AGE_RECIPIENT"},
            "cloud": {"status": "NOT_CONFIGURED"}, "errors": [] if browser_failed else [{"code": "AGE_RECIPIENT", "at": "private"}]}
        receipt.pop("reasonCode")
        receipt.update(stage="first_backup", outcome="PENDING", actionExecuted=True, executionCompleted=True,
            dependencies={"status": "OK"}, version={"status": "RUNNING"}, data={"status": "INITIALIZED"},
            site={"technical": technical, "browser": browser, "owner": {"status": "READY"}}, backup=backup,
            diagnostics={"status": "passed"})
        journal.update(phase="first_backup", state="VERIFY_ONLY", release=dict(pin), backupPolicy={"policy": "best-effort"},
                       requestedDeploymentDigest=pin["deploymentDigest"])
        journal["stages"].update(release={"status": "done", "revision": pin["revision"]}, switch={"status": "done"},
            browser={"status": "done", "evidence": copy.deepcopy(browser)},
            first_backup={"status": "done", "snapshotId": backup["snapshotId"], "evidence": copy.deepcopy(backup)})
        setup_result.finalize(receipt)
        public.update(exitCode=1, managerExitCode=1, status="FAILED", reasonCodes=[])
        public.pop("reasonCode")
        public["operation"].update(outcome="ERROR", reasonCode=None)
        journal["result"] = copy.deepcopy(receipt)
        return public, config, journal, receipt, pins

    def rebind(self, values, *, stages=True):
        public, _config, journal, receipt, _pins = values
        if stages:
            journal["stages"]["browser"]["evidence"] = copy.deepcopy(receipt["site"]["browser"])
            journal["stages"]["first_backup"]["evidence"] = copy.deepcopy(receipt["backup"])
        public["operation"]["reasonCode"] = copy.deepcopy(receipt.get("reasonCode"))
        journal["result"] = copy.deepcopy(receipt)
        return values

    def project(self, values):
        return harness.command_operation_projection(*values, mode="install", code=1, uid=999)

    def test_exact_identity_marker_survives_full_binding_without_changing_failure(self):
        marker, sentinel = "SYNTHETIC_LOGIN_IDENTITY_MISMATCH", "PRIVATE_IDENTITY_CANARY"
        self.assertEqual(harness.RECEIPT_BROWSER_ERRORS, {
            "SAVE_NOT_OBSERVED", "REOPEN_VALUE_MISMATCH", "REOPEN_DRAFT_MISMATCH", "RuntimeError", marker})
        baseline = self.project(self.records())
        values = self.records()
        values[3]["site"]["browser"]["error"] = {"stage": "teacher_login_submit", "code": marker,
            "email": sentinel, "response": {"cookie": sentinel}, "message": sentinel}
        self.rebind(values)
        before = copy.deepcopy(values)
        with patch.object(harness, "diagnostic_read", side_effect=AssertionError("new file read")), \
                patch.object(harness.subprocess, "run", side_effect=AssertionError("new command")), \
                patch.object(harness.urllib.request, "urlopen", side_effect=AssertionError("new network")):
            observed = self.project(values)
        self.assertEqual(values, before)
        self.assertEqual((observed["status"], observed["binding"], observed["publicExitCode"],
                          observed["managerExitCode"], observed["outcome"]), ("OBSERVED", "VERIFIED", 1, 1, "ERROR"))
        self.assertEqual(observed["acceptance"], baseline["acceptance"])
        self.assertFalse(observed["acceptance"]["applicationAccepted"])
        self.assertFalse(observed["acceptance"]["browserCompleted"])
        browser = observed["receiptDetails"]["browser"]
        self.assertEqual((browser["binding"], browser["runtimeProvenance"], browser["status"]),
                         ("VERIFIED_PARENT_OPERATION", "PINNED_INVOCATION", "failed"))
        self.assertEqual(browser["error"], {"stage": "teacher_login_submit",
            "code": {"state": "RECOGNIZED", "code": marker}})
        self.assertEqual(browser["reason"], {"state": "RECOGNIZED", "code": "BROWSER_USER_FLOW_FAILED"})
        self.assertNotIn(sentinel, json.dumps(observed))

    def test_identity_marker_near_unicode_type_and_private_values_remain_closed(self):
        marker, sentinel = "SYNTHETIC_LOGIN_IDENTITY_MISMATCH", "PRIVATE_IDENTITY_CANARY"
        candidates = (marker + "_EXTRA", marker + " ", marker + "\n", marker.lower(), marker + "\u200b",
            "ＳYNTHETIC_LOGIN_IDENTITY_MISMATCH", marker + "_" + sentinel, sentinel,
            None, True, 2, [marker], {"code": marker})
        for code in candidates:
            with self.subTest(value_type=type(code).__name__):
                values = self.records()
                values[3]["site"]["browser"]["error"] = {"stage": "teacher_login_submit", "code": code,
                    "response": {"cookie": sentinel}}
                observed = self.project(self.rebind(values))
                expected = ({"state": "NULL"} if code is None else
                    {"state": "UNRECOGNIZED", "type": "STRING" if type(code) is str else "NON_STRING"})
                self.assertEqual(observed["receiptDetails"]["browser"]["error"],
                                 {"stage": "teacher_login_submit", "code": expected})
                self.assertEqual((observed["outcome"], observed["publicExitCode"]), ("ERROR", 1))
                self.assertNotIn(sentinel, json.dumps(observed))
        values = self.records()
        values[3]["site"]["browser"]["error"] = {"stage": "teacher_login_submit", "private": sentinel}
        error = self.project(self.rebind(values))["receiptDetails"]["browser"]["error"]
        self.assertEqual(error["code"], {"state": "MISSING"})
        self.assertNotIn(sentinel, json.dumps(error))

    def test_identity_marker_cannot_bypass_outer_stage_or_runtime_pin_binding(self):
        marker = "SYNTHETIC_LOGIN_IDENTITY_MISMATCH"
        values = self.records()
        values[3]["site"]["browser"]["error"] = {"stage": "teacher_login_submit", "code": marker}
        self.rebind(values)
        for target in ("public_operation", "journal_result"):
            changed = copy.deepcopy(values)
            if target == "public_operation":
                changed[0]["operation"]["operationId"] = "e" * 32
            else:
                changed[2]["result"]["site"]["browser"]["error"]["code"] = "RuntimeError"
            with self.subTest(target=target), self.assertRaisesRegex(harness.Failure, "^DIAGNOSTIC_BINDING$"):
                self.project(changed)
        changed = copy.deepcopy(values)
        changed[2]["stages"]["browser"]["evidence"]["error"]["code"] = "RuntimeError"
        self.assertEqual(self.project(changed)["receiptDetails"]["browser"], {"binding": "UNAVAILABLE"})
        for key, value in (("operationId", "e" * 32), ("installationId", "e" * 32), ("instanceId", "e" * 32),
                           ("invocationId", True), ("componentSha256", "e" * 64), ("componentRevision", "e" * 40)):
            changed = copy.deepcopy(values)
            changed[3]["site"]["browser"][key] = value
            with self.subTest(key=key):
                observed = self.project(self.rebind(changed))
                self.assertEqual(observed["receiptDetails"]["browser"], {"binding": "UNAVAILABLE"})
                self.assertEqual((observed["outcome"], observed["publicExitCode"]), ("ERROR", 1))

    def test_finalizer_collisions_now_preserve_distinct_nested_failures(self):
        with patch.object(harness, "now", return_value="fixed"):
            first, second = (self.project(self.records(browser_failed=value)) for value in (True, False))
        a, b = first.pop("receiptDetails"), second.pop("receiptDetails")
        self.assertEqual(first, second)  # The former projection cannot distinguish these actual finalizer outputs.
        self.assertEqual((first["publicExitCode"], first["managerExitCode"], first["outcome"]), (1, 1, "ERROR"))
        self.assertEqual(a["browser"]["reason"]["code"], "BROWSER_USER_FLOW_FAILED")
        self.assertEqual(a["browser"]["error"]["code"], {"state": "RECOGNIZED", "code": "API_STATUS", "httpStatus": 403})
        self.assertEqual(b["browser"]["reason"]["code"], "BROWSER_COMPONENT_MISSING")
        self.assertEqual(b["backup"]["encryption"]["error"]["code"], "AGE_RECIPIENT")
        self.assertEqual((a["rows"]["backup"], b["rows"]["backup"]), ("WARNING", "FAILED"))
        self.assertEqual(set(a["rows"]), set(harness.RECEIPT_ROWS))

    def test_reason_presence_types_and_unknown_values_do_not_copy_secrets(self):
        for value, expected in ((None, "NULL"), ("COMMAND", "RECOGNIZED"), ("PRIVATE_SECRET_CANARY", "UNRECOGNIZED"),
                ("COMMAND_PRIVATE_SECRET_CANARY", "UNRECOGNIZED"), ("COMMAND\n", "UNRECOGNIZED"),
                ("ＣOMMAND", "UNRECOGNIZED"), (True, "UNRECOGNIZED"), (42, "UNRECOGNIZED"),
                (["COMMAND"], "UNRECOGNIZED"), ({"code": "COMMAND"}, "UNRECOGNIZED")):
            with self.subTest(value=value):
                values = self.records()
                values[3]["reasonCode"] = value
                details = self.project(self.rebind(values))["receiptDetails"]
                self.assertEqual(details["topReason"]["state"], expected)
                self.assertNotIn("PRIVATE_SECRET_CANARY", json.dumps(details))
                if expected == "UNRECOGNIZED":
                    self.assertNotIn("code", details["topReason"])
        self.assertEqual(self.project(self.records())["receiptDetails"]["topReason"], {"state": "MISSING"})

    def test_only_canonical_http_and_closed_browser_markers_survive(self):
        for code in ("API_STATUS_100", "API_STATUS_200", "API_STATUS_403", "API_STATUS_599",
                     "SAVE_NOT_OBSERVED", "REOPEN_VALUE_MISMATCH", "REOPEN_DRAFT_MISMATCH", "RuntimeError"):
            values = self.records()
            values[3]["site"]["browser"]["error"]["code"] = code
            observed = self.project(self.rebind(values))["receiptDetails"]["browser"]["error"]["code"]
            self.assertEqual(observed["state"], "RECOGNIZED")
            self.assertEqual(observed.get("httpStatus"), int(code[-3:]) if code.startswith("API_STATUS_") else None)
        for code in ("API_STATUS_099", "API_STATUS_600", "API_STATUS_0403", "API_STATUS_４０３", "API_STATUS_403\n",
                "API_STATUS_403_PRIVATE_SECRET_CANARY", "API_STATUS_403\u200b", "api_status_403", "SAVE_NOT_OBSERVED_EXTRA",
                "PRIVATE_SECRET_CANARY", None, True, 403, ["API_STATUS_403"], {"code": "API_STATUS_403"}):
            with self.subTest(code=code):
                values = self.records()
                values[3]["site"]["browser"]["error"] = {"stage": "course_open_PRIVATE_SECRET_CANARY", "code": code}
                error = self.project(self.rebind(values))["receiptDetails"]["browser"]["error"]
                self.assertEqual(error["stage"], "UNRECOGNIZED")
                self.assertNotIn("httpStatus", error["code"])
                self.assertNotIn("code", error["code"])
                self.assertNotIn("PRIVATE_SECRET_CANARY", json.dumps(error))

    def test_browser_ids_stage_and_pinned_invocation_are_not_adopted(self):
        mutations = (("operationId", "e" * 32), ("installationId", "e" * 32), ("instanceId", "e" * 32),
            ("format", "foreign"), ("kind", "technical"), ("revision", "e" * 40), ("entryOrigin", "https://foreign.invalid"),
            ("invocationId", True), ("componentSha256", "e" * 64), ("componentRevision", "e" * 40))
        for key, value in mutations:
            with self.subTest(key=key):
                values = self.records()
                values[3]["site"]["browser"][key] = value
                self.assertEqual(self.project(self.rebind(values))["receiptDetails"]["browser"], {"binding": "UNAVAILABLE"})
        for change in ("stage", "technical", "missing_pin", "partial_provenance"):
            values = self.records()
            if change == "stage":
                values[2]["stages"]["browser"]["evidence"]["instanceId"] = "f" * 32
            elif change == "technical":
                values[3]["site"]["technical"]["installationId"] = values[3]["installationId"]
            elif change == "missing_pin":
                values[4]["browser"].pop("componentSha256")
            else:
                values[3]["site"]["browser"].pop("invocationId")
            self.assertEqual(self.project(self.rebind(values, stages=change != "stage"))["receiptDetails"]["browser"], {"binding": "UNAVAILABLE"})

    def test_early_browser_failure_is_observed_without_claiming_runtime_completion(self):
        values = self.records(browser_failed=False)
        values[3]["site"]["browser"].update(status="environment_failed", reasonCode="BROWSER_TIMEOUT")
        observed = self.project(self.rebind(values))["receiptDetails"]["browser"]
        self.assertEqual((observed["binding"], observed["runtimeProvenance"], observed["status"]),
                         ("VERIFIED_PARENT_OPERATION", "NOT_RECORDED", "environment_failed"))
        self.assertEqual(set(observed["checks"].values()), {"not_run"})
        values[3]["site"]["browser"]["checks"]["teacher_login"] = "passed"
        self.assertEqual(self.project(self.rebind(values))["receiptDetails"]["browser"], {"binding": "UNAVAILABLE"})
        values = self.records()
        values[3]["site"]["browser"]["status"] = "environment_failed"
        self.assertEqual(self.project(self.rebind(values))["receiptDetails"]["browser"], {"binding": "UNAVAILABLE"})

    def test_passed_browser_requires_complete_noncontradictory_bound_checks(self):
        values = self.records()
        browser = values[3]["site"]["browser"]
        browser.update(status="passed", checks={key: "passed" for key in harness.RECEIPT_BROWSER_CHECKS})
        browser.pop("error")
        browser.pop("reasonCode")
        self.assertEqual(self.project(self.rebind(values))["receiptDetails"]["browser"]["status"], "passed")
        for bad in (True, "passed\n", "PRIVATE_SECRET_CANARY", ["passed"], None):
            changed = copy.deepcopy(values)
            changed[3]["site"]["browser"]["checks"]["teacher_login"] = bad
            self.assertEqual(self.project(self.rebind(changed))["receiptDetails"]["browser"], {"binding": "UNAVAILABLE"})

    def test_first_backup_parent_and_declared_child_have_explicit_binding(self):
        values = self.records()
        self.assertEqual(self.project(values)["receiptDetails"]["backup"]["binding"], "VERIFIED_PARENT_OPERATION")
        child = "e" * 32
        values[3]["backup"]["operationId"] = child
        self.assertEqual(self.project(self.rebind(values))["receiptDetails"]["backup"], {"binding": "UNAVAILABLE"})
        values[2]["stages"]["first_backup"]["backupOperationId"] = child
        # Store.event replaces the old stage: a real replacement has a new
        # snapshot in its evidence, without retaining the original intent pin.
        values[2]["stages"]["first_backup"].pop("snapshotId")
        values[3]["backup"]["snapshotId"] = "20261104T130000Z-1234abcd"
        observed = self.project(self.rebind(values))["receiptDetails"]["backup"]
        self.assertEqual(observed["binding"], "DECLARED_FIRST_BACKUP_CHILD")
        self.assertNotIn(child, json.dumps(observed))
        for key, value in (("backupOperationId", None), ("backupOperationId", True), ("backupOperationId", "f" * 32),
                           ("backupOperationId", "e" * 31 + "ｅ"), ("snapshotId", "20261104T120000Z-ffffffff")):
            changed = copy.deepcopy(values)
            changed[2]["stages"]["first_backup"][key] = value
            self.assertEqual(self.project(self.rebind(changed))["receiptDetails"]["backup"], {"binding": "UNAVAILABLE"})

    def test_backup_stage_identity_and_policy_mismatches_remain_unavailable(self):
        for where, key, value in (("backup", "installationId", "e" * 32), ("backup", "format", "foreign"),
                ("backup", "snapshotId", True), ("stage", "status", "intent"), ("policy", "policy", "required"),
                ("evidence", "outcome", "ACCEPTED")):
            values = self.records()
            target = {"backup": values[3]["backup"], "stage": values[2]["stages"]["first_backup"],
                      "policy": values[2]["backupPolicy"], "evidence": values[2]["stages"]["first_backup"]["evidence"]}[where]
            target[key] = value
            self.assertEqual(self.project(self.rebind(values, stages=where != "evidence"))["receiptDetails"]["backup"], {"binding": "UNAVAILABLE"})

    def test_backup_finalizer_missing_snapshot_normalization_is_bound(self):
        from deployment import setup_result
        values = self.records()
        receipt = values[3]
        receipt["backup"]["local"] = {"status": "FAILED", "executionStatus": "NOT_RUN", "error": "BACKUP_RESUME_SNAPSHOT_MISSING"}
        values[2]["stages"]["first_backup"]["evidence"] = copy.deepcopy(receipt["backup"])
        setup_result.finalize(receipt)
        observed = self.project(self.rebind(values, stages=False))["receiptDetails"]["backup"]
        self.assertEqual(observed["binding"], "VERIFIED_PARENT_OPERATION")
        self.assertEqual(observed["local"]["status"], "NOT_RUN")
        self.assertEqual(observed["local"]["error"]["code"], "BACKUP_RESUME_SNAPSHOT_MISSING")

    def test_closed_values_and_extra_keys_never_export_private_content(self):
        values = self.records(browser_failed=False)
        receipt = values[3]
        sentinel = "PRIVATE_SECRET_CANARY"
        for record in (receipt, receipt["site"], receipt["site"]["browser"], receipt["backup"], receipt["backup"]["local"]):
            record["private"] = {"password": sentinel, "path": sentinel, "fixtureId": sentinel, "entryOrigin": sentinel}
        receipt["site"]["browser"]["reasonCode"] = "BROWSER_COMPONENT_MISSING_" + sentinel
        receipt["backup"]["cloud"] = {"status": "FAILED", "error": "CLOUD_TRANSFER_FAILED"}
        receipt["backup"]["errors"] = [{"code": "AGE_RECIPIENT", "at": sentinel, "body": sentinel}] * 20
        before = copy.deepcopy(self.rebind(values))
        with patch.object(harness, "diagnostic_read", side_effect=AssertionError("new file read")), \
                patch.object(harness.subprocess, "run", side_effect=AssertionError("new command")), \
                patch.object(harness.urllib.request, "urlopen", side_effect=AssertionError("new network")):
            details = self.project(values)["receiptDetails"]
        self.assertEqual(values, before)
        self.assertNotIn(sentinel, json.dumps(details))
        self.assertEqual(details["browser"]["reason"]["state"], "UNRECOGNIZED")
        self.assertEqual(details["backup"]["cloud"]["error"]["code"], "CLOUD_TRANSFER_FAILED")
        self.assertEqual(len(details["backup"]["errors"]["codes"]), 16)
        self.assertTrue(details["backup"]["errors"]["truncated"])
        for bad in (True, 1, [], {}, "OK\n", "ＯK", sentinel):
            changed = copy.deepcopy(values)
            changed[3]["version"]["status"] = bad
            changed[3]["backup"]["encryption"] = {"status": bad, "error": bad}
            details = self.project(self.rebind(changed))["receiptDetails"]
            self.assertEqual(details["rows"]["version"], "UNRECOGNIZED")
            self.assertEqual(details["backup"]["encryption"]["status"], "UNRECOGNIZED")
            self.assertNotIn("code", details["backup"]["encryption"]["error"])

    def test_original_public_failed_one_survives_nested_unavailable_and_observation(self):
        for mismatch in (False, True):
            values = self.records()
            if mismatch:
                values[3]["site"]["browser"]["operationId"] = "e" * 32
                self.rebind(values)
            output = io.StringIO()
            with PostSwitchReasonTests.observation(self, values) as (public, invocation), \
                    patch.object(harness, "CLI_ACTIONS", []), \
                    patch.object(harness, "guest_phase", side_effect=lambda *_: harness.public_cli_result(
                        ["install"], 1, json.dumps(public), invocation=invocation)), contextlib.redirect_stdout(output):
                code = harness.guest_main("install")
            observed = json.loads(output.getvalue())
            self.assertEqual((code, observed["status"], observed["reasonCode"]), (1, "FAIL", "PUBLIC_CLI_FAILED"))
            self.assertEqual((observed["cliActions"][0]["exitCode"], observed["cliActions"][0]["status"]), (1, "FAILED"))
            self.assertEqual(observed["cliActions"][0]["reasonCodes"], [])
            proof = observed["commandFailureDiagnostic"]
            self.assertEqual((proof["publicExitCode"], proof["managerExitCode"], proof["outcome"]), (1, 1, "ERROR"))
            self.assertEqual(proof["receiptDetails"]["browser"]["binding"], "UNAVAILABLE" if mismatch else "VERIFIED_PARENT_OPERATION")


class SwitchDiagnosticTests(unittest.TestCase):
    def fixture(self):
        second = harness.timestamp_ns("2026-11-04T12:00:00Z")
        invocation = {"startedNs": second + 200_000_000, "finishedNs": second + 800_000_000}
        config = {"project": "asa-lab-dev", "profile": "production"}
        images = {name: "ghcr.io/spikeal8-maker/asa-lab/" + name + "@sha256:" + "a" * 64
                  for name in ("api", "web", "scratch", "minio", "search")}
        journal = {"project": config["project"], "release": {"images": images}}
        expected = harness.switch_image_references(config, journal)
        files = [str(harness.INSTALL_ROOT / name) for name in ("compose.yaml", "compose.production.yaml")]
        records = []
        for index, service in enumerate(harness.SWITCH_SERVICES):
            exited = service in ("migration", "minio-init")
            records.append({"id": format(index + 1, "064x"), "name": "/asa-lab-dev-" + service + "-1",
                "created": "2026-11-04T12:00:00.300000000Z", "image": expected[service], "imageId": "sha256:" + "b" * 64,
                "project": config["project"], "service": service, "root": str(harness.INSTALL_ROOT), "files": ",".join(files), "oneoff": "False",
                "state": "exited" if exited else "running", "running": not exited, "dead": False, "oomKilled": False,
                "exitCode": 1 if service == "migration" else 0, "restarts": 0, "health": "none", "error": "",
                "started": "2026-11-04T12:00:00.400000000Z",
                "finished": "2026-11-04T12:00:00.600000000Z" if exited else "0001-01-01T00:00:00Z"})
        return config, journal, invocation, files, records

    def stamped(self, lines, *, timestamp="2026-11-04T12:00:00.600000000Z"):
        return "".join(timestamp + " " + line + "\n" for line in lines).encode()

    def observe(self, *, before=None, after=None, inspect_override=None, command_failure=None, log_streams=None):
        config, journal, invocation, files, normal = self.fixture()
        before = normal if before is None else before
        after = json.loads(json.dumps(before)) if after is None else after
        counters = {"ps": 0, "inspect": 0}
        self.calls = []
        def command(args, **options):
            self.calls.append((args, options))
            verb = args[1]
            self.assertEqual(args[0], "docker")
            self.assertIn(verb, ("info", "ps", "inspect", "logs"))
            self.assertGreater(options["timeout"], 0)
            self.assertLessEqual(options["timeout"], 8)
            self.assertEqual(options["owner"]["uid"], 999)
            self.assertEqual(options["environment"]["DOCKER_HOST"], "unix:///var/run/docker.sock")
            self.assertNotIn("GH_TOKEN", options["environment"])
            self.assertNotIn("HTTPS_PROXY", options["environment"])
            proof = {"exitCode": 0, "actualUid": 999}
            if (command_failure and verb == command_failure[0]
                    and (len(command_failure) == 3 or sum(call[0][1] == verb for call in self.calls) == command_failure[3])):
                return command_failure[1], command_failure[2]
            if verb == "info":
                return proof, b"synthetic-daemon\n"
            if verb == "ps":
                counters[verb] += 1
                records = before if counters[verb] <= 2 else after
                return proof, "\n".join(row["id"] for row in records).encode()
            if verb == "inspect":
                counters[verb] += 1
                records = (before if inspect_override is None else inspect_override) if counters[verb] == 1 else after
                return proof, "\n".join(json.dumps(row) for row in records).encode()
            self.assertTrue(options["return_streams"])
            self.assertNotIn("--details", args)
            self.assertNotIn("--follow", args)
            self.assertIn("--since", args)
            self.assertIn("--until", args)
            self.assertEqual(args[args.index("--tail") + 1], "200")
            return proof, log_streams if log_streams is not None else (b"", self.stamped(["db:migrate FAIL: permission denied for schema PRIVATE"]))
        owner = {"uid": 999, "gid": 999, "name": "asa-setup"}
        environment = {"PATH": "/usr/bin:/bin", "HOME": "/var/lib/asa-setup/operator", "GH_TOKEN": "PRIVATE_TOKEN",
                       "HTTPS_PROXY": "PRIVATE_PROXY", "DOCKER_HOST": "tcp://foreign"}
        with patch.object(harness, "switch_expected_files", return_value=files), \
                patch.object(harness, "root_json", return_value={"daemonIdentitySha256": hashlib.sha256(b"synthetic-daemon").hexdigest()}), \
                patch.object(harness, "diagnostic_command", side_effect=command):
            return harness.switch_failure_observation(owner, environment, config, journal, invocation)

    def test_complete_owned_inventory_includes_both_one_shot_services_and_only_read_commands(self):
        observed = self.observe()
        self.assertTrue(observed["completeInventory"])
        self.assertTrue(observed["immutableIdentityRechecked"])
        self.assertEqual(set(observed["services"]), set(harness.SWITCH_SERVICES))
        migration = observed["services"]["migration"]
        self.assertEqual(migration["before"]["containerExitCode"], 1)
        self.assertTrue(migration["before"]["processExited"])
        self.assertEqual(observed["services"]["minio-init"]["before"]["containerExitCode"], 0)
        self.assertEqual(observed["composeExitCode"], "UNAVAILABLE")
        self.assertFalse(observed["causalProof"])
        self.assertEqual(observed["logSamples"], 1)
        self.assertIn("MIGRATION_RUNNER_FAILURE", migration["log"]["ruleIds"])
        self.assertEqual(migration["log"]["sqlstates"], [])  # A message is not an observed SQLSTATE.
        self.assertNotIn("PRIVATE", json.dumps(observed))
        self.assertTrue(all(call[0][1] in ("info", "ps", "inspect", "logs") for call in self.calls))

    def api_lifecycle_line(self, **changes):
        # Exact lifecycleEvent JSON shape from both pinned 98d7fbb and 959d520
        # apps/api/src/owned-pool-lifecycle.ts; the producer writes to stderr.
        value = {"kind": "api_lifecycle", "level": "error", "time": "2026-11-04T12:00:00.600Z",
                 "phase": "startup_failed", "errorCode": "internal_error", "errorClass": "Error"}
        value.update(changes)
        return json.dumps(value, separators=(",", ":"))

    def test_running_starting_api_with_four_restarts_is_sampled_in_original_invocation_window(self):
        records = self.fixture()[-1]
        for row in records:
            if row["service"] not in ("migration", "minio-init"):
                row["health"] = "healthy"
            if row["service"] == "migration":
                row.update(exitCode=0, health="unhealthy")
            if row["service"] == "api":
                row.update(health="starting", restarts=4, started="2026-11-04T12:00:00.900000000Z",
                           finished="2026-11-04T12:00:00.600000000Z")
            if row["service"] == "web":
                row.update(state="created", running=False, health="none", started="0001-01-01T00:00:00Z")
        observed = self.observe(before=records, log_streams=(b"", self.stamped([self.api_lifecycle_line()])))
        self.assertEqual((observed["logSamples"], observed["eligibleLogsNotSampled"]), (2, 0))
        api = observed["services"]["api"]
        self.assertEqual((api["before"]["state"], api["before"]["health"], api["before"]["restarts"]),
                         ("running", "starting", 4))
        self.assertFalse(api["before"]["startedDuringInvocation"])
        self.assertTrue(api["before"]["finishedDuringInvocation"])
        self.assertEqual(api["log"]["ruleIds"], ["API_STARTUP_FAILED"])
        self.assertFalse(api["log"]["causalProof"])
        self.assertFalse(observed["causalProof"])
        requested = [call[0] for call in self.calls if call[0][1] == "logs"]
        self.assertEqual([args[-1] for args in requested], [records[2]["id"], records[4]["id"]])
        for args in requested:
            self.assertEqual(args[args.index("--since") + 1], "1793793600.200000000")
            self.assertEqual(args[args.index("--until") + 1], "1793793600.800000000")
        for row in records:
            row.update(health="starting", restarts=4)
        bounded = self.observe(before=records)
        self.assertEqual((bounded["logSamples"], bounded["eligibleLogsNotSampled"]), (4, 4))
        self.assertEqual(sum(call[0][1] == "logs" for call in self.calls), 4)

    def test_pinned_api_lifecycle_projects_only_closed_phase_code_and_class(self):
        invocation = self.fixture()[2]
        for phase, rule in (("startup_failed", "API_STARTUP_FAILED"), ("nest_error", "API_NEST_ERROR")):
            for code in ("database_query_timeout", "database_connection_timeout", "upstream_connection_failed", "internal_error"):
                for error_class in ("Error", "ClassroomCodeSecretConfigError", "StudentCodeProtectionConfigError"):
                    with self.subTest(phase=phase, code=code, error_class=error_class):
                        raw = self.stamped([self.api_lifecycle_line(phase=phase, errorCode=code, errorClass=error_class)])
                        observed = harness.switch_log_projection((b"", raw), "api", invocation)
                        self.assertEqual(observed, {"status": "OBSERVED", "ruleIds": [rule], "sqlstates": [],
                            "readBytes": len(raw), "scope": "BOUND_CONTAINER_INVOCATION_LOG", "causalProof": False,
                            "apiLifecycle": [{"phase": phase, "errorCode": code, "errorClass": error_class}]})

    def test_api_lifecycle_rejects_malformed_duplicate_nested_extra_and_unknown_fields(self):
        invocation = self.fixture()[2]
        line = self.api_lifecycle_line()
        private = "PRIVATE_LIFECYCLE_SECRET_MUST_NOT_ESCAPE"
        cases = [line[:-1], line + line, "[" + line + "]", "null", "true", "{}", line + private,
            line[:-1] + ',"phase":"startup_failed"}',
            line[:-1] + ',"phase":"nest_error"}',
            line[:-1] + ',"errorCode":"' + private + '"}',
            line[:-1] + ',"error\\u0043ode":"internal_error"}',
            self.api_lifecycle_line(message=private), self.api_lifecycle_line(frames=[]),
            self.api_lifecycle_line(kind="database_pool_error"), self.api_lifecycle_line(level="info"),
            self.api_lifecycle_line(phase="pool_query_close_failed"), self.api_lifecycle_line(phase=private),
            self.api_lifecycle_line(errorCode="42501"), self.api_lifecycle_line(errorCode=private),
            self.api_lifecycle_line(errorClass="UnknownError"), self.api_lifecycle_line(errorClass=private)]
        source = json.loads(line)
        for key in source:
            cases.append(json.dumps({name: value for name, value in source.items() if name != key}))
            for value in (None, False, 1, 1.5, [], {"secret": private}):
                cases.append(self.api_lifecycle_line(**{key: value}))
        for index, candidate in enumerate(cases):
            with self.subTest(case=index):
                observed = harness.switch_log_projection((b"", self.stamped([candidate])), "api", invocation)
                self.assertEqual((observed["status"], observed["ruleIds"], observed["sqlstates"]), ("NO_MATCH", [], []))
                self.assertNotIn("apiLifecycle", observed)
                self.assertNotIn(private, json.dumps(observed))

    def test_api_lifecycle_requires_producer_time_service_and_bound_docker_timestamp(self):
        invocation = self.fixture()[2]
        for producer_time in ("PRIVATE_TIME", "2026-11-04T12:00:00Z", "2026-11-04T12:00:00.600+00:00",
                              "2026-02-30T12:00:00.600Z", "2026-11-04T25:00:00.600Z", "2026-11-04T12:00:00.6000Z",
                              "2026-11-04T12:00:00.199Z", "2026-11-04T12:00:00.801Z"):
            raw = self.stamped([self.api_lifecycle_line(time=producer_time)])
            with self.subTest(time=producer_time):
                self.assertEqual(harness.switch_log_projection((b"", raw), "api", invocation)["status"], "NO_MATCH")
        for stamp in ("2026-11-04T12:00:00.199999999Z", "2026-11-04T12:00:00.800000001Z", "PRIVATE_TIMESTAMP"):
            with self.subTest(stamp=stamp):
                raw = self.stamped([self.api_lifecycle_line()], timestamp=stamp)
                self.assertEqual(harness.switch_log_projection((b"", raw), "api", invocation)["status"], "NO_MATCH")
        raw = self.stamped([self.api_lifecycle_line()])
        for service in set(harness.SWITCH_SERVICES) - {"api"}:
            with self.subTest(service=service):
                self.assertEqual(harness.switch_log_projection((b"", raw), service, invocation)["status"], "NO_MATCH")
        self.assertEqual(harness.switch_log_projection((b"", self.api_lifecycle_line().encode()), "api", invocation)["status"], "NO_MATCH")

    def test_api_lifecycle_never_joins_lines_or_streams_and_preserves_independent_events(self):
        invocation = self.fixture()[2]
        line = self.api_lifecycle_line()
        left, right = line.split(',"phase":', 1)
        left += ","
        right = '"phase":' + right
        for streams in ((self.stamped([line]), b""),
                        (self.stamped([left]), self.stamped([right])),
                        (self.stamped([right]), self.stamped([left])),
                        (b"", self.stamped([left, right]))):
            with self.subTest(streams=streams):
                self.assertEqual(harness.switch_log_projection(streams, "api", invocation)["status"], "NO_MATCH")
        second = self.api_lifecycle_line(phase="nest_error", errorCode="database_query_timeout")
        streams = (b"PRIVATE_UNFRAMED\n", self.stamped([line, second, line, left]))
        observed = harness.switch_log_projection(streams, "api", invocation)
        self.assertEqual(observed["ruleIds"], ["API_NEST_ERROR", "API_STARTUP_FAILED"])
        self.assertEqual(observed["apiLifecycle"], [
            {"phase": "nest_error", "errorCode": "database_query_timeout", "errorClass": "Error"},
            {"phase": "startup_failed", "errorCode": "internal_error", "errorClass": "Error"}])
        self.assertNotIn("PRIVATE", json.dumps(observed))

    def test_foreign_binding_duplicate_ids_and_duplicate_services_are_rejected_before_logs(self):
        for key, value in (("project", "foreign"), ("root", "/foreign"), ("files", "/foreign/compose.yaml"),
                           ("image", "foreign/image:latest"), ("service", "foreign"), ("oneoff", "True"),
                           ("created", "2026-11-04T11:59:59.999999999Z")):
            records = self.fixture()[-1]
            records[0][key] = value
            with self.subTest(key=key), self.assertRaises(harness.Failure):
                self.observe(before=records)
            self.assertFalse(any(call[0][1] == "logs" for call in self.calls))
        for duplicate in ("id", "service"):
            records = self.fixture()[-1]
            records[1][duplicate] = records[0][duplicate]
            records[1]["image"] = records[0]["image"]
            with self.subTest(duplicate=duplicate), self.assertRaises(harness.Failure):
                self.observe(before=records)
            self.assertFalse(any(call[0][1] == "logs" for call in self.calls))

    def test_incomplete_inventory_never_becomes_absence_or_reads_logs(self):
        records = self.fixture()[-1]
        with self.assertRaisesRegex(harness.Failure, "DIAGNOSTIC_INVENTORY"):
            self.observe(inspect_override=records[:-1])
        self.assertFalse(any(call[0][1] == "logs" for call in self.calls))
        complete_missing = self.observe(before=records[:-1])
        self.assertEqual(complete_missing["services"]["scratch"], {"presence": "NOT_PRESENT"})

    def test_immutable_identity_change_discards_collected_observation_but_state_change_is_visible(self):
        records = self.fixture()[-1]
        changed = json.loads(json.dumps(records))
        changed[2]["name"] += "-changed"
        with self.assertRaisesRegex(harness.Failure, "DIAGNOSTIC_CHANGED"):
            self.observe(before=records, after=changed)
        changed = json.loads(json.dumps(records))
        changed[2]["exitCode"] = 2
        observed = self.observe(before=records, after=changed)
        self.assertTrue(observed["services"]["migration"]["stateChanged"])
        self.assertEqual(observed["services"]["migration"]["after"]["containerExitCode"], 2)

    def test_unknown_metadata_and_private_inspect_fields_never_reach_evidence(self):
        secret = "PRIVATE_CREDENTIAL_MUST_NEVER_APPEAR"
        records = self.fixture()[-1]
        records[0].update(error=secret, environment={"PASSWORD": secret}, argv=[secret], healthOutput=secret)
        observed = self.observe(before=records)
        self.assertNotIn(secret, json.dumps(observed))
        records[0]["state"] = secret
        with self.assertRaises(harness.Failure):
            self.observe(before=records)
        self.assertFalse(any(call[0][1] == "logs" for call in self.calls))

    def test_log_sample_count_output_cap_and_timeout_are_bounded_without_partial_classification(self):
        records = self.fixture()[-1]
        for row in records:
            row["health"] = "unhealthy"
        observed = self.observe(before=records)
        self.assertEqual((observed["logSamples"], observed["eligibleLogsNotSampled"]), (4, 4))
        self.assertEqual(sum(call[0][1] == "logs" for call in self.calls), 4)
        for reason in ("DIAGNOSTIC_TIMEOUT", "DIAGNOSTIC_OUTPUT_LIMIT"):
            observed = self.observe(command_failure=("logs", {"exitCode": -15, "reasonCode": reason}, (b"PRIVATE", b"")))
            self.assertEqual(observed["services"]["migration"]["log"]["reasonCode"], reason)
            self.assertNotIn("PRIVATE", json.dumps(observed))
        observed = self.observe(log_streams=(b"X" * (harness.DIAGNOSTIC_LIMIT + 1), b""))
        self.assertEqual(observed["services"]["migration"]["log"]["reasonCode"], "DIAGNOSTIC_OUTPUT_LIMIT")
        with self.assertRaisesRegex(harness.Failure, "DIAGNOSTIC_TIMEOUT"):
            self.observe(command_failure=("info", {"exitCode": -15, "reasonCode": "DIAGNOSTIC_TIMEOUT"}, b"PRIVATE"))
        with patch.object(harness.time, "monotonic", side_effect=(0, 61)), self.assertRaisesRegex(harness.Failure, "DIAGNOSTIC_TIMEOUT"):
            self.observe()
        self.assertEqual(self.calls, [])
        self.assertEqual(harness.SWITCH_SECONDS, 60)

    def test_failed_docker_read_reports_only_bound_step_verb_exit_and_category(self):
        steps = (("daemonBefore", "info", 1), ("beforeList", "ps", 1), ("beforeInspect", "inspect", 1),
            ("beforeRecheck", "ps", 2), ("containerLogs", "logs", 1), ("afterList", "ps", 3),
            ("afterInspect", "inspect", 2), ("afterRecheck", "ps", 4), ("daemonAfter", "info", 2))
        for step, verb, occurrence in steps:
            with self.subTest(step=step):
                failure = (verb, {"exitCode": 1, "actualUid": 999, "argv": ["PRIVATE"]}, b"PRIVATE", occurrence)
                if verb == "logs":
                    observed = self.observe(command_failure=failure)["services"]["migration"]["log"]
                else:
                    with self.assertRaises(harness.Failure) as caught:
                        self.observe(command_failure=failure)
                    observed = harness.command_diagnostic_error(caught.exception)
                self.assertEqual(observed["reasonCode"], "DIAGNOSTIC_DOCKER_EXIT")
                self.assertEqual(observed["failedObservation"], {"step": step, "verb": verb,
                    "category": "NONZERO_EXIT", "attempted": True, "exitCode": 1})
                self.assertNotIn("PRIVATE", json.dumps(observed))

    def test_failed_read_categories_and_projection_reject_unknown_values_and_secrets(self):
        for proof, category in (({"exitCode": -15, "reasonCode": "DIAGNOSTIC_TIMEOUT"}, "TIMEOUT"),
                ({"exitCode": -9, "reasonCode": "DIAGNOSTIC_OUTPUT_LIMIT"}, "OUTPUT_LIMIT"),
                ({"reasonCode": "DIAGNOSTIC_PROCESS_OWNERSHIP"}, "PROCESS_OWNERSHIP"),
                ({"reasonCode": "DIAGNOSTIC_PROCESS_CLEANUP"}, "PROCESS_CLEANUP"),
                ({"exitCode": True}, "INVALID_RESULT"), ({"exitCode": "PRIVATE"}, "INVALID_RESULT"),
                ({"reasonCode": "PRIVATE"}, "PROBE_FAILURE"), ({"exitCode": 0, "actualUid": 0}, "UID_MISMATCH")):
            with self.subTest(category=category), self.assertRaises(harness.Failure) as caught:
                self.observe(command_failure=("info", proof, b"PRIVATE"))
            observed = harness.command_diagnostic_error(caught.exception)
            self.assertEqual(observed["failedObservation"]["category"], category)
            self.assertNotIn("PRIVATE", json.dumps(observed))
        with patch.object(harness.time, "monotonic", side_effect=(0, 61)), self.assertRaises(harness.Failure) as caught:
            self.observe()
        self.assertEqual(harness.command_diagnostic_error(caught.exception)["failedObservation"],
            {"step": "daemonBefore", "verb": "info", "category": "BUDGET_EXHAUSTED", "attempted": False, "exitCode": "UNAVAILABLE"})
        trusted = {"step": "beforeInspect", "verb": "inspect", "category": "NONZERO_EXIT", "attempted": True,
            "exitCode": 1, "raw": "PRIVATE", "cleanupReasonCode": "PRIVATE"}
        for key, value in (("step", "PRIVATE"), ("verb", "exec"), ("category", "PRIVATE"), ("attempted", "PRIVATE")):
            self.assertEqual(harness.switch_command_projection({**trusted, key: value}), {})
        for exit_code in (True, "PRIVATE", -129, 256):
            observed = harness.switch_command_projection({**trusted, "exitCode": exit_code})
            self.assertEqual(observed["exitCode"], "UNAVAILABLE")
            self.assertNotIn("PRIVATE", json.dumps(observed))

    def test_native_compose_forms_are_multistage_observations_not_causal_proof(self):
        raw = (b'service "migration" didn\x27t complete successfully: exit 1\n'
               b'dependency failed to start: container asa-lab-dev-postgres-1 is unhealthy\n'
               b'Error response from daemon: failed to create task for container: PRIVATE\n'
               b'service "PRIVATE" didn\x27t complete successfully: exit 2\n')
        observed = harness.command_log_classification(raw, "switch")
        self.assertEqual(observed["status"], "OBSERVED")
        self.assertEqual(observed["nativeCompose"]["serviceExitCodes"], {"migration": 1})
        self.assertEqual(set(observed["nativeCompose"]["ruleIds"]),
                         {"COMPOSE_SERVICE_EXIT", "COMPOSE_DEPENDENCY_UNHEALTHY", "DAEMON_CONTAINER_TASK_FAILURE"})
        self.assertEqual(observed["scope"], "PUBLIC_INVOCATION_MULTI_STAGE")
        self.assertFalse(observed["causalProof"])
        self.assertNotIn("PRIVATE", json.dumps(observed))

    def test_switch_observer_requires_bound_switch_and_preserves_command_failure(self):
        fixture = CommandFailureDiagnosticTests()
        with fixture.diagnostic_timestamp_fixture() as (public, invocation), \
                patch.object(harness, "switch_failure_observation") as observer:
            harness.command_failure_diagnostic(["install"], 2, public, invocation)
        observer.assert_not_called()
        for outcome in (self.observe(), harness.Failure("DIAGNOSTIC_INVENTORY"),
                        harness.switch_command_failure("beforeInspect", "NONZERO_EXIT", {"exitCode": 1})):
            output = io.StringIO()
            with self.subTest(outcome=type(outcome).__name__), fixture.diagnostic_timestamp_fixture(switch=True) as (public, invocation), \
                    patch.object(harness, "switch_failure_observation", **({"side_effect": outcome} if isinstance(outcome, Exception)
                                                                            else {"return_value": outcome})) as observer, \
                    patch.object(harness, "CLI_ACTIONS", []), \
                    patch.object(harness, "guest_phase", side_effect=lambda *_: harness.public_cli_result(
                        ["install"], 2, json.dumps(public), invocation=invocation)), contextlib.redirect_stdout(output):
                code = harness.guest_main("install")
            observer.assert_called_once()
            result = json.loads(output.getvalue())
            self.assertEqual((code, result["status"], result["reasonCode"]), (1, "FAIL", "COMMAND"))
            self.assertEqual(result["cliActions"][0]["exitCode"], 2)
            self.assertEqual(result["commandFailureDiagnostic"]["switchObservation"]["status"],
                             "UNAVAILABLE" if isinstance(outcome, Exception) else "OBSERVED")

    def test_cli_permission_metadata_is_separate_and_never_retries_rejected_content(self):
        fixture = CommandFailureDiagnosticTests()
        with fixture.diagnostic_timestamp_fixture() as (public, invocation), \
                patch.object(harness, "cli_log_path_metadata", return_value={"status": "OBSERVED", "contentRead": False,
                                                                            "firstRejectedLabel": "varLib"}) as metadata:
            original = harness.diagnostic_read.side_effect
            rejected = []
            def read(path, *args, **kwargs):
                if path.parent == harness.OPERATOR_LOG_ROOT:
                    rejected.append(path)
                    raise harness.Failure("DIAGNOSTIC_PERMISSIONS")
                return original(path, *args, **kwargs)
            harness.diagnostic_read.side_effect = read
            observed = harness.command_failure_diagnostic(["install"], 2, public, invocation)
        self.assertEqual(len(rejected), 1)
        metadata.assert_called_once()
        self.assertEqual(observed["logs"]["cli"]["reasonCode"], "DIAGNOSTIC_PERMISSIONS")
        self.assertEqual(observed["logs"]["cli"]["pathMetadata"]["firstRejectedLabel"], "varLib")
        self.assertFalse(observed["logs"]["cli"]["pathMetadata"]["contentRead"])

    def test_pinned_runtime_role_producer_form_extracts_only_recognized_sqlstate(self):
        invocation = self.fixture()[2]
        lines = ["error: PRIVATE SQL AND ROLE", "    at async file:///app/docker/provision-runtime-role.mjs:15:3 {",
                 "  length: 123,", "  severity: 'ERROR',", "  code: '42501',", "  detail: 'PRIVATE PASSWORD',", "}"]
        observed = harness.switch_log_projection((b"", self.stamped(lines)), "migration", invocation)
        self.assertEqual(set(observed["ruleIds"]), {"RUNTIME_ROLE_PROVISION_FAILURE", "POSTGRES_SERVER_ERROR"})
        self.assertEqual(observed["sqlstates"], ["42501"])
        self.assertNotIn("PRIVATE", json.dumps(observed))
        for changed in ([item.replace("42501", "TOKNX") for item in lines], lines[2:], lines[:-1],
                        [item.removesuffix(" {") for item in lines],
                        [item.replace("provision-runtime-role.mjs", "unknown.mjs") for item in lines]):
            self.assertEqual(harness.switch_log_projection((self.stamped(changed), b""), "migration", invocation)["sqlstates"], [])
        outside = self.stamped(lines, timestamp="2026-11-04T12:00:00.800000001Z")
        self.assertEqual(harness.switch_log_projection((outside, b""), "migration", invocation)["status"], "NO_MATCH")
        self.assertEqual(harness.switch_log_projection((self.stamped(lines), b""), "minio", invocation)["status"], "NO_MATCH")
        protocol = [lines[0], "    at Parser.parseErrorMessage (/app/node_modules/.pnpm/pg-protocol@1.15.0/node_modules/pg-protocol/dist/parser.js:285:98) {",
                    *lines[2:]]
        observed = harness.switch_log_projection((self.stamped(protocol), b""), "migration", invocation)
        self.assertEqual(observed["sqlstates"], ["42501"])
        self.assertEqual(observed["ruleIds"], ["POSTGRES_SERVER_ERROR"])

    def test_sqlstate_never_joins_stdout_and_stderr_object_fragments(self):
        invocation = self.fixture()[2]
        opening = ["error: PRIVATE", "    at async file:///app/docker/provision-runtime-role.mjs:15:3 {"]
        fields = ["  severity: 'ERROR',", "  code: '42501',", "}"]
        for streams in ((self.stamped(opening), self.stamped(fields)),
                        (self.stamped(fields), self.stamped(opening))):
            observed = harness.switch_log_projection(streams, "migration", invocation)
            self.assertEqual((observed["status"], observed["sqlstates"]), ("NO_MATCH", []))
        for streams in ((self.stamped(opening + fields), b""), (b"", self.stamped(opening + fields))):
            self.assertEqual(harness.switch_log_projection(streams, "migration", invocation)["sqlstates"], ["42501"])

    def test_sqlstate_rejects_fields_before_opening_or_gaps_in_object(self):
        invocation = self.fixture()[2]
        header = "error: PRIVATE"
        frame = "    at async file:///app/docker/provision-runtime-role.mjs:15:3 {"
        for fields in (("  code: '42501',", "  severity: 'ERROR',"), ("  severity: 'ERROR',", "  code: '42501',")):
            for lines in ([header, fields[0], frame, fields[1], "}"],
                          [header, fields[0], frame, *fields, "}"]):
                observed = harness.switch_log_projection((self.stamped(lines), b""), "migration", invocation)
                self.assertEqual((observed["status"], observed["sqlstates"]), ("NO_MATCH", []))
        for gap in (b"unframed PRIVATE\n", self.stamped(["PRIVATE"], timestamp="2026-11-04T12:00:01Z")):
            raw = self.stamped([header, frame, "  severity: 'ERROR',"]) + gap + self.stamped(["  code: '42501',", "}"])
            self.assertEqual(harness.switch_log_projection((raw, b""), "migration", invocation)["status"], "NO_MATCH")

    def test_sqlstate_rejects_duplicate_and_conflicting_code_or_severity(self):
        invocation = self.fixture()[2]
        opening = ["error: PRIVATE", "    at async file:///app/docker/provision-runtime-role.mjs:15:3 {"]
        fields = ["  severity: 'ERROR',", "  code: '42501',"]
        for duplicate in ("  code: '42501',", "  code: '28P01',", "  code: 'ECONNREFUSED',",
                          "  severity: 'ERROR',", "  severity: 'FATAL',", "  code: 'PRIVATE',"):
            observed = harness.switch_log_projection((self.stamped(opening + fields + [duplicate, "}"]), b""), "migration", invocation)
            self.assertEqual((observed["status"], observed["sqlstates"]), ("NO_MATCH", []))
            self.assertNotIn("PRIVATE", json.dumps(observed))

    def test_sqlstate_rejects_nested_property_codes_with_or_without_inner_closing(self):
        invocation = self.fixture()[2]
        opening = ["error: synthetic wrapper failure",
                   "    at async file:///app/docker/provision-runtime-role.mjs:15:3 {",
                   "  expected: {", "    severity: 'ERROR',", "    code: '42501',"]
        for closing in (["  }", "}"], ["}"]):
            with self.subTest(inner_closed=len(closing) == 2):
                observed = harness.switch_log_projection((b"", self.stamped(opening + closing)), "migration", invocation)
                self.assertEqual((observed["status"], observed["ruleIds"], observed["sqlstates"]), ("NO_MATCH", [], []))

    def test_sqlstate_rejects_non_scalar_multiline_and_broken_property_shapes(self):
        invocation = self.fixture()[2]
        opening = ["error: PRIVATE", "    at async file:///app/docker/provision-runtime-role.mjs:15:3 {"]
        fields = ["  severity: 'ERROR',", "  code: '42501',"]
        invalid = (
            ["  detail: { expected: 'PRIVATE' },"],
            ["  detail: [ 'PRIVATE' ],"],
            ["  detail: 'PRIVATE", "continued',"],
            ["  detail: 'PRIVATE' +", "    'continued',"],
            ["    detail: 'PRIVATE',"],
            ["  detail: [Getter],"],
            ["  detail: Symbol(PRIVATE),"],
            ["  detail: 'PRIVATE' unexpected,"],
            ["  detail: 'PRIVATE', hint: 'PRIVATE',"],
        )
        cases = [opening + fields + extra + ["}"] for extra in invalid]
        cases.append(opening + [fields[0].removesuffix(","), fields[1], "}"])
        for index, lines in enumerate(cases):
            with self.subTest(case=index):
                observed = harness.switch_log_projection((b"", self.stamped(lines)), "migration", invocation)
                self.assertEqual((observed["status"], observed["ruleIds"], observed["sqlstates"]), ("NO_MATCH", [], []))
                self.assertNotIn("PRIVATE", json.dumps(observed))

    def test_sqlstate_preserves_flat_scalars_quoted_braces_and_independent_object_boundaries(self):
        invocation = self.fixture()[2]
        opening = ["error: PRIVATE", "    at async file:///app/docker/provision-runtime-role.mjs:15:3 {"]
        first = opening + ["  length: 123,", "  severity: 'ERROR',", "  code: '42501',",
            r"  detail: 'PRIVATE { expected: { code: \'28P01\' } } \\ path',",
            "  hint: \"PRIVATE } expected: { severity: 'FATAL' }\",",
            "  where: undefined,", "  schema: null,", "  retryable: false,", "  ratio: 1.5e+2,", "}"]
        second = opening + ["  severity: 'FATAL',", "  code: '23505'", "}"]
        for lines, expected_codes in ((first, ["42501"]), (first + second, ["23505", "42501"]),
                                      (first + second[:-1], ["42501"]), (first[:-1] + second, ["23505"])):
            with self.subTest(expected_codes=expected_codes, lines=len(lines)):
                observed = harness.switch_log_projection((b"", self.stamped(lines)), "migration", invocation)
                self.assertEqual((observed["status"], observed["sqlstates"]), ("OBSERVED", expected_codes))
                self.assertEqual(set(observed["ruleIds"]), {"RUNTIME_ROLE_PROVISION_FAILURE", "POSTGRES_SERVER_ERROR"})
                self.assertNotIn("PRIVATE", json.dumps(observed))
        connection = opening + ["  errno: -111,", "  code: 'ECONNREFUSED',", "  syscall: 'connect',", "  port: 5432", "}"]
        observed = harness.switch_log_projection((b"", self.stamped(connection)), "migration", invocation)
        self.assertEqual((observed["status"], observed["sqlstates"]), ("OBSERVED", []))
        self.assertEqual(set(observed["ruleIds"]), {"RUNTIME_ROLE_PROVISION_FAILURE", "DATABASE_CONNECTION_REFUSED"})

    @unittest.skipUnless(sys.platform == "linux", "Native Docker raw-map formatter reproduction uses the Linux Go toolchain")
    def test_actual_go_template_handles_absent_health_without_hiding_invalid_states(self):
        go = shutil.which("go")
        if go is None:
            self.skipTest("Go is unavailable; this is a formatter reproduction, not a Docker daemon test")
        # Docker CLI inspector.go fb2fe0eac78bb48b63905b31d95f3950dcb1b588:
        # typed Execute falls back to raw JSON with Option("missingkey=error").
        program = '''package main
import("bytes";"encoding/json";"os";"text/template")
type Input struct { Template string; Values []map[string]any }
func main() {
 var inputs []Input; if json.NewDecoder(os.Stdin).Decode(&inputs)!=nil { os.Exit(2) }
 fn:=template.FuncMap{"json":func(v any)(string,error){b,e:=json.Marshal(v);return string(b),e}}
 all:=[][]map[string]any{}
 for _,input:=range inputs {
  t,e:=template.New("inspect").Funcs(fn).Option("missingkey=error").Parse(input.Template);if e!=nil{os.Exit(3)}
  var typed bytes.Buffer;typedErr:=t.Execute(&typed,struct{ID string}{"synthetic"})
  out:=[]map[string]any{}
  for _,v:=range input.Values {
   var b bytes.Buffer;err:=t.Execute(&b,v);r:=map[string]any{"ok":err==nil,"typedRejected":typedErr!=nil}
   if err==nil {var row map[string]any;if json.Unmarshal(b.Bytes(),&row)!=nil{os.Exit(4)};r["row"]=row}
   out=append(out,r)
  };all=append(all,out)
 };if json.NewEncoder(os.Stdout).Encode(all)!=nil{os.Exit(5)}
}
'''
        config, journal, invocation, files, records = self.fixture()
        row = records[2]
        source = {"Id": row["id"], "Name": row["name"], "Created": row["created"], "Image": row["imageId"],
            "RestartCount": row["restarts"], "Config": {"Image": row["image"], "Labels": {
                "com.docker.compose.project": row["project"], "com.docker.compose.service": row["service"],
                "com.docker.compose.project.working_dir": row["root"], "com.docker.compose.project.config_files": row["files"],
                "com.docker.compose.oneoff": row["oneoff"]}},
            "State": {"Status": row["state"], "Running": row["running"], "Dead": False, "OOMKilled": False,
                "ExitCode": row["exitCode"], "StartedAt": row["started"], "FinishedAt": row["finished"], "Error": ""}}
        values = [source]
        for health in (None, {"Status": "healthy"}, {"Status": "starting"}, {"Status": "unhealthy"},
                       {}, False, {"Unexpected": True}, {"Status": None}, {"Status": "PRIVATE"}):
            item = json.loads(json.dumps(source))
            item["State"]["Health"] = health
            values.append(item)
        values.append({key: value for key, value in source.items() if key != "State"})
        baseline = harness.SWITCH_INSPECT.replace(
            '{{if eq (index .State "Health") nil}}"none"{{else}}{{json (index .State "Health").Status}}{{end}}',
            '{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}}')
        self.assertNotEqual(baseline, harness.SWITCH_INSPECT)
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "main.go"
            source_path.write_text(program, encoding="utf-8")
            environment = {**os.environ, "GOTOOLCHAIN": "local", "GO111MODULE": "off", "GOPROXY": "off",
                           "GOSUMDB": "off", "GOTMPDIR": directory}
            result = subprocess.run([go, "run", str(source_path)], input=json.dumps(
                [{"Template": template, "Values": values} for template in (baseline, harness.SWITCH_INSPECT)]).encode(),
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment, timeout=120, check=False)
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
        old, fixed = json.loads(result.stdout)
        self.assertFalse(old[0]["ok"])  # Actual missingkey=error, before repair.
        self.assertEqual(old[5]["row"]["health"], "none")  # Baseline hides malformed {}.
        self.assertTrue(all(item["typedRejected"] for item in old + fixed))
        self.assertEqual([item["ok"] for item in fixed], [True] * 5 + [False] * 3 + [True, True, False])
        images = harness.switch_image_references(config, journal)
        for index, item in enumerate(fixed):
            if not item["ok"]:
                continue
            if index < 5:
                bound = harness.switch_bind_records([item["row"]], [row["id"]], config, files, images, invocation)
                self.assertIn(bound["migration"]["health"], ("none", "healthy", "starting", "unhealthy"))
            else:
                with self.assertRaisesRegex(harness.Failure, "DIAGNOSTIC_INVENTORY"):
                    harness.switch_bind_records([item["row"]], [row["id"]], config, files, images, invocation)

    def test_cli_path_metadata_is_closed_and_does_not_relax_read_permissions(self):
        info = SimpleNamespace(st_uid=0, st_gid=104, st_nlink=2, st_mode=stat.S_IFDIR | 0o775, secret="PRIVATE")
        observed = harness.cli_metadata_projection(info, "varLib")
        self.assertEqual(observed["mode"], "0775")
        self.assertEqual(observed["failedCheckIds"], ["ANCESTOR_WRITABLE"])
        self.assertNotIn("PRIVATE", json.dumps(observed))
        info.st_uid = "PRIVATE"
        with self.assertRaises(harness.Failure):
            harness.cli_metadata_projection(info, "varLib")

    @unittest.skipUnless(sys.platform == "linux", "Metadata-only path walk requires Linux O_PATH/O_NOFOLLOW")
    def test_rejected_cli_path_component_stops_before_content_or_descendants_are_read(self):
        standard = SimpleNamespace(st_uid=0, st_gid=0, st_nlink=2, st_mode=stat.S_IFDIR | 0o755)
        writable = SimpleNamespace(st_uid=0, st_gid=104, st_nlink=2, st_mode=stat.S_IFDIR | 0o775)
        with patch.object(harness, "cli_log_path", return_value=harness.OPERATOR_LOG_ROOT / "test.log"), \
                patch.object(harness.os, "open", side_effect=(10, 11, 12)) as opened, \
                patch.object(harness.os, "fstat", side_effect=(standard, writable)), patch.object(harness.os, "close"), \
                patch.object(harness.os, "read") as read:
            observed = harness.cli_log_path_metadata({}, ["install"], {})
        self.assertEqual(observed["firstRejectedLabel"], "varLib")
        self.assertFalse(observed["contentRead"])
        self.assertEqual([item.args[0] for item in opened.call_args_list], ["/", "var", "lib"])
        self.assertTrue(all(item.args[1] & os.O_PATH for item in opened.call_args_list))
        read.assert_not_called()

    @unittest.skipUnless(sys.platform == "linux", "Native stream capture requires Linux pipe selectors and process handling")
    def test_native_stderr_is_available_only_to_private_bounded_classifier(self):
        proof, streams = harness.diagnostic_command([sys.executable, "-I", "-c",
            "import sys; print('SYNTHETIC_STDOUT'); print('SYNTHETIC_PRIVATE_STDERR',file=sys.stderr)"],
            timeout=3, environment={"PATH": "/usr/bin:/bin"}, return_streams=True)
        self.assertEqual(proof["exitCode"], 0)
        self.assertIn(b"SYNTHETIC_PRIVATE_STDERR", streams[1])
        self.assertNotIn("SYNTHETIC_PRIVATE_STDERR", json.dumps(proof))


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


class NativeCloudContractTests(unittest.TestCase):
    def record(self):
        return {"id": "a" * 64, "name": "/" + harness.CLOUD_CONTAINER,
            "created": "2026-11-04T12:00:00.100000000Z", "started": "2026-11-04T12:00:00.200000000Z",
            "image": harness.CLOUD_IMAGE, "imageId": harness.CLOUD_IMAGE_ID, "user": "1000:1000",
            "labels": {"asa.owner": harness.CLOUD_PROJECT, "com.docker.compose.project": harness.CLOUD_PROJECT,
                "com.docker.compose.service": "rclone", "com.docker.compose.oneoff": "False",
                "com.docker.compose.project.working_dir": str(harness.CLOUD_ROOT),
                "com.docker.compose.project.config_files": str(harness.CLOUD_ROOT / "compose.json")},
            "mounts": [{"Type": "bind", "Source": str(harness.CLOUD_ROOT / name), "Destination": target, "RW": True}
                       for name, target in (("config", "/config/rclone"), ("data", "/data"))],
            "ports": {}, "readonly": True, "privileged": False, "capAdd": None, "capDrop": ["ALL"],
            "paused": False, "restarting": False, "oomKilled": False, "restarts": 0, "running": True,
            "state": "running", "pid": 101, "execIds": None, "networks": {}}

    def bound(self):
        run = object.__new__(harness.CloudFault)
        run.earliest_ns = harness.timestamp_ns("2026-11-04T12:00:00Z")
        record = self.record()
        with patch.object(harness.time, "time_ns", return_value=run.earliest_ns + 10**9):
            run.binding = harness.cloud_container_identity(record, run.earliest_ns)
        run.network_binding = {"id": "b" * 64, "name": harness.CLOUD_PROJECT + "_default"}
        run.context = {"nonce": "c" * 32}
        run.evidence = {}
        run.active_child = SimpleNamespace(closed=True)
        run.dummy_info = None
        run.fixture_started = run.preparation_started = run.dummy_imported = True
        run.app_network_identity = "d" * 64
        run.owner = {"uid": 1001, "gid": 1001}
        return run

    def events(self, *, code="1", include_health=True):
        install = "c" * 32
        base = "/data/asa-" + install
        spool = 'sh -eu -c umask 077; for d do if [ -e "$d" ]; then test -d "$d" && test ! -L "$d"; else mkdir "$d"; fi; done asa-cloud-spool '
        spool += base + " " + base + "/outgoing " + base + "/incoming"
        mkdir = "rclone --config /config/rclone/rclone.conf --contimeout 20s --timeout 60s --max-duration 595s --retries 2 mkdir yandex:Server-Backups/asa-" + install
        groups = [("d" * 64, spool, "0"), ("e" * 64, mkdir, code)]
        if include_health:
            groups.append(("f" * 64, "rclone rc --url http://127.0.0.1:5572 core/version", "0"))
        rows = []
        for identity, command, exit_code in groups:
            for action in ("exec_create: " + command, "exec_start: " + command, "exec_die"):
                rows.append({"type": "container", "id": "a" * 64, "execId": identity, "action": action,
                             "exitCode": exit_code if action == "exec_die" else "", "timeNs": 100 + len(rows)})
        return rows

    def outcome(self, policy):
        operation_id, installation, source = "a" * 32, "c" * 32, ("d" * 32 if policy == "best-effort" else "a" * 32)
        outcome, receipt_outcome, status, exit_code = ("WARNING", "WARNING", "OK", 0) if policy == "best-effort" else ("ERROR", "BLOCKED", "FAILED", 1)
        public = {"format": "asa-cli-result-v1", "status": status, "exitCode": exit_code, "operation": {
            "operationId": operation_id, "installationId": installation, "outcome": outcome, "dataProtectionConfirmed": False}}
        receipt = {"operationId": source, "installationId": installation, "snapshotId": "20261104T120000Z-abcdef12",
            "policy": policy, "outcome": receipt_outcome, "local": {"status": "OK"}, "encryption": {"status": "OK"},
            "cloud": {"status": "FAILED", "error": "CLOUD_TRANSFER_FAILED"}, "protectionConfirmed": False}
        journal = {"operationId": operation_id, "installationId": installation, "snapshotId": receipt["snapshotId"],
            "root": str(harness.INSTALL_ROOT), "mode": "retry-cloud" if policy == "best-effort" else "backup", "state": "TERMINAL",
            "result": {"outcome": outcome, "dataProtectionConfirmed": False}}
        return public, receipt, journal

    def require_outcome(self, policy, public, receipt, journal):
        projection = harness.cloud_result_projection(public, receipt, journal)
        harness.cloud_require_result(projection, policy, "a" * 32, "c" * 32,
            "d" * 32 if policy == "best-effort" else "a" * 32, journal, receipt, public)
        return projection

    def test_dummy_oauth_matches_pinned_backend_without_refresh_or_token_upgrade(self):
        import configparser
        parser = configparser.ConfigParser(interpolation=None)
        parser.read_string(harness.cloud_dummy_configuration("a" * 32).decode())
        self.assertEqual(parser.sections(), ["yandex"])
        self.assertEqual(set(parser["yandex"]), {"type", "token"})
        self.assertEqual(parser["yandex"]["type"], "yandex")
        token = json.loads(parser["yandex"]["token"])
        self.assertEqual(set(token), {"access_token", "refresh_token", "token_type", "expiry"})
        self.assertTrue(token["access_token"].startswith("ASA_REALHOST_DUMMY_ACCESS_"))
        self.assertTrue(token["refresh_token"].startswith("ASA_REALHOST_DUMMY_REFRESH_"))
        self.assertEqual(token["token_type"], "OAuth")
        self.assertGreater(harness.timestamp_ns(token["expiry"]), time.time_ns())
        with self.assertRaises(harness.Failure):
            harness.cloud_dummy_configuration("PRIVATE_TOKEN")

    def test_container_binding_rejects_foreign_owner_alias_mount_image_privilege_and_malformed_exec_ids(self):
        earliest = harness.timestamp_ns("2026-11-04T12:00:00Z")
        original = self.record()
        with patch.object(harness.time, "time_ns", return_value=earliest + 10**9):
            identity = harness.cloud_container_identity(original, earliest)
            self.assertEqual(identity["id"], original["id"])
            cases = []
            for field, value in (("imageId", "sha256:" + "f" * 64), ("user", "0:1000"), ("name", "/foreign"),
                                 ("readonly", False), ("ports", {"5572/tcp": [{"HostPort": "5572"}]}),
                                 ("privileged", True), ("capAdd", ["NET_ADMIN"]), ("capDrop", []),
                                 ("restarts", 1), ("execIds", ["f" * 64, "f" * 64]), ("execIds", [{}])):
                cases.append({**original, field: value})
            foreign = copy.deepcopy(original)
            foreign["labels"]["asa.owner"] = "foreign"
            cases.append(foreign)
            mounted = copy.deepcopy(original)
            mounted["mounts"][0]["Source"] = "/srv/foreign-credentials"
            cases += [mounted, {**original, "mounts": [original["mounts"][0]] * 2}]
            for value in cases:
                with self.assertRaises(harness.Failure):
                    harness.cloud_container_identity(value, earliest)
        with patch.object(harness.os, "geteuid", return_value=0, create=True), patch.object(Path, "mkdir") as mkdir:
            with self.assertRaisesRegex(harness.Failure, "CLOUD_FAULT_OWNER"):
                harness.CloudFault({}, {"uid": 0, "gid": 1000, "name": "asa-setup"})
            mkdir.assert_not_called()

    def test_network_binding_and_routes_require_a_distinct_loopback_only_namespace(self):
        earliest = harness.timestamp_ns("2026-11-04T12:00:00Z")
        record = {"id": "b" * 64, "name": harness.CLOUD_PROJECT + "_default",
            "created": "2026-11-04T12:00:00.100000000Z", "driver": "bridge", "scope": "local",
            "labels": {"com.docker.compose.project": harness.CLOUD_PROJECT, "com.docker.compose.network": "default"},
            "containers": {}}
        with patch.object(harness.time, "time_ns", return_value=earliest + 10**9):
            self.assertEqual(harness.cloud_network_identity(record, earliest)["id"], "b" * 64)
            for changed in ({"id": ""}, {"labels": {}}, {"name": "foreign_default"}, {"driver": "host"}, {"containers": []}):
                with self.subTest(changed=changed), self.assertRaises(harness.Failure):
                    harness.cloud_network_identity({**record, **changed}, earliest)
        interfaces = [{"ifname": "lo", "addr_info": [{"family": "inet", "local": "127.0.0.1"}, {"family": "inet6", "local": "::1"}]}]
        routes4, routes6 = [{"type": "local", "dst": "127.0.0.1", "dev": "lo"}], [{"dst": "::1", "dev": "lo"}]
        self.assertEqual(harness.cloud_namespace_projection(interfaces, routes4, routes6, 102, 101)["externalIPv6Routes"], 0)
        cases = ((interfaces, routes4, routes6, 101), (interfaces + [{"ifname": "eth0"}], routes4, routes6, 102),
                 (interfaces, [{"dst": "default", "gateway": "192.0.2.1", "dev": "lo"}], routes6, 102),
                 (interfaces, routes4, [{"dst": "default", "dev": "lo"}], 102),
                 ([{"ifname": "lo", "addr_info": [{"family": "inet", "local": "192.0.2.1"}]}], routes4, routes6, 102))
        for addresses, v4, v6, inode in cases:
            with self.assertRaisesRegex(harness.Failure, "CLOUD_FAULT_NAMESPACE"):
                harness.cloud_namespace_projection(addresses, v4, v6, inode, 101)

    def test_actual_mkdir_triplet_distinguishes_health_and_natural_retry_error(self):
        for code in ("1", "5"):
            value = harness.cloud_exec_projection(self.events(code=code), "a" * 64, "c" * 32, 100, 200)
            self.assertEqual((value["execId"], value["exitCode"]), ("e" * 64, int(code)))
            self.assertTrue(value["completeCreateStartDie"])
            self.assertEqual(value["healthExecutions"], 1)
            self.assertEqual(value["specificErrno"], "UNAVAILABLE")
            self.assertNotIn("commandLine", value)

    def test_usage_auth_duration_signal_exec_and_missing_history_are_not_connection_pass(self):
        for code in ("0", "2", "7", "10", "126", "127", "137", "143"):
            with self.subTest(exit_code=code), self.assertRaises(harness.Failure) as caught:
                harness.cloud_exec_projection(self.events(code=code), "a" * 64, "c" * 32, 100, 200)
            self.assertEqual(caught.exception.status, "BLOCKED")
        rows = self.events(include_health=False)
        cases = (rows[1:], rows[:-1], [*rows, rows[-1]],
                 [{**row, "id": "f" * 64} if index == 3 else row for index, row in enumerate(rows)],
                 [{**row, "action": row["action"].replace("mkdir", "copyto")} for row in rows],
                 [{**row, "timeNs": 99} if index == 0 else row for index, row in enumerate(rows)])
        for rows in cases:
            with self.assertRaises(harness.Failure) as caught:
                harness.cloud_exec_projection(rows, "a" * 64, "c" * 32, 100, 200)
            self.assertEqual(caught.exception.status, "BLOCKED")

    def test_best_effort_reuses_source_operation_and_required_error_is_public_exit_one(self):
        for policy in ("best-effort", "required"):
            value = self.require_outcome(policy, *self.outcome(policy))
            self.assertIs(value["dataProtectionConfirmed"], False)
            self.assertEqual(value["publicExitCode"], 0 if policy == "best-effort" else 1)
            self.assertEqual(value["sourceOperationId"], "d" * 32 if policy == "best-effort" else "a" * 32)
        public, receipt, journal = self.outcome("required")
        public.update(status="BLOCKED", exitCode=2)
        with self.assertRaisesRegex(harness.Failure, "CLOUD_FAULT_POLICY_RESULT"):
            self.require_outcome("required", public, receipt, journal)

    def test_wrong_binding_unavailable_auth_timeout_or_false_protection_never_pass(self):
        for policy in ("best-effort", "required"):
            for field, value in (("cloud", {"status": "FAILED", "error": "CLOUD_AUTHORIZATION"}),
                                 ("cloud", {"status": "FAILED", "error": "CLOUD_TIMEOUT"}),
                                 ("cloud", {"status": "NOT_CONFIGURED", "error": "CLOUD_NOT_CONNECTED"}),
                                 ("encryption", {"status": "PENDING"}), ("local", {"status": "FAILED"}),
                                 ("operationId", "e" * 32), ("protectionConfirmed", True)):
                public, receipt, journal = self.outcome(policy)
                receipt[field] = value
                with self.subTest(policy=policy, field=field), self.assertRaises(harness.Failure):
                    self.require_outcome(policy, public, receipt, journal)
        secret = "PRIVATE_PROVIDER_TOKEN_AND_LOG"
        public, receipt, journal = self.outcome("required")
        public.update(secret=secret, status=secret)
        public["operation"]["installationId"] = secret
        receipt["cloud"].update(error={"secret": secret}, stderr=secret)
        journal.update(rawLog=secret, state=secret)
        value = harness.cloud_result_projection(public, receipt, journal)
        self.assertNotIn(secret, json.dumps(value))
        self.assertEqual(value["cloudReasonCode"], "UNRECOGNIZED_REASON")
        self.assertEqual(value["publicStatus"], "UNVERIFIED")


class NativeCloudGuardTests(unittest.TestCase):
    record = NativeCloudContractTests.record

    def test_every_cloud_guest_entrypoint_is_accepted_without_starting_a_vm(self):
        phases = ("cloud-fault", "cloud-prepare-empty", "cloud-prepare-dummy", "owner-cloud-baseline",
                  "owner-cloud-best-effort", "owner-cloud-required", "owner-cloud-observe", "owner-cloud-restore")
        with patch.object(harness, "guest_main", return_value=71) as guest, patch.object(harness, "HostRun") as host:
            for phase in phases:
                with self.subTest(phase=phase):
                    self.assertEqual(harness.main(["--guest-phase", phase]), 71)
                    guest.assert_called_with(phase, control_deadline=None)
        host.assert_not_called()

    def test_policy_fixture_changes_only_explicit_backup_fields_and_keeps_source_immutable(self):
        context, _, inputs, _, _ = cli_read_fixture()
        original = inputs["config"]
        original["backup"]["retention"] = {"localKeep": None, "remoteKeep": None}
        original["dataIdentity"] = {"postgres": "synthetic-pg", "minio": "synthetic-objects"}
        before = copy.deepcopy(original)
        for policy in ("best-effort", "required"):
            value = harness.cloud_changed_configuration(original, context, policy)
            self.assertEqual(original, before)
            self.assertEqual({key: item for key, item in value.items() if key != "backup"},
                             {key: item for key, item in original.items() if key != "backup"})
            self.assertEqual({key: item for key, item in value["backup"].items() if key not in ("policy", "cloud")},
                             {key: item for key, item in original["backup"].items() if key not in ("policy", "cloud")})
            self.assertEqual(value["backup"]["policy"], policy)
            self.assertEqual(value["backup"]["cloud"], {"enabled": True,
                "project": "asa-" + original["installationId"], "transportSha256": harness.CLOUD_SOURCE_SHA256,
                "transportPath": str(harness.candidate_bundle(context) / "tools/deployment/ops/cloud_storage.py")})

    def test_dummy_import_requires_fresh_isolation_binding_and_reused_running_transport(self):
        context = {"nonce": "c" * 32, "sourceRevision": "d" * 40}
        owner = {"uid": 1001, "gid": 1001, "name": "asa-setup"}
        earliest = harness.timestamp_ns("2026-11-04T12:00:00Z")
        record = self.record()
        process = {"pid": 101, "pgid": 101, "sid": 101, "startTime": 1000, "state": "S"}
        with patch.object(harness.time, "time_ns", return_value=earliest + 10**9):
            binding = harness.cloud_container_identity(record, earliest)
        saved = {"format": "asa-realhost-cloud-isolation-v1", "nonce": context["nonce"],
            "sourceRevision": context["sourceRevision"], "earliestNs": earliest, "observedNs": earliest + 10**9,
            "container": binding, "process": process, "namespaceInode": 102}
        # Use real JSON serialization: tuple/list drift previously broke this binding.
        self.assertEqual(binding, json.loads(json.dumps(binding)))
        launcher = SimpleNamespace(CLOUD_SOURCE_SHA256=harness.CLOUD_SOURCE_SHA256,
            prepare_cloud_transport=Mock(return_value={"format": "asa-cloud-preparation-v1", "project": harness.CLOUD_PROJECT,
                "image": harness.CLOUD_IMAGE, "reused": True, "tokenConfigured": True, "deliveryVerified": False}))
        spec = SimpleNamespace(loader=SimpleNamespace(exec_module=Mock()))
        environment = {"HOME": "/root", "DOCKER_HOST": "unix:///var/run/docker.sock",
                       "DOCKER_CONFIG": str(harness.GUEST_PRIVATE / "cloud-docker-config")}
        with patch.object(harness.os, "geteuid", return_value=0, create=True), patch.dict(os.environ, environment, clear=True), \
                patch.object(harness, "diagnostic_owner", return_value=(owner, {})), \
                patch.object(harness, "guest_environment", return_value={"HOME": "/root"}), \
                patch.object(harness.importlib.util, "spec_from_file_location", return_value=spec), \
                patch.object(harness.importlib.util, "module_from_spec", return_value=launcher), \
                patch.object(harness.time, "time_ns", return_value=earliest + 2 * 10**9), \
                patch.object(harness, "diagnostic_command", return_value=({"exitCode": 0}, json.dumps(record).encode())) as command, \
                patch.object(harness, "proc_identity", return_value=process), \
                patch.object(harness, "network_namespace_inode", return_value=100), \
                patch.object(Path, "stat", return_value=SimpleNamespace(st_ino=102)):
            for changed in ({"nonce": "e" * 32}, {"sourceRevision": "e" * 40},
                            {"observedNs": earliest - 40 * 10**9}, {"namespaceInode": 100}):
                with self.subTest(changed=changed), patch.object(harness, "diagnostic_read",
                        return_value=(json.dumps({**saved, **changed}).encode(), None, False)), self.assertRaises(harness.Failure):
                    harness.cloud_prepare_guest(context, credential=True)
                launcher.prepare_cloud_transport.assert_not_called()
            with patch.object(harness, "diagnostic_read", side_effect=FileNotFoundError):
                with self.assertRaises(FileNotFoundError):
                    harness.cloud_prepare_guest(context, credential=True)
            launcher.prepare_cloud_transport.assert_not_called()
            with patch.object(harness, "diagnostic_read", return_value=(json.dumps(saved).encode(), None, False)):
                foreign = copy.deepcopy(record)
                foreign["networks"] = {"foreign": {"NetworkID": "f" * 64}}
                command.return_value = ({"exitCode": 0}, json.dumps(foreign).encode())
                with self.assertRaises(harness.Failure):
                    harness.cloud_prepare_guest(context, credential=True)
                launcher.prepare_cloud_transport.assert_not_called()
                command.return_value = ({"exitCode": 0}, json.dumps(record).encode())
                observed = harness.cloud_prepare_guest(context, credential=True)
                self.assertTrue(observed["reused"])
                launcher.prepare_cloud_transport.assert_called_once_with(harness.candidate_bundle(context), owner=owner,
                    credential_file=harness.cloud_fixture_paths()[1])

    def test_child_reports_preserve_recognized_blocked_and_reject_unknown_or_inconsistent_status(self):
        run = object.__new__(harness.CloudFault)
        run.environment, run.owner = {}, {}
        run.remaining = Mock(return_value=10)
        phase = "cloud-prepare-empty"
        child = Mock()
        child.__enter__ = Mock(return_value=child)
        child.__exit__ = Mock(return_value=False)
        base = {"format": "asa-realhost-guest-v1", "phase": phase, "reasonCode": "BLOCKED_CLOUD_FAULT_COMMAND"}
        cases = ((2, "BLOCKED", "BLOCKED"), (1, "FAIL", "FAIL"), (2, "FAIL", "FAIL"),
                 (1, "BLOCKED", "FAIL"), (0, "BLOCKED", "FAIL"), (2, "PRIVATE_TOKEN", "FAIL"))
        with patch.object(harness, "CloudFaultProcess", return_value=child):
            for code, status, expected in cases:
                child.wait.return_value = (code, json.dumps({**base, "status": status}).encode())
                with self.subTest(code=code, status=status), self.assertRaises(harness.Failure) as caught:
                    run.child(phase)
                self.assertEqual(caught.exception.status, expected)
                self.assertNotIn("PRIVATE_TOKEN", str(caught.exception))
            child.wait.return_value = (2, json.dumps({**base, "status": "BLOCKED", "reasonCode": "PRIVATE_TOKEN"}).encode())
            with self.assertRaises(harness.Failure) as caught:
                run.child(phase)
            self.assertEqual(caught.exception.status, "FAIL")

    def test_first_failure_and_closed_evidence_survive_cleanup_failure_without_raw_exception(self):
        run = Mock()
        primary = harness.Failure("CLOUD_FAULT_POLICY_RESULT")
        run.absent.side_effect = primary
        run.cleanup.side_effect = RuntimeError("PRIVATE_CREDENTIALS_MUST_NOT_LEAK")
        run.evidence = {"cleanup": {"status": "NOT_RUN"}, "cases": {"required": {"result": {
            "publicStatus": "FAILED", "publicExitCode": 1}}}}
        output = io.StringIO()
        with patch.object(harness.os, "geteuid", return_value=0, create=True), \
                patch.object(harness, "guest_guard", return_value={}), \
                patch.object(harness.shutil, "disk_usage", return_value=SimpleNamespace(free=8 * harness.GIB)), \
                patch.object(harness, "diagnostic_owner", return_value=({}, {})), \
                patch.object(harness, "CloudFault", return_value=run), \
                patch.object(harness, "CLI_ACTIONS", []), contextlib.redirect_stdout(output):
            code = harness.guest_main("cloud-fault")
        value = json.loads(output.getvalue())
        self.assertEqual((code, value["status"], value["reasonCode"]), (1, "FAIL", "CLOUD_FAULT_POLICY_RESULT"))
        self.assertTrue(value["ownedCleanupFailed"])
        self.assertEqual(value["faultEvidence"]["cleanup"]["status"], "BLOCKED")
        self.assertEqual(value["faultEvidence"]["cases"]["required"]["result"]["publicExitCode"], 1)
        self.assertNotIn("PRIVATE_CREDENTIALS", output.getvalue())

    def test_source_cleanup_child_projects_only_consistent_closed_restore_evidence(self):
        run = object.__new__(harness.CloudFault)
        run.environment = {}
        run.owner = {"home": "/var/lib/asa-setup/operator", "name": "asa-setup"}
        run.remaining = Mock(return_value=10)
        phase = "owner-cloud-restore"
        child = Mock()
        child.__enter__, child.__exit__ = Mock(return_value=child), Mock(return_value=False)
        base = {"format": "asa-realhost-guest-v1", "phase": phase, "status": "BLOCKED",
            "reasonCode": "BLOCKED_CLOUD_FAULT_SOURCE_DUMMY", "sourceDummyRemoved": False,
            "configurationRestored": True, "controlDataPreserved": True, "originalWritersReady": True,
            "raw": "PRIVATE_DUMMY_MUST_NOT_LEAK"}
        with patch.object(harness, "OwnedFaultProcess", return_value=child):
            for changed, code, valid in (({}, 2, True), ({}, 1, False), ({"configurationRestored": 1}, 2, False),
                    ({"sourceDummyRemoved": True}, 2, False), ({"reasonCode": "PRIVATE_DUMMY_MUST_NOT_LEAK"}, 2, False)):
                child.wait.return_value = (code, json.dumps({**base, **changed}).encode())
                with self.subTest(changed=changed, code=code), self.assertRaises(harness.Failure) as caught:
                    run.child(phase, operator=True, cleanup=True)
                self.assertEqual(caught.exception.status, "BLOCKED" if valid else "FAIL")
                projected = getattr(caught.exception, "source_dummy_cleanup", None)
                self.assertEqual(projected, {"sourceDummyRemoved": False, "configurationRestored": True,
                    "controlDataPreserved": True, "originalWritersReady": True} if valid else None)
                self.assertNotIn("PRIVATE_DUMMY", str(caught.exception) + json.dumps(projected))

    def test_owner_restore_uses_exact_saved_bytes_under_lock_and_pending_blocks_every_write(self):
        original = {"installationId": "e" * 32, "backup": {"policy": "best-effort", "cloud": {"enabled": False}}}
        original_raw = (json.dumps(original, indent=3) + "\n\n").encode()
        context = {"nonce": "c" * 32, "sourceRevision": "d" * 40,
                   "pins": {"current": {"revision": "a" * 40, "schema": 304}}}
        current = harness.cloud_changed_configuration(original, context, "required")
        writers, control = {"api": {"id": "b" * 64, "running": True}}, {"preserved": True}
        metadata = SimpleNamespace(st_uid=1001, st_gid=1001, st_mode=stat.S_IFREG | 0o600)
        receipt = {"local": {"status": "OK"}, "encryption": {"status": "OK"}, "operationId": "f" * 32}
        state = {"format": "asa-realhost-cloud-fixture-v1", "nonce": context["nonce"], "installationId": "e" * 32,
            "uid": 1001, "gid": 1001, "mode": 0o600, "originalText": original_raw.decode(),
            "writers": writers, "control": control, "snapshotId": "20261104T120000Z-abcdef12", "sourceOperationId": "f" * 32,
            "sourceDummy": {"status": "ABSENT"}}
        module = SimpleNamespace(private_json=Mock(side_effect=[{"snapshotId": state["snapshotId"]}, state]),
            validate_config=Mock(side_effect=lambda value, *_: copy.deepcopy(value)), atomic_bytes=Mock(), save_private=Mock())
        install = Mock()
        install.identity.return_value = {name: {"id": str(index) * 64} for index, name in enumerate(
            ("postgres", "minio", "api", "web", "scratch", "search"), start=1)}
        install.compose.return_value = "{}"
        account = SimpleNamespace(pw_name="asa-setup", pw_dir="/var/lib/asa-setup/operator", pw_gid=1001)
        with patch.dict(sys.modules, {"pwd": SimpleNamespace(getpwuid=Mock(return_value=account))}), \
                patch.object(harness.os, "geteuid", return_value=1001, create=True), \
                patch.object(harness.os, "getegid", return_value=1001, create=True), \
                patch.object(harness, "owner_installation", return_value=(module, None, None, install, None, current, context["pins"]["current"])), \
                patch("deployment.system.operation_lock", return_value=contextlib.nullcontext()) as lock, \
                patch("deployment.setup_operation.Store") as store, \
                patch("deployment.backup.managed_writers", return_value=writers), \
                patch("deployment.backup_workflow.verify_receipt", return_value=receipt), \
                patch.object(harness, "owner_observe", return_value=control), \
                patch.object(harness.os.path, "lexists", return_value=False), \
                patch.object(harness, "diagnostic_read", side_effect=[
                    (harness.cloud_config_bytes(current), metadata, False), (original_raw, metadata, False)]):
            store.return_value.pending.return_value = None
            value = harness.owner_cloud_fixture(context, "restore")
            self.assertTrue(value["configurationRestored"])
            module.atomic_bytes.assert_called_once_with(harness.INSTALL_ROOT / ".asa/setup.json", original_raw, mode=0o600)
            module.save_private.assert_not_called()
            lock.assert_called_once_with(harness.INSTALL_ROOT)
            self.assertGreaterEqual(module.validate_config.call_count, 4)
            module.atomic_bytes.reset_mock()
            store.return_value.pending.return_value = {"state": "RUNNING"}
            with self.assertRaisesRegex(harness.Failure, "CLOUD_FAULT_PENDING"):
                harness.owner_cloud_fixture(context, "required")
            module.atomic_bytes.assert_not_called()
            module.save_private.assert_not_called()


@unittest.skipUnless(sys.platform == "linux", "Source-dummy lifetime tests use Linux descriptors, inode identity and private modes")
class NativeCloudOwnerLifecycleTests(unittest.TestCase):
    @contextlib.contextmanager
    def owner_fixture(self):
        # The account/product boundaries are doubles. File creation, FD metadata,
        # protected reads, replacement and unlink use real temporary files. This
        # is not evidence of native non-root execution in the root-only scratch.
        real_uid, real_gid = os.geteuid(), os.getegid()
        real_open, real_read, real_binding = harness.diagnostic_open, harness.diagnostic_read, harness.cloud_source_dummy_binding
        from deployment.paths import atomic_bytes
        with tempfile.TemporaryDirectory() as directory, contextlib.ExitStack() as stack:
            base = Path(directory)
            root, home = base / "installation", base / "operator"
            root.mkdir(mode=0o700)
            home.mkdir(mode=0o700)
            (root / ".asa").mkdir(mode=0o700)
            setup, state_path, dummy = root / ".asa/setup.json", root / ".asa/state.json", home / "dummy.conf"
            original = {"installationId": "e" * 32, "backup": {"policy": "best-effort", "cloud": {"enabled": False},
                "retention": {"localKeep": None, "remoteKeep": None}, "schedule": {"enabled": False},
                "ageRecipient": fixture.RECIPIENT}}
            original_raw = (json.dumps(original, indent=3) + "\n\n").encode()
            atomic_bytes(setup, original_raw, mode=0o600)
            context = {"nonce": "c" * 32, "sourceRevision": "d" * 40, "ageRecipient": fixture.RECIPIENT,
                       "pins": {"current": {"revision": "a" * 40, "schema": 304}}}
            writers, control = {"api": {"id": "b" * 64, "running": True}}, {"preserved": True}
            receipt = {"local": {"status": "OK"}, "encryption": {"status": "OK"}, "policy": "best-effort",
                "cloud": {"status": "NOT_CONFIGURED"}, "operationId": "f" * 32, "snapshotId": "20261104T120000Z-abcdef12"}
            pointer = root / ".asa/setup-backups/last-local-success.json"
            module = SimpleNamespace(validate_config=Mock(side_effect=lambda value, *_: copy.deepcopy(value)),
                atomic_bytes=atomic_bytes, save_private=lambda path, value: atomic_bytes(path, harness.cloud_config_bytes(value), mode=0o600),
                private_json=lambda path: {"snapshotId": receipt["snapshotId"]} if Path(path) == pointer
                    else json.loads(Path(path).read_bytes()))
            install = Mock()
            install.identity.return_value = {name: {"id": str(index) * 64} for index, name in enumerate(
                ("postgres", "minio", "api", "web", "scratch", "search"), start=1)}
            install.compose.return_value = "{}"
            account = SimpleNamespace(pw_name="asa-setup", pw_dir="/var/lib/asa-setup/operator", pw_gid=1001)
            def metadata(info):
                value = {key: getattr(info, key) for key in dir(info) if key.startswith("st_")}
                if value["st_uid"] == real_uid:
                    value["st_uid"] = 1001
                if value["st_gid"] == real_gid:
                    value["st_gid"] = 1001
                return SimpleNamespace(**value)
            def boundary(value):
                # The shared temp ancestor is owned by the test process too;
                # include it in the owner-private boundary on non-root runners.
                return base if Path(value) in (root, home, Path(account.pw_dir)) else value
            def opened(path, parent, uid, **kwargs):
                return real_open(path, boundary(parent), real_uid, **kwargs)
            def read(path, parent, uid, **kwargs):
                raw, info, tail = real_read(path, boundary(parent), real_uid, **kwargs)
                return raw, metadata(info) if Path(path) == setup else info, tail
            patches = [patch.dict(sys.modules, {"pwd": SimpleNamespace(getpwuid=Mock(return_value=account))}),
                patch.object(harness.os, "geteuid", return_value=1001), patch.object(harness.os, "getegid", return_value=1001),
                patch.object(harness, "INSTALL_ROOT", root), patch.object(harness, "cloud_fixture_paths", return_value=(state_path, dummy)),
                patch.object(harness, "owner_installation", side_effect=lambda _: (module, None, None, install, None,
                    json.loads(setup.read_bytes()), context["pins"]["current"])),
                patch("deployment.system.operation_lock", side_effect=lambda _: contextlib.nullcontext()),
                patch("deployment.backup.managed_writers", return_value=writers),
                patch("deployment.backup_workflow.verify_receipt", return_value=receipt),
                patch.object(harness, "owner_observe", return_value=control), patch.object(harness, "manifest_count", return_value=1),
                patch.object(harness, "diagnostic_open", side_effect=opened), patch.object(harness, "diagnostic_read", side_effect=read),
                patch.object(harness, "cloud_source_dummy_binding", side_effect=lambda info, *args: real_binding(metadata(info), *args))]
            for item in patches:
                stack.enter_context(item)
            store = stack.enter_context(patch("deployment.setup_operation.Store"))
            store.return_value.pending.return_value = None
            baseline = harness.owner_cloud_fixture(context, "baseline")
            yield SimpleNamespace(root=root, home=home, setup=setup, state=state_path, dummy=dummy, original_raw=original_raw,
                module=module, context=context, baseline=baseline, call=lambda action: harness.owner_cloud_fixture(context, action))

    def assert_restored_blocked(self, value, result):
        self.assertEqual((result.get("status"), result.get("reasonCode")), ("BLOCKED", "BLOCKED_CLOUD_FAULT_SOURCE_DUMMY"))
        self.assertIs(result["sourceDummyRemoved"], False)
        self.assertIs(result["configurationRestored"], True)
        self.assertEqual(value.setup.read_bytes(), value.original_raw)
        self.assertEqual(stat.S_IMODE(value.setup.stat().st_mode), 0o600)

    def test_owner_fixture_models_private_non_root_ancestry_without_bypassing_open_checks(self):
        # Model only UID values of our real temporary inode set. All openat,
        # type/mode/link checks and lifecycle IO still execute; this is not a
        # native non-root process test when the runner itself is root.
        real_open, real_fstat, native_uid = harness.diagnostic_open, os.fstat, os.geteuid()
        for mode, foreign_base in ((0o700, False), (0o750, False), (0o700, True)):
            with self.subTest(mode=mode, foreign_base=foreign_base), tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                base.chmod(mode)
                base_info = base.stat()
                base_identity = (base_info.st_dev, base_info.st_ino)
                def protected_open(path, parent, uid, **kwargs):
                    owned = {(info.st_dev, info.st_ino) for info in
                        (item.lstat() for item in (base, *base.rglob("*"))) if info.st_uid == native_uid}
                    def observed(descriptor):
                        info = real_fstat(descriptor)
                        identity = (info.st_dev, info.st_ino)
                        if identity not in owned:
                            return info
                        values = {key: getattr(info, key) for key in dir(info) if key.startswith("st_")}
                        values["st_uid"] = 1002 if foreign_base and identity == base_identity else 1001
                        return SimpleNamespace(**values)
                    with patch.object(harness.os, "fstat", side_effect=observed):
                        return real_open(path, parent, 1001, **kwargs)
                with patch.object(tempfile, "TemporaryDirectory", return_value=contextlib.nullcontext(directory)), \
                        patch.object(harness, "diagnostic_open", side_effect=protected_open):
                    if mode != 0o700 or foreign_base:
                        with self.assertRaisesRegex(harness.Failure, "DIAGNOSTIC_PERMISSIONS"), self.owner_fixture():
                            pass
                    else:
                        with self.owner_fixture() as value:
                            value.call("best-effort")
                            value.call("required")
                            result = value.call("restore")
                            self.assertTrue(result["sourceDummyRemoved"])
                            self.assertTrue(result["configurationRestored"])
                            self.assertFalse(value.dummy.exists())
                            self.assertEqual(value.setup.read_bytes(), value.original_raw)

    def test_actual_owner_lifecycle_removes_only_the_creation_fd_identity(self):
        with self.owner_fixture() as value:
            value.call("best-effort")
            created = value.dummy.stat()
            saved = json.loads(value.state.read_bytes())["sourceDummy"]
            self.assertEqual(saved["status"], "CREATED")
            self.assertEqual((saved["binding"]["dev"], saved["binding"]["ino"]), (created.st_dev, created.st_ino))
            self.assertEqual((saved["binding"]["nonce"], saved["binding"]["sourceOperationId"]), (value.context["nonce"], "f" * 32))
            self.assertEqual(saved["binding"]["sha256"], hashlib.sha256(value.dummy.read_bytes()).hexdigest())
            value.call("required")
            result = value.call("restore")
            self.assertTrue(result["sourceDummyRemoved"])
            self.assertTrue(result["configurationRestored"])
            self.assertNotIn("status", result)
            self.assertFalse(value.dummy.exists())
            self.assertEqual(value.setup.read_bytes(), value.original_raw)

    def test_actual_owner_preserves_same_bytes_replacement_and_restores_configuration(self):
        with self.owner_fixture() as value:
            value.call("best-effort")
            before = value.dummy.stat()
            replacement = value.home / "replacement.conf"
            replacement.write_bytes(value.dummy.read_bytes())
            replacement.chmod(0o600)
            os.replace(replacement, value.dummy)
            after = value.dummy.stat()
            self.assertNotEqual(before.st_ino, after.st_ino)
            value.call("required")
            self.assert_restored_blocked(value, value.call("restore"))
            self.assertEqual(value.dummy.stat().st_ino, after.st_ino)
            self.assertEqual(value.dummy.read_bytes(), harness.cloud_dummy_configuration(value.context["nonce"]))

    def test_actual_owner_rejects_missing_unknown_or_mutated_creation_proof(self):
        for changed in ("missing", "creating", "unknown", "nonce", "installationId", "sourceOperationId", "sha256",
                        "dev", "ino", "uid", "gid", "mode", "nlink", "bytes", "mtimeNs", "ctimeNs", "bool-nlink"):
            with self.subTest(changed=changed), self.owner_fixture() as value:
                value.call("best-effort")
                before = value.dummy.stat()
                state = json.loads(value.state.read_bytes())
                if changed == "missing":
                    del state["sourceDummy"]
                elif changed == "creating":
                    state["sourceDummy"] = {"status": "CREATING"}
                elif changed == "unknown":
                    state["sourceDummy"]["binding"]["unknown"] = "PRIVATE_DO_NOT_PUBLISH"
                else:
                    key = "nlink" if changed == "bool-nlink" else changed
                    old = state["sourceDummy"]["binding"][key]
                    state["sourceDummy"]["binding"][key] = True if changed == "bool-nlink" else old + 1 if type(old) is int else "0" * len(old)
                value.module.save_private(value.state, state)
                result = value.call("restore")
                self.assert_restored_blocked(value, result)
                self.assertEqual(value.dummy.stat().st_ino, before.st_ino)
                self.assertNotIn("PRIVATE", json.dumps(result))

    def test_actual_owner_metadata_content_missing_and_symlink_changes_fail_closed(self):
        for changed in ("mode", "hardlink", "symlink", "content", "missing"):
            with self.subTest(changed=changed), self.owner_fixture() as value:
                value.call("best-effort")
                sentinel = value.home / "sentinel.conf"
                if changed == "mode":
                    value.dummy.chmod(0o640)
                elif changed == "hardlink":
                    os.link(value.dummy, sentinel)
                elif changed == "symlink":
                    sentinel.write_bytes(value.dummy.read_bytes())
                    sentinel.chmod(0o600)
                    value.dummy.unlink()
                    value.dummy.symlink_to(sentinel)
                elif changed == "content":
                    value.dummy.write_bytes(b"PRIVATE_DO_NOT_PUBLISH")
                else:
                    value.dummy.unlink()
                result = value.call("restore")
                self.assert_restored_blocked(value, result)
                self.assertEqual(os.path.lexists(value.dummy), changed != "missing")
                if changed in ("symlink", "hardlink"):
                    self.assertTrue(sentinel.exists())
                self.assertNotIn("PRIVATE", json.dumps(result))

    def test_partial_failures_keep_original_proof_or_block_unknown_creation(self):
        for failed_step in ("policy-after-write", "proof-before-write", "replacement-before-proof-write"):
            with self.subTest(failed_step=failed_step), self.owner_fixture() as value:
                original_save = value.module.save_private
                def save(path, saved):
                    created = Path(path) == value.state and saved.get("sourceDummy", {}).get("status") == "CREATED"
                    if created and failed_step == "proof-before-write":
                        raise OSError("PRIVATE_IO_ERROR")
                    if created and failed_step == "replacement-before-proof-write":
                        replacement = value.home / "replacement.conf"
                        replacement.write_bytes(value.dummy.read_bytes())
                        replacement.chmod(0o600)
                        os.replace(replacement, value.dummy)
                    original_save(path, saved)
                    if Path(path) == value.setup and failed_step == "policy-after-write":
                        raise OSError("PRIVATE_IO_ERROR")
                with patch.object(value.module, "save_private", side_effect=save):
                    if failed_step == "replacement-before-proof-write":
                        value.call("best-effort")
                    else:
                        with self.assertRaises(OSError):
                            value.call("best-effort")
                result = value.call("restore")
                self.assertEqual(value.setup.read_bytes(), value.original_raw)
                if failed_step == "policy-after-write":
                    self.assertTrue(result["sourceDummyRemoved"])
                    self.assertFalse(value.dummy.exists())
                else:
                    self.assert_restored_blocked(value, result)
                    self.assertTrue(value.dummy.exists())

    def test_actual_owner_blocked_cleanup_preserves_exact_restore_and_primary_failure_evidence(self):
        with self.owner_fixture() as value:
            value.call("best-effort")
            replacement = value.home / "replacement.conf"
            replacement.write_bytes(value.dummy.read_bytes())
            replacement.chmod(0o600)
            os.replace(replacement, value.dummy)
            phase = "owner-cloud-restore"
            output = io.StringIO()
            with patch.object(harness, "guest_guard", return_value=value.context), \
                    patch.object(harness, "CLI_ACTIONS", []), contextlib.redirect_stdout(output):
                code = harness.guest_main(phase)
            observed = json.loads(output.getvalue())
            self.assertEqual(code, 2)
            self.assert_restored_blocked(value, observed)

            # Process transport is a double; the payload above came from the
            # actual owner caller and the parent independently rereads setup.
            run = object.__new__(harness.CloudFault)
            run.context, run.environment, run.evidence = value.context, {}, {}
            run.owner = {"uid": 1001, "gid": 1001, "name": "asa-setup", "home": "/var/lib/asa-setup/operator"}
            run.binding, run.active_child = None, None
            run.preparation_started, run.fixture_started = False, True
            run.remaining = Mock(return_value=10)
            run.daemon, run.docker = Mock(), Mock()
            child = Mock()
            child.__enter__, child.__exit__ = Mock(return_value=child), Mock(return_value=False)
            child.wait.return_value = (code, output.getvalue().encode())
            with patch.object(harness, "OwnedFaultProcess", return_value=child), self.assertRaises(harness.Failure) as caught:
                run.cleanup(value.baseline)
            self.assertEqual(caught.exception.status, "BLOCKED")
            self.assertEqual(run.evidence["cleanup"], {"status": "PENDING", "egressRestored": False,
                "hostProcessesQuiescent": True, "sourceDummyRemoved": False,
                "exactConfigurationBytesOwnerModeRestored": True, "controlDataPreserved": True})
            run.docker.assert_not_called()
            run.daemon.assert_not_called()
            self.assertTrue(value.dummy.exists())

            parent = Mock()
            parent.absent.side_effect = harness.Failure("CLOUD_FAULT_POLICY_RESULT")
            parent.cleanup.side_effect = caught.exception
            parent.evidence = run.evidence
            output = io.StringIO()
            with patch.object(harness.os, "geteuid", return_value=0), \
                    patch.object(harness, "guest_guard", return_value=value.context), \
                    patch.object(harness.shutil, "disk_usage", return_value=SimpleNamespace(free=8 * harness.GIB)), \
                    patch.object(harness, "diagnostic_owner", return_value=(run.owner, {})), \
                    patch.object(harness, "CloudFault", return_value=parent), \
                    patch.object(harness, "CLI_ACTIONS", []), contextlib.redirect_stdout(output):
                code = harness.guest_main("cloud-fault")
            observed = json.loads(output.getvalue())
            self.assertEqual((code, observed["status"], observed["reasonCode"]), (1, "FAIL", "CLOUD_FAULT_POLICY_RESULT"))
            cleanup = observed["faultEvidence"]["cleanup"]
            self.assertEqual(cleanup["status"], "BLOCKED")
            self.assertTrue(cleanup["exactConfigurationBytesOwnerModeRestored"])
            self.assertFalse(cleanup["sourceDummyRemoved"])
            self.assertTrue(observed["ownedCleanupFailed"])
            binding = json.loads(value.state.read_bytes())["sourceDummy"]["binding"]
            self.assertNotIn(binding["sha256"], output.getvalue())
            self.assertNotIn(harness.cloud_dummy_configuration(value.context["nonce"]).decode(), output.getvalue())

    def test_configuration_restore_error_is_not_a_successful_cleanup(self):
        with self.owner_fixture() as value:
            value.call("best-effort")
            configured = value.setup.read_bytes()
            with patch.object(value.module, "atomic_bytes", side_effect=OSError("PRIVATE_IO_ERROR")), \
                    self.assertRaises(OSError):
                value.call("restore")
            self.assertFalse(value.dummy.exists())
            self.assertEqual(value.setup.read_bytes(), configured)


class NativeCloudCleanupTests(unittest.TestCase):
    record = NativeCloudContractTests.record
    bound = NativeCloudContractTests.bound
    def test_isolation_rechecks_immutable_identity_before_disconnect(self):
        for changed in ({**self.record(), "imageId": "sha256:" + "f" * 64}, self.record()):
            # The second record has no attached own network: it is not a valid
            # before-disconnect observation, even though its immutable identity matches.
            run = self.bound()
            run.network = Mock()
            run.docker = Mock(return_value=json.dumps(changed).encode())
            with self.assertRaises(harness.Failure):
                run.isolate()
            self.assertEqual(run.docker.call_count, 1)
            self.assertEqual(run.docker.call_args.args[0], "inspect")

    def test_cleanup_requires_host_quiescence_before_dummy_removal(self):
        run = self.bound()
        run.active_child.closed = False
        run.network = Mock()
        run.container = Mock()
        run.docker = Mock(return_value=json.dumps(self.record()).encode())
        with patch.object(harness, "cloud_unlink_private") as unlink, \
                patch.object(run, "child") as restore, self.assertRaisesRegex(harness.Failure, "CLOUD_FAULT_HOST_PROCESS_REMAINS"):
            run.cleanup({})
        self.assertEqual(run.docker.call_args_list[-1].args, ("stop", "--time", "10", "a" * 64))
        run.container.assert_called_once_with(stopped=True, cleanup=True)
        unlink.assert_not_called()
        restore.assert_not_called()
        self.assertFalse(run.evidence["cleanup"]["egressRestored"])

    def test_changed_resource_cannot_be_stopped_or_removed_by_cleanup(self):
        run = self.bound()
        record = self.record()
        record["labels"]["asa.owner"] = "foreign"
        run.docker = Mock(return_value=json.dumps(record).encode())
        with self.assertRaises(harness.Failure):
            run.cleanup({})
        self.assertEqual([call.args[0] for call in run.docker.call_args_list], ["inspect"])

    def test_cleanup_orders_quiescence_dummy_removal_config_restore_and_exact_resource_removal(self):
        run = self.bound()
        order = []
        original = b'{ "original": true }\n'
        owner = run.owner
        info = SimpleNamespace(st_uid=1000, st_gid=1000, st_mode=stat.S_IFREG | 0o600)
        config_info = SimpleNamespace(st_uid=owner["uid"], st_gid=owner["gid"], st_mode=stat.S_IFREG | 0o600)
        baseline = {"configurationSha256": hashlib.sha256(original).hexdigest(), "configUid": owner["uid"],
            "configGid": owner["gid"], "configMode": 0o600, "appIds": {}}
        def docker(*args, **kwargs):
            order.append(args[0] + ("-" + args[1] if args[0] == "network" else ""))
            return json.dumps(self.record()).encode() if args[0] == "inspect" else b""
        def restored(*args, **kwargs):
            order.append("restore")
            return {"configurationRestored": True, "controlDataPreserved": True, "originalWritersReady": True,
                    "sourceDummyRemoved": True}
        run.docker, run.child = Mock(side_effect=docker), Mock(side_effect=restored)
        run.network, run.container = Mock(), Mock(side_effect=lambda **kw: order.append("quiescent"))
        run.identifiers, run.app_networks, run.daemon = Mock(return_value=[]), Mock(return_value=run.app_network_identity), Mock()
        with patch.object(harness, "diagnostic_read", side_effect=[
                (harness.cloud_dummy_configuration(run.context["nonce"]), info, False), (original, config_info, False)]), \
                patch.object(harness, "cloud_unlink_private", side_effect=lambda *args: order.append("unlink-dummy")), \
                patch.object(harness.os.path, "lexists", return_value=False):
            run.cleanup(baseline)
        self.assertLess(order.index("stop"), order.index("quiescent"))
        self.assertLess(order.index("quiescent"), order.index("unlink-dummy"))
        self.assertLess(order.index("unlink-dummy"), order.index("restore"))
        self.assertLess(order.index("restore"), order.index("rm"))
        self.assertLess(order.index("rm"), order.index("network-rm"))
        self.assertFalse(run.evidence["cleanup"]["egressRestored"])
        self.assertEqual(run.evidence["cleanup"]["status"], "PASS")
        self.assertFalse(any(call.args[:2] == ("network", "connect") for call in run.docker.call_args_list))

    def test_bounded_command_failure_output_limit_and_cleanup_uncertainty_are_never_evidence(self):
        run = object.__new__(harness.CloudFault)
        run.environment, run.remaining = {}, Mock(return_value=7)
        for report in ({"exitCode": 1}, {"exitCode": 0, "reasonCode": "DIAGNOSTIC_TIMEOUT"},
                       {"exitCode": 0, "reasonCode": "DIAGNOSTIC_OUTPUT_LIMIT"},
                       {"exitCode": 0, "cleanupReasonCode": "DIAGNOSTIC_PROCESS_CLEANUP"}):
            with patch.object(harness, "diagnostic_command", return_value=(report, b"PRIVATE_PROVIDER_STDERR")) as command, \
                    self.assertRaises(harness.Failure) as caught:
                run.command(["docker", "inspect", "a" * 64], timeout=30)
            self.assertEqual(caught.exception.status, "BLOCKED")
            self.assertEqual(caught.exception.code, "BLOCKED_CLOUD_FAULT_COMMAND")
            self.assertNotIn("PRIVATE_PROVIDER_STDERR", str(caught.exception))
            command.assert_called_once_with(["docker", "inspect", "a" * 64], timeout=7, environment={})

    def test_expired_budget_and_disk_floor_block_commands_but_allow_bounded_cleanup(self):
        run = object.__new__(harness.CloudFault)
        run.work_deadline, run.deadline = 99, 120
        with patch.object(harness.time, "monotonic", return_value=100):
            with self.assertRaises(harness.Failure) as caught:
                run.remaining(60)
            self.assertEqual(caught.exception.status, "BLOCKED")
            self.assertEqual(run.remaining(60, cleanup=True), 20)
        run.work_deadline = 110
        with patch.object(harness.time, "monotonic", return_value=100), \
                patch.object(harness.shutil, "disk_usage", return_value=SimpleNamespace(free=harness.RESERVE)):
            with self.assertRaisesRegex(harness.Failure, "BLOCKED_CLOUD_FAULT_DISK_RESERVE"):
                run.remaining(60)

    def test_phase_order_keeps_one_shared_fault_budget_and_following_positive_backup(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"RUNNER_TEMP": directory}), \
                contextlib.redirect_stdout(io.StringIO()):
            runner = object.__new__(harness.HostRun)
            runner.args = SimpleNamespace(preflight_only=False, revision="a" * 40)
            runner.evidence = harness.initial_evidence(runner.args.revision)
            runner.deadline, runner.vm, runner.save = time.monotonic() + harness.TOTAL_SECONDS, None, Mock()
            phases = []
            runner.phase = lambda name, action: phases.append((name, getattr(runner, "fault_deadline", None)))
            self.assertEqual(runner.run(), 0)
        names = [name for name, _ in phases]
        self.assertLess(names.index("published_runtime_update"), names.index("public_cloud_connection_policies"))
        self.assertLess(names.index("public_cloud_connection_policies"), names.index("public_backup_and_retry"))
        shared = [deadline for name, deadline in phases if name in ("public_cloud_connection_policies", "public_backup_and_retry",
            "public_release_connection_failure", "public_partial_backup_failure", "public_backup_interrupt_recovery")]
        self.assertTrue(all(deadline == shared[0] for deadline in shared))
        self.assertLessEqual(shared[0], runner.deadline)
        self.assertIsNone(dict(phases)["real_guest_reboot"])
        self.assertEqual(harness.FAULT_TOTAL_SECONDS, 75 * 60)
        self.assertEqual(harness.TOTAL_SECONDS, 175 * 60)

    def test_cloud_admission_requires_entire_phase_and_transport_reserve_inside_existing_deadline(self):
        runner = object.__new__(harness.HostRun)
        runner.guard, runner.guest = Mock(), Mock(return_value={"status": "PASS"})
        runner.workspace, runner.deadline = Path("synthetic-workspace"), 10000
        runner.fault_deadline = 100 + harness.CLOUD_FAULT_SECONDS + 30
        with patch.object(harness.time, "monotonic", return_value=100), \
                patch.object(harness.shutil, "disk_usage", return_value=SimpleNamespace(free=8 * harness.GIB)):
            with self.assertRaises(harness.Failure) as caught:
                runner.cloud_fault()
            self.assertEqual(caught.exception.status, "BLOCKED")
            runner.guest.assert_not_called()
            runner.fault_deadline += 1
            self.assertEqual(runner.cloud_fault(), {"status": "PASS"})
            runner.guest.assert_called_once_with("cloud-fault", timeout=harness.CLOUD_FAULT_SECONDS + 30)

    def test_network_created_offset_preserves_full_nanoseconds(self):
        expected = harness.timestamp_ns("2026-11-04T12:00:00.123456789Z")
        for value in ("2026-11-04T15:00:00.123456789+03:00", "2026-11-04T04:30:00.123456789-07:30"):
            self.assertEqual(harness.cloud_timestamp_ns(value), expected)
        for value in ("2026-11-04T12:00:00", "2026-11-04T12:00:00.1234567890Z",
                      "2026-11-04T12:00:00+99:00", "PRIVATE_TOKEN"):
            with self.assertRaisesRegex(harness.Failure, "CLOUD_FAULT_TIMESTAMP"):
                harness.cloud_timestamp_ns(value)


@unittest.skipUnless(sys.platform == "linux", "Cloud fault private-file and owned-process boundaries require Linux")
class LinuxNativeCloudTests(unittest.TestCase):
    def test_completed_age_inventory_allows_only_empty_owned_staging_and_keeps_manifest_hash(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(harness, "INSTALL_ROOT", Path(directory)):
            root = Path(directory)
            snapshot = "20261104T120000Z-abcdef12"
            folder = root / "backups" / snapshot
            folder.mkdir(parents=True, mode=0o700)
            folder.parent.chmod(0o700)
            (folder / "manifest.json").write_bytes(b'{"synthetic":true}\n')
            (folder / "manifest.json").chmod(0o600)
            staging = root / "backups/encrypted/.staging"
            staging.mkdir(parents=True, mode=0o700)
            staging.parent.chmod(0o700)
            ciphertext = staging.parent / ("asa-lab-" + snapshot + ".tar.age")
            ciphertext.write_bytes(b"age-encryption.org/v1\nsynthetic-not-ciphertext\n")
            ciphertext.chmod(0o600)
            run = object.__new__(harness.CloudFault)
            run.owner = {"uid": os.geteuid()}
            run.remaining = Mock(return_value=1)
            value = run.inventory()
            self.assertEqual(value["ciphertextEntries"], [ciphertext.name])
            self.assertEqual(value["manifests"][snapshot]["sha256"], hashlib.sha256((folder / "manifest.json").read_bytes()).hexdigest())
            (staging / "incomplete-sentinel").write_bytes(b"retain")
            with self.assertRaisesRegex(harness.Failure, "CLOUD_FAULT_ENCRYPTION_INCOMPLETE"):
                run.inventory()
            self.assertEqual((staging / "incomplete-sentinel").read_bytes(), b"retain")

    def test_private_dummy_unlink_rejects_replacement_and_unlinks_only_the_owned_file(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            path = base / "dummy.conf"
            path.write_bytes(b"synthetic-dummy")
            path.chmod(0o600)
            before = path.stat()
            replacement = base / "replacement.conf"
            replacement.write_bytes(b"foreign-sentinel")
            replacement.chmod(0o600)
            os.replace(replacement, path)
            with self.assertRaisesRegex(harness.Failure, "CLOUD_FAULT_DUMMY_IDENTITY"):
                harness.cloud_unlink_private(path, base, os.geteuid(), before, b"synthetic-dummy")
            self.assertEqual(path.read_bytes(), b"foreign-sentinel")
            current = path.stat()
            harness.cloud_unlink_private(path, base, os.geteuid(), current, b"foreign-sentinel")
            self.assertFalse(path.exists())

    def test_harmless_owned_child_completes_before_cleanup_without_docker_or_provider(self):
        if not harness.native_proc_namespace():
            self.skipTest("Local /proc does not expose this process namespace; actual ownership requires the native runner")
        with tempfile.TemporaryDirectory() as directory, patch.object(harness, "INSTALL_ROOT", Path(directory)):
            with harness.CloudFaultProcess([sys.executable, "-I", "-B", "-c", "print('synthetic-child')"],
                    environment={"PATH": os.environ.get("PATH", ""), "PYTHONDONTWRITEBYTECODE": "1"},
                    deadline=time.monotonic() + 10) as child:
                code, raw = child.wait(5)
                proof = child.proof()
            self.assertEqual((code, raw.strip()), (0, b"synthetic-child"))
            self.assertTrue(proof["allOwnedProcessesExited"])
            self.assertFalse(child.signal(signal.SIGTERM))


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


def published_fixture():
    context, _, _, _, _ = cli_read_fixture()
    helper = b"# synthetic released helper, never executed in this test\n"
    context.update(nonce="e" * 32, acquisition={"mode": "published", "approvedRevision": context["sourceRevision"],
        "sourceRevision": context["sourceRevision"], "helperSha256": hashlib.sha256(helper).hexdigest()})
    context["cliDefaultTargetExpectation"]["revision"] = context["sourceRevision"]
    owner = {"name": "asa-ci", "uid": 1001, "gid": 1001, "home": "/home/asa-ci", "groups": [27, 1001], "nonce": context["nonce"]}
    return context, owner, helper


class PublishedModeTests(unittest.TestCase):
    def environment(self, revision):
        return {"GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": revision,
            "SOURCE_REVISION": revision, "GITHUB_REPOSITORY": harness.REPOSITORY,
            "GITHUB_WORKFLOW_REF": harness.REPOSITORY + "/.github/workflows/setup-realhost.yml@refs/heads/main"}

    def test_explicit_published_mode_binds_actual_main_event_and_candidate_stays_default(self):
        revision = "a" * 40
        environment = self.environment(revision)
        self.assertEqual(harness.acquisition_request("published", revision, revision, revision, environment)["mode"], "published")
        self.assertEqual(harness.acquisition_request("candidate", "", revision, revision, {})["mode"], "candidate")
        for key, value in (("GITHUB_EVENT_NAME", "pull_request"), ("GITHUB_REF", "refs/heads/feature"),
                           ("GITHUB_SHA", "b" * 40), ("SOURCE_REVISION", "b" * 40),
                           ("GITHUB_REPOSITORY", "foreign/repository"), ("GITHUB_WORKFLOW_REF", "foreign/workflow")):
            with self.subTest(key=key), self.assertRaisesRegex(harness.Failure, "ACQUISITION_MODE_BINDING"):
                harness.acquisition_request("published", revision, revision, revision, {**environment, key: value})
        for mode, approved, actual in (("published", "", revision), ("published", "a" * 39, revision),
                                       ("published", "b" * 40, revision), ("candidate", revision, revision),
                                       ("published", revision, "b" * 40), (True, revision, revision)):
            with self.subTest(mode=mode, approved=approved), self.assertRaises(harness.Failure):
                harness.acquisition_request(mode, approved, revision, actual, environment)

    def test_actual_mode_entrypoint_rejects_mismatch_before_any_host_run(self):
        root = HERE.parents[1]
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
        arguments = [sys.executable, "-I", "-B", str(HERE / "ci_setup_realhost.py"), "--revision", revision,
                     "--acquisition-mode", "published", "--approved-setup-revision", revision, "--check-acquisition-mode"]
        for source, expected in ((revision, 0), ("b" * 40, 1)):
            with tempfile.TemporaryDirectory() as directory:
                result = subprocess.run(arguments, cwd=directory, stdin=subprocess.DEVNULL, capture_output=True,
                    timeout=15, env={**os.environ, **self.environment(revision), "SOURCE_REVISION": source})
                self.assertEqual(result.returncode, expected, result.stderr.decode("utf-8", "replace"))
                self.assertEqual(json.loads(result.stdout)["status"], "PASS" if expected == 0 else "FAIL")
                self.assertEqual(list(Path(directory).iterdir()), [])

    def test_workflow_keeps_event_checkout_and_only_reads_attestations(self):
        source = (HERE.parents[1] / ".github/workflows/setup-realhost.yml").read_text()
        self.assertIn("ref: ${{ github.event.pull_request.head.sha || github.sha }}", source)
        self.assertNotIn("ref: ${{ inputs.", source)
        self.assertIn("attestations: read", source)
        self.assertNotIn("attestations: write", source)
        self.assertLess(source.index("--check-acquisition-mode"), source.index("sudo -n --preserve-env"))
        self.assertIn('--approved-setup-revision "$APPROVED_SETUP_REVISION"', source)
        for line in source.splitlines():
            if "run:" in line:
                self.assertNotIn("${{ inputs.", line)

    @patch.object(harness, "INSTALL_ROOT", PurePosixPath("/srv/asa-lab"))
    def test_mode_specific_default_target_is_independent_of_controlled_update(self):
        import test_realhost_cli_checks as examples
        context, owner, inputs, paths, _ = cli_read_fixture()
        published, _, _ = published_fixture()
        context["acquisition"] = published["acquisition"]
        context["nonce"] = published["nonce"]
        target = copy.deepcopy(context["cliReleaseExpectations"]["current"])
        target.update(revision=context["sourceRevision"], deploymentDigest="sha256:" + "f" * 64,
                      manifestDigest="sha256:" + "e" * 64, ci="VERIFIED", publicationRunId=123, selector="stable-before-vm")
        context["cliDefaultTargetExpectation"] = target
        expected, _ = harness.cli_fixture_context(cli_checks, context, owner, inputs, paths)
        self.assertEqual(expected.target.revision, context["sourceRevision"])
        self.assertEqual(expected.deployment_digest, target["deploymentDigest"])
        self.assertEqual(context["pins"]["current"]["revision"], "959d52079d8c5659e86f084ad2453bd3eb68fe34")
        self.assertEqual(expected.installed.revision, context["pins"]["previous"]["revision"])
        value = examples.envelope("update check", examples.update(expected))
        cli_checks.check_read_result("update check", value, returncode=0, expected=expected)
        value["target"]["deploymentDigest"] = "sha256:" + "1" * 64
        with self.assertRaisesRegex(cli_checks.CLIReadCheckError, "RELEASE_PIN_MISMATCH"):
            cli_checks.check_read_result("update check", value, returncode=0, expected=expected)
        for difference in ({"revision": "a" * 40}, {"schema": True}, {"deploymentDigest": "stable"},
                           {"manifestDigest": None}, {"ci": "UNVERIFIED"}, {"extra": "PRIVATE_TOKEN"},
                           {"publicationRunId": False}, {"selector": "from-cli"}):
            context["cliDefaultTargetExpectation"] = {**target, **difference}
            with self.subTest(difference=difference), self.assertRaises(harness.Failure):
                harness.cli_fixture_context(cli_checks, context, owner, inputs, paths)

    def test_linux_guest_path_fixtures_ignore_windows_host_flavour(self):
        # These two fixtures contain guest path values, not host filesystem operations.
        original_path, original_root = Path, harness.INSTALL_ROOT
        windows_root = PureWindowsPath("/srv/asa-lab")
        cases = (
            PublishedModeTests("test_mode_specific_default_target_is_independent_of_controlled_update"),
            PublishedArchiveTests("test_attestation_uses_exact_repository_workflow_ref_digest_and_deny_flag"),
        )
        with patch.object(sys.modules[__name__], "Path", PureWindowsPath), \
                patch.object(harness, "INSTALL_ROOT", windows_root):
            for case in cases:
                with self.subTest(case=case.id()):
                    result = unittest.TestResult()
                    case.run(result)
                    self.assertEqual(result.testsRun, 1)
                    self.assertEqual(result.skipped, [])
                    self.assertTrue(result.wasSuccessful(), result.errors + result.failures)
                    self.assertIs(harness.INSTALL_ROOT, windows_root)
        self.assertIs(Path, original_path)
        self.assertIs(harness.INSTALL_ROOT, original_root)

    def test_reconciled_acquisition_and_cloud_phases_preserve_order_and_fault_deadline(self):
        # Exercise the shared orchestrator in both modes without executing VM actions.
        for mode in ("candidate", "published"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory, \
                    patch.dict(os.environ, {"RUNNER_TEMP": directory}), contextlib.redirect_stdout(io.StringIO()):
                runner = object.__new__(harness.HostRun)
                runner.args = SimpleNamespace(preflight_only=False, revision="d" * 40, acquisition_mode=mode)
                runner.evidence = harness.initial_evidence(runner.args.revision, mode)
                runner.deadline, runner.vm, runner.save = time.monotonic() + harness.TOTAL_SECONDS, None, Mock()
                phases = []
                runner.phase = lambda name, action: phases.append((name, getattr(runner, "fault_deadline", None)))
                self.assertEqual(runner.run(), 0)
                names, deadlines = [name for name, _ in phases], dict(phases)
                start = names.index("official_1panel_bootstrap")
                end = names.index("real_guest_reboot")
                acquisition = ["published_setup_acquisition"] if mode == "published" else []
                self.assertEqual(names[start:end], ["official_1panel_bootstrap", *acquisition,
                    "public_asa_install", "independent_control_fixture", "installed_cli_read_acceptance",
                    "published_runtime_update", "public_cloud_connection_policies", "public_backup_and_retry",
                    "public_release_connection_failure", "public_partial_backup_failure", "public_backup_interrupt_recovery"])
                self.assertEqual(names.count("published_setup_acquisition"), int(mode == "published"))
                for name in ("official_1panel_bootstrap", *acquisition, "published_runtime_update", "real_guest_reboot"):
                    self.assertIsNone(deadlines[name])
                shared = [deadlines[name] for name in ("public_cloud_connection_policies", "public_backup_and_retry",
                    "public_release_connection_failure", "public_partial_backup_failure", "public_backup_interrupt_recovery")]
                self.assertTrue(all(deadline == shared[0] for deadline in shared))
                self.assertGreater(shared[0], 0)
                self.assertLessEqual(shared[0], runner.deadline)
                self.assertIsNone(runner.fault_deadline)

    def test_published_acquisition_pass_survives_a_later_install_failure(self):
        runner = object.__new__(harness.HostRun)
        runner.args = SimpleNamespace(revision="d" * 40, preflight_only=False, acquisition_mode="published")
        runner.evidence = harness.initial_evidence(runner.args.revision, "published")
        runner.deadline, runner.vm, runner.save = time.monotonic() + 900, None, Mock()
        proof = {"status": "PASS", "sourceRevision": runner.args.revision, "manualCandidateStage": False}
        runner.guest = Mock(return_value={"publishedSetupAcquisition": proof})
        phases = []
        def phase(name, action):
            phases.append(name)
            if name == "published_setup_acquisition":
                return action()
            if name == "public_asa_install":
                raise harness.Failure("COMMAND")
        runner.phase = phase
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"RUNNER_TEMP": directory}), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(runner.run(), 1)
        self.assertEqual(runner.evidence["status"], "FAIL")
        self.assertEqual(runner.evidence["publishedSetupAcquisition"], proof)
        self.assertEqual(phases[-3:], ["official_1panel_bootstrap", "published_setup_acquisition", "public_asa_install"])
        runner.guest.assert_called_once_with("published-acquire", timeout=harness.PUBLISHED_SECONDS + 30)

    def test_invalid_context_cannot_fallback_to_candidate_or_learn_a_target(self):
        context, _, _ = published_fixture()
        harness.published_context(context)
        for key, value in (("mode", "candidate"), ("approvedRevision", "a" * 40),
                           ("sourceRevision", "b" * 40), ("helperSha256", "unknown"), ("extra", "PRIVATE_TOKEN")):
            changed = copy.deepcopy(context)
            changed["acquisition"][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(harness.Failure, "PUBLISHED_CONTEXT"):
                harness.published_context(changed)

    def test_published_bootstrap_never_calls_manual_stage_and_missing_mode_is_not_a_fallback(self):
        context, _, _ = published_fixture()
        commands = Mock()
        with patch.object(harness, "published_no_installation"), patch.object(Path, "mkdir") as mkdir, \
                patch.object(harness, "public_cli") as public:
            result = harness.prepare_guest_cli(context, commands)
            self.assertEqual(result["candidateStage"], "NOT_RUN")
            commands.run.assert_not_called()
            mkdir.assert_not_called()
            public.assert_not_called()
            del context["acquisition"]
            with self.assertRaises(harness.Failure):
                harness.prepare_guest_cli(context, commands)
            commands.run.assert_not_called()


class PublishedArchiveTests(unittest.TestCase):
    def archive(self, names=None, *, executable=None):
        executable = executable or b"\x7fELF\x02\x01\x01" + b"\x00" * 11 + b"\x3e\x00" + b"synthetic-ELF-not-executed"
        data = io.BytesIO()
        with harness.tarfile.open(fileobj=data, mode="w:gz", format=harness.tarfile.USTAR_FORMAT) as archive:
            for name, kind in (names or [("gh_2.101.0_linux_amd64/bin/gh", "file")]):
                member = harness.tarfile.TarInfo(name)
                member.size = len(executable) if kind == "file" else 0
                if kind == "symlink":
                    member.type, member.linkname = harness.tarfile.SYMTYPE, "/foreign"
                if kind == "hardlink":
                    member.type, member.linkname = harness.tarfile.LNKTYPE, "/foreign"
                archive.addfile(member, io.BytesIO(executable) if kind == "file" else None)
        raw = data.getvalue()
        return raw, {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "executableBytes": len(executable),
                     "executableSha256": hashlib.sha256(executable).hexdigest()}, executable

    def test_exact_hash_size_and_only_regular_amd64_elf_are_required_before_execution(self):
        raw, pin, executable = self.archive()
        self.assertEqual(harness.published_gh_binary(raw, pin), executable)
        for changes in ({"bytes": pin["bytes"] + 1}, {"sha256": "0" * 64}, {"executableSha256": "0" * 64}):
            with self.subTest(changes=changes), self.assertRaises(harness.Failure):
                harness.published_gh_binary(raw, {**pin, **changes})
        name = "gh_2.101.0_linux_amd64/bin/gh"
        for names in ([(name, "symlink")], [(name, "hardlink")], [(name, "file"), (name, "file")],
                      [(name, "file"), ("/tmp/outside", "file")], [(name, "file"), ("gh_2.101.0_linux_amd64/../escape", "file")],
                      [(name, "file"), ("gh_2.101.0_linux_amd64//other", "file")]):
            payload, expected, _ = self.archive(names)
            with self.subTest(names=names), self.assertRaises(harness.Failure):
                harness.published_gh_binary(payload, expected)
        payload, expected, _ = self.archive(executable=executable[:18] + b"\xb7\x00" + executable[20:])
        with self.assertRaisesRegex(harness.Failure, "PUBLISHED_GH_ELF"):
            harness.published_gh_binary(payload, expected)

    def test_attestation_uses_exact_repository_workflow_ref_digest_and_deny_flag(self):
        command = harness.published_verify_command(PurePosixPath("/trusted/gh"), PurePosixPath("/protected/helper.py"), "a" * 40)
        self.assertEqual(command, ["/trusted/gh", "attestation", "verify", "/protected/helper.py", "--repo", harness.REPOSITORY,
            "--signer-workflow", harness.REPOSITORY + "/.github/workflows/setup-release.yml", "--source-ref", "refs/heads/main",
            "--source-digest", "a" * 40, "--deny-self-hosted-runners"])
        with self.assertRaises(harness.Failure):
            harness.published_verify_command(PurePosixPath("/trusted/gh"), PurePosixPath("/protected/helper.py"), "main")

    def test_pinned_gh_prerequisite_cannot_turn_into_latest_or_mutable_apt_binary(self):
        original = json.loads((HERE / "fixtures/setup-realhost-pins.json").read_text())
        self.assertEqual(original["githubCli"], harness.GH_PIN)
        for key, value in (("version", "latest"), ("sourceRevision", "a" * 40), ("bytes", 15282174),
                           ("sha256", "0" * 64), ("executableSha256", "0" * 64), ("url", "https://untrusted.invalid/gh")):
            changed = copy.deepcopy(original)
            changed["githubCli"][key] = value
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "pins.json"
                path.write_text(json.dumps(changed))
                with self.subTest(key=key), self.assertRaisesRegex(harness.Failure, "PINS_GITHUB_CLI"):
                    harness.pin_manifest(path)


class PublishedProcessTests(unittest.TestCase):
    def administrator_model(self, context, owner):
        account = SimpleNamespace(pw_name="asa-ci", pw_uid=owner["uid"], pw_gid=owner["gid"],
                                  pw_dir=owner["home"], pw_shell="/bin/bash")
        stack = contextlib.ExitStack()
        stack.enter_context(patch.dict(sys.modules, {"pwd": SimpleNamespace(getpwnam=Mock(return_value=account))}))
        stack.enter_context(patch.object(harness, "guest_guard", return_value=context))
        stack.enter_context(patch.object(harness.os, "geteuid", return_value=0, create=True))
        stack.enter_context(patch.object(harness.os, "getgrouplist", return_value=[1001, 27], create=True))
        stack.enter_context(patch.object(Path, "lstat", lambda path: SimpleNamespace(st_mode=stat.S_IFDIR | 0o755,
            st_uid=owner["uid"] if path == Path(owner["home"]) else 0)))
        return stack, account

    def test_exact_administrator_credentials_and_groups_are_native_popen_options(self):
        context, owner, _ = published_fixture()
        stack, _ = self.administrator_model(context, owner)
        process = Mock(pid=12001)
        anchor = {"pid": 12001, "pgid": 12001, "sid": 12001, "startTime": 123}
        with stack, patch.object(harness, "native_proc_namespace", return_value=True), \
                patch.object(harness, "proc_identity", return_value=anchor), \
                patch.object(harness.subprocess, "Popen", return_value=process) as popen:
            child = harness.OwnedFaultProcess(["/trusted/gh", "--version"], environment={}, owner=owner,
                                             administrator=True, deadline=time.monotonic() + 30)
            child.closed = True
            child.close()
        self.assertEqual((popen.call_args.kwargs["user"], popen.call_args.kwargs["group"], popen.call_args.kwargs["extra_groups"]),
                         (1001, 1001, [27, 1001]))
        self.assertEqual(popen.call_args.kwargs["cwd"], "/")
        self.assertTrue(popen.call_args.kwargs["start_new_session"])

    def test_missing_root_bool_or_wrong_account_and_groups_never_spawn_or_expand_default(self):
        context, owner, _ = published_fixture()
        stack, account = self.administrator_model(context, owner)
        with stack, patch.object(harness, "native_proc_namespace", return_value=True), \
                patch.object(harness.subprocess, "Popen") as popen:
            for changed in (None, {**owner, "uid": 0}, {**owner, "uid": True}, {**owner, "gid": 0},
                            {**owner, "groups": [1001]}, {**owner, "name": "foreign"}, {**owner, "nonce": "f" * 32}):
                with self.subTest(changed=changed), self.assertRaises(harness.Failure):
                    harness.OwnedFaultProcess(["not-executed"], environment={}, owner=changed,
                                             administrator=True, deadline=time.monotonic() + 30)
            for administrator in (False, 1, "true"):
                with self.subTest(administrator=administrator), self.assertRaises(harness.Failure):
                    harness.OwnedFaultProcess(["not-executed"], environment={}, owner=owner,
                                             administrator=administrator, deadline=time.monotonic() + 30)
            for field, value in (("pw_uid", 0), ("pw_uid", True), ("pw_gid", 0), ("pw_name", "foreign")):
                old = getattr(account, field)
                setattr(account, field, value)
                with self.subTest(field=field, value=value), self.assertRaises(harness.Failure):
                    harness.published_administrator(context)
                setattr(account, field, old)
            with patch.dict(sys.modules, {"pwd": SimpleNamespace(getpwnam=Mock(side_effect=KeyError("absent")))}), self.assertRaises(harness.Failure):
                harness.published_administrator(context)
            popen.assert_not_called()

    def test_bool_values_cannot_alias_valid_numeric_credentials(self):
        context, owner, _ = published_fixture()
        actual = {**owner, "uid": 1, "gid": 1, "groups": [1]}
        with patch.object(harness, "guest_guard", return_value=context), \
                patch.object(harness, "published_administrator", return_value=actual):
            for difference in ({"uid": True}, {"gid": True}, {"groups": [True]}):
                with self.subTest(difference=difference), self.assertRaisesRegex(harness.Failure, "PUBLISHED_ADMINISTRATOR"):
                    harness.published_credentials({**actual, **difference}, deadline=time.monotonic() + 30)

    def test_token_is_private_environment_only_and_unknown_child_result_is_not_pass(self):
        context, owner, _ = published_fixture()
        with patch.object(harness, "diagnostic_read", return_value=(b"PRIVATE_TOKEN_SENTINEL", None, False)):
            environment = harness.published_environment(owner, Path("/protected/gh"))
        self.assertEqual(environment["GH_TOKEN"], "PRIVATE_TOKEN_SENTINEL")
        self.assertEqual(environment["HOME"], "/home/asa-ci")
        self.assertNotIn("GITHUB_TOKEN", environment)
        self.assertNotIn("PYTHONPATH", environment)
        run = object.__new__(harness.PublishedAcquisition)
        run.owner, run.environment, run.deadline = owner, environment, time.monotonic() + 30
        run.report = {"steps": {}, "completedProcessGroups": 0}
        child = Mock(closed=True)
        child.__enter__, child.__exit__ = Mock(return_value=child), Mock(return_value=False)
        command = harness.published_verify_command(Path("/protected/gh"), Path("/protected/helper.py"), context["sourceRevision"])
        with patch.object(harness, "OwnedFaultProcess", return_value=child) as process:
            for code in (1, 2, True, None):
                child.wait.return_value = (code, b"PRIVATE_TOKEN_SENTINEL")
                with self.subTest(code=code), self.assertRaisesRegex(harness.Failure, "PUBLISHED_CHILD_EXIT") as caught:
                    run.command("helper-attestation", command, network=True)
                self.assertNotIn("PRIVATE_TOKEN", str(caught.exception) + json.dumps(run.report))
            self.assertNotIn("PRIVATE_TOKEN", repr(process.call_args.args))
            self.assertEqual(process.call_args.kwargs["environment"]["GH_TOKEN"], "PRIVATE_TOKEN_SENTINEL")
            self.assertTrue(process.call_args.kwargs["administrator"])
            child.wait.return_value = (0, b"gh version 2.101.0 fixture")
            run.command("gh-version", ["/protected/gh", "--version"])
            self.assertNotIn("GH_TOKEN", process.call_args.kwargs["environment"])
        run.deadline = time.monotonic() - 1
        with patch.object(harness, "OwnedFaultProcess") as process, self.assertRaisesRegex(harness.Failure, "BLOCKED_PUBLISHED_ACQUISITION_BUDGET"):
            run.command("gh-version", ["/protected/gh", "--version"])
        process.assert_not_called()


class PublishedAcquisitionOrderTests(unittest.TestCase):
    def run_fixture(self, *, failure=None, archive_failure=False):
        context, owner, helper = published_fixture()
        calls = []
        def command(step, arguments, **options):
            calls.append((step, [str(value) for value in arguments], options))
            if step == failure:
                raise harness.Failure("PUBLISHED_CHILD_EXIT")
            if step == "gh-version":
                return b"gh version 2.101.0 (synthetic)\n"
            if step == "gh-flags":
                return b" --signer-workflow x\n --source-ref x\n --source-digest x\n --deny-self-hosted-runners \n"
            if step == "public-help":
                return json.dumps({"format": "asa-cli-result-v1", "command": "help", "status": "OK", "exitCode": 0, "help": {}}).encode()
            return b""
        info = SimpleNamespace(st_dev=1, st_ino=2, st_size=len(helper), st_mtime_ns=3, st_ctime_ns=4)
        with patch.object(harness, "published_administrator", return_value=owner), \
                patch.object(harness, "published_no_installation"), patch.object(harness.os.path, "lexists", return_value=False), \
                patch.object(harness, "published_directory"), patch.object(Path, "chmod"), patch.object(Path, "stat", return_value=info), \
                patch.object(harness.os, "chown", create=True), patch.object(harness, "published_environment", return_value={}), \
                patch.object(harness, "published_gh_binary", return_value=b"synthetic-ELF-not-executed"), \
                patch.object(harness, "published_snapshot", side_effect=lambda directory, name, raw, **kw: Path(directory) / name), \
                patch.object(harness, "cli_trusted_bytes", side_effect=lambda path, **kw: helper if str(path).endswith(".py") else b"archive"), \
                patch.object(harness, "published_helper_bytes", return_value=helper), \
                patch.object(harness, "cli_trusted_module", return_value=setup_bundle), \
                patch.object(harness, "published_archive", side_effect=FileNotFoundError("PRIVATE_PATH") if archive_failure else None,
                             return_value={"sha256": "f" * 64, "sourceOracleFilesMatch": True}) as archive, \
                patch.object(harness, "cli_candidate_binding", return_value={"status": "VERIFIED"}) as binding:
            run = harness.PublishedAcquisition(context)
            run.command = command
            try:
                result = run.run()
                error = None
            except BaseException as caught:
                result, error = run.report, caught
            return result, error, calls, archive, binding

    def test_helper_is_attested_as_the_protected_snapshot_before_nonroot_execution(self):
        result, error, calls, archive, binding = self.run_fixture()
        self.assertIsNone(error)
        self.assertEqual(result["status"], "PASS")
        names = [item[0] for item in calls]
        self.assertEqual(names, ["gh-version", "gh-flags", "sudo-access", "helper-download", "helper-attestation", "helper-execution", "public-help"])
        verify = calls[4][1]
        execute = calls[5][1]
        self.assertEqual(verify[3], execute[3])
        self.assertEqual(Path(verify[3]).parent, harness.PUBLISHED_HOME / "verified-helper")
        self.assertEqual(execute[:3], ["/usr/bin/python3", "-I", "-B"])
        self.assertFalse(any("stage" in args or "prepare" in args for _, args, _ in calls))
        self.assertTrue(binding.call_args.kwargs["prepared"])
        archive.assert_called_once()

    def test_download_or_attestation_failure_never_executes_helper_or_falls_back(self):
        for phase in ("helper-download", "helper-attestation"):
            result, error, calls, archive, binding = self.run_fixture(failure=phase)
            with self.subTest(phase=phase):
                self.assertIsInstance(error, harness.Failure)
                self.assertNotEqual(result["status"], "PASS")
                self.assertNotIn("helper-execution", [item[0] for item in calls])
                archive.assert_not_called()
                binding.assert_not_called()

    def test_helper_exit_zero_without_an_actual_acquired_archive_never_becomes_pass(self):
        result, error, calls, _, binding = self.run_fixture(archive_failure=True)
        self.assertIsInstance(error, FileNotFoundError)
        self.assertNotEqual(result["status"], "PASS")
        self.assertIn("helper-execution", [item[0] for item in calls])
        self.assertNotIn("public-help", [item[0] for item in calls])
        binding.assert_not_called()

    def test_guest_failure_keeps_partial_closed_evidence_and_does_not_echo_private_errors(self):
        context, _, _ = published_fixture()
        run = Mock()
        run.report = {"status": "PENDING", "sourceRevision": context["sourceRevision"], "steps": {"helper-attestation": "PASS"},
                      "allOwnedProcessesExited": False, "manualCandidateStage": False}
        run.run.side_effect = RuntimeError("PRIVATE_TOKEN_AND_PATH")
        output = io.StringIO()
        with patch.object(harness.os, "geteuid", return_value=0, create=True), \
                patch.object(harness, "guest_guard", return_value=context), \
                patch.object(harness, "PublishedAcquisition", return_value=run), \
                patch.object(harness, "CLI_ACTIONS", []), contextlib.redirect_stdout(output):
            code = harness.guest_main("published-acquire")
        result = json.loads(output.getvalue())
        self.assertEqual(code, 1)
        self.assertEqual(result["publishedSetupAcquisition"]["status"], "FAIL")
        self.assertEqual(result["publishedSetupAcquisition"]["steps"], {"helper-attestation": "PASS"})
        self.assertFalse(result["publishedSetupAcquisition"]["allOwnedProcessesExited"])
        self.assertNotIn("PRIVATE_TOKEN", output.getvalue())


@unittest.skipUnless(os.name == "posix", "Protected snapshot/openat contracts require POSIX")
class PublishedPrivateFileTests(unittest.TestCase):
    def test_snapshot_pins_bytes_before_attestation_and_user_source_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "download.py"
            source.write_bytes(b"approved helper bytes\n")
            protected = root / "protected"
            protected.mkdir(mode=0o755)
            reader = harness.cli_trusted_bytes
            def read(path, **kwargs):
                with fixture_root_metadata(root):
                    return reader(path, **kwargs)
            with fixture_root_metadata(root), patch.object(harness, "cli_trusted_bytes", side_effect=read):
                snapshot = harness.published_snapshot(protected, "helper.py", source.read_bytes())
                source.write_bytes(b"REPLACED_UNTRUSTED_HELPER\n")
                self.assertEqual(read(snapshot, mode=0o444), b"approved helper bytes\n")
                self.assertEqual(stat.S_IMODE(snapshot.stat().st_mode), 0o444)
                self.assertNotEqual(snapshot.stat().st_ino, source.stat().st_ino)
                with self.assertRaises(FileExistsError):
                    harness.published_snapshot(protected, "helper.py", b"changed")
                with self.assertRaises(harness.Failure):
                    harness.published_snapshot(protected, "../escape.py", b"changed")

    def test_downloaded_helper_rejects_wrong_bytes_symlinks_hardlinks_and_modes(self):
        context, _, helper = published_fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            owner = {"uid": os.geteuid(), "gid": os.getegid()}
            source = root / ("asa-setup-acquire-" + context["sourceRevision"] + ".py")
            source.write_bytes(helper); source.chmod(0o600)
            self.assertEqual(harness.published_helper_bytes(context, root, owner), helper)
            source.write_bytes(b"PRIVATE_WRONG_HELPER")
            with self.assertRaisesRegex(harness.Failure, "PUBLISHED_HELPER_SOURCE"):
                harness.published_helper_bytes(context, root, owner)
            source.write_bytes(helper)
            other = root / "linked"
            os.link(source, other)
            with self.assertRaises(harness.Failure):
                harness.published_helper_bytes(context, root, owner)
            other.unlink()
            source.rename(other); source.symlink_to(other)
            with self.assertRaises(OSError):
                harness.published_helper_bytes(context, root, owner)
            source.unlink(); other.rename(source); source.chmod(0o644)
            with self.assertRaises(harness.Failure):
                harness.published_helper_bytes(context, root, owner)

    def test_actual_archive_manifest_full_bundle_and_empty_registration_are_independently_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            oracle_root = root / "oracle"
            oracle_root.mkdir()
            context, private, old_bundle, registry, wrapper = CLIReadTrustTests.bundle(self, oracle_root)
            acquired = root / "acquired"
            acquired.mkdir()
            bundle = acquired / context["sourceRevision"]
            old_bundle.rename(bundle)
            registry.write_text(registry.read_text().replace(str(old_bundle), str(bundle)))
            document = json.loads(registry.read_text())
            document["installations"] = []
            registry.write_text(json.dumps(document))
            wrapper.write_text(wrapper.read_text().replace(str(old_bundle), str(bundle)))
            incoming = acquired / "acquire-abcdefgh"
            incoming.mkdir(mode=0o755)
            archive = incoming / ("asa-setup-" + context["sourceRevision"] + ".tar.gz")
            raw = (private / "candidate.tar.gz").read_bytes()
            archive.write_bytes(raw); archive.chmod(0o444)
            _, files = setup_bundle.inspect_archive(raw)
            context["acquisition"] = {"helperSha256": hashlib.sha256(files["tools/asa_setup_acquire.py"]).hexdigest()}
            reader = harness.cli_trusted_bytes
            def mapped(path, **options):
                path = {"/etc/asa-lab/commands.json": registry, "/usr/local/bin/asa": wrapper}.get(str(path), path)
                return reader(path, **options)
            with fixture_root_metadata(root), patch.object(harness, "GUEST_PRIVATE", private), \
                    patch.object(harness, "candidate_bundle", return_value=bundle), \
                    patch.object(harness, "cli_trusted_bytes", side_effect=mapped):
                proof = harness.published_archive(context, setup_bundle)
                self.assertEqual(proof["sha256"], hashlib.sha256(raw).hexdigest())
                self.assertTrue(proof["sourceOracleFilesMatch"])
                self.assertEqual(harness.cli_candidate_binding(context, setup_bundle, prepared=True)["status"], "VERIFIED")
                with self.assertRaisesRegex(harness.Failure, "CLI_READ_REGISTRATION"):
                    harness.cli_candidate_binding(context, setup_bundle)
                context["acquisition"]["helperSha256"] = "f" * 64
                with self.assertRaisesRegex(harness.Failure, "PUBLISHED_SOURCE_MISMATCH"):
                    harness.published_archive(context, setup_bundle)
                context["acquisition"]["helperSha256"] = hashlib.sha256(files["tools/asa_setup_acquire.py"]).hexdigest()
                archive.chmod(0o644)
                with self.assertRaises(harness.Failure):
                    harness.published_archive(context, setup_bundle)


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
