import { defineConfig } from '@playwright/test';
import base from './playwright.ai-usage-overview.config';
export default defineConfig(base, {
  testMatch: 'ai-token-budgets.spec.ts',
  outputDir: 'reports/playwright/ai-token-budgets/artifacts',
  reporter: [
    ['list'],
    ['json', { outputFile: 'reports/playwright/ai-token-budgets/results.json' }],
  ],
});
