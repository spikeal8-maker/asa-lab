import 'reflect-metadata';
import { createTelemetry } from '@asa-lab/observability';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApiApp } from './app.factory.js';

export interface TelemetryLike {
  start(): void;
  shutdown(): Promise<void>;
}

export interface ApiRuntime {
  app: NestFastifyApplication;
  /** Graceful stop: HTTP server + pool first, telemetry last. Idempotent. */
  close(): Promise<void>;
}

export interface StartApiOptions {
  telemetry?: TelemetryLike;
  port?: number;
  host?: string;
}

/**
 * Start the API with a correct lifecycle contract:
 * - fail closed without APP_DATABASE_URL;
 * - telemetry starts BEFORE the instrumented app modules are constructed;
 * - a startup error still shuts telemetry down;
 * - close() stops the app first, then telemetry, and is idempotent.
 */
export async function startApi(options: StartApiOptions = {}): Promise<ApiRuntime> {
  if (!process.env['APP_DATABASE_URL']) {
    throw new Error('APP_DATABASE_URL is required; the API refuses to start without it');
  }
  const telemetry =
    options.telemetry ?? createTelemetry({ serviceName: 'asa-lab-api', mode: 'disabled' });
  telemetry.start();
  let app: NestFastifyApplication;
  try {
    app = await createApiApp();
    await app.listen({
      port: options.port ?? Number.parseInt(process.env['API_PORT'] ?? '4611', 10),
      host: options.host ?? process.env['API_HOST'] ?? '127.0.0.1',
    });
  } catch (startupError) {
    await telemetry.shutdown();
    throw startupError;
  }
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      await app.close();
    } finally {
      await telemetry.shutdown();
    }
  };
  return { app, close };
}

/* c8 ignore start */
if (require.main === module) {
  const HOST = process.env['API_HOST'] ?? '127.0.0.1';
  const PORT = Number.parseInt(process.env['API_PORT'] ?? '4611', 10);
  startApi({ host: HOST, port: PORT })
    .then((runtime) => {
      const shutdown = (signal: string): void => {
        void runtime.close().then(() => {
          process.stdout.write(`api stopped on ${signal}\n`);
          process.exit(0);
        });
      };
      process.once('SIGINT', () => shutdown('SIGINT'));
      process.once('SIGTERM', () => shutdown('SIGTERM'));
      process.stdout.write(`ASA Lab API:  http://${HOST}:${PORT}\n`);
      process.stdout.write(`Teacher portal (built SPA, if present): http://${HOST}:${PORT}/\n`);
    })
    .catch((error: unknown) => {
      const message = String(error instanceof Error ? error.message : error);
      process.stderr.write(`api failed to start: ${message}\n`);
      process.exit(message.includes('APP_DATABASE_URL') ? 78 : 1);
    });
}
/* c8 ignore stop */
