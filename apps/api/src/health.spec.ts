import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import type pg from 'pg';
import { createRuntimeMetrics } from '@asa-lab/observability';
import { HealthController } from './health.controller.js';

const UNKNOWN_DEPLOYMENT = {
  revision: 'development',
  builtAt: null,
  schemaVersion: null,
  expectedSchemaVersion: null,
  synchronized: null,
} as const;

function replyRecorder(): { reply: FastifyReply; status: () => number } {
  let statusCode = 200;
  const reply = {
    code: vi.fn((code: number) => {
      statusCode = code;
      return reply;
    }),
  } as unknown as FastifyReply;
  return { reply, status: () => statusCode };
}

/** A pool whose probe never answers: the shape of a saturated connection pool. */
function stalledPool(): pg.Pool {
  return {
    query: vi.fn(() => new Promise(() => undefined)),
    totalCount: 10,
    idleCount: 0,
    waitingCount: 42,
  } as unknown as pg.Pool;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('health controller', () => {
  it('reports liveness', () => {
    expect(new HealthController(null, null).live()).toEqual({ status: 'live' });
  });

  it('reports 503 when no database pool is configured', async () => {
    const recorder = replyRecorder();
    const body = await new HealthController(null, null).ready(recorder.reply);
    expect(recorder.status()).toBe(503);
    expect(body).toEqual({
      status: 'not_ready',
      dependencies: { database: 'down' },
      deployment: UNKNOWN_DEPLOYMENT,
    });
  });

  it('reports 200 when SELECT 1 succeeds', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [{ '?column?': 1 }] })),
    } as unknown as pg.Pool;
    const recorder = replyRecorder();
    const body = await new HealthController(pool, null).ready(recorder.reply);
    expect(recorder.status()).toBe(200);
    expect(body).toEqual({
      status: 'ready',
      dependencies: { database: 'up' },
      deployment: UNKNOWN_DEPLOYMENT,
    });
  });

  it('reports 503 when the database query fails', async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    } as unknown as pg.Pool;
    const recorder = replyRecorder();
    const body = await new HealthController(pool, null).ready(recorder.reply);
    expect(recorder.status()).toBe(503);
    expect(body).toEqual({
      status: 'not_ready',
      dependencies: { database: 'down' },
      deployment: UNKNOWN_DEPLOYMENT,
    });
  });
});

describe('readiness under congestion', () => {
  it('stays ready while the pool is merely busy', async () => {
    vi.useFakeTimers();
    const controller = new HealthController(stalledPool(), null);
    const recorder = replyRecorder();

    const pending = controller.ready(recorder.reply);
    await vi.advanceTimersByTimeAsync(1600);
    const body = await pending;

    // Congestion must not look like an outage: an orchestrator would pull a
    // healthy instance out of rotation exactly when it is needed most.
    expect(recorder.status()).toBe(200);
    expect(body).toEqual({
      status: 'ready',
      dependencies: { database: 'busy' },
      deployment: UNKNOWN_DEPLOYMENT,
    });
  });

  it('gives up and reports unavailable once the database keeps not answering', async () => {
    vi.useFakeTimers();
    const controller = new HealthController(stalledPool(), null);
    let body = {
      status: 'ready',
      dependencies: { database: 'busy' },
      deployment: UNKNOWN_DEPLOYMENT,
    } as Awaited<ReturnType<HealthController['ready']>>;
    let status = 200;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const recorder = replyRecorder();
      const pending = controller.ready(recorder.reply);
      await vi.advanceTimersByTimeAsync(1600);
      body = await pending;
      status = recorder.status();
    }

    expect(status).toBe(503);
    expect(body).toEqual({
      status: 'not_ready',
      dependencies: { database: 'down' },
      deployment: UNKNOWN_DEPLOYMENT,
    });
  });

  it('forgets the congestion streak as soon as the database answers again', async () => {
    vi.useFakeTimers();
    const query = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockImplementation(async () => ({ rows: [{ '?column?': 1 }] }));
    const pool = { query } as unknown as pg.Pool;
    const controller = new HealthController(pool, null);

    const first = replyRecorder();
    const pending = controller.ready(first.reply);
    await vi.advanceTimersByTimeAsync(1600);
    await pending;

    const second = replyRecorder();
    const body = await controller.ready(second.reply);
    expect(second.status()).toBe(200);
    expect(body).toEqual({
      status: 'ready',
      dependencies: { database: 'up' },
      deployment: UNKNOWN_DEPLOYMENT,
    });
  });
});

describe('runtime metrics', () => {
  it('says so plainly when metrics are not enabled', () => {
    const body = new HealthController(null, null).metrics();
    expect(body).toEqual({
      error: { code: 'metrics_disabled', message: 'runtime metrics are not enabled' },
    });
  });

  it('reports request counters, loop delay and pool saturation', () => {
    const metrics = createRuntimeMetrics();
    metrics.requestStarted();
    metrics.requestFinished(200, 12);
    metrics.requestStarted();
    metrics.requestFinished(503, 40);
    metrics.requestStarted();

    const controller = new HealthController(stalledPool(), metrics);
    const snapshot = controller.metrics();
    metrics.stop();

    expect(snapshot).toMatchObject({
      requests: {
        total: 2,
        inFlight: 1,
        byStatusClass: { '2xx': 1, '5xx': 1 },
      },
      database: { total: 10, idle: 0, waiting: 42 },
    });
    expect('eventLoopDelayMs' in snapshot).toBe(true);
    expect(snapshot).toMatchObject({
      host: {
        cpuUsedByApiPercent: expect.any(Number),
        logicalCpuCount: expect.any(Number),
        memoryTotalMb: expect.any(Number),
        memoryUsedPercent: expect.any(Number),
      },
    });
  });

  it('keeps no request payload, only technical counters', () => {
    const metrics = createRuntimeMetrics();
    metrics.requestStarted();
    metrics.requestFinished(200, 5);
    const snapshot = metrics.snapshot(null);
    metrics.stop();

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/password|token|email|cookie/i);
  });
});
