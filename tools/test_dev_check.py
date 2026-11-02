"""Real local execution and fail-closed orchestration controls; no application runtime."""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import yaml
import dev_check as check
import devex_plan
import run_task_tests


def test_entry(test_id='TST-LOCAL-001', code='print("реально executed")', *, group='owned', order=10, after=None):
    return {'id': test_id, 'command': 'python -c ' + shlex.quote(code), 'timeout_seconds': 5,
            'local_check': {'eligible': True, 'reason': 'owned temporary fixture',
                            'order': order, 'group': group, 'after': after or []}}


def plan_for(tests, *, unknown=None):
    return {'status': 'BLOCKED' if unknown else 'PLANNED', 'change_class': 'L3_CRITICAL',
            'unknown': unknown or [], 'checks': [{'id': test['id'], 'command': test['command'],
                'state': 'NOT_RUN', 'reasons': ['fixture coverage']} for test in tests]}


class Fixture(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='asa check проба ')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / 'docs/testing').mkdir(parents=True)
        (self.root / 'docs/execution').mkdir(parents=True)
        (self.root / 'docs/execution/current.yaml').write_text('{}', encoding='utf-8')
        (self.root / 'package.json').write_text('{}', encoding='utf-8')
        (self.root / '.gitignore').write_text('.asa/\n', encoding='utf-8')
        self.tests = [test_entry()]
        self.catalog(self.tests)
        self.git('init', '-q')
        self.git('add', '.')
        self.git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
        (self.root / 'changed.py').write_text('# owned fixture\n', encoding='utf-8')

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.root, check=True, capture_output=True)

    def catalog(self, tests):
        (self.root / 'docs/testing/test-catalog.yaml').write_text(yaml.safe_dump({'tests': tests}), encoding='utf-8')

    def trusted_preflight(self, *_):
        return {'verification_allowed': True, 'task': {'id': 'TASK-LOCAL-001'}}

    def run_check(self, *, preflight=None, unknown=None, full=False):
        dependency = {'provenance': {'git_head': self.git('rev-parse', 'HEAD').stdout.decode().strip()}}
        with patch.object(check, 'verify_preflight', side_effect=preflight or self.trusted_preflight), \
             patch.object(check, 'affected_lanes', return_value=['fixture']), \
             patch.object(check, 'execution_blockers', return_value=[]), \
             patch.object(devex_plan, 'dependencies', return_value=dependency), \
             patch.object(devex_plan, 'plan', return_value=plan_for(self.tests, unknown=unknown)):
            return check.check(self.root, 'HEAD', full=full)

    def test_actual_positive_negative_unicode_quoting_and_selected_interpreter(self):
        expected = str(Path(sys.executable).resolve())
        positive = test_entry(code='import os, sys; assert os.environ["NX_DAEMON"] == "false"; '
                              'assert os.environ["NX_SKIP_NX_CACHE"] == "true"; '
                              'print("real marker проба"); print(sys.executable)')
        passed = run_task_tests.run_test(positive, 'TASK-LOCAL-001', root=self.root, python_executable=expected)
        self.assertEqual(passed['state'], 'PASS', passed)
        self.assertIn('real marker проба', passed['stdout_tail'])
        self.assertIn(expected, passed['stdout_tail'])
        negative = test_entry(code='import sys; print("NEGATIVE really executed"); sys.exit(19)')
        failed = run_task_tests.run_test(negative, 'TASK-LOCAL-001', root=self.root, python_executable=expected)
        self.assertEqual((failed['state'], failed['exit_code']), ('FAIL', 19), failed)
        self.assertIn('NEGATIVE really executed', failed['stdout_tail'])

    def test_actual_timeout(self):
        entry = test_entry(code='import time; time.sleep(10)')
        entry['timeout_seconds'] = 1
        result = run_task_tests.run_test(entry, 'TASK-LOCAL-001', root=self.root, python_executable=sys.executable)
        self.assertEqual(result['state'], 'FAIL', result)
        self.assertIn('timeout', result['reason'])
        self.assertLess(result['duration_s'], 8)

    def descendant_probe(self, *, forever=False):
        child = ('import os, time\nfrom pathlib import Path\n'
                 'Path("child.pid").write_text(str(os.getpid()))\n'
                 'print("inherited child pipe", flush=True)\n')
        child += 'while True: time.sleep(1)\n' if forever else 'time.sleep(4)\nPath("late.marker").write_text("escaped")\n'
        (self.root / 'child.py').write_text(child, encoding='utf-8')
        (self.root / 'launcher.py').write_text(
            'import subprocess, sys\nfrom pathlib import Path\n'
            'subprocess.Popen([sys.executable, "child.py"])\n'
            'Path("launcher.done").write_text("exited without waiting")\n', encoding='utf-8')
        entry = {'id': 'TST-EXITED-LAUNCHER-001', 'command': 'python launcher.py', 'timeout_seconds': 1}
        results, failures, jobs, processes = [], [], [], []
        original_job, original_popen = run_task_tests.WindowsJob, run_task_tests.subprocess.Popen
        def create_job():
            job = original_job()
            jobs.append(job)
            return job
        def create_process(*args, **kwargs):
            process = original_popen(*args, **kwargs)
            processes.append(process)
            return process
        def invoke():
            try:
                results.append(run_task_tests.run_test(entry, 'TASK-LOCAL-001', root=self.root,
                                                       python_executable=sys.executable))
            except BaseException as exc:
                failures.append(exc)
        # A regression must fail this test rather than hang the entire suite.
        # The watchdog owns only handles/groups created by this exact invocation.
        with patch.object(run_task_tests, 'WindowsJob', side_effect=create_job), \
             patch.object(run_task_tests.subprocess, 'Popen', side_effect=create_process):
            worker = threading.Thread(target=invoke, daemon=True)
            started = time.monotonic()
            worker.start()
            worker.join(3)
            expired = worker.is_alive()
            if expired:
                for job in jobs:
                    job.terminate()
                    job.close()
                if os.name != 'nt':
                    for process in processes:
                        try:
                            os.killpg(process.pid, 9)
                        except ProcessLookupError:
                            pass
                worker.join(1)
        self.assertFalse(expired, 'owned timeout exceeded the independent 3s watchdog')
        self.assertEqual(failures, [])
        self.assertTrue((self.root / 'launcher.done').exists(), 'launcher must really have exited')
        self.assertTrue((self.root / 'child.pid').exists(), 'pipe-holding child must really have run')
        self.assertEqual(results[0]['state'], 'FAIL', results)
        self.assertIn('timeout after 1s', results[0]['reason'])
        self.assertLess(results[0]['duration_s'], 3)
        print(f'Owned descendant ({"indefinite" if forever else "4s marker"}): {results[0]["duration_s"]}s')
        return started

    def test_fast_exited_launcher_cannot_leave_late_marker(self):
        started = self.descendant_probe()
        time.sleep(max(0, 4.4 - (time.monotonic() - started)))
        self.assertFalse((self.root / 'late.marker').exists(), 'descendant escaped after launcher exit')

    def test_indefinite_pipe_holding_descendant_is_terminated(self):
        self.descendant_probe(forever=True)
        pid = int((self.root / 'child.pid').read_text())
        if os.name == 'nt':
            import ctypes
            from ctypes import wintypes as w
            api = ctypes.WinDLL('kernel32', use_last_error=True)
            api.OpenProcess.argtypes, api.OpenProcess.restype = [w.DWORD, w.BOOL, w.DWORD], w.HANDLE
            api.WaitForSingleObject.argtypes, api.WaitForSingleObject.restype = [w.HANDLE, w.DWORD], w.DWORD
            api.CloseHandle.argtypes = [w.HANDLE]
            handle = api.OpenProcess(0x100000, False, pid)  # SYNCHRONIZE, exact owned child
            if handle:
                try:
                    self.assertEqual(api.WaitForSingleObject(handle, 0), 0, 'owned child is still running')
                finally:
                    api.CloseHandle(handle)
            else:
                self.assertEqual(ctypes.get_last_error(), 87, 'cannot verify exact owned child termination')
        else:
            state = Path(f'/proc/{pid}/stat')
            if state.exists():
                self.assertEqual(state.read_text().split(') ', 1)[1].split()[0], 'Z')

    @unittest.skipUnless(os.name == 'nt', 'Windows kill-on-close fallback')
    def test_job_termination_failure_still_closes_job_and_kills_descendant(self):
        with patch.object(run_task_tests.WindowsJob, 'terminate', side_effect=OSError('injected termination failure')):
            started = self.descendant_probe()
        time.sleep(max(0, 4.4 - (time.monotonic() - started)))
        self.assertFalse((self.root / 'late.marker').exists())

    @unittest.skipUnless(os.name == 'nt', 'Windows job close retry and failure precedence')
    def test_normal_job_close_failure_cleans_up_and_does_not_mask_test_failure(self):
        original = run_task_tests.WindowsJob.close
        for exit_code, expected in ((0, 'BLOCKED'), (19, 'FAIL')):
            calls = []
            def close(job):
                calls.append(job)
                if len(calls) == 1:
                    raise OSError('injected close failure')
                return original(job)
            entry = test_entry(code=f'print("actual execution before cleanup fault"); raise SystemExit({exit_code})')
            with self.subTest(exit_code=exit_code), patch.object(run_task_tests.WindowsJob, 'close', autospec=True, side_effect=close):
                result = run_task_tests.run_test(entry, 'TASK-LOCAL-001', root=self.root, python_executable=sys.executable)
            self.assertEqual(result['state'], expected, result)
            self.assertIn('actual execution before cleanup fault', result['stdout_tail'])
            self.assertIn('job cleanup failed', result['reason'])
            self.assertEqual(len(calls), 2)
            self.assertIsNone(calls[-1].handle)

    @unittest.skipUnless(os.name == 'nt', 'Windows suspended-start ownership')
    def test_containment_setup_fails_closed_before_command_body(self):
        marker = self.root / 'never.marker'
        entry = test_entry(code='from pathlib import Path; Path("never.marker").write_text("ran")')
        original_job, original_popen = run_task_tests.WindowsJob, run_task_tests.subprocess.Popen
        for stage in ('create', 'assign', 'resume'):
            processes = []
            def factory():
                if stage == 'create':
                    raise OSError('injected job setup failure')
                job = original_job()
                api = 'AssignProcessToJobObject' if stage == 'assign' else 'ResumeThread'
                setattr(job.api, api, lambda *_args: 0)
                return job
            def launch(*args, **kwargs):
                process = original_popen(*args, **kwargs)
                processes.append(process)
                self.assertTrue(kwargs['creationflags'] & 0x4)
                return process
            with self.subTest(stage=stage), patch.object(run_task_tests, 'WindowsJob', side_effect=factory), \
                 patch.object(run_task_tests.subprocess, 'Popen', side_effect=launch):
                started = time.monotonic()
                result = run_task_tests.run_test(entry, 'TASK-LOCAL-001', root=self.root, python_executable=sys.executable)
                self.assertEqual(result['state'], 'BLOCKED', result)
                self.assertLess(time.monotonic() - started, 3)
                self.assertFalse(marker.exists())
                self.assertTrue(all(process.poll() is not None for process in processes))
                if stage == 'create':
                    self.assertEqual(processes, [])

    def test_cleanup_never_uses_unbounded_output_drain(self):
        process = unittest.mock.Mock()
        process.communicate.side_effect = subprocess.TimeoutExpired('fixture', 1)
        errors = run_task_tests.stop_and_drain(process, None, owned=False)
        process.communicate.assert_called_once_with(timeout=run_task_tests.OUTPUT_DRAIN_SECONDS)
        self.assertIn('bounded output drain', errors[0])

    def test_actual_missing_and_blocked_exit(self):
        for command, state in [('missing-asa-test-executable', 'BLOCKED'),
                               ('python -c "raise SystemExit(78)"', 'BLOCKED')]:
            result = run_task_tests.run_test({'id': 'A', 'command': command}, 'TASK-LOCAL-001',
                                             root=self.root, python_executable=sys.executable)
            self.assertEqual(result['state'], state)

    def test_existing_runner_still_executes_all_mandatory_tests_without_local_filter(self):
        entries = [test_entry('TST-A-001'), test_entry('TST-B-001')]
        (self.root / 'mandatory.py').write_text('import os\nassert os.environ["NX_DAEMON"] == "legacy-sentinel"\n'
                                               'print("actual mandatory execution")\n', encoding='utf-8')
        entries[0]['local_check'] = {'eligible': False, 'reason': 'local filter must not affect task runner'}
        for entry in entries:
            entry['required_for'] = ['TASK-LOCAL-001']
            entry['command'] = 'python mandatory.py'
        self.catalog(entries)
        output = self.root / 'mandatory.json'
        with patch.object(run_task_tests, 'ROOT', self.root), \
             patch.dict(os.environ, {'NX_DAEMON': 'legacy-sentinel'}), \
             patch.object(run_task_tests, 'CATALOG_PATHS', (self.root / 'docs/testing/test-catalog.yaml',)), \
             patch.object(sys, 'argv', ['run_task_tests.py', '--task', 'TASK-LOCAL-001', '--json', str(output)]):
            self.assertEqual(run_task_tests.main(), 0)
        result = json.loads(output.read_text(encoding='utf-8'))
        self.assertEqual((result['total'], result['passed']), (2, 2))
        self.assertTrue(all('actual mandatory execution' in item['stdout_tail'] for item in result['results']))

    def test_real_command_runs_with_unknown_coverage_and_ci_pending(self):
        pending = test_entry('TST-DATABASE-001')
        pending['local_check'] = {'eligible': False, 'reason': 'isolated CI database only'}
        self.tests.append(pending)
        self.catalog(self.tests)
        result = self.run_check(unknown=['unresolved consumer'])
        self.assertEqual(result['status'], 'BLOCKED')
        self.assertEqual(result['local_status'], 'PASS')
        states = {item['id']: item['state'] for item in result['checks']}
        self.assertEqual(states, {'TST-LOCAL-001': 'PASS', 'TST-DATABASE-001': 'NOT_RUN'})
        self.assertIn('executed', next(item for item in result['checks'] if item['state'] == 'PASS')['stdout_tail'])
        self.assertEqual(result['full_ci'], 'NOT_RUN')

    def test_real_failure_is_not_masked_by_unknown_coverage(self):
        self.tests = [test_entry(code='raise SystemExit(23)')]
        self.catalog(self.tests)
        result = self.run_check(unknown=['missing map'])
        self.assertEqual((result['status'], result['local_status']), ('FAIL', 'FAIL'))

    def test_preflight_stops_dependency_provider_tests_and_writes(self):
        with patch.object(devex_plan, 'dependencies') as dependencies, \
             patch.object(check, 'run_checks') as runner, \
             patch.object(check, 'verify_preflight', return_value={'verification_allowed': False, 'mode': 'WAITING_HANDOFF'}):
            result = check.check(self.root, 'HEAD')
        dependencies.assert_not_called()
        runner.assert_not_called()
        check.save_report(self.root, result, '.asa/devex/blocked.json')
        self.assertEqual(result['storage']['status'], 'not_saved')
        self.assertFalse((self.root / '.asa').exists())

    def test_full_never_starts_local_runtime(self):
        with patch.object(devex_plan, 'dependencies') as provider:
            result = self.run_check(full=True)
        provider.assert_not_called()
        self.assertEqual((result['status'], result['checks']), ('BLOCKED', []))
        self.assertIn('isolated CI', result['reasons'][0])

    def test_default_deny_no_command_from_plan_or_changed_catalog(self):
        entry = test_entry()
        del entry['local_check']
        self.catalog([entry])
        records = check.run_checks(self.root, plan_for([entry]), {entry['id']: entry}, 'TASK-LOCAL-001', lambda: True)
        self.assertEqual(records[0]['state'], 'NOT_RUN')
        injected = plan_for([entry])
        injected['checks'][0]['command'] = 'python -c "raise RuntimeError()"'
        with self.assertRaisesRegex(ValueError, 'command changed'):
            check.run_checks(self.root, injected, {entry['id']: entry}, 'TASK-LOCAL-001', lambda: True)
        original = test_entry()
        altered = test_entry(code='raise SystemExit(0)')
        self.catalog([altered])
        records = check.run_checks(self.root, plan_for([original]), {original['id']: original}, 'TASK-LOCAL-001', lambda: True)
        self.assertEqual(records[0]['state'], 'BLOCKED')

    def test_order_dependencies_and_resource_groups(self):
        tests = [test_entry('A'), test_entry('B', group='other'),
                 test_entry('C', order=20, after=['A', 'B']), test_entry('D')]
        self.catalog(tests)
        active, peak, lock = set(), [], threading.Lock()
        completed = []
        def executor(test, *_args, **_kwargs):
            with lock:
                group = test['local_check']['group']
                self.assertNotIn(group, active)
                self.assertTrue(set(test['local_check']['after']).issubset(completed))
                active.add(group)
                peak.append(len(active))
            time.sleep(.08)
            with lock:
                active.remove(group)
                completed.append(test['id'])
            return {'id': test['id'], 'state': 'PASS'}
        with patch.object(run_task_tests, 'run_test', side_effect=executor):
            result = check.run_checks(self.root, plan_for(tests), {test['id']: test for test in tests},
                                      'TASK-LOCAL-001', lambda: True)
        self.assertTrue(all(item['state'] == 'PASS' for item in result))
        self.assertEqual(max(peak), 2)

    def test_failed_predecessor_never_runs_dependent(self):
        tests = [test_entry('A', code='raise SystemExit(8)'), test_entry('B', order=20, after=['A'])]
        self.catalog(tests)
        result = check.run_checks(self.root, plan_for(tests), {test['id']: test for test in tests},
                                  'TASK-LOCAL-001', lambda: True)
        self.assertEqual([item['state'] for item in result], ['FAIL', 'NOT_RUN'])

    def test_concurrent_different_roots_serialize_shared_loader_and_restore_globals(self):
        self.catalog([test_entry('A')])
        other = self.root / 'other owned root'
        (other / 'docs/testing').mkdir(parents=True)
        (other / 'docs/testing/test-catalog.yaml').write_text(
            yaml.safe_dump({'tests': [test_entry('B')]}), encoding='utf-8')
        original = (run_task_tests.ROOT, run_task_tests.CATALOG_PATHS)
        loader = devex_plan.catalog
        active, peak = 0, []
        def observed_loader(root):
            nonlocal active
            active += 1
            peak.append(active)
            time.sleep(.03)
            try:
                return loader(root)
            finally:
                active -= 1
        with patch.object(devex_plan, 'catalog', side_effect=observed_loader), ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(check.catalog_at_source, self.root)
            second = pool.submit(check.catalog_at_source, other)
            self.assertEqual(set(first.result()), {'A'})
            self.assertEqual(set(second.result()), {'B'})
        self.assertEqual(max(peak), 1)
        self.assertEqual((run_task_tests.ROOT, run_task_tests.CATALOG_PATHS), original)

    def test_source_change_invalidates_execution(self):
        result = check.run_checks(self.root, plan_for(self.tests), {test['id']: test for test in self.tests},
                                  'TASK-LOCAL-001', lambda: False)
        self.assertEqual(result[0]['state'], 'BLOCKED')

    def test_report_unique_source_binding_safe_storage_and_permission_denial(self):
        result = self.run_check()
        check.save_report(self.root, result, '.asa/devex/check.json')
        saved = json.loads((self.root / '.asa/devex/check.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['run_id'], result['run_id'])
        self.assertEqual(saved['source_binding'], result['source_binding'])
        with patch.object(Path, 'mkdir', side_effect=PermissionError('fixture denied')):
            check.save_report(self.root, result, '.asa/devex/denied.json')
        self.assertEqual(result['storage']['status'], 'not_saved')
        self.assertEqual(result['status'], 'BLOCKED')
        for path in ('../foreign.json', '.asa/devex/../../../foreign.json', 'source.json',
                     '.asa/devex/NUL.json', '.asa/devex/file.json:stream.json'):
            with self.assertRaises(ValueError):
                check.output_path(self.root, path)

    def test_symlink_or_windows_junction_escape(self):
        with tempfile.TemporaryDirectory(prefix='asa report outside ') as outside:
            link = self.root / '.asa'
            if os.name == 'nt':
                result = subprocess.run(['cmd', '/d', '/c', 'mklink', '/J', str(link), outside], capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.addCleanup(lambda: os.rmdir(link))
            else:
                link.symlink_to(outside, target_is_directory=True)
                self.addCleanup(link.unlink)
            with self.assertRaisesRegex(ValueError, 'symlink/junction'):
                check.output_path(self.root, '.asa/devex/report.json')
            self.assertEqual(list(Path(outside).iterdir()), [])

    def test_legacy_and_other_lane_blockers(self):
        document = {'blocking': [{'lane': 'second', 'blocks': ['tests']},
                                 {'lane': 'first', 'kind': 'deployment_blocker'}]}
        lanes = [{'id': name, 'task': {}} for name in ('first', 'second')]
        with patch.object(check.agent_context, 'collect_lanes', return_value=lanes):
            self.assertEqual(check.execution_blockers(document, ['first']), [])
            self.assertEqual(len(check.execution_blockers(document, ['first', 'second'])), 1)

    def test_plan_valid_does_not_bypass_handoff_cp_blockers_or_unknown_dirty(self):
        snap = devex_plan.snapshot(self.root, 'HEAD')
        paths = sorted({item['path'] for item in snap['changes']})
        baseline = {'mode': 'PLAN_VALID', 'remote_refresh': {'status': 'PASS'},
                    'control_plane': {'status': 'PASS'}, 'git': {'dirty_paths': paths},
                    'plan': {'actual_paths': paths}, 'recovery_mode': 'RECOVERY_REQUIRED'}
        for changes in ({}, {'mode': 'WAITING_HANDOFF'}, {'control_plane': {'status': 'FAIL'}},
                        {'worktree_overlaps': ['foreign']}, {'execution_blocking': ['stop']},
                        {'git': {'dirty_paths': ['foreign']}}):
            with self.subTest(changes=changes), \
                 patch.object(check, 'affected_lanes', return_value=['first', 'second']), \
                 patch.object(check, 'execution_blockers', return_value=[]), \
                 patch.object(check.agent_context, 'load_current', return_value={}), \
                 patch.object(check.agent_preflight, 'build_preflight', return_value={**baseline, **changes}) as preflight:
                result = check.verify_preflight(self.root, snap, paths)
                self.assertEqual(result['verification_allowed'], not changes)
                self.assertEqual(preflight.call_count, 1)
                self.assertFalse(result['dirty_classification']['edit_or_publication_authorized'])


if __name__ == '__main__':
    unittest.main()
