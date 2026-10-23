import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Inline Vitest v4 projects do not inherit root aliases unless "extends" is
// enabled, which would also concatenate the root's broad include list.
// Share aliases explicitly while keeping the projects' file sets disjoint.
const sharedAliases = [
  {
    find: '@asa-lab/electronics/engine',
    replacement: fileURLToPath(new URL('./contexts/electronics/engine.ts', import.meta.url)),
  },
  {
    find: '@asa-lab/electronics/simulation',
    replacement: fileURLToPath(new URL('./contexts/electronics/simulation.ts', import.meta.url)),
  },
  {
    find: '@asa-lab/electronics',
    replacement: fileURLToPath(new URL('./contexts/electronics/index.ts', import.meta.url)),
  },
  {
    find: '@asa-lab/three-d',
    replacement: fileURLToPath(new URL('./contexts/three-d/index.ts', import.meta.url)),
  },
];

const allSpecs = [
  'apps/**/src/**/*.spec.ts',
  'packages/**/src/**/*.spec.ts',
  'contexts/**/testing/**/*.spec.ts',
  'tests/**/*.spec.ts',
];
const excludedSpecs = ['**/node_modules/**', '**/dist/**', 'e2e/**'];
const submissionLockSpecs = [
  'tests/courses/activity-participations.pg.spec.ts',
  'tests/courses/learning-direct-project-attempts.pg.spec.ts',
  'tests/portal/public-projects.pg.spec.ts',
];

export default defineConfig({
  resolve: { alias: sharedAliases },
  test: {
    globals: false,
    environment: 'node',
    include: allSpecs,
    exclude: excludedSpecs,
    reporters: ['default'],
    // The three shared-lock suites retain their original beforeAll/afterAll
    // advisory lock, exact 60/90-second limits and failure-trigger assertions.
    // Only these files are serialized. All other files retain parallelism.
    projects: [
      {
        resolve: { alias: sharedAliases },
        test: {
          name: 'parallel',
          globals: false,
          environment: 'node',
          include: allSpecs,
          exclude: [...excludedSpecs, ...submissionLockSpecs],
          sequence: { groupOrder: 0 },
        },
      },
      {
        resolve: { alias: sharedAliases },
        test: {
          name: 'serialized-submissions',
          globals: false,
          environment: 'node',
          include: submissionLockSpecs,
          exclude: excludedSpecs,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
