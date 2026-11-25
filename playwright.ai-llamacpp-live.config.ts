import { defineConfig } from '@playwright/test';

// Explicit post-CI, test-server-only acceptance. This filename is deliberately
// outside the mocked ai-*.spec.ts suite. No response interception is installed.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'ai-llamacpp-live.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 1_200_000,
  reporter: 'list',
  outputDir: 'reports/playwright/ai-llamacpp-live',
  use: {
    baseURL: 'http://127.0.0.1:4612',
    actionTimeout: 15000,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
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
