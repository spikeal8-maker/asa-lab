// Starts the built API (serving the built SPA) for the browser E2E on the
// canonical E2E port (default 4612; ASA_E2E_PORT override is validated).
const FORBIDDEN = new Set([3000, 3100, 5173]);
const raw = process.env.ASA_E2E_PORT ?? '4612';
const port = Number.parseInt(raw, 10);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || FORBIDDEN.has(port)) {
  console.error(`ASA_E2E_PORT invalid or forbidden: ${raw}`);
  process.exit(78);
}
process.env.API_PORT = String(port);
process.env.API_HOST = '127.0.0.1';
if (!process.env.APP_DATABASE_URL) {
  console.error('APP_DATABASE_URL is required for the E2E server');
  process.exit(78);
}
await import('../apps/api/dist/main.js');
