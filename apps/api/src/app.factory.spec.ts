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

    const ready = await fastify.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: 'not_ready', dependencies: { database: 'down' } });
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
    expect(ready.json()).toEqual({ status: 'ready', dependencies: { database: 'up' } });
  });
});
