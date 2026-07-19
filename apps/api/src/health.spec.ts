import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';

/** Readiness reflects the real PostgreSQL state: 503 without a pool, 200 with
 * a working database, 503 when the database query fails. */

function withoutDatabaseUrl<T>(fn: () => T): T {
  const saved = process.env['DATABASE_URL'];
  delete process.env['DATABASE_URL'];
  try {
    return fn();
  } finally {
    if (saved !== undefined) {
      process.env['DATABASE_URL'] = saved;
    }
  }
}

describe('liveness and request id', () => {
  const app = withoutDatabaseUrl(() => buildApp());

  afterAll(async () => {
    await app.close();
  });

  it('reports liveness with 200', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'live' });
  });

  it('sets a request id header', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('reports not_ready 503 when no database pool exists', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe('not_ready');
    expect(response.json().dependencies.database).toBe('down');
  });
});

describe('readiness with a real database', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  beforeAll(() => {
    const url = process.env['DATABASE_URL'];
    if (!url) {
      throw new Error('DATABASE_URL is required for the readiness integration test');
    }
    pool = new pg.Pool({ connectionString: url, max: 2 });
    app = buildApp({ pool });
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('reports ready 200 when PostgreSQL answers SELECT 1', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready', dependencies: { database: 'up' } });
  });
});

describe('readiness when the database query fails', () => {
  it('reports not_ready 503', async () => {
    const failingPool = {
      query: async () => {
        throw new Error('connection refused');
      },
    } as unknown as pg.Pool;
    const app = buildApp({ pool: failingPool });
    try {
      const response = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(response.statusCode).toBe(503);
      expect(response.json().dependencies.database).toBe('down');
    } finally {
      await app.close();
    }
  });
});
