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

function seatRequest(): FastifyRequest {
  const value = request('203.0.113.10');
  value.cookies['asa_student_session'] = 'seat-session';
  return value;
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

describe('classroom course progress', () => {
  it('records completion against the seat from the session', async () => {
    const runId = '123e4567-e89b-42d3-a456-426614174010';
    const lessonId = '123e4567-e89b-42d3-a456-426614174011';
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('classroom_student_session_context')) {
        return {
          rows: [
            {
              seat_id: 'seat-id',
              classroom_id: 'classroom-id',
              classroom_title: '7А',
              display_label: 'Алина',
              teacher_display_name: 'Педагог',
              safe_mode: true,
              avatar_key: null,
              expires_at: '2026-08-21T20:00:00.000Z',
            },
          ],
        };
      }
      return {
        rows: [{ result_code: 'ok', completed_at: '2026-08-21T12:30:00.000Z' }],
      };
    });
    const controller = new ClassroomJoinController(
      { query } as unknown as pg.Pool,
      {} as ActiveContextUseCase,
      new BotChallengeService({ required: false }),
    );

    await expect(
      controller.setCourseLessonProgress(seatRequest(), runId, lessonId, { completed: true }),
    ).resolves.toEqual({ completedAt: '2026-08-21T12:30:00.000Z' });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('classroom_course_material_progress_set'),
      ['seat-id', runId, lessonId, true],
    );
  });

  it('loads and updates course progress for an account learner', async () => {
    const runId = '123e4567-e89b-42d3-a456-426614174010';
    const lessonId = '123e4567-e89b-42d3-a456-426614174011';
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes('progress_set_for_account')
        ? [{ result_code: 'ok', completed_at: '2026-08-21T12:30:00.000Z' }]
        : [],
    }));
    const activeContext = {
      resolve: vi.fn(async () => ({ accountId: 'account-id' })),
    } as unknown as ActiveContextUseCase;
    const controller = new ClassroomJoinController(
      { query } as unknown as pg.Pool,
      activeContext,
      new BotChallengeService({ required: false }),
    );
    const accountRequest = request('203.0.113.20');
    accountRequest.cookies['asa_session'] = 'account-session';

    await expect(controller.accountCourseRuns(accountRequest)).resolves.toEqual({ items: [] });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('classroom_course_runs_for_account_v2'),
      ['account-id'],
    );
    await expect(
      controller.setAccountCourseLessonProgress(accountRequest, runId, lessonId, {
        completed: true,
      }),
    ).resolves.toEqual({ completedAt: '2026-08-21T12:30:00.000Z' });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('classroom_course_material_progress_set_for_account'),
      ['account-id', runId, lessonId, true],
    );
  });
});
