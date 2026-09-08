import { defineConfig } from '@playwright/test';

// Real API + built SPA; the launcher refuses a non-test database. No mocked API.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['access-a.spec.ts', 'account-c1.spec.ts'],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90000,
  outputDir: 'reports/playwright/access-a',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4612', trace: 'retain-on-failure', actionTimeout: 10000 },
  webServer: {
    command: 'node e2e/server.mjs',
    url: 'http://127.0.0.1:4612/health/ready',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      NODE_ENV: 'test',
      ASA_WEB_PORT: '4612',
      ASA_WEB_ORIGIN: 'http://127.0.0.1:4612',
      ASA_SEED_DEMO: 'false',
    },
  },
});
