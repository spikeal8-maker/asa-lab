import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';

export type DependencyState = 'up' | 'down' | 'unknown';

export interface LiveResponse {
  readonly status: 'live';
}

export interface ReadyResponse {
  readonly status: 'ready' | 'not_ready';
  readonly dependencies: Readonly<Record<string, DependencyState>>;
}

/**
 * Evaluate readiness. In the Bootstrap foundation no external dependency is
 * wired yet, so their state is unknown and readiness is intentionally NOT
 * confirmed. Real probes replace the `unknown` states in later persistence and
 * infrastructure tasks.
 */
export function evaluateReadiness(): { ready: boolean; body: ReadyResponse } {
  const dependencies: Record<string, DependencyState> = {
    database: 'unknown',
    redis: 'unknown',
    objectStorage: 'unknown',
  };
  const ready = Object.values(dependencies).every((state) => state === 'up');
  return {
    ready,
    body: { status: ready ? 'ready' : 'not_ready', dependencies },
  };
}

/**
 * Build the Control Plane API foundation. It exposes only liveness and
 * readiness probes plus a request-id/trace context. No business routes exist
 * in the Bootstrap iteration.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: false,
    genReqId: (): string => randomUUID(),
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.get('/health/live', async (): Promise<LiveResponse> => ({ status: 'live' }));

  app.get('/health/ready', async (_request, reply): Promise<ReadyResponse> => {
    const { ready, body } = evaluateReadiness();
    reply.code(ready ? 200 : 503);
    return body;
  });

  return app;
}
