"""Python-only planner controls: no Node, Nx, database or product gate required."""
from __future__ import annotations
import contextlib
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml
import devex_plan as planner
import run_task_tests

EXPECTED_BASE = {'TST-ARCH-001', 'TST-FORMAT-001', 'TST-LINT-001', 'TST-TYPE-001', 'TST-BUILD-001', 'TST-SECRET-001'}
CRITICAL = EXPECTED_BASE | {'TST-CONTRACT-001', 'TST-MIGRATION-001', 'TST-RLS-001'}


def write(root: Path, name: str, content: str) -> None:
    p = root / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8')


def fixture(root: Path, paths: list[str], change_class: str = 'L0_LOCAL_UI') -> None:
    tests = [{'id': tid, 'command': 'python --version', 'required_for': []} for tid in sorted(CRITICAL | {'TST-JOURNEY-001'})]
    write(root, 'docs/testing/test-catalog.yaml', yaml.safe_dump({'tests': tests}))
    surface = {'id': 'SURF-FIXTURE', 'implementation': {'files': paths}, 'invariants': [], 'tests': ['TST-JOURNEY-001'],
               'controls': [{'id': 'CTRL-FIXTURE', 'files': paths, 'change_class': change_class, 'tests': ['TST-JOURNEY-001']}]}
    write(root, 'docs/agent/surfaces/fixture.yaml', yaml.safe_dump({'context': 'fixture', 'surfaces': [surface]}))


def result(root: Path, paths: list[str], dependency: dict | None = None) -> dict:
    return planner.plan(root, [{'path': p, 'status': 'M'} for p in paths], dependency or {}, command_available=lambda _: True)


def ids(report: dict) -> set[str]:
    return {c['id'] for c in report['checks']}


def add_consumer(root: Path, path: str) -> None:
    p = root / 'docs/agent/surfaces/fixture.yaml'
    data = yaml.safe_load(p.read_text())
    data['surfaces'].append({'id': 'SURF-CONSUMER', 'implementation': {'files': [path]}, 'invariants': [],
                             'tests': ['TST-CONSUMER-001'], 'controls': [{'id': 'CTRL-CONSUMER', 'files': [path],
                             'change_class': 'L1_UI_BEHAVIOR', 'tests': ['TST-CONSUMER-001']}]})
    p.write_text(yaml.safe_dump(data))
    p = root / 'docs/testing/test-catalog.yaml'
    data = yaml.safe_load(p.read_text())
    data['tests'].append({'id': 'TST-CONSUMER-001', 'command': 'python --version', 'required_for': []})
    p.write_text(yaml.safe_dump(data))


def control_cases() -> list[dict]:
    """Independent required-set oracle; not generated from planner decisions."""
    return [
        {'name': 'L0-local-style', 'path': 'apps/web/src/local.css', 'class': 'L0_LOCAL_UI', 'floor': 'L0_LOCAL_UI', 'expected': sorted(EXPECTED_BASE | {'TST-JOURNEY-001'})},
        {'name': 'L1-ui-behavior', 'path': 'apps/web/src/button.tsx', 'class': 'L1_UI_BEHAVIOR', 'floor': 'L1_UI_BEHAVIOR', 'expected': sorted(EXPECTED_BASE | {'TST-JOURNEY-001'})},
        {'name': 'L2-api-cannot-downgrade', 'path': 'apps/api/src/handler.ts', 'class': 'L0_LOCAL_UI', 'floor': 'L2_DOMAIN_MUTATION', 'expected': sorted(EXPECTED_BASE | {'TST-CONTRACT-001', 'TST-JOURNEY-001'})},
        *[{'name': f'L3-{name}-cannot-downgrade', 'path': path, 'class': 'L0_LOCAL_UI', 'floor': 'L3_CRITICAL', 'expected': sorted(CRITICAL | {'TST-JOURNEY-001'})}
          for name, path in [('auth', 'apps/api/src/auth.guard.ts'), ('rls', 'tests/portal/rls.spec.ts'), ('migration', 'packages/database/migrations/099.sql'), ('lock', 'pnpm-lock.yaml'), ('ci', '.github/workflows/check.yml'), ('global', 'nx.json')]],
    ]


class PlannerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_independent_l0_l3_controls(self):
        for case in control_cases():
            with self.subTest(case=case['name']):
                fixture(self.root, [case['path']], case['class'])
                report = result(self.root, [case['path']])
                self.assertEqual('PLANNED', report['status'])
                self.assertEqual(set(case['expected']), ids(report))
                self.assertEqual(case['floor'], report['change_class'])
                self.assertEqual(False, report['enforcement'])
                self.assertEqual({'NOT_RUN'}, {c['state'] for c in report['checks']})

    def test_mapped_critical_rank_preserved(self):
        fixture(self.root, ['apps/web/src/view.tsx'], 'L3_CRITICAL')
        self.assertTrue(result(self.root, ['apps/web/src/view.tsx'])['review_required'])

    def test_unknown_mapping_nonempty_fallback(self):
        fixture(self.root, [])
        report = result(self.root, ['unknown.ts'])
        self.assertEqual('BLOCKED', report['status'])
        self.assertTrue(CRITICAL <= ids(report))
        self.assertTrue(report['fallback_checks'])

    def test_shared_css_transitive_reexport_consumers(self):
        paths = ['apps/web/shared.css', 'apps/web/barrel.ts', 'apps/web/page.tsx']
        fixture(self.root, paths, 'L1_UI_BEHAVIOR')
        add_consumer(self.root, paths[2])
        report = result(self.root, paths[:1], {'reverse_imports': {paths[0]: [paths[1]], paths[1]: [paths[2]]}})
        self.assertEqual(sorted(paths), report['affected_paths'])
        self.assertIn('TST-CONSUMER-001', ids(report))

    def test_transitive_project_consumer_journey(self):
        fixture(self.root, ['packages/shared/x.ts'])
        add_consumer(self.root, 'apps/web/page.tsx')
        report = result(self.root, ['packages/shared/x.ts'], {'projects': {'shared': {'root': 'packages/shared'}, 'web': {'root': 'apps/web'}}, 'reverse_projects': {'shared': ['web']}})
        self.assertEqual(['shared', 'web'], report['affected_projects'])
        self.assertIn('TST-CONSUMER-001', ids(report))

    def test_added_direct_consumer_edit_cannot_remove_dependency_checks_or_risk(self):
        shared, local, consumer = 'packages/shared/x.ts', 'apps/web/local.css', 'apps/web/page.tsx'
        fixture(self.root, [shared, local])
        add_consumer(self.root, consumer)
        dependency = {'projects': {'shared': {'root': 'packages/shared'}, 'web': {'root': 'apps/web'}},
                      'reverse_projects': {'shared': ['web']}}
        before = result(self.root, [shared], dependency)
        after = result(self.root, [shared, local], dependency)
        self.assertEqual('PLANNED', after['status'])
        self.assertTrue(ids(before) <= ids(after))
        self.assertIn('TST-CONSUMER-001', ids(after))
        self.assertEqual('L1_UI_BEHAVIOR', after['change_class'])
        # Project dependency expansion also cannot be narrowed to one L0 control
        # when it shares a Surface Map with the higher-risk consumer control.
        surface_path = self.root / 'docs/agent/surfaces/fixture.yaml'
        data = yaml.safe_load(surface_path.read_text())
        data['surfaces'][0]['implementation']['files'] = [*data['surfaces'][0]['implementation']['files'], consumer]
        data['surfaces'][0]['controls'].extend(data['surfaces'].pop()['controls'])
        surface_path.write_text(yaml.safe_dump(data))
        combined = result(self.root, [shared, local], dependency)
        self.assertTrue(ids(before) <= ids(combined))
        self.assertEqual('L1_UI_BEHAVIOR', combined['change_class'])

    def test_added_control_edit_cannot_narrow_unclassified_surface_coverage(self):
        fixture(self.root, ['apps/web/local.css'])
        add_consumer(self.root, 'apps/web/page.tsx')
        surface_path = self.root / 'docs/agent/surfaces/fixture.yaml'
        data = yaml.safe_load(surface_path.read_text())
        data['surfaces'][0]['implementation']['files'] = [*data['surfaces'][0]['implementation']['files'], 'apps/web/shared.css']
        data['surfaces'][0]['controls'].extend(data['surfaces'].pop()['controls'])
        surface_path.write_text(yaml.safe_dump(data))
        before = result(self.root, ['apps/web/shared.css'])
        after = result(self.root, ['apps/web/shared.css', 'apps/web/local.css'])
        self.assertTrue(ids(before) <= ids(after))
        self.assertIn('TST-CONSUMER-001', ids(after))
        self.assertEqual('L1_UI_BEHAVIOR', after['change_class'])

    def test_dependency_failure_fallback(self):
        fixture(self.root, ['x.ts'])
        report = result(self.root, ['x.ts'], {'unknown': ['nonliteral dynamic import']})
        self.assertEqual('BLOCKED', report['status'])
        self.assertTrue(CRITICAL <= ids(report))

    def test_unrelated_external_resolution_does_not_block_local_ui(self):
        fixture(self.root, ['apps/web/button.tsx'], 'L1_UI_BEHAVIOR')
        dependency = {'projects': {'web': {'root': 'apps/web'}, 'api': {'root': 'apps/api'}}, 'unknown': [
            {'source': 'apps/api/unrelated.ts', 'reason': 'missing external package', 'potential_roots': []}]}
        report = result(self.root, ['apps/web/button.tsx'], dependency)
        self.assertEqual('PLANNED', report['status'])
        self.assertEqual(1, report['unrelated_provider_issue_count'])

    def test_unresolved_possible_consumer_and_dynamic_import_block(self):
        fixture(self.root, ['apps/web/button.tsx'])
        for issue in [
            {'source': 'tools/consumer.ts', 'reason': 'missing relative module', 'potential_roots': ['apps/web/button']},
            {'source': 'tools/consumer.ts', 'reason': 'nonliteral import could consume changed code', 'unbounded_code_consumer': True},
        ]:
            self.assertEqual('BLOCKED', result(self.root, ['apps/web/button.tsx'], {'unknown': [issue]})['status'])

    def test_uncertain_consumer_covers_assets_of_any_extension(self):
        paths = ['apps/web/image.svg', 'apps/web/font.woff2', 'apps/web/data.yaml', 'docs/images/image.svg', 'apps/web/extensionless']
        fixture(self.root, paths)
        dependency = {'unknown': [{'source': 'apps/web/style.css', 'reason': 'unsupported CSS URL', 'unbounded_code_consumer': True}]}
        for path in paths:
            with self.subTest(path=path):
                report = result(self.root, [path], dependency)
                self.assertEqual('BLOCKED', report['status'])
                self.assertTrue(CRITICAL <= ids(report))

    def test_local_project_does_not_select_unrelated_sensitive_surface(self):
        fixture(self.root, ['apps/web/local.css'], 'L0_LOCAL_UI')
        add_consumer(self.root, 'apps/web/unrelated.tsx')
        dependency = {'projects': {'web': {'root': 'apps/web'}}}
        report = result(self.root, ['apps/web/local.css'], dependency)
        self.assertEqual('L0_LOCAL_UI', report['change_class'])
        self.assertNotIn('TST-CONSUMER-001', ids(report))

    def test_unknown_catalog_id_blocks(self):
        fixture(self.root, ['x.ts'])
        p = self.root / 'docs/testing/test-catalog.yaml'
        data = yaml.safe_load(p.read_text())
        data['tests'] = [t for t in data['tests'] if t['id'] != 'TST-JOURNEY-001']
        p.write_text(yaml.safe_dump(data))
        self.assertEqual('BLOCKED', result(self.root, ['x.ts'])['status'])

    def test_executable_unavailable_blocks(self):
        fixture(self.root, ['x.ts'])
        report = planner.plan(self.root, [{'path': 'x.ts', 'status': 'M'}], {}, command_available=lambda _: False)
        self.assertEqual('BLOCKED', report['status'])
        self.assertTrue(report['fallback_checks'])

    def test_deleted_and_rename_old_endpoint_block(self):
        fixture(self.root, ['old.ts', 'new.ts'])
        for change in [{'path': 'old.ts', 'status': 'D'}, {'path': 'new.ts', 'previous_path': 'old.ts', 'status': 'R100'}]:
            report = planner.plan(self.root, [change], {}, command_available=lambda _: True)
            self.assertEqual('BLOCKED', report['status'])
            self.assertIn('old.ts', report['changed_paths'])

    def test_nul_utf8_rename_and_space(self):
        parsed = planner.diff_records('R100\0старый файл.ts\0новый файл.ts\0'.encode())
        self.assertEqual('старый файл.ts', parsed[0]['previous_path'])

    def test_literal_backslash_rejected(self):
        with self.assertRaises(ValueError):
            planner.diff_records(b'M\0apps\\web\\x.ts\0')

    def test_malformed_diff_rejected(self):
        for value in [b'R100\0one\0', b'BAD\0one\0']:
            with self.assertRaises(ValueError):
                planner.diff_records(value)

    def test_provider_failure_and_tampered_output(self):
        with patch.object(planner.shutil, 'which', return_value='node'), patch.object(planner.subprocess, 'run') as run:
            run.return_value.stdout = json.dumps({'projects': {'fake': {}}, 'provenance': {'provider': 'fixture'}})
            self.assertTrue(planner.dependencies(self.root)['unknown'])

    def test_cli_blocks_provider_revision_mismatch(self):
        fixture(self.root, ['x.ts'])
        snap = {'head': 'a', 'base': 'a', 'merge_base': 'a', 'changes': [{'path': 'x.ts', 'status': 'M'}]}
        with patch.object(planner, 'ROOT', self.root), patch.object(planner, 'snapshot', return_value=snap), patch.object(planner, 'dependencies', return_value={'provenance': {'git_head': 'b'}}), patch('sys.argv', ['planner']), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(78, planner.main())
        report = json.loads((self.root / '.asa/devex/shadow-plan.json').read_text())
        self.assertEqual('BLOCKED', report['status'])
        self.assertTrue(report['fallback_checks'])

    def test_git_mergebase_dirty_staged_untracked(self):
        def git(*args):
            return planner.git(self.root, *args)
        git('init', '-q')
        git('config', 'user.email', 'fixture@example.invalid')
        git('config', 'user.name', 'Fixture')
        write(self.root, 'base.ts', 'base')
        git('add', '.')
        git('commit', '-qm', 'base')
        base = git('rev-parse', 'HEAD').decode().strip()
        git('branch', 'baseline')
        write(self.root, 'head.ts', 'head')
        git('add', '.')
        git('commit', '-qm', 'head')
        write(self.root, 'base.ts', 'staged')
        git('add', 'base.ts')
        write(self.root, 'head.ts', 'dirty')
        write(self.root, 'новый файл.ts', 'new')
        report = planner.snapshot(self.root, 'baseline')
        self.assertEqual(base, report['merge_base'])
        self.assertEqual({'base.ts', 'head.ts', 'новый файл.ts'}, {c['path'] for c in report['changes']})
        git('add', '.')
        git('commit', '-qm', 'fixture dirt checkpoint')
        git('checkout', '-qb', 'other', base)
        write(self.root, 'remote.ts', 'remote')
        git('add', 'remote.ts')
        git('commit', '-qm', 'remote')
        # A divergent baseline's unrelated file is not our change.
        git('branch', '-f', 'baseline', 'HEAD')
        git('checkout', '-q', '-')
        self.assertNotIn('remote.ts', {c['path'] for c in planner.snapshot(self.root, 'baseline')['changes']})

    def test_runner_defaults_still_execute_all_mandatory(self):
        tests = [{'id': 'A', 'command': 'python --version', 'required_for': ['TASK-FIXTURE-001']}, {'id': 'B', 'command': 'python --version', 'required_for': ['TASK-FIXTURE-001']}]
        with patch.object(run_task_tests, 'load_catalogs', return_value=(tests, [])), patch.object(run_task_tests, 'run_test', return_value={'state': 'PASS', 'command': 'python --version', 'id': 'X', 'exit_code': 0, 'duration_s': 0, 'reason': ''}) as execute, patch('sys.argv', ['runner', '--task', 'TASK-FIXTURE-001']), contextlib.redirect_stdout(io.StringIO()):
            run_task_tests.main()
        self.assertEqual(2, execute.call_count)


if __name__ == '__main__':
    unittest.main()
