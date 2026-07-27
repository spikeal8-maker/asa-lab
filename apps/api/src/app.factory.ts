import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import pg from 'pg';
import { AppModule } from './app.module.js';
import { isAllowedMutationOrigin, resolveCanonicalWebOrigin } from './origin-policy.js';

export interface ApiFactoryOptions {
  /** Injected pool (tests); otherwise built from APP_DATABASE_URL only. */
  readonly pool?: pg.Pool | null;
  /** Directory with the built web SPA; defaults to apps/web/dist. */
  readonly webDist?: string | null;
  /** Canonical browser origin allowed to call mutation endpoints. */
  readonly allowedWebOrigin?: string;
}

function defaultPool(): pg.Pool | null {
  const url = process.env['APP_DATABASE_URL'];
  return url ? new pg.Pool({ connectionString: url, max: 10 }) : null;
}

function defaultWebOrigin(): string {
  return resolveCanonicalWebOrigin(process.env['ASA_WEB_PORT'], process.env['ASA_WEB_ORIGIN']);
}

/**
 * Build the NestJS (Fastify adapter) application: API + health + built SPA.
 * Mutating browser requests pass an explicit canonical-origin check in
 * addition to the HttpOnly SameSite session cookie.
 */
export async function createApiApp(
  options: ApiFactoryOptions = {},
): Promise<NestFastifyApplication> {
  const pool = options.pool !== undefined ? options.pool : defaultPool();
  const allowedWebOrigin = options.allowedWebOrigin ?? defaultWebOrigin();
  const adapter = new FastifyAdapter({ genReqId: () => randomUUID(), logger: false });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forPool(pool), adapter, {
    logger: ['error', 'warn'],
  });

  // Nest's adapter exposes a differently-parameterised FastifyInstance; one
  // deliberate boundary cast lets the canonical plugin types apply.
  const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);

  fastify.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
    const method = request.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return;
    }

    const allowed = isAllowedMutationOrigin({
      origin: request.headers.origin,
      requestHost: request.headers.host,
      requestProtocol: request.protocol,
      allowedWebOrigin,
      secFetchSite:
        typeof request.headers['sec-fetch-site'] === 'string'
          ? request.headers['sec-fetch-site']
          : undefined,
    });
    if (!allowed) {
      return reply
        .code(403)
        .send({ error: { code: 'origin_forbidden', message: 'request origin is not allowed' } });
    }
  });

  const webDist =
    options.webDist !== undefined ? options.webDist : resolve(__dirname, '..', '..', 'web', 'dist');
  if (webDist && existsSync(join(webDist, 'index.html'))) {
    await fastify.register(fastifyStatic, { root: webDist, wildcard: false });
    const indexHtml = readFileSync(join(webDist, 'index.html'), 'utf8');
    // SPA fallback as a lowest-priority wildcard route. API/health misses stay
    // JSON 404 responses rather than accidentally returning index.html.
    fastify.get('/*', async (request, reply) => {
      const url = request.raw.url ?? '/';
      if (url.startsWith('/api') || url.startsWith('/health')) {
        await reply.code(404).send({ error: { code: 'not_found', message: 'not found' } });
        return;
      }
      await reply.type('text/html; charset=utf-8').send(indexHtml);
    });
  }

  if (pool) {
    // The runtime launcher owns SIGINT/SIGTERM. Registering Nest shutdown hooks
    // here as well would call app.close twice for the same signal.
    fastify.addHook('onClose', async () => {
      await pool.end();
    });
  }

  await app.init();
  return app;
}
