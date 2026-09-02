import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { createApiApp, shouldServeSpaDocument } from './app.factory.js';

const apps: Array<Awaited<ReturnType<typeof createApiApp>>> = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (apps.length > 0) {
    await apps.pop()?.close();
  }
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe('API application factory', () => {
  it('serves the SPA only for real browser routes, not arbitrary crawl paths', () => {
    expect(shouldServeSpaDocument('/')).toBe(true);
    expect(shouldServeSpaDocument('/max-login')).toBe(true);
    expect(shouldServeSpaDocument('/max-login/')).toBe(true);
    expect(shouldServeSpaDocument('/projects/project-1/electronics/edit')).toBe(true);
    expect(shouldServeSpaDocument('/features/unknown-product-page')).toBe(false);
    expect(shouldServeSpaDocument('/definitely-not-a-page')).toBe(false);
    expect(shouldServeSpaDocument('/api/unknown')).toBe(false);
  });

  it('marks application documents noindex while preserving the public root and real 404s', async () => {
    const webDist = await mkdtemp(join(tmpdir(), 'asa-lab-seo-routes-'));
    temporaryDirectories.push(webDist);
    await writeFile(
      join(webDist, 'index.html'),
      '<!doctype html><html><body>ASA Lab</body></html>',
    );

    const app = await createApiApp({ pool: null, webDist });
    apps.push(app);
    const fastify = app.getHttpAdapter().getInstance();

    const root = await fastify.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.headers['x-robots-tag']).toBeUndefined();

    for (const url of ['/max-login', '/projects/project-1/electronics/edit']) {
      const applicationRoute = await fastify.inject({ method: 'GET', url });
      expect(applicationRoute.statusCode).toBe(200);
      expect(applicationRoute.headers['x-robots-tag']).toBe('noindex, nofollow');
    }

    const unknownPublic = await fastify.inject({ method: 'GET', url: '/not-a-real-page' });
    expect(unknownPublic.statusCode).toBe(404);
    const unknownApi = await fastify.inject({ method: 'GET', url: '/api/not-a-real-endpoint' });
    expect(unknownApi.statusCode).toBe(404);
  });

  it('constructs a health-only app without a database and reports 503 readiness', async () => {
    const app = await createApiApp({ pool: null, webDist: null });
    apps.push(app);
    const fastify = app.getHttpAdapter().getInstance();

    const live = await fastify.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: 'live' });
    expect(live.headers['x-request-id']).toBeTruthy();
    expect(live.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(live.headers['content-security-policy']).toContain(
      "script-src 'self' https://st.max.ru",
    );
    expect(live.headers['content-security-policy']).toContain("connect-src 'self' blob:");
    expect(live.headers['content-security-policy']).toContain("worker-src 'self' blob:");
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
        artifactIntegrity: 'unknown',
        artifactVerifiedAt: null,
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
        artifactIntegrity: 'unknown',
        artifactVerifiedAt: null,
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
      expect(query).toHaveBeenCalledTimes(1);
      expect(String(query.mock.calls[0]?.[0])).toContain('analytics_record_event');
    } finally {
      if (previousNodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = previousNodeEnv;
    }
  });

  it('exposes preview login only for the explicitly enabled loopback origin', async () => {
    const previous = {
      nodeEnv: process.env['NODE_ENV'],
      enabled: process.env['ASA_LOCAL_PREVIEW_LOGIN'],
      origin: process.env['ASA_LOCAL_PREVIEW_ORIGIN'],
      email: process.env['ASA_LOCAL_PREVIEW_EMAIL'],
      password: process.env['ASA_LOCAL_PREVIEW_PASSWORD'],
    };
    process.env['NODE_ENV'] = 'test';
    process.env['ASA_LOCAL_PREVIEW_LOGIN'] = '1';
    process.env['ASA_LOCAL_PREVIEW_ORIGIN'] = 'http://127.0.0.1:4613';
    process.env['ASA_LOCAL_PREVIEW_EMAIL'] = 'preview-owner@local.test';
    process.env['ASA_LOCAL_PREVIEW_PASSWORD'] = 'test-preview-password';
    try {
      const app = await createApiApp({ pool: null, webDist: null });
      apps.push(app);
      const fastify = app.getHttpAdapter().getInstance();

      const local = await fastify.inject({
        method: 'GET',
        url: '/api/auth/local-preview/config',
        headers: { host: '127.0.0.1:4613' },
      });
      expect(local.statusCode).toBe(200);
      expect(local.json()).toEqual({ enabled: true });

      const wrongHost = await fastify.inject({
        method: 'GET',
        url: '/api/auth/local-preview/config',
        headers: { host: 'asa-lab.ru' },
      });
      expect(wrongHost.statusCode).toBe(200);
      expect(wrongHost.json()).toEqual({ enabled: false });

      process.env['NODE_ENV'] = 'production';
      const production = await fastify.inject({
        method: 'GET',
        url: '/api/auth/local-preview/config',
        headers: { host: '127.0.0.1:4613' },
      });
      expect(production.statusCode).toBe(200);
      expect(production.json()).toEqual({ enabled: false });
    } finally {
      for (const [name, value] of [
        ['NODE_ENV', previous.nodeEnv],
        ['ASA_LOCAL_PREVIEW_LOGIN', previous.enabled],
        ['ASA_LOCAL_PREVIEW_ORIGIN', previous.origin],
        ['ASA_LOCAL_PREVIEW_EMAIL', previous.email],
        ['ASA_LOCAL_PREVIEW_PASSWORD', previous.password],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
