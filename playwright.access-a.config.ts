import { defineConfig } from '@playwright/test';

const batch = process.env.ASA_ACCESS_A_BATCH;
const runId = process.env.ASA_ACCESS_A_RUN_ID;
if (
  (batch !== undefined || runId !== undefined) &&
  (!['discovery', 'journeys', 'nat'].includes(batch ?? '') ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runId ?? ''))
) {
  throw new Error('Invalid internal Access A batch identity');
}
const allSpecs = [
  'access-a.spec.ts',
  'account-c1.spec.ts',
  'student-seat-access-hardening.spec.ts',
  'student-access-cards.spec.ts',
  'classroom-manual-journal.spec.ts',
  'classroom-participants.spec.ts',
  'classroom-profile-completion.spec.ts',
  'classroom-usability.spec.ts',
  'classroom-quick-journal.spec.ts',
  'classroom-observation.spec.ts',
];
const natSpec = 'student-seat-access-hardening.spec.ts';
const testMatch = allSpecs.filter((file) =>
  batch === 'nat' ? file === natSpec : batch === 'journeys' ? file !== natSpec : true,
);
const batchDirectory = batch ? `reports/playwright/access-a/runs/${runId}/${batch}` : null;

// Real API + built SPA; the launcher refuses a non-test database. No mocked API.
export default defineConfig({
  testDir: './e2e',
  testMatch,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90000,
  outputDir: batchDirectory ? `${batchDirectory}/artifacts` : 'reports/playwright/access-a',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: batchDirectory
          ? `${batchDirectory}/results.json`
          : 'reports/playwright/access-a-summary.json',
      },
    ],
  ],
  use: { baseURL: 'http://127.0.0.1:4612', trace: 'retain-on-failure', actionTimeout: 10000 },
  webServer: {
    command: 'node e2e/server.mjs',
    url: 'http://127.0.0.1:4612/health/ready',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      NODE_ENV: 'test',
      ASA_WEB_PORT: '4612',
      ASA_WEB_ORIGIN: 'http://127.0.0.1:4612',
      ASA_SEED_DEMO: 'false',
    },
  },
});
