"""Offline actual Git/ZIP/PNG fixtures; no Docker, providers or browser jobs."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import zlib
import electronics_836_three_source as contract

ROOT = Path(__file__).resolve().parent.parent
ENV = {'GITHUB_REPOSITORY': 'spikeal8-maker/asa-lab', 'GITHUB_JOB': 'browser',
       'GITHUB_EVENT_NAME': 'workflow_dispatch', 'ASA_ELECTRONICS_EVIDENCE_SUBSET': contract.SUBSET,
       'GITHUB_WORKFLOW_REF': 'spikeal8-maker/asa-lab/'+contract.WORKFLOW+'@refs/heads/ci/fixed'}


def put(root, name, data):
    path = root/name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else data.encode())
    return path


def png(width=1, height=1):
    def chunk(kind, body):
        return struct.pack('>I', len(body))+kind+body+struct.pack('>I', zlib.crc32(kind+body) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))+chunk(b'IDAT', zlib.compress(b'\0'*(height*(width*3+1))))+chunk(b'IEND', b'')


def complete_e11():
    doc = {'schemaVersion': 4, 'components': [{'id': 'resistor', 'rotation': 90}], 'connections': [], 'simulation': {'running': False}}
    seed = {'revision': 1, 'document': {**doc, 'components': [{'id': 'resistor', 'rotation': 0}]}}
    saved = {'revision': 2, 'document': doc}
    body = {'baseRevision': 1, 'document': doc}
    puts = [{'at': 1000, 'body': body}]
    raw = {'width': 1440, 'scenario': 'stopped-fit', 'journeyComplete': True,
           'lastCheckpoint': 'complete', 'projectId': 'synthetic', 'puts': puts,
           'lifecycleJournal': {'errors': [], 'attemptedMarkers': 4},
           'workerJournal': {'errors': []}, 'server': {'draft': saved},
           'output': [{'phase': 'whole-save', 'expected': doc, 'local': doc, 'seeded': seed, 'saved': saved, 'puts': puts},
                      {'phase': 'pre-app-storage', 'storage': {'local': [], 'session': []}},
                      {'phase': 'cookies-only-editor-delivery', 'whole': {'draft': saved}}]}
    lifecycle = [{'operation': op, 'outcome': outcome, 'sequence': i+1, 'at': (i+1)*1000, 'page': i//2+1, 'context': i//2+1}
                 for i, (op, outcome) in enumerate([(op, outcome) for op in ('cookies-context-close', 'final-original-snapshot') for outcome in ('before', 'fulfilled')])]
    def entry(method, path, body=None):
        return {'startedDateTime': '1970-01-01T00:00:05.000Z',
                'request': {'method': method, 'url': 'http://web:8080'+path, 'postData': {'text': json.dumps(body)}},
                'response': {'status': 200, 'content': {'text': json.dumps({'draft': saved})}}}
    entries = [entry('PUT', '/api/projects/synthetic/draft', {'baseRevision': 0, 'document': seed['document']}),
               entry('PUT', '/api/projects/synthetic/draft', body), entry('GET', '/api/projects/synthetic')]
    return raw, lifecycle, entries


class TraceFixture:
    body = staticmethod(lambda container: json.loads(container['text']))
    def __init__(self, entries):
        self.entries = entries


class SourceContracts(unittest.TestCase):
    def test_source_directory_is_created_before_existing_isolated_permissions_step(self):
        workflow = (ROOT/contract.WORKFLOW).read_text(encoding='utf-8')
        self.assertLess(workflow.index('- name: Verify closed subset and exact three-case source before Docker'),
                        workflow.index('- name: Prepare writable evidence directories'))
        self.assertIn('mkdir -p e2e/artifacts/electronics-simulation reports\n          chmod -R 0777 e2e/artifacts reports\n', workflow)

    @unittest.skipUnless(sys.platform.startswith('linux') and os.environ.get('GITHUB_ACTIONS') == 'true',
                         'Actual differing-UID permission proof requires isolated GitHub Linux')
    def test_actual_linux_different_uid_cannot_write_old_0755_but_can_after_workflow_preparation(self):
        # No sudo outside isolated CI. The child immediately drops all groups and
        # UID/GID; its only writes are disposable fixture artifacts, removed by it.
        host_uid = os.geteuid()
        target_uid = 1000 if host_uid != 1000 else 65534
        prefix = [sys.executable] if host_uid == 0 else ['/usr/bin/sudo', '-n', '/usr/bin/python3']
        child = '''import os, pathlib, sys
assert os.geteuid() == 0
uid = int(sys.argv[2]); os.setgroups([]); os.setgid(uid); os.setuid(uid)
path = pathlib.Path(sys.argv[1])/'playwright'; created = False
try:
    path.mkdir(); created = True
    (path/'execution.json').write_text('{}')
    assert (path/'execution.json').read_text() == '{}'
    print(os.geteuid())
except PermissionError:
    raise SystemExit(73)
finally:
    if created:
        (path/'execution.json').unlink(missing_ok=True); path.rmdir()
'''
        workflow = (ROOT/contract.WORKFLOW).read_text(encoding='utf-8')
        source_at = workflow.index('- name: Verify closed subset and exact three-case source before Docker')
        permissions_at = workflow.index('- name: Prepare writable evidence directories')
        prepare = 'mkdir -p e2e/artifacts/electronics-simulation reports\nchmod -R 0777 e2e/artifacts reports\n'
        self.assertIn(prepare.replace('\n', '\n          ').rstrip(), workflow)
        with tempfile.TemporaryDirectory(prefix='asa836-permissions-') as folder:
            root = Path(folder).resolve()
            self.assertTrue(root.is_relative_to(Path(tempfile.gettempdir()).resolve()))
            root.chmod(0o755)
            def probe(directory):
                return subprocess.run([*prefix, '-c', child, str(directory), str(target_uid)],
                                      capture_output=True, text=True, timeout=10)
            old_mask = os.umask(0o022)
            try:
                denied = root/'before'/contract.DIRECTORY
                denied.mkdir(parents=True)
                self.assertEqual(denied.stat().st_mode & 0o777, 0o755)
                self.assertEqual(probe(denied).returncode, 73, 'old directory must deny the other UID')
                actual = root/'actual'; actual.mkdir()
                private = actual/'private'; private.mkdir(mode=0o700)
                report = actual/contract.DIRECTORY
                for _, operation in sorted([(source_at, 'source'), (permissions_at, 'permissions')]):
                    if operation == 'source':
                        report.mkdir(parents=True)
                        (report/'source.json').write_text('{}')
                    else:
                        subprocess.run(['/bin/bash', '-e', '-c', prepare], cwd=actual, check=True,
                                       capture_output=True, timeout=10)
                self.assertEqual(report.stat().st_mode & 0o777, 0o777)
                self.assertEqual(private.stat().st_mode & 0o777, 0o700)
                allowed = probe(report)
                self.assertEqual(allowed.returncode, 0, allowed.stderr)
                self.assertEqual(allowed.stdout.strip(), str(target_uid))
            finally:
                os.umask(old_mask)

    def test_actual_reviewed_executable_bytes_and_workflow_are_pinned(self):
        contract.executable_identity(ROOT)
        with tempfile.TemporaryDirectory(prefix='asa836-bytes-') as folder:
            root = Path(folder)
            put(root, contract.RUNNER, (ROOT/contract.RUNNER).read_bytes()+b"\nspawnSync('arbitrary-command', []);\n")
            put(root, contract.WORKFLOW, (ROOT/contract.WORKFLOW).read_bytes())
            with self.assertRaisesRegex(ValueError, 'runner bytes'):
                contract.executable_identity(root)

    def test_unknown_pairs_never_reach_source_or_docker(self):
        with patch.object(contract, 'source_identity', return_value={'ok': True}) as source:
            self.assertEqual(contract.require_pair(ROOT, ENV), {'ok': True})
            source.reset_mock()
            for change in [{'GITHUB_JOB': 'focused'}, {'GITHUB_REPOSITORY': 'foreign/repo'},
                           {'GITHUB_EVENT_NAME': 'pull_request'}, {'ASA_ELECTRONICS_EVIDENCE_SUBSET': 'arbitrary'},
                           {'GITHUB_WORKFLOW_REF': ENV['GITHUB_WORKFLOW_REF']+'@evil'},
                           {'GITHUB_WORKFLOW_REF': ENV['GITHUB_WORKFLOW_REF'].replace('refs/heads/', 'refs/tags/')}]:
                with self.subTest(change=change), self.assertRaises(ValueError):
                    contract.require_pair(ROOT, {**ENV, **change})
            source.assert_not_called()

    def test_expected_schema_is_one_bounded_assignment_from_revalidated_exact_receipt(self):
        with tempfile.TemporaryDirectory(prefix='asa836-schema-') as folder:
            root = Path(folder)
            receipt = {'revision': 'a'*40, 'schema': 300, 'scope': contract.SUBSET}
            def put_receipt(value):
                put(root, contract.DIRECTORY+'/source.json', json.dumps(value))
            with patch.object(contract, 'require_pair', return_value=receipt) as validated:
                with self.assertRaises(ValueError):contract.expected_schema_assignment(root, ENV)
                put_receipt(receipt)
                self.assertEqual(contract.expected_schema_assignment(root, ENV), 'ASA_EXPECTED_SCHEMA_VERSION=300')
                validated.assert_called_with(root, ENV)
                for changed in [{**receipt, 'schema': 299}, {**receipt, 'revision': 'b'*40}, {}]:
                    put_receipt(changed)
                    with self.assertRaisesRegex(ValueError, 'receipt changed'):
                        contract.expected_schema_assignment(root, ENV)
            for schema in (299, '300', True, None, '300\nFOREIGN=1'):
                bad = {**receipt, 'schema': schema};put_receipt(bad)
                with patch.object(contract, 'require_pair', return_value=bad), self.assertRaisesRegex(ValueError, 'fixed source schema'):
                    contract.expected_schema_assignment(root, ENV)

    def test_actual_clean_git_mutants_cannot_change_runner_workflow_or_product(self):
        with tempfile.TemporaryDirectory(prefix='asa836-git-') as folder:
            root = Path(folder).resolve()
            self.assertTrue(root.is_relative_to(Path(tempfile.gettempdir()).resolve()))
            def git(*args):
                return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.PIPE).decode().strip()
            git('init', '-q'); git('config', 'user.name', 'Offline fixture'); git('config', 'user.email', 'fixture@example.invalid')
            git('config', 'commit.gpgsign', 'false'); git('config', 'core.autocrlf', 'false')
            (root/'.git/no-hooks').mkdir(); git('config', 'core.hooksPath', str(root/'.git/no-hooks'))
            put(root, 'migrations/0300_fixture.sql', '-- synthetic metadata only\n')
            for path in ['docs/product/electronics/evidence/ci-image-transport-545-receipt.json', 'docs/product/electronics/evidence/ci-image-transport-classroom-d13-receipt.json']:
                put(root, path, (ROOT/path).read_bytes())
            put(root, 'product.txt', 'preserved\n'); git('add', '.'); git('commit', '-qm', 'baseline')
            base = git('rev-parse', 'HEAD')
            for path in contract.PATHS:
                put(root, path, (ROOT/path).read_bytes())
            declaration = json.loads((root/contract.CONTRACT).read_text())
            declaration['candidate'] = base
            put(root, contract.CONTRACT, json.dumps(declaration))
            git('add', '.'); git('commit', '-qm', 'reviewed CI delta')
            def check():
                revision = git('rev-parse', 'HEAD')
                return contract.source_identity(root, {**ENV, 'GITHUB_SHA': revision, 'ASA_ELECTRONICS_EXPECTED_SHA': revision})
            with patch.object(contract, 'BASE', base):
                receipt = check()
                self.assertEqual(receipt['schema'], 300)
                put(root, contract.DIRECTORY+'/source.json', json.dumps(receipt))
                revision = git('rev-parse', 'HEAD')
                actual_env = {**ENV, 'GITHUB_SHA': revision, 'ASA_ELECTRONICS_EXPECTED_SHA': revision}
                self.assertEqual(contract.expected_schema_assignment(root, actual_env), 'ASA_EXPECTED_SCHEMA_VERSION=300')
                (root/contract.DIRECTORY/'source.json').unlink()
                runner, workflow = (ROOT/contract.RUNNER).read_bytes(), (ROOT/contract.WORKFLOW).read_bytes()
                for name, changed in [('arbitrary-command', runner+b"\nspawnSync('arbitrary-command', []);\n"),
                                      ('retry-seven', runner.replace(b'--retries=0', b'--retries=7'))]:
                    put(root, contract.RUNNER, changed)
                    # Updating the declaration together with changed code still cannot alter the hard pin.
                    altered = {**declaration, 'runnerSha256': contract.sha(changed.replace(b'\r\n', b'\n'))}
                    put(root, contract.CONTRACT, json.dumps(altered)); git('add', '.'); git('commit', '-qm', name)
                    self.assertEqual(git('status', '--porcelain'), '')
                    with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'runner bytes'):
                        check()
                    preimport = subprocess.run([sys_executable(), str(root/'tools/electronics_836_three_source.py'), '--executables'], capture_output=True)
                    self.assertNotEqual(preimport.returncode, 0)
                    self.assertIn(b'actual runner bytes changed', preimport.stderr)
                put(root, contract.RUNNER, runner); put(root, contract.CONTRACT, json.dumps(declaration))
                put(root, contract.WORKFLOW, workflow.replace(b'node tools/run-electronics-836-runtime-three.mjs', b'pnpm arbitrary-command'))
                git('add', '.'); git('commit', '-qm', 'changed workflow')
                with self.assertRaisesRegex(ValueError, 'workflow command'):
                    check()
                put(root, contract.WORKFLOW, workflow); put(root, 'product.txt', 'foreign product change\n')
                git('add', '.'); git('commit', '-qm', 'product drift')
                with self.assertRaisesRegex(ValueError, 'CI-only diff'):
                    check()


class OriginalEvidenceContracts(unittest.TestCase):
    def test_catalog_requires_actual_error_retry_recovery_and_no_document_or_put_change(self):
        empty = {'schemaVersion': 4, 'components': [], 'connections': [], 'viewport': {'x': 0, 'y': 0, 'zoom': 1}}
        editor = {'initial': empty, 'current': empty, 'requests': [], 'errors': []}
        browser = {'entries': [
            {'kind': 'native', 'data': {'type': 'error', 'trusted': True, 'href': '/asset.svg'}},
            {'kind': 'native', 'data': {'type': 'load', 'trusted': True, 'href': '/asset.svg?asa-image-retry=0'}}],
            'dropped': 0, 'deliveryErrors': [], 'installationErrors': [], 'installationCount': 1, 'replacementDetected': False}
        rows = [{'kind': 'start', 'data': {'asset': '/asset.svg'}},
                {'kind': 'editor-initial', 'data': editor}, {'kind': 'editor-final', 'data': editor},
                {'kind': 'browser-final', 'data': browser}, {'kind': 'final', 'data': {'dropped': 0, 'retentionErrors': []}}]
        entries = [{'request': {'method': 'GET', 'url': 'http://web:8080/asset.svg'+query}, 'response': {'status': status}}
                   for query, status in [('', 404), ('?asa-image-retry=0', 200)]]
        self.assertTrue(contract.validate_catalog(rows, TraceFixture(entries))['emptyDocumentPreserved'])
        for mutate in [lambda r,e: r[2]['data'].update(requests=[{'method': 'PUT'}]),
                       lambda r,e: r[3]['data']['entries'].pop(),
                       lambda r,e: r[3]['data']['entries'][1]['data'].update(href='/foreign.svg?asa-image-retry=0'),
                       lambda r,e: r[3]['data'].update(dropped=1),
                       lambda r,e: r.append({'kind':'secondary-error','data':'missing capture'}),
                       lambda r,e: e.pop(),
                       lambda r,e: e.append({'request':{'method':'PUT','url':'http://web:8080/api/projects/id/draft'}})]:
            r,e = deepcopy((rows,entries)); mutate(r,e)
            with self.subTest(mutate=mutate), self.assertRaises((ValueError, KeyError)):
                contract.validate_catalog(r,TraceFixture(e))

    def test_whole_cas_cookies_reopen_lifecycle_and_final_get_are_mandatory(self):
        raw, lifecycle, entries = complete_e11()
        self.assertTrue(contract.validate_e11(raw, lifecycle, TraceFixture(entries), 'stopped-fit')['finalGetAfterLifecycle'])
        for mutate in [lambda r,l,e: r.update(journeyComplete=False), lambda r,l,e: r['puts'].append(deepcopy(r['puts'][0])),
                       lambda r,l,e: r['output'][0]['saved'].update(revision=3),
                       lambda r,l,e: r['output'][1]['storage']['local'].append(['draft','leaked']),
                       lambda r,l,e: l[-1].update(outcome='rejected'), lambda r,l,e: l.pop(),
                       lambda r,l,e: e[-1].update(startedDateTime='1970-01-01T00:00:01Z'),
                       lambda r,l,e: e[-1]['response']['content'].update(text='{"draft":{"revision":999}}'),
                       lambda r,l,e: e.append(deepcopy(e[1]))]:
            r,l,e = deepcopy((raw,lifecycle,entries)); mutate(r,l,e)
            with self.subTest(mutate=mutate), self.assertRaises((ValueError, KeyError)):
                contract.validate_e11(r,l,TraceFixture(e),'stopped-fit')

    def test_real_trace_zip_resource_identity_and_png_crc_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix='asa836-artifacts-') as folder:
            root = Path(folder)
            image = put(root, 'native.png', png())
            self.assertEqual(contract.png_identity(image)['width'], 1)
            damaged = bytearray(image.read_bytes()); damaged[-5] ^= 1; image.write_bytes(damaged)
            with self.assertRaisesRegex(ValueError, 'CRC'):
                contract.png_identity(image)
            payload = b'{"draft":{"revision":2}}'; key = hashlib.sha1(payload).hexdigest()+'.json'
            entry = {'request': {'method': 'GET', 'url': 'http://web:8080/api/projects/fixture'}, 'response': {'content': {'_sha1': key}}}
            path = root/'trace.zip'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('0.network', json.dumps({'type': 'resource-snapshot', 'snapshot': entry})+'\n')
                archive.writestr('resources/'+key, payload)
            trace = contract.Trace(path)
            try:self.assertEqual(trace.body(entry['response']['content']), {'draft': {'revision': 2}})
            finally:trace.close()
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('0.network', json.dumps({'type': 'resource-snapshot', 'snapshot': entry})+'\n')
                archive.writestr('resources/'+key, b'{"draft":{"revision":999}}')
            trace = contract.Trace(path)
            try:
                with self.assertRaisesRegex(ValueError, 'body identity'):
                    trace.body(entry['response']['content'])
            finally:trace.close()
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('../escape', 'denied')
            with self.assertRaises(ValueError):contract.Trace(path)

    def test_actual_artifact_entrypoint_binds_each_original_trace_raw_png_and_worker(self):
        with tempfile.TemporaryDirectory(prefix='asa836-complete-') as folder:
            root = Path(folder)
            directory = root/contract.DIRECTORY
            reports = []
            for index, case in enumerate(contract.CASES):
                case_dir = directory/'playwright'/str(index)
                case_dir.mkdir(parents=True)
                if index < 2:
                    raw, lifecycle, entries = complete_e11()
                    scenario = case['scenario']; raw['scenario'] = scenario
                    phase = 'fit' if scenario == 'stopped-fit' else 'running'
                    for selected_phase,family in [(phase,family) for family in ['resistor','button','switch','led','lamp','supply','meter','uno','board']]+[('cookies-reopen','resistor')]:
                        pair = {'phase':selected_phase,'id':family}
                        for state,key in [('unselected','beforePath'),('selected','afterPath')]:
                            pair[key] = str(put(root,str((case_dir/f'{selected_phase}-{family}-{state}.png').relative_to(root)),png()))
                        raw['output'].append(pair)
                    worker = put(root,str((case_dir/f'e11-outline-{scenario}-1440-worker.jsonl').relative_to(root)),b'')
                    raw['workerJournal'].update(sha256=contract.sha(worker.read_bytes()),count=0)
                    put(root,str((case_dir/f'e11-outline-{scenario}-1440-raw.json').relative_to(root)),json.dumps(raw))
                    put(root,str((case_dir/f'e11-outline-{scenario}-1440-lifecycle.jsonl').relative_to(root)),''.join(json.dumps(r)+'\n' for r in lifecycle))
                else:
                    # Catalog's complete raw fixture is generated by the same
                    # public observer envelope, without a browser or real account.
                    empty={'schemaVersion':4,'components':[],'connections':[]}
                    editor={'initial':empty,'current':empty,'requests':[],'errors':[]}
                    rows=[{'kind':'start','data':{'asset':'/asset.svg'}},
                          {'kind':'editor-initial','data':editor},{'kind':'editor-final','data':editor},
                          {'kind':'browser-final','data':{'entries':[
                              {'kind':'native','data':{'type':'error','trusted':True,'href':'/asset.svg'}},
                              {'kind':'native','data':{'type':'load','trusted':True,'href':'/asset.svg?asa-image-retry=0'}}],
                              'dropped':0,'deliveryErrors':[],'installationErrors':[],'installationCount':1,'replacementDetected':False}},
                          {'kind':'final','data':{'dropped':0,'retentionErrors':[]}}]
                    entries=[{'request':{'method':'GET','url':'http://web:8080/asset.svg'+q},'response':{'status':s}}
                             for q,s in [('',404),('?asa-image-retry=0',200)]]
                    put(root,str((case_dir/'ordinary-image-recovery-native.jsonl').relative_to(root)),''.join(json.dumps(r)+'\n' for r in rows))
                    put(root,str((case_dir/'ordinary-image-recovery-native.png').relative_to(root)),png(1440,1000))
                trace=case_dir/'trace.zip'
                with zipfile.ZipFile(trace,'w') as archive:
                    archive.writestr('0.network',''.join(json.dumps({'type':'resource-snapshot','snapshot':entry})+'\n' for entry in entries))
                reports.append({'file':case['file'],'title':case['title'],'tests':[{'results':[{'attachments':[{'name':'trace','path':str(trace)}]}]}]})
            put(root,contract.DIRECTORY+'/execution.json',json.dumps({'suites':[{'specs':reports}]}))
            self.assertEqual(len(contract.validate_artifacts(root)),3)
            worker=directory/'playwright/1/e11-outline-running-controls-1440-worker.jsonl'
            worker.write_text('{"foreign":"tail"}\n')
            with self.assertRaisesRegex(ValueError,'worker bytes/count'):
                contract.validate_artifacts(root)

    def test_actual_default_six_cli_remains_an_offline_no_op_and_unknown_is_denied(self):
        for subset, expected in [('ui-679-557-six', 0), ('foreign', 1)]:
            child = subprocess.run([sys_executable(), str(ROOT/'tools/electronics_836_three_source.py'), '--source'],
                env={**os.environ, 'ASA_ELECTRONICS_EVIDENCE_SUBSET': subset}, capture_output=True)
            self.assertEqual(child.returncode, expected)


def sys_executable():
    import sys
    return sys.executable


if __name__ == '__main__':
    unittest.main()
