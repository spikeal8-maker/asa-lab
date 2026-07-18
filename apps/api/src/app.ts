import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';

export interface HealthResponse {
  readonly status: 'live' | 'ready';
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

  app.get('/health/live', async (): Promise<HealthResponse> => ({ status: 'live' }));

  app.get(
    '/health/ready',
    async (): Promise<HealthResponse & { dependencies: Record<string, string> }> => ({
      status: 'ready',
      dependencies: { database: 'unknown', redis: 'unknown', objectStorage: 'unknown' },
    }),
  );

  return app;
}
