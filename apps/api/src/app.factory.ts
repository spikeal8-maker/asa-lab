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

export interface ApiFactoryOptions {
  /** Injected pool (tests); otherwise built from APP_DATABASE_URL/DATABASE_URL. */
  readonly pool?: pg.Pool | null;
  /** Directory with the built web SPA; defaults to apps/web/dist. */
  readonly webDist?: string | null;
}

function defaultPool(): pg.Pool | null {
  // Runtime-role URL only: there is deliberately no DATABASE_URL fallback.
  const url = process.env['APP_DATABASE_URL'];
  return url ? new pg.Pool({ connectionString: url, max: 10 }) : null;
}

/**
 * Build the NestJS (Fastify adapter) application: API + health + built SPA.
 * Mutating requests pass an explicit same-origin check (plus SameSite=Lax
 * session cookies) as CSRF protection.
 */
export async function createApiApp(
  options: ApiFactoryOptions = {},
): Promise<NestFastifyApplication> {
  const pool = options.pool !== undefined ? options.pool : defaultPool();
  const adapter = new FastifyAdapter({ genReqId: () => randomUUID(), logger: false });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forPool(pool), adapter, {
    logger: ['error', 'warn'],
  });

  // Nest's adapter exposes a differently-parameterised FastifyInstance; one
  // deliberate boundary cast lets the canonical plugin types apply.
  const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);

  // Strict browser-origin policy for state-changing requests: only the API
  // origin itself (built SPA) or the explicitly configured dev web origin are
  // accepted. Anything else — other loopback ports, malformed or cross-site
  // origins, or a missing Origin header — is rejected (fail closed). This is
  // deliberately not CORS: no cross-origin is ever allowed.
  const webOrigin = process.env['ASA_WEB_ORIGIN'] ?? 'http://127.0.0.1:4610';
  fastify.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
    const method = request.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return;
    }
    const forbid = async (message: string): Promise<void> => {
      await reply.code(403).send({ error: { code: 'origin_forbidden', message } });
    };
    const origin = request.headers.origin;
    if (!origin) {
      await forbid('state-changing requests require an Origin header');
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      await forbid('malformed Origin header');
      return;
    }
    const sameOrigin =
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.host === request.headers.host;
    let allowedWebOrigin = false;
    try {
      const allowed = new URL(webOrigin);
      allowedWebOrigin = parsed.protocol === allowed.protocol && parsed.host === allowed.host;
    } catch {
      allowedWebOrigin = false;
    }
    if (!sameOrigin && !allowedWebOrigin) {
      await forbid('cross-origin request rejected');
    }
  });

  const webDist =
    options.webDist !== undefined ? options.webDist : resolve(__dirname, '..', '..', 'web', 'dist');
  if (webDist && existsSync(join(webDist, 'index.html'))) {
    await fastify.register(fastifyStatic, { root: webDist, wildcard: false });
    const indexHtml = readFileSync(join(webDist, 'index.html'), 'utf8');
    // SPA fallback as a lowest-priority wildcard route (Nest owns the real
    // not-found handler); API/health misses still return JSON 404.
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
    app.enableShutdownHooks();
    fastify.addHook('onClose', async () => {
      await pool.end();
    });
  }

  await app.init();
  return app;
}
