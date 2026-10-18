import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { hashSessionToken } from '@asa-lab/identity';
import { GamesAccessController } from './games-access.controller.js';
import { TOKENS } from './tokens.js';

const classId = '11111111-1111-4111-8111-111111111111';
const seatId = '22222222-2222-4222-8222-222222222222';
const tenantId = '33333333-3333-4333-8333-333333333333';
const account = { resolve: vi.fn() };
const seats = { resolve: vi.fn() };
const query = vi.fn();
const release = vi.fn();
const transactionQuery = vi.fn(async (sql: string, params?: unknown[]) => {
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
  return query(sql, params);
});
const connect = vi.fn(async () => ({ query: transactionQuery, release }));
let app: NestFastifyApplication;
@Module({})
class TestModule {}
beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(
    {
      module: TestModule,
      controllers: [GamesAccessController],
      providers: [
        { provide: TOKENS.activeContextUseCase, useValue: account },
        { provide: TOKENS.seatContextUseCase, useValue: seats },
        { provide: TOKENS.pool, useValue: { query, connect } },
      ],
    },
    new FastifyAdapter(),
    { logger: false },
  );
  await app.register(cookie);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app?.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  account.resolve.mockResolvedValue({
    principalId: 'account-principal',
    tenantId,
    accountId: 'account',
  });
  seats.resolve.mockResolvedValue({
    principalId: 'seat-principal',
    tenantId,
    classroomId: classId,
    seatId,
  });
  query.mockResolvedValue({
    rows: [
      {
        data: {
          eligible: true,
          state: 'active',
          mode: 'allow',
          threshold: null,
          override: 'inherit',
          rating: 90,
          roster: ['must not escape'],
          principalId: 'must not escape',
        },
      },
    ],
  });
});
function inject(
  url = '/api/games/access?game=chess',
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  payload?: Record<string, unknown>,
  both = true,
) {
  return app.inject({
    method,
    url,
    headers: {
      cookie: both ? 'asa_session=account; asa_student_session=seat' : 'asa_session=account',
    },
    ...(payload === undefined ? {} : { payload }),
  });
}
describe('games controller in isolated HTTP module', () => {
  it('uses Seat with both cookies, hashes its session, minimizes output and disables caching', async () => {
    const response = await inject();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ granted: true, reason: 'allowed', threshold: null });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(account.resolve).not.toHaveBeenCalled();
    expect(query.mock.calls[0]?.[1]).toEqual([
      'seat-principal',
      tenantId,
      classId,
      seatId,
      hashSessionToken('seat'),
    ]);
  });
  it.each([null, undefined])(
    'invalid/revoked Seat never falls back to Account (%s)',
    async (resolved) => {
      seats.resolve.mockResolvedValue(resolved);
      expect((await inject()).statusCode).toBe(401);
      expect(account.resolve).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    },
  );
  it('denies a DB-revoked Seat after successful resolution', async () => {
    query.mockResolvedValue({ rows: [{ data: null }] });
    expect((await inject()).json()).toEqual({
      granted: false,
      reason: 'access_unavailable',
      threshold: null,
    });
  });
  it('treats an empty Seat cookie as selected invalid context, never Account play', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/games/access?game=chess',
      headers: { cookie: 'asa_session=account; asa_student_session=' },
    });
    expect(response.statusCode).toBe(401);
    expect(account.resolve).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
  it.each(['chess', 'checkers'])(
    'preserves independent Account offline admission for %s',
    async (game) => {
      expect(
        (await inject(`/api/games/access?game=${game}`, 'GET', undefined, false)).json().granted,
      ).toBe(true);
      expect(seats.resolve).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    },
  );
  it('requires authenticated Account when there is no Seat cookie', async () => {
    account.resolve.mockResolvedValue(null);
    expect((await inject(undefined, 'GET', undefined, false)).statusCode).toBe(401);
  });
  it.each(['seatId', 'classroomId', 'tenantId', 'principalId', 'projectId'])(
    'rejects client %s substitution',
    async (key) => {
      expect((await inject(`/api/games/access?game=chess&${key}=${seatId}`)).statusCode).toBe(400);
      expect(query).not.toHaveBeenCalled();
    },
  );
  it('has no POST admission bypass or online entitlement', async () => {
    expect(
      (await inject('/api/games/access?game=chess', 'POST', { granted: true })).statusCode,
    ).toBe(404);
    expect((await inject('/api/games/access?game=chess-live')).statusCode).toBe(400);
  });
  it('rejects Seat-as-teacher and keeps account identity out of policy writes', async () => {
    expect(
      (
        await inject(`/api/games/classrooms/${classId}/policy`, 'PUT', {
          mode: 'allow',
          threshold: null,
          expectedVersion: 0,
        })
      ).statusCode,
    ).toBe(403);
    expect(account.resolve).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
  it('passes only trusted teacher actor/tenant to DB and maps CAS conflict to 409', async () => {
    query.mockResolvedValue({ rows: [{ data: { error: 'version_conflict' } }] });
    const body = { mode: 'deny', threshold: null, expectedVersion: 4 };
    expect(
      (await inject(`/api/games/classrooms/${classId}/policy`, 'PUT', body, false)).statusCode,
    ).toBe(409);
    expect(query.mock.calls[0]?.[1]).toEqual([
      'account-principal',
      tenantId,
      classId,
      null,
      'class',
      JSON.stringify(body),
    ]);
  });
  it('reads configuration and effective Seat admission on one repeatable snapshot and minimizes the result', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          data: {
            mode: 'rating_threshold',
            threshold: 50,
            state: 'active',
            version: 2,
            override: 'inherit',
          },
        },
      ],
    });
    query.mockResolvedValueOnce({
      rows: [
        {
          data: {
            eligible: true,
            state: 'active',
            mode: 'rating_threshold',
            threshold: 50,
            override: 'inherit',
            rating: 49,
            principalId: 'private',
            roster: ['private'],
          },
        },
      ],
    });
    const response = await inject(
      `/api/games/classrooms/${classId}/seats/${seatId}`,
      'GET',
      undefined,
      false,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mode: 'rating_threshold',
      threshold: 50,
      state: 'active',
      version: 2,
      override: 'inherit',
      admission: { granted: false, reason: 'rating_below_threshold', threshold: 50 },
    });
    expect(transactionQuery.mock.calls[0]?.[0]).toBe(
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    expect(transactionQuery.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(connect).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
  it('rolls back a denied policy change and releases its transaction', async () => {
    query.mockResolvedValue({ rows: [{ data: { error: 'forbidden' } }] });
    const response = await inject(
      `/api/games/classrooms/${classId}/policy`,
      'PUT',
      { mode: 'allow', threshold: null, expectedVersion: 0 },
      false,
    );
    expect(response.statusCode).toBe(403);
    expect(transactionQuery.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(transactionQuery.mock.calls.some((call) => call[0] === 'COMMIT')).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
  it('maps unauthorized/foreign class or Seat to forbidden', async () => {
    query.mockResolvedValue({ rows: [{ data: null }] });
    expect(
      (await inject(`/api/games/classrooms/${classId}/seats/${seatId}`, 'GET', undefined, false))
        .statusCode,
    ).toBe(403);
  });
  it('rejects injected actors and supports audited soft revoke/reset routes', async () => {
    const url = `/api/games/classrooms/${classId}/policy`;
    expect((await inject(url, 'PUT', { principalId: 'attacker' }, false)).statusCode).toBe(400);
    query.mockResolvedValue({ rows: [{ data: { state: 'revoked', version: 1 } }] });
    expect((await inject(url, 'DELETE', { expectedVersion: 0 }, false)).statusCode).toBe(200);
    expect(query.mock.calls.at(-1)?.[1]?.[4]).toBe('revoke');
    await inject(
      `/api/games/classrooms/${classId}/seats/${seatId}`,
      'DELETE',
      { expectedVersion: 1 },
      false,
    );
    expect(
      JSON.parse(
        query.mock.calls
          .filter((call) => String(call[0]).includes('policy_write'))
          .at(-1)?.[1]?.[5],
      ),
    ).toEqual({
      expectedVersion: 1,
      override: 'inherit',
    });
  });
});
