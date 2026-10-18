import { defineConfig } from '@playwright/test';

// This suite renders the built SPA with synthetic API contracts. It proves the
// browser flow and layout only; real policy/DB tests and bot delivery are separate.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'auth-confirmation-ui.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  outputDir: 'reports/playwright/auth-confirmation',
  use: {
    baseURL: 'http://127.0.0.1:4612',
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    serviceWorkers: 'block',
  },
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js preview --config apps/web/vite.config.ts --host 127.0.0.1 --port 4612 --strictPort',
    url: 'http://127.0.0.1:4612',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
