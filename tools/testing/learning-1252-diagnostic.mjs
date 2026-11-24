import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import process from 'node:process';
import console from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';
import {
  isolatedDatabase,
  startPostgresMonitor,
  probeLearnerOrigins,
  preparePlannerStatistics,
  statisticsSnapshot,
  readBrowserIdentities,
} from './learning-1252-pg-probe.mjs';

const source = path.resolve(process.env.SOURCE_ROOT ?? '.');
const directory = path.resolve(process.env.REPORT_DIR ?? 'reports/learning-1252-diagnostic');
const variant = process.env.DIAGNOSTIC_VARIANT;
const sha = process.env.SOURCE_SHA;
const databaseUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.APP_TEST_DATABASE_URL;
if (
  !['baseline', 'candidate'].includes(variant) ||
  !/^[a-f0-9]{40}$/.test(sha ?? '') ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.NODE_ENV !== 'test'
) {
  throw new Error('This bounded diagnostic runs only in isolated GitHub Actions test jobs');
}
if (isolatedDatabase(databaseUrl).pathname !== isolatedDatabase(appUrl).pathname) {
  throw new Error('Admin and restricted application database targets disagree');
}
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' });
if (head.status !== 0 || head.stdout.trim() !== sha) throw new Error('Exact source SHA mismatch');
fs.mkdirSync(directory, { recursive: true });
const specs = ['e2e/courses-sharing.spec.ts', 'e2e/learning-author-preview.spec.ts'];
const receipt = {
  task: 'TASK-LRN-500-CAUSE-001',
  variant,
  sourceSha: sha,
  fixture: 'Same prepared PostgreSQL database template for both variants',
  fixtureSource: {
    run: 44249101088,
    artifact: 14403373712,
    dumpSha256: '980b742a547fff40f485b5ae49effb5fe0cd2dbea7ae92ec4851669e1a933360',
  },
  hypothesis:
    'Planner statistics after original preparation change learner-origin plans/startup cost. Controlled ANALYZE tests this without changing SQL, timeouts or pool capacity.',
  priorDiagnostic:
    'Both 5ab and 4a completed all 13 scenarios with no HTTP500; 7252 nested plans had no JIT and on/off probes had matching payloads and timings.',
  runtime: {
    node: process.version,
    runnerOS: process.env.RUNNER_OS,
    runnerArch: process.env.RUNNER_ARCH,
    imageOS: process.env.ImageOS,
    imageVersion: process.env.ImageVersion,
  },
  originalRuntimeDifferences: [
    'Original unit completion preceded browser by about 193s of Scratch/Minio preparation; this iteration replaces speculative wait with explicit isolated ANALYZE.',
    'Scratch/Minio are not started for these two specs; this is a planner-statistics intervention, not a CPU-pressure reproduction.',
    'pg_dump restores the exact fixture data, not historical pg_statistic. Before/after statistics snapshots explicitly record the tested states.',
  ],
  originalRun: 44201046979,
  originalSha: 'd64a76664c3a5584d2f845b20ce675c39a555565',
  originalSpecOrder: specs,
  apiLifecycle:
    'One API per original spec-file invocation; all 11 author-preview cases share its process, matching tools/testing/learning-e1-browser.mjs',
  specDigests: {},
  phases: [],
  complete: false,
  productAcceptance: 'NOT_CLAIMED',
  deployment: 'NOT_RUN',
};
for (const spec of specs)
  receipt.specDigests[spec] = createHash('sha256')
    .update(fs.readFileSync(path.join(source, spec)))
    .digest('hex');
const writeReceipt = () =>
  fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
writeReceipt();
receipt.plannerIntervention = await preparePlannerStatistics(source, databaseUrl, directory);
writeReceipt();
const observedIdentities = new Map();

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), delay(10_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
    throw new Error('Isolated API required forced termination; cleanup was not graceful');
  }
}

async function command(args, env, log) {
  const stream = fs.createWriteStream(log);
  const child = spawn('pnpm', args, { cwd: source, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(stream, { end: false });
  child.stderr.pipe(stream, { end: false });
  const [code, signal] = await once(child, 'exit');
  await new Promise((resolve) => stream.end(resolve));
  return { code, signal };
}

for (const [index, spec] of specs.entries()) {
  const phaseDirectory = path.join(directory, `${index + 1}-${path.basename(spec, '.spec.ts')}`);
  fs.mkdirSync(phaseDirectory, { recursive: true });
  const env = {
    ...process.env,
    ASA_E2E_EXTERNAL: 'true',
    ASA_E2E_PORT: '4612',
    ASA_E2E_BASE_URL: 'http://127.0.0.1:4612',
    ASA_WEB_PORT: '4612',
    ASA_WEB_ORIGIN: 'http://127.0.0.1:4612',
    ASA_HTTP_LOG: '1',
    ASA_BUILD_REVISION: sha,
    ASA_BLOCKS_RUNTIME_ORIGIN: 'http://127.0.0.1:4612',
    ASA_BLOCKS_UPSTREAM_ORIGIN: 'http://127.0.0.1:4613',
    ASA_APPLICATION_LOG_STORE: path.join(phaseDirectory, 'application'),
    PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(phaseDirectory, 'playwright.json'),
  };
  const phase = { spec, startedAt: new Date().toISOString(), cleanup: 'pending' };
  receipt.phases.push(phase);
  writeReceipt();
  const stopMonitor = await startPostgresMonitor(source, databaseUrl, phaseDirectory);
  const log = fs.openSync(path.join(phaseDirectory, 'api.log'), 'w');
  const server = spawn(process.execPath, ['e2e/server.mjs'], {
    cwd: source,
    env,
    stdio: ['ignore', log, log],
  });
  phase.apiPid = server.pid;
  fs.closeSync(log);
  try {
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline && server.exitCode === null) {
      try {
        const response = await globalThis.fetch('http://127.0.0.1:4612/health/live', {
          signal: globalThis.AbortSignal.timeout(1000),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Wait only for the ordinary 30s E2E startup budget. */
      }
      await delay(100);
    }
    if (!ready) throw new Error('API failed to become healthy within original 30s budget');
    phase.browser = await command(
      [
        'exec',
        'playwright',
        'test',
        spec,
        '--workers=1',
        '--retries=0',
        '--trace=on',
        '--reporter=list,json',
        `--output=${path.join(phaseDirectory, 'results')}`,
      ],
      env,
      path.join(phaseDirectory, 'browser.log'),
    );
    const result = JSON.parse(
      fs.readFileSync(path.join(phaseDirectory, 'playwright.json'), 'utf8'),
    );
    phase.stats = result.stats;
    const expected = index === 0 ? 2 : 11;
    const actual = result.suites.flatMap((suite) => suite.specs ?? []);
    if (
      actual.length !== expected ||
      actual.some(
        (specification) =>
          specification.tests.length !== 1 ||
          specification.tests[0].results.length !== 1 ||
          specification.tests[0].results[0].retry !== 0,
      )
    ) {
      throw new Error('Original complete spec execution/retry identity changed');
    }
    phase.browserResult = phase.browser.code === 0 ? 'PASS' : 'FAIL_PRESERVED';
  } finally {
    try {
      await stop(server);
      phase.cleanup = 'API_STOPPED';
    } finally {
      phase.monitorSamples = await stopMonitor();
      writeReceipt();
    }
  }
  const identities = readBrowserIdentities(phaseDirectory);
  phase.browserIdentities = identities.identities;
  phase.targetRequestIdentityCount = identities.requests.length;
  for (const identity of identities.identities)
    observedIdentities.set(`${identity.kind}:${identity.id}`, identity);
  writeReceipt();
}
await statisticsSnapshot(source, databaseUrl, directory, 'after-browser');
for (const { identity } of receipt.plannerIntervention.after.probes)
  observedIdentities.set(`${identity.kind}:${identity.id}`, identity);
receipt.sqlProbe = await probeLearnerOrigins(source, databaseUrl, directory, {
  label: 'actual-browser-identities',
  identities: [...observedIdentities.values()],
});
receipt.complete = true;
writeReceipt();
console.log(
  JSON.stringify({
    variant,
    sourceSha: sha,
    diagnosticCollection: 'complete',
    browserResults: receipt.phases.map(({ spec, browserResult, stats }) => ({
      spec,
      browserResult,
      stats,
    })),
    productAcceptance: 'NOT_CLAIMED',
  }),
);
