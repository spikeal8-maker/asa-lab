import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@asa-lab/electronics': fileURLToPath(
        new URL('./contexts/electronics/index.ts', import.meta.url),
      ),
    },
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
  },
});
