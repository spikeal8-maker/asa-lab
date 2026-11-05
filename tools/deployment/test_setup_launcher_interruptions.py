"""Actual process/signal regressions for the privileged launcher supervisor.

Host discovery and UID metadata use an isolated fixture; interruption and child
exit statuses come from real subprocesses. No Docker or system users change.
"""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest


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


if __name__ == "__main__":
    unittest.main()
