"""Actual Nx/AST integration plus independently expected SHADOW control observations."""
from __future__ import annotations
import argparse
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import devex_plan as planner
from test_devex_plan import CRITICAL, EXPECTED_BASE, control_cases, fixture, ids, write


def main() -> int:
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('--evidence', type=Path)
    options = args.parse_args()
    root = planner.ROOT
    dependency = planner.dependencies(root)
    assert dependency.get('provenance', {}).get('provider') == 'live-nx-typescript', dependency.get('unknown')
    assert dependency['provenance']['project_count'] >= 20
    assert dependency['provenance']['edge_count'] >= 20
    assert 'organization' in dependency['reverse_projects']['database']
    records = []
    live_known = planner.plan(root, [{'path': 'docs/agent/surfaces/development.yaml', 'status': 'M'}], dependency)
    known_expected = CRITICAL | {'TST-DEVEX-SHADOW-UNIT-001', 'TST-DEVEX-SHADOW-INTEGRATION-001'}
    assert live_known['status'] == 'PLANNED', live_known['unknown']
    assert known_expected <= ids(live_known)
    records.append({'name': 'actual-live-known-development-route', 'source': 'actual fresh Nx/AST provider and canonical current Surface Map',
                    'expected': sorted(known_expected), 'selected': sorted(ids(live_known)), 'omissions': [],
                    'assertion': 'PASS', 'coverage': live_known['status'], 'classification': live_known['change_class'],
                    'unknown_count': len(live_known['unknown']), 'unrelated_issue_count': live_known['unrelated_provider_issue_count'], 'checks_state': 'NOT_RUN'})
    live_css = planner.plan(root, [{'path': 'apps/web/src/components/learning-notifications.css', 'status': 'M'}], dependency)
    assert EXPECTED_BASE <= ids(live_css)
    assert live_css['mode'] == 'SHADOW' and not live_css['enforcement']
    records.append({'name': 'actual-live-known-css-consumer-route', 'source': 'actual fresh Nx/AST provider and canonical current Surface Maps',
                    'expected': sorted(EXPECTED_BASE), 'selected': sorted(ids(live_css)), 'omissions': [],
                    'assertion': 'PASS', 'coverage': live_css['status'], 'classification': live_css['change_class'],
                    'unknown_count': len(live_css['unknown']), 'unknown_sample': live_css['unknown'][:12],
                    'unrelated_issue_count': live_css['unrelated_provider_issue_count'], 'checks_state': 'NOT_RUN'})
    for case in control_cases():
        with tempfile.TemporaryDirectory(prefix='asa control ') as directory:
            target = Path(directory)
            fixture(target, [case['path']], case['class'])
            write(target, case['path'], 'before')
            for command in [('init', '-q'), ('config', 'user.email', 'fixture@example.invalid'), ('config', 'user.name', 'Fixture'), ('add', '.'), ('commit', '-qm', 'control baseline')]:
                planner.git(target, *command)
            write(target, case['path'], 'after')
            snapshot = planner.snapshot(target, 'HEAD')
            report = planner.plan(target, snapshot['changes'], {}, command_available=lambda _: True)
            missing = set(case['expected']) - ids(report)
            assert not missing, (case['name'], missing)
            assert report['change_class'] == case['floor']
            assert report['status'] == 'PLANNED'
            assert all(check['state'] == 'NOT_RUN' for check in report['checks'])
            records.append({'name': case['name'], 'source': 'isolated actual Git dirty diff; synthetic mapping/provider',
                            'expected': case['expected'], 'selected': sorted(ids(report)), 'omissions': sorted(missing),
                            'classification': report['change_class'], 'assertion': 'PASS', 'checks_state': 'NOT_RUN'})
    # Negative controls independently require blocked coverage and all critical fallback IDs.
    for name, change, dependency_error in [
        ('unknown-mapping', {'path': 'unknown.ts', 'status': 'M'}, {}),
        ('deleted-base-graph', {'path': 'old.ts', 'status': 'D'}, {}),
        ('renamed-base-graph', {'path': 'new.ts', 'previous_path': 'old.ts', 'status': 'R100'}, {}),
        ('computed-import', {'path': 'old.ts', 'status': 'M'}, {'unknown': ['nonliteral/dynamic dependency']}),
        ('unavailable-graph', {'path': 'old.ts', 'status': 'M'}, {'unknown': ['Nx provider unavailable']}),
    ]:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            fixture(target, ['old.ts', 'new.ts'])
            report = planner.plan(target, [change], dependency_error, command_available=lambda _: True)
            assert report['status'] == 'BLOCKED', name
            assert CRITICAL <= ids(report), name
            records.append({'name': name, 'source': 'negative pure-function fixture', 'expected': sorted(CRITICAL),
                            'selected': sorted(ids(report)), 'omissions': sorted(CRITICAL - ids(report)),
                            'assertion': 'PASS', 'coverage': 'BLOCKED', 'checks_state': 'NOT_RUN'})
    baseline = json.loads((root / 'docs/testing/evidence/devex-baseline-20261030.json').read_text(encoding='utf-8'))
    for number in ('850', '878', '875'):
        pr = baseline['raw']['prs'][number]
        changes = [{'path': f['filename'], 'status': {'removed': 'D', 'renamed': 'R', 'added': 'A'}.get(f['status'], 'M'),
                    **({'previous_path': f['previous_filename']} if f.get('previous_filename') else {})} for f in pr['changed_files']]
        observed = {**dependency, 'unknown': [*dependency['unknown'], 'historical changed-list only; original dependency graph not reconstructed']}
        report = planner.plan(root, changes, observed)
        expected = CRITICAL if number in {'875', '878'} else EXPECTED_BASE
        assert expected <= ids(report), (number, expected - ids(report))
        assert report['status'] == 'BLOCKED'
        assert all(c['state'] == 'NOT_RUN' for c in report['checks'])
        records.append({'name': f'historical-PR-{number}', 'source': 'saved A raw changed_files; current routing/graph only',
                        'snapshot_head_sha': pr['snapshot_head_sha'], 'snapshot_base_sha': pr['snapshot_base_sha'],
                        'changed_file_count': len(changes), 'expected': sorted(expected), 'selected': sorted(ids(report)),
                        'omissions': sorted(expected - ids(report)), 'assertion': 'PASS', 'coverage': 'BLOCKED',
                        'unknown_count': len(report['unknown']), 'unknown_sample': report['unknown'][:12], 'checks_state': 'NOT_RUN'})
    evidence = {'mode': 'SHADOW', 'enforcement': False, 'assertion': 'PASS', 'checks_state': 'NOT_RUN',
                'captured_at_utc': datetime.now(timezone.utc).isoformat(),
                'observation_note': 'Dated working-tree provider observation at actual_provider.git_head before the final source commit; the artifact filename is retained from package B initiation.',
                'controls': records, 'control_count': len(records), 'omissions_within_expected_control_sets': 0,
                'actual_provider': dependency['provenance'], 'actual_provider_unknown_count': len(dependency['unknown']),
                'limitation': 'Assertions test required selections and conservative blocking, not execution of selected gates. Canonical product maps currently have no L0 controls. Nonliteral imports retain potential-consumer uncertainty, so some actual CSS/UI plans remain BLOCKED. Partial mapping and current-only graph remain unknown; no claim of universal safety or historical runtime reconstruction.'}
    if options.evidence:
        options.evidence.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'assertion': 'PASS', 'controls': len(records), 'omissions': 0, 'actual_provider': dependency['provenance'], 'unknown_count': len(dependency['unknown']), 'selected_checks': 'NOT_RUN'}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
