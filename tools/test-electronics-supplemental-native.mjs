import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, createPublicKey } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { encryptEvidence, decryptEvidence, collect } from './electronics-supplemental-envelope.mjs';
import {
  cases,
  files,
  readiness,
  validateReady,
  validateWebIdentity,
} from './run-electronics-supplemental-native.mjs';

const pair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const source = { candidateRevision: 'a'.repeat(40), workflowRevision: 'b'.repeat(40), schema: 300 };
const archive = () => {
  const bytes = Buffer.from('SYNTHETIC PRIVATE BODY');
  return {
    format: 'asa-supplemental-evidence-files-v1',
    candidateRevision: source.candidateRevision,
    workflowRevision: source.workflowRevision,
    files: [
      {
        path: 'trace.zip',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        data: bytes.toString('base64'),
      },
    ],
  };
};
const report = (count = 1) => ({
  errors: [],
  stats: { expected: count * 2, unexpected: 0, flaky: 0, skipped: 0 },
  suites: files.map((file) => ({
    title: file,
    specs: Array.from({ length: count }, (_, i) => ({
      file: file.slice(4),
      title: 'literal native ' + i,
      tests: [
        {
          expectedStatus: 'passed',
          annotations: [],
          status: 'expected',
          results: [{ status: 'passed', retry: 0 }],
        },
      ],
    })),
  })),
});

test('encrypted evidence uses a distinct recipient-bound authenticated format without plaintext', () => {
  const key = pair(),
    value = archive(),
    envelope = encryptEvidence(value, key.publicKey);
  assert.equal(envelope.format, 'asa-supplemental-evidence-encrypted-v1');
  assert.doesNotMatch(JSON.stringify(envelope), /SYNTHETIC PRIVATE BODY|trace.zip/);
  assert.deepEqual(decryptEvidence(envelope, key.privateKey), value);
});
test('existing owner public recipient can encrypt without requiring its private counterpart', () => {
  const key = readFileSync(new URL('./web-symbols-public.pem', import.meta.url), 'utf8');
  const encrypted = encryptEvidence(archive(), key);
  assert.equal(
    encrypted.recipient,
    createHash('sha256')
      .update(createPublicKey(key).export({ type: 'spki', format: 'der' }))
      .digest('hex'),
  );
  assert.doesNotMatch(JSON.stringify(encrypted), /SYNTHETIC PRIVATE BODY/);
});
test(
  'real private file collection is bounded and rejects symlinks',
  { skip: process.platform === 'win32' },
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'asa-supplemental-envelope-'));
    assert.ok(directory.startsWith(join(tmpdir(), 'asa-supplemental-envelope-')));
    try {
      writeFileSync(join(directory, 'private.log'), 'synthetic');
      assert.equal(
        collect(directory, source.candidateRevision, source.workflowRevision).files.length,
        1,
      );
      symlinkSync(join(directory, 'private.log'), join(directory, 'alias'));
      assert.throws(() => collect(directory, source.candidateRevision, source.workflowRevision));
    } finally {
      rmSync(directory, { recursive: true });
    }
  },
);
test('wrong recipient, corruption, malformed base64 and relabelled provenance are denied', () => {
  const key = pair(),
    other = pair(),
    envelope = encryptEvidence(archive(), key.publicKey);
  assert.throws(() => decryptEvidence(envelope, other.privateKey));
  for (const changes of [
    { format: 'asa-web-symbols-encrypted-v1' },
    { recipient: 'c'.repeat(64) },
    { candidateRevision: 'c'.repeat(40) },
    { workflowRevision: 'c'.repeat(40) },
    { data: '!!!' },
    { iv: 'AA==' },
    { tag: 'AA==' },
    { data: Buffer.from('corrupted').toString('base64') },
    { key: 'AA==' },
  ])
    assert.throws(() => decryptEvidence({ ...envelope, ...changes }, key.privateKey));
});
test('archive types, file identities, traversal, duplicates and bounds fail before encryption', () => {
  const key = pair();
  for (const mutate of [
    (a) => (a.files[0].path = '../secret'),
    (a) => (a.files[0].path = '/absolute'),
    (a) => (a.files[0].path = 'C:\\secret'),
    (a) => a.files.push({ ...a.files[0] }),
    (a) => (a.files[0].sha256 = 'd'.repeat(64)),
    (a) => (a.files[0].bytes = 134217729),
    (a) => (a.files[0].data = 'broken!'),
    (a) => (a.files = []),
    (a) => (a.candidateRevision = 'main'),
  ]) {
    const a = archive();
    mutate(a);
    assert.throws(() => encryptEvidence(a, key.publicKey));
  }
});
test('bounded multi-megabyte evidence round-trips without recursive base64 parsing', () => {
  const key = pair(),
    bytes = Buffer.alloc(8 * 1024 * 1024, 42);
  const value = archive();
  value.files = [
    {
      path: 'large-synthetic.bin',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      data: bytes.toString('base64'),
    },
  ];
  const envelope = encryptEvidence(value, key.publicKey);
  assert.deepEqual(decryptEvidence(envelope, key.privateKey), value);
  assert.throws(() =>
    encryptEvidence({ ...value, unexpected: 'not the typed archive' }, key.publicKey),
  );
  assert.throws(() =>
    decryptEvidence({ ...envelope, unexpected: 'not the typed envelope' }, key.privateKey),
  );
});
test('discovery derives actual nonempty counts for both complete original files', () => {
  assert.equal(cases(report()).length, 2);
  assert.equal(cases(report(3), true).length, 6);
  for (const mutate of [
    (r) => r.suites.pop(),
    (r) => (r.suites[0].specs[0].file = 'foreign.spec.ts'),
    (r) => r.suites[0].specs.push({ ...r.suites[0].specs[0] }),
    (r) => r.errors.push({ message: 'incomplete' }),
    (r) => r.suites[0].specs[0].tests[0].annotations.push({ type: 'skip' }),
  ]) {
    const r = report();
    mutate(r);
    assert.throws(() => cases(r));
  }
});
test('execution cannot pass with skipped, retried, partial, flaky or failed cases', () => {
  for (const mutate of [
    (r) => (r.suites[0].specs[0].tests[0].results[0].retry = 1),
    (r) => (r.suites[0].specs[0].tests[0].results = []),
    (r) => (r.suites[0].specs[0].tests[0].results[0].status = 'timedOut'),
    (r) => (r.stats.flaky = 1),
    (r) => (r.stats.expected = 1),
  ]) {
    const r = report();
    mutate(r);
    assert.throws(() => cases(r, true));
  }
});
test('actual and expected runtime schemas and exact candidate revision remain strict', () => {
  const body = {
    status: 'ready',
    deployment: {
      revision: source.candidateRevision,
      schemaVersion: 300,
      expectedSchemaVersion: 300,
      synchronized: true,
    },
    secret: 'NOT RETAINED',
  };
  validateReady(readiness(200, body, source), source);
  assert.doesNotMatch(JSON.stringify(readiness(200, body, source)), /NOT RETAINED/);
  for (const changes of [
    { revision: source.workflowRevision },
    { schemaVersion: 299 },
    { expectedSchemaVersion: null },
    { synchronized: null },
    { synchronized: false },
  ])
    assert.throws(() =>
      validateReady(
        readiness(200, { ...body, deployment: { ...body.deployment, ...changes } }, source),
        source,
      ),
    );
  assert.throws(() => validateReady(readiness(503, body, source), source));
  validateWebIdentity(200, { revision: source.candidateRevision }, source);
  for (const [status, body] of [
    [404, null],
    [200, { revision: source.workflowRevision }],
    [200, {}],
  ])
    assert.throws(() => validateWebIdentity(status, body, source));
});
test('runner has fixed two-file command and no worker/time/filter/retry overrides or raw stdout', () => {
  const text = readFileSync(
    new URL('./run-electronics-supplemental-native.mjs', import.meta.url),
    'utf8',
  );
  assert.match(text, /\['exec',\s*'playwright',\s*'test',\s*\.\.\.files/);
  assert.doesNotMatch(
    text,
    /--grep|--workers|--timeout|--retries|--repeat-each|stdio:\s*'inherit'/,
  );
  assert.match(text, /--trace=on/);
  assert.match(text, /fullElectronicsQualification:\s*false/);
});
