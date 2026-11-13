#!/usr/bin/env python3
"""One bounded FB-06 verification/publish job; never operates on main or live services."""
from __future__ import annotations

import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

REPOSITORY = 'spikeal8-maker/asa-lab'
BRANCH = 'work/classroom-fb06-candidate-20261113'
BASE = '20b57ff95f0070c99ac408abde902a2d55e98f75'
PAYLOAD_SHA256 = '2f2800217de9867270c63ef6e87290e74b8bed2b215207dfba2fddae93ae14df'
BOOTSTRAP = [
    '.github/workflows/classroom-fb06-candidate.yml',
    'tools/testing/fb06-ci-20261113.py',
    'tools/testing/fb06-source-proposal-20261113.part1.b64',
    'tools/testing/fb06-source-proposal-20261113.part2.b64',
    'tools/testing/fb06-source-proposal-20261113.part3.b64',
    'tools/testing/fb06-source-proposal-20261113.part4.b64',
    'tools/testing/fb06-source-proposal-20261113.part5.b64',
]
PRODUCT = [
    '.github/workflows/classroom-owner.yml',
    'apps/web/src/components/ClassroomActionFeedback.tsx',
    'apps/web/src/components/ClassroomAiAccess.tsx',
    'apps/web/src/components/ClassroomGamesSettings.tsx',
    'apps/web/src/components/ClassroomLearning.tsx',
    'apps/web/src/components/ClassroomParticipantPanels.tsx',
    'apps/web/src/components/ClassroomProjectSettings.tsx',
    'apps/web/src/components/classroom-assignment-lifetime.ts',
    'apps/web/src/components/testing/classroom-assignment-context.spec.ts',
    'apps/web/src/components/testing/classroom-assignment-lifetime.spec.ts',
    'apps/web/src/pages/ClassroomPage.tsx',
    'e2e/classroom-nested-feedback.spec.ts',
]
PAYLOAD_FILES = {
    'integration.json', 'prepare_patch.py',
    'candidate/apps/web/src/components/ClassroomActionFeedback.tsx',
    'candidate/apps/web/src/components/ClassroomLearning.tsx',
    'candidate/apps/web/src/components/classroom-assignment-lifetime.ts',
    'candidate/apps/web/src/components/testing/classroom-assignment-context.spec.ts',
    'candidate/apps/web/src/components/testing/classroom-assignment-lifetime.spec.ts',
    'candidate/e2e/classroom-nested-feedback.spec.ts',
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def output(*arguments: str) -> str:
    return subprocess.check_output(arguments, text=True, encoding='utf-8').strip()


def run(label: str, arguments: list[str], evidence: Path, timeout: int = 900) -> None:
    print('CHECK', label, flush=True)
    with (evidence / (label + '.log')).open('w', encoding='utf-8') as log:
        log.write(json.dumps(arguments, ensure_ascii=False) + '\n')
        log.flush()
        result = subprocess.run(arguments, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    print('EXIT', label, result.returncode, flush=True)
    require(result.returncode == 0, f'{label} failed; see its preserved log')


def guard() -> tuple[Path, str]:
    require(os.environ.get('GITHUB_REPOSITORY') == REPOSITORY, 'Unexpected repository')
    require(os.environ.get('GITHUB_EVENT_NAME') == 'push', 'Only the explicit branch push is allowed')
    require(os.environ.get('GITHUB_REF') == 'refs/heads/' + BRANCH, 'Unexpected target branch')
    initial = os.environ['GITHUB_SHA']
    require(output('git', 'rev-parse', 'HEAD') == initial, 'Checkout does not match event SHA')
    require(not output('git', 'status', '--porcelain'), 'Unknown dirty checkout; nothing will be overwritten')
    subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, initial], check=True)
    return Path.cwd().resolve(), initial


def verify(evidence: Path) -> None:
    root, initial = guard()
    evidence.mkdir(parents=True, exist_ok=False)
    receipt: dict[str, object] = {
        'base_sha': BASE, 'bootstrap_sha': initial, 'branch': BRANCH,
        'repository': REPOSITORY, 'kind': 'author-focused-ci-not-independent-review',
        'published': False, 'merged': False, 'deployed': False, 'status': 'started',
    }
    try:
        payload = base64.b64decode(''.join((root / path).read_text(encoding='ascii').strip() for path in BOOTSTRAP[2:]), validate=True)
        require(hashlib.sha256(payload).hexdigest() == PAYLOAD_SHA256, 'Proposal digest mismatch')
        with gzip.GzipFile(fileobj=__import__('io').BytesIO(payload)) as stream:
            plain = stream.read(2_000_001)
        require(len(plain) <= 2_000_000, 'Proposal exceeds bounded size')
        data = json.loads(plain)
        require(data['format'] == 'asa-classroom-fb06-source-proposal-v1', 'Unknown proposal format')
        require(set(data['files']) == PAYLOAD_FILES, 'Unexpected proposal files')
        with tempfile.TemporaryDirectory(prefix='asa-fb06-', dir=os.environ['RUNNER_TEMP']) as temp:
            package = Path(temp)
            for name, content in data['files'].items():
                require(isinstance(content, str) and '\0' not in content, 'Invalid UTF-8 source payload')
                path = package / name
                require(path.resolve().is_relative_to(package.resolve()), 'Proposal path escape')
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding='utf-8', newline='\n')
            manifest = json.loads((package / 'integration.json').read_text(encoding='utf-8'))
            planned = {entry['path'] for entry in manifest['edits'] + manifest['full_replacements']}
            planned.update(manifest['new_files'])
            require(planned == set(PRODUCT), 'Source plan differs from the fixed approved slice')
            scope = ['node', 'tools/agent-preflight.mjs', '--scope', 'classroom-visual-20261111']
            paths = [value for path in PRODUCT + BOOTSTRAP for value in ['--planned-path', path]]
            run('canonical-preflight', scope + ['--check'] + paths, evidence, 240)
            patch = package / 'fb06.patch'
            prepare = [sys.executable, str(package / 'prepare_patch.py'), '--repository', str(root), '--output', str(patch)]
            run('base-and-literal-check', prepare + ['--check'], evidence, 60)
            run('prepare-guarded-patch', prepare, evidence, 60)
            run('git-apply-check', ['git', 'apply', '--check', str(patch)], evidence, 60)
            run('apply-checked-source', ['git', 'apply', str(patch)], evidence, 60)
            run('format-source', ['pnpm', 'exec', 'prettier', '--write'] + PRODUCT, evidence, 180)
            # Remove only this job's tracked bootstrap files, not owner data or backups.
            run('remove-owned-bootstrap', ['git', 'rm', '--'] + BOOTSTRAP, evidence, 60)
            run('format-check', ['pnpm', 'exec', 'prettier', '--check'] + PRODUCT, evidence, 180)
            typed = [path for path in PRODUCT if path.endswith(('.ts', '.tsx'))]
            run('lint', ['pnpm', 'exec', 'eslint'] + typed, evidence, 240)
            run('verify-exact-plan', scope + ['--verify-plan', '--diff-base', initial] + paths, evidence, 240)
            run('diff-check', ['git', 'diff', '--check'], evidence, 60)
            run('stage-exact-source', ['git', 'add', '--'] + PRODUCT, evidence, 60)
            run('commit-source', ['git', '-c', 'user.name=ASA Lab CI', '-c', 'user.email=asa-lab-ci@users.noreply.github.com', 'commit', '-m', 'fix(classroom): share nested feedback and guard assignment callback lifetimes'], evidence, 90)
            final = output('git', 'rev-parse', 'HEAD')
            require(output('git', 'rev-parse', 'HEAD^') == initial, 'Unexpected candidate parent')
            changed = set(output('git', 'diff', '--name-only', BASE, final).splitlines())
            require(changed == set(PRODUCT), 'Candidate contains changes outside the product slice')
            receipt.update(source_sha=final, tree_sha=output('git', 'rev-parse', 'HEAD^{tree}'))
            os.environ.update(ASA_BUILD_REVISION=final, NX_SKIP_NX_CACHE='true', NX_DAEMON='false', ASA_E2E_EXTERNAL='true')
            run('typecheck', ['pnpm', 'nx', 'run', 'web:typecheck'], evidence)
            run('fresh-build', ['pnpm', 'nx', 'run', 'web:build'], evidence)
            metadata = json.loads((root / 'apps/web/dist/build-metadata.json').read_text(encoding='utf-8'))
            require(metadata.get('revision') == final, 'Build metadata differs from tested source')
            receipt['build_metadata'] = metadata
            suite_dir = root / 'apps/web/src/components/testing'
            names = {
                'classroom-assignment-lifetime.spec.ts', 'classroom-assignment-context.spec.ts',
                'system-feedback.spec.ts', 'system-toast-viewport.spec.ts', 'use-classroom-feedback.spec.ts',
                'classroom-student-profile.spec.ts', 'classroom-profile-completion.spec.ts',
            }
            for path in suite_dir.glob('classroom-*.spec.ts'):
                if any(word in path.name for word in ['ai-access', 'games', 'network', 'project-settings', 'rating']):
                    names.add(path.name)
            suites = [str((suite_dir / name).relative_to(root)) for name in sorted(names)]
            require(all((root / path).is_file() for path in suites), 'An expected focused suite is missing')
            receipt['component_suites'] = suites
            run('focused-components', ['pnpm', 'exec', 'vitest', 'run'] + suites, evidence)
            run('install-ci-chromium', ['pnpm', 'exec', 'playwright', 'install', '--with-deps', 'chromium'], evidence)
            os.environ['PLAYWRIGHT_JSON_OUTPUT_FILE'] = str(evidence / 'browser.json')
            run('built-browser', ['pnpm', 'exec', 'playwright', 'test', '--config', 'playwright.config.ts', 'e2e/classroom-feedback.spec.ts', 'e2e/classroom-nested-feedback.spec.ts', '--workers=1', '--retries=0', '--reporter=list,json'], evidence)
            report = json.loads((evidence / 'browser.json').read_text(encoding='utf-8'))
            stats = report['stats']
            require(stats.get('expected') == 31 and stats.get('unexpected', 0) == 0 and stats.get('flaky', 0) == 0 and stats.get('skipped', 0) == 0 and not report.get('errors'), 'Browser did not execute all 31 expected cases cleanly')
            receipt['browser_stats'] = stats
            require(not output('git', 'status', '--porcelain'), 'Checks modified tracked or unknown files')
            run('bundle-verified-commit', ['git', 'bundle', 'create', str(evidence / 'candidate.bundle'), 'HEAD', '^' + initial], evidence, 180)
            receipt['bundle_sha256'] = hashlib.sha256((evidence / 'candidate.bundle').read_bytes()).hexdigest()
            receipt['status'] = 'focused_pass_pending_independent_review_and_required_ci'
    except Exception as error:
        receipt.update(status='failed', error=str(error))
        raise
    finally:
        source_dir = evidence / 'source'
        file_receipts = []
        for relative in PRODUCT:
            path = root / relative
            if path.is_file() and not path.is_symlink():
                raw = path.read_bytes()
                target = source_dir / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(raw)
                file_receipts.append({'path': relative, 'sha256': hashlib.sha256(raw).hexdigest(), 'git_blob': hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()})
        receipt['files'] = file_receipts
        (evidence / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(receipt, ensure_ascii=False), flush=True)


def publish(evidence: Path) -> None:
    _, initial = guard()
    receipt = json.loads((evidence / 'receipt.json').read_text(encoding='utf-8'))
    require(receipt['status'] == 'focused_pass_pending_independent_review_and_required_ci', 'Verification did not pass')
    require(receipt['repository'] == REPOSITORY and receipt['branch'] == BRANCH and receipt['bootstrap_sha'] == initial, 'Artifact belongs to another task')
    bundle = evidence / 'candidate.bundle'
    require(hashlib.sha256(bundle.read_bytes()).hexdigest() == receipt['bundle_sha256'], 'Verified bundle digest mismatch')
    subprocess.run(['git', 'bundle', 'verify', str(bundle)], check=True)
    subprocess.run(['git', 'fetch', str(bundle), 'HEAD'], check=True)
    final = output('git', 'rev-parse', 'FETCH_HEAD')
    require(final == receipt['source_sha'], 'Bundle commit differs from tested source')
    require(output('git', 'rev-parse', final + '^') == initial, 'Candidate is not a direct child of the expected branch')
    require(output('git', 'rev-parse', final + '^{tree}') == receipt['tree_sha'], 'Candidate tree differs')
    require(set(output('git', 'diff', '--name-only', BASE, final).splitlines()) == set(PRODUCT), 'Unexpected product paths')
    require(len(receipt['files']) == len(PRODUCT) and {entry['path'] for entry in receipt['files']} == set(PRODUCT), 'Incomplete or duplicated source manifest')
    for entry in receipt['files']:
        require(entry['path'] in PRODUCT, 'Unexpected manifest path')
        require(output('git', 'rev-parse', final + ':' + entry['path']) == entry['git_blob'], 'Source blob mismatch')
    remote = output('git', 'ls-remote', 'origin', 'refs/heads/' + BRANCH).split()
    require(bool(remote) and remote[0] == initial, 'Remote branch changed; no force-push or overwrite')
    # Ordinary fast-forward push to this dedicated branch only. Main is never a target.
    subprocess.run(['git', 'push', 'origin', final + ':refs/heads/' + BRANCH], check=True)
    remote = output('git', 'ls-remote', 'origin', 'refs/heads/' + BRANCH).split()
    require(bool(remote) and remote[0] == final, 'Remote publication was not confirmed')
    receipt.update(published=True, remote_sha=final, merged=False, deployed=False)
    (evidence / 'published-receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'published': True, 'branch': BRANCH, 'sha': final, 'merged': False, 'deployed': False}), flush=True)


if __name__ == '__main__':
    require(len(sys.argv) == 3 and sys.argv[1] in {'verify', 'publish'}, 'Expected verify|publish and evidence path')
    evidence = Path(sys.argv[2]).resolve()
    require(not evidence.is_relative_to(Path.cwd().resolve()), 'Evidence must remain outside the checkout')
    (verify if sys.argv[1] == 'verify' else publish)(evidence)
