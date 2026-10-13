"""Lifecycle tests never register host tasks or services."""
import datetime as dt
import json
import os
import subprocess
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import collector as lifecycle
from deployment.contracts import Blocked, atomic_json
from deployment.system import Installation
import asa_manager
from collect_logs import write_process_health, write_collector_health, process_identity, Collector
from deployment.paths import plain_paths
from deployment import ci_collector_cleanup as ci_cleanup


def fixture(root):
    (root / 'tools').mkdir()
    for name in ('collect_logs.py', 'collect-windows-logs.ps1'):
        (root / 'tools' / name).write_text('fixture-' + name)
    (root / '.env').write_text('COMPOSE_PROJECT_NAME=asa-lab-dev\n')
    return Installation(root, 'dev')


class CollectorLifecycleTests(unittest.TestCase):
    def test_status_and_manager_doctor_check_do_not_create_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            result = lifecycle.status(install)
            self.assertEqual(result['state'], 'unavailable')
            with patch.object(install, 'identity', return_value={}), patch.object(install, 'readiness', return_value={'revision': 'a'*40, 'schema': 203}), patch('asa_manager.run'):
                asa_manager.doctor(install)
            with patch.object(install, 'readiness', return_value={'revision': 'a'*40, 'schema': 203}), patch('asa_manager.doctor'), patch('asa_manager.clean_checkout'), patch('asa_manager.attest_editor_env'), patch('asa_manager.discover_release', return_value={'revision': 'a'*40, 'schema': 203}), patch('asa_manager.assert_ci'), patch('asa_manager.prepare_collector') as prepare, patch('asa_manager.reconcile_collector') as reconcile:
                asa_manager.update(install, check=True)
                prepare.assert_not_called(); reconcile.assert_not_called()
            after = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
            self.assertEqual(before, after)

    def test_prepare_preserves_custom_config_history_and_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            config = {'version': 1, 'project': install.project, 'retentionDays': 45, 'maxBytes': 4*1024**3, 'customFutureSetting': True}
            atomic_json(install.state / 'log-collector.json', config)
            atomic_json(install.state / 'installation.json', {'project': install.project, 'profile': 'dev', 'automaticUpdates': True})
            install = Installation(root, 'dev')
            history = install.state / 'diagnostics/private/index.sqlite'; history.parent.mkdir(parents=True); history.write_bytes(b'durable-history')
            before = (install.state / 'log-collector.json').read_bytes()
            with patch('deployment.collector.WINDOWS', True), patch.object(install, 'identity', return_value={}):
                lifecycle.prepare(install); lifecycle.prepare(install)
            self.assertEqual(before, (install.state / 'log-collector.json').read_bytes())
            self.assertTrue(json.loads((install.state / 'installation.json').read_text())['automaticUpdates'])
            self.assertEqual(history.read_bytes(), b'durable-history')

    def test_invalid_project_and_future_schema_reject_before_any_write(self):
        for config in ({'version': 2}, {'project': 'another-stack'}, {'intervalSeconds': True}, {'fileSources': [{'source': 'tunnel', 'path': '../credentials'}]}):
            with self.subTest(config=config), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); install = fixture(root)
                atomic_json(install.state / 'log-collector.json', config)
                before = (install.state / 'log-collector.json').read_bytes()
                with patch.object(install, 'identity', return_value={}), self.assertRaises(Blocked): lifecycle.prepare(install)
                self.assertEqual(before, (install.state / 'log-collector.json').read_bytes())
                self.assertFalse((install.state / 'diagnostics').exists())

    def test_stale_or_future_or_foreign_process_never_counts_as_running(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            store = install.state / 'diagnostics/store'; store.mkdir(parents=True)
            identity = process_identity(root, install.project)
            for change in ({}, {'root': 'foreign'}, {'project': 'foreign'}, {'pid': -1}, {'nonce': 'not-a-nonce'}, {'checkedAt': '2099-01-01T00:00:00Z'}, {'checkedAt': '2000-01-01T00:00:00Z'}):
                value = {**identity, 'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(), **change}
                atomic_json(store / 'collector-process.json', value)
                result = lifecycle.status(install)
                self.assertEqual(result['state'] == 'running', not bool(change))

    def test_restart_requires_new_nonce_and_failed_start_only_degrades_collector(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            (install.state / 'diagnostics/store').mkdir(parents=True)
            (install.state / 'diagnostics/private').mkdir()
            identity = process_identity(root, install.project); write_process_health(root, identity)
            runner = {'root': str(root), 'project': install.project, 'scriptDigest': lifecycle.digest(root), 'mode': 'windows-task'}
            with patch.object(install, 'identity'), patch('deployment.collector.finalize_permissions'), patch('deployment.collector.reader_probe'), patch('deployment.collector.runner_identity', return_value=runner), patch('deployment.collector.reconcile_runner', return_value='owned runner') as start:
                failed = lifecycle.reconcile(install, wait_seconds=0)
                self.assertEqual(failed['state'], 'degraded'); self.assertEqual(failed['code'], 'COLLECTOR_START')
                def restarted(*args):
                    write_process_health(root, process_identity(root, install.project)); return 'owned runner'
                start.side_effect = restarted
                succeeded = lifecycle.reconcile(install, wait_seconds=0)
                self.assertEqual(succeeded['state'], 'running')
                self.assertNotEqual(succeeded['process']['nonce'], identity['nonce'])
                self.assertFalse((install.state / 'failed-switch.json').exists())

    def test_windows_rejects_foreign_action_privilege_interpreter_and_extra_action(self):
        identity = {'root': str(Path(tempfile.gettempdir()) / 'asa-owned'), 'owner': 'machine\\operator'}
        xml = lifecycle.windows_xml(identity, sys.executable)
        lifecycle.verify_windows_task(xml, identity)
        sid_identity = {**identity, 'ownerSid': 'S-1-5-21-1234'}
        short_name = xml.replace('machine\\operator', 'operator')
        lifecycle.verify_windows_task(short_name, sid_identity, 'S-1-5-21-1234')
        with self.assertRaises(Blocked): lifecycle.verify_windows_task(short_name, sid_identity, 'S-1-5-21-foreign')
        variants = [xml.replace('LeastPrivilege', 'HighestAvailable'), xml.replace('--root', '--foreign-root'),
                    xml.replace(str(sys.executable), str(Path(tempfile.gettempdir()) / 'foreign-python.exe')),
                    xml.replace('</Exec>', '</Exec><ComHandler><ClassId>foreign</ClassId></ComHandler>'),
                    xml.replace('machine\\operator', 'machine\\other'), xml.replace('<UserId>machine\\operator</UserId>', '<UserId></UserId>')]
        for changed in variants:
            with self.subTest(changed=changed[-200:]), self.assertRaises(Blocked): lifecycle.verify_windows_task(changed, identity)

    def test_systemd_rejects_comments_duplicates_extra_commands_and_root_user(self):
        identity = {'root': '/srv/asa', 'owner': 'operator', 'mode': 'system'}
        script = '/srv/asa/tools/collect_logs.py'
        unit = f'[Unit]\nDescription=ASA\n[Service]\nUser=operator\nWorkingDirectory=/srv/asa\nExecStart="/usr/bin/python3" "{script}" --root "/srv/asa"\nNoNewPrivileges=true\n[Install]\nWantedBy=multi-user.target\n'
        lifecycle.verify_systemd_unit(unit, identity, '/usr/bin/python3')
        lifecycle.verify_systemd_unit(unit.replace('Description=ASA', 'Description=ASA\nAfter=docker.service'), identity, '/usr/bin/python3')
        for text in (unit.replace('WorkingDirectory=/srv/asa', 'WorkingDirectory="/srv/asa"'),
                     unit.replace('ExecStart=', '#ExecStart='), unit.replace('User=operator', 'User=root'),
                     unit.replace('[Install]', 'ExecStartPre=/bin/foreign\n[Install]'), unit.replace('User=operator', 'User=operator\nUser=other')):
            with self.assertRaises(Blocked): lifecycle.verify_systemd_unit(text, identity, '/usr/bin/python3')

    def test_systemd_paths_support_spaces_but_reject_expansion_and_controls(self):
        identity = dict(root='/srv/ASA Lab', owner='operator', mode='system')
        unit = lifecycle.systemd_unit(identity, '/opt/Python 3/bin/python3')
        self.assertIn('WorkingDirectory=/srv/ASA Lab\n', unit)
        self.assertIn('ExecStart="/opt/Python 3/bin/python3" "/srv/ASA Lab/tools/collect_logs.py" --root "/srv/ASA Lab"', unit)
        lifecycle.verify_systemd_unit(unit, identity, '/opt/Python 3/bin/python3')
        for path in ('relative/path', '/srv/x\ny', '/srv/x\ry', '/srv/x\ty', '/srv/x\0y', '/srv/x\x7fy',
                     '/srv/x\\y', '/srv/"x', "/srv/'x", '/srv/%n', '/srv/$USER', '/srv/x '):
            for field in ('root', 'python'):
                with self.subTest(path=path, field=field), self.assertRaises(Blocked) as error:
                    lifecycle.systemd_unit({**identity, 'root': path} if field == 'root' else identity,
                                           path if field == 'python' else '/usr/bin/python3')
                self.assertEqual(error.exception.code, 'COLLECTOR_RUNNER_PATH')

    @unittest.skipUnless(sys.platform.startswith('linux'), 'Actual systemd parser proof runs on Linux CI')
    def test_actual_systemd_analyze_rejects_quoted_workdir_and_accepts_generated_unit(self):
        # v255 load-fragment.c config_parse_working_directory passes raw rvalue
        # through unit_path_printf to PATH_CHECK_ABSOLUTE|PATH_CHECK_FATAL.
        # It does not unquote like ExecStart. Verify using the installed parser,
        # without registering, loading or starting any host unit.
        with tempfile.TemporaryDirectory(prefix='asa-systemd-parser-') as directory:
            root = Path(directory) / 'ASA Lab'; root.mkdir()
            identity = dict(root=str(root), owner='nobody', mode='user')
            unit = lifecycle.systemd_unit(identity, sys.executable)
            for quoted in (True, False):
                path = Path(directory) / ('quoted.service' if quoted else 'valid.service')
                path.write_text(unit.replace(f'WorkingDirectory={root}', f'WorkingDirectory="{root}"') if quoted else unit)
                result = subprocess.run(['systemd-analyze', 'verify', str(path)], capture_output=True,
                                        text=True, timeout=30, env={**os.environ, 'LC_ALL': 'C'})
                if quoted:
                    self.assertNotEqual(result.returncode, 0, result.stderr)
                    self.assertIn('WorkingDirectory', result.stderr)
                    self.assertIn('not absolute', result.stderr)
                else:
                    self.assertEqual(result.returncode, 0, result.stderr)
            print('SYSTEMD_PARSER PASS: quoted WorkingDirectory rejected; generated raw path with spaces accepted; no registration')

    def test_systemctl_failure_reports_safe_verb_exit_and_outcome(self):
        for verb in ('daemon-reload', 'enable', 'restart'):
            result = SimpleNamespace(stdout='', returncode=1,
                                     stderr='Failed: bad unit file setting. PRIVATE_SECRET=do-not-log /foreign/argv')
            with patch('deployment.collector.subprocess.run', return_value=result), self.assertRaises(Blocked) as error:
                lifecycle.command(['systemctl', '--user', verb, 'collector.service'])
            detail = str(error.exception)
            self.assertIn(f'systemctl {verb}; exit=1; outcome=invalid-unit', detail)
            self.assertNotIn('PRIVATE_SECRET', detail); self.assertNotIn('/foreign', detail)
        with patch('deployment.collector.subprocess.run', side_effect=subprocess.TimeoutExpired(['systemctl', 'PRIVATE_SECRET'], 30)), self.assertRaises(Blocked) as error:
            lifecycle.command(['systemctl', 'daemon-reload'])
        self.assertIn('daemon-reload; exit=unknown; outcome=timeout', str(error.exception))
        self.assertNotIn('PRIVATE_SECRET', str(error.exception))

    def test_ci_cleanup_preserves_primary_and_attempts_other_owned_cleanup(self):
        failure = Blocked('COLLECTOR_PRIMARY', 'primary runner failure', 'inspect')
        cleanup_failure = Blocked('COLLECTOR_CLEANUP', 'private foreign detail', 'inspect')
        broken = Mock(side_effect=cleanup_failure); remaining = Mock()
        try:
            try: raise failure
            finally: ci_cleanup.finish_cleanup([broken, remaining], sys.exc_info()[1])
        except Blocked as observed: self.assertIs(observed, failure)
        broken.assert_called_once(); remaining.assert_called_once()
        with self.assertRaises(Blocked) as error: ci_cleanup.finish_cleanup([broken], None)
        self.assertIs(error.exception, cleanup_failure)

    def test_partial_owned_unit_absence_cleanup_does_not_relax_registration(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'collector.service'
            identity = dict(root='/srv/asa', owner='operator', mode='system', name='collector.service')
            unit = lifecycle.systemd_unit(identity, '/usr/bin/python3'); path.write_text(unit)
            raw = 'LoadState=not-found\nActiveState=inactive\nSubState=dead\nFragmentPath=\nDropInPaths=\nTransient=no'
            info = path.stat()
            with patch('deployment.collector.command', return_value=(raw, 0)), patch('deployment.collector.Path.stat', return_value=SimpleNamespace(st_uid=0, st_mode=info.st_mode)):
                with self.assertRaises(Blocked): lifecycle.verify_systemd_state(identity, path, '/usr/bin/python3')
                self.assertEqual(lifecycle.verify_systemd_state(identity, path, '/usr/bin/python3', owned_unloaded=True)['LoadState'], 'not-found')
                path.write_text(unit.replace('User=operator', 'User=root'))
                with self.assertRaises(Blocked): lifecycle.verify_systemd_state(identity, path, '/usr/bin/python3', owned_unloaded=True)

    def test_ci_cleanup_loaded_and_never_loaded_owned_units_and_foreign_refusal(self):
        with tempfile.TemporaryDirectory() as directory:
            name = 'asa-log-collector-asa-lab-ci-delivery.service'
            path = Path(directory) / name
            root = Mock(); root.name = 'asa-delivery-fixture'
            root.__str__ = Mock(return_value='/tmp/asa-delivery-fixture')
            root.stat.return_value = SimpleNamespace(st_uid=0)
            identity = dict(root=str(root), owner='operator', mode='system', name=name)
            unit = lifecycle.systemd_unit(identity, '/usr/bin/python3')
            for state in ('loaded', 'not-found', 'foreign'):
                path.write_text(unit)
                info = path.stat()
                with self.subTest(state=state), patch.dict(os.environ, GITHUB_ACTIONS='true'), patch('deployment.ci_collector_cleanup.os.getuid', return_value=0, create=True), patch('deployment.ci_collector_cleanup.Path', return_value=Path(directory)), patch('deployment.collector.Path.stat', return_value=SimpleNamespace(st_uid=0, st_mode=info.st_mode, st_nlink=1)), patch('deployment.ci_collector_cleanup.verify_systemd_state', return_value={'LoadState': state}) as observe, patch('deployment.ci_collector_cleanup.run') as run:
                    if state == 'foreign':
                        observe.side_effect = Blocked('COLLECTOR_RUNNER_IDENTITY', 'Foreign effective unit', 'inspect')
                        with self.assertRaises(Blocked): ci_cleanup.cleanup_collector(root, 'operator', '/usr/bin/python3')
                        run.assert_not_called()
                    else:
                        ci_cleanup.cleanup_collector(root, 'operator', '/usr/bin/python3')
                        calls = [call.args[0] for call in run.call_args_list]
                        self.assertEqual(any('stop' in args for args in calls), state == 'loaded')
                        self.assertTrue(any('disable' in args for args in calls))
                        self.assertTrue(any('daemon-reload' in args for args in calls))
                    self.assertEqual(path.read_text(), unit)  # Mocked deletion never touches host files.

    def test_root_cannot_silently_maintain_owner_user_service(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            # Windows TEMP may use a short/case alias; persist the canonical
            # Installation root so this reaches the owner guard under test.
            atomic_json(install.state / 'collector-runner.json', {'root': str(install.root), 'project': install.project, 'owner': 'operator', 'mode': 'user'})
            operator = SimpleNamespace(pw_uid=1234, pw_gid=1234, pw_name='operator')
            with patch('deployment.collector.WINDOWS', False), patch('deployment.collector.linux_operator', return_value=operator), patch('deployment.collector.os.geteuid', return_value=0, create=True), self.assertRaises(Blocked) as error:
                lifecycle.runner_identity(install)
            self.assertEqual(error.exception.code, 'COLLECTOR_RUNNER_OWNER')

    def test_effective_systemd_full_typed_argv_is_verified_before_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); install = fixture(root)
            home = root / 'home'
            identity = dict(root='/srv/asa', project=install.project, owner='operator', mode='user', name='asa-log-collector-' + install.project + '.service')
            python = '/usr/bin/python3'
            argv = [python, '/srv/asa/tools/collect_logs.py', '--root', identity['root']]
            action = [python, argv, False, 0, 0, 0, 0, 0, 0, 0]
            valid = {'type': 'a(sasbttttuii)', 'data': [action]}
            unit_path = home / '.config/systemd/user' / identity['name']; unit_path.parent.mkdir(parents=True)
            unit = lifecycle.systemd_unit(identity, python)
            unit_path.write_text(unit)
            properties = dict(FragmentPath=str(unit_path), DropInPaths='', ExecStartPre='', ExecStartPost='', ExecStop='', ExecStopPost='', EnvironmentFiles='', LoadState='loaded', Transient='no', User='', NoNewPrivileges='yes', WorkingDirectory=identity['root'], ActiveState='active', SubState='running',
                ExecStart=f'{{ path={python} ; argv[]={" ".join(argv)} ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }}')
            raw = '\n'.join(key + '=' + value for key, value in properties.items())
            invalid = [
                {**valid, 'data': [[python, [python, 'foreign.py', '--root', identity['root']], *action[2:]]]},
                {**valid, 'data': [[python, [*argv[:-1], '/foreign/root'], *action[2:]]]},
                {**valid, 'data': [[python, [*argv, '--once'], *action[2:]]]},
                {**valid, 'data': [[python, [python, argv[1] + ' --root', str(root)], *action[2:]]]},
                {**valid, 'data': [[python, [python, argv[1].replace('tools', 't\\x6fols'), '--root', identity['root']], *action[2:]]]},
                {**valid, 'data': [[python, ' '.join(argv), *action[2:]]]},
                {**valid, 'data': [[python, argv, True, *action[3:]]]},
                {**valid, 'data': [['/foreign/python', argv, *action[2:]]]},
                {**valid, 'data': [action, action]}, {**valid, 'data': []},
                {**valid, 'type': 'unknown'}, {**valid, 'data': [[python, argv]]},
                '{malformed', '{"type":"a(sasbttttuii)","data":[],"data":[]}',
            ]
            for response in [valid, *invalid, None]:
                calls = []
                def mocked(args, **kwargs):
                    calls.append(args)
                    if args[0] == 'systemctl' and 'show' in args: return raw, 0
                    if args[0] == 'busctl':
                        if response is None: raise FileNotFoundError('busctl missing')
                        if args[-1] in lifecycle.SYSTEMD_EMPTY_ARRAYS:
                            return json.dumps({'type': lifecycle.SYSTEMD_EMPTY_ARRAYS[args[-1]], 'data': []}), 0
                        return json.dumps(response) if isinstance(response, dict) else response, 0
                    return '', 0
                with self.subTest(response=response), patch('deployment.collector.Path.home', return_value=home), patch('deployment.collector.sys.executable', '/usr/bin/python3'), patch('deployment.collector.os.geteuid', return_value=unit_path.stat().st_uid, create=True), patch('deployment.collector.command', side_effect=mocked):
                    if response is valid:
                        lifecycle.reconcile_runner(install, identity, restart=False)
                        self.assertTrue(any('start' in args for args in calls))
                        bus = next(args for args in calls if args[0] == 'busctl')
                        self.assertIn('--user', bus); self.assertIn('--json=short', bus)
                        self.assertIn('/org/freedesktop/systemd1/unit/asa_2dlog_2dcollector_2dasa_2dlab_2ddev_2eservice', bus)
                    else:
                        with self.assertRaises(Blocked): lifecycle.reconcile_runner(install, identity, restart=False)
                        self.assertFalse(any(set(args) & {'daemon-reload', 'enable', 'restart', 'start', 'stop'} for args in calls))
                    self.assertEqual(unit_path.read_text(), unit)
            for malformed in ('', raw + '\nExecStart=second-action', raw.replace('DropInPaths=', 'DropInPaths=/foreign/drop-in.conf'),
                              raw.replace('User=\n', 'User=root\n'), raw.replace('NoNewPrivileges=yes', 'NoNewPrivileges=no'),
                              raw.replace('WorkingDirectory=' + identity['root'], 'WorkingDirectory=/foreign/root'),
                              '\n'.join(line for line in raw.splitlines() if not line.startswith('User=')),
                              '\n'.join(line for line in raw.splitlines() if not line.startswith('ExecStart='))):
                calls = []
                def mocked_state(args, **kwargs):
                    calls.append(args); return (malformed, 0) if 'show' in args else ('', 0)
                with self.subTest(raw=malformed), patch('deployment.collector.Path.home', return_value=home), patch('deployment.collector.sys.executable', '/usr/bin/python3'), patch('deployment.collector.os.geteuid', return_value=unit_path.stat().st_uid, create=True), patch('deployment.collector.command', side_effect=mocked_state), self.assertRaises(Blocked):
                    lifecycle.reconcile_runner(install, identity, restart=False)
                self.assertFalse(any(set(args) & {'daemon-reload', 'enable', 'restart', 'start', 'stop'} for args in calls))

    def test_loaded_omitted_arrays_need_exact_typed_empty_proof_before_any_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); install = fixture(root); home = root / 'home'
            python = '/usr/bin/python3'
            identity = dict(root='/srv/asa', owner='operator', mode='user', name='asa-log-collector-asa-lab-dev.service')
            path = home / '.config/systemd/user' / identity['name']; path.parent.mkdir(parents=True)
            unit = lifecycle.systemd_unit(identity, python); path.write_text(unit)
            # Exact b66 CI behavior: --all omits custom empty arrays while
            # required Unit/ExecContext properties and ExecStart are present.
            properties = dict(FragmentPath=str(path), DropInPaths='', LoadState='loaded', Transient='no',
                              ExecStart='{ path=/usr/bin/python3 ; argv[]=... }', User='',
                              NoNewPrivileges='yes', WorkingDirectory=identity['root'], ActiveState='active', SubState='running')
            raw = '\n'.join(key + '=' + value for key, value in properties.items())
            argv = [python, '/srv/asa/tools/collect_logs.py', '--root', identity['root']]
            exec_json = {'type': 'a(sasbttttuii)', 'data': [[python, argv, False, 0, 0, 0, 0, 0, 0, 0]]}
            cases = [(None, None, 0)]
            for name, signature in lifecycle.SYSTEMD_EMPTY_ARRAYS.items():
                nonempty = [['/foreign.env', False]] if name == 'EnvironmentFiles' else [
                    ['/bin/true', ['/bin/true'], False, 0, 0, 0, 0, 0, 0, 0]]
                for value, code in [
                    ({'type': signature, 'data': nonempty}, 0),
                    ({'type': 'as', 'data': []}, 0), ({'type': signature}, 0),
                    ({'type': signature, 'data': ''}, 0), ({'type': signature, 'data': None}, 0),
                    ({'type': signature, 'data': [], 'extra': False}, 0),
                    ('{"type":"' + signature + '","data":[],"data":[]}', 0),
                    ('{malformed', 0), ('', 0),
                    ({'type': signature, 'data': []}, 1),
                    (FileNotFoundError('busctl unavailable'), 0),
                ]: cases.append((name, value, code))
            for failed_property, response, code in cases:
                calls = []
                def mocked(args, **kwargs):
                    calls.append(args)
                    if 'show' in args: return raw, 0
                    if args[0] == 'busctl':
                        name = args[-1]
                        if name == failed_property:
                            if isinstance(response, Exception): raise response
                            return json.dumps(response) if isinstance(response, dict) else response, code
                        value = exec_json if name == 'ExecStart' else {'type': lifecycle.SYSTEMD_EMPTY_ARRAYS[name], 'data': []}
                        return json.dumps(value), 0
                    return '', 0
                with self.subTest(property=failed_property, response=response, code=code), patch('deployment.collector.Path.home', return_value=home), patch('deployment.collector.sys.executable', python), patch('deployment.collector.os.geteuid', return_value=path.stat().st_uid, create=True), patch('deployment.collector.command', side_effect=mocked):
                    if failed_property is None:
                        lifecycle.reconcile_runner(install, identity, restart=False)
                        lifecycle.reconcile_runner(install, identity, restart=False)
                        queried = [args[-1] for args in calls if args[0] == 'busctl']
                        self.assertEqual(queried, ['ExecStart', *lifecycle.SYSTEMD_EMPTY_ARRAYS] * 2)
                        self.assertEqual(sum('start' in args for args in calls), 2)
                        self.assertFalse(any('restart' in args for args in calls))
                    else:
                        with self.assertRaises(Blocked): lifecycle.reconcile_runner(install, identity, restart=False)
                        self.assertFalse(any(set(args) & {'daemon-reload', 'enable', 'restart', 'start', 'stop'} for args in calls))
                    self.assertEqual(path.read_text(), unit)
            for required in properties:
                calls = []
                incomplete = '\n'.join(key + '=' + value for key, value in properties.items() if key != required)
                def missing_required(args, **kwargs):
                    calls.append(args); return (incomplete, 0) if 'show' in args else ('', 0)
                with self.subTest(required=required), patch('deployment.collector.Path.home', return_value=home), patch('deployment.collector.sys.executable', python), patch('deployment.collector.os.geteuid', return_value=path.stat().st_uid, create=True), patch('deployment.collector.command', side_effect=missing_required), self.assertRaises(Blocked):
                    lifecycle.reconcile_runner(install, identity, restart=False)
                self.assertFalse(any(set(args) & {'daemon-reload', 'enable', 'restart', 'start', 'stop'} for args in calls))

    def test_never_loaded_systemd_unit_uses_generic_absence_facts_before_registration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve(); install = fixture(root); home = root / 'home'
            identity = dict(root='/srv/asa', project=install.project, owner='operator', mode='user', name='asa-log-collector-' + install.project + '.service')
            # systemctl show --all prints generic Unit properties only when
            # the never-loaded service has no Service/ExecContext interface.
            raw = 'LoadState=not-found\nActiveState=inactive\nSubState=dead\nFragmentPath=\nDropInPaths=\nTransient=no'
            unit_path = home / '.config/systemd/user' / identity['name']
            cases = [raw, raw.replace('LoadState=not-found', 'LoadState=loaded'),
                     raw.replace('ActiveState=inactive', 'ActiveState=active'), raw.replace('Transient=no', 'Transient=yes'),
                     raw.replace('SubState=dead', 'SubState=running'), raw.replace('DropInPaths=', 'DropInPaths=/foreign.conf'),
                     raw.replace('FragmentPath=', 'FragmentPath=/foreign.service'), raw + '\nExecStart=foreign-command',
                     raw + '\nUser=root', raw.replace('Transient=no', '')]
            for response, query_code in [(value, 0) for value in cases] + [(raw, 1), (raw, 4)]:
                calls = []
                def mocked(args, **kwargs):
                    calls.append(args)
                    if 'show' in args: return response, query_code
                    return '', 0
                with self.subTest(response=response, code=query_code), patch('deployment.collector.Path.home', return_value=home), patch('deployment.collector.sys.executable', '/usr/bin/python3'), patch('deployment.collector.os.geteuid', return_value=unit_path.parent.stat().st_uid if unit_path.parent.exists() else 0, create=True), patch('deployment.collector.command', side_effect=mocked):
                    if response == raw and query_code == 0:
                        lifecycle.reconcile_runner(install, identity, restart=True)
                        self.assertTrue(unit_path.is_file())
                        self.assertTrue(any('daemon-reload' in args for args in calls))
                        self.assertIn(['busctl', '--json=short', '--version'], calls)
                        self.assertFalse(any('get-property' in args for args in calls))
                        unit_path.unlink()  # Only this fixture's created unit.
                    else:
                        with self.assertRaises(Blocked): lifecycle.reconcile_runner(install, identity, restart=True)
                        self.assertFalse(unit_path.exists())
                        self.assertFalse(any(set(args) & {'daemon-reload', 'enable', 'restart', 'start', 'stop'} for args in calls))

    def test_effective_system_and_user_owner_privilege_workdir_contracts(self):
        for mode, users in (('system', ['operator']), ('user', ['', 'operator'])):
            identity = dict(mode=mode, owner='operator', root='/srv/asa')
            for user in users:
                lifecycle.verify_effective_owner(dict(User=user, NoNewPrivileges='yes', WorkingDirectory='/srv/asa'), identity)
            for change in ({'User': 'root'}, {'User': 'foreign'}, {'NoNewPrivileges': 'no'}, {'WorkingDirectory': '/foreign/root'}):
                with self.subTest(mode=mode, change=change), self.assertRaises(Blocked):
                    lifecycle.verify_effective_owner(dict(User=users[0], NoNewPrivileges='yes', WorkingDirectory='/srv/asa') | change, identity)

    def test_hardlinked_publication_never_changes_foreign_inode_permissions(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as foreign:
            root = Path(directory).resolve(); install = fixture(root)
            with (root / '.env').open('a') as stream: stream.write('ASA_LOG_READER_GID=1234\n')
            install = Installation(root, 'dev')
            store = install.state / 'diagnostics/store'; store.mkdir(parents=True)
            (install.state / 'diagnostics/private').mkdir()
            sentinel = Path(foreign) / 'sentinel'; sentinel.write_bytes(b'foreign-data')
            os.link(sentinel, store / 'collector-health.json')
            previous = sentinel.stat()
            operator = SimpleNamespace(pw_uid=store.stat().st_uid, pw_gid=1234, pw_name='operator')
            with patch('deployment.collector.WINDOWS', False), patch('deployment.collector.linux_operator', return_value=operator), patch('deployment.collector.os.geteuid', return_value=0, create=True), patch.object(install, 'compose', return_value='1234'), patch('deployment.collector.os.chown', create=True) as chown, patch('deployment.collector.os.chmod') as chmod, self.assertRaises(Blocked) as error:
                lifecycle.finalize_permissions(install)
            self.assertEqual(error.exception.code, 'COLLECTOR_STORE_LINK')
            chown.assert_not_called(); chmod.assert_not_called()
            self.assertEqual(sentinel.read_bytes(), b'foreign-data')
            observed = sentinel.stat()
            self.assertEqual((observed.st_mode, observed.st_uid, observed.st_gid, observed.st_nlink),
                             (previous.st_mode, previous.st_uid, previous.st_gid, previous.st_nlink))

    def test_hardlinked_configuration_refuses_preparation_before_any_write(self):
        for name in ('.asa/installation.json', '.asa/log-collector.json', '.asa/collector-runner.json', '.env'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as foreign:
                root = Path(directory).resolve(); install = fixture(root)
                sentinel = Path(foreign) / 'sentinel'; sentinel.write_bytes(b'{"version":1}')
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True)
                if path.exists(): path.unlink()  # Only the fixture's own .env.
                os.link(sentinel, path); previous = sentinel.stat()
                with patch.object(install, 'identity') as identity, self.assertRaises(Blocked) as error:
                    lifecycle.prepare(install)
                self.assertEqual(error.exception.code, 'COLLECTOR_PATH'); identity.assert_not_called()
                self.assertEqual(sentinel.read_bytes(), b'{"version":1}')
                observed = sentinel.stat()
                self.assertEqual((observed.st_mode, observed.st_uid, observed.st_gid, observed.st_nlink),
                                 (previous.st_mode, previous.st_uid, previous.st_gid, previous.st_nlink))

    def test_collector_metadata_ignores_old_hardlinked_temps_and_replaces_only_target_entry(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as foreign:
            root = Path(directory).resolve(); install = fixture(root); install.state.mkdir()
            sentinel = Path(foreign) / 'sentinel'; sentinel.write_bytes(b'foreign-data')
            for name in ('installation.json.tmp', 'log-collector.json.tmp', 'collector-operation.json.tmp', 'collector-runner.json.tmp', 'collector-operation.json'):
                os.link(sentinel, install.state / name)
            with patch('deployment.collector.WINDOWS', True), patch.object(install, 'identity', return_value={}), patch('deployment.collector.ps_scheduler', return_value='[]'):
                lifecycle.prepare(install)
            lifecycle.atomic_json(install.state / 'collector-runner.json', {'owned': True})
            with patch.object(install, 'identity'), patch('deployment.collector.finalize_permissions'), patch('deployment.collector.reader_probe'), patch('deployment.collector.runner_identity', side_effect=Blocked('FIXTURE', 'Synthetic start refusal', 'Fixture only')):
                self.assertEqual(lifecycle.reconcile(install, wait_seconds=0)['state'], 'degraded')
            self.assertEqual(sentinel.read_bytes(), b'foreign-data')
            self.assertEqual(json.loads((install.state / 'collector-operation.json').read_text())['code'], 'FIXTURE')
            self.assertEqual(json.loads((install.state / 'log-collector.json').read_text())['version'], 1)

    @unittest.skipUnless(os.name == 'nt', 'Actual Windows junction fixture')
    def test_windows_real_junctions_refuse_prepare_collector_and_health_process_publication(self):
        for name in ('.asa', '.asa/diagnostics', '.asa/diagnostics/store', '.asa/diagnostics/private', 'root-alias'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as foreign:
                root = Path(directory).resolve(); install = fixture(root)
                link = root / name; link.parent.mkdir(parents=True, exist_ok=True)
                target = Path(foreign).resolve()
                environment = dict(os.environ, ASA_TEST_JUNCTION=str(link), ASA_TEST_TARGET=str(target))
                subprocess.run(['powershell.exe', '-NoProfile', '-Command', "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path $env:ASA_TEST_JUNCTION -Target $env:ASA_TEST_TARGET | Out-Null"], env=environment, check=True, capture_output=True, timeout=15)
                try:
                    self.assertTrue(link.lstat().st_file_attributes & 0x400)
                    selected_root = link if name == 'root-alias' else root
                    with patch.object(install, 'identity') as identity:
                        if name != 'root-alias':
                            with self.assertRaises(Blocked): lifecycle.prepare(install)
                            identity.assert_not_called()
                    with self.assertRaises(ValueError): plain_paths(selected_root, ('.asa/diagnostics/store', '.asa/diagnostics/private'))
                    with self.assertRaises(ValueError): Collector(selected_root, {'project': install.project})
                    with self.assertRaises(ValueError): write_collector_health(selected_root, 'error')
                    with self.assertRaises(ValueError): write_process_health(selected_root, {})
                    self.assertEqual(list(target.iterdir()), [])
                finally:
                    # Never recursively remove a redirected path. Verify this
                    # exact temp-owned junction, then unlink its entry only.
                    self.assertEqual(link.parent.resolve(), (root / name).parent.resolve())
                    self.assertTrue(link.is_relative_to(root))
                    self.assertEqual(link.resolve(), target)
                    self.assertTrue(link.lstat().st_file_attributes & 0x400)
                    os.rmdir(link)
                    self.assertTrue(target.is_dir())

    def test_persisted_but_unapplied_group_still_requires_application_switch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            with (root / '.env').open('a') as stream: stream.write('ASA_LOG_READER_GID=1234\n')
            install = Installation(root, 'dev')
            operator = SimpleNamespace(pw_uid=1234, pw_gid=1234, pw_name='operator')
            with patch('deployment.collector.WINDOWS', False), patch('deployment.collector.linux_operator', return_value=operator), patch('deployment.collector.os.geteuid', return_value=0, create=True), patch('deployment.collector.os.chown', create=True), patch('deployment.collector.os.chmod'), patch.object(install, 'identity', return_value={'api': {'id': 'owned-api'}}), patch('deployment.collector.command', return_value=('1000', 0)):
                self.assertTrue(lifecycle.prepare(install)['readerGroupChanged'])
            self.assertEqual((root / '.env').read_text().count('ASA_LOG_READER_GID='), 1)

    def test_prepare_does_not_change_existing_reader_access_before_application_switch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            store = install.state/'diagnostics/store'; private = install.state/'diagnostics/private'
            store.mkdir(parents=True); private.mkdir()
            segment = store/'seg-0000000000000001-0000000000000001.jsonl'; segment.write_bytes(b'history')
            before = segment.read_bytes(), segment.stat().st_gid, store.stat().st_gid
            operator = SimpleNamespace(pw_uid=1234, pw_gid=1234, pw_name='operator')
            with patch('deployment.collector.WINDOWS', False), patch('deployment.collector.linux_operator', return_value=operator), patch('deployment.collector.os.geteuid', return_value=0, create=True), patch('deployment.collector.os.chown', create=True) as chown, patch('deployment.collector.os.chmod') as chmod, patch.object(install, 'identity', return_value={'api': {'id': 'owned-api'}}), patch('deployment.collector.command', return_value=('1000', 0)):
                self.assertTrue(lifecycle.prepare(install)['readerGroupChanged'])
                self.assertFalse(any(call.args[0] in (store, segment, private) for call in chown.call_args_list))
                self.assertFalse(any(call.args[0] in (store, segment, private) for call in chmod.call_args_list))
            self.assertEqual(before, (segment.read_bytes(), segment.stat().st_gid, store.stat().st_gid))

    def test_docker_group_config_is_rejected_instead_of_used_as_reader_group(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); install = fixture(root)
            with (root / '.env').open('a') as stream: stream.write('ASA_LOG_READER_GID=999\n')
            install = Installation(root, 'dev')
            operator = SimpleNamespace(pw_uid=1234, pw_gid=1234, pw_name='operator')
            with patch('deployment.collector.WINDOWS', False), patch('deployment.collector.linux_operator', return_value=operator), patch.object(install, 'identity', return_value={}), self.assertRaises(Blocked) as error:
                lifecycle.prepare(install)
            self.assertEqual(error.exception.code, 'COLLECTOR_READER_GROUP')

    def test_cycle_health_excludes_not_applicable_but_preserves_denied_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sources = [{'state': 'ok'}, {'state': 'unavailable', 'applicable': False}]
            write_collector_health(root, 'ok', sources=sources)
            file = root / '.asa/diagnostics/store/collector-health.json'
            self.assertTrue(json.loads(file.read_text())['coverageComplete'])
            write_collector_health(root, 'ok', sources=[*sources, {'state': 'unavailable', 'applicable': True}])
            value = json.loads(file.read_text()); self.assertFalse(value['coverageComplete']); self.assertEqual(value['excludedNotApplicable'], 1)

    @unittest.skipUnless(os.name != 'nt', 'Symlink creation requires separate Windows privilege')
    def test_symlink_rejection_never_writes_health_into_foreign_directory(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as foreign:
            root = Path(directory); install = fixture(root)
            (install.state / 'diagnostics').mkdir(parents=True)
            (install.state / 'diagnostics/store').symlink_to(foreign, target_is_directory=True)
            with patch.object(install, 'identity'), self.assertRaises(Blocked): lifecycle.prepare(install)
            with self.assertRaises(ValueError): write_collector_health(root, 'error')
            self.assertEqual(list(Path(foreign).iterdir()), [])


if __name__ == '__main__': unittest.main()
