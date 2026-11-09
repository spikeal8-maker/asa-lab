"""Coordinator seams, real temporary files and harmless native child processes.

No test invokes /usr/local/bin/asa. Rejection probes call the public producer
with modeled external observations and no host or network commands.
"""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from deployment import realhost_cli_runtime as runtime
from deployment.realhost_cli_checks import check_read_result
from deployment.test_realhost_cli_checks import examples, fixture, help_document, STAMP


SECRET = "PRIVATE_RUNTIME_SENTINEL_DO_NOT_EMIT"


def control():
    return {"databaseSha256": "1" * 64, "databaseRows": 9,
            "objectsSha256": "2" * 64, "objectCount": 2, "objectBytes": 1234}


def fingerprint(digest="3"):
    return {"files": 11, "directories": 4, "absent": 1, "sha256": digest * 64}


def compact(context, *, terminal=False):
    lines = ["ASA Lab · OK", "Установка: " + context.root,
             "CLI: 1.0.0 · записанный выпуск: " + context.installed.revision,
             "PostgreSQL сейчас: " + str(context.installed.schema),
             "Сервисы: OK · healthy 6/7", "Последняя локальная копия: " + STAMP + " · RECORDED",
             "Справка: asa help · подробности: asa status · безопасная проверка: asa update"]
    if terminal:
        lines += ["", runtime.MENU, "Выбор: "]
    return "\n".join(lines) + "\n"


def captured(raw, code=0, *, enter=False, stderr=b""):
    return {"stdout": raw, "stderr": stderr, "returncode": code, "enterSent": enter}


class CoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.context = fixture()
        self.expectations = runtime.RuntimeExpectations(999, STAMP)
        self.examples = examples(self.context)
        self.events = []
        self.invocations = []
        self.mutate = None
        self.file_reads = 0

    def run_command(self, argv, *, timeout, environment, terminal=False):
        self.invocations.append((argv, timeout, copy.deepcopy(environment), terminal))
        self.events.append(("cli", argv))
        self.assertEqual(argv[0], "/usr/local/bin/asa")
        self.assertNotIn(SECRET, " ".join(argv))
        self.assertGreater(timeout, 0)
        if "--json" not in argv:
            return captured(compact(self.context, terminal=terminal).encode("utf-8"), enter=terminal)
        item = next(case for case in runtime.command_plan(self.context) if case[1] == argv)
        label, _, command, topic, _ = item
        if command == "help":
            document = {**help_document(topic), "format": "asa-cli-result-v1", "command": "help", "exitCode": 0}
        else:
            document = copy.deepcopy(self.examples[command][0])
        if self.mutate is not None:
            self.mutate(label, document)
        return captured(json.dumps(document, ensure_ascii=False).encode("utf-8"), document["exitCode"])

    def files(self, *_args, **_kwargs):
        self.file_reads += 1
        self.events.append(("filesystem", self.file_reads))
        return fingerprint()

    def controls(self, phase, deadline):
        self.events.append(("control", phase))
        self.assertGreater(deadline, time.monotonic())
        return control()

    def suite(self, *, files=None, controls=None, runner=None, **kwargs):
        # Pure orchestration also runs on Windows; native I/O is tested below.
        with patch.object(runtime, "_linux"), patch.object(runtime, "_verify_executable"), \
                patch.object(runtime, "_run_process", side_effect=runner or self.run_command), \
                patch.object(runtime, "_snapshot_controls", side_effect=files or self.files):
            return runtime.run_cli_suite(self.context, self.expectations, checker=check_read_result,
                                         control_snapshot=controls or self.controls, **kwargs)

    def test_all_read_forms_use_real_checker_and_hooks_surround_fingerprint_window(self):
        result = self.suite(tokens={"GH_TOKEN": SECRET})
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(len(result["cases"]), 29)
        self.assertEqual(len(self.invocations), 31)
        self.assertEqual(self.events[:2], [("control", "before"), ("filesystem", 1)])
        self.assertEqual(self.events[-2:], [("filesystem", 2), ("control", "after")])
        self.assertEqual({case["command"] for case in result["cases"]}, set(runtime.READ_COMMANDS) | {"help"})
        for case in ("help-update", "disk", "update", "update-check", "backup-list", "restore-plan", "logs", "bare-json"):
            self.assertIn(case, {value["case"] for value in result["cases"]})
        self.assertEqual(result["observations"]["cloud-status"]["status"], "UNAVAILABLE")
        self.assertEqual(result["observations"]["disk-health"]["exitCode"], 1)
        self.assertEqual(result["observations"]["restore-plan"]["reasonCode"], "P1_R3A_REQUIRED")
        self.assertEqual(result["observations"]["restore-plan"]["exitCode"], 2)
        self.assertEqual(result["examples"]["update-check"]["target"]["deploymentDigest"], self.context.deployment_digest)
        self.assertEqual(result["examples"]["status"]["database"]["schema"], 304)
        self.assertIsNone(result["examples"]["update-check"]["estimatedDowntimeSeconds"])
        self.assertEqual(result["bare"]["pipe"]["stdin"], "CLOSED")
        self.assertEqual(result["bare"]["pty"]["stdin"], "ENTER_AFTER_PROMPT")
        self.assertTrue(result["filesystem"]["unchanged"])
        self.assertTrue(result["control"]["unchanged"])
        self.assertNotIn(SECRET, json.dumps(result))
        self.assertTrue(all(item[2]["GH_TOKEN"] == SECRET for item in self.invocations))

    def test_plan_contains_no_mutation_and_never_repins_observed_stable(self):
        plan = runtime.command_plan(self.context)
        self.assertEqual(len(plan), 29)
        for _, argv, command, _, _ in plan:
            self.assertEqual(argv[0], runtime.ASA)
            self.assertIn("--json", argv)
            self.assertIn("--no-color", argv)
            self.assertNotIn("--deployment-digest", argv)
            self.assertNotIn("--operation-id", argv)
            self.assertNotIn(command, ("install", "update apply", "backup create", "cloud sync", "restore apply"))
            if "--root" in argv:
                self.assertEqual(argv[argv.index("--root") + 1], self.context.root)
        verify = next(item for item in plan if item[2] == "backup verify")
        self.assertEqual(verify[1][-2:], ("--snapshot-id", self.context.last_local_success))

    def test_semantic_failure_preserves_reason_and_still_checks_postconditions(self):
        def mutate(label, document):
            if label == "update":
                document["target"]["deploymentDigest"] = "sha256:" + "f" * 64
        self.mutate = mutate
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            self.suite()
        result = raised.exception.evidence
        self.assertEqual((raised.exception.code, raised.exception.semantic_code), ("CLI_SEMANTICS", "RELEASE_PIN_MISMATCH"))
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["failedCase"], "update")
        self.assertTrue(result["filesystem"]["unchanged"])
        self.assertTrue(result["control"]["unchanged"])
        self.assertEqual(self.events[-2:], [("filesystem", 2), ("control", "after")])

    def test_metadata_drift_and_control_drift_fail_without_raw_payloads(self):
        values = iter((fingerprint(), fingerprint("4")))
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            self.suite(files=lambda *_: next(values))
        self.assertEqual(raised.exception.code, "FILESYSTEM_CHANGED")
        self.assertFalse(raised.exception.evidence["filesystem"]["unchanged"])
        def changed(phase, _deadline):
            value = control()
            if phase == "after":
                value["objectsSha256"] = "f" * 64
            return value
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            self.suite(controls=changed)
        self.assertEqual(raised.exception.code, "CONTROL_CHANGED")
        self.assertEqual(raised.exception.evidence["failedCase"], "control-after")

    def test_secondary_failures_cannot_replace_original_cli_failure(self):
        def runner(*_args, **_kwargs):
            return captured(b"not-json " + SECRET.encode())
        values = iter((fingerprint(), fingerprint("4")))
        def callback(phase, _deadline):
            if phase == "after":
                raise RuntimeError(SECRET)
            return control()
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            self.suite(runner=runner, files=lambda *_: next(values), controls=callback)
        result = raised.exception.evidence
        self.assertEqual(result["reasonCode"], "CLI_JSON")
        self.assertEqual(result["failedCase"], "help")
        self.assertEqual(result["filesystem"]["status"], "CHANGED")
        self.assertEqual(result["control"], {"status": "UNAVAILABLE", "reasonCode": "CONTROL_CALLBACK"})
        self.assertNotIn(SECRET, json.dumps(result))

    def test_callback_contract_is_closed_and_failures_prevent_any_cli(self):
        for value in ([], {**control(), "password": SECRET}, {**control(), "databaseRows": True},
                      {**control(), "objectCount": -1}, {**control(), "objectsSha256": SECRET}):
            with self.subTest(value_type=type(value).__name__), self.assertRaises(runtime.CLIRuntimeError) as raised:
                self.suite(controls=lambda *_: value)
            self.assertEqual(raised.exception.code, "CONTROL_PROJECTION")
            self.assertNotIn(SECRET, json.dumps(raised.exception.evidence))
        self.assertEqual(self.invocations, [])

    def test_callbacks_get_deadline_and_late_result_is_not_accepted(self):
        with patch.object(runtime.time, "monotonic", side_effect=[10, 10, 100]), \
                self.assertRaises(runtime.CLIRuntimeError) as raised:
            runtime._control_call(lambda *_: control(), "before", 1000)
        self.assertEqual(raised.exception.code, "CONTROL_TIMEOUT")

    def test_total_budget_stops_next_command_and_reports_unavailable_control_after(self):
        clock = [100.0]
        def runner(*args, **kwargs):
            result = self.run_command(*args, **kwargs)
            clock[0] += 901
            return result
        with patch.object(runtime.time, "monotonic", side_effect=lambda: clock[0]), \
                self.assertRaises(runtime.CLIRuntimeError) as raised:
            self.suite(runner=runner)
        self.assertEqual(raised.exception.code, "RUNTIME_TIMEOUT")
        self.assertEqual(len(self.invocations), 1)
        self.assertEqual(raised.exception.evidence["control"]["reasonCode"], "CONTROL_TIMEOUT")

    def test_environment_is_fixed_and_only_explicit_optional_tokens_are_passed(self):
        with patch.dict(os.environ, {"PYTHONPATH": SECRET, "LD_PRELOAD": SECRET, "DOCKER_HOST": SECRET, "GH_TOKEN": SECRET}):
            value = runtime._environment(None)
        for key in ("PYTHONPATH", "LD_PRELOAD", "DOCKER_HOST", "GH_TOKEN"):
            self.assertNotIn(key, value)
        self.assertEqual(runtime._environment({"GITHUB_TOKEN": SECRET})["GITHUB_TOKEN"], SECRET)
        for value in ({"LD_PRELOAD": SECRET}, {"GH_TOKEN": "x\nAuthorization: " + SECRET}):
            with self.assertRaises(runtime.CLIRuntimeError):
                runtime._environment(value)

    def test_successful_checker_prose_is_omitted_and_failed_checker_message_is_private(self):
        def mutate(label, document):
            if label.startswith("help") or label.endswith("help-option"):
                document["help"]["title"] = SECRET
            if label == "cloud-status":
                document["note"] = SECRET
        self.mutate = mutate
        self.assertNotIn(SECRET, json.dumps(self.suite()))
        def failure(*_args, **_kwargs):
            raise RuntimeError(SECRET)
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            runtime._checked(failure, "status", captured(b"{}"), self.context, "")
        self.assertEqual(str(raised.exception), "CLI_SEMANTICS")
        self.assertIsNone(raised.exception.semantic_code)


class FormatTests(unittest.TestCase):
    def test_one_utf8_object_and_no_duplicate_keys_or_nonfinite_numbers(self):
        self.assertEqual(runtime._json_result(captured('{"text":"Русский"}\n'.encode())), {"text": "Русский"})
        for raw, code in ((b"{}{}", "CLI_JSON"), (b"[]", "CLI_JSON"), (b'{"x":1,"x":2}', "CLI_JSON"),
                          (b'{"x":NaN}', "CLI_JSON"), (b'\xff', "CLI_UTF8"), (b'\x1b[31m{}', "CLI_UTF8"),
                          (b'\xef\xbb\xbf{}', "CLI_JSON"), (b"banner\n{}", "CLI_JSON")):
            with self.subTest(code=code), self.assertRaises(runtime.CLIRuntimeError) as raised:
                runtime._json_result(captured(raw))
            self.assertEqual(raised.exception.code, code)
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            runtime._json_result(captured(b"{}", stderr=SECRET.encode()))
        self.assertEqual(str(raised.exception), "CLI_STDERR")

    def test_compact_summary_requires_expected_release_schema_backup_and_tty_menu(self):
        context, expected = fixture(), runtime.RuntimeExpectations(999, STAMP)
        for terminal in (False, True):
            result = runtime._bare(captured(compact(context, terminal=terminal).encode(), enter=terminal), context, expected, terminal=terminal)
            self.assertEqual(result["compactLines"], 7)
            self.assertEqual(result["menuObserved"], terminal)
        for text in (compact(context).replace("304", "305"), compact(context).replace("healthy 6/7", "healthy 1/7"),
                     compact(context) + SECRET + "\n", compact(context).replace(context.installed.revision, "f" * 40),
                     compact(context).replace(STAMP, "UNAVAILABLE")):
            with self.assertRaises(runtime.CLIRuntimeError):
                runtime._bare(captured(text.encode()), context, expected, terminal=False)
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            runtime._bare(captured(compact(context, terminal=True).encode(), enter=False), context, expected, terminal=True)
        self.assertEqual(raised.exception.code, "PTY_PROMPT")
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            runtime._bare(captured(compact(context).encode(), code=1), context, expected, terminal=False)
        self.assertEqual(raised.exception.code, "BARE_EXIT")

    def test_explicit_file_import_under_isolated_python_from_hostile_cwd(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "json.py").write_text("raise RuntimeError('HOSTILE_IMPORT')\n")
            path = str(Path(runtime.__file__).resolve())
            script = ("import importlib.util,json,sys; "
                      "s=importlib.util.spec_from_file_location('trusted_runtime'," + repr(path) + "); "
                      "m=importlib.util.module_from_spec(s); sys.modules[s.name]=m; s.loader.exec_module(m); "
                      "print(json.dumps({'reads':len(m.READ_COMMANDS),'asa':m.ASA}))")
            completed = subprocess.run([sys.executable, "-I", "-B", "-c", script], cwd=directory,
                                       env={**os.environ, "PYTHONPATH": directory}, capture_output=True, timeout=5)
            self.assertEqual(completed.returncode, 0)
            self.assertEqual(json.loads(completed.stdout), {"reads": 23, "asa": "/usr/local/bin/asa"})
            self.assertEqual(completed.stderr, b"")

    def test_linux_runtime_is_explicitly_unsupported_elsewhere(self):
        with patch.object(runtime.sys, "platform", "win32"), self.assertRaises(runtime.CLIRuntimeError) as raised:
            runtime._linux()
        self.assertEqual(raised.exception.code, "RUNTIME_PLATFORM")

    def test_owned_cleanup_failure_is_closed_and_does_not_signal_an_unknown_child(self):
        process = SimpleNamespace(pid=12345)
        with patch.object(runtime, "_unreaped", return_value=object()), \
                patch.object(runtime.os, "killpg", side_effect=PermissionError(SECRET), create=True), \
                self.assertRaises(runtime.CLIRuntimeError) as raised:
            runtime._finish_owned(process)
        self.assertEqual(str(raised.exception), "PROCESS_CLEANUP")
        with patch.object(runtime, "_unreaped", side_effect=runtime.CLIRuntimeError("PROCESS_OWNERSHIP")), \
                patch.object(runtime.os, "killpg", create=True) as kill, \
                self.assertRaises(runtime.CLIRuntimeError):
            runtime._finish_owned(process)
        kill.assert_not_called()


@unittest.skipUnless(sys.platform == "linux", "Native fingerprint uses Linux openat and no-follow descriptors")
class NativeFingerprintTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.uid = os.geteuid()
        state = self.root / ".asa"
        state.mkdir(mode=0o700)
        (state / "setup-operations").mkdir(mode=0o700)
        (state / "setup-backups").mkdir(mode=0o700)
        for name, required, _ in runtime.FIXED_FILES:
            if required:
                self.write(self.root / name, SECRET.encode())
        self.write(state / "setup-operations" / ("a" * 32 + ".json"), b"{}")
        self.write(state / "setup-backups" / "20261104T120000Z-a1b2c3d4.json", b"{}")
        self.write(state / "setup-backups" / ("operation-" + "a" * 32 + ".json"), b"{}")
        self.write(state / "setup-backups" / "last-local-success.json", b"{}")
        self.registry = self.root / "commands.json"
        self.write(self.registry, b"{}", mode=0o644)

    def write(self, path, value, mode=0o600):
        path.write_bytes(value)
        path.chmod(mode)

    def snapshot(self, **kwargs):
        return runtime._snapshot_controls(self.root, self.uid, registry=self.registry, registry_uid=self.uid, **kwargs)

    def test_snapshot_stability_excludes_atime_and_exports_counts_and_hash_only(self):
        path = self.root / ".env"
        metadata = path.stat()
        os.utime(path, ns=(10**9, metadata.st_mtime_ns))
        before = self.snapshot()
        after = self.snapshot()
        self.assertEqual(before, after)
        self.assertGreater(path.stat().st_atime_ns, 10**9)
        self.assertEqual(set(before), {"files", "directories", "absent", "sha256"})
        self.assertEqual(before["absent"], 1)
        self.assertNotIn(SECRET, json.dumps(before))
        self.assertNotIn(str(self.root), json.dumps(before))

    def test_contents_identity_metadata_and_new_control_files_change_the_digest(self):
        before = self.snapshot()
        path = self.root / ".asa/setup.json"
        path.write_bytes(b"changed")
        self.assertNotEqual(before["sha256"], self.snapshot()["sha256"])
        before = self.snapshot()
        data = path.read_bytes()
        path.unlink()
        self.write(path, data)
        self.assertNotEqual(before["sha256"], self.snapshot()["sha256"])
        before = self.snapshot()
        self.write(self.root / ".asa/runtime-configuration.json", b"{}")
        self.assertNotEqual(before["sha256"], self.snapshot()["sha256"])
        self.assertEqual(self.snapshot()["absent"], 0)

    def test_content_hash_detects_changes_with_metadata_projection_held_constant(self):
        with patch.object(runtime, "_metadata", return_value=("fixed-test-metadata",)):
            before = self.snapshot()
            self.write(self.root / ".env", b"OTHER")
            self.assertNotEqual(before["sha256"], self.snapshot()["sha256"])

    def test_live_database_object_files_and_raw_logs_are_excluded(self):
        paths = [self.root / "postgres-data/data", self.root / "minio-data/object", self.root / ".asa/setup-logs/raw.log"]
        for path in paths:
            path.parent.mkdir(mode=0o700)
            self.write(path, b"before")
        before = self.snapshot()
        for path in paths:
            path.write_bytes(b"after-live-writes-" + SECRET.encode())
        self.assertEqual(before, self.snapshot())

    def test_symlinks_hardlinks_fifo_unsafe_mode_and_wrong_owner_fail_closed(self):
        path = self.root / ".asa/setup.json"
        path.chmod(0o644)
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            self.snapshot()
        self.assertEqual(raised.exception.code, "FILESYSTEM_PERMISSIONS")
        path.chmod(0o600)
        os.link(path, self.root / "hardlink")
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            self.snapshot()
        self.assertEqual(raised.exception.code, "FILESYSTEM_TYPE")
        (self.root / "hardlink").unlink()
        path.unlink()
        path.symlink_to(self.root / ".env")
        with self.assertRaises(runtime.CLIRuntimeError):
            self.snapshot()
        path.unlink()
        os.mkfifo(path, 0o600)
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            self.snapshot()
        self.assertEqual(raised.exception.code, "FILESYSTEM_TYPE")
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            runtime._snapshot_controls(self.root, self.uid + 1, registry=self.registry, registry_uid=self.uid)
        self.assertEqual(raised.exception.code, "FILESYSTEM_PERMISSIONS")

    def test_ancestor_symlink_and_unexpected_entry_are_not_followed_or_exported(self):
        (self.root / ".asa").rename(self.root / "saved-state")
        (self.root / ".asa").symlink_to(self.root / "saved-state", target_is_directory=True)
        with self.assertRaises(runtime.CLIRuntimeError):
            self.snapshot()
        (self.root / ".asa").unlink()
        (self.root / "saved-state").rename(self.root / ".asa")
        self.write(self.root / ".asa/setup-backups" / (SECRET + ".json"), b"{}")
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            self.snapshot()
        self.assertEqual(str(raised.exception), "FILESYSTEM_LAYOUT")

    def test_executable_metadata_requires_exact_owner_and_safe_mode_without_following_links(self):
        executable = self.root / "asa"
        self.write(executable, b"#!/bin/sh\nexit 0\n", mode=0o755)
        descriptor = runtime._open_control(executable, self.root, self.uid, public=True, executable=True)
        os.close(descriptor)
        executable.chmod(0o775)
        with self.assertRaises(runtime.CLIRuntimeError):
            runtime._open_control(executable, self.root, self.uid, public=True, executable=True)
        executable.unlink()
        executable.symlink_to(self.registry)
        with self.assertRaises(OSError):
            runtime._open_control(executable, self.root, self.uid, public=True, executable=True)

    def test_file_byte_count_and_directory_entry_budgets_are_real(self):
        with patch.object(runtime, "TOTAL_FILE_LIMIT", 1), self.assertRaises(runtime.CLIRuntimeError) as raised:
            self.snapshot()
        self.assertEqual(raised.exception.code, "FILESYSTEM_LIMIT")
        with patch.object(runtime, "FILE_COUNT_LIMIT", 1), self.assertRaises(runtime.CLIRuntimeError) as raised:
            self.snapshot()
        self.assertEqual(raised.exception.code, "FILESYSTEM_LIMIT")
        with (self.root / ".asa/installation.json").open("wb") as stream:
            stream.truncate(runtime.FILE_LIMIT + 1)
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            self.snapshot()
        self.assertEqual(raised.exception.code, "FILESYSTEM_LIMIT")
        self.write(self.root / ".asa/installation.json", b"{}")
        for index in range(513):
            self.write(self.root / ".asa/setup-operations" / (format(index, "032x") + ".json"), b"{}")
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            self.snapshot()
        self.assertEqual(raised.exception.code, "FILESYSTEM_LIMIT")

    def test_mutation_while_reading_is_rejected(self):
        native_read = os.read
        changed = [False]
        def racing_read(*args):
            data = native_read(*args)
            if not changed[0]:
                changed[0] = True
                self.write(self.root / ".env", b"changed-during-read")
            return data
        with patch.object(runtime.os, "read", side_effect=racing_read), self.assertRaises(runtime.CLIRuntimeError) as raised:
            self.snapshot()
        self.assertEqual(raised.exception.code, "FILESYSTEM_CHANGED")


@unittest.skipUnless(sys.platform == "linux", "Native transport uses Linux PTY and waitid WNOWAIT")
class NativeTransportTests(unittest.TestCase):
    def run_child(self, script, *, terminal=False, timeout=3):
        return runtime._run_process((sys.executable, "-I", "-B", "-c", script), timeout=timeout,
                                    environment=runtime._environment(None), terminal=terminal)

    def test_pipe_has_slash_cwd_closed_stdin_no_tty_and_preserves_real_exit(self):
        script = "import os,sys,json; print(json.dumps({'cwd':os.getcwd(),'stdinTTY':os.isatty(0),'stdoutTTY':os.isatty(1),'eof':sys.stdin.buffer.read()==b''})); sys.exit(7)"
        result = self.run_child(script)
        self.assertEqual(result["returncode"], 7)
        self.assertEqual(json.loads(result["stdout"]), {"cwd": "/", "stdinTTY": False, "stdoutTTY": False, "eof": True})
        self.assertEqual(result["stderr"], b"")
        self.assertFalse(result["enterSent"])

    def test_actual_pty_waits_for_prompt_sends_enter_and_exits(self):
        context = fixture()
        script = ("import os,sys; assert os.getcwd()=='/' and os.isatty(0) and os.isatty(1); "
                  "print(" + repr(compact(context)) + ",end=''); print('\\n'+" + repr(runtime.MENU) + "); "
                  "answer=input('Выбор: '); sys.exit(0 if answer=='' else 9)")
        observed = self.run_child(script, terminal=True)
        self.assertEqual(observed["returncode"], 0)
        self.assertTrue(observed["enterSent"])
        result = runtime._bare(observed, context, runtime.RuntimeExpectations(999, STAMP), terminal=True)
        self.assertEqual(result["stdin"], "ENTER_AFTER_PROMPT")
        self.assertTrue(result["menuObserved"])

    def test_timeout_and_overflow_have_fixed_errors_and_bounded_cleanup(self):
        cases = (("import time; time.sleep(20)", 0.1, "PROCESS_TIMEOUT"),
                 ("import sys; sys.stdout.buffer.write(b'x'*(1024*1024+8192)); sys.stdout.flush()", 3, "PROCESS_OUTPUT_LIMIT"))
        for script, timeout, expected in cases:
            began = time.monotonic()
            with self.subTest(expected=expected), self.assertRaises(runtime.CLIRuntimeError) as raised:
                self.run_child(script, timeout=timeout)
            self.assertEqual(str(raised.exception), expected)
            self.assertLess(time.monotonic() - began, 4)

    def test_exited_leader_with_live_descendant_is_held_until_group_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = str(Path(directory) / "escaped-descendant")
            descendant = "import time,pathlib; time.sleep(1); pathlib.Path(" + repr(marker) + ").write_text('unexpected')"
            script = "import subprocess,sys; subprocess.Popen([sys.executable,'-I','-B','-c'," + repr(descendant) + "])"
            native_waitid, native_killpg = os.waitid, os.killpg
            with patch.object(runtime.os, "waitid", wraps=native_waitid) as waits, \
                    patch.object(runtime.os, "killpg", wraps=native_killpg) as kills, \
                    self.assertRaises(runtime.CLIRuntimeError) as raised:
                self.run_child(script, timeout=0.15)
            self.assertEqual(raised.exception.code, "PROCESS_TIMEOUT")
            self.assertTrue(waits.call_args_list)
            self.assertTrue(all(call.args[2] & os.WNOWAIT for call in waits.call_args_list))
            self.assertEqual(len({call.args[0] for call in kills.call_args_list}), 1)
            time.sleep(1.1)
            self.assertFalse(Path(marker).exists())


class RejectionContextTests(unittest.TestCase):
    def setUp(self):
        self.context = fixture()

    def reject(self, document, code=0, *, command="update check", checker=check_read_result):
        with self.assertRaises(runtime.CLIRuntimeError) as raised:
            runtime._checked(checker, command, captured(json.dumps(document).encode(), code), self.context, "")
        return raised.exception

    def public_plan(self, *, second_database_unavailable=False, invalid_release=False):
        import contextlib
        import io
        import socket
        from pathlib import PurePosixPath
        import asa_cli
        from deployment import cli_observe, release_readonly, test_realhost_cli_checks as source_fixture

        context = self.context
        reader = cli_observe.Observer.__new__(cli_observe.Observer)
        reader.root, reader.project, reader.errors = PurePosixPath(context.root), context.project, []
        reader.config = {"backup": {"policy": "best-effort"}, "backupDirectory": context.filesystem_paths["backups"]}
        reader.settings = {}
        reader._containers = {"status": "OK", "items": [
            {"service": "postgres", "id": "1" * 64, "running": True,
             "mounts": [{"Destination": "/var/lib/postgresql/data", "Source": context.filesystem_paths["postgres"]}]},
            {"service": "minio", "id": "2" * 64, "running": True,
             "mounts": [{"Destination": "/data", "Source": context.filesystem_paths["minio"]}]},
        ]}
        reader.installed = lambda: source_fixture.release(context)
        reader.backups = lambda: source_fixture.backups(context)
        reader.cloud = source_fixture.cloud
        reader.backup_space = lambda _database: copy.deepcopy(source_fixture.update(context)["backupSpaceEstimate"])
        selection = {"release": {"revision": context.target.revision, "schema": context.target.schema,
                                  "images": dict(context.target.images)},
                     "deploymentDigest": context.deployment_digest, "manifestDigest": context.manifest_digest,
                     "checkedAt": STAMP, "ci": "VERIFIED"}
        database_queries = []
        def observation(command, **_kwargs):
            if command == ["docker", "info", "--format", "{{.DockerRootDir}}"]:
                return {"status": "OK", "output": context.filesystem_paths["docker"]}
            self.assertEqual(command[:3], ["docker", "exec", "1" * 64])
            self.assertIn("default_transaction_read_only=on", command[-1])
            database_queries.append(command)
            self.assertLessEqual(len(database_queries), 2)
            if second_database_unavailable and len(database_queries) == 2:
                return {"status": "UNAVAILABLE", "reasonCode": "PROBE_FAILED"}
            return {"status": "OK", "output": "SET\n304|1000000"}
        def filesystem(path):
            name = next(name for name, expected in context.filesystem_paths.items() if str(path) == expected)
            return copy.deepcopy(source_fixture.disk(context)["filesystems"][name])
        with contextlib.ExitStack() as stack:
            if invalid_release:
                # The real resolver must reject this metadata before blob/CI I/O.
                registry = SimpleNamespace(manifest=lambda _ref: ({"schemaVersion": 1}, context.deployment_digest))
                stack.enter_context(patch.object(release_readonly, "RegistryReader", return_value=registry))
            else:
                stack.enter_context(patch.object(release_readonly, "resolve_release", return_value=selection))
            stack.enter_context(patch.object(cli_observe, "Observer", return_value=reader))
            stack.enter_context(patch.object(cli_observe, "probe", side_effect=observation))
            stack.enter_context(patch.object(cli_observe, "filesystem", side_effect=filesystem))
            stack.enter_context(patch.object(asa_cli, "own_modules"))
            stack.enter_context(patch.object(asa_cli, "read_registry", return_value={}))
            stack.enter_context(patch.object(asa_cli, "registry_entry", return_value={"root": context.root}))
            stack.enter_context(patch.object(asa_cli, "windows_home", return_value=Path("unused-home")))
            stack.enter_context(patch.object(subprocess, "Popen", side_effect=AssertionError("unexpected process")))
            stack.enter_context(patch.object(socket, "socket", side_effect=AssertionError("unexpected network")))
            stdout, stderr = io.StringIO(), io.StringIO()
            stack.enter_context(contextlib.redirect_stdout(stdout))
            stack.enter_context(contextlib.redirect_stderr(stderr))
            code = asa_cli.main(["update", "check", "--root", context.root, "--json", "--no-color"])
        self.assertEqual(stderr.getvalue(), "")
        self.assertEqual(len(database_queries), 0 if invalid_release else 2)
        return json.loads(stdout.getvalue()), code

    def test_actual_public_producer_collisions_retain_distinct_closed_observations(self):
        document, code = self.public_plan()
        projected = runtime._checked(check_read_result, "update check", captured(json.dumps(document).encode(), code), self.context, "")
        self.assertEqual((projected["status"], code), ("PLANNED", 0))
        self.assertNotIn("rejectionContext", projected)
        for options, status, exit_code, section in (
                ({"invalid_release": True}, "BLOCKED", 2, "UPDATE_ENVELOPE"),
                ({"second_database_unavailable": True}, "PLANNED", 0, "UPDATE_DISK")):
            with self.subTest(section=section):
                document, code = self.public_plan(**options)
                error = self.reject(document, code)
                self.assertEqual((error.code, error.semantic_code), ("CLI_SEMANTICS", "FIELD_SET"))
                observed = getattr(error, "rejection_context", None)
                self.assertIsInstance(observed, dict)
                self.assertEqual((observed["status"], observed["binding"]), ("OBSERVED", "CAPTURED_RESPONSE"))
                self.assertEqual((observed["actualExitCode"], observed["section"]), (exit_code, section))
                self.assertEqual(observed["publicStatus"], {"state": "RECOGNIZED", "value": status})
                if options.get("invalid_release"):
                    self.assertEqual(observed["publicReason"], {"state": "RECOGNIZED", "code": "RELEASE_OCI"})
                else:
                    self.assertEqual(observed["publicReason"], {"state": "MISSING"})
                    self.assertEqual(observed["components"]["currentDatabase"]["status"], {"state": "RECOGNIZED", "value": "OK"})
                    self.assertEqual(observed["components"]["disk.database"], {
                        "state": "OBSERVED", "status": {"state": "RECOGNIZED", "value": "UNAVAILABLE"},
                        "reason": {"state": "RECOGNIZED", "code": "POSTGRES_QUERY_UNAVAILABLE"}})

    def test_format_command_and_strict_actual_exit_binding_fail_closed(self):
        base = {"format": "asa-cli-result-v1", "command": "update check", "exitCode": 2,
                "status": "BLOCKED", "reasonCode": "RELEASE_OCI"}
        cases = [("format", "asa-cli-result-v1\u200b"), ("format", None), ("format", {}),
                 ("command", "update"), ("command", "update check\u200b"), ("command", None),
                 ("exitCode", True), ("exitCode", 0), ("exitCode", "2")]
        for key, value in cases:
            document = {**base, key: value}
            with self.subTest(field=key, kind=type(value).__name__):
                error = self.reject(document, 2)
                self.assertEqual(error.rejection_context, {"format": runtime.REJECTION_FORMAT,
                                 "status": "UNAVAILABLE", "reasonCode": "REJECTION_BINDING"})
                self.assertEqual(error.code, "CLI_SEMANTICS")
        for actual in (True, None, "2"):
            with self.subTest(actual_type=type(actual).__name__):
                error = self.reject(base, actual)
                self.assertEqual(error.code, "CLI_CHECKER")
                self.assertIsNone(error.rejection_context)

    def test_missing_null_unknown_and_unicode_values_are_distinct_and_private(self):
        base = {"format": "asa-cli-result-v1", "command": "update check", "exitCode": 2}
        for value, expected in ((None, "NULL"), (SECRET, "UNRECOGNIZED"),
                                ("RELEASE_OCI\u200b", "UNRECOGNIZED"), (True, "UNRECOGNIZED"),
                                ({SECRET: SECRET}, "UNRECOGNIZED")):
            with self.subTest(kind=type(value).__name__):
                document = {**base, "status": value, "reasonCode": value,
                            "disk": {"database": {"status": value, "reasonCode": value}}}
                observed = self.reject(document, 2).rejection_context
                self.assertEqual(observed["publicStatus"], {"state": expected})
                self.assertEqual(observed["publicReason"], {"state": expected})
                self.assertEqual(observed["components"]["disk.database"]["reason"], {"state": expected})
                self.assertNotIn(SECRET, json.dumps(observed))
                self.assertNotIn("\\u200b", json.dumps(observed))
        observed = self.reject(base, 2).rejection_context
        self.assertEqual(observed["publicStatus"], {"state": "MISSING"})
        self.assertEqual(observed["publicReason"], {"state": "MISSING"})
        for value, expected in ((None, "NULL"), ([], "UNRECOGNIZED"), (SECRET, "UNRECOGNIZED")):
            observed = self.reject({**base, "disk": {"database": value}}, 2).rejection_context
            self.assertEqual(observed["components"]["disk.database"], {"state": expected})
        observed = self.reject({**base, "disk": SECRET}, 2).rejection_context
        self.assertEqual(observed["components"]["disk.database"], {"state": "UNAVAILABLE"})

    def test_unknown_fields_prose_and_checker_sections_never_escape(self):
        document = examples(self.context)["update check"][0]
        document[SECRET] = {"password": SECRET}
        for name in ("message", "apply", "stdout", "stderr", "url", "root", "operationId", "target"):
            document[name] = SECRET
        for name in ("current", "currentDatabase", "disk", "backup", "cloud"):
            document[name] = {SECRET: SECRET, "status": SECRET, "reasonCode": SECRET, "message": SECRET}
        observed = self.reject(document).rejection_context
        self.assertEqual(observed["section"], "UPDATE_ENVELOPE")
        self.assertEqual(set(observed["components"]), set(runtime.REJECTION_COMPONENTS))
        self.assertLess(len(json.dumps(observed).encode()), 16384)
        self.assertNotIn(SECRET, json.dumps(observed))
        def bad_checker(*_args, **_kwargs):
            error = ValueError(SECRET)
            error.code, error.section = "FIELD_SET", SECRET
            raise error
        error = self.reject(document, checker=bad_checker)
        self.assertEqual(error.rejection_context["section"], "UNAVAILABLE")
        self.assertEqual(str(error), "CLI_SEMANTICS")
        self.assertNotIn(SECRET, json.dumps(error.rejection_context))

    def test_first_rejection_is_retained_without_success_case_or_stale_context(self):
        for failed_label, reason, expected_count in (("update-check", "RELEASE_OCI", 15),
                                                     ("update-plan", "RELEASE_LAYER", 16)):
            coordinator = CoordinatorTests()
            coordinator.setUp()
            def mutate(label, document):
                if label == failed_label:
                    document.clear()
                    document.update(format="asa-cli-result-v1", command=failed_label.replace("-", " "),
                                    exitCode=2, status="BLOCKED", reasonCode=reason)
            coordinator.mutate = mutate
            with self.subTest(failed_case=failed_label), self.assertRaises(runtime.CLIRuntimeError) as raised:
                coordinator.suite()
            evidence = raised.exception.evidence
            self.assertEqual((evidence["status"], evidence["reasonCode"], evidence["semanticCode"]),
                             ("FAIL", "CLI_SEMANTICS", "FIELD_SET"))
            self.assertEqual(evidence["failedCase"], failed_label)
            self.assertEqual(len(evidence["cases"]), expected_count)
            self.assertEqual(len(coordinator.invocations), expected_count + 1)
            self.assertNotIn(failed_label, {row["case"] for row in evidence["cases"]})
            self.assertNotIn(failed_label, evidence["examples"])
            self.assertEqual(evidence["rejectionContext"]["command"], failed_label.replace("-", " "))
            self.assertEqual(evidence["rejectionContext"]["publicReason"], {"state": "RECOGNIZED", "code": reason})
            self.assertEqual(evidence["filesystem"]["status"], "UNCHANGED")
            self.assertEqual(evidence["control"]["status"], "UNCHANGED")
            self.assertEqual(coordinator.events[-2:], [("filesystem", 2), ("control", "after")])
        coordinator = CoordinatorTests()
        coordinator.setUp()
        result = coordinator.suite()
        self.assertEqual(result["status"], "PASS")
        self.assertNotIn("rejectionContext", result)

    def test_projection_and_after_control_errors_cannot_replace_original_failure(self):
        coordinator = CoordinatorTests()
        coordinator.setUp()
        def mutate(label, document):
            if label == "update-check":
                del document["checkedAt"]
        coordinator.mutate = mutate
        files = iter((fingerprint(), fingerprint("4")))
        def after(phase, _deadline):
            if phase == "after":
                raise RuntimeError(SECRET)
            return control()
        with patch.object(runtime, "_rejection_context", side_effect=RuntimeError(SECRET)), \
                self.assertRaises(runtime.CLIRuntimeError) as raised:
            coordinator.suite(files=lambda *_: next(files), controls=after)
        evidence = raised.exception.evidence
        self.assertEqual((raised.exception.code, raised.exception.semantic_code), ("CLI_SEMANTICS", "FIELD_SET"))
        self.assertEqual((evidence["status"], evidence["failedCase"]), ("FAIL", "update-check"))
        self.assertEqual(evidence["rejectionContext"], {"format": runtime.REJECTION_FORMAT,
                         "status": "UNAVAILABLE", "reasonCode": "REJECTION_PROJECTION"})
        self.assertEqual(evidence["filesystem"]["status"], "CHANGED")
        self.assertEqual(evidence["control"], {"status": "UNAVAILABLE", "reasonCode": "CONTROL_CALLBACK"})
        self.assertNotIn(SECRET, json.dumps(evidence))

    def test_malformed_json_and_nonupdate_failures_do_not_gain_observed_binding(self):
        cases = ((b'{"format":1,"format":2}', "CLI_JSON"), (b'{"value":NaN}', "CLI_JSON"),
                 (b'\xff', "CLI_UTF8"), (b'x' * (runtime.OUTPUT_LIMIT + 1), "CLI_UTF8"))
        for raw, expected in cases:
            with self.subTest(code=expected), self.assertRaises(runtime.CLIRuntimeError) as raised:
                runtime._checked(check_read_result, "update check", captured(raw), self.context, "")
            self.assertEqual(raised.exception.code, expected)
            self.assertIsNone(raised.exception.rejection_context)
        document = examples(self.context)["status"][0]
        del document["database"]["bytes"]
        error = self.reject(document, command="status")
        self.assertEqual((error.code, error.semantic_code), ("CLI_SEMANTICS", "FIELD_SET"))
        self.assertIsNone(error.rejection_context)


if __name__ == "__main__":
    unittest.main()
