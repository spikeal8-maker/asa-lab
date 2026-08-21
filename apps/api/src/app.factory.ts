import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, FastifyReply } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCompress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import pg from 'pg';
import type { RuntimeMetrics } from '@asa-lab/observability';
import { AppModule } from './app.module.js';
import { TOKENS } from './tokens.js';
import {
  isAllowedMutationOrigin,
  resolveAdditionalWebOrigins,
  resolveCanonicalWebOrigin,
} from './origin-policy.js';
import { MutationAbuseProtection } from './abuse-protection.js';

/**
 * Content-hashed filenames may be cached forever; anything else may not.
 *
 * This is the one rule here that cannot be taken back: a file served as
 * immutable stays in a visitor's browser for a year, and no server-side fix
 * reaches it. So the permission is granted by filename shape — Vite's
 * `name-hash.ext` — and never by directory. `dist/assets/` also holds
 * owner-supplied electronics artwork copied verbatim from `public/`, which has
 * no hash and must stay revalidated.
 */
// The hash segment may not itself contain a hyphen. Allowing one lets an
// ordinary descriptive name qualify — `noto-sans-symbols-2-v25-symbols.woff2`
// matched before this was tightened. A build hash that happens to contain a
// hyphen simply falls back to revalidation, which is the safe direction to err.
const HASHED_ASSET = /-[A-Za-z0-9_]{8,}\.[A-Za-z0-9]+$/;

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    'upgrade-insecure-requests',
  ].join('; '),
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Permitted-Cross-Domain-Policies': 'none',
} as const;

export function cacheControlFor(fileName: string): string {
  return HASHED_ASSET.test(fileName) ? 'public, max-age=31536000, immutable' : 'no-cache';
}

function applyCacheControl(reply: FastifyReply, filePath: string): void {
  void reply.header('Cache-Control', cacheControlFor(basename(filePath)));
}

/**
 * An API with no request log and no metrics is indistinguishable from a healthy
 * one while it is failing. Logging stays on by default and quiet under the test
 * runner; the line carries technical fields only — no query string, no body, no
 * headers — because identifiers travel in those.
 */
function shouldLogRequests(explicit: boolean | undefined): boolean {
  if (explicit !== undefined) return explicit;
  if (process.env['VITEST'] !== undefined) return false;
  return process.env['ASA_HTTP_LOG'] !== '0';
}

export interface ApiFactoryOptions {
  /** Injected pool (tests); otherwise built from APP_DATABASE_URL only. */
  readonly pool?: pg.Pool | null;
  /** Directory with the built web SPA; defaults to apps/web/dist. */
  readonly webDist?: string | null;
  /** Canonical browser origin allowed to call mutation endpoints. */
  readonly allowedWebOrigin?: string;
  /** Additional explicit HTTPS origins used by the production deployment. */
  readonly additionalAllowedOrigins?: readonly string[];
  /** One structured line per response. Defaults on, off under the test runner. */
  readonly logRequests?: boolean;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`);
  }
  return value;
}

/**
 * Ten connections is measured, not guessed: at fifty the same tenant workload
 * ran slower and with a far worse tail, because the contention moves into
 * PostgreSQL. It is configurable so a different deployment can be measured
 * rather than argued about, and the default stays where the evidence is.
 *
 * The timeouts matter more than the size. Without them a single slow statement
 * holds its connection indefinitely and every caller behind it waits with no
 * upper bound, so a slow query becomes an outage instead of a slow response.
 */
export function poolSettings(): pg.PoolConfig {
  return {
    max: positiveInteger('ASA_DB_POOL_MAX', 10),
    connectionTimeoutMillis: positiveInteger('ASA_DB_CONNECTION_TIMEOUT_MS', 5_000),
    idleTimeoutMillis: positiveInteger('ASA_DB_IDLE_TIMEOUT_MS', 30_000),
    statement_timeout: positiveInteger('ASA_DB_STATEMENT_TIMEOUT_MS', 15_000),
    query_timeout: positiveInteger('ASA_DB_QUERY_TIMEOUT_MS', 15_000),
  };
}

function defaultPool(): pg.Pool | null {
  const url = process.env['APP_DATABASE_URL'];
  return url ? new pg.Pool({ connectionString: url, ...poolSettings() }) : null;
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
  const additionalAllowedOrigins =
    options.additionalAllowedOrigins ??
    resolveAdditionalWebOrigins(process.env['ASA_PUBLIC_WEB_ORIGINS']);
  const adapter = new FastifyAdapter({ genReqId: () => randomUUID(), logger: false });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forPool(pool), adapter, {
    logger: ['error', 'warn'],
  });

  // Nest's adapter exposes a differently-parameterised FastifyInstance; one
  // deliberate boundary cast lets the canonical plugin types apply.
  const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
  await fastify.register(fastifyCookie);

  fastify.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!reply.hasHeader(name)) void reply.header(name, value);
    }
    return payload;
  });

  // Caddy compresses in front of the API in production, but dev, the browser
  // E2E stack and every local measurement talk to the API directly. Without
  // this they were measuring an uncompressed site that no user would receive,
  // which makes the numbers meaningless in both directions.
  await fastify.register(fastifyCompress, {
    global: true,
    threshold: 1024,
    encodings: ['br', 'gzip', 'deflate'],
  });

  const metrics = app.get<RuntimeMetrics>(TOKENS.runtimeMetrics, { strict: false });
  const logRequests = shouldLogRequests(options.logRequests);
  const mutationAbuseProtection = new MutationAbuseProtection();

  fastify.addHook('onRequest', async () => {
    metrics.requestStarted();
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const durationMs = Math.round(reply.elapsedTime);
    metrics.requestFinished(reply.statusCode, durationMs);
    if (logRequests) {
      const path = (request.raw.url ?? '/').split('?')[0];
      process.stdout.write(
        `${JSON.stringify({
          time: new Date().toISOString(),
          requestId: request.id,
          method: request.method,
          path,
          status: reply.statusCode,
          durationMs,
        })}\n`,
      );
    }
  });

  fastify.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
    const path = (request.raw.url ?? '/').split('?')[0];
    if (
      process.env['NODE_ENV'] === 'production' &&
      process.env['ASA_PUBLIC_METRICS'] !== '1' &&
      path === '/health/metrics'
    ) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'not found' } });
    }
    const method = request.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return;
    }

    const allowed = isAllowedMutationOrigin({
      origin: request.headers.origin,
      requestHost: request.headers.host,
      requestProtocol: request.protocol,
      allowedWebOrigin,
      additionalAllowedOrigins,
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

    const abuse = mutationAbuseProtection.consume(request);
    if (!abuse.allowed) {
      void reply.header('retry-after', abuse.retryAfterSeconds);
      return reply.code(429).send({
        error: {
          code: 'too_many_requests',
          message: 'Слишком много запросов. Подождите и попробуйте снова.',
          retryAfterSeconds: abuse.retryAfterSeconds,
        },
      });
    }
  });

  const webDist =
    options.webDist !== undefined ? options.webDist : resolve(__dirname, '..', '..', 'web', 'dist');
  if (webDist && existsSync(join(webDist, 'index.html'))) {
    await fastify.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      cacheControl: false,
      setHeaders: applyCacheControl,
    });
    const indexHtml = readFileSync(join(webDist, 'index.html'), 'utf8');
    // SPA fallback as a lowest-priority wildcard route. API/health misses stay
    // JSON 404 responses rather than accidentally returning index.html.
    fastify.get('/*', async (request, reply) => {
      const url = request.raw.url ?? '/';
      if (url.startsWith('/api') || url.startsWith('/health')) {
        await reply.code(404).send({ error: { code: 'not_found', message: 'not found' } });
        return;
      }
      // The entry document names the hashed chunks, so it must never be held:
      // a cached index.html would point at files a deploy has already replaced.
      await reply
        .header('Cache-Control', 'no-cache')
        .type('text/html; charset=utf-8')
        .send(indexHtml);
    });
  }

  // The runtime launcher owns SIGINT/SIGTERM. Registering Nest shutdown hooks
  // here as well would call app.close twice for the same signal.
  fastify.addHook('onClose', async () => {
    // The event-loop histogram keeps a timer alive; leaving it running would
    // hold the process open after a graceful stop.
    metrics.stop();
    if (pool) await pool.end();
  });

  await app.init();
  return app;
}
