import { defineConfig } from '@playwright/test';

const e2ePort = process.env['ASA_E2E_PORT'] ?? '4612';
const externalServer = process.env['ASA_E2E_EXTERNAL'] === 'true';
const baseURL = process.env['ASA_E2E_BASE_URL'] ?? `http://127.0.0.1:${e2ePort}`;

const traceVariant = process.env['ASA_ELECTRONICS_DIAGNOSTIC_TRACE'];
const staticHarPath = process.env['ASA_ELECTRONICS_DIAGNOSTIC_STATIC_HAR'];
const traceDiagnostic =
  !!staticHarPath &&
  process.env['ASA_ELECTRONICS_QUALIFICATION_PROFILE'] === 'strict-real-time' &&
  (traceVariant === 'full' || traceVariant === 'light');

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
    trace: traceDiagnostic
      ? {
          mode: 'on',
          screenshots: traceVariant === 'full',
          snapshots: traceVariant === 'full',
          sources: true,
        }
      : 'retain-on-failure',
    ...(traceDiagnostic
      ? {
          contextOptions: {
            // Playwright's trace collects network data only with DOM snapshots.
            // Use the same filtered, body-free capture for both diagnostic arms.
            recordHar: {
              path: staticHarPath,
              content: 'omit',
              mode: 'full',
              urlFilter:
                /^https?:\/\/[^/]+\/assets\/(?:electronics\/|simulation\.worker-[\w-]+\.js(?:[?#]|$))/,
            },
          },
        }
      : {}),
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
