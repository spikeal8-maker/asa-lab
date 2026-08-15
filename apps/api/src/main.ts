import 'reflect-metadata';
import {
  launchApiRuntime,
  type TelemetryLifecycle,
  type ApiRuntime as LaunchedApiRuntime,
} from './runtime.js';

export interface ApiRuntime {
  /** Graceful stop: HTTP server + pool first, telemetry last. Idempotent. */
  close(): Promise<void>;
}

export interface StartApiOptions {
  telemetry?: TelemetryLifecycle;
  port?: number;
  host?: string;
}

/**
 * Production-facing startup wrapper.
 *
 * The runtime-role URL is mandatory. All lifecycle behavior is delegated to
 * `launchApiRuntime`, so production startup and lifecycle tests exercise the
 * same implementation rather than two similar copies.
 */
export async function startApi(options: StartApiOptions = {}): Promise<ApiRuntime> {
  if (!process.env['APP_DATABASE_URL']) {
    throw new Error('APP_DATABASE_URL is required; the API refuses to start without it');
  }

  // Password hashing and static file reads share the libuv pool. The default of
  // four threads leaves file serving stalled behind a burst of sign-ins; eight
  // measured best here, while more threads than cores traded file latency for
  // event-loop latency. Password hashing separately takes at most half.
  process.env['UV_THREADPOOL_SIZE'] ??= '8';

  const runtimeOptions = {
    host: options.host ?? process.env['API_HOST'] ?? '127.0.0.1',
    port: options.port ?? Number.parseInt(process.env['API_PORT'] ?? '4611', 10),
    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
  };
  const runtime: LaunchedApiRuntime = await launchApiRuntime(runtimeOptions);
  return { close: () => runtime.stop() };
}

/* c8 ignore start */
if (require.main === module) {
  const host = process.env['API_HOST'] ?? '127.0.0.1';
  const port = Number.parseInt(process.env['API_PORT'] ?? '4611', 10);
  startApi({ host, port })
    .then((runtime) => {
      const shutdown = (signal: string): void => {
        void runtime
          .close()
          .then(() => {
            process.stdout.write(`api stopped on ${signal}\n`);
            process.exit(0);
          })
          .catch((error: unknown) => {
            process.stderr.write(`api shutdown failed on ${signal}: ${String(error)}\n`);
            process.exit(1);
          });
      };
      process.once('SIGINT', () => shutdown('SIGINT'));
      process.once('SIGTERM', () => shutdown('SIGTERM'));
      process.stdout.write(`ASA Lab API:  http://${host}:${port}\n`);
      process.stdout.write(`Teacher portal (built SPA, if present): http://${host}:${port}/\n`);
    })
    .catch((error: unknown) => {
      const message = String(error instanceof Error ? error.message : error);
      process.stderr.write(`api failed to start: ${message}\n`);
      process.exit(message.includes('APP_DATABASE_URL') ? 78 : 1);
    });
}
/* c8 ignore stop */
