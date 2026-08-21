import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { ClassroomJoinController } from './classroom-join.controller.js';
import { BotChallengeService } from './bot-challenge.js';

function request(address: string): FastifyRequest {
  return {
    raw: { socket: { remoteAddress: '127.0.0.1' } },
    headers: { 'x-forwarded-for': address, 'user-agent': 'test-browser' },
    cookies: {},
  } as unknown as FastifyRequest;
}

function reply(): FastifyReply {
  return { setCookie: vi.fn() } as unknown as FastifyReply;
}

describe('classroom seat sign-in abuse limits', () => {
  it('limits one guessed class credential even when source addresses rotate', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) } as unknown as pg.Pool;
    const activeContext = {} as ActiveContextUseCase;
    const controller = new ClassroomJoinController(
      pool,
      activeContext,
      new BotChallengeService({ required: false }),
    );
    const body = { code: 'ABC DEF 234', loginHandle: 'student-one' };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        controller.signIn(request(`203.0.113.${attempt + 1}`), reply(), body),
      ).rejects.toMatchObject({ status: 401 });
    }
    await expect(controller.signIn(request('203.0.113.99'), reply(), body)).rejects.toMatchObject({
      status: 429,
    });
  });
});
