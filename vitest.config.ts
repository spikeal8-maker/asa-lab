import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@asa-lab/electronics/engine',
        replacement: fileURLToPath(new URL('./contexts/electronics/engine.ts', import.meta.url)),
      },
      {
        find: '@asa-lab/electronics/simulation',
        replacement: fileURLToPath(
          new URL('./contexts/electronics/simulation.ts', import.meta.url),
        ),
      },
      {
        find: '@asa-lab/electronics',
        replacement: fileURLToPath(new URL('./contexts/electronics/index.ts', import.meta.url)),
      },
      {
        find: '@asa-lab/three-d',
        replacement: fileURLToPath(new URL('./contexts/three-d/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    globals: false,
    environment: 'node',
    include: [
      'apps/**/src/**/*.spec.ts',
      'packages/**/src/**/*.spec.ts',
      'contexts/**/testing/**/*.spec.ts',
      'tests/**/*.spec.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    reporters: ['default'],
    // These three real-PG suites hold the same advisory lock from beforeAll
    // through afterAll. Running them on separate workers causes the later
    // suite to exhaust its existing 90-second setup budget while waiting.
    // Keep every test, the lock and the 60/90-second limits unchanged.
    projects: [
      {
        extends: true,
        test: {
          name: 'parallel',
          include: [
            'apps/**/src/**/*.spec.ts',
            'packages/**/src/**/*.spec.ts',
            'contexts/**/testing/**/*.spec.ts',
            'tests/**/*.spec.ts',
          ],
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            'e2e/**',
            'tests/courses/activity-participations.pg.spec.ts',
            'tests/courses/learning-direct-project-attempts.pg.spec.ts',
            'tests/portal/public-projects.pg.spec.ts',
          ],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'serialized-submissions',
          include: [
            'tests/courses/activity-participations.pg.spec.ts',
            'tests/courses/learning-direct-project-attempts.pg.spec.ts',
            'tests/portal/public-projects.pg.spec.ts',
          ],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
