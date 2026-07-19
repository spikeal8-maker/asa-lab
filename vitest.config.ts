import { defineConfig } from 'vitest/config';

export default defineConfig({
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
  },
});
