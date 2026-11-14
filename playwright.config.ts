import { defineConfig } from '@playwright/test';

const e2ePort = process.env['ASA_E2E_PORT'] ?? '4612';
const externalServer = process.env['ASA_E2E_EXTERNAL'] === 'true';
const baseURL = process.env['ASA_E2E_BASE_URL'] ?? `http://127.0.0.1:${e2ePort}`;
const strictElectronicsRun =
  process.env['npm_lifecycle_event'] === 'e2e:electronics-simulation' &&
  (process.env['ASA_ELECTRONICS_QUALIFICATION_PROFILE'] ?? 'strict-real-time') ===
    'strict-real-time';

export default defineConfig({
  testDir: './e2e',
  outputDir: 'reports/playwright',
  fullyParallel: false,
  retries: 0,
  reporter:
    process.env['ASA_ELECTRONICS_FAILURE_REPORT'] === 'true'
      ? [['list'], ['./tools/electronics-failure-reporter.mjs']]
      : [['list']],
  use: {
    baseURL,
    // The strict Electronics tests collect their own native frame evidence.
    // Keep the action trace without running a second visual recorder.
    trace: strictElectronicsRun
      ? { mode: 'retain-on-failure', screenshots: false, snapshots: false, sources: true }
      : 'retain-on-failure',
  },
  ...(externalServer
    ? {}
    : {
        webServer: {
          command: 'node e2e/server.mjs',
          url: `${baseURL}/health/live`,
          reuseExistingServer: false,
          timeout: 30_000,
        },
      }),
});
