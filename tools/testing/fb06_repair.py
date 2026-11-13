#!/usr/bin/env python3
"""Apply and verify one bounded classroom regression repair in disposable CI."""
from __future__ import annotations
import hashlib
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys

REPO = 'spikeal8-maker/asa-lab'
SOURCE_BRANCH = 'work/classroom-fb06-candidate-20261113'
VERIFY_BRANCH = 'work/classroom-fb06-verify-20261113'
BASE = '456ead41bb90990b19e2a6ed63a08afcb8f4898a'
MAIN = '8406be4761006246749aff10d65cc1a0377fce7b'
BLOBS = {
    'apps/web/src/pages/classroom-student.css': '144dfa2e52446c2f0192d4833e85c7fee7f05372',
    'e2e/classroom-student-profile.spec.ts': '57c2ce486ec1e55e01352466bd3e4f825555e410',
    'e2e/publication-comments.spec.ts': '1872813b5df2c3160638997e94eae8fddd009f4d',
    'e2e/classroom-nested-feedback.spec.ts': 'b1eb5e4bb62e3bd476808ed6ae59ef5d1f17e8c4',
}


def require(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)


def git(*args: str) -> str:
    return subprocess.check_output(['git', *args], text=True, encoding='utf-8').strip()


def blob(raw: bytes) -> str:
    return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()


def replace_once(text: str, old: str, new: str, path: str) -> str:
    require(text.count(old) == 1, 'Non-unique or missing source literal: ' + path)
    return text.replace(old, new, 1)


def changes(originals: dict[str, str], appendix: str) -> dict[str, str]:
    """Pure bounded transform; validate all originals before any repository write."""
    require(set(originals) == set(BLOBS), 'Unexpected source set')
    result = dict(originals)
    css = 'apps/web/src/pages/classroom-student.css'
    old = '  .classroom-student .project-card-grid .project-card-frame {\n    aspect-ratio: 16 / 9;\n  }'
    extra = '''
  /* Keep the intended mobile work preview independent of shared square cards. */
  .classroom-student .project-card-grid:not(.list) .project-card:not(.is-learning) {
    aspect-ratio: auto;
  }
  .classroom-student .project-card-grid:not(.list) .project-card:not(.is-learning) .project-card-frame {
    flex: 0 0 auto;
    aspect-ratio: 16 / 9;
  }'''
    result[css] = replace_once(result[css], old, old + extra, css)
    profile = 'e2e/classroom-student-profile.spec.ts'
    old = "  await expect(region.getByRole('status')).toContainText('Доступ к играм сохранён.');"
    new = '''  const gamesFeedback = page.locator('.system-feedback-ribbon.system-feedback-success');
  await expect(gamesFeedback).toHaveCount(1);
  await expect(gamesFeedback).toBeVisible();
  await expect(gamesFeedback).toContainText('Доступ к играм сохранён.');
  const gamesAnnouncement = page.locator('.system-feedback-announcement[role="status"]');
  await expect(gamesAnnouncement).toHaveCount(1);
  await expect(gamesAnnouncement).toContainText('Доступ к играм сохранён.');
  await expect(region.getByText('Доступ к играм сохранён.', { exact: true })).toHaveCount(0);'''
    result[profile] = replace_once(result[profile], old, new, profile)
    publication = 'e2e/publication-comments.spec.ts'
    anchor = 'async function layout(page: Page, section: Locator, label: string) {'
    helper = '''async function expectProjectFeedback(page: Page, section: Locator): Promise<void> {
  const message = 'Разрешения проектов сохранены.';
  const ribbon = page.locator('.system-feedback-ribbon.system-feedback-success');
  await expect(ribbon).toHaveCount(1);
  await expect(ribbon).toBeVisible();
  await expect(ribbon).toContainText(message);
  const announcement = page.locator('.system-feedback-announcement[role="status"]');
  await expect(announcement).toHaveCount(1);
  await expect(announcement).toContainText(message);
  await expect(section.getByRole('status').filter({ hasText: message })).toHaveCount(0);
}
'''
    result[publication] = replace_once(result[publication], anchor, helper + anchor, publication)
    old = "  await expect(settings.getByRole('status')).toHaveText('Разрешения проектов сохранены.');"
    result[publication] = replace_once(result[publication], old, '  await expectProjectFeedback(moderator, settings);', publication)
    old = "  await expect(individual.getByRole('status')).toHaveText('Разрешения проектов сохранены.');"
    require(result[publication].count(old) == 2, 'Expected the two individual permission confirmations')
    result[publication] = result[publication].replace(old, '  await expectProjectFeedback(moderator, individual);')
    nested = 'e2e/classroom-nested-feedback.spec.ts'
    require('type NestedSurface' not in result[nested], 'Nested coverage already applied')
    require(appendix.startswith('\ntype NestedSurface') and '\x00' not in appendix, 'Unexpected test appendix')
    result[nested] += appendix
    return result


def run(name: str, command: list[str], evidence: Path, seconds: int = 900) -> None:
    print('CHECK', name, flush=True)
    with (evidence / (name + '.log')).open('w', encoding='utf-8') as log:
        log.write(json.dumps(command, ensure_ascii=False) + '\n')
        log.flush()
        code = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=seconds).returncode
    print('EXIT', name, code, flush=True)
    require(code == 0, name + ' failed; see preserved log')


def environment_guard() -> None:
    require(os.environ.get('GITHUB_REPOSITORY') == REPO, 'Unexpected repository')
    require(os.environ.get('GITHUB_REF') == 'refs/heads/' + VERIFY_BRANCH, 'Unexpected verification ref')
    require(os.environ.get('GITHUB_EVENT_NAME') == 'push', 'Unexpected event')
    require(not git('status', '--porcelain'), 'Dirty source checkout')
    require(git('rev-parse', 'HEAD') == BASE, 'Source changed since this bounded repair was prepared')


def verify(evidence: Path) -> None:
    root = Path.cwd().resolve()
    environment_guard()
    require(not evidence.is_relative_to(root), 'Evidence must be outside source')
    evidence.mkdir(parents=True, exist_ok=False)
    receipt: dict[str, object] = {'repository': REPO, 'branch': SOURCE_BRANCH, 'base_sha': BASE, 'accepted_main': MAIN, 'status': 'started', 'published': False, 'merged': False, 'deployed': False}
    try:
        live_main = git('ls-remote', 'origin', 'refs/heads/main').split()
        require(bool(live_main) and live_main[0] == MAIN, 'Main moved; no blind convergence')
        require(git('ls-remote', 'origin', 'refs/heads/' + SOURCE_BRANCH).split()[0] == BASE, 'Product branch moved')
        subprocess.run(['git', 'config', 'user.name', 'ASA Lab CI'], check=True)
        subprocess.run(['git', 'config', 'user.email', 'asa-lab-ci@users.noreply.github.com'], check=True)
        run('accepted-main-convergence', ['git', 'merge', '--no-edit', MAIN], evidence, 90)
        scope = ['node', 'tools/agent-preflight.mjs', '--scope', 'classroom-visual-20261111']
        paths = [item for path in BLOBS for item in ['--planned-path', path]]
        run('canonical-preflight', scope + ['--check'] + paths, evidence, 240)
        originals = {}
        for path, expected in BLOBS.items():
            require((root / path).is_file() and not (root / path).is_symlink(), 'Missing or unsafe source')
            raw = (root / path).read_bytes()
            require(blob(raw) == expected, 'Original Git blob mismatch: ' + path)
            originals[path] = raw.decode('utf-8')
        appendix = Path(__file__).with_name('fb06_nested_coverage.ts').read_text(encoding='utf-8')
        final_sources = changes(originals, appendix)
        for path, text in final_sources.items():
            (root / path).write_text(text, encoding='utf-8', newline='\n')
        run('format', ['pnpm', 'exec', 'prettier', '--write', *BLOBS], evidence, 180)
        run('format-check', ['pnpm', 'exec', 'prettier', '--check', *BLOBS], evidence, 180)
        run('lint', ['pnpm', 'exec', 'eslint', *[path for path in BLOBS if path.endswith('.ts')]], evidence, 180)
        run('plan', scope + ['--verify-plan', '--diff-base', BASE] + paths, evidence, 240)
        run('diff-check', ['git', 'diff', '--check'], evidence, 60)
        run('stage-source', ['git', 'add', '--', *BLOBS], evidence, 60)
        run('commit-source', ['git', 'commit', '-m', 'fix(classroom): verify nested feedback surfaces and preserve mobile work previews'], evidence, 90)
        final = git('rev-parse', 'HEAD')
        require(set(git('diff', '--name-only', BASE, final).splitlines()) == set(BLOBS), 'Unexpected changes outside four-path repair')
        receipt.update(source_sha=final, tree_sha=git('rev-parse', 'HEAD^{tree}'))
        os.environ.update(ASA_BUILD_REVISION=final, NX_SKIP_NX_CACHE='true', NX_DAEMON='false', ASA_E2E_EXTERNAL='true')
        run('typecheck', ['pnpm', 'exec', 'nx', 'run', 'web:typecheck'], evidence)
        run('fresh-build', ['pnpm', 'exec', 'nx', 'run', 'web:build'], evidence)
        meta = json.loads((root / 'apps/web/dist/build-metadata.json').read_text(encoding='utf-8'))
        require(meta.get('revision') == final, 'Build metadata mismatch')
        receipt['build_metadata'] = meta
        names = ['classroom-assignment-lifetime', 'classroom-assignment-context', 'classroom-average-rating', 'classroom-profile-completion', 'classroom-student-profile', 'system-feedback', 'system-toast-viewport', 'use-classroom-feedback']
        run('focused-components', ['pnpm', 'exec', 'vitest', 'run', *['apps/web/src/components/testing/' + name + '.spec.ts' for name in names]], evidence)
        run('chromium', ['pnpm', 'exec', 'playwright', 'install', '--with-deps', 'chromium'], evidence)
        os.environ['PLAYWRIGHT_JSON_OUTPUT_FILE'] = str(evidence / 'browser.json')
        run('built-browser', ['pnpm', 'exec', 'playwright', 'test', '--config', 'playwright.config.ts', 'e2e/classroom-feedback.spec.ts', 'e2e/classroom-nested-feedback.spec.ts', 'e2e/classroom-student-profile.spec.ts', '--workers=1', '--retries=0', '--reporter=list,json'], evidence)
        report = json.loads((evidence / 'browser.json').read_text(encoding='utf-8'))
        stats = report['stats']
        require(stats.get('expected') == 76 and not any(stats.get(k) for k in ['unexpected', 'flaky', 'skipped']) and not report.get('errors'), 'Not all 76 real browser cases executed successfully')
        receipt['browser_stats'] = stats
        require(not git('status', '--porcelain'), 'Checks changed source checkout')
        run('bundle', ['git', 'bundle', 'create', str(evidence / 'candidate.bundle'), 'HEAD', '^' + BASE], evidence, 90)
        receipt['bundle_sha256'] = hashlib.sha256((evidence / 'candidate.bundle').read_bytes()).hexdigest()
        receipt['status'] = 'focused_pass_pending_regular_pr_ci_and_review'
    except Exception as error:
        receipt.update(status='failed', error=str(error))
        raise
    finally:
        items = []
        for path in BLOBS:
            file = root / path
            if file.is_file() and not file.is_symlink():
                raw = file.read_bytes()
                dest = evidence / 'source' / path
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(raw)
                items.append({'path': path, 'git_blob': blob(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
        for relative in ['e2e/artifacts/owner-preview/classroom-nested-feedback', 'e2e/artifacts/owner-preview/student-profile']:
            directory = root / relative
            if directory.is_dir() and not directory.is_symlink():
                for image in directory.rglob('*.png'):
                    if image.is_file() and not image.is_symlink():
                        target = evidence / 'screenshots' / image.relative_to(root / 'e2e/artifacts/owner-preview')
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copyfile(image, target)
        receipt['files'] = items
        (evidence / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(receipt, ensure_ascii=False), flush=True)


def publish_proof(evidence: Path) -> None:
    environment_guard()
    r = json.loads((evidence / 'receipt.json').read_text(encoding='utf-8'))
    require(r['repository'] == REPO and r['base_sha'] == BASE and r['branch'] == SOURCE_BRANCH, 'Unrelated evidence')
    require(r['status'] == 'focused_pass_pending_regular_pr_ci_and_review', 'Checks did not pass')
    bundle = evidence / 'candidate.bundle'
    require(hashlib.sha256(bundle.read_bytes()).hexdigest() == r['bundle_sha256'], 'Bundle digest mismatch')
    subprocess.run(['git', 'bundle', 'verify', str(bundle)], check=True)
    subprocess.run(['git', 'fetch', str(bundle), 'HEAD'], check=True)
    final = git('rev-parse', 'FETCH_HEAD')
    require(final == r['source_sha'] and git('rev-parse', final + '^{tree}') == r['tree_sha'], 'Tested commit/tree mismatch')
    subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, final], check=True)
    require(set(git('diff', '--name-only', BASE, final).splitlines()) == set(BLOBS), 'Unexpected product paths')
    require(len(r['files']) == 4 and {x['path'] for x in r['files']} == set(BLOBS), 'Incomplete source manifest')
    for item in r['files']:
        require(git('rev-parse', final + ':' + item['path']) == item['git_blob'], 'Blob differs from verified source')
    proof = 'work/classroom-fb06-proof-20261113-' + os.environ['GITHUB_RUN_ID']
    require(not git('ls-remote', 'origin', 'refs/heads/' + proof), 'Proof ref already exists; no overwrite')
    # Create a proof ref only. The controller must separately accept the exact source
    # into the existing PR through the normal GitHub connector, triggering PR checks.
    subprocess.run(['git', 'push', 'origin', final + ':refs/heads/' + proof], check=True)
    require(git('ls-remote', 'origin', 'refs/heads/' + proof).split()[0] == final, 'Proof publication unconfirmed')
    r.update(proof_branch=proof, proof_published=True, product_branch_updated=False, merged=False)
    (evidence / 'proof-receipt.json').write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'proof_branch': proof, 'sha': final, 'product_branch_updated': False}), flush=True)


if __name__ == '__main__':
    require(len(sys.argv) == 3 and sys.argv[1] in {'verify', 'publish-proof'}, 'Expected verify|publish-proof and evidence path')
    (verify if sys.argv[1] == 'verify' else publish_proof)(Path(sys.argv[2]).resolve())
