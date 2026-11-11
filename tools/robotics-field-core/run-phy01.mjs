import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { executePhy01, readFixture, sha256, sourceManifest } from './phy01.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidencePath = fileURLToPath(
  new URL('../../docs/product/robotics/evidence/field-core-phy01-20261111.json', import.meta.url),
);
const args = process.argv.slice(2);
if (
  args.length > 1 ||
  (args.length === 1 && !['--write-evidence', '--verify-recorded'].includes(args[0]))
) {
  throw new Error(
    'Usage: node tools/robotics-field-core/run-phy01.mjs [--write-evidence|--verify-recorded]',
  );
}
const { fixture, fixtureSha256 } = readFixture();
const sourceSha256 = sourceManifest();
const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const startedAtUtc = new Date().toISOString();
process.stdout.write(
  JSON.stringify({ event: 'FIXTURE_BEFORE_DYNAMICS', startedAtUtc, gitHead, fixtureSha256 }) + '\n',
);
const report = {
  startedAtUtc,
  gitHead,
  fixtureSha256,
  sourceSha256,
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
try {
  Object.assign(report, await executePhy01(fixture));
} catch (error) {
  report.assessment = { verdict: 'FAIL', failures: [String(error)] };
}
report.finishedAtUtc = new Date().toISOString();
if (args[0] === '--write-evidence') {
  let evidence = {
    schemaVersion: 1,
    task: 'TASK-ELECTRONICS-ROBOTICS-FIELD-CORE-E1-001',
    test: 'PHY-01',
    acceptanceBoundary: 'isolated TEST_ONLY qualification; not E1 completion',
    attempts: [],
  };
  try {
    evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  evidence.attempts.push(report);
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
}
if (args[0] === '--verify-recorded') {
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const recorded = evidence.attempts.at(-1);
  const rawEqual = JSON.stringify(report.rawRuns) === JSON.stringify(recorded.rawRuns);
  const manifestEqual = JSON.stringify(sourceSha256) === JSON.stringify(recorded.sourceSha256);
  const fixtureEqual = fixtureSha256 === recorded.fixtureSha256;
  if (!rawEqual || !manifestEqual || !fixtureEqual) {
    report.assessment.verdict = 'FAIL';
    report.assessment.failures.push(
      'Recorded evidence differs from current inputs/source/raw engine measurements',
    );
  }
  process.stdout.write(
    JSON.stringify({ event: 'RECORDED_EVIDENCE', gitHead, rawEqual, manifestEqual, fixtureEqual }) +
      '\n',
  );
}
process.stdout.write(
  JSON.stringify({
    gitHead,
    fixtureSha256,
    verdict: report.assessment.verdict,
    summary: report.assessment.summary,
    failures: report.assessment.failures,
    rawSha256: report.rawRuns ? sha256(JSON.stringify(report.rawRuns)) : null,
    evidenceWritten: args[0] === '--write-evidence',
  }) + '\n',
);
if (report.assessment.verdict !== 'PASS') process.exitCode = 1;
