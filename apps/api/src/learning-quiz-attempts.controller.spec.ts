import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import type pg from 'pg';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { SeatContextUseCase } from './seat-context.js';
import { LearningQuizAttemptsController } from './learning-quiz-attempts.controller.js';
import { TOKENS } from './tokens.js';

const id = '10000000-0000-4000-8000-000000000001';
const request = {
  cookies: { asa_session: 'account', asa_student_session: 'seat' },
} as unknown as FastifyRequest;
function fixture(seat = true) {
  const seats = {
    resolve: vi.fn().mockResolvedValue(seat ? { principalId: 'seat-principal' } : null),
  };
  const accounts = { resolve: vi.fn().mockResolvedValue({ principalId: 'account-principal' }) };
  const pool = {
    query: vi.fn().mockResolvedValue({
      rows: [{ result_code: 'ok', attempt: { attemptId: id, version: 2 }, reused: true }],
    }),
  };
  return {
    seats,
    accounts,
    pool,
    controller: new LearningQuizAttemptsController(
      pool as unknown as pg.Pool,
      accounts as unknown as ActiveContextUseCase,
      seats as unknown as SeatContextUseCase,
    ),
  };
}
describe('canonical Quiz persistence HTTP boundary', () => {
  it('registers exact HTTP Start/read/save routes and ignores body authority with real Fastify injection', async () => {
    const f = fixture();
    @Module({})
    class TestModule {}
    const app = await NestFactory.create<NestFastifyApplication>(
      {
        module: TestModule,
        controllers: [LearningQuizAttemptsController],
        providers: [
          { provide: TOKENS.pool, useValue: f.pool },
          { provide: TOKENS.activeContextUseCase, useValue: f.accounts },
          { provide: TOKENS.seatContextUseCase, useValue: f.seats },
        ],
      },
      new FastifyAdapter(),
      { logger: false },
    );
    try {
      await app.register(cookie);
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      const headers = { cookie: 'asa_session=account; asa_student_session=seat' };
      const rejected = await app.inject({
        method: 'POST',
        url: `/api/learning/activity-participations/${id}/attempts`,
        headers,
        payload: { requestId: 'quiz:http:start', tenantId: id },
      });
      expect(rejected.statusCode).toBe(400);
      expect(f.pool.query).not.toHaveBeenCalled();
      const started = await app.inject({
        method: 'POST',
        url: `/api/learning/activity-participations/${id}/attempts`,
        headers,
        payload: { requestId: 'quiz:http:start' },
      });
      expect(started.statusCode).toBe(200);
      expect(f.pool.query.mock.calls.at(-1)?.[1]).toEqual([
        'seat-principal',
        id,
        'quiz:http:start',
      ]);
      const restored = await app.inject({
        method: 'GET',
        url: `/api/learning/attempts/${id}`,
        headers,
      });
      expect(restored.statusCode).toBe(200);
      expect(restored.headers['cache-control']).toBe('private, no-store');
      f.pool.query.mockResolvedValueOnce({ rows: [{ result_code: 'quiz_attempt_conflict' }] });
      const conflicted = await app.inject({
        method: 'PATCH',
        url: `/api/learning/attempts/${id}/quiz-answers`,
        headers,
        payload: { expectedVersion: 1, answers: {} },
      });
      expect(conflicted.statusCode).toBe(409);
      expect(conflicted.json()).toMatchObject({ error: { code: 'quiz_attempt_conflict' } });
      expect(f.accounts.resolve).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it('selects the verified Seat before an unrelated Account and never accepts caller identity', async () => {
    const f = fixture();
    await expect(
      f.controller.start(request, id, { requestId: 'quiz:start:0001', principalId: 'forged' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.pool.query).not.toHaveBeenCalled();
    await expect(
      f.controller.start(request, id, { requestId: 'quiz:start:0001' }),
    ).resolves.toMatchObject({ reused: true });
    expect(f.pool.query).toHaveBeenCalledWith(
      expect.stringContaining('learning_quiz_attempt_start'),
      ['seat-principal', id, 'quiz:start:0001'],
    );
    expect(f.accounts.resolve).not.toHaveBeenCalled();
  });
  it('uses Account authority when there is no usable Seat', async () => {
    const f = fixture(false);
    await f.controller.read(request, id);
    expect(f.pool.query).toHaveBeenCalledWith(
      expect.stringContaining('learning_quiz_attempt_read'),
      ['account-principal', id],
    );
  });
  it('does not disclose absent versus foreign attempts and preserves optimistic conflicts', async () => {
    const f = fixture();
    f.pool.query.mockResolvedValueOnce({ rows: [{ attempt: null }] });
    await expect(f.controller.read(request, id)).rejects.toMatchObject({ status: 404 });
    f.pool.query.mockResolvedValueOnce({ rows: [{ result_code: 'quiz_attempt_conflict' }] });
    await expect(
      f.controller.save(request, id, { expectedVersion: 1, answers: {} }),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'quiz_attempt_conflict' } },
    });
  });
  it('rejects invalid version, oversized answers, extra fields and anonymous sessions before querying', async () => {
    const f = fixture();
    for (const body of [
      { expectedVersion: 0, answers: {} },
      { expectedVersion: 1, answers: [] },
      { expectedVersion: 1, answers: {}, tenantId: id },
      { expectedVersion: 1, answers: { [id]: { value: 'x'.repeat(262145) } } },
    ]) {
      await expect(f.controller.save(request, id, body)).rejects.toMatchObject({ status: 400 });
    }
    f.seats.resolve.mockResolvedValue(null);
    f.accounts.resolve.mockResolvedValue(null);
    await expect(f.controller.read(request, id)).rejects.toMatchObject({ status: 401 });
    expect(f.pool.query).not.toHaveBeenCalled();
  });
});
