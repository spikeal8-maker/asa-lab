"""Actual process/signal regressions for the privileged launcher supervisor.

Host discovery and UID metadata use an isolated fixture; interruption and child
exit statuses come from real subprocesses. No Docker or system users change.
"""

import json
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest
from types import SimpleNamespace
from unittest.mock import patch


DRIVER = textwrap.dedent(r'''
    import importlib.util
    import json
    import os
    from pathlib import Path
    import signal
    import stat
    import subprocess
    import sys

    source, scenario, directory, output_mode = sys.argv[1:]
    root = Path(directory)
    spec = importlib.util.spec_from_file_location("launcher_under_test", source)
    launcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(launcher)
    owner = {"uid": 12345, "gid": 12345, "name": "fixture-operator", "home": str(root),
             "root": str(root), "backupDirectory": str(root / "backups"), "paths": []}
    launcher.os.geteuid = lambda: 0
    launcher.validate_owner = lambda *args, **kwargs: dict(owner)
    launcher.platform_info = lambda: {"supported": True}
    launcher.dependency_plan = lambda **kwargs: {"missing": [], "installDocker": False, "daemonId": "original"}
    launcher.verify_operator_daemon = lambda *args: None
    def verify_bundle(bundle):
        if scenario == "parent-sigint":
            os.kill(os.getpid(), signal.SIGINT)
        return {}
    launcher.verify_bundle = verify_bundle

    # Model the verified operator's ownership without chown/setuid.
    original_stat, original_fstat = Path.stat, os.fstat
    def owner_info(info):
        fields = list(info)
        fields[4:6] = [owner["uid"], owner["gid"]]
        return os.stat_result(fields)
    def fixture_stat(path, *args, **kwargs):
        info = original_stat(path, *args, **kwargs)
        return owner_info(info) if path == root or root in path.parents else info
    def fixture_fstat(descriptor):
        info = original_fstat(descriptor)
        return owner_info(info) if stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode) else info
    Path.stat = fixture_stat
    os.fstat = fixture_fstat
    os.fchown = lambda *args: None

    CHILD = r"""
    import json
    import os
    from pathlib import Path
    import signal
    import sys
    root, scenario, tools_path = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    path = root / '.asa/setup-last-attempt.json'
    if scenario.startswith('render-'):
        sys.path.insert(0, tools_path)
        from deployment.setup_result import finalize, render
        value = finalize(json.loads(path.read_text()))
        render(value, as_json=scenario.endswith('json'))
        raise SystemExit(value['exitCode'])
    if scenario.startswith('receipt-'):
        value = json.loads((root / 'new-result.json').read_text())
        path.write_text(json.dumps(value))
        path.chmod(0o600)
    if scenario.endswith('sigint'):
        signal.signal(signal.SIGINT, signal.SIG_DFL)
        os.kill(os.getpid(), signal.SIGINT)
    raise SystemExit(130)
    """
    def owner_call(operator, arguments, environment, **kwargs):
        with (root / 'calls.jsonl').open('a') as stream:
            stream.write(json.dumps(arguments) + '\n')
        child_scenario = scenario if '--defer-report' in arguments else 'render-' + output_mode
        options = {'text': True, 'check': False, 'timeout': 15}
        if kwargs.get('capture'):
            options.update(stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        completed = subprocess.run([sys.executable, '-I', '-B', '-c', CHILD, str(root), child_scenario,
                                   str(Path(source).parent)], **options)
        if '-race-' in scenario and '--defer-report' in arguments:
            # A different permitted operation finishes after the child drops
            # its lock, before the supervisor examines the shared last-attempt.
            foreign = json.loads((root / 'new-result.json').read_text())
            foreign.update(operationId='d' * 32, observedAt='newer-concurrent-operation')
            content = (json.dumps(foreign, indent=2) + '\n').encode('utf-8')
            path = root / '.asa/setup-last-attempt.json'
            path.write_bytes(content)
            path.chmod(0o600)
            (root / 'concurrent-result.json').write_bytes(content)
        return completed
    launcher._owner_call = owner_call
    arguments = ['auto', '--root', str(root), '--non-interactive']
    if output_mode == 'json':
        arguments.append('--json')
    raise SystemExit(launcher.main(arguments))
''')


@unittest.skipUnless(os.name == "posix", "actual SIGINT and Linux launcher supervision")
class LauncherInterruptionProcessTests(unittest.TestCase):
    def accepted(self, operation_id):
        return {"format": "asa-setup-result-v1", "operationId": operation_id, "installationId": "b" * 32,
                "mode": "install", "outcome": "ACCEPTED", "exitCode": 0, "observedAt": operation_id,
                "actionExecuted": True, "executionCompleted": True, "applicationAccepted": True,
                "dataProtectionConfirmed": True, "accepted": True, "postActions": [],
                "dependencies": {"status": "OK"}, "version": {"status": "OK"}, "data": {"status": "PRESERVED"},
                "backup": {"status": "OK", "outcome": "ACCEPTED", "policy": "required", "local": {"status": "OK"},
                           "encryption": {"status": "OK"}, "cloud": {"status": "OK"}},
                "site": {"status": "OK", "technical": {"status": "passed"}, "browser": {"status": "passed"},
                         "owner": {"status": "READY"}}, "diagnostics": {"status": "passed"}, "nextAction": "Можно работать."}

    def run_scenario(self, scenario, output_mode):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        state = root / ".asa"
        state.mkdir(mode=0o700)
        config = {"format": "asa-setup-config-v1", "root": str(root), "operatorUid": 12345,
                  "installationId": "b" * 32, "project": "fixture", "backup": {"cloud": {"enabled": False}},
                  "browser": {"pythonPath": "/existing/runtime/python"}}
        previous = self.accepted("c" * 32)
        for name, value in (("setup.json", config), ("setup-last-attempt.json", previous), ("setup-last-successful.json", previous)):
            path = state / name
            path.write_text(json.dumps(value))
            path.chmod(0o600)
        (state / "operation.lock").touch(mode=0o600)
        (root / "new-result.json").write_text(json.dumps(self.accepted("a" * 32)))
        source = Path(__file__).resolve().parents[1] / "asa_setup_launcher.py"
        completed = subprocess.run([sys.executable, "-I", "-B", "-c", DRIVER, str(source), scenario, str(root), output_mode],
                                   text=True, capture_output=True, timeout=25, check=False)
        self.assertEqual(completed.returncode, 130, (completed.stdout, completed.stderr))
        self.assertEqual(json.loads((state / "setup-last-successful.json").read_text()), previous)
        stored = json.loads((state / "setup-last-attempt.json").read_text())
        raced = "-race-" in scenario
        if raced:
            self.assertEqual((state / "setup-last-attempt.json").read_bytes(), (root / "concurrent-result.json").read_bytes())
        if output_mode == "json":
            report = json.loads(completed.stdout)
            self.assertEqual(report["outcome"], "INTERRUPTED")
            self.assertEqual(report["exitCode"], completed.returncode)
            self.assertEqual(report["reasonCode"], "INTERRUPTED")
            self.assertFalse(report["executionCompleted"])
            self.assertFalse(report["accepted"])
            self.assertIsNone(report["operationId"])
            self.assertIsNone(report["installationId"])
            self.assertFalse(report["applicationAccepted"])
            self.assertFalse(report["dataProtectionConfirmed"])
            self.assertEqual(report["interruptionReceipt"]["status"], "NOT_ATTRIBUTED")
            self.assertIn("status", report["nextAction"])
        else:
            self.assertIn("ПРЕРВАН", completed.stdout)
            self.assertIn("код 130", completed.stdout)
            self.assertNotIn("ГОТОВО К РАБОТЕ", completed.stdout)
            self.assertNotIn("\033[", completed.stdout)
            self.assertNotIn("a" * 32, completed.stdout)
            self.assertNotIn("d" * 32, completed.stdout)
            self.assertNotIn("[OK]", completed.stdout)
            self.assertIn("Квитанция этого запуска не подтверждена", completed.stdout)
        if scenario.startswith("receipt-"):
            self.assertEqual((state / "setup-last-attempt.json").read_bytes(), (root / "new-result.json").read_bytes())
        elif not raced:
            self.assertEqual(stored, previous)
        calls_path = root / "calls.jsonl"
        calls = [json.loads(line) for line in calls_path.read_text().splitlines()] if calls_path.exists() else []
        self.assertFalse(any("--root-action" in arguments for arguments in calls))
        self.assertFalse(any("--render-last" in arguments for arguments in calls))

    def test_actual_keyboard_interrupt_reports_130_in_json_and_text(self):
        for output_mode in ("json", "text"):
            with self.subTest(output=output_mode):
                self.run_scenario("parent-sigint", output_mode)

    def test_actual_child_exit_or_signal_without_new_receipt_never_reuses_success(self):
        for scenario in ("no-receipt-exit130", "no-receipt-sigint"):
            for output_mode in ("json", "text"):
                with self.subTest(scenario=scenario, output=output_mode):
                    self.run_scenario(scenario, output_mode)

    def test_actual_child_interrupt_does_not_claim_unbound_receipt(self):
        for scenario in ("receipt-exit130", "receipt-sigint"):
            for output_mode in ("json", "text"):
                with self.subTest(scenario=scenario, output=output_mode):
                    self.run_scenario(scenario, output_mode)

    def test_concurrent_success_after_interrupted_child_is_not_claimed_or_rewritten(self):
        for scenario in ("no-receipt-race-exit130", "no-receipt-race-sigint"):
            for output_mode in ("json", "text"):
                with self.subTest(scenario=scenario, output=output_mode):
                    self.run_scenario(scenario, output_mode)


@unittest.skipUnless(os.name == "posix", "Linux supervisor intent boundary")
class PublicIntentSupervisorTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / ".asa").mkdir(mode=0o700)
        source = Path(__file__).resolve().parents[1] / "asa_setup_launcher.py"
        spec = importlib.util.spec_from_file_location("intent_launcher_fixture", source)
        self.launcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.launcher)
        self.owner = {"uid": 12345, "gid": 12345, "name": "fixture-owner", "home": str(self.root), "root": str(self.root)}
        self.config = {"format": "asa-setup-config-v1", "root": str(self.root), "operatorUid": 12345,
                       "installationId": "b" * 32, "project": "fixture", "backup": {"cloud": {"enabled": False}},
                       "browser": {"pythonPath": "/existing/runtime/python"}}
        self.save("setup.json", self.config)

    def save(self, name, value):
        path = self.root / ".asa" / name
        path.write_text(json.dumps(value))
        path.chmod(0o600)

    def test_install_intent_is_checked_before_package_cloud_browser_or_config_preparation(self):
        launcher = self.launcher
        with patch.object(launcher.os, "geteuid", return_value=0), \
             patch.object(launcher, "verify_bundle"), \
             patch.object(launcher, "platform_info", return_value={"supported": True}), \
             patch.object(launcher, "validate_owner", return_value=self.owner), \
             patch.object(launcher, "_owner_call", return_value=SimpleNamespace(returncode=2)) as observe, \
             patch.object(launcher, "dependency_plan", side_effect=AssertionError("Preparation before intent")), \
             patch.object(launcher, "provision_dependencies", side_effect=AssertionError("Packages changed")), \
             patch.object(launcher, "prepare_cloud_for_policy", side_effect=AssertionError("Cloud changed")), \
             patch.object(launcher, "_write_owner_json", side_effect=AssertionError("Config changed")), \
             patch("sys.stdout", new_callable=io.StringIO) as output:
            code = launcher.main(["auto", "--intent", "install", "--root", str(self.root), "--json"])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output.getvalue())["reasonCode"], "OPERATION_INTENT")
        self.assertEqual(observe.call_count, 1)
        self.assertIn("intent-check", observe.call_args.args[1])

    def test_fresh_intent_check_runs_real_readonly_child_before_target_exists(self):
        launcher = self.launcher
        target = self.root / "not-created"
        owner = {**self.owner, "root": str(target)}
        bundle = self.root / "fixture-bundle"
        (bundle / "tools").mkdir(parents=True)
        program = bundle / "tools/asa_setup.py"
        real_run = subprocess.run
        def tree():
            return {str(path.relative_to(self.root)): (path.stat().st_mtime_ns,
                    path.read_bytes() if path.is_file() else None) for path in self.root.rglob("*")}
        for child_code in (0, 2):
            with self.subTest(child_code=child_code):
                program.write_text(
                    "import json, os, sys\nfrom pathlib import Path\n"
                    "arguments = sys.argv[1:]\n"
                    "target = Path(arguments[arguments.index('--root') + 1])\n"
                    "print(json.dumps({'arguments': arguments, 'cwd': os.getcwd(), 'targetExists': target.exists()}))\n"
                    "raise SystemExit(" + str(child_code) + ")\n", encoding="utf-8")
                before, calls = tree(), []
                def run(arguments, **kwargs):
                    # Keep _owner_call and the actual subprocess/chdir intact.
                    result = real_run(arguments, **kwargs)
                    calls.append((arguments, kwargs, result))
                    return result
                with patch.object(launcher, "__file__", str(bundle / "tools/asa_setup_launcher.py")), \
                     patch.object(launcher.os, "geteuid", return_value=owner["uid"]), \
                     patch.object(launcher, "platform_info", return_value={"supported": True}), \
                     patch.object(launcher, "validate_owner", return_value=owner), \
                     patch.object(launcher.subprocess, "run", side_effect=run), \
                     patch.object(launcher, "dependency_plan", side_effect=launcher.SetupBlocked("AFTER_INTENT", "fixture stop", "stop")) as preparation, \
                     patch.object(launcher, "provision_dependencies", side_effect=AssertionError("Packages changed")), \
                     patch.object(launcher, "_write_owner_json", side_effect=AssertionError("Config changed")), \
                     patch("sys.stdout", new_callable=io.StringIO) as output:
                    code = launcher.main(["auto", "--intent", "install", "--root", str(target), "--non-interactive", "--json"])
                self.assertEqual(code, 2)
                self.assertEqual(json.loads(output.getvalue())["reasonCode"], "AFTER_INTENT" if child_code == 0 else "OPERATION_INTENT")
                self.assertEqual(preparation.call_count, 1 if child_code == 0 else 0)
                self.assertEqual(len(calls), 1)
                arguments, options, completed = calls[0]
                self.assertEqual(completed.returncode, child_code)
                self.assertEqual(completed.stderr, "")
                observed = json.loads(completed.stdout)
                self.assertEqual(observed["arguments"], ["intent-check", "--intent", "install", "--root", str(target)])
                self.assertEqual(observed["cwd"], "/")
                self.assertEqual(options["cwd"], "/")
                self.assertFalse(observed["targetExists"])
                self.assertEqual(arguments[1:3], ["-I", "-B"])
                self.assertFalse(target.exists())
                self.assertEqual(tree(), before)

    def test_other_owner_calls_keep_target_cwd_and_do_not_create_a_missing_target(self):
        launcher = self.launcher
        command = [sys.executable, "-I", "-B", "-c", "import os; print(os.getcwd())"]
        with patch.object(launcher.os, "geteuid", return_value=self.owner["uid"]):
            completed = launcher._owner_call(self.owner, command, launcher.operator_environment(self.owner), capture=True, timeout=5)
            self.assertEqual(completed.returncode, 0)
            self.assertEqual(completed.stdout.strip(), str(self.root))
            self.assertEqual(completed.stderr, "")
            target = self.root / "not-created"
            with self.assertRaises(FileNotFoundError) as caught:
                launcher._owner_call({**self.owner, "root": str(target)}, command,
                                     launcher.operator_environment(self.owner), capture=True, timeout=5)
        self.assertEqual(caught.exception.errno, 2)
        self.assertEqual(caught.exception.filename, str(target))
        self.assertFalse(target.exists())

    def test_preparation_resume_preserves_digest_and_intent_before_release_selection(self):
        launcher, calls = self.launcher, []
        pin = "sha256:" + "e" * 64
        operation = "a" * 32
        def child(owner, arguments, environment, **kwargs):
            calls.append(arguments)
            if "intent-check" in arguments:
                return SimpleNamespace(returncode=0)
            if "--render-last" in arguments:
                return SimpleNamespace(returncode=2)
            resumed = "resume" in arguments
            value = {"format": "asa-setup-result-v1", "operationId": operation, "installationId": "b" * 32,
                     "mode": "update", "outcome": "BLOCKED" if resumed else "PREPARATION_REQUIRED",
                     "preparation": {"packages": True}, "postActions": [], "applicationAccepted": False}
            self.save("setup-last-attempt.json", value)
            return SimpleNamespace(returncode=2)
        with patch.object(launcher.os, "geteuid", return_value=0), \
             patch.object(launcher, "verify_bundle"), \
             patch.object(launcher, "platform_info", return_value={"supported": True}), \
             patch.object(launcher, "validate_owner", return_value=self.owner), \
             patch.object(launcher, "verify_operator_daemon"), \
             patch.object(launcher, "dependency_plan", return_value={"missing": [], "installDocker": False, "daemonId": "fixture"}), \
             patch.object(launcher, "prepare_handoff", side_effect=lambda root, owner, bundle, value, environment, **kw: environment), \
             patch.object(launcher, "_owner_call", side_effect=child), patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(launcher.main(["auto", "--intent", "update", "--deployment-digest", pin,
                                          "--root", str(self.root), "--non-interactive", "--json"]), 2)
        resumes = [argv for argv in calls if "resume" in argv]
        self.assertEqual(len(resumes), 1)
        argv = resumes[0]
        self.assertEqual(argv[argv.index("--intent") + 1], "update")
        self.assertEqual(argv[argv.index("--deployment-digest") + 1], pin)
        self.assertEqual(argv[argv.index("--operation-id") + 1], operation)
        self.assertTrue(all("--prepare-browser-runtime" not in argv and "--root-action" not in argv for argv in calls))


if __name__ == "__main__":
    unittest.main()
