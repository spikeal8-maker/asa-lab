import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['admin-logs-ui.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4612', trace: 'retain-on-failure' },
  outputDir: 'reports/playwright/admin-logs',
});
