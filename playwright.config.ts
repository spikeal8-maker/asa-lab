import { defineConfig } from '@playwright/test';

const e2ePort = process.env['ASA_E2E_PORT'] ?? '4612';
const externalServer = process.env['ASA_E2E_EXTERNAL'] === 'true';
const baseURL = process.env['ASA_E2E_BASE_URL'] ?? `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: 'reports/playwright',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
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
