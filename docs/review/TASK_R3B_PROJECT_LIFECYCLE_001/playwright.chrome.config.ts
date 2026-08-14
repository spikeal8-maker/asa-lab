import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../../e2e',
  outputDir: '../../../reports/playwright/project-hub-chrome',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env['ASA_E2E_BASE_URL'] ?? 'http://127.0.0.1:4613',
    launchOptions: {
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    },
    trace: 'retain-on-failure',
  },
});
