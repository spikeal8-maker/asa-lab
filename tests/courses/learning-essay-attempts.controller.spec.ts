import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { LearningEssayAttemptsController } from '../../apps/api/src/learning-essay-attempts.controller.js';
import type { SeatContextUseCase } from '../../apps/api/src/seat-context.js';

const RUN = '123e4567-e89b-42d3-a456-426614174000';
const ATTEMPT = '123e4567-e89b-42d3-a456-426614174001';
const request = {
  cookies: { asa_student_session: 'seat-session', asa_session: 'account-session' },
} as unknown as FastifyRequest;

function fixture(response: unknown = { resultCode: 'ok', activityRunId: RUN }) {
  const query = vi.fn(async () => ({ rows: [{ response }] }));
  const resolveSeat = vi.fn(async () => ({ principalId: 'seat-owner' }));
  const resolveAccount = vi.fn(async () => ({ principalId: 'account-owner' }));
  const controller = new LearningEssayAttemptsController(
    { query } as unknown as pg.Pool,
    { resolve: resolveAccount } as unknown as ActiveContextUseCase,
    { resolve: resolveSeat } as unknown as SeatContextUseCase,
  );
  return { controller, query, resolveSeat, resolveAccount };
}

describe('written-response HTTP boundary', () => {
  it('uses the authenticated Seat independently of the linked Account and ignores client identity', async () => {
    const target = fixture();
    await expect(target.controller.read(request, RUN)).resolves.toEqual({ activityRunId: RUN });
    expect(target.query).toHaveBeenCalledWith(
      'SELECT learning_essay_attempt_read($1,$2) AS response',
      ['seat-owner', RUN],
    );
    expect(target.resolveAccount).not.toHaveBeenCalled();
    await expect(
      target.controller.start(request, RUN, { requestId: 'essay:start:one', principalId: 'other' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(target.query).toHaveBeenCalledTimes(1);
  });

  it('resolves the Account only without a valid Seat', async () => {
    const target = fixture();
    target.resolveSeat.mockResolvedValue(null as never);
    await target.controller.start(request, RUN, { requestId: 'essay:start:account' });
    expect(target.query).toHaveBeenCalledWith(
      'SELECT learning_essay_attempt_start($1,$2,$3) AS response',
      ['account-owner', RUN, 'essay:start:account'],
    );
  });

  it('rejects missing sessions before reading any answer', async () => {
    const target = fixture();
    target.resolveSeat.mockResolvedValue(null as never);
    target.resolveAccount.mockResolvedValue(null as never);
    await expect(target.controller.read(request, RUN)).rejects.toMatchObject({ status: 401 });
    expect(target.query).not.toHaveBeenCalled();
  });

  it.each([
    { expectedRevision: -1, text: 'answer' },
    { expectedRevision: 0.5, text: 'answer' },
    { expectedRevision: 2_147_483_647, text: 'answer' },
    { expectedRevision: 0, text: 'x'.repeat(40_001) },
    { expectedRevision: 0, text: 'nul\0text' },
    { expectedRevision: 0, text: { html: '<script>bad</script>' } },
  ])('rejects malformed or oversized draft %j without SQL', async (body) => {
    const target = fixture();
    await expect(
      target.controller.save(request, RUN, {
        attemptId: ATTEMPT,
        requestId: 'essay:save:one',
        ...body,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(target.query).not.toHaveBeenCalled();
  });

  it('passes the exact attempt, revision and bounded plain text without normalization', async () => {
    const target = fixture({
      resultCode: 'ok',
      attempt: { revision: 7, text: '  Ответ\nРусский  ' },
    });
    await expect(
      target.controller.save(request, RUN, {
        attemptId: ATTEMPT,
        expectedRevision: 6,
        requestId: 'essay:save:seven',
        text: '  Ответ\nРусский  ',
      }),
    ).resolves.toEqual({ attempt: { revision: 7, text: '  Ответ\nРусский  ' } });
    expect(target.query).toHaveBeenCalledWith(
      'SELECT learning_essay_draft_save($1,$2,$3,$4,$5,$6) AS response',
      ['seat-owner', RUN, ATTEMPT, 6, '  Ответ\nРусский  ', 'essay:save:seven'],
    );
  });

  it('submits only the server-confirmed revision, never a client-provided frozen answer or grade', async () => {
    const target = fixture();
    const body = { attemptId: ATTEMPT, expectedRevision: 2, requestId: 'essay:submit:one' };
    await target.controller.submit(request, RUN, body);
    expect(target.query).toHaveBeenCalledWith(
      'SELECT learning_essay_submission_create($1,$2,$3,$4,$5) AS response',
      ['seat-owner', RUN, ATTEMPT, 2, 'essay:submit:one'],
    );
    await expect(
      target.controller.submit(request, RUN, { ...body, text: 'unconfirmed' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      target.controller.submit(request, RUN, { ...body, points: 10 }),
    ).rejects.toMatchObject({ status: 400 });
    expect(target.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['forbidden', 404, 'learning_work_unavailable'],
    ['draft_revision_conflict', 409, 'draft_revision_conflict'],
    ['request_conflict', 409, 'idempotency_conflict'],
    ['not_available', 409, 'not_available'],
  ])('maps %s without returning private answer data', async (resultCode, status, code) => {
    const target = fixture({ resultCode, text: 'private' });
    await expect(target.controller.read(request, RUN)).rejects.toMatchObject({
      status,
      response: { error: { code } },
    });
  });
});
