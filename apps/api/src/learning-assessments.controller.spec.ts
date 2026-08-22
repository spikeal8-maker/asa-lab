import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContextUseCase } from '@asa-lab/identity';
import { LearningAssessmentsController } from './learning-assessments.controller.js';

const CLASSROOM_ID = '123e4567-e89b-42d3-a456-426614174000';
const ATTEMPT_ID = '123e4567-e89b-42d3-a456-426614174001';

function request(): FastifyRequest {
  return { cookies: { asa_session: 'session' } } as unknown as FastifyRequest;
}

function controller(rows: unknown[]) {
  const query = vi.fn(async () => ({ rows }));
  const activeContext = {
    resolve: vi.fn(async () => ({
      principalId: '123e4567-e89b-42d3-a456-426614174010',
      accountId: '123e4567-e89b-42d3-a456-426614174011',
      tenantId: '123e4567-e89b-42d3-a456-426614174012',
    })),
  } as unknown as ActiveContextUseCase;
  const accounts = {
    capabilities: vi.fn(async () => [{ capability: 'educator', state: 'verified' }]),
  } as unknown as AccountDirectoryPort;
  return {
    value: new LearningAssessmentsController(activeContext, accounts, {
      query,
    } as unknown as pg.Pool),
    query,
  };
}

describe('learning assessments API', () => {
  it('returns one canonical gradebook row', async () => {
    const target = controller([
      {
        seat_id: 'seat-id',
        display_label: 'Анна',
        assignment_id: 'assignment-id',
        assignment_title: 'Первая схема',
        attempt_id: ATTEMPT_ID,
        attempt_number: '2',
        attempt_state: 'accepted',
        submitted_at: '2026-08-22T10:00:00.000Z',
        raw_points: '84',
        max_points: '100',
        percentage_basis_points: '8400',
        outcome: 'passed',
        feedback: 'Хорошая работа',
        published_at: '2026-08-22T11:00:00.000Z',
      },
    ]);

    await expect(target.value.gradebook(request(), CLASSROOM_ID)).resolves.toEqual({
      items: [
        expect.objectContaining({
          displayLabel: 'Анна',
          attemptNumber: 2,
          state: 'accepted',
          points: 84,
          maxPoints: 100,
          percentage: 84,
          outcome: 'passed',
        }),
      ],
    });
    expect(target.query).toHaveBeenCalledWith(expect.stringContaining('classroom_gradebook_list'), [
      '123e4567-e89b-42d3-a456-426614174011',
      CLASSROOM_ID,
    ]);
  });

  it('publishes a teacher review against the immutable attempt', async () => {
    const target = controller([
      {
        result_code: 'ok',
        assessment_result_id: 'result-id',
        gradebook_entry_id: 'grade-id',
        attempt_state: 'accepted',
        percentage_basis_points: '9100',
      },
    ]);

    await expect(
      target.value.review(request(), CLASSROOM_ID, ATTEMPT_ID, {
        decision: 'accepted',
        points: 91,
        feedback: 'Все критерии выполнены',
      }),
    ).resolves.toEqual({
      attemptId: ATTEMPT_ID,
      state: 'accepted',
      assessmentResultId: 'result-id',
      gradebookEntryId: 'grade-id',
      percentage: 91,
    });
    expect(target.query).toHaveBeenCalledWith(
      expect.stringContaining('learning_attempt_review'),
      expect.arrayContaining([CLASSROOM_ID, ATTEMPT_ID, 'accepted', 91]),
    );
  });

  it('does not accept a decimal score from the client', async () => {
    const target = controller([]);
    await expect(
      target.value.review(request(), CLASSROOM_ID, ATTEMPT_ID, {
        decision: 'accepted',
        points: 91.5,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(target.query).not.toHaveBeenCalled();
  });
});
