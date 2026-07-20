import { createTelemetry, type TelemetryHandle } from '@asa-lab/observability';
import { createApiApp } from './app.factory.js';

export interface ApiApplication {
  listen(options: { readonly host: string; readonly port: number }): Promise<unknown>;
  close(): Promise<void>;
}

export interface ApiRuntimeOptions {
  readonly host?: string;
  readonly port?: number;
  readonly createApp?: () => Promise<ApiApplication>;
  readonly telemetry?: TelemetryHandle;
}

export interface ApiRuntime {
  readonly host: string;
  readonly port: number;
  stop(reason?: string): Promise<void>;
}

/**
 * Starts telemetry before application construction, closes a partially-created
 * application on startup failure, and guarantees telemetry shutdown. The
 * returned stop operation is idempotent so duplicate SIGINT/SIGTERM events do
 * not race the Fastify/Nest lifecycle.
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
  } catch (error) {
    try {
      if (app !== null) {
        await app.close();
      }
    } finally {
      if (telemetryStarted) {
        await telemetry.shutdown();
      }
    }
    throw error;
  }

  let stopPromise: Promise<void> | null = null;
  return {
    host,
    port,
    stop: (_reason = 'manual'): Promise<void> => {
      if (stopPromise === null) {
        stopPromise = (async () => {
          try {
            await app.close();
          } finally {
            await telemetry.shutdown();
          }
        })();
      }
      return stopPromise;
    },
  };
}
