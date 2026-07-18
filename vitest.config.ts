import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['apps/**/src/**/*.spec.ts', 'packages/**/src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    reporters: ['default'],
  },
});
