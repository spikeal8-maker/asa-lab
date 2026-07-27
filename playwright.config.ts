import { defineConfig } from '@playwright/test';

const e2ePort = process.env['ASA_E2E_PORT'] ?? '4612';

export default defineConfig({
  testDir: './e2e',
  outputDir: 'reports/playwright',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e/server.mjs',
    url: `http://127.0.0.1:${e2ePort}/health/live`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
