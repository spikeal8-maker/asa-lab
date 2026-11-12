import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { isAbsolute, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
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
  executeCylinderGeometry,
  finalizeCylinderGeometry,
  decodeRetainedGeometryInput,
  geometryJournalRetention,
  createGeometryReport,
  acceptedCylinderGeometry,
  executeCylinderStage,
  finalizeCylinderDynamic,
  validateCylinderDynamicAuthorization,
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
async function runDynamicCylinderCli(args) {
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
        (a) =>
          a.mode === mode && a.operation === 'qualification' && a.assessment?.verdict === 'PASS',
      );
    if (operation === 'explicit-replay')
      demand(previous, 'No matching successful recorded qualification to replay');
    else
      demand(
        !previous,
        'This exact source/fixture already has a qualification attempt; replay must be explicit',
      );
    const journalDir = resolve(
      directory ??
        resolve(root, '../asa-lab-robotics-field-core-evidence/mujoco-cylinder-20261111'),
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
}

export function parseGeometryCli(args) {
  const keys = [
    '--input',
    '--preregistration',
    '--source-review',
    '--execution-go',
    '--journal-dir',
  ];
  demand(
    args.length === 11 && args[0] === '--geometry-only',
    'Usage: --geometry-only --input ABSOLUTE_PATH --preregistration ABSOLUTE_PATH ' +
      '--source-review ABSOLUTE_PATH --execution-go ABSOLUTE_PATH --journal-dir ABSOLUTE_EXTERNAL_PATH',
  );
  const result = {};
  for (let i = 1; i < args.length; i += 2) {
    demand(
      keys.includes(args[i]) &&
        !(args[i] in result) &&
        typeof args[i + 1] === 'string' &&
        isAbsolute(args[i + 1]),
      'GEOMETRY_EXPLICIT_CLI_PATH',
    );
    result[args[i]] = args[i + 1];
  }
  demand(
    keys.every((key) => key in result),
    'GEOMETRY_MISSING_CLI_PATH',
  );
  return result;
}

/** Pure approval validation; this creates no registration or execution authority. */
export function validateGeometryAuthorization(f, registration, review, go, actual) {
  demand(
    registration.schema === 'CYLINDER_G0_PREREGISTRATION_V1' &&
      registration.decision === 'ROOT_PREREGISTERED_AWAIT_SEPARATE_GO' &&
      registration.operation === f.geometryOnly.id &&
      registration.profile === f.candidateProfile.id &&
      registration.fixtureSha256 === actual.fixtureSha256 &&
      registration.sourceHead === actual.sourceHead &&
      canonicalEqual(registration.sourceManifest, actual.sourceManifest) &&
      canonicalEqual(registration.engineArtifacts, actual.engineArtifacts) &&
      canonicalEqual(registration.budget, f.geometryOnly) &&
      registration.input.path === actual.inputPath &&
      registration.input.sha256 === f.geometryOnly.inputSha256 &&
      registration.input.bytes === f.geometryOnly.inputBytes &&
      registration.outputDirectory === actual.outputDirectory,
    'GEOMETRY_PREREGISTRATION_BINDING',
  );
  demand(
    review.schema === 'CYLINDER_G0_SOURCE_REVIEW_V1' &&
      review.decision === 'NO_BLOCKING_SOURCE_FINDINGS' &&
      review.profile === f.candidateProfile.id &&
      review.fixtureSha256 === actual.fixtureSha256 &&
      canonicalEqual(review.sourceManifest, actual.sourceManifest) &&
      canonicalEqual(review.engineArtifacts, actual.engineArtifacts) &&
      review.inputSha256 === f.geometryOnly.inputSha256 &&
      registration.sourceReviewSha256 === actual.sourceReviewSha256,
    'GEOMETRY_INDEPENDENT_SOURCE_REVIEW_BINDING',
  );
  demand(
    go.schema === 'CYLINDER_G0_EXECUTION_GO_V1' &&
      go.decision === 'ROOT_EXECUTION_GO' &&
      go.operation === f.geometryOnly.id &&
      go.preregistrationSha256 === actual.preregistrationSha256 &&
      go.sourceReviewSha256 === actual.sourceReviewSha256 &&
      go.oneInvocation === true &&
      go.noRetry === true &&
      go.outputDirectory === actual.outputDirectory &&
      canonicalEqual(go.budget, f.geometryOnly) &&
      typeof go.invocationId === 'string' &&
      /^[a-zA-Z0-9_-]{1,80}$/.test(go.invocationId),
    'GEOMETRY_SEPARATE_EXECUTION_GO_REQUIRED',
  );
  return true;
}

function readGeometryDocument(path) {
  demand(
    statSync(path).isFile() && statSync(path).size <= 1048576,
    'GEOMETRY_APPROVAL_DOCUMENT_SIZE',
  );
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes.toString('utf8')), sha256: digest(bytes) };
}

async function runGeometryCli(args) {
  const paths = parseGeometryCli(args);
  const { fixture: f, fixtureSha256 } = readCylinderFixture();
  validateCylinderFixture(f);
  const inputPath = realpathSync(paths['--input']);
  demand(
    statSync(inputPath).isFile() && statSync(inputPath).size === f.geometryOnly.inputBytes,
    'GEOMETRY_INPUT_SIZE',
  );
  const inputBytes = readFileSync(inputPath);
  decodeRetainedGeometryInput(inputBytes, f.geometryOnly);
  const outputDirectory = realpathSync(paths['--journal-dir']);
  const realRoot = realpathSync(root);
  demand(
    statSync(outputDirectory).isDirectory() &&
      outputDirectory !== realRoot &&
      !outputDirectory.startsWith(realRoot + sep),
    'GEOMETRY_EXTERNAL_DIRECTORY_REQUIRED',
  );
  const registration = readGeometryDocument(paths['--preregistration']);
  const review = readGeometryDocument(paths['--source-review']);
  const go = readGeometryDocument(paths['--execution-go']);
  const artifact = verifyCylinderArtifacts(f);
  const engineArtifacts = Object.fromEntries(
    [
      ['mujoco.js', f.engine.moduleSha256],
      ['mujoco.wasm', f.engine.wasmSha256],
      ['mujoco.d.ts', f.engine.dtsSha256],
      ['package.json', f.engine.packageSha256],
    ].map(([name, expected]) => {
      const bytes = readFileSync(resolve(artifact.packageRoot, name));
      demand(digest(bytes) === expected, 'GEOMETRY_ENGINE_ARTIFACT_IDENTITY ' + name);
      return [name, { bytes: bytes.length, sha256: expected }];
    }),
  );
  const actual = {
    fixtureSha256,
    sourceManifest: cylinderSourceManifest(),
    engineArtifacts,
    inputPath,
    outputDirectory,
    preregistrationSha256: registration.sha256,
    sourceReviewSha256: review.sha256,
    sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    }).trim(),
  };
  validateGeometryAuthorization(f, registration.value, review.value, go.value, actual);
  // One fixed claim per approved directory prevents retries, even after a crash.
  const prefix = resolve(outputDirectory, 'cylinder-g0-native-invocation');
  const historicalReportsBefore = reportHashes();
  const claim = {
    schema: 'CYLINDER_G0_DISPATCH_CLAIM_V1',
    invocationId: go.value.invocationId,
    claimedAtUtc: new Date().toISOString(),
    executionGoSha256: go.sha256,
    ...actual,
    nativeImports: 0,
    factories: 0,
    models: 0,
    data: 0,
    positionCalls: 0,
    nativeAdvances: 0,
  };
  writeFileSync(prefix + '.claim.json', JSON.stringify(claim, null, 2) + '\n', { flag: 'wx' });
  let report = createGeometryReport(f);
  let journal = null;
  let thrown = null;
  try {
    journal = new RawJournal(prefix + '.asacylgeomraw', geometryJournalRetention(f));
    report = await executeCylinderGeometry(f, inputBytes, journal);
    report = finalizeCylinderGeometry(f, report, journal);
  } catch (error) {
    thrown = String(error);
    report.status = 'FAILED';
    report.assessment = {
      verdict: 'FAIL',
      failures: [...report.assessment.failures, portableError(error)],
    };
    report.finalizationError = thrown;
    if (journal && !journal.closed) {
      try {
        report.journal = journal.finish({
          kind: 'geometry-fatal',
          verdict: 'FAIL',
          counts: report.counts,
          error: portableError(error),
        });
      } catch (closeError) {
        report.journalCloseError = String(closeError);
      }
    }
  }
  const historicalReportsAfter = reportHashes();
  if (!canonicalEqual(historicalReportsBefore, historicalReportsAfter)) {
    report.status = 'FAILED';
    report.assessment = {
      verdict: 'FAIL',
      failures: [...report.assessment.failures, 'HISTORICAL_REPORT_BYTES_CHANGED'],
    };
  }
  const receipt = {
    schema: 'CYLINDER_G0_RECEIPT_V1',
    invocationId: go.value.invocationId,
    finishedAtUtc: new Date().toISOString(),
    executionGoSha256: go.sha256,
    preregistrationSha256: registration.sha256,
    sourceReviewSha256: review.sha256,
    historicalReportsBefore,
    historicalReportsAfter,
    report,
  };
  const text = JSON.stringify(receipt, null, 2) + '\n';
  demand(
    Buffer.byteLength(text, 'utf8') <= f.geometryOnly.maxSummaryBytes,
    'GEOMETRY_SUMMARY_BYTE_CAP',
  );
  writeFileSync(prefix + '.receipt.json', text, { flag: 'wx' });
  process.stdout.write(
    JSON.stringify({
      event: 'CYLINDER_GEOMETRY_STOP',
      receipt: prefix + '.receipt.json',
      verdict: report.assessment.verdict,
      counts: report.counts,
      nativeAdvances: 0,
      nextStage: 'STOP_FOR_INDEPENDENT_REVIEW',
    }) + '\n',
  );
  if (thrown || report.assessment.verdict !== f.geometryOnly.verdict) process.exitCode = 1;
  return report;
}

export function parseCylinderDynamicCli(args) {
  demand(
    args[0] === '--dynamic-stage' && ['ADMISSION', 'MAIN'].includes(args[1]),
    'DYNAMIC_EXPLICIT_STAGE_CLI',
  );
  const keys = [
    '--preregistration',
    '--source-review',
    '--supervisor-review',
    '--execution-go',
    '--journal-dir',
  ];
  if (args[1] === 'MAIN') keys.push('--admission-review');
  demand(args.length === 2 + 2 * keys.length, 'DYNAMIC_EXPLICIT_CLI_ARGUMENTS');
  const paths = {};
  for (let i = 2; i < args.length; i += 2) {
    demand(
      keys.includes(args[i]) &&
        !(args[i] in paths) &&
        typeof args[i + 1] === 'string' &&
        isAbsolute(args[i + 1]),
      'DYNAMIC_EXPLICIT_ABSOLUTE_PATH',
    );
    paths[args[i]] = args[i + 1];
  }
  demand(
    keys.every((key) => key in paths),
    'DYNAMIC_MISSING_CLI_PATH',
  );
  return { stage: args[1], paths };
}

function readDynamicDocument(path, cap = 1048576) {
  demand(
    isAbsolute(path) && statSync(path).isFile() && statSync(path).size <= cap,
    'DYNAMIC_DOCUMENT_BYTE_CAP',
  );
  const bytes = readFileSync(path);
  demand(bytes.length <= cap, 'DYNAMIC_DOCUMENT_BYTE_CAP');
  return {
    value: JSON.parse(bytes.toString('utf8')),
    bytes: bytes.length,
    sha256: digest(bytes),
    path: realpathSync(path),
  };
}

async function bindDynamicFile(descriptor, cap) {
  demand(
    descriptor &&
      isAbsolute(descriptor.path) &&
      Number.isSafeInteger(descriptor.bytes) &&
      descriptor.bytes > 0 &&
      descriptor.bytes <= cap &&
      /^[a-f0-9]{64}$/.test(descriptor.sha256) &&
      statSync(descriptor.path).isFile() &&
      statSync(descriptor.path).size === descriptor.bytes,
    'DYNAMIC_BOUND_FILE_SIZE',
  );
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(descriptor.path)) {
    bytes += chunk.length;
    demand(bytes <= descriptor.bytes, 'DYNAMIC_BOUND_FILE_GREW');
    hash.update(chunk);
  }
  demand(
    bytes === descriptor.bytes && hash.digest('hex') === descriptor.sha256,
    'DYNAMIC_BOUND_FILE_BYTES',
  );
  return { path: realpathSync(descriptor.path), bytes, sha256: descriptor.sha256 };
}

/** Only a compact FAIL may replace an oversized summary. Raw bytes stay intact. */
export function encodeCylinderDynamicReceipt(f, receipt) {
  let text = JSON.stringify(receipt, null, 2) + '\n';
  if (Buffer.byteLength(text, 'utf8') > f.retention.maxCommittedSummaryBytes) {
    const report = receipt.report;
    receipt = {
      ...receipt,
      report: {
        assessment: { verdict: 'FAIL', failures: ['RESOURCE_DYNAMIC_SUMMARY_BYTE_CAP'] },
        budget: report.budget,
        nativeLedger: report.nativeLedger,
        journal: report.journal,
        worldDisposition: report.worldDisposition,
        oversizedSummary: {
          bytes: Buffer.byteLength(text, 'utf8'),
          sha256: digest(Buffer.from(text, 'utf8')),
        },
        prefixPolicy: 'Raw bounded failure prefix retained; oversized summary cannot become PASS',
      },
    };
    text = JSON.stringify(receipt, null, 2) + '\n';
  }
  demand(
    Buffer.byteLength(text, 'utf8') <= f.retention.maxCommittedSummaryBytes,
    'DYNAMIC_FAILURE_SUMMARY_BYTE_CAP',
  );
  return { text, receipt };
}

async function runBoundCylinderDynamicCli(args) {
  const { stage, paths } = parseCylinderDynamicCli(args);
  const { fixture: f, fixtureSha256 } = readCylinderFixture();
  validateCylinderFixture(f);
  const outputDirectory = realpathSync(paths['--journal-dir']);
  const realRoot = realpathSync(root);
  const pathKey = (path) => (process.platform === 'win32' ? path.toLowerCase() : path);
  demand(
    statSync(outputDirectory).isDirectory() &&
      pathKey(outputDirectory) !== pathKey(realRoot) &&
      !pathKey(outputDirectory).startsWith(pathKey(realRoot) + sep) &&
      readdirSync(outputDirectory).length === 0,
    'DYNAMIC_NEW_EMPTY_EXTERNAL_DIRECTORY_REQUIRED',
  );
  const prefix = resolve(outputDirectory, 'cylinder-' + stage.toLowerCase() + '-native-invocation');
  const outputs = {
    claim: prefix + '.claim.json',
    raw: prefix + '.asacylraw',
    receipt: prefix + '.receipt.json',
  };
  const registration = readDynamicDocument(paths['--preregistration']);
  const review = readDynamicDocument(paths['--source-review']);
  const supervision = readDynamicDocument(paths['--supervisor-review']);
  const go = readDynamicDocument(paths['--execution-go']);
  const geometry = acceptedCylinderGeometry();
  const geometryFiles = registration.value.geometryFiles;
  demand(geometryFiles && Object.keys(geometryFiles).length === 4, 'DYNAMIC_G0_EVIDENCE_FILES');
  for (const key of ['raw', 'review', 'binding', 'completion']) {
    demand(
      geometryFiles[key]?.bytes === geometry[key].bytes &&
        geometryFiles[key]?.sha256 === geometry[key].sha256,
      'DYNAMIC_G0_ACCEPTED_EVIDENCE_PIN ' + key,
    );
    await bindDynamicFile(geometryFiles[key], geometry[key].bytes);
  }
  const artifact = verifyCylinderArtifacts(f);
  const engineArtifacts = Object.fromEntries(
    [
      ['mujoco.js', f.engine.moduleSha256],
      ['mujoco.wasm', f.engine.wasmSha256],
      ['mujoco.d.ts', f.engine.dtsSha256],
      ['package.json', f.engine.packageSha256],
    ].map(([name, expected]) => {
      const bytes = readFileSync(resolve(artifact.packageRoot, name));
      demand(digest(bytes) === expected, 'DYNAMIC_ENGINE_ARTIFACT_IDENTITY ' + name);
      return [name, { bytes: bytes.length, sha256: expected }];
    }),
  );
  const git = (args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' },
    }).trim();
  demand(
    git(['status', '--porcelain=v1', '--untracked-files=all']) === '',
    'DYNAMIC_REVIEWED_CLEAN_SOURCE_REQUIRED',
  );
  const actual = {
    fixtureSha256,
    sourceManifest: cylinderSourceManifest(),
    sourceHead: git(['rev-parse', 'HEAD']),
    engineArtifacts,
    geometry,
    outputDirectory,
    outputs,
    preregistrationSha256: registration.sha256,
    sourceReviewSha256: review.sha256,
    supervisorReviewSha256: supervision.sha256,
    executionGoSha256: go.sha256,
    supervisorHelper: await bindDynamicFile(supervision.value.helper, 1048576),
    admissionReviewSha256: null,
  };
  let admission = null;
  if (stage === 'MAIN') {
    const document = readDynamicDocument(paths['--admission-review']);
    admission = document.value;
    actual.admissionReviewSha256 = document.sha256;
    actual.admissionRaw = await bindDynamicFile(admission.raw, f.retention.maxJournalBytes);
    actual.admissionReceipt = await bindDynamicFile(
      admission.receipt,
      f.retention.maxCommittedSummaryBytes,
    );
    const receipt = readDynamicDocument(
      admission.receipt.path,
      f.retention.maxCommittedSummaryBytes,
    );
    demand(receipt.sha256 === actual.admissionReceipt.sha256, 'DYNAMIC_ADMISSION_RECEIPT_READBACK');
    actual.admissionReceiptValue = receipt.value;
  }
  const permit = validateCylinderDynamicAuthorization(
    f,
    stage,
    registration.value,
    review.value,
    supervision.value,
    go.value,
    actual,
    admission,
  );
  const historicalReportsBefore = reportHashes();
  // A fixed exclusive claim prevents a retry after a partial/fatal invocation.
  writeFileSync(
    outputs.claim,
    JSON.stringify(
      {
        schema: 'CYLINDER_DYNAMIC_DISPATCH_CLAIM_V1',
        stage,
        invocationId: go.value.invocationId,
        claimedAtUtc: new Date().toISOString(),
        executionGoSha256: go.sha256,
        sourceHead: actual.sourceHead,
        sourceManifest: actual.sourceManifest,
        preregistrationSha256: registration.sha256,
        outputs,
        status: 'CLAIMED_BEFORE_ENGINE_IMPORT',
        nextStage: 'NONE',
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  let journal = null;
  let report = { assessment: { verdict: 'FAIL', failures: [] } };
  try {
    journal = new RawJournal(outputs.raw, f.retention);
    report = await executeCylinderStage(f, stage, journal, permit);
    report = finalizeCylinderDynamic(f, report, journal);
    const raw = await bindDynamicFile(
      { path: outputs.raw, ...report.journal },
      f.retention.maxJournalBytes,
    );
    demand(raw.sha256 === report.journal.sha256, 'DYNAMIC_RAW_READBACK');
  } catch (error) {
    report.assessment.verdict = 'FAIL';
    report.assessment.failures.push(portableError(error));
    if (journal && !journal.closed) {
      try {
        report = finalizeCylinderDynamic(f, report, journal);
      } catch (closeError) {
        report.finalizationError = portableError(closeError);
      }
    }
  }
  let historicalReportsAfter = null;
  try {
    historicalReportsAfter = reportHashes();
    demand(
      canonicalEqual(historicalReportsBefore, historicalReportsAfter),
      'HISTORICAL_REPORT_BYTES_CHANGED',
    );
    demand(
      canonicalEqual(actual.sourceManifest, cylinderSourceManifest()),
      'DYNAMIC_SOURCE_CHANGED_DURING_INVOCATION',
    );
  } catch (error) {
    report.assessment.verdict = 'FAIL';
    report.assessment.failures.push(portableError(error));
  }
  const encoded = encodeCylinderDynamicReceipt(f, {
    schema: 'CYLINDER_DYNAMIC_RECEIPT_V1',
    stage,
    invocationId: go.value.invocationId,
    sourceHead: actual.sourceHead,
    sourceManifest: actual.sourceManifest,
    finishedAtUtc: new Date().toISOString(),
    executionGoSha256: go.sha256,
    preregistrationSha256: registration.sha256,
    sourceReviewSha256: review.sha256,
    supervisorReviewSha256: supervision.sha256,
    admissionReviewSha256: actual.admissionReviewSha256,
    geometry,
    historicalReportsBefore,
    historicalReportsAfter,
    report,
    nextStage: 'STOP_FOR_INDEPENDENT_RESULT_REVIEW',
  });
  writeFileSync(outputs.receipt, encoded.text, { flag: 'wx' });
  demand(readFileSync(outputs.receipt, 'utf8') === encoded.text, 'DYNAMIC_RECEIPT_READBACK');
  process.stdout.write(
    JSON.stringify({
      event: 'CYLINDER_DYNAMIC_STOP',
      stage,
      receipt: outputs.receipt,
      verdict: encoded.receipt.report.assessment.verdict,
      nextStage: 'STOP_FOR_INDEPENDENT_RESULT_REVIEW',
    }) + '\n',
  );
  if (encoded.receipt.report.assessment.verdict !== 'PASS') process.exitCode = 1;
  return encoded.receipt.report;
}

export async function runCylinderCli(args) {
  if (args[0] === '--dynamic-stage') return runBoundCylinderDynamicCli(args);
  if (args[0] === '--geometry-only') return runGeometryCli(args);
  const { fixture } = readCylinderFixture();
  demand(
    fixture.candidateProfile?.id !== 'LEGACY_CCD_MULTI5',
    'LEGACY_CANDIDATE_DYNAMIC_MODES_REQUIRE_SEPARATE_ROOT_PATH_AND_STAGE_PLAN',
  );
  return runDynamicCylinderCli(args);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runCylinderCli(process.argv.slice(2));
}
