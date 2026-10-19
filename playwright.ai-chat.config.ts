import { defineConfig } from '@playwright/test';

/**
 * Focused AI UI acceptance: browser fixtures intercept all /api requests,
 * so no credentials, real provider or working PostgreSQL are required.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'ai-*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4612',
    trace: 'retain-on-failure',
    actionTimeout: 10000,
  },
  outputDir: 'reports/playwright/ai-chat',
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js --config apps/web/vite.config.ts --host 127.0.0.1 --port 4612 --strictPort',
    url: 'http://127.0.0.1:4612',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
