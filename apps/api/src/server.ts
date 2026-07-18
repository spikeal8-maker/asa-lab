import type { FastifyInstance } from 'fastify';
import { main } from './index.js';

/** Register graceful shutdown on SIGINT/SIGTERM for a running app. */
export function registerGracefulShutdown(app: FastifyInstance): void {
  const shutdown = (signal: string): void => {
    app
      .close()
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
  const app = await main();
  registerGracefulShutdown(app);
}

run().catch((error: unknown) => {
  process.stderr.write(`api failed to start: ${String(error)}\n`);
  process.exitCode = 1;
});
