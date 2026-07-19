// Starts the built API (serving the built SPA) for the browser E2E.
process.env.API_PORT = '4612';
process.env.API_HOST = '127.0.0.1';
if (!process.env.APP_DATABASE_URL) {
  console.error('APP_DATABASE_URL is required for the E2E server');
  process.exit(78);
}
await import('../apps/api/dist/main.js');
