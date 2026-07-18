import { createTelemetry } from '@asa-lab/observability';
import { launch, type RunningServer } from './launcher.js';

const HOST = process.env['API_HOST'] ?? '127.0.0.1';
const PORT = Number.parseInt(process.env['API_PORT'] ?? '3000', 10);
const SERVICE_NAME = process.env['OTEL_SERVICE_NAME'] ?? 'asa-lab-api';

function registerSignals(server: RunningServer): void {
  const shutdown = (signal: string): void => {
    server
      .stop()
      .then(() => {
        process.stdout.write(`api shut down on ${signal}\n`);
        process.exit(0);
      })
      .catch((error: unknown) => {
        process.stderr.write(`api shutdown failed: ${String(error)}\n`);
        process.exit(1);
      });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

async function run(): Promise<void> {
  // Telemetry is disabled by default: no traces/metrics/logs leave the process
  // unless an OTLP endpoint is explicitly configured for ASA Lab.
  const telemetry = createTelemetry({ serviceName: SERVICE_NAME, mode: 'disabled' });
  const server = await launch({
    telemetry,
    loadApp: () => import('./index.js'),
    host: HOST,
    port: PORT,
  });
  registerSignals(server);
}

run().catch((error: unknown) => {
  process.stderr.write(`api failed to start: ${String(error)}\n`);
  process.exitCode = 1;
});
