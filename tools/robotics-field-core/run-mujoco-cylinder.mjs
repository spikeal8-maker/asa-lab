import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import {
  RawJournal,
  canonicalEqual,
  demand,
  digest,
  portableError,
} from './mujoco-contact-observer.mjs';
import {
  readCylinderFixture,
  validateCylinderFixture,
  verifyCylinderArtifacts,
  cylinderSourceManifest,
  cylinderPlan,
  executeCylinder,
} from './mujoco-cylinder.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const reportPath = resolve(
  root,
  'docs/product/robotics/evidence/field-core-mujoco-cylinder-20261111.json',
);
const markdownPath = resolve(
  root,
  'docs/product/robotics/evidence/field-core-mujoco-cylinder-20261111.md',
);
const reportHashes = () => ({
  json: digest(readFileSync(reportPath)),
  markdown: digest(readFileSync(markdownPath)),
});
const args = process.argv.slice(2);
const preregister = args.length === 1 && args[0] === '--preregister';
let mode = null;
let operation = null;
let directory = null;
if (!preregister) {
  const remaining = [...args];
  const dirIndex = remaining.indexOf('--journal-dir');
  if (dirIndex !== -1) {
    demand(dirIndex + 1 < remaining.length, 'Missing --journal-dir value');
    directory = remaining[dirIndex + 1];
    remaining.splice(dirIndex, 2);
  }
  demand(
    remaining.length === 2 &&
      ['--admission', '--main'].includes(remaining[0]) &&
      ['--write-evidence', '--verify-recorded'].includes(remaining[1]),
    'Usage: node tools/robotics-field-core/run-mujoco-cylinder.mjs --preregister | ' +
      '--admission|--main --write-evidence|--verify-recorded [--journal-dir ABSOLUTE_EXTERNAL_PATH]',
  );
  mode = remaining[0].slice(2);
  operation = remaining[1] === '--write-evidence' ? 'qualification' : 'explicit-replay';
}
const stringify = (v) =>
  JSON.stringify(
    v,
    (_key, value) =>
      typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))
        ? { $float64: Object.is(value, -0) ? '-0' : String(value) }
        : value,
    2,
  ) + '\n';
const parse = (s) =>
  JSON.parse(s, (_key, value) =>
    value &&
    typeof value === 'object' &&
    Object.keys(value).length === 1 &&
    typeof value.$float64 === 'string'
      ? { '-0': -0, NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity }[value.$float64]
      : value,
  );
const { fixture: f, fixtureSha256 } = readCylinderFixture();
validateCylinderFixture(f);
const artifact = verifyCylinderArtifacts(f);
const sourceManifest = cylinderSourceManifest();
const git = (a) =>
  execFileSync('git', a, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  }).trim();
const gitHead = git(['rev-parse', 'HEAD']);
const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean);
const evidence = existsSync(reportPath)
  ? parse(readFileSync(reportPath, 'utf8'))
  : {
      schemaVersion: 1,
      task: f.task,
      test: f.id,
      scope: 'TEST_ONLY',
      boundary:
        'Native contact observer/rest/tip qualification only; browser, Worker, school performance, remaining six-test and E1/D01 acceptance are open.',
      sourceBase: f.parent.baseCommit,
      preregistrations: [],
      attempts: [],
      governance: {
        status: 'NOT_RUN',
        independentReview: 'NOT_RUN',
        githubQualificationCI: 'NOT_RUN',
      },
    };
const saveEvidence = () => {
  const text = stringify(evidence);
  demand(
    Buffer.byteLength(text, 'utf8') <= f.retention.maxCommittedSummaryBytes,
    'RESOURCE_COMMITTED_SUMMARY_BYTE_CAP',
  );
  writeFileSync(reportPath, text, 'utf8');
};
const matches = (r) =>
  r && r.fixtureSha256 === fixtureSha256 && canonicalEqual(r.sourceManifest, sourceManifest);

if (preregister) {
  demand(
    !matches(evidence.preregistrations.at(-1)),
    'Exact source/fixture snapshot is already preregistered',
  );
  const registration = {
    registeredAtUtc: new Date().toISOString(),
    gitHead,
    sourceIdentity: dirty.length ? 'base_commit_plus_dirty_source_snapshot' : 'exact_commit',
    dirty,
    fixtureSha256,
    sourceManifest,
    inputs: f,
    admissionPlan: cylinderPlan(f, 'admission'),
    mainPlan: cylinderPlan(f, 'main'),
    artifact: {
      package: artifact.package,
      version: artifact.version,
      manifestSha256: artifact.manifestSha256,
      wasmSha256: artifact.wasmSha256,
      moduleSha256: artifact.moduleSha256,
      companionNoticesSha256: artifact.companionNoticesSha256,
      verdict: 'PASS',
      physics: 'NOT_RUN',
    },
    moduleInitializations: 0,
    modelCreations: 0,
    dataCreations: 0,
    nativeAdvances: 0,
    controllerGate:
      'Await separate frozen-source ADMISSION GO; MAIN requires admission PASS and separate MAIN GO.',
  };
  evidence.preregistrations.push(registration);
  saveEvidence();
  process.stdout.write(
    JSON.stringify({ event: 'CYLINDER_PREREGISTERED_NO_MODELS', registration }) + '\n',
  );
} else {
  const registration = evidence.preregistrations.at(-1);
  demand(
    matches(registration),
    'Frozen preregistration/source/fixture mismatch; no models created',
  );
  const sameSourceAttempts = evidence.attempts.filter(matches);
  const blocksRetry = (a) =>
    a.status === 'RUNNING' || (a.assessment && a.assessment.verdict !== 'PASS');
  demand(
    !sameSourceAttempts.some(blocksRetry),
    'Previous same-source invocation is incomplete or failed; controller diagnosis and a new reviewed registration required',
  );
  if (mode === 'main')
    demand(
      sameSourceAttempts.some(
        (a) =>
          a.mode === 'admission' &&
          a.operation === 'qualification' &&
          a.assessment?.verdict === 'PASS',
      ),
      'MAIN requires same-source admission PASS',
    );
  const previous = [...sameSourceAttempts]
    .reverse()
    .find(
      (a) => a.mode === mode && a.operation === 'qualification' && a.assessment?.verdict === 'PASS',
    );
  if (operation === 'explicit-replay')
    demand(previous, 'No matching successful recorded qualification to replay');
  else
    demand(
      !previous,
      'This exact source/fixture already has a qualification attempt; replay must be explicit',
    );
  const journalDir = resolve(
    directory ?? resolve(root, '../asa-lab-robotics-field-core-evidence/mujoco-cylinder-20261111'),
  );
  const normalizedRoot = resolve(root);
  demand(
    journalDir !== normalizedRoot && !journalDir.startsWith(normalizedRoot + sep),
    'Raw journal must be outside the Git checkout',
  );
  mkdirSync(journalDir, { recursive: true });
  const externalAttempts = readdirSync(journalDir)
    .filter((p) => p.endsWith('.receipt.json'))
    .map((p) => parse(readFileSync(resolve(journalDir, p), 'utf8')))
    .filter(matches);
  demand(
    !externalAttempts.some(blocksRetry),
    'External same-source RUNNING/FAIL/INDETERMINATE receipt blocks automatic retry; controller diagnosis required',
  );
  const unique = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const attemptId =
    'mujoco-cylinder-' +
    mode +
    (operation === 'qualification' ? '-a' + (evidence.attempts.length + 1) : '-replay-' + unique);
  const journalPath = resolve(journalDir, attemptId + '-' + unique + '.asacylraw');
  const receiptPath = resolve(journalDir, attemptId + '-' + unique + '.receipt.json');
  const attempt = {
    attemptId,
    mode,
    operation,
    status: 'RUNNING',
    startedAtUtc: new Date().toISOString(),
    gitHead,
    dirty,
    fixtureSha256,
    sourceManifest,
    registeredAtUtc: registration.registeredAtUtc,
    evidenceWritten: operation === 'qualification',
    beforeHashes: { sourceManifest, reports: reportHashes() },
    environment: {
      host: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu: os.cpus()[0]?.model ?? null,
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    journal: {
      localPath: journalPath,
      status: 'STARTED',
      archive: {
        status: 'NOT_ARCHIVED',
        required:
          'draft release asset with byte-exact download/hash verification before publication',
      },
    },
  };
  // Qualification writes the committed evidence. Review/CI replay is read-only
  // in Git: its external RUNNING/final receipt provides invocation accounting.
  if (operation === 'qualification') {
    evidence.attempts.push(attempt);
    saveEvidence();
  }
  writeFileSync(receiptPath, stringify(attempt), 'utf8');
  process.stdout.write(
    JSON.stringify({
      event: 'CYLINDER_FROZEN_BEFORE_MODELS',
      attemptId,
      mode,
      operation,
      registeredAtUtc: registration.registeredAtUtc,
      fixtureSha256,
      sourceManifest,
      budget: f.budgets[mode],
      journalPath,
    }) + '\n',
  );
  let journal = null;
  try {
    journal = new RawJournal(journalPath, f.retention);
    journal.append({
      kind: 'invocation',
      mode,
      fixtureSha256,
      sourceManifest,
      budget: f.budgets[mode],
    });
    journal.checkpoint();
    Object.assign(attempt, await executeCylinder(f, mode, journal));
  } catch (error) {
    attempt.assessment = { verdict: 'FAIL', failures: [String(error)] };
    attempt.unhandledBeforeExecutorOrJournal = true;
  } finally {
    if (journal) {
      const result = journal.finish({
        kind: 'invocation-end',
        mode,
        budget: attempt.budget ?? null,
        assessment: {
          verdict: attempt.assessment.verdict,
          failures: attempt.assessment.failures.map(portableError),
        },
        completeTrajectoryDigest: attempt.completeTrajectoryDigest ?? null,
      });
      Object.assign(attempt.journal, result, { status: 'CLOSED' });
      if (result.trailerError || result.closeError) {
        attempt.assessment.verdict = 'FAIL';
        attempt.assessment.failures.push('RAW_FINALIZATION ' + stringify(result));
      }
    }
  }
  if (existsSync(journalPath)) {
    try {
      const diskHash = createHash('sha256');
      let diskBytes = 0;
      for await (const chunk of createReadStream(journalPath)) {
        diskHash.update(chunk);
        diskBytes += chunk.length;
      }
      const actual = diskHash.digest('hex');
      if (attempt.journal.sha256 && attempt.journal.sha256 !== actual) {
        attempt.assessment.verdict = 'FAIL';
        attempt.assessment.failures.push('RAW_DISK_HASH_MISMATCH');
      }
      attempt.journal.diskBytes = diskBytes;
      attempt.journal.diskSha256 = actual;
    } catch (error) {
      attempt.assessment.verdict = 'FAIL';
      attempt.assessment.failures.push('RAW_DISK_READBACK ' + String(error));
    }
  }
  if (operation === 'explicit-replay') {
    const bitwiseEqual =
      attempt.assessment.verdict === 'PASS' &&
      attempt.completeTrajectoryDigest === previous.completeTrajectoryDigest &&
      attempt.journal.diskSha256 === previous.journal.diskSha256 &&
      canonicalEqual(attempt.budget, previous.budget);
    attempt.replay = {
      previousAttemptId: previous.attemptId,
      bitwiseEqual,
      numericalPhysicalGates: attempt.assessment.verdict,
      distinction:
        'Numerical acceptance is evaluated independently; exact byte replay is a separate, stronger identity check.',
    };
    if (!bitwiseEqual) {
      attempt.assessment.verdict = 'FAIL';
      attempt.assessment.failures.push('RECORDED_BITWISE_REPLAY_MISMATCH');
    }
  }
  try {
    attempt.afterHashes = {
      sourceManifest: cylinderSourceManifest(),
      reports: reportHashes(),
      reportsCapturedBeforeFinalQualificationSave: operation === 'qualification',
    };
    demand(
      canonicalEqual(attempt.beforeHashes.sourceManifest, attempt.afterHashes.sourceManifest),
      'SOURCE_CHANGED_DURING_INVOCATION',
    );
    if (operation === 'explicit-replay')
      demand(
        canonicalEqual(attempt.beforeHashes.reports, attempt.afterHashes.reports),
        'REPLAY_CHANGED_COMMITTED_REPORTS',
      );
  } catch (error) {
    attempt.assessment.verdict = 'FAIL';
    attempt.assessment.failures.push(String(error));
  }
  attempt.status = 'FINISHED';
  attempt.finishedAtUtc = new Date().toISOString();
  writeFileSync(receiptPath, stringify(attempt), 'utf8');
  if (operation === 'qualification') saveEvidence();
  process.stdout.write(
    JSON.stringify({
      event: 'CYLINDER_INVOCATION_COMPLETE',
      attemptId,
      mode,
      operation,
      evidenceWritten: operation === 'qualification',
      verdict: attempt.assessment.verdict,
      failures: attempt.assessment.failures,
      budget: attempt.budget ?? null,
      journal: attempt.journal,
      completeTrajectoryDigest: attempt.completeTrajectoryDigest ?? null,
      receiptPath,
    }) + '\n',
  );
  if (attempt.assessment.verdict !== 'PASS') process.exitCode = 1;
}
