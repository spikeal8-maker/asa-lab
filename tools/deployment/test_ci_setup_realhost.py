"""Harness safety gates and isolated manager faults; no VM or live cloud claim."""

import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
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
        self.assertEqual(expected.target.revision, self.context["pins"]["current"]["revision"])
        self.assertEqual(expected.deployment_digest, self.context["pins"]["current"]["deploymentDigest"])
        self.assertEqual(expected.snapshot_ids, (self.inputs["backup"]["snapshotId"],))
        self.assertEqual(expected.accepted_operation_id, self.inputs["receipt"]["operationId"])
        self.assertEqual(stamp, self.inputs["backup"]["snapshotAt"])
        self.assertNotIn("PRIVATE_TOKEN_SENTINEL", repr(expected))
        self.assertEqual(len(cli_runtime.command_plan(expected)) + 2, 31)
        updates = [case for case in cli_runtime.command_plan(expected) if case[2] == "update"]
        self.assertEqual(len(updates), 1)
        self.assertNotIn("apply", updates[0][1])
        self.assertNotIn("--deployment-digest", updates[0][1])  # Stable drift remains observable.

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
        with patch.object(harness, "cli_control_command", side_effect=read), patch.object(harness, "switch_expected_files", return_value=files):
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
