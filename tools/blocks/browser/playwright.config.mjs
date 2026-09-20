import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../../e2e',
  testMatch: [
    'blocks-host-storage.spec.ts',
    'blocks-host-controls.spec.ts',
    'blocks-product-integration.spec.ts',
    'blocks-recovery.spec.ts',
    'blocks-loading.spec.ts',
    'blocks-recovery-media.spec.ts',
  ],
  outputDir: '../../../reports/blocks/test-results',
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: [['list']],
});
