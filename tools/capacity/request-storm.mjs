import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { assertStormEnvironment, STORM_BASELINE } from './request-storm-contracts.mjs';

const mode = process.argv[2] || 'unit';
const unitPaths = [
  'tests/capacity/request-storm.spec.ts',
  'apps/web/src/portal-requests.spec.ts',
  'apps/web/src/session-fetch.spec.ts',
  'apps/web/src/auth-request.spec.ts',
  'apps/web/src/api-workspace-telemetry.spec.ts',
  'apps/web/src/App-session-check.spec.ts',
  'apps/web/src/games/game-notification-coordinator.spec.ts',
  'apps/web/src/games/game-notification-tabs.spec.ts',
  'apps/web/src/games/game-notifications.spec.ts',
  'apps/web/src/chess/testing/live-poll.spec.ts',
  'apps/web/src/client-diagnostics.spec.ts',
  'apps/web/src/client-diagnostic-outbox.spec.ts',
  'apps/web/src/diagnostic-quality.spec.ts',
  'apps/web/src/telemetry-quality.spec.ts',
  'apps/web/src/telemetry-contract.spec.ts',
  'apps/web/src/analytics-delivery.spec.ts',
  'apps/web/src/analytics-runtime.spec.ts',
  'apps/web/src/analytics-auth-recovery.spec.ts',
  'apps/api/src/client-diagnostics.controller.spec.ts',
  'apps/api/src/application-log-store.spec.ts',
  'apps/api/src/analytics-request-isolation.spec.ts',
];

if (mode === 'browser') {
  if (process.env.ASA_E2E_EXTERNAL !== 'true' || process.env.ASA_E2E_BASE_URL !== 'http://web:8080')
    throw Error('Browser proof requires the isolated Compose test runner');
  const suites = [
    ['e2e/chess-network.spec.ts', 'e2e/checkers-network.spec.ts'],
    [
      'e2e/electronics-simulation.spec.ts',
      '--grep',
      'saving indicator:|project refresh:|ELECTRONICS-E01|Electronics automatic save retry',
    ],
  ];
  for (const suite of suites) {
    const result = spawnSync(
      'corepack',
      ['pnpm', 'exec', 'playwright', 'test', ...suite, '--workers=1'],
      {
        stdio: 'inherit',
        timeout: 900000,
        env: { ...process.env, NX_SKIP_NX_CACHE: 'true' },
      },
    );
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
} else if (mode === 'compare') {
  const users = Number(process.argv[3]);
  if (![30, 60].includes(users)) throw Error('Choose the measured 30 or 60 users');
  const before = JSON.parse(readFileSync(`reports/request-storm/baseline-${users}.json`, 'utf8'));
  const after = JSON.parse(readFileSync(`reports/request-storm/candidate-${users}.json`, 'utf8'));
  const candidateHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (
    !before.success ||
    !after.success ||
    before.users !== users ||
    after.users !== users ||
    before.source !== STORM_BASELINE ||
    after.source !== candidateHead
  )
    throw Error('Both complete workloads are required before comparison');
  const metric = (key) => ({ before: before.summary[key], after: after.summary[key] });
  const phases = Object.fromEntries(
    Object.keys(before.summary.byPhase).map((phase) => [
      phase,
      {
        before: before.summary.byPhase[phase],
        after: after.summary.byPhase[phase] || 0,
      },
    ]),
  );
  const report = {
    users,
    beforeSource: before.source,
    afterSource: after.source,
    requests: metric('requests'),
    requestsPerSecond: metric('requestsPerSecond'),
    requestsPerMinute: metric('requestsPerMinute'),
    requestsPerClient: metric('requestsPerClient'),
    latencyMs: metric('latencyMs'),
    unexpected5xx: metric('unexpected5xx'),
    unexpected429: metric('unexpected429'),
    peakBusinessPerInstance: {
      before: before.peakBusinessPerInstance,
      after: after.peakBusinessPerInstance,
    },
    peakNotificationsPerChannel: {
      before: before.peakNotificationsPerChannel,
      after: after.peakNotificationsPerChannel,
    },
    phases,
    beforeCorrectness: before.correctness,
    afterCorrectness: after.correctness,
    limitations: after.limitations,
  };
  writeFileSync(`reports/request-storm/comparison-${users}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} else {
  let paths = unitPaths;
  if (mode === 'measure') {
    const fixture = assertStormEnvironment(process.env);
    const source = resolve(process.env.ASA_STORM_SOURCE_ROOT || '.');
    const actual = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    if (actual !== fixture.source)
      throw Error('Workload source SHA differs from the selected checkout');
    execFileSync('git', ['-C', source, 'diff', '--quiet', 'HEAD'], { stdio: 'inherit' });
    paths = ['tests/capacity/request-storm.pg.spec.ts'];
  } else if (mode !== 'unit') throw Error('Supported modes: unit, measure, compare, browser');
  const result = spawnSync(
    process.platform === 'win32' ? 'corepack.cmd' : 'corepack',
    ['pnpm', 'exec', 'vitest', 'run', ...paths, '--maxWorkers=1'],
    {
      stdio: 'inherit',
      timeout: mode === 'measure' ? 660000 : 180000,
      shell: process.platform === 'win32',
      env: { ...process.env, NX_SKIP_NX_CACHE: 'true' },
    },
  );
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
