import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@asa-lab/electronics/simulation',
        replacement: fileURLToPath(new URL('./modules/electronics/simulation.ts', import.meta.url)),
      },
      {
        find: '@asa-lab/electronics',
        replacement: fileURLToPath(new URL('./modules/electronics/index.ts', import.meta.url)),
      },
      {
        find: '@asa-lab/portal-shell/navigation',
        replacement: fileURLToPath(
          new URL('./packages/portal-shell/src/creator-portal/navigation.ts', import.meta.url),
        ),
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
      'modules/**/testing/**/*.spec.ts',
      'tests/**/*.spec.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    reporters: ['default'],
  },
});
