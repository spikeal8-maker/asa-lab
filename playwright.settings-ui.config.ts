import { defineConfig } from '@playwright/test';

// Synthetic UI fixtures serve the built SPA via browser route interception,
// without a server, database or listening socket. They run alongside
// (never in place of) the real authorization journeys in access-a.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['access-account-ui.spec.ts', 'admin-logs-ui.spec.ts', 'classroom-owner-ui.spec.ts'],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4612', trace: 'retain-on-failure', actionTimeout: 10000 },
  outputDir: 'reports/playwright/settings-ui',
});
