import { defineConfig } from '@playwright/test';

// This suite uses the built Web and the real API. The existing launcher rejects
// anything except an explicit isolated *_test database; no successful API is mocked.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['ai-usage-overview.spec.ts', 'own-quality-real.spec.ts'],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180000,
  outputDir: 'reports/playwright/ai-usage-overview/artifacts',
  reporter: [
    ['list'],
    ['json', { outputFile: 'reports/playwright/ai-usage-overview/results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4612',
    actionTimeout: 10000,
    // Authenticated HTTP traces contain fixture cookies. Keep safe screenshots
    // and aggregate summaries rather than uploading authentication material.
    trace: 'off',
  },
  webServer: {
    command: 'node e2e/server.mjs',
    url: 'http://127.0.0.1:4612/health/ready',
    reuseExistingServer: false,
    timeout: 45000,
    env: {
      NODE_ENV: 'test',
      ASA_WEB_PORT: '4612',
      ASA_WEB_ORIGIN: 'http://127.0.0.1:4612',
      ASA_SEED_DEMO: 'false',
    },
  },
});
