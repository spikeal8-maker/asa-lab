"""Closed, additive one-case CI scope; no Docker operations in this module."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

BASE = 'fadc2ee0c46c9a704641d68f334d82f4d9b5ac05'
WORKFLOW = '.github/workflows/e11-stopped-fit-390.yml'
WORKFLOW_SHA256 = '263044a611a144f49eb666de1af2a6547cedaace2d6f3d8915116bcad2cd2ff6'
PATHS = frozenset((WORKFLOW, 'tools/e11_single_case_contract.py',
    'tools/test_e11_single_case_contract.py', 'tools/run-e11-stopped-fit-390.mjs',
    'tools/run-e11-stopped-fit-390.test.mjs', 'tools/test_ci_image_transport.py',
    'docs/testing/E11_STOPPED_FIT_390.md', 'docs/testing/active-task-tests.yaml'))


def workflow_identity(raw):
    if hashlib.sha256(raw.replace(b'\r\n', b'\n')).hexdigest() != WORKFLOW_SHA256:
        raise ValueError('Fixed E11 workflow command/identity contract changed')


def source_identity(root, env=os.environ):
    revision = env.get('ASA_ELECTRONICS_EXPECTED_SHA', '')
    if not re.fullmatch(r'[0-9a-f]{40}', revision) or revision != env.get('GITHUB_SHA'):
        raise ValueError('E11 requires exact GitHub source SHA')
    def git(*args):
        return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()
    dirty = git('status', '--porcelain', '-z', '--untracked-files=all').split('\0')
    # Proof commands themselves create only new evidence in this owned directory.
    # Never excuse a tracked source change or an untracked file elsewhere.
    unexpected = [entry for entry in dirty if entry and not entry.startswith('?? reports/e11-stopped-fit-390/')]
    if git('rev-parse', 'HEAD') != revision or unexpected:
        raise ValueError('E11 source must be exact and clean')
    subprocess.run(['git', '-C', str(root), 'merge-base', '--is-ancestor', BASE, revision], check=True)
    changed = set(git('diff', '--name-only', BASE, revision).splitlines())
    if not changed or not changed <= PATHS:
        raise ValueError('One-case CI cannot alter candidate product/tests/migrations/full gates')
    workflow_identity((root / WORKFLOW).read_bytes())
    return {'revision': revision, 'candidate': BASE,
            'schema': max(int(p.name.split('_')[0]) for p in (root / 'migrations').glob('*.sql')),
            'scope': 'e11-stopped-fit-390-only', 'fullElectronicsQualification': False}


def require_pair(root, env=os.environ):
    repository = env.get('GITHUB_REPOSITORY', '')
    if (repository != 'spikeal8-maker/asa-lab' or env.get('GITHUB_JOB') != 'browser'
            or not re.fullmatch(re.escape(repository + '/' + WORKFLOW) + r'@refs/heads/[^\s@]+',
                                env.get('GITHUB_WORKFLOW_REF', ''))
            or env.get('GITHUB_EVENT_NAME') != 'workflow_dispatch'):
        raise ValueError('Unknown one-case E11 workflow/job/event pair')
    return source_identity(root, env)


if __name__ == '__main__':
    import sys
    if sys.argv[1:] != ['--source']:
        raise SystemExit('Use only --source in the fixed workflow')
    root = Path(__file__).resolve().parent.parent
    receipt = require_pair(root)
    output = root / 'reports/e11-stopped-fit-390/source.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
