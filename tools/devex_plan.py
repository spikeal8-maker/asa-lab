#!/usr/bin/env python3
"""Explain mandatory catalog checks in SHADOW mode; never execute or waive gates."""
from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any, Callable

import agent_context
import agent_preflight
import run_task_tests

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ('TST-ARCH-001', 'TST-FORMAT-001', 'TST-LINT-001', 'TST-TYPE-001', 'TST-BUILD-001', 'TST-SECRET-001')


def git(root: Path, *args: str) -> bytes:
    return subprocess.run(['git', *args], cwd=root, check=True, capture_output=True).stdout


def path_value(value: str) -> str:
    # A backslash in Git output is a literal POSIX filename, never a separator.
    agent_preflight._check_git_path_separators(value.encode('utf-8'))
    if not value or value.startswith('/') or '..' in PurePosixPath(value).parts or re.match(r'^[A-Za-z]:', value):
        raise ValueError(f'unsafe Git path: {value!r}')
    return value


def diff_records(payload: bytes) -> list[dict[str, str]]:
    agent_preflight._check_git_path_separators(payload)
    tokens = payload.decode('utf-8', errors='strict').split('\0')
    records = []
    while tokens and tokens[0]:
        status = tokens.pop(0)
        if not re.fullmatch(r'[ACDMRTUXB][0-9]*', status) or not tokens or not tokens[0]:
            raise ValueError('malformed Git name-status output')
        record = {'status': status, 'path': path_value(tokens.pop(0))}
        if status[0] in 'RC':
            if not tokens or not tokens[0]:
                raise ValueError('missing Git rename destination')
            record['previous_path'] = record['path']
            record['path'] = path_value(tokens.pop(0))
        records.append(record)
    return records


def snapshot(root: Path, base: str) -> dict[str, Any]:
    if not base or base.startswith('-'):
        raise ValueError('base must name an existing commit')
    base_sha = git(root, 'rev-parse', '--verify', f'{base}^{{commit}}').decode('ascii').strip()
    head = git(root, 'rev-parse', 'HEAD').decode('ascii').strip()
    merge_base = git(root, 'merge-base', base_sha, head).decode('ascii').strip()
    changes = diff_records(git(root, 'diff', '--name-status', '-z', '--find-renames', merge_base, head, '--'))
    # Include both index and working tree, even when their net changes cancel.
    for args in [('diff', '--cached', '--name-status', '-z', '--find-renames', 'HEAD', '--'),
                 ('diff', '--name-status', '-z', '--find-renames', '--')]:
        changes.extend(diff_records(git(root, *args)))
    raw = git(root, 'ls-files', '--others', '--exclude-standard', '-z')
    agent_preflight._check_git_path_separators(raw)
    changes.extend({'path': path_value(p), 'status': '?'} for p in raw.decode('utf-8', errors='strict').split('\0') if p)
    return {'base': base_sha, 'head': head, 'merge_base': merge_base, 'changes': changes}


def catalog(root: Path) -> dict[str, dict[str, Any]]:
    # Use the execution runner's catalog loader, including its required-file checks.
    old_root, old_paths = run_task_tests.ROOT, run_task_tests.CATALOG_PATHS
    try:
        run_task_tests.ROOT = root
        run_task_tests.CATALOG_PATHS = tuple(root / p for p in agent_context.TEST_CATALOGS)
        tests, _ = run_task_tests.load_catalogs()
    finally:
        run_task_tests.ROOT, run_task_tests.CATALOG_PATHS = old_root, old_paths
    result = {}
    for test in tests:
        if test.get('id') in result:
            raise ValueError(f'duplicate executable test ID: {test.get("id")}')
        result[str(test.get('id'))] = test
    return result


def available(command: str) -> bool:
    try:
        parts = shlex.split(command, posix=os.name != 'nt')
        return bool(parts and shutil.which(parts[0]))
    except ValueError:
        return False


def minimum_rank(path: str) -> int:
    # Safety floors use the existing rank vocabulary, never replace Surface Map rank.
    lower = path.lower()
    if (re.search(r'(^|[/_.-])(auth\w*|rls|tenant\w*|credential\w*|permission\w*|capabilit\w*|csrf|security|session\w*|migrat\w*)([/_.-]|$)', lower)
            or lower.startswith(('.github/', 'tools/deployment/', 'docs/deployment/'))
            or lower in {'agents.md', 'compose.yaml', 'dockerfile', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'nx.json', 'tsconfig.base.json', '.npmrc'}
            or '.config.' in lower
            or lower.endswith(('/project.json', '/package.json', '/dockerfile', '/tsconfig.json'))):
        return 3
    if lower.startswith(('apps/api/', 'packages/contracts/', 'packages/database/', 'contexts/')):
        return 2
    return 0


def plan(root: Path, changes: list[dict[str, str]], dependency: dict[str, Any], *,
         command_available: Callable[[str], bool] = available) -> dict[str, Any]:
    tests = catalog(root)
    surfaces = agent_context._surface_index(root)
    invariants = agent_context._invariant_index(root)
    unknown: list[str] = []
    unrelated_issues = 0
    reasons: dict[str, set[str]] = {}
    rank = 0
    files: set[str] = set()
    for change in changes:
        for key in ('path', 'previous_path'):
            if change.get(key):
                files.add(path_value(change[key]))
        if change.get('status', '')[:1] in {'D', 'R', 'C', 'U', 'X', 'B'}:
            unknown.append(f'old/deleted/conflicted dependency graph unavailable: {change}')
    original = set(files)
    # Documentation text is metadata; runtime assets have no extension allowlist.
    runtime_paths = {p for p in original if not (p.startswith('docs/') and re.search(r'\.(?:md|ya?ml)$', p, re.I))}
    reverse = dependency.get('reverse_imports', {})
    pending = list(files)
    while pending:
        for consumer in reverse.get(pending.pop(), []):
            consumer = path_value(consumer)
            if consumer not in files:
                files.add(consumer)
                pending.append(consumer)
    project_nodes = dependency.get('projects', {})
    affected = {name for name, data in project_nodes.items() if any(p == data['root'] or p.startswith(data['root'] + '/') for p in files)}
    # A consumer remains dependency-reached even when it also has a direct edit.
    # Subtracting direct projects makes adding a local edit remove required checks.
    propagated_projects: set[str] = set()
    pending_projects = list(affected)
    while pending_projects:
        for consumer in dependency.get('reverse_projects', {}).get(pending_projects.pop(), []):
            propagated_projects.add(consumer)
            if consumer not in affected:
                affected.add(consumer)
                pending_projects.append(consumer)
    for issue in dependency.get('unknown', []):
        if not isinstance(issue, dict):
            unknown.append(str(issue))
            continue
        source = str(issue.get('source') or '')
        relevant = source in files or any(source.startswith(project_nodes[n]['root'] + '/') for n in propagated_projects)
        for potential in issue.get('potential_roots', []):
            relevant |= any(p == potential or p.startswith(potential + '/') or p.rsplit('.', 1)[0] == potential for p in files)
        # Unresolved runtime imports can consume assets of any extension. Canonical
        # documentation text is metadata; docs assets (SVG, fonts, etc.) still count.
        if issue.get('unbounded_code_consumer') and runtime_paths:
            relevant = True
        if relevant:
            unknown.append(str(issue.get('reason') or issue))
        else:
            unrelated_issues += 1

    def add(test_id: str, reason: str) -> None:
        reasons.setdefault(test_id, set()).add(reason)

    for test_id in BASELINE:
        add(test_id, 'shared static/governance/security baseline')
    mapped = set()
    for surface in surfaces:
        implementation = set((surface.get('implementation') or {}).get('files') or [])
        controls = [c for c in surface.get('controls', []) if isinstance(c, dict)]
        hit = files.intersection(implementation | {p for c in controls for p in c.get('files', [])})
        project_hit = {p for p in implementation if any(p.startswith(project_nodes[n]['root'] + '/') for n in propagated_projects)}
        if not hit and not project_hit:
            continue
        mapped.update(hit)
        control_files = {p for c in controls for p in c.get('files', [])}
        selected_controls = controls if project_hit or hit - control_files else [c for c in controls if hit.intersection(c.get('files', []))]
        if not selected_controls:
            selected_controls = controls
        for test_id in surface.get('tests', []):
            add(str(test_id), f'surface {surface["id"]}; dependency/project consumer')
        for invariant_id in surface.get('invariants', []):
            if invariant_id not in invariants:
                unknown.append(f'unknown invariant {invariant_id}')
        if not selected_controls:
            unknown.append(f'surface has no classified controls: {surface["id"]}')
        for control in selected_controls:
            for invariant_id in control.get('invariants', []):
                if invariant_id not in invariants:
                    unknown.append(f'unknown control invariant {invariant_id}')
            change_class = control.get('change_class')
            if change_class not in agent_context.CHANGE_CLASS_RANK:
                unknown.append(f'unknown change class in {control.get("id")}')
            else:
                rank = max(rank, agent_context.CHANGE_CLASS_RANK[change_class])
            for test_id in control.get('tests', []):
                add(str(test_id), f'control {control.get("id")}')
    for path in sorted(files):
        rank = max(rank, minimum_rank(path))
        if path not in mapped:
            unknown.append(f'unmapped changed/consumer path: {path}')
    if rank >= 2:
        add('TST-CONTRACT-001', 'API/domain/shared-contract minimum')
    if rank >= 3:
        for test_id in ('TST-MIGRATION-001', 'TST-RLS-001'):
            add(test_id, 'critical safety minimum; never downgraded by UI hints')
    fallback = sorted({*BASELINE, 'TST-CONTRACT-001', 'TST-MIGRATION-001', 'TST-RLS-001'} & tests.keys())
    fallback.extend(sorted(tid for tid, t in tests.items() if t.get('command') == 'pnpm gate:repository')[:1])
    for test_id in list(reasons):
        if test_id not in tests or not tests[test_id].get('command'):
            unknown.append(f'unknown/nonexecutable test ID: {test_id}')
        elif not command_available(str(tests[test_id]['command'])):
            unknown.append(f'executable unavailable for {test_id}')
    if unknown:
        for test_id in fallback:
            add(test_id, 'fail-closed fallback; unresolved coverage')
    checks = []
    for test_id, why in sorted(reasons.items()):
        command = str(tests.get(test_id, {}).get('command') or '')
        if command and not command_available(command):
            unknown.append(f'executable unavailable for {test_id}')
        checks.append({'id': test_id, 'command': command, 'state': 'NOT_RUN', 'reasons': sorted(why)})
    return {'mode': 'SHADOW', 'enforcement': False, 'status': 'BLOCKED' if unknown else 'PLANNED',
            'change_class': next(k for k, v in agent_context.CHANGE_CLASS_RANK.items() if v == rank),
            'review_required': rank == 3, 'changed_paths': sorted(original), 'affected_paths': sorted(files),
            'affected_projects': sorted(affected), 'checks': checks, 'fallback_checks': fallback,
            'unknown': sorted(set(str(x) for x in unknown)), 'provider': dependency.get('provenance'),
            'unrelated_provider_issue_count': unrelated_issues,
            'limitation': 'Current graph only; historical/deleted graph and unmapped consumers block coverage. Gates were not run.'}


def dependencies(root: Path) -> dict[str, Any]:
    node = shutil.which('node')
    if not node:
        return {'unknown': ['Node executable unavailable']}
    try:
        result = subprocess.run([node, str(ROOT / 'tools/devex-dependencies.mjs'), str(root)],
                                cwd=root, check=True, capture_output=True, text=True, encoding='utf-8', timeout=180)
        data = json.loads(result.stdout)
        if data.get('provenance', {}).get('provider') != 'live-nx-typescript' or not data.get('projects'):
            raise ValueError('missing live Nx/provider provenance')
        return data
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        return {'unknown': [f'live dependency provider unavailable: {exc}']}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='origin/main')
    parser.add_argument('--output', default='.asa/devex/shadow-plan.json')
    args = parser.parse_args()
    try:
        snap = snapshot(ROOT, args.base)
        observed = dependencies(ROOT)
        if observed.get('provenance', {}).get('git_head') != snap['head']:
            observed.setdefault('unknown', []).append('Git HEAD changed or provider revision unavailable during planning')
        report = plan(ROOT, snap['changes'], observed)
        report['git'] = {k: v for k, v in snap.items() if k != 'changes'}
    except (ValueError, OSError, subprocess.SubprocessError, SystemExit) as exc:
        report = plan(ROOT, [], {'unknown': [f'Git/catalog input unavailable: {exc}']})
    output = (ROOT / args.output).resolve()
    if not output.is_relative_to((ROOT / '.asa/devex').resolve()):
        parser.error('--output must stay inside .asa/devex; plans cannot overwrite repository sources')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 78 if report['status'] == 'BLOCKED' else 0


if __name__ == '__main__':
    raise SystemExit(main())
