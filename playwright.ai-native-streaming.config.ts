import { defineConfig } from '@playwright/test';

// Built Web + real API + isolated PostgreSQL. The controlled loopback Ollama
// lives in the Playwright test process; no API response is mocked.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'ai-native-streaming-real.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180000,
  outputDir: 'reports/playwright/ai-native-streaming/artifacts',
  reporter: [
    ['list'],
    ['json', { outputFile: 'reports/playwright/ai-native-streaming/results.json' }],
  ],
  use: { baseURL: 'http://127.0.0.1:4612', actionTimeout: 10000, trace: 'off' },
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
      ASA_AI_SEARCH_ENDPOINT: 'http://127.0.0.1:19422',
    },
  },
});
