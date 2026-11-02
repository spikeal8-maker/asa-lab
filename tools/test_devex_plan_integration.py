"""Actual Nx/AST integration plus independently expected SHADOW control observations."""
from __future__ import annotations
import argparse
import json
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import devex_plan as planner
from test_devex_plan import CRITICAL, EXPECTED_BASE, add_consumer, control_cases, fixture, ids, result, write


def dependency_controls() -> list[dict]:
    """Actual AST/CSS/tsconfig inputs with independently required consumer checks."""
    return [
        {'name': 'css-plain-relative-asset', 'asset': 'image.svg', 'consumer': 'main.css', 'source': 'a {background:url(image.svg)}'},
        {'name': 'css-uppercase-url', 'asset': 'image.svg', 'consumer': 'main.css', 'source': 'a {background:URL(./image.svg)}'},
        {'name': 'css-mixed-url-fragment-query', 'asset': 'image.svg', 'consumer': 'main.css', 'source': 'a {background:uRl("image.svg?v=1#icon")}'},
        {'name': 'css-import-url', 'asset': 'base.css', 'consumer': 'main.css', 'source': '@import url("./base.css") screen;'},
        {'name': 'css-uppercase-import-url', 'asset': 'base.css', 'consumer': 'main.css', 'source': '@IMPORT URL(base.css);'},
        {'name': 'typescript-paths-css-alias', 'asset': 'shared.css', 'consumer': 'page.ts', 'source': 'import "@styles/shared.css";', 'config': True},
        {'name': 'module-require', 'asset': 'shared.cjs', 'consumer': 'page.ts', 'source': 'module.require("./shared.cjs");'},
        {'name': 'triple-slash-path-reference', 'asset': 'global.d.ts', 'consumer': 'page.ts', 'source': '/// <reference path="./global.d.ts" />'},
        {'name': 'triple-slash-types-reference', 'asset': 'global.d.ts', 'consumer': 'page.ts', 'source': '/// <reference types="./global.d.ts" />'},
        {'name': 'module-element-require', 'asset': 'shared.cjs', 'consumer': 'page.ts', 'source': 'module["require"]("./shared.cjs");'},
        {'name': 'import-meta-resolve', 'asset': 'shared.cjs', 'consumer': 'page.ts', 'source': 'import.meta.resolve("./shared.cjs");'},
        {'name': 'current-file-create-require-alias', 'asset': 'shared.cjs', 'consumer': 'page.ts', 'source': 'import {createRequire as make} from "node:module"; const load=make(import.meta.url); load("./shared.cjs");'},
        {'name': 'css-image-set-string-url', 'asset': 'image.svg', 'consumer': 'main.css', 'source': 'a {background-image:image-set("image.svg" 1x)}'},
        {'name': 'css-webkit-image-set-string-url', 'asset': 'image.svg', 'consumer': 'main.css', 'source': 'a {background-image:-webkit-image-set("image.svg" 1x)}'},
        {'name': 'computed-module-loader-uncertainty', 'asset': 'shared.cjs', 'consumer': 'page.ts', 'source': 'module[method]("./shared.cjs");', 'blocked': True},
        {'name': 'computed-import-meta-loader-uncertainty', 'asset': 'shared.cjs', 'consumer': 'page.ts', 'source': 'import.meta[method]("./shared.cjs");', 'blocked': True},
        {'name': 'escaped-module-loader-uncertainty', 'asset': 'shared.cjs', 'consumer': 'page.ts', 'source': 'const load=module["require"]; load("./shared.cjs");', 'blocked': True},
        {'name': 'opaque-create-require-base-uncertainty', 'asset': 'shared.cjs', 'consumer': 'page.ts', 'source': 'import {createRequire as make} from "node:module"; const load=make(otherBase); load("./shared.cjs");', 'blocked': True},
        {'name': 'css-other-image-function-uncertainty', 'asset': 'image.svg', 'consumer': 'main.css', 'source': 'a {background-image:image("image.svg", red)}', 'blocked': True},
        {'name': 'css-unknown-image-function-uncertainty', 'asset': 'image.svg', 'consumer': 'main.css', 'source': 'a {background-image:future-image(image.svg)}', 'blocked': True},
        {'name': 'css-computed-image-set-uncertainty', 'asset': 'image.svg', 'consumer': 'main.css', 'source': 'a {background-image:image-set(var(--asset) 1x)}', 'blocked': True},
        {'name': 'css-resource-valued-variable-uncertainty', 'asset': 'image.svg', 'consumer': 'main.css', 'source': 'a {background-image:var(--asset)}', 'blocked': True},
        {'name': 'css-custom-property-resource-consumer-uncertainty', 'asset': 'image.svg', 'consumer': 'main.css', 'source': 'a {--asset:url(image.svg); background-image:var(--asset)}', 'blocked': True},
        {'name': 'css-unsupported-import-retains-svg-uncertainty', 'asset': 'image.svg', 'consumer': 'main.css', 'source': '@import url(var(--base));', 'blocked': True},
        {'name': 'css-unsupported-url-retains-font-uncertainty', 'asset': 'font.woff2', 'consumer': 'main.css', 'source': 'a {background:URL(var(--asset))}', 'blocked': True},
        {'name': 'css-root-relative-public-url', 'asset': 'public/image.svg', 'consumer': 'main.css', 'source': 'a {background:url(/image.svg)}', 'blocked': True},
        {'name': 'css-unresolved-alias-retains-asset-uncertainty', 'asset': 'image.svg', 'consumer': 'main.css', 'source': 'a {background:url(@styles/image.svg)}', 'blocked': True},
        {'name': 'css-escape-retains-asset-uncertainty', 'asset': 'image.svg', 'consumer': 'main.css', 'source': r'a {background:url("ima\67 e.svg")}', 'blocked': True},
        {'name': 'css-parse-failure-retains-asset-uncertainty', 'asset': 'image.svg', 'consumer': 'main.css', 'source': 'a {background:url(image.svg)', 'blocked': True},
        {'name': 'unconfigured-workspace-alias-retains-uncertainty', 'asset': 'shared.css', 'consumer': 'page.ts', 'source': 'import "@styles/shared.css";', 'blocked': True},
    ]


def observed_source_index(root: Path, files: list[str]) -> dict:
    helper = (planner.ROOT / 'tools/devex-dependencies.mjs').as_uri()
    script = f'import {{ sourceIndex }} from {json.dumps(helper)}; const [root, files] = JSON.parse(process.argv[1]); console.log(JSON.stringify(sourceIndex(root, files)));'
    completed = subprocess.run(['node', '--input-type=module', '-e', script, json.dumps([str(root), files])],
                               check=True, capture_output=True, text=True, encoding='utf-8')
    indexed = json.loads(completed.stdout)
    return {'reverse_imports': indexed['reverse_imports'], 'unknown': indexed['uncertainties']}


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
    live_tool = planner.plan(root, [{'path': 'tools/devex_plan.py', 'status': 'M'}], dependency)
    assert known_expected <= ids(live_tool)
    assert live_tool['mode'] == 'SHADOW' and not live_tool['enforcement']
    assert all(c['state'] == 'NOT_RUN' for c in live_tool['checks'])
    records.append({'name': 'actual-live-python-development-tool-route', 'source': 'actual fresh provider; canonical map; runtime-source uncertainty retained',
                    'expected': sorted(known_expected), 'selected': sorted(ids(live_tool)), 'omissions': [],
                    'assertion': 'PASS', 'coverage': live_tool['status'], 'classification': live_tool['change_class'],
                    'unknown_count': len(live_tool['unknown']), 'unknown_sample': live_tool['unknown'][:12],
                    'unrelated_issue_count': live_tool['unrelated_provider_issue_count'], 'checks_state': 'NOT_RUN'})
    live_css = planner.plan(root, [{'path': 'apps/web/src/components/learning-notifications.css', 'status': 'M'}], dependency)
    assert EXPECTED_BASE <= ids(live_css)
    assert live_css['mode'] == 'SHADOW' and not live_css['enforcement']
    records.append({'name': 'actual-live-known-css-consumer-route', 'source': 'actual fresh Nx/AST provider and canonical current Surface Maps',
                    'expected': sorted(EXPECTED_BASE), 'selected': sorted(ids(live_css)), 'omissions': [],
                    'assertion': 'PASS', 'coverage': live_css['status'], 'classification': live_css['change_class'],
                    'unknown_count': len(live_css['unknown']), 'unknown_sample': live_css['unknown'][:12],
                    'unrelated_issue_count': live_css['unrelated_provider_issue_count'], 'checks_state': 'NOT_RUN'})
    for case in dependency_controls():
        with tempfile.TemporaryDirectory(prefix='asa parser control ') as directory:
            target = Path(directory)
            asset = f'apps/web/{case["asset"]}'
            consumer = f'apps/web/{case["consumer"]}'
            fixture(target, [asset])
            add_consumer(target, consumer)
            write(target, asset, '/* dependency fixture */' if asset.endswith('.css') else '')
            write(target, consumer, case['source'])
            files = [asset, consumer]
            if case.get('config'):
                write(target, 'apps/web/tsconfig.json', json.dumps({'compilerOptions': {'paths': {'@styles/*': ['./*']}, 'moduleResolution': 'Bundler'}}))
                files.append('apps/web/tsconfig.json')
            indexed = observed_source_index(target, files)
            report = result(target, [asset], indexed)
            expected = CRITICAL | {'TST-JOURNEY-001'} if case.get('blocked') else EXPECTED_BASE | {'TST-JOURNEY-001', 'TST-CONSUMER-001'}
            assert expected <= ids(report), (case['name'], expected - ids(report))
            assert report['status'] == ('BLOCKED' if case.get('blocked') else 'PLANNED'), (case['name'], report['unknown'])
            if not case.get('blocked'):
                assert consumer in report['affected_paths'], case['name']
                assert report['change_class'] == 'L1_UI_BEHAVIOR', case['name']
            assert all(c['state'] == 'NOT_RUN' for c in report['checks'])
            records.append({'name': case['name'], 'source': 'actual AST/CSS/tsconfig provider; isolated canonical-format maps/catalog',
                            'expected': sorted(expected), 'selected': sorted(ids(report)), 'omissions': sorted(expected - ids(report)),
                            'assertion': 'PASS', 'coverage': report['status'], 'classification': report['change_class'],
                            'unknown_count': len(report['unknown']), 'checks_state': 'NOT_RUN'})
    for name, declarations in [
        ('color-variables-precise', 'color:var(--color); background-color:var(--background)'),
        ('length-math-precise', 'width:calc(100% - 1rem); transform:translateX(var(--offset)); grid-template-columns:repeat(2,minmax(0,1fr))'),
        ('font-variable-fallback-precise', 'font-family:var(--font,"Arial")'),
        ('color-gradients-precise', 'background-image:linear-gradient(var(--start),rgb(0 0 0))'),
    ]:
        with tempfile.TemporaryDirectory(prefix='asa css precision ') as directory:
            target = Path(directory)
            css = 'apps/web/main.css'
            fixture(target, [css])
            add_consumer(target, 'apps/web/unrelated.ts')
            write(target, css, f'a {{{declarations}}}')
            indexed = observed_source_index(target, [css])
            report = result(target, [css], indexed)
            expected = EXPECTED_BASE | {'TST-JOURNEY-001'}
            assert report['status'] == 'PLANNED' and report['change_class'] == 'L0_LOCAL_UI', (name, report['unknown'])
            assert ids(report) == expected, name
            assert all(c['state'] == 'NOT_RUN' for c in report['checks'])
            records.append({'name': name, 'source': 'actual CSS value parser; isolated canonical-format maps/catalog',
                            'expected': sorted(expected), 'selected': sorted(ids(report)), 'omissions': [], 'assertion': 'PASS',
                            'coverage': report['status'], 'classification': report['change_class'], 'unknown_count': 0, 'checks_state': 'NOT_RUN'})
    with tempfile.TemporaryDirectory(prefix='asa monotonic control ') as directory:
        target = Path(directory)
        shared, local, consumer = 'packages/shared/x.ts', 'apps/web/local.css', 'apps/web/page.tsx'
        fixture(target, [shared, local])
        add_consumer(target, consumer)
        graph = {'projects': {'shared': {'root': 'packages/shared'}, 'web': {'root': 'apps/web'}}, 'reverse_projects': {'shared': ['web']}}
        before = result(target, [shared], graph)
        after = result(target, [shared, local], graph)
        expected = EXPECTED_BASE | {'TST-JOURNEY-001', 'TST-CONSUMER-001'}
        assert expected <= ids(after) and ids(before) <= ids(after)
        assert after['status'] == 'PLANNED' and after['change_class'] == before['change_class'] == 'L1_UI_BEHAVIOR'
        records.append({'name': 'dependency-plus-direct-edit-monotonicity', 'source': 'isolated canonical-format maps/catalog; synthetic project edge',
                        'expected': sorted(expected), 'selected': sorted(ids(after)), 'omissions': [], 'assertion': 'PASS',
                        'coverage': after['status'], 'classification': after['change_class'], 'checks_state': 'NOT_RUN'})
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
