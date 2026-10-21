import type { ActiveContextUseCase } from '@asa-lab/identity';
import { HttpException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AiAccessController } from './ai-access.controller';
import { AiAccessService, aiRequestActor, aiSeatSelector } from './ai-access.service';
import { AiChatController } from './ai-chat.controller';
import type { AiChatService } from './ai-chat.service';
import { SeatContextUseCase } from './seat-context';

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SEAT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLASS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function request(cookies: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return { cookies, headers } as unknown as FastifyRequest;
}
function identities(validSeat = true) {
  const accounts = { resolve: vi.fn(async () => ({ principalId: ACCOUNT, accountId: ACCOUNT })) };
  const seats = {
    resolveExistingState: vi.fn(async () =>
      validSeat
        ? { state: 'resolved', context: { principalId: SEAT } }
        : { state: 'invalid_session' },
    ),
  };
  return {
    accounts: accounts as unknown as ActiveContextUseCase,
    seats: seats as unknown as SeatContextUseCase,
  };
}

describe('AI trusted scope selection', () => {
  it.each(['existing', 'missing', 'wrong-class', 'revoked', 'expired'] as const)(
    'resolves existing Seat identity without invoking an initializer: %s',
    async (state) => {
      const query = vi.fn(async (sql: string) => ({
        rows: sql.includes('classroom_student_session_context')
          ? state === 'revoked' || state === 'expired'
            ? []
            : [{ seat_id: SEAT, classroom_id: CLASS, display_label: 'Ученик', safe_mode: true }]
          : state === 'missing'
            ? []
            : [
                {
                  principal_id: SEAT,
                  tenant_id: ACCOUNT,
                  classroom_id: state === 'wrong-class' ? ACCOUNT : CLASS,
                },
              ],
      }));
      const context = await new SeatContextUseCase({ query } as unknown as pg.Pool).resolveExisting(
        'trusted-token',
      );
      expect(context).toEqual(
        state === 'existing'
          ? {
              principalId: SEAT,
              tenantId: ACCOUNT,
              seatId: SEAT,
              classroomId: CLASS,
              displayName: 'Ученик',
              safeMode: true,
              userId: null,
            }
          : null,
      );
      expect(query.mock.calls.every(([sql]) => !sql.includes('student_seat_principal('))).toBe(
        true,
      );
      if (state === 'revoked' || state === 'expired') expect(query).toHaveBeenCalledTimes(1);
    },
  );
  it('resolves only the Seat actor; the global HTTP boundary separately rejects mixed sessions', async () => {
    const { accounts, seats } = identities();
    for (const cookies of [
      { asa_student_session: 'seat' },
      { asa_student_session: 'seat', asa_session: 'account' },
    ]) {
      expect(await aiRequestActor(request(cookies), accounts, seats)).toBe(SEAT);
    }
    expect(accounts.resolve).not.toHaveBeenCalled();
  });
  it.each(['forged', '', 'revoked', 'expired'])(
    'never falls back to Account for an invalid Seat cookie: %s',
    async (token) => {
      const { accounts, seats } = identities(false);
      await expect(
        aiRequestActor(
          request({ asa_student_session: token, asa_session: 'account' }),
          accounts,
          seats,
        ),
      ).rejects.toMatchObject({ code: 'ai_session_required', status: 401 });
      expect(accounts.resolve).not.toHaveBeenCalled();
    },
  );
  it('keeps personal Account scope as the default only without a Seat session', async () => {
    const { accounts, seats } = identities();
    expect(await aiRequestActor(request({ asa_session: 'account' }), accounts, seats)).toBe(
      ACCOUNT,
    );
    expect(seats.resolveExistingState).not.toHaveBeenCalled();
  });
  it('normalizes only UUID selectors and never accepts a principal or arbitrary scope expression', () => {
    expect(aiSeatSelector(request())).toBeNull();
    expect(aiSeatSelector(request({}, { 'x-asa-ai-seat': SEAT.toUpperCase() }))).toBe(SEAT);
    expect(() => aiSeatSelector(request({}, { 'x-asa-ai-seat': 'personal' }))).toThrow();
  });
  it('passes the authenticated actor and requested Seat separately to the SQL authority check', async () => {
    const query = vi.fn(async () => ({ rows: [{ value: SEAT }] }));
    expect(await new AiAccessService({ query } as unknown as pg.Pool).owner(ACCOUNT, SEAT)).toBe(
      SEAT,
    );
    expect(query).toHaveBeenCalledWith('SELECT ai_access_owner($1,$2) AS value', [ACCOUNT, SEAT]);
  });
});

describe('AI session HTTP error contract', () => {
  it.each(['revoked', 'expired', 'unknown', 'empty', 'missing'] as const)(
    'preserves 401 for %s sessions through both AI controllers before any owner admission',
    async (state) => {
      const accounts = {
        resolve: vi.fn(async () =>
          state === 'missing' ? null : { principalId: ACCOUNT, accountId: ACCOUNT },
        ),
      };
      const seats = { resolveExistingState: vi.fn(async () => ({ state: 'invalid_session' })) };
      const query = vi.fn();
      const access = new AiAccessService({ query } as unknown as pg.Pool);
      const ai = { status: vi.fn() };
      const accountContext = accounts as unknown as ActiveContextUseCase;
      const seatContext = seats as unknown as SeatContextUseCase;
      const scopes = new AiAccessController(accountContext, seatContext, access);
      const chat = new AiChatController(
        accountContext,
        ai as unknown as AiChatService,
        seatContext,
        access,
      );
      const req = request(
        state === 'missing'
          ? {}
          : { asa_student_session: state === 'empty' ? '' : state, asa_session: 'account' },
      );
      for (const call of [() => scopes.scopes(req), () => chat.status(req)]) {
        const problem = await call().catch((error: unknown) => error);
        expect(problem).toBeInstanceOf(HttpException);
        expect((problem as HttpException).getStatus()).toBe(401);
        expect((problem as HttpException).getResponse()).toMatchObject({
          error: { code: 'ai_session_required' },
        });
      }
      if (state === 'missing') {
        expect(accounts.resolve).toHaveBeenCalledWith(undefined);
        expect(seats.resolveExistingState).not.toHaveBeenCalled();
      } else {
        expect(accounts.resolve).not.toHaveBeenCalled();
      }
      expect(query).not.toHaveBeenCalled();
      expect(ai.status).not.toHaveBeenCalled();
    },
  );

  it.each(['missing', 'wrong-class', 'empty-principal', 'empty-tenant'] as const)(
    'returns 403 for valid Seat sessions with %s owner projection without Account fallback',
    async (state) => {
      const query = vi.fn(async (sql: string) => ({
        rows: sql.includes('classroom_student_session_context')
          ? [{ seat_id: SEAT, classroom_id: CLASS, display_label: 'Ученик', safe_mode: true }]
          : state === 'missing'
            ? []
            : [
                {
                  principal_id: state === 'empty-principal' ? '' : SEAT,
                  tenant_id: state === 'empty-tenant' ? '' : ACCOUNT,
                  classroom_id: state === 'wrong-class' ? ACCOUNT : CLASS,
                },
              ],
      }));
      const seats = new SeatContextUseCase({ query } as unknown as pg.Pool);
      expect(await seats.resolveExistingState('valid-session')).toEqual({
        state: 'unavailable_owner',
      });
      const { accounts } = identities();
      const ownerQuery = vi.fn();
      const access = new AiAccessService({ query: ownerQuery } as unknown as pg.Pool);
      const ai = { status: vi.fn() };
      const scopes = new AiAccessController(accounts, seats, access);
      const chat = new AiChatController(accounts, ai as unknown as AiChatService, seats, access);
      const req = request({
        asa_student_session: 'valid-session',
        asa_session: 'retained-account',
      });
      for (const call of [() => scopes.scopes(req), () => chat.status(req)]) {
        const problem = await call().catch((error: unknown) => error);
        expect(problem).toBeInstanceOf(HttpException);
        expect((problem as HttpException).getStatus()).toBe(403);
        expect((problem as HttpException).getResponse()).toMatchObject({
          error: { code: 'ai_scope_denied' },
        });
      }
      expect(accounts.resolve).not.toHaveBeenCalled();
      expect(ownerQuery).not.toHaveBeenCalled();
      expect(ai.status).not.toHaveBeenCalled();
      expect(query.mock.calls.every(([sql]) => !sql.includes('student_seat_principal('))).toBe(
        true,
      );
    },
  );

  it('preserves the SQL wrong-Seat denial as 403 before provider or generation admission', async () => {
    const { accounts, seats } = identities();
    const query = vi.fn(async () => {
      throw new Error('AI_SCOPE_DENIED');
    });
    const ai = { status: vi.fn() };
    const chat = new AiChatController(
      accounts,
      ai as unknown as AiChatService,
      seats,
      new AiAccessService({ query } as unknown as pg.Pool),
    );
    const problem = await chat
      .status(request({ asa_student_session: 'seat' }, { 'x-asa-ai-seat': ACCOUNT }))
      .catch((error: unknown) => error);
    expect(problem).toBeInstanceOf(HttpException);
    expect((problem as HttpException).getStatus()).toBe(403);
    expect((problem as HttpException).getResponse()).toMatchObject({
      error: { code: 'ai_scope_denied' },
    });
    expect(query).toHaveBeenCalledExactlyOnceWith('SELECT ai_access_owner($1,$2) AS value', [
      SEAT,
      ACCOUNT,
    ]);
    expect(accounts.resolve).not.toHaveBeenCalled();
    expect(ai.status).not.toHaveBeenCalled();
  });
});

describe('classroom AI permission API', () => {
  it.each(['AI_SCOPE_DENIED', 'AI_TEACHER_DENIED'])(
    'maps %s to a content-free denial',
    async (message) => {
      const query = vi.fn(async () => {
        throw new Error(message);
      });
      const access = new AiAccessService({ query } as unknown as pg.Pool);
      await expect(access.classroom(ACCOUNT, CLASS)).rejects.toMatchObject({
        status: 403,
        code: 'ai_scope_denied',
      });
    },
  );
  it('keeps revision and exact replay failures actionable', async () => {
    for (const [message, code, status] of [
      ['AI_POLICY_CONFLICT', 'ai_policy_conflict', 409],
      ['AI_REQUEST_ID_REUSED', 'ai_request_id_reused', 409],
      ['AI_POLICY_INVALID', 'ai_policy_invalid', 400],
    ] as const) {
      const access = new AiAccessService({
        query: async () => {
          throw new Error(message);
        },
      } as unknown as pg.Pool);
      await expect(access.saveClassroom(ACCOUNT, CLASS, {})).rejects.toMatchObject({
        code,
        status,
      });
    }
  });
  it('checks origin and JSON before attempting any teacher write', async () => {
    const { accounts, seats } = identities();
    const access = { saveClassroom: vi.fn() };
    const controller = new AiAccessController(
      accounts,
      seats,
      access as unknown as AiAccessService,
    );
    for (const headers of [
      { host: 'asa.test' },
      { host: 'asa.test', origin: 'https://evil.test', 'content-type': 'application/json' },
      { host: 'asa.test', origin: 'https://asa.test', 'content-type': 'text/plain' },
    ]) {
      await expect(controller.save(request({}, headers), CLASS, {})).rejects.toMatchObject({
        status: expect.any(Number),
      });
    }
    expect(access.saveClassroom).not.toHaveBeenCalled();
    expect(accounts.resolve).not.toHaveBeenCalled();
  });
  it('has no teacher message/history projection and delegates only classroom admission settings', async () => {
    const { accounts, seats } = identities();
    const access = { classroom: vi.fn(async () => ({ revision: 0, students: [] })) };
    const controller = new AiAccessController(
      accounts,
      seats,
      access as unknown as AiAccessService,
    );
    expect(await controller.classroom(request({ asa_session: 'teacher' }), CLASS)).toEqual({
      revision: 0,
      students: [],
    });
    expect(access.classroom).toHaveBeenCalledWith(ACCOUNT, CLASS);
    expect(seats.resolveExistingState).not.toHaveBeenCalled();
  });
});
