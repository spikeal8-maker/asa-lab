import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import {
  executePhy01,
  readFixture,
  sha256,
  sourceManifest,
  verifyEngineArtifacts,
} from './mujoco-phy01.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidencePath = fileURLToPath(
  new URL(
    '../../docs/product/robotics/evidence/field-core-mujoco-phy01-20261111.json',
    import.meta.url,
  ),
);
const args = process.argv.slice(2);
if (
  args.length !== 1 ||
  !['--preregister', '--write-evidence', '--verify-recorded'].includes(args[0])
)
  throw new Error(
    'Usage: node tools/robotics-field-core/run-mujoco-phy01.mjs --preregister|--write-evidence|--verify-recorded',
  );
const stringify = (v) =>
  JSON.stringify(
    v,
    (_k, value) =>
      typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))
        ? { $float64: Object.is(value, -0) ? '-0' : String(value) }
        : value,
    2,
  ) + '\n';
const parse = (s) =>
  JSON.parse(s, (_k, value) =>
    value &&
    typeof value === 'object' &&
    Object.keys(value).length === 1 &&
    typeof value.$float64 === 'string'
      ? { '-0': -0, NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity }[value.$float64]
      : value,
  );
const { fixture, fixtureSha256 } = readFixture();
const sources = sourceManifest();
const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const gitDirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);
const artifact = verifyEngineArtifacts(fixture);
const evidence = existsSync(evidencePath)
  ? parse(readFileSync(evidencePath, 'utf8'))
  : {
      schemaVersion: 1,
      task: 'TASK-ELECTRONICS-ROBOTICS-FIELD-CORE-E1-001',
      test: 'PHY-01-MUJOCO',
      acceptanceBoundary: 'TEST_ONLY contact-free MuJoCo qualification; not E1/D01 completion',
      floatEncoding:
        'IEEE754-LE native state hex and per-step digests; JSON tagged signed-zero/non-finite numbers',
      preregistrations: [],
      attempts: [],
    };
if (args[0] === '--preregister') {
  const previous = evidence.preregistrations.at(-1);
  if (
    previous &&
    previous.fixtureSha256 === fixtureSha256 &&
    JSON.stringify(previous.sourceSha256) === JSON.stringify(sources)
  )
    throw new Error('This exact fixture/source snapshot is already preregistered');
  const preregistration = {
    registeredAtUtc: new Date().toISOString(),
    gitHead,
    sourceIdentity: gitDirty.length ? 'base_commit_plus_dirty_source_snapshot' : 'exact_commit',
    gitDirty,
    fixtureSha256,
    sourceSha256: sources,
    inputs: fixture,
    admission: {
      manifestSha256: artifact.manifestSha256,
      package: artifact.package,
      version: artifact.version,
      wasmSha256: artifact.wasmSha256,
      moduleSha256: artifact.moduleSha256,
      companionNoticesSha256: artifact.companionNoticesSha256,
      artifactHashes: 'PASS',
      physics: 'NOT_RUN',
    },
    modelCreations: 0,
    dataCreations: 0,
    nativeSteps: 0,
  };
  evidence.preregistrations.push(preregistration);
  writeFileSync(evidencePath, stringify(evidence));
  process.stdout.write(
    JSON.stringify({ event: 'PREREGISTERED_WITHOUT_DYNAMICS', ...preregistration }) + '\n',
  );
} else {
  const registration = evidence.preregistrations.at(-1);
  if (
    !registration ||
    registration.fixtureSha256 !== fixtureSha256 ||
    JSON.stringify(registration.sourceSha256) !== JSON.stringify(sources)
  )
    throw new Error(
      'Current fixture/source does not match the frozen preregistration; no dynamics executed',
    );
  const report = {
    attemptId: 'mujoco-phy01-a' + (evidence.attempts.length + 1),
    startedAtUtc: new Date().toISOString(),
    gitHead,
    sourceIdentity: gitDirty.length ? 'base_commit_plus_dirty_source_snapshot' : 'exact_commit',
    fixtureSha256,
    sourceSha256: sources,
    inputs: fixture,
    environment: {
      host: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
  };
  process.stdout.write(
    JSON.stringify({
      event: 'FIXTURE_BEFORE_DYNAMICS',
      attemptId: report.attemptId,
      gitHead,
      fixtureSha256,
      sourceSha256: sources,
      registeredAtUtc: registration.registeredAtUtc,
    }) + '\n',
  );
  try {
    Object.assign(report, await executePhy01(fixture));
  } catch (error) {
    report.assessment = { verdict: 'FAIL', failures: [String(error)] };
  }
  report.finishedAtUtc = new Date().toISOString();
  report.rawSha256 = report.rawRuns ? sha256(stringify(report.rawRuns)) : null;
  if (args[0] === '--write-evidence') {
    evidence.attempts.push(report);
    writeFileSync(evidencePath, stringify(evidence));
  } else {
    const previous = evidence.attempts.at(-1);
    const rawEqual = previous && stringify(report.rawRuns) === stringify(previous.rawRuns);
    const manifestEqual =
      previous && JSON.stringify(sources) === JSON.stringify(previous.sourceSha256);
    const fixtureEqual = previous && fixtureSha256 === previous.fixtureSha256;
    const budgetEqual =
      previous && JSON.stringify(report.budget) === JSON.stringify(previous.budget);
    if (
      !rawEqual ||
      !manifestEqual ||
      !fixtureEqual ||
      !budgetEqual ||
      previous.assessment.verdict !== 'PASS'
    ) {
      report.assessment.verdict = 'FAIL';
      report.assessment.failures.push(
        'Recorded source/fixture/native observations or budget differ',
      );
    }
    process.stdout.write(
      JSON.stringify({
        event: 'RECORDED_EVIDENCE',
        rawEqual,
        manifestEqual,
        fixtureEqual,
        budgetEqual,
      }) + '\n',
    );
  }
  process.stdout.write(
    JSON.stringify({
      attemptId: report.attemptId,
      verdict: report.assessment.verdict,
      summary: report.assessment.summary,
      failures: report.assessment.failures,
      budget: report.budget,
      rawSha256: report.rawSha256,
      evidenceWritten: args[0] === '--write-evidence',
    }) + '\n',
  );
  if (report.assessment.verdict !== 'PASS') process.exitCode = 1;
}
