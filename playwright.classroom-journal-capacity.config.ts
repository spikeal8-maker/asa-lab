import { defineConfig } from '@playwright/test';

const origin = 'http://127.0.0.1:4612';
const enabled = process.env.ASA_JOURNAL_CAPACITY === '1';

export function assertJournalCapacityEnvironment(): void {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') ||
    !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') ||
    !/^[a-f0-9]{40}$/.test(process.env.ASA_BUILD_REVISION ?? '')
  )
    throw new Error('Journal capacity requires an isolated GitHub Actions run.');
  for (const [key, user] of [
    ['TEST_DATABASE_URL', 'postgres'],
    ['APP_TEST_DATABASE_URL', 'asalab_app'],
  ] as const) {
    const url = new URL(process.env[key] ?? 'about:blank');
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '5432' ||
      url.username !== user ||
      url.pathname !== '/asa_journal_capacity_test' ||
      url.search ||
      url.hash
    )
      throw new Error('Journal capacity requires matching loopback fixture databases.');
  }
}

if (enabled) assertJournalCapacityEnvironment();

export default defineConfig({
  testDir: './e2e',
  testMatch: 'classroom-journal-capacity.spec.ts',
  outputDir: 'reports/playwright/classroom-journal-capacity',
  workers: 1,
  retries: 0,
  timeout: 180_000,
  use: { baseURL: origin, actionTimeout: 10_000 },
  ...(enabled
    ? {
        webServer: {
          command: 'node e2e/server.mjs',
          url: origin + '/health/ready',
          reuseExistingServer: false,
          timeout: 30_000,
          env: {
            NODE_ENV: 'test',
            ASA_E2E_PORT: '4612',
            ASA_WEB_PORT: '4612',
            ASA_WEB_ORIGIN: origin,
            ASA_SEED_DEMO: 'false',
          },
        },
      }
    : {}),
});
