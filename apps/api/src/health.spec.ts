import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import type pg from 'pg';
import { HealthController } from './health.controller.js';

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

describe('health controller', () => {
  it('reports liveness', () => {
    expect(new HealthController(null).live()).toEqual({ status: 'live' });
  });

  it('reports 503 when no database pool is configured', async () => {
    const recorder = replyRecorder();
    const body = await new HealthController(null).ready(recorder.reply);
    expect(recorder.status()).toBe(503);
    expect(body).toEqual({ status: 'not_ready', dependencies: { database: 'down' } });
  });

  it('reports 200 when SELECT 1 succeeds', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [{ '?column?': 1 }] })),
    } as unknown as pg.Pool;
    const recorder = replyRecorder();
    const body = await new HealthController(pool).ready(recorder.reply);
    expect(recorder.status()).toBe(200);
    expect(body).toEqual({ status: 'ready', dependencies: { database: 'up' } });
  });

  it('reports 503 when the database query fails', async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    } as unknown as pg.Pool;
    const recorder = replyRecorder();
    const body = await new HealthController(pool).ready(recorder.reply);
    expect(recorder.status()).toBe(503);
    expect(body).toEqual({ status: 'not_ready', dependencies: { database: 'down' } });
  });
});
