import 'reflect-metadata';
import { launchApiRuntime } from './runtime.js';

const HOST = process.env['API_HOST'] ?? '127.0.0.1';
const PORT = Number.parseInt(process.env['API_PORT'] ?? '4611', 10);

async function run(): Promise<void> {
  // Fail closed: the API accepts only the runtime-role connection string.
  // Admin (DATABASE_URL) and test (TEST_DATABASE_URL) URLs are never used.
  if (!process.env['APP_DATABASE_URL']) {
    process.stderr.write('APP_DATABASE_URL is required; the API refuses to start without it\n');
    process.exitCode = 78;
    return;
  }

  const runtime = await launchApiRuntime({ host: HOST, port: PORT });
  let shutdownStarted = false;
  const shutdown = (signal: string): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    void runtime
      .stop(signal)
      .then(() => {
        process.stdout.write(`api stopped on ${signal}\n`);
        process.exitCode = 0;
      })
      .catch((error: unknown) => {
        process.stderr.write(`api shutdown failed on ${signal}: ${String(error)}\n`);
        process.exitCode = 1;
      });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  process.stdout.write(`ASA Lab API:  http://${runtime.host}:${runtime.port}\n`);
  process.stdout.write(
    `Teacher portal (built SPA, if present): http://${runtime.host}:${runtime.port}/\n`,
  );
}

run().catch((error: unknown) => {
  process.stderr.write(`api failed to start: ${String(error)}\n`);
  process.exitCode = 1;
});
