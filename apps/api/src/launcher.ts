import type { FastifyInstance } from 'fastify';

/**
 * Structural telemetry contract used by the launcher. It matches the
 * `TelemetryHandle` from `@asa-lab/observability` but is kept local so the
 * launcher is unit-testable with a fake and has no import-time dependency on
 * the telemetry SDK.
 */
export interface TelemetryLike {
  start(): void;
  shutdown(): Promise<void>;
}

export interface LaunchOptions {
  readonly telemetry: TelemetryLike;
  readonly loadApp: () => Promise<{ buildApp: () => FastifyInstance }>;
  readonly host: string;
  readonly port: number;
}

export interface RunningServer {
  readonly app: FastifyInstance;
  stop(): Promise<void>;
}

/**
 * Start telemetry, then load and start the application. Telemetry is started
 * BEFORE the (potentially instrumented) application modules are imported. On a
 * startup failure telemetry is shut down before the error propagates. The
 * returned `stop` closes Fastify and then telemetry, and is idempotent.
 */
export async function launch(options: LaunchOptions): Promise<RunningServer> {
  options.telemetry.start();

  let app: FastifyInstance;
  try {
    const appModule = await options.loadApp();
    app = appModule.buildApp();
    await app.listen({ host: options.host, port: options.port });
  } catch (error) {
    await options.telemetry.shutdown();
    throw error;
  }

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    stopped = true;
    await app.close();
    await options.telemetry.shutdown();
  };

  return { app, stop };
}
