// Starts the built API (serving the built SPA) for the browser E2E on the
// canonical E2E port. The E2E stack runs ONLY against the isolated *_test
// database: APP_TEST_DATABASE_URL is validated and passed to the API as its
// runtime connection.
const FORBIDDEN = new Set([3000, 3100, 5173]);
const raw = process.env.ASA_E2E_PORT ?? '4612';
const port = Number.parseInt(raw, 10);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || FORBIDDEN.has(port)) {
  console.error(`ASA_E2E_PORT invalid or forbidden: ${raw}`);
  process.exit(78);
}
const appTestUrl = process.env.APP_TEST_DATABASE_URL;
if (!appTestUrl) {
  console.error('APP_TEST_DATABASE_URL is required for the E2E server');
  process.exit(78);
}
if (!new URL(appTestUrl).pathname.endsWith('_test')) {
  console.error('APP_TEST_DATABASE_URL must target an isolated *_test database');
  process.exit(78);
}
process.env.API_PORT = String(port);
process.env.API_HOST = '127.0.0.1';
process.env.APP_DATABASE_URL = appTestUrl;
delete process.env.DATABASE_URL;
delete process.env.TEST_DATABASE_URL;
await import('../apps/api/dist/main.js');
