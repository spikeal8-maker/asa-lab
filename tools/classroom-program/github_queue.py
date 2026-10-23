#!/usr/bin/env python3
"""GitHub Issues queue for one bounded ASA Classroom task at a time.

Receipts committed to the repository remain the authority for acceptance.
Closing an Issue is not evidence. This tool never runs product code.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from classroomctl import registry, validate, status, receipt, markdown_brief, why_blocked, ControlError

ROOT = Path(__file__).resolve().parent
MARKER = re.compile(r'<!-- ASA-CLASSROOM-TASK:([A-Z0-9-]+) -->')
REPO = re.compile(r'^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')
SHA = re.compile(r'^[a-f0-9]{40}$')

class QueueError(Exception):
    pass

def github_json(method: str, path: str, token: str, data: dict | None = None):
    headers = {'Accept': 'application/vnd.github+json',
               'X-GitHub-Api-Version': '2022-11-28',
               'Authorization': f'Bearer {token}', 'User-Agent': 'asa-classroom-queue'}
    if data is not None:
        headers['Content-Type'] = 'application/json'
    payload = json.dumps(data, ensure_ascii=False).encode('utf-8') if data is not None else None
    req = Request('https://api.github.com' + path, data=payload, headers=headers, method=method)
    try:
        with urlopen(req, timeout=25) as response:
            return json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError) as error:
        raise QueueError(f'GitHub API {method} failed: {error}') from error

def get_program_issues(repo: str, token: str):
    found = {}
    for page in range(1, 51):
        items = github_json('GET', f'/repos/{repo}/issues?state=all&per_page=100&page={page}', token)
        if not isinstance(items, list):
            raise QueueError('Unexpected Issues API response')
        for item in items:
            if 'pull_request' in item:
                continue
            marker = MARKER.search(item.get('body') or '')
            if marker is None:
                continue
            task_id = marker.group(1)
            if task_id in found:
                raise QueueError('Duplicate task Issues found: ' + task_id)
            found[task_id] = item
        if len(items) < 100:
            return found
    raise QueueError('GitHub Issues pagination bound reached; abort, do not guess')

def choose(root: Path, reg: dict, issues: dict):
    task_ids = {t['id'] for t in reg['tasks']}
    unknown = set(issues) - task_ids
    if unknown:
        raise QueueError('Unexpected program task marker(s): ' + ', '.join(sorted(unknown)))
    for task_id, issue in issues.items():
        actual = receipt(root, task_id)['status']
        if issue['state'] == 'closed' and actual != 'ACCEPTED_MAIN':
            raise QueueError(f'Issue #{issue["number"]} closed, but {task_id} has no ACCEPTED_MAIN receipt in main')
        if issue['state'] == 'open' and actual == 'ACCEPTED_MAIN':
            raise QueueError(f'{task_id} accepted in main, but Issue #{issue["number"]} is still open')
    open_issues = [(key, issue) for key, issue in issues.items() if issue['state'] == 'open']
    if len(open_issues) > 1:
        raise QueueError('More than one open Classroom task Issue; controller reconciliation required')
    if open_issues:
        key, issue = open_issues[0]
        task=next(t for t in reg['tasks'] if t['id']==key)
        blockers=why_blocked(root,reg,task)
        if blockers:
            raise QueueError('Existing Issue attempts blocked task '+key+': '+'; '.join(blockers))
        # Bootstrap issue was explicitly created by the repo owner. Later
        # issues must originate from the main-only GitHub Actions controller.
        who=issue.get('user',{}).get('login')
        if key=='CTRL-00' and issue['number']==716 and who=='spikeal8-maker':
            return 'existing', key, issue
        marker='<!-- ASA-CLASSROOM-QUEUE:task='+key+';main='
        if who!='github-actions[bot]' or marker not in (issue.get('body') or ''):
            raise QueueError('Existing task Issue provenance not verified: '+key)
        return 'existing', key, issue
    ready = [t for t in reg['tasks'] if status(root, reg, t) == 'READY']
    ready.sort(key=lambda t: ({'P0': 0, 'P1': 1, 'P2': 2}.get(t['priority'], 3), t['id']))
    return ('ready', ready[0]['id'], None) if ready else ('blocked', None, None)

def current_main_sha(repo: str, token: str) -> str:
    response = github_json('GET', f'/repos/{repo}/git/ref/heads/main', token)
    value = response.get('object', {}).get('sha', '').lower()
    if not SHA.fullmatch(value):
        raise QueueError('Unable to verify current GitHub main SHA')
    return value

def checked_local_head() -> str:
    p = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=8)
    if p.returncode != 0 or not SHA.fullmatch(p.stdout.strip().lower()):
        raise QueueError('Git checkout HEAD unavailable')
    return p.stdout.strip().lower()

def run(root: Path, repo: str, token: str, action: str, program_issue: int):
    if not REPO.fullmatch(repo):
        raise QueueError('Invalid repository name')
    if not token:
        raise QueueError('GITHUB_TOKEN missing')
    reg = registry(root)
    validate(reg, root)
    if reg['repository'] != repo:
        raise QueueError('Repository does not match registry')
    if action == 'create' and current_main_sha(repo, token) != checked_local_head():
        raise QueueError('Checkout SHA differs from current GitHub main; re-run on current main')
    issues = get_program_issues(repo, token)
    state, task_id, issue = choose(root, reg, issues)
    if state == 'existing':
        print(f'ACTIVE: {task_id} https://github.com/{repo}/issues/{issue["number"]}')
        return state, task_id
    if state == 'blocked':
        print('BLOCKED: no READY task; inspect receipts, owner decisions and dependencies')
        return state, None
    print(f'NEXT READY: {task_id}')
    if action == 'inspect':
        return state, task_id
    if action != 'create':
        raise QueueError('Unknown queue action')
    if current_main_sha(repo, token) != checked_local_head():
        raise QueueError('GitHub main moved during queue inspection; abort')
    task = next(t for t in reg['tasks'] if t['id'] == task_id)
    brief = markdown_brief(root, reg, task, checked_local_head())
    if 'НЕ РАЗРЕШЕНО НАЧАТЬ' in brief:
        raise QueueError('Brief is blocked; abort without creating Issue')
    body = (f'<!-- ASA-CLASSROOM-TASK:{task_id} -->\n'
            f'<!-- ASA-CLASSROOM-QUEUE:task={task_id};main={checked_local_head()} -->\n'
            f'**Программа:** #{program_issue}. **Следующая разрешённая карточка:** {task_id}.\n'
            '**Issue не выбирает active task в current.yaml автоматически.**\n\n'
            + brief + '\n---\n'
            'Отчёт в Issue: source SHA, focused/browser/PG CI URLs, independent review, '
            'интегрированный main SHA и соответствующий receipt в репозитории. '
            'Закрывать только после ACCEPTED_MAIN, подтверждённого контролёром. '
            'Не начинать следующий срез самостоятельно.\n')
    # A final read detects an issue opened between initial inspection and
    # the write. GitHub Issue creation has no CAS: this is a conservative guard.
    if get_program_issues(repo,token):
        raise QueueError('Issue queue changed during create; abort without write')
    if current_main_sha(repo,token)!=checked_local_head():
        raise QueueError('GitHub main moved before issue create; abort')
    result = github_json('POST', f'/repos/{repo}/issues', token,
                         {'title': f'[ASA CLASSROOM][{task_id}] {task["title"]}', 'body': body})
    url = result.get('html_url')
    if not url:
        raise QueueError('GitHub returned no Issue URL; verify manually before retry')
    print(f'CREATED: {url}')
    return 'created', task_id

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['inspect', 'create'])
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--repo', default=os.getenv('GITHUB_REPOSITORY', ''))
    parser.add_argument('--program-issue', type=int, default=715)
    args = parser.parse_args(argv)
    try:
        run(args.root, args.repo, os.getenv('GITHUB_TOKEN', ''), args.action, args.program_issue)
        return 0
    except (QueueError, ControlError) as error:
        print('BLOCKED:', error, file=sys.stderr)
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
