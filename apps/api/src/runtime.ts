import { createTelemetry } from '@asa-lab/observability';
import { createApiApp } from './app.factory.js';

export interface ApiApplication {
  listen(options: { readonly host: string; readonly port: number }): Promise<unknown>;
  close(): Promise<void>;
}

export interface TelemetryLifecycle {
  start(): void;
  shutdown(): Promise<void>;
}

export interface ApiRuntimeOptions {
  readonly host?: string;
  readonly port?: number;
  readonly createApp?: () => Promise<ApiApplication>;
  readonly telemetry?: TelemetryLifecycle;
}

export interface ApiRuntime {
  readonly host: string;
  readonly port: number;
  stop(reason?: string): Promise<void>;
}

/**
 * The single API lifecycle implementation.
 *
 * Telemetry starts before application construction. Startup cleanup closes a
 * partially-created app and then telemetry. The returned stop operation is
 * idempotent so duplicate SIGINT/SIGTERM events cannot race the Nest/Fastify
 * lifecycle.
 */
export async function launchApiRuntime(options: ApiRuntimeOptions = {}): Promise<ApiRuntime> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4611;
  const telemetry =
    options.telemetry ?? createTelemetry({ serviceName: 'asa-lab-api', mode: 'disabled' });
  const createApp = options.createApp ?? createApiApp;

  let app: ApiApplication | null = null;
  let telemetryStarted = false;
  try {
    telemetry.start();
    telemetryStarted = true;
    app = await createApp();
    await app.listen({ host, port });
  } catch (startupError) {
    const cleanupErrors: unknown[] = [];
    if (app !== null) {
      try {
        await app.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (telemetryStarted) {
      try {
        await telemetry.shutdown();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [startupError, ...cleanupErrors],
        'API startup failed and cleanup also reported errors',
        { cause: startupError },
      );
    }
    throw startupError;
  }

  if (app === null) {
    await telemetry.shutdown();
    throw new Error('API application was not created');
  }

  const runningApp = app;
  let stopPromise: Promise<void> | null = null;
  return {
    host,
    port,
    stop: (): Promise<void> => {
      if (stopPromise === null) {
        stopPromise = (async () => {
          try {
            await runningApp.close();
          } finally {
            await telemetry.shutdown();
          }
        })();
      }
      return stopPromise;
    },
  };
}
