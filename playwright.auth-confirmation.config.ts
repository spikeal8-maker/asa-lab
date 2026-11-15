import { defineConfig } from '@playwright/test';

// This suite renders the built SPA with synthetic API contracts. It proves the
// browser flow and layout only; real policy/DB tests and bot delivery are separate.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'auth-confirmation-ui.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  outputDir: 'reports/playwright/auth-confirmation',
  use: {
    baseURL: 'http://127.0.0.1:4612',
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    serviceWorkers: 'block',
  },
  webServer: {
    // Serve the existing build without inheriting the development API proxy.
    // BrowserContext routes supply all synthetic APIs, including keepalive.
    command:
      "node --input-type=module -e \"import { preview } from 'vite'; await preview({ configFile: false, root: 'apps/web', preview: { host: '127.0.0.1', port: 4612, strictPort: true, proxy: {} } });\"",
    url: 'http://127.0.0.1:4612',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
