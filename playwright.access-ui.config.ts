import { defineConfig } from '@playwright/test';

// Browser UI contract tests only. All /api requests are intercepted by the
// fixture; there is no API process, database connection, or production origin.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'access-account-ui.spec.ts',
  outputDir: 'reports/playwright/access-ui',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4612', trace: 'retain-on-failure' },
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js --config apps/web/vite.config.ts --host 127.0.0.1 --port 4612 --strictPort',
    url: 'http://127.0.0.1:4612',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
