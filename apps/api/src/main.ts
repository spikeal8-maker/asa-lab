import 'reflect-metadata';
import { createTelemetry } from '@asa-lab/observability';
import { createApiApp } from './app.factory.js';

const HOST = process.env['API_HOST'] ?? '127.0.0.1';
const PORT = Number.parseInt(process.env['API_PORT'] ?? '4611', 10);

async function run(): Promise<void> {
  // Fail closed: the API accepts only the runtime-role connection string.
  // Admin (DATABASE_URL) and test (TEST_DATABASE_URL) URLs are never used.
  if (!process.env['APP_DATABASE_URL']) {
    process.stderr.write('APP_DATABASE_URL is required; the API refuses to start without it\n');
    process.exit(78);
  }
  // Telemetry stays disabled by default: nothing leaves the process unless an
  // OTLP endpoint is configured explicitly for ASA Lab.
  const telemetry = createTelemetry({ serviceName: 'asa-lab-api', mode: 'disabled' });
  telemetry.start();
  const app = await createApiApp();
  const shutdown = (signal: string): void => {
    void (async () => {
      try {
        await app.close();
      } finally {
        await telemetry.shutdown();
        process.stdout.write(`api stopped on ${signal}\n`);
        process.exit(0);
      }
    })();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  await app.listen({ port: PORT, host: HOST });
  process.stdout.write(`ASA Lab API:  http://${HOST}:${PORT}\n`);
  process.stdout.write(`Teacher portal (built SPA, if present): http://${HOST}:${PORT}/\n`);
}

run().catch((error: unknown) => {
  process.stderr.write(`api failed to start: ${String(error)}\n`);
  process.exitCode = 1;
});
