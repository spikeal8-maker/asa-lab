"""Closed CI-only 836 qualification. Standard library; never invokes Docker."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import struct
import subprocess
import sys
import zipfile
import zlib
from datetime import datetime
from urllib.parse import urlsplit, parse_qs

BASE = '692b76095dd0cdf0c9f6f8e18a503d37668940f8'
WORKFLOW = '.github/workflows/electronics-ui-679-557.yml'
RUNNER = 'tools/run-electronics-836-runtime-three.mjs'
RUNNER_SHA256 = 'a4f08c92ac4011c7e76ec732ebe05117d6935bd7e5a89303abfb622e45e1798c'
WORKFLOW_SHA256 = '335367756bbd5d0233abdf241863dd2f93d9823309d16658a1a9f47f1cbe1082'
CONTRACT = 'docs/product/electronics/evidence/836-three-case-qualification/contract.json'
DIRECTORY = 'reports/electronics-836-three'
SUBSET = '836-runtime-three-v1'
PATHS = frozenset((WORKFLOW, RUNNER, CONTRACT,
    'tools/electronics_836_three_source.py', 'tools/test_electronics_836_three_source.py',
    'tools/test-electronics-836-runtime-three.mjs',
    'tests/electronics/ui-679-557-qualification.spec.ts',
    'docs/product/electronics/evidence/836-three-case-qualification/README.md'))
CASES = [
    {'file': 'electronics-selection-outline.spec.ts', 'suites': [],
     'title': 'E11 '+scenario+': native outward selection, real DC and whole save reopen at 1440px',
     'scenario': scenario}
    for scenario in ('stopped-fit', 'running-controls')
] + [{'file': 'electronics-interactions.spec.ts', 'suites': ['asset recovery in the built editor'],
      'title': 'a failed catalog owner image recovers without placing or saving a component'}]


def need(value, message):
    if not value:
        raise ValueError('836 three-case qualification: '+message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def normalized(path):
    return path.read_bytes().replace(b'\r\n', b'\n')


def executable_identity(root):
    need(sha(normalized(root/RUNNER)) == RUNNER_SHA256, 'actual runner bytes changed')
    need(sha(normalized(root/WORKFLOW)) == WORKFLOW_SHA256, 'workflow command/controls changed')


def source_identity(root, env=os.environ):
    executable_identity(root)  # Before commands, runtime requests or evidence writes.
    revision = env.get('ASA_ELECTRONICS_EXPECTED_SHA', '')
    need(re.fullmatch(r'[0-9a-f]{40}', revision) and revision == env.get('GITHUB_SHA'),
         'exact GitHub revision required')

    def git(*args):
        return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.PIPE)

    need(git('rev-parse', 'HEAD').decode().strip() == revision, 'HEAD differs from revision')
    dirty = git('status', '--porcelain', '-z', '--untracked-files=all').decode().split('\0')
    need(not any(row and not row.startswith('?? '+DIRECTORY+'/') for row in dirty),
         'source must be clean; only new owned evidence is allowed')
    subprocess.run(['git', '-C', str(root), 'merge-base', '--is-ancestor', BASE, revision],
                   check=True, capture_output=True)
    changed = set(git('diff', '--no-renames', '--name-only', BASE, revision).decode().splitlines())
    need(changed and changed <= PATHS, 'CI-only diff changed product/e2e/migrations/full gates')

    def projection(ref):
        entries = git('ls-tree', '-r', '-z', '--full-tree', ref).split(b'\0')
        return b'\0'.join(row for row in entries if row and
                          row.split(b'\t', 1)[1].decode() not in PATHS)

    expected = projection(BASE)
    need(projection(revision) == expected, 'non-CI source projection differs')
    contract = json.loads((root/CONTRACT).read_text(encoding='utf-8'))
    need(contract['candidate'] == BASE and contract['cases'] == CASES
         and contract['runnerSha256'] == RUNNER_SHA256
         and contract['workflowSha256'] == WORKFLOW_SHA256,
         'published contract differs from reviewed constants')
    # Existing image transport is separately enforced unchanged by the workflow.
    # Retain its exact selected receipts for the runtime verifier.
    transport = json.loads((root/'docs/product/electronics/evidence/ci-image-transport-classroom-d13-receipt.json').read_text())
    images = {name: transport['images'][name] for name in ('node', 'caddy', 'postgres')}
    need(all(images[name]['source_identity'] == images[name]['transport_identity']
             for name in images), 'image identity mismatch')
    need(transport['original_receipt_sha256'] == sha(normalized(root/
         'docs/product/electronics/evidence/ci-image-transport-545-receipt.json')),
         'original image receipt changed')
    return {'revision': revision, 'candidate': BASE, 'sourceProjectionSha256': sha(expected),
            'runnerSha256': RUNNER_SHA256,
            'guardSha256': sha(normalized(root/'tools/electronics_836_three_source.py')),
            'workflowSha256': WORKFLOW_SHA256, 'scope': SUBSET,
            'schema': max(int(p.name.split('_')[0]) for p in (root/'migrations').glob('*.sql')),
            'images': images, 'fullElectronicsQualification': False, 'releaseAccepted': False}


def require_pair(root, env=os.environ):
    need(env.get('GITHUB_REPOSITORY') == 'spikeal8-maker/asa-lab'
         and env.get('GITHUB_JOB') == 'browser'
         and env.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
         and env.get('ASA_ELECTRONICS_EVIDENCE_SUBSET') == SUBSET
         and re.fullmatch(re.escape('spikeal8-maker/asa-lab/'+WORKFLOW)+r'@refs/heads/[^\s@]+',
                          env.get('GITHUB_WORKFLOW_REF', '')), 'unknown workflow/job/ref/event/subset')
    return source_identity(root, env)


def json_file(path):
    need(path.is_file() and not path.is_symlink(), 'missing or linked evidence: '+path.name)
    need(path.stat().st_size <= 32*1024*1024, 'oversized JSON evidence')
    return json.loads(path.read_text(encoding='utf-8'))


def json_lines(path):
    need(path.is_file() and not path.is_symlink(), 'missing or linked journal')
    need(path.stat().st_size <= 64*1024*1024, 'oversized journal')
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line]


def png_identity(path):
    need(path.is_file() and not path.is_symlink() and path.stat().st_size <= 16*1024*1024,
         'missing/linked/oversized native PNG')
    data = path.read_bytes()
    need(data[:8] == b'\x89PNG\r\n\x1a\n', 'PNG signature')
    offset, count, dimensions, ended, compressed, ihdr = 8, 0, None, False, [], None
    while offset < len(data):
        need(offset+12 <= len(data), 'truncated PNG')
        length = struct.unpack('>I', data[offset:offset+4])[0]
        end = offset+12+length
        need(end <= len(data), 'PNG chunk bounds')
        kind, body = data[offset+4:offset+8], data[offset+8:end-4]
        need(zlib.crc32(kind+body) & 0xffffffff == struct.unpack('>I', data[end-4:end])[0],
             'PNG CRC')
        if kind == b'IHDR':
            need(offset == 8 and len(body) == 13, 'PNG IHDR')
            dimensions = struct.unpack('>II', body[:8])
            ihdr = struct.unpack('>IIBBBBB', body)
        if kind == b'IDAT':
            compressed.append(body)
        if kind == b'IEND':
            need(length == 0 and end == len(data), 'PNG end')
            ended = True
        offset, count = end, count+1
    need(ended and dimensions and all(0 < n <= 8192 for n in dimensions), 'PNG dimensions/end')
    width, height, depth, color, compression, filtering, interlace = ihdr
    need(depth == 8 and color in (2, 6) and compression == filtering == interlace == 0,
         'native PNG format')
    stride = width*(3 if color == 2 else 4)+1
    need(compressed and stride*height <= 64*1024*1024, 'missing/oversized PNG raster')
    inflater = zlib.decompressobj()
    raster = inflater.decompress(b''.join(compressed), stride*height+1)
    need(inflater.eof and not inflater.unused_data and len(raster) == stride*height
         and all(raster[y*stride] <= 4 for y in range(height)), 'invalid PNG raster')
    return {'width': dimensions[0], 'height': dimensions[1], 'crcChunks': count, 'sha256': sha(data)}


class Trace:
    def __init__(self, path):
        need(path.is_file() and not path.is_symlink() and path.stat().st_size <= 256*1024*1024,
             'missing/linked/oversized trace')
        self.archive = zipfile.ZipFile(path)
        infos = self.archive.infolist()
        names = [i.filename for i in infos]
        need(len(names) == len(set(names)) and len(names) <= 20000
             and sum(i.file_size for i in infos) <= 512*1024*1024, 'trace bounds/duplicates')
        need(all(not PurePosixPath(n).is_absolute() and '..' not in PurePosixPath(n).parts
                 and '\\' not in n and not stat.S_ISLNK(i.external_attr >> 16)
                 for n, i in zip(names, infos)), 'trace path escape/link')
        self.entries = []
        for name in names:
            if name.endswith('.network'):
                need(self.archive.getinfo(name).file_size <= 32*1024*1024, 'network trace too large')
                for line in self.archive.read(name).splitlines():
                    row = json.loads(line)
                    if row.get('type') == 'resource-snapshot':
                        self.entries.append(row['snapshot'])
        need(self.entries, 'trace has no actual network entries')

    def body(self, container):
        if isinstance(container.get('text'), str):
            return json.loads(container['text'])
        resource = container.get('_sha1', '')
        need(re.fullmatch(r'[0-9a-f]{40}(?:\.[a-zA-Z0-9]+)?', resource), 'missing trace response body')
        need(self.archive.getinfo('resources/'+resource).file_size <= 8*1024*1024,
             'oversized trace body')
        data = self.archive.read('resources/'+resource)  # zipfile verifies CRC.
        need(len(data) <= 8*1024*1024 and hashlib.sha1(data).hexdigest() == resource[:40],
             'trace body identity')
        return json.loads(data)

    def close(self):
        self.archive.close()


def validate_e11(raw, lifecycle, trace, scenario):
    need(raw['width'] == 1440 and raw['scenario'] == scenario
         and raw.get('journeyComplete') is True and raw.get('lastCheckpoint') == 'complete'
         and not raw.get('primaryFailure') and not raw.get('mandatoryEvidenceFailure'),
         'whole original E11 journey incomplete')
    need(raw['lifecycleJournal']['errors'] == [] and raw['lifecycleJournal']['attemptedMarkers'] == 4
         and raw['workerJournal']['errors'] == [], 'lifecycle/worker journal incomplete')
    need([(r.get('operation'), r.get('outcome')) for r in lifecycle] ==
         [(op, outcome) for op in ('cookies-context-close', 'final-original-snapshot')
          for outcome in ('before', 'fulfilled')], 'missing/rejected lifecycle operation')
    need([r.get('sequence') for r in lifecycle] == [1, 2, 3, 4], 'lifecycle sequence')
    for i in (0, 2):
        need(lifecycle[i]['page'] == lifecycle[i+1]['page']
             and lifecycle[i]['context'] == lifecycle[i+1]['context'], 'lifecycle identity changed')
    rows = raw['output']
    one = lambda phase: [r for r in rows if r.get('phase') == phase]
    need(len(one('whole-save')) == 1 and len(one('cookies-only-editor-delivery')) == 1
         and len(one('pre-app-storage')) == 1, 'missing save/cookies-only delivery')
    saved = one('whole-save')[0]
    need(saved['expected'] == saved['local'] == saved['saved']['document']
         and saved['saved']['revision'] == saved['seeded']['revision']+1, 'whole save/CAS revision')
    need(len(raw['puts']) == 1 and raw['puts'] == saved['puts']
         and raw['puts'][0]['body']['baseRevision'] == saved['seeded']['revision']
         and raw['puts'][0]['body']['document'] == saved['expected'], 'extra PUT or wrong CAS')
    need(one('pre-app-storage')[0]['storage'] == {'local': [], 'session': []}
         and one('cookies-only-editor-delivery')[0]['whole']['draft'] == saved['saved'],
         'cookies-only reopen differs')
    need(raw['server']['draft'] == saved['saved'], 'saved server receipt differs')
    endpoint = '/api/projects/'+raw['projectId']
    puts = [r for r in trace.entries if r['request']['method'] == 'PUT'
            and urlsplit(r['request']['url']).path == endpoint+'/draft']
    need(len(puts) == 2, 'trace must show exactly seed PUT and one user save')
    user_saves = [r for r in puts if trace.body(r['request']['postData']).get('document') == saved['expected']]
    need(len(user_saves) == 1 and user_saves[0]['response']['status'] == 200
         and trace.body(user_saves[0]['request']['postData'])['baseRevision'] == saved['seeded']['revision'],
         'actual save request/CAS missing')
    gets = [r for r in trace.entries if r['request']['method'] == 'GET'
            and urlsplit(r['request']['url']).path == endpoint]
    need(gets, 'actual project GET missing')
    final = max(gets, key=lambda r: r['startedDateTime'])
    at = datetime.fromisoformat(final['startedDateTime'].replace('Z', '+00:00')).timestamp()*1000
    need(at >= lifecycle[-1]['at'] and final['response']['status'] == 200
         and trace.body(final['response']['content'])['draft'] == saved['saved'],
         'final GET after lifecycle did not preserve whole saved revision')
    return {'projectId': raw['projectId'], 'seedRevision': saved['seeded']['revision'],
            'savedRevision': saved['saved']['revision'], 'userPuts': 1,
            'wholeCookiesReopen': True, 'finalGetAfterLifecycle': True}


def validate_catalog(rows, trace):
    one = lambda kind: [r['data'] for r in rows if r.get('kind') == kind]
    need(len(one('editor-initial')) == 1 and len(one('editor-final')) == 1
         and len(one('browser-final')) == 1 and len(one('final')) == 1, 'catalog originals incomplete')
    initial, final, browser = one('editor-initial')[0], one('editor-final')[0], one('browser-final')[0]
    need(initial['initial']['components'] == [] and initial['initial']['connections'] == []
         and initial['initial'] == initial['current'] == final['initial'] == final['current']
         and initial['requests'] == final['requests'] == [] and initial['errors'] == final['errors'] == [],
         'catalog changed empty document or saved a component')
    need(not one('primary-error') and not one('secondary-error')
         and one('final')[0] == {'dropped': 0, 'retentionErrors': []}
         and browser['dropped'] == 0 and browser['deliveryErrors'] == []
         and browser['installationErrors'] == [] and browser['installationCount'] == 1
         and browser['replacementDetected'] is False, 'catalog observation failed/partial')
    asset = one('start')[0]['asset']
    native = [r['data'] for r in browser['entries'] if r.get('kind') == 'native'
              and urlsplit(r['data'].get('href', '')).path == asset and r['data'].get('trusted') is True]
    errors = [i for i, r in enumerate(native) if r['type'] == 'error']
    loads = [i for i, r in enumerate(native) if r['type'] == 'load'
             and 'asa-image-retry' in parse_qs(urlsplit(r['href']).query)]
    need(errors and loads and min(errors) < max(loads),
         'native catalog error/retry/load not witnessed')
    requests = [r for r in trace.entries if urlsplit(r['request']['url']).path == asset]
    need(any(r['response']['status'] == 404 for r in requests)
         and any(r['response']['status'] == 200 and
                 'asa-image-retry' in parse_qs(urlsplit(r['request']['url']).query) for r in requests),
         'actual temporary 404 and successful retry missing')
    need(not any(r['request']['method'] == 'PUT' and
                 re.fullmatch(r'/api/projects/[^/]+/draft', urlsplit(r['request']['url']).path)
                 for r in trace.entries), 'catalog has extra project PUT')
    return {'emptyDocumentPreserved': True, 'projectPuts': 0, 'nativeErrorAndLoad': True,
            'http404ThenRetry200': True}


def validate_artifacts(root):
    directory = root/DIRECTORY
    execution = json_file(directory/'execution.json')
    # Node validates exact file/describe/title/project/attempt identities before this command.
    reports = []
    def visit(suite):
        reports.extend(suite.get('specs', []))
        for child in suite.get('suites', []):
            visit(child)
    for suite in execution['suites']:
        visit(suite)
    need(len(reports) == 3, 'three artifact identities required')
    proof = []
    for case in CASES:
        selected = [r for r in reports if r['file'] == case['file'] and r['title'] == case['title']]
        need(len(selected) == 1, 'artifact case missing/duplicate')
        attachments = selected[0]['tests'][0]['results'][0]['attachments']
        traces = [a for a in attachments if a.get('name') == 'trace']
        need(len(traces) == 1, 'one actual trace per case')
        path = Path(traces[0]['path'])
        if not path.is_absolute():
            path = root/path
        need(path.resolve().is_relative_to((directory/'playwright').resolve()), 'trace escaped owned output')
        trace = Trace(path)
        try:
            if 'scenario' in case:
                scenario = case['scenario']
                raw = json_file(path.parent/f'e11-outline-{scenario}-1440-raw.json')
                lifecycle = json_lines(path.parent/f'e11-outline-{scenario}-1440-lifecycle.jsonl')
                result = validate_e11(raw, lifecycle, trace, scenario)
                worker = path.parent/f'e11-outline-{scenario}-1440-worker.jsonl'
                need(worker.is_file() and not worker.is_symlink()
                     and sha(worker.read_bytes()) == raw['workerJournal']['sha256']
                     and len(json_lines(worker)) == raw['workerJournal']['count'], 'worker bytes/count differ')
                phase = 'fit' if scenario == 'stopped-fit' else 'running'
                families = ['resistor','button','switch','led','lamp','supply','meter','uno','board']
                for selected_phase, family in [(phase, family) for family in families]+[('cookies-reopen', 'resistor')]:
                    pairs = [r for r in raw['output'] if r.get('phase') == selected_phase and r.get('id') == family]
                    need(len(pairs) == 1, 'missing native PNG pair')
                    for key in ('beforePath', 'afterPath'):
                        png = Path(pairs[0][key])
                        if not png.is_absolute():
                            png = root/png
                        state = 'unselected' if key == 'beforePath' else 'selected'
                        need(png.resolve().parent == path.parent.resolve()
                             and png.name == f'{selected_phase}-{family}-{state}.png', 'native PNG escaped case/identity')
                        png_identity(png)
            else:
                result = validate_catalog(json_lines(path.parent/'ordinary-image-recovery-native.jsonl'), trace)
                need(png_identity(path.parent/'ordinary-image-recovery-native.png')['width'] == 1440,
                     'catalog native screenshot width')
            proof.append({'title': case['title'], **result})
        finally:
            trace.close()
    return proof


def main():
    root = Path(__file__).resolve().parent.parent
    if sys.argv[1:] == ['--executables']:
        # The focused job checks bytes before importing the runner in unit tests,
        # not merely before the later native execution in the browser job.
        executable_identity(root)
        print('Reviewed executable/workflow bytes PASS')
    elif sys.argv[1:] == ['--source']:
        subset = os.environ.get('ASA_ELECTRONICS_EVIDENCE_SUBSET', '')
        need(subset in ('ui-679-557-six', SUBSET), 'unknown evidence subset')
        if subset == 'ui-679-557-six':
            print('Existing six-case selection unchanged; full Electronics acceptance not granted.')
            return
        receipt = require_pair(root)
        output = root/DIRECTORY/'source.json'
        output.parent.mkdir(parents=True, exist_ok=True)
        need(not output.exists(), 'stale source evidence')
        output.write_text(json.dumps(receipt, indent=2)+'\n', encoding='utf-8')
    elif sys.argv[1:] == ['--artifacts']:
        proof = validate_artifacts(root)
        (root/DIRECTORY/'original-journeys.json').write_text(json.dumps(proof, indent=2)+'\n')
    else:
        raise SystemExit('Only fixed --executables, --source or --artifacts is supported')


if __name__ == '__main__':
    main()
