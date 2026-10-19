import type { ActiveContextUseCase } from '@asa-lab/identity';
import { HttpException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AiAccessService } from './ai-access.service';
import { AiChatController } from './ai-chat.controller';
import type { AiChatService } from './ai-chat.service';
import type { SeatContextUseCase } from './seat-context';

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SEAT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const THREAD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SOURCE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const REQUEST = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const CURSOR = '2026-10-19T12:00:00.123456Z';

function fixture(state: 'resolved' | 'invalid_session' | 'unavailable_owner' = 'resolved') {
  const accounts = {
    resolve: vi.fn(async () => ({ principalId: ACCOUNT, accountId: ACCOUNT })),
  };
  const seats = {
    resolveExistingState: vi.fn(async () =>
      state === 'resolved' ? { state, context: { principalId: OWNER } } : { state },
    ),
    resolve: vi.fn(),
  };
  const query = vi.fn(async () => ({ rows: [{ value: OWNER }] }));
  const ai = {
    threadPage: vi.fn(async () => ({ items: [], nextCursor: null })),
    archiveThread: vi.fn(async () => ({ id: THREAD, archivedAt: CURSOR })),
    requestMessages: vi.fn(async () => []),
    sendStream: vi.fn(async () => ({ messages: [], replayed: false, stopped: false })),
  };
  const controller = new AiChatController(
    accounts as unknown as ActiveContextUseCase,
    ai as unknown as AiChatService,
    seats as unknown as SeatContextUseCase,
    new AiAccessService({ query } as unknown as pg.Pool),
  );
  const reply = {
    hijack: vi.fn(),
    raw: {
      writeHead: vi.fn(),
      once: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      writableEnded: false,
      destroyed: false,
    },
  };
  const request = (personal = false) =>
    ({
      cookies: personal
        ? { asa_session: 'account' }
        : { asa_student_session: 'seat', asa_session: 'retained-account' },
      headers: {
        host: 'asa.test',
        origin: 'https://asa.test',
        'content-type': 'application/json',
        'x-asa-ai-seat': SEAT.toUpperCase(),
      },
    }) as unknown as FastifyRequest;
  return { accounts, seats, query, ai, controller, request, reply };
}

const operations = [
  {
    name: 'whole-history search',
    invoke: (f: ReturnType<typeof fixture>, request: FastifyRequest) =>
      f.controller.threads(request, CURSOR, THREAD.toUpperCase(), ' старое сообщение ', 'true'),
    expected: (f: ReturnType<typeof fixture>) =>
      expect(f.ai.threadPage).toHaveBeenCalledWith(
        OWNER,
        { at: CURSOR, id: THREAD },
        'старое сообщение',
        true,
      ),
  },
  {
    name: 'archive or restore',
    invoke: (f: ReturnType<typeof fixture>, request: FastifyRequest) =>
      f.controller.archive(request, THREAD.toUpperCase(), { archived: true }),
    expected: (f: ReturnType<typeof fixture>) =>
      expect(f.ai.archiveThread).toHaveBeenCalledWith(OWNER, THREAD, true),
  },
  {
    name: 'free saved-request read',
    invoke: (f: ReturnType<typeof fixture>, request: FastifyRequest) =>
      f.controller.requestMessages(request, THREAD.toUpperCase(), REQUEST.toUpperCase()),
    expected: (f: ReturnType<typeof fixture>) =>
      expect(f.ai.requestMessages).toHaveBeenCalledWith(OWNER, THREAD, REQUEST),
  },
  {
    name: 'fresh answer regeneration',
    invoke: (f: ReturnType<typeof fixture>, request: FastifyRequest) =>
      f.controller.regenerate(request, f.reply as unknown as FastifyReply, THREAD.toUpperCase(), {
        sourceUserMessageId: SOURCE.toUpperCase(),
        requestId: REQUEST.toUpperCase(),
        model: 'gpt-6-luna',
      }),
    expected: (f: ReturnType<typeof fixture>) =>
      expect(f.ai.sendStream).toHaveBeenCalledWith(
        OWNER,
        THREAD,
        '',
        REQUEST,
        expect.any(Function),
        expect.any(AbortSignal),
        'gpt-6-luna',
        SOURCE,
      ),
  },
];

describe('complete-text routes share the canonical AI owner boundary', () => {
  it.each(operations)(
    '$name uses the Seat actor and exact selector without Account fallback',
    async (operation) => {
      const f = fixture();
      await operation.invoke(f, f.request());
      expect(f.seats.resolveExistingState).toHaveBeenCalledWith('seat');
      expect(f.accounts.resolve).not.toHaveBeenCalled();
      expect(f.seats.resolve).not.toHaveBeenCalled();
      expect(f.query).toHaveBeenCalledWith('SELECT ai_access_owner($1,$2) AS value', [OWNER, SEAT]);
      operation.expected(f);
    },
  );

  it.each(operations)(
    '$name delegates Account-selected Seat ownership to the same authority check',
    async (operation) => {
      const f = fixture();
      await operation.invoke(f, f.request(true));
      expect(f.accounts.resolve).toHaveBeenCalledWith('account');
      expect(f.seats.resolveExistingState).not.toHaveBeenCalled();
      expect(f.query).toHaveBeenCalledWith('SELECT ai_access_owner($1,$2) AS value', [
        ACCOUNT,
        SEAT,
      ]);
      operation.expected(f);
    },
  );

  for (const state of ['invalid_session', 'unavailable_owner'] as const) {
    it.each(operations)(
      `$name fails closed for ${state} before history or paid work`,
      async (operation) => {
        const f = fixture(state);
        const problem = await operation.invoke(f, f.request()).catch((error: unknown) => error);
        expect(problem).toBeInstanceOf(HttpException);
        expect((problem as HttpException).getStatus()).toBe(
          state === 'invalid_session' ? 401 : 403,
        );
        expect((problem as HttpException).getResponse()).toMatchObject({
          error: { code: state === 'invalid_session' ? 'ai_session_required' : 'ai_scope_denied' },
        });
        expect(f.accounts.resolve).not.toHaveBeenCalled();
        expect(f.seats.resolve).not.toHaveBeenCalled();
        expect(f.query).not.toHaveBeenCalled();
        for (const work of Object.values(f.ai)) expect(work).not.toHaveBeenCalled();
        expect(f.reply.hijack).not.toHaveBeenCalled();
      },
    );
  }

  it('rejects a retired model before starting the regeneration stream', async () => {
    const f = fixture();
    const problem = await f.controller
      .regenerate(f.request(), f.reply as unknown as FastifyReply, THREAD, {
        sourceUserMessageId: SOURCE,
        requestId: REQUEST,
        model: 'deepseek-chat',
      })
      .catch((error: unknown) => error);
    expect(problem).toBeInstanceOf(HttpException);
    expect((problem as HttpException).getStatus()).toBe(400);
    expect((problem as HttpException).getResponse()).toMatchObject({
      error: { code: 'ai_model_invalid' },
    });
    expect(f.reply.hijack).not.toHaveBeenCalled();
    expect(f.ai.sendStream).not.toHaveBeenCalled();
  });
});
