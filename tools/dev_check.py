#!/usr/bin/env python3
"""Run opt-in local checks for live changes; preserve pending full CI and unknown coverage."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time
from threading import Lock
import uuid
from typing import Any

import agent_context
import agent_preflight
import devex_plan
import run_task_tests
import validate_test_catalog

ROOT = Path(__file__).resolve().parents[1]
BLOCKED = 78
CATALOG_LOCK = Lock()


def catalog_at_source(root: Path) -> dict[str, dict[str, Any]]:
    # B reuses the canonical runner loader by temporarily binding its root/path
    # globals. Serialize this small shared-loader section, not test execution.
    with CATALOG_LOCK:
        return devex_plan.catalog(root)


def fingerprint(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()


def source_binding(root: Path, snapshot: dict[str, Any]) -> str:
    paths = {record[key] for record in snapshot['changes'] for key in ('path', 'previous_path') if record.get(key)}
    paths.update((*agent_context.TEST_CATALOGS, 'package.json', 'docs/execution/current.yaml',
                  'docs/agent/document-registry.yaml'))
    for directory in ('docs/agent/contracts', 'docs/agent/surfaces'):
        paths.update(str(path.relative_to(root)).replace('\\', '/') for path in (root / directory).glob('*.yaml'))
    sources = {}
    for path in sorted(paths):
        target = root / devex_plan.path_value(path)
        if target.is_symlink():
            raise ValueError(f'source symlink cannot be verified: {path}')
        sources[path] = hashlib.sha256(target.read_bytes()).hexdigest() if target.is_file() else 'MISSING'
    return fingerprint({'git': snapshot, 'sources': sources})


def affected_lanes(root: Path, paths: list[str]) -> list[str]:
    """Use all matched canonical surfaces, including paths shared across contexts."""
    contexts = set()
    for surface in agent_context._surface_index(root):
        mapped = set((surface.get('implementation') or {}).get('files') or [])
        mapped.update(path for control in surface.get('controls') or [] if isinstance(control, dict)
                      for path in control.get('files') or [])
        if mapped.intersection(paths):
            contexts.add(surface['context'])
    registry = agent_context.load_registry(root)
    lanes = {agent_context._execution_lane_for_context(registry, context) for context in contexts}
    if not lanes:
        raise ValueError('no canonical execution lane for changed paths')
    return sorted(lanes)


def execution_blockers(document: dict[str, Any], lanes: list[str]) -> list[Any]:
    selected = {lane['id']: lane for lane in agent_context.collect_lanes(document)}
    blockers = []
    for lane_id in lanes:
        if lane_id not in selected:
            raise ValueError(f'unknown affected execution lane: {lane_id}')
        for blocker in agent_context.blockers_for_lane(document, selected[lane_id]):
            # Untyped legacy entries fail closed, as required by root policy.
            if not isinstance(blocker, dict) or blocker.get('kind', 'execution_blocker') == 'execution_blocker':
                blockers.append(blocker)
    return blockers


def verify_preflight(root: Path, snapshot: dict[str, Any], paths: list[str]) -> dict[str, Any]:
    lanes = affected_lanes(root, paths)
    result = agent_preflight.build_preflight(root, scope=lanes[0], planned_paths=paths,
                                            verify_plan=True, diff_base=snapshot['merge_base'])
    result['affected_lanes'] = lanes
    result['additional_execution_blockers'] = execution_blockers(agent_context.load_current(root), lanes)
    dirty = (result.get('git') or {}).get('dirty_paths')
    actual = (result.get('plan') or {}).get('actual_paths')
    # PLAN_VALID is scope verification, never permission to edit or publish.
    # Known dirty paths are classified solely as verification input. Unknown or
    # changing work, handoff, stale Git, CP and all execution blockers stop tests.
    acceptable = (result.get('mode') == 'PLAN_VALID'
                  and (result.get('remote_refresh') or {}).get('status') == 'PASS'
                  and (result.get('control_plane') or {}).get('status') == 'PASS'
                  and not result.get('worktree_overlaps') and not result.get('execution_blocking')
                  and not result['additional_execution_blockers']
                  and result.get('recovery_mode') in {'SAFE_TO_START', 'RECOVERY_REQUIRED'}
                  and isinstance(dirty, list) and isinstance(actual, list)
                  and set(dirty).issubset(paths) and set(actual) == set(paths))
    result['verification_allowed'] = acceptable
    result['dirty_classification'] = {'paths': dirty, 'purpose': 'observed verification input only; ownership is not inferred',
                                      'edit_or_publication_authorized': False}
    return result


def run_checks(root: Path, plan: dict[str, Any], catalog: dict[str, dict[str, Any]],
               task_id: str, unchanged, *, jobs: int = 2) -> list[dict[str, Any]]:
    errors: list[str] = []
    validate_test_catalog.validate_local_checks(list(catalog.values()), errors)
    if errors:
        raise ValueError('; '.join(errors))
    records = {item['id']: {**item, 'state': 'NOT_RUN', 'reason': 'local execution is not explicitly eligible'}
               for item in plan['checks']}
    pending = {}
    for test_id, record in records.items():
        test = catalog.get(test_id)
        if test is None or test.get('command') != record.get('command'):
            raise ValueError(f'catalog command changed or missing: {test_id}')
        metadata = test.get('local_check') or {}
        if metadata.get('eligible') is True:
            pending[test_id] = test
        else:
            record['reason'] = metadata.get('reason', record['reason'])

    def execute(test_id: str) -> dict[str, Any]:
        # Re-lookup trusted source by ID; never execute a serialized plan command.
        current = catalog_at_source(root).get(test_id)
        if not unchanged() or fingerprint(current) != fingerprint(catalog[test_id]):
            return {'id': test_id, 'state': 'BLOCKED', 'reason': 'source/catalog changed before execution'}
        return run_task_tests.run_test(current, task_id, root=root, python_executable=sys.executable)

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        while pending:
            order = min(test['local_check']['order'] for test in pending.values())
            wave, groups = [], set()
            for test_id, test in sorted(pending.items()):
                metadata = test['local_check']
                if metadata['order'] != order:
                    continue
                after = metadata['after']
                if any(predecessor not in records or records[predecessor]['state'] in {'FAIL', 'BLOCKED'}
                       or (records[predecessor]['state'] == 'NOT_RUN' and predecessor not in pending) for predecessor in after):
                    records[test_id]['reason'] = 'required ordering predecessor unavailable or failed'
                    continue
                if any(records[predecessor]['state'] != 'PASS' for predecessor in after):
                    continue
                if metadata['group'] not in groups:
                    wave.append(test_id)
                    groups.add(metadata['group'])
            if not wave:
                break
            futures = {test_id: pool.submit(execute, test_id) for test_id in wave}
            for test_id, future in futures.items():
                try:
                    result = future.result()
                except (ValueError, OSError, subprocess.SubprocessError, SystemExit) as exc:
                    result = {'id': test_id, 'state': 'BLOCKED', 'reason': str(exc)}
                records[test_id].update(result)
                del pending[test_id]
    for test_id in pending:
        if records[test_id]['reason'] == 'local execution is not explicitly eligible':
            records[test_id]['reason'] = 'ordering dependency not satisfied'
    return [records[test_id] for test_id in sorted(records)]


def check(root: Path, base: str, *, full: bool = False, jobs: int = 2) -> dict[str, Any]:
    started = time.monotonic()
    report: dict[str, Any] = {'run_id': str(uuid.uuid4()), 'mode': 'LOCAL_CHANGED', 'status': 'BLOCKED',
                              'local_status': 'NOT_RUN', 'full_ci': 'NOT_RUN', 'checks': [],
                              'storage': {'status': 'not_saved'}, 'reasons': [], 'preflight_passed': False}
    invocation = os.environ.get('ASA_DEV_CHECK_RUN_ID')
    if invocation:
        report['invocation_id'] = invocation
    try:
        snapshot = devex_plan.snapshot(root, base)
        report['git'] = {key: value for key, value in snapshot.items() if key != 'changes'}
        paths = sorted({item[key] for item in snapshot['changes'] for key in ('path', 'previous_path') if item.get(key)})
        report['changed_paths'] = paths
        if not paths:
            raise ValueError('no changed paths; no checks executed')
        report['preflight'] = verify_preflight(root, snapshot, paths)
        if not report['preflight']['verification_allowed']:
            raise ValueError('preflight blocks verification; no dependency analysis, tests or report writes allowed')
        report['preflight_passed'] = True
        binding = source_binding(root, snapshot)
        report['source_binding'] = binding
        def unchanged() -> bool:
            return source_binding(root, devex_plan.snapshot(root, base)) == binding
        if full:
            raise ValueError('--full requires the existing isolated CI repository/browser/data gates; local runtime is never started')
        dependency = devex_plan.dependencies(root)
        if (dependency.get('provenance') or {}).get('git_head') != snapshot['head']:
            dependency.setdefault('unknown', []).append('dependency provider HEAD does not match observed Git HEAD')
        plan = devex_plan.plan(root, snapshot['changes'], dependency)
        report['plan'] = plan
        report['coverage_status'] = plan['status']
        # Dependency consumers can introduce lanes absent from the direct diff.
        # Reuse canonical routing/blocker semantics without another remote/CP run.
        consumer_lanes = affected_lanes(root, plan.get('affected_paths', paths))
        report['preflight']['affected_lanes'] = sorted(set(report['preflight'].get('affected_lanes', [])) | set(consumer_lanes))
        blockers = execution_blockers(agent_context.load_current(root), consumer_lanes)
        if blockers:
            report['preflight']['additional_execution_blockers'] = blockers
            report['preflight_passed'] = False
            raise ValueError('dependency consumer lane has an execution blocker; tests and report writes are blocked')
        if not unchanged():
            raise ValueError('source changed during preflight/planning')
        catalog = catalog_at_source(root)
        task_id = ((report['preflight'].get('task') or {}).get('id') or 'TASK-DEVEX-ENGINE-001')
        results = run_checks(root, plan, catalog, task_id, unchanged, jobs=jobs)
        report['checks'] = results
        states = [result['state'] for result in results]
        report['local_status'] = ('FAIL' if 'FAIL' in states else 'BLOCKED' if 'BLOCKED' in states
                                  else 'PASS' if 'PASS' in states else 'NOT_RUN')
        report['reasons'].extend(plan.get('unknown') or [])
        if any(state == 'NOT_RUN' for state in states):
            report['reasons'].append('mandatory checks remain NOT_RUN; local subset does not replace full CI')
        if not unchanged():
            report['reasons'].append('source changed during tests; results do not qualify current source')
            report['local_status'] = 'BLOCKED'
        report['status'] = ('FAIL' if 'FAIL' in states else 'BLOCKED' if report['reasons'] or not states
                             or report['local_status'] != 'PASS' else 'PASS')
    except (ValueError, OSError, subprocess.SubprocessError, SystemExit) as exc:
        report['reasons'].append(str(exc))
        if any(item['state'] == 'FAIL' for item in report['checks']):
            report['status'] = 'FAIL'
    report['duration_s'] = round(time.monotonic() - started, 3)
    return report


def output_path(root: Path, relative: str) -> Path:
    # Validate lexically BEFORE resolve: resolving the base itself would bless
    # .asa -> another directory. Windows junctions are reparse points too.
    root = root.resolve()
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts or path.parts[:2] != ('.asa', 'devex') or path.suffix != '.json':
        raise ValueError('report path must be a .json file below .asa/devex')
    reserved = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}
    if any(':' in part or part.endswith((' ', '.')) or part.split('.')[0].upper() in reserved for part in path.parts):
        raise ValueError('report path contains a Windows device name or alternate stream')
    target = root / path
    cursor = root
    for part in path.parts:
        cursor /= part
        if cursor.is_symlink() or (cursor.exists() and getattr(cursor.lstat(), 'st_file_attributes', 0)
                                   & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400)):
            raise ValueError(f'report path contains a symlink/junction: {cursor}')
    if not target.resolve().is_relative_to(root / '.asa/devex'):
        raise ValueError('report path escapes repository')
    ignored = subprocess.run(['git', 'check-ignore', '-q', '--no-index', str(path)], cwd=root, check=False)
    if ignored.returncode != 0:
        raise ValueError('report destination must be ignored by Git')
    return target


def save_report(root: Path, report: dict[str, Any], relative: str) -> None:
    if not report['preflight_passed']:
        report['storage'] = {'status': 'not_saved', 'reason': 'preflight did not permit report persistence'}
        return
    temporary = None
    try:
        target = output_path(root, relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        target = output_path(root, relative)
        temporary = target.with_name(f'.{target.name}.{report["run_id"]}.tmp')
        report['storage'] = {'status': 'saved', 'path': str(target)}
        with temporary.open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        output_path(root, relative)
        temporary.replace(target)
    except (ValueError, OSError) as exc:
        report['storage'] = {'status': 'not_saved', 'reason': str(exc)}
        report['reasons'].append(f'report not saved: {exc}')
        if report['status'] != 'FAIL':
            report['status'] = 'BLOCKED'
    finally:
        if temporary is not None and temporary.exists():
            try:
                temporary.unlink()
            except OSError:
                pass


def render(report: dict[str, Any]) -> str:
    lines = [f'DEV CHECK {report["status"]} run={report["run_id"]}',
             f'Local subset: {report["local_status"]}; full CI: {report["full_ci"]}; {report["duration_s"]}s']
    preflight = report.get('preflight') or {}
    if preflight:
        lines.append(f'Preflight: {preflight.get("mode")}; remote={(preflight.get("remote_refresh") or {}).get("status")}; '
                     f'control_plane={(preflight.get("control_plane") or {}).get("status")}')
        if not preflight.get('verification_allowed'):
            lines.append(f'Safe action: {preflight.get("safe_action", "Resolve preflight blockers before verification.")}')
    if report.get('plan'):
        lines.append(f'Risk: {report["plan"]["change_class"]}; coverage: {report["coverage_status"]}')
    for item in report['checks']:
        lines.append(f'  {item["id"]}: {item["state"]} {item.get("reason", "")}')
    lines.extend(f'  Reason: {reason}' for reason in report['reasons'][:5])
    if len(report['reasons']) > 5:
        lines.append(f'  {len(report["reasons"]) - 5} more reasons; --json emits every reason on stdout.')
    lines.append(f'Report: {report["storage"]["status"]} {report["storage"].get("path", report["storage"].get("reason", ""))}')
    return '\n'.join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--changed', action='store_true')
    mode.add_argument('--full', action='store_true')
    parser.add_argument('--base', default='origin/main')
    parser.add_argument('--jobs', type=int, choices=range(1, 5), default=2)
    parser.add_argument('--json', action='store_true', help='emit the full current-run report on stdout')
    parser.add_argument('--output', help='ignored JSON destination below .asa/devex; default uses a unique run ID')
    args = parser.parse_args()
    report = check(ROOT, args.base, full=args.full, jobs=args.jobs)
    save_report(ROOT, report, args.output or f'.asa/devex/check-{report["run_id"]}.json')
    print(json.dumps(report, ensure_ascii=False, indent=2) if args.json else render(report))
    return 0 if report['status'] == 'PASS' else 1 if report['status'] == 'FAIL' else BLOCKED


if __name__ == '__main__':
    raise SystemExit(main())
