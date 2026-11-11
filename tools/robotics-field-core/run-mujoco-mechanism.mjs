import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { isAbsolute, resolve, sep } from 'node:path';
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
  readMechanismFixture,
  validateMechanismFixture,
  verifyMechanismArtifacts,
  mechanismSourceManifest,
  mechanismPlan,
  executeMechanism,
} from './mujoco-mechanism.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const reportPath = resolve(
  root,
  'docs/product/robotics/evidence/field-core-mujoco-mechanism-20261111.json',
);
const markdownPath = resolve(
  root,
  'docs/product/robotics/evidence/field-core-mujoco-mechanism-20261111.md',
);
export const mechanismUsage =
  'node tools/robotics-field-core/run-mujoco-mechanism.mjs --help | --plan | --preregister | ' +
  '--main --write-evidence|--verify-recorded --journal-dir ABSOLUTE_EXTERNAL_DIRECTORY';

export function parseMechanismArgs(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) return { kind: 'help' };
  if (args.length === 1 && args[0] === '--plan') return { kind: 'plan' };
  if (args.length === 1 && args[0] === '--preregister') return { kind: 'preregister' };
  demand(
    args.length === 4 &&
      args[0] === '--main' &&
      ['--write-evidence', '--verify-recorded'].includes(args[1]) &&
      args[2] === '--journal-dir' &&
      args[3].length > 0 &&
      !args[3].startsWith('--'),
    'MECHANISM_EXPLICIT_CLI_REQUIRED ' + mechanismUsage,
  );
  return {
    kind: args[1] === '--write-evidence' ? 'qualification' : 'explicit-replay',
    mode: 'main',
    journalDirectory: args[3],
  };
}
export function evidenceStringify(value) {
  return (
    JSON.stringify(
      value,
      (_key, v) =>
        typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0))
          ? { $float64: Object.is(v, -0) ? '-0' : String(v) }
          : v,
      2,
    ) + '\n'
  );
}
export function evidenceParse(text) {
  return JSON.parse(text, (_key, v) => {
    if (
      !v ||
      typeof v !== 'object' ||
      Object.keys(v).length !== 1 ||
      typeof v.$float64 !== 'string'
    )
      return v;
    demand(
      ['-0', 'NaN', 'Infinity', '-Infinity'].includes(v.$float64),
      'INVALID_FLOAT64_EVIDENCE_TAG',
    );
    return { '-0': -0, NaN, Infinity, '-Infinity': -Infinity }[v.$float64];
  });
}
export function sourceMatches(snapshot, fixtureSha256, sourceManifest) {
  return Boolean(
    snapshot &&
    snapshot.fixtureSha256 === fixtureSha256 &&
    canonicalEqual(snapshot.sourceManifest, sourceManifest),
  );
}
const blocksRetry = (attempt) =>
  attempt.status !== 'FINISHED' || attempt.assessment?.verdict !== 'PASS';
export function assertMechanismRunAllowed(evidence, fixtureSha256, sourceManifest, operation) {
  demand(
    ['qualification', 'explicit-replay'].includes(operation),
    'UNREGISTERED_MECHANISM_OPERATION',
  );
  const registration = evidence.preregistrations.at(-1);
  demand(
    sourceMatches(registration, fixtureSha256, sourceManifest),
    'MECHANISM_FROZEN_SOURCE_MISMATCH_NO_MODELS',
  );
  const attempts = evidence.attempts.filter((a) => sourceMatches(a, fixtureSha256, sourceManifest));
  demand(
    !attempts.some(blocksRetry),
    'MECHANISM_PRIOR_INCOMPLETE_OR_FAILED_ATTEMPT_CONTROLLER_REVIEW_REQUIRED',
  );
  const previous = [...attempts]
    .reverse()
    .find((a) => a.operation === 'qualification' && a.assessment?.verdict === 'PASS');
  if (operation === 'explicit-replay')
    demand(previous, 'MECHANISM_NO_SUCCESSFUL_RECORDED_QUALIFICATION');
  else demand(!previous, 'MECHANISM_QUALIFICATION_ALREADY_RECORDED_REPLAY_MUST_BE_EXPLICIT');
  return { registration, previous };
}
function persist(path, value, flags = 'w') {
  const fd = openSync(path, flags);
  try {
    writeFileSync(fd, evidenceStringify(value), 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Import/default/help/plan are inert with respect to native modules, models and steps. */
export async function runMechanismCli(
  args = process.argv.slice(2),
  write = (s) => process.stdout.write(s),
) {
  const request = parseMechanismArgs(args);
  if (request.kind === 'help') {
    write(mechanismUsage + '\n');
    return 0;
  }
  const { fixture: f, fixtureSha256 } = readMechanismFixture();
  validateMechanismFixture(f);
  const plan = mechanismPlan(f);
  if (request.kind === 'plan') {
    write(
      evidenceStringify({
        event: 'MECHANISM_PLAN_ONLY',
        fixtureSha256,
        plan,
        budget: f.budget,
        moduleInitializations: 0,
        modelCreations: 0,
        dataCreations: 0,
        nativeAdvances: 0,
        physics: 'NOT_RUN',
        preregistered: false,
      }),
    );
    return 0;
  }
  const sourceManifest = mechanismSourceManifest();
  const git = (args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    }).trim();
  git(['merge-base', '--is-ancestor', f.parent.baseCommit, 'HEAD']);
  const gitHead = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean);
  demand(existsSync(reportPath) && existsSync(markdownPath), 'MECHANISM_PRE_DATA_REPORT_MISSING');
  const evidence = evidenceParse(readFileSync(reportPath, 'utf8'));
  demand(
    evidence.task === f.task &&
      evidence.test === f.id &&
      evidence.scope === 'TEST_ONLY' &&
      Array.isArray(evidence.preregistrations) &&
      Array.isArray(evidence.attempts),
    'MECHANISM_EVIDENCE_SCHEMA',
  );
  const saveEvidence = () => {
    demand(
      Buffer.byteLength(evidenceStringify(evidence), 'utf8') <=
        f.retention.maxCommittedSummaryBytes,
      'RESOURCE_COMMITTED_SUMMARY_BYTE_CAP',
    );
    persist(reportPath, evidence);
  };
  const reportHashes = () => ({
    json: digest(readFileSync(reportPath)),
    markdown: digest(readFileSync(markdownPath)),
  });
  if (request.kind === 'preregister') {
    demand(
      !sourceMatches(evidence.preregistrations.at(-1), fixtureSha256, sourceManifest),
      'MECHANISM_SOURCE_ALREADY_PREREGISTERED',
    );
    const artifact = verifyMechanismArtifacts(f); // Byte verification only; no native initialization.
    const registration = {
      registeredAtUtc: new Date().toISOString(),
      gitHead,
      sourceIdentity: dirty.length ? 'base_commit_plus_dirty_source_snapshot' : 'exact_commit',
      dirty,
      fixtureSha256,
      sourceManifest,
      inputs: f,
      plan,
      budget: f.budget,
      artifact: {
        package: artifact.package,
        version: artifact.version,
        manifestSha256: artifact.manifestSha256,
        wasmSha256: artifact.wasmSha256,
        moduleSha256: artifact.moduleSha256,
        companionNoticesSha256: artifact.companionNoticesSha256,
        byteVerification: 'PASS',
        physics: 'NOT_RUN',
      },
      moduleInitializations: 0,
      modelCreations: 0,
      dataCreations: 0,
      nativeAdvances: 0,
      controllerGate:
        'Await separate MAIN GO on this frozen source. No admission/probe worlds are allocated.',
    };
    evidence.preregistrations.push(registration);
    saveEvidence();
    write(evidenceStringify({ event: 'MECHANISM_PREREGISTERED_NO_MODELS', registration }));
    return 0;
  }
  const { registration, previous } = assertMechanismRunAllowed(
    evidence,
    fixtureSha256,
    sourceManifest,
    request.kind,
  );
  demand(isAbsolute(request.journalDirectory), 'MECHANISM_JOURNAL_DIRECTORY_MUST_BE_ABSOLUTE');
  const requestedDirectory = resolve(request.journalDirectory);
  const actualRoot = realpathSync(root);
  const inCheckout = (path) => {
    const normalize = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
    return (
      normalize(path) === normalize(actualRoot) ||
      normalize(path).startsWith(normalize(actualRoot + sep))
    );
  };
  demand(!inCheckout(requestedDirectory), 'RAW_JOURNAL_MUST_BE_OUTSIDE_CHECKOUT');
  mkdirSync(requestedDirectory, { recursive: true });
  const journalDirectory = realpathSync(requestedDirectory);
  demand(!inCheckout(journalDirectory), 'RAW_JOURNAL_REPARSE_INSIDE_CHECKOUT');
  const externalAttempts = readdirSync(journalDirectory)
    .filter((p) => p.endsWith('.receipt.json'))
    .map((p) => evidenceParse(readFileSync(resolve(journalDirectory, p), 'utf8')))
    .filter((a) => sourceMatches(a, fixtureSha256, sourceManifest));
  demand(!externalAttempts.some(blocksRetry), 'EXTERNAL_MECHANISM_ATTEMPT_BLOCKS_AUTOMATIC_RETRY');
  const unique = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const attemptId = 'mujoco-mechanism-' + request.kind + '-' + unique;
  const journalPath = resolve(journalDirectory, attemptId + '.asamechraw');
  const receiptPath = resolve(journalDirectory, attemptId + '.receipt.json');
  const attempt = {
    attemptId,
    mode: 'main',
    operation: request.kind,
    status: 'RUNNING',
    startedAtUtc: new Date().toISOString(),
    gitHead,
    dirty,
    fixtureSha256,
    sourceManifest,
    registeredAtUtc: registration.registeredAtUtc,
    evidenceWritten: request.kind === 'qualification',
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
        required: 'controller-managed verified archive before publication',
      },
    },
  };
  persist(receiptPath, attempt, 'wx');
  if (request.kind === 'qualification') {
    evidence.attempts.push(attempt);
    saveEvidence();
  }
  write(
    evidenceStringify({
      event: 'MECHANISM_FROZEN_BEFORE_MODELS',
      attemptId,
      fixtureSha256,
      sourceManifest,
      budget: f.budget,
      journalPath,
      receiptPath,
    }),
  );
  let journal = null;
  try {
    journal = new RawJournal(journalPath, f.retention);
    journal.append({
      kind: 'invocation',
      mode: 'main',
      fixtureSha256,
      sourceManifest,
      budget: f.budget,
    });
    journal.checkpoint();
    Object.assign(attempt, await executeMechanism(f, journal));
  } catch (error) {
    attempt.assessment = { verdict: 'FAIL', failures: [String(error)] };
    attempt.unhandledBeforeExecutorOrJournal = true;
  } finally {
    attempt.assessment ??= { verdict: 'FAIL', failures: ['INCOMPLETE_EXECUTOR_RESULT'] };
    if (journal) {
      const final = journal.finish({
        kind: 'invocation-end',
        budget: attempt.budget ?? null,
        assessment: {
          verdict: attempt.assessment.verdict,
          failures: attempt.assessment.failures.map(portableError),
        },
        completeTrajectoryDigest: attempt.completeTrajectoryDigest ?? null,
      });
      Object.assign(attempt.journal, final, { status: 'CLOSED' });
      if (final.trailerError || final.closeError) {
        attempt.assessment.verdict = 'FAIL';
        attempt.assessment.failures.push('RAW_FINALIZATION ' + evidenceStringify(final));
      }
    }
  }
  if (existsSync(journalPath)) {
    try {
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of createReadStream(journalPath)) {
        hash.update(chunk);
        bytes += chunk.length;
      }
      const actual = hash.digest('hex');
      demand(
        !attempt.journal.sha256 || attempt.journal.sha256 === actual,
        'RAW_DISK_HASH_MISMATCH',
      );
      attempt.journal.diskSha256 = actual;
      attempt.journal.diskBytes = bytes;
    } catch (error) {
      attempt.assessment.verdict = 'FAIL';
      attempt.assessment.failures.push(String(error));
    }
  }
  if (request.kind === 'explicit-replay') {
    const bitwiseEqual =
      attempt.assessment.verdict === 'PASS' &&
      attempt.completeTrajectoryDigest === previous.completeTrajectoryDigest &&
      attempt.journal.diskSha256 === previous.journal.diskSha256 &&
      canonicalEqual(attempt.budget, previous.budget);
    attempt.replay = {
      previousAttemptId: previous.attemptId,
      bitwiseEqual,
      numericalPhysicalGates: attempt.assessment.verdict,
      distinction: 'Physical gates and exact byte replay are independent checks.',
    };
    if (!bitwiseEqual) {
      attempt.assessment.verdict = 'FAIL';
      attempt.assessment.failures.push('RECORDED_BITWISE_REPLAY_MISMATCH');
    }
  }
  try {
    attempt.afterHashes = {
      sourceManifest: mechanismSourceManifest(),
      reports: reportHashes(),
      reportsCapturedBeforeFinalQualificationSave: request.kind === 'qualification',
    };
    demand(
      canonicalEqual(sourceManifest, attempt.afterHashes.sourceManifest),
      'SOURCE_CHANGED_DURING_INVOCATION',
    );
    if (request.kind === 'explicit-replay')
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
  persist(receiptPath, attempt);
  if (request.kind === 'qualification') saveEvidence();
  write(
    evidenceStringify({
      event: 'MECHANISM_INVOCATION_COMPLETE',
      attemptId,
      verdict: attempt.assessment.verdict,
      failures: attempt.assessment.failures,
      budget: attempt.budget ?? null,
      journal: attempt.journal,
      completeTrajectoryDigest: attempt.completeTrajectoryDigest ?? null,
      receiptPath,
    }),
  );
  return attempt.assessment.verdict === 'PASS' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMechanismCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(String(error) + '\n');
      process.exitCode = 1;
    });
}
