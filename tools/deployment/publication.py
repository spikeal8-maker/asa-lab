"""Promote a tested main release without moving the published channel backward."""
import json
import os
from pathlib import Path
import re
import subprocess

from .contracts import require, validate_release
from .releases import assert_general_ci, discover_release
from .system import run


def canonical_main():
    run(['git', 'fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main'])
    revision = run(['git', 'rev-parse', '--verify', 'refs/remotes/origin/main'], capture=True)
    require(re.fullmatch(r'[a-f0-9]{40}', revision), 'RELEASE_SOURCE', 'Cannot identify canonical main.')
    return revision


def is_ancestor(previous, current):
    result = subprocess.run(['git', 'merge-base', '--is-ancestor', previous, current], check=False)
    require(result.returncode in (0, 1), 'RELEASE_SOURCE', 'Cannot verify release ancestry.')
    return result.returncode == 0


def should_promote(candidate, stable, main, ancestor=is_ancestor):
    new, published = candidate['revision'], stable['revision']
    require(ancestor(new, main) and ancestor(published, main), 'RELEASE_SOURCE',
            'Candidate and published releases must belong to canonical main.')
    if new == published:
        require(candidate['schema'] == stable['schema'], 'RELEASE_SCHEMA',
                'A published revision cannot acquire a different schema.')
        return False
    if ancestor(new, published):
        return False
    require(ancestor(published, new), 'RELEASE_SOURCE', 'Candidate does not extend the published release.')
    require(candidate['schema'] >= stable['schema'], 'RELEASE_SCHEMA',
            'Candidate schema is older than the published channel.')
    return True


def verify_recovery_source(revision, base, target, main):
    require(all(re.fullmatch(r'[a-f0-9]{40}', value) for value in (revision, base, target))
            and len({revision, base, target}) == 3, 'RECOVERY_SOURCE', 'Three distinct exact revisions are required.')
    require(is_ancestor(base, target) and is_ancestor(target, main), 'RECOVERY_SOURCE',
            'The original and forward revisions must belong to canonical main.')
    require(run(['git', 'rev-list', '--parents', '-n', '1', revision], capture=True).split() == [revision, base],
            'RECOVERY_SOURCE', 'The recovery candidate must be a single child of the original release.')
    changes = run(['git', 'diff', '--name-status', '--no-renames', base, revision], capture=True).splitlines()
    require(changes and all(re.fullmatch(r'A\tmigrations/\d{4}_[a-z0-9_]+\.sql', change) for change in changes),
            'RECOVERY_SOURCE', 'The recovery candidate may only append unchanged published migrations.')
    migrations = [run(['git', 'rev-parse', f'{ref}:migrations'], capture=True) for ref in (revision, target)]
    require(migrations[0] == migrations[1], 'RECOVERY_SOURCE', 'Recovery and forward migration trees differ.')


def main():
    candidate = validate_release(json.loads(Path('.asa/release/release.json').read_text(encoding='utf-8')))
    require(candidate['revision'] == os.environ['ASA_BUILD_REVISION'], 'RELEASE_SOURCE',
            'The built manifest does not match the qualified candidate.')
    stable = discover_release()
    # The current artifact is the channel baseline even if its old CI run is
    # being re-run. Only the new candidate needs a live CI decision here.
    promote = should_promote(candidate, stable, canonical_main())
    if promote:
        assert_general_ci(candidate['revision'])
    print('PROMOTE' if promote else 'KEEP_STABLE', candidate['revision'], stable['revision'], flush=True)
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
        output.write(f'promote={str(promote).lower()}\n')


if __name__ == '__main__':
    main()
