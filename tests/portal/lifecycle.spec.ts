import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import net from 'node:net';
import pg from 'pg';
import { createApiApp } from '../../apps/api/dist/app.factory.js';
import { startApi } from '../../apps/api/dist/main.js';

/** HTTP lifecycle regression: health probes, request ids, telemetry ordering,
 * real startup and shutdown that releases the reserved test API port. */

const API_PORT = 4612;

function fakeTelemetry() {
  const calls: string[] = [];
  return {
    calls,
    start: () => {
      calls.push('start');
    },
    shutdown: async () => {
      calls.push('shutdown');
    },
  };
}

async function portFree(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const probe = net
      .createServer()
      .once('error', () => resolvePromise(false))
      .once('listening', () => probe.close(() => resolvePromise(true)))
      .listen(port, '127.0.0.1');
  });
}

beforeAll(() => {
  // The lifecycle suite runs the API against the isolated test database.
  const appTestUrl = process.env['APP_TEST_DATABASE_URL'];
  if (!appTestUrl) {
    throw new Error('APP_TEST_DATABASE_URL is required');
  }
  process.env['APP_DATABASE_URL'] = appTestUrl;
});

describe('health endpoints', () => {
  it('live is 200 with x-request-id; ready without a database is 503', async () => {
    const brokenPool = new pg.Pool({
      connectionString: 'postgres://nobody:nothing@127.0.0.1:9/broken',
      max: 1,
      connectionTimeoutMillis: 300,
    });
    const app = await createApiApp({ pool: brokenPool, webDist: null });
    try {
      const fastify = app.getHttpAdapter().getInstance();
      const live = await fastify.inject({ method: 'GET', url: '/health/live' });
      expect(live.statusCode).toBe(200);
      expect(live.headers['x-request-id']).toBeTruthy();
      const ready = await fastify.inject({ method: 'GET', url: '/health/ready' });
      expect(ready.statusCode).toBe(503);
      expect(ready.json().dependencies.database).toBe('down');
    } finally {
      await app.close();
    }
  });

  it('ready with a working database is 200', async () => {
    const pool = new pg.Pool({ connectionString: process.env['APP_DATABASE_URL'], max: 2 });
    const app = await createApiApp({ pool, webDist: null });
    try {
      const ready = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ method: 'GET', url: '/health/ready' });
      expect(ready.statusCode).toBe(200);
      expect(ready.json().dependencies.database).toBe('up');
    } finally {
      await app.close();
    }
  });
});

describe('startApi lifecycle contract', () => {
  it('starts telemetry first, serves real HTTP, then closes app before telemetry and releases the port', async () => {
    expect(await portFree(API_PORT)).toBe(true);
    const telemetry = fakeTelemetry();
    const runtime = await startApi({ telemetry, port: API_PORT });
    try {
      expect(telemetry.calls).toEqual(['start']);
      const live = await fetch(`http://127.0.0.1:${API_PORT}/health/live`);
      expect(live.status).toBe(200);
      expect(live.headers.get('x-request-id')).toBeTruthy();
    } finally {
      await runtime.close();
    }
    expect(telemetry.calls).toEqual(['start', 'shutdown']);
    // Idempotent repeat close: no double shutdown, no error.
    await runtime.close();
    expect(telemetry.calls).toEqual(['start', 'shutdown']);
    expect(await portFree(API_PORT)).toBe(true);
  });

  it('a startup error still shuts telemetry down', async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolvePromise) =>
      blocker.listen(API_PORT, '127.0.0.1', () => resolvePromise()),
    );
    const telemetry = fakeTelemetry();
    try {
      await expect(startApi({ telemetry, port: API_PORT })).rejects.toThrow();
      expect(telemetry.calls).toEqual(['start', 'shutdown']);
      expect(blocker.listening).toBe(true);
    } finally {
      blocker.close();
    }
  });

  it('fails closed without APP_DATABASE_URL before touching telemetry', async () => {
    const saved = process.env['APP_DATABASE_URL'];
    delete process.env['APP_DATABASE_URL'];
    const telemetry = fakeTelemetry();
    try {
      await expect(startApi({ telemetry, port: API_PORT })).rejects.toThrow(/APP_DATABASE_URL/);
      expect(telemetry.calls).toEqual([]);
    } finally {
      process.env['APP_DATABASE_URL'] = saved;
    }
  });
});

describe('process-level shutdown', () => {
  it('a signal stops the real API process and releases the canonical port', async () => {
    expect(await portFree(API_PORT)).toBe(true);
    const child = spawn('node', ['apps/api/dist/main.js'], {
      env: { ...process.env, API_PORT: String(API_PORT), API_HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let forced = false;
    let exitedCleanly = false;
    try {
      const deadline = Date.now() + 20000;
      let up = false;
      while (Date.now() < deadline && !up) {
        try {
          up = (await fetch(`http://127.0.0.1:${API_PORT}/health/live`)).status === 200;
        } catch {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      expect(up).toBe(true);
      child.kill('SIGTERM');
      exitedCleanly = await new Promise<boolean>((resolvePromise) => {
        const timer = setTimeout(() => resolvePromise(false), 10000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolvePromise(true);
        });
      });
      expect(exitedCleanly).toBe(true);
      expect(await portFree(API_PORT)).toBe(true);
    } finally {
      if (!exitedCleanly) {
        forced = true;
        child.kill();
      }
    }
    // Emergency cleanup must never be the mechanism that passes this test.
    expect(forced).toBe(false);
  }, 30_000);
});
