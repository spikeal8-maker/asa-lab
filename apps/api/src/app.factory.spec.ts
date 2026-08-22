import { afterEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { createApiApp } from './app.factory.js';

const apps: Array<Awaited<ReturnType<typeof createApiApp>>> = [];

afterEach(async () => {
  while (apps.length > 0) {
    await apps.pop()?.close();
  }
});

describe('API application factory', () => {
  it('constructs a health-only app without a database and reports 503 readiness', async () => {
    const app = await createApiApp({ pool: null, webDist: null });
    apps.push(app);
    const fastify = app.getHttpAdapter().getInstance();

    const live = await fastify.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: 'live' });
    expect(live.headers['x-request-id']).toBeTruthy();
    expect(live.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(live.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(live.headers['x-content-type-options']).toBe('nosniff');
    expect(live.headers['x-frame-options']).toBe('DENY');

    const ready = await fastify.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({
      status: 'not_ready',
      dependencies: { database: 'down' },
      deployment: {
        revision: 'development',
        builtAt: null,
        schemaVersion: null,
        expectedSchemaVersion: null,
        synchronized: null,
      },
    });
  });

  it('reports ready when the configured database probe succeeds', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [{ '?column?': 1 }] })),
      end: vi.fn(async () => undefined),
    } as unknown as pg.Pool;
    const app = await createApiApp({ pool, webDist: null });
    apps.push(app);
    const fastify = app.getHttpAdapter().getInstance();

    const ready = await fastify.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: 'ready',
      dependencies: { database: 'up' },
      deployment: {
        revision: 'development',
        builtAt: null,
        schemaVersion: null,
        expectedSchemaVersion: null,
        synchronized: null,
      },
    });
  });

  it('rejects the unrelated local project origin before any database query', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const pool = {
      query,
      end: vi.fn(async () => undefined),
    } as unknown as pg.Pool;
    const app = await createApiApp({
      pool,
      webDist: null,
      allowedWebOrigin: 'http://127.0.0.1:4610',
    });
    apps.push(app);
    const fastify = app.getHttpAdapter().getInstance();

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: '127.0.0.1:4611',
        origin: 'http://127.0.0.1:5173',
        'content-type': 'application/json',
      },
      payload: { workspace: 'school-1580', email: 'teacher@example.test', password: 'x' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('origin_forbidden');
    expect(query).not.toHaveBeenCalled();
  });

  it('accepts only the explicitly configured public production origin', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const pool = {
      query,
      end: vi.fn(async () => undefined),
    } as unknown as pg.Pool;
    const app = await createApiApp({
      pool,
      webDist: null,
      allowedWebOrigin: 'http://127.0.0.1:4610',
      additionalAllowedOrigins: ['https://asa-lab.ru'],
    });
    apps.push(app);
    const fastify = app.getHttpAdapter().getInstance();

    const accepted = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://asa-lab.ru', 'content-type': 'application/json' },
      payload: {},
    });
    expect(accepted.statusCode).toBe(400);

    const rejected = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: {},
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.code).toBe('origin_forbidden');
  });

  it('hides detailed runtime metrics in production', async () => {
    const previousNodeEnv = process.env['NODE_ENV'];
    const previousPublicMetrics = process.env['ASA_PUBLIC_METRICS'];
    process.env['NODE_ENV'] = 'production';
    delete process.env['ASA_PUBLIC_METRICS'];
    try {
      const app = await createApiApp({ pool: null, webDist: null });
      apps.push(app);
      const fastify = app.getHttpAdapter().getInstance();
      const response = await fastify.inject({ method: 'GET', url: '/health/metrics' });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: { code: 'not_found', message: 'not found' } });
    } finally {
      if (previousNodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = previousNodeEnv;
      if (previousPublicMetrics === undefined) delete process.env['ASA_PUBLIC_METRICS'];
      else process.env['ASA_PUBLIC_METRICS'] = previousPublicMetrics;
    }
  });

  it('requires the local bot proof before password work in production', async () => {
    const previousNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    const query = vi.fn(async () => ({ rows: [] }));
    const pool = {
      query,
      end: vi.fn(async () => undefined),
    } as unknown as pg.Pool;
    try {
      const app = await createApiApp({
        pool,
        webDist: null,
        allowedWebOrigin: 'https://asa-lab.ru',
      });
      apps.push(app);
      const fastify = app.getHttpAdapter().getInstance();
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: 'https://asa-lab.ru', 'content-type': 'application/json' },
        payload: { identifier: 'attacker', password: 'guess' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('bot_check_required');
      expect(query).not.toHaveBeenCalled();
    } finally {
      if (previousNodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = previousNodeEnv;
    }
  });
});
