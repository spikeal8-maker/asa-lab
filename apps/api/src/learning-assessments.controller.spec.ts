import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContextUseCase } from '@asa-lab/identity';
import { LearningAssessmentsController } from './learning-assessments.controller.js';

const CLASSROOM_ID = '123e4567-e89b-42d3-a456-426614174000';
const ATTEMPT_ID = '123e4567-e89b-42d3-a456-426614174001';
const RUN_A = '123e4567-e89b-42d3-a456-42661417400a';
const RUN_B = '123e4567-e89b-42d3-a456-42661417400b';

function request(): FastifyRequest {
  return { cookies: { asa_session: 'session' } } as unknown as FastifyRequest;
}

function controller(rows: unknown[]) {
  const query = vi.fn(async (sql: string) => ({
    rows:
      sql.includes('grading_scheme_for_classroom') || sql.includes('learning_canonical_evidence')
        ? []
        : rows,
  }));
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
  it('keeps unique legacy review reads compatible and scopes the SQL by the authenticated educator', async () => {
    const detail = { activityRunId: RUN_A, participationId: 'part-a', attempts: [] };
    const target = controller([{ detail }]);
    await expect(
      target.value.reviewContext(request(), CLASSROOM_ID, ATTEMPT_ID, CLASSROOM_ID),
    ).resolves.toEqual(detail);
    expect(target.query).toHaveBeenCalledWith(
      'SELECT detail FROM learning_teacher_review_context($1,$2,$3,$4)',
      ['123e4567-e89b-42d3-a456-426614174011', CLASSROOM_ID, CLASSROOM_ID, ATTEMPT_ID],
    );
  });

  it.each([false, true])(
    'selects the exact authorized sibling independently of row order (%s)',
    async (reverse) => {
      const first = {
        activityRunId: RUN_A,
        participationId: 'part-a',
        attempts: [{ id: 'attempt-a' }],
      };
      const second = {
        activityRunId: RUN_B,
        participationId: 'part-b',
        attempts: [{ id: 'attempt-b' }],
      };
      const rows = [{ detail: first }, { detail: second }];
      const target = controller(reverse ? rows.reverse() : rows);
      for (const detail of [first, second]) {
        await expect(
          target.value.reviewContext(
            request(),
            CLASSROOM_ID,
            ATTEMPT_ID,
            CLASSROOM_ID,
            detail.activityRunId.toUpperCase(),
          ),
        ).resolves.toEqual(detail);
      }
      await expect(
        target.value.reviewContext(request(), CLASSROOM_ID, ATTEMPT_ID, CLASSROOM_ID),
      ).rejects.toMatchObject({
        status: 409,
        response: { error: { code: 'review_context_ambiguous' } },
      });
    },
  );

  it.each([undefined, RUN_A])(
    'rejects duplicate contexts even with discriminator %s',
    async (runId) => {
      const detail = { activityRunId: RUN_A, participationId: 'part-a', attempts: [] };
      const target = controller([{ detail }, { detail }]);
      await expect(
        target.value.reviewContext(request(), CLASSROOM_ID, ATTEMPT_ID, CLASSROOM_ID, runId),
      ).rejects.toMatchObject({ status: 409 });
    },
  );

  it.each([{ rows: [] }, { rows: [{ detail: { activityRunId: RUN_A } }] }])(
    'does not fall back when the exact run is absent',
    async ({ rows }) => {
      const target = controller(rows);
      await expect(
        target.value.reviewContext(request(), CLASSROOM_ID, ATTEMPT_ID, CLASSROOM_ID, RUN_B),
      ).rejects.toMatchObject({ status: 404, response: { error: { code: 'review_not_found' } } });
    },
  );

  it.each(['', 'not-a-run', null, [RUN_A], { activityRunId: RUN_A }].map((runId) => ({ runId })))(
    'rejects malformed supplied run %s before querying',
    async ({ runId }) => {
      const target = controller([{ detail: { activityRunId: RUN_A } }]);
      await expect(
        target.value.reviewContext(
          request(),
          CLASSROOM_ID,
          ATTEMPT_ID,
          CLASSROOM_ID,
          runId as unknown as string,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(target.query).not.toHaveBeenCalled();
    },
  );

  it('creates a versioned question without exposing its answer key in the response', async () => {
    const target = controller([
      {
        result_code: 'ok',
        question_id: 'question-id',
        question_version_id: 'question-version-id',
      },
    ]);
    await expect(
      target.value.createQuestion(request(), {
        type: 'single_choice',
        prompt: 'Сколько будет 2 + 2?',
        options: [
          { id: 'a', label: '3' },
          { id: 'b', label: '4' },
        ],
        correctAnswer: 'b',
        maxPoints: 2,
        scope: 'school',
      }),
    ).resolves.toEqual({ id: 'question-id', versionId: 'question-version-id' });
    expect(target.query).toHaveBeenCalledWith(
      expect.stringContaining('question_version_create'),
      expect.arrayContaining(['single_choice', 2]),
    );
  });

  it('publishes and assigns a fixed quiz version', async () => {
    const target = controller([
      {
        result_code: 'ok',
        quiz_version_id: 'quiz-version-id',
        learning_activity_version_id: 'activity-version-id',
        total_points: '3',
      },
    ]);
    await expect(
      target.value.createQuiz(request(), {
        title: 'Входной тест',
        questionVersionIds: [ATTEMPT_ID],
        attemptLimit: 1,
        passThreshold: 60,
        feedbackReleasePolicy: 'immediate',
      }),
    ).resolves.toEqual({
      id: 'quiz-version-id',
      activityVersionId: 'activity-version-id',
      totalPoints: 3,
    });
  });

  it('returns one canonical gradebook row', async () => {
    const target = controller([
      {
        seat_id: 'seat-id',
        display_label: 'Анна',
        assignment_id: 'assignment-id',
        assignment_title: 'Первая схема',
        attempt_id: ATTEMPT_ID,
        attempt_number: '2',
        attempt_state: 'closed',
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
      scheme: null,
      items: [
        expect.objectContaining({
          displayLabel: 'Анна',
          attemptNumber: 2,
          state: 'closed',
          points: 84,
          maxPoints: 100,
          percentage: 84,
          outcome: 'passed',
          displayGrade: null,
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
        attempt_state: 'closed',
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
      state: 'closed',
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

describe('exact review queue pages', () => {
  function rows(count: number) {
    return Array.from({ length: count }, (_, index) => {
      const seatId = '50000000-0000-4000-8000-' + String(index + 1).padStart(12, '0');
      return {
        detail: {
          seatId,
          displayLabel: 'Ученик ' + index,
          assignmentId: ATTEMPT_ID,
          activityRunId: RUN_A,
          activityVersionId: RUN_B,
          title: 'Одинаковая практика',
          originLabel: 'Курс / Урок / Блок 1',
          originAvailable: true,
          createdAt: '2026-10-01T10:00:00Z',
        },
        evidence: {
          tenantId: CLASSROOM_ID,
          schoolId: CLASSROOM_ID,
          classroomId: CLASSROOM_ID,
          classroomAssignmentId: ATTEMPT_ID,
          kind: 'course_project',
          dueAt: null,
          assignmentStatus: 'open',
          seatId,
          accountId: null,
          principalId: null,
          learnerId: seatId,
          identityResolution: 'learner_identity',
          seatStatus: 'active',
          classroomAccess: 'active',
          legacyWork: null,
          courseProgressPresent: false,
          activityRunId: RUN_A,
          participation: { applicable: true, status: 'active', excused: false },
          attempt: {
            id: seatId,
            attemptNumber: 1,
            state: 'submitted',
            reviewDecision: null as string | null,
            startedAt: '2026-10-01T10:00:00Z',
            submittedAt: '2026-10-01T10:01:00Z',
            lateState: 'on_time',
          },
          selectedAttemptExists: false,
          resultSelectionSource: 'canonical',
          selectedAttemptId: null,
          selectedRevision: null,
          selectedResult: null,
          selectionConflict: null,
          validUnselectedResultCount: 0,
          compatibilityGradingUnknown: false,
          reusableAuthoredContent: true,
        },
      };
    });
  }
  it('continues beyond30 and reverses pages without skipping the learner removed from a state filter', async () => {
    const values = rows(35),
      target = controller(values);
    const first = await target.value.reviewQueue(
      request(),
      CLASSROOM_ID,
      ATTEMPT_ID,
      RUN_A,
      'waiting_review',
    );
    expect(first.items).toHaveLength(20);
    expect(first.total).toBe(35);
    const anchor = first.items.at(-1)!.seatId;
    values[19]!.evidence.attempt.state = 'closed';
    values[19]!.evidence.attempt.reviewDecision = 'accepted';
    const second = await target.value.reviewQueue(
      request(),
      CLASSROOM_ID,
      ATTEMPT_ID,
      RUN_A,
      'waiting_review',
      anchor,
    );
    expect(second.items).toHaveLength(15);
    expect(second.items[0]!.seatId).toBe(values[20]!.detail.seatId);
    expect(second.nextCursor).toBeNull();
    const previous = await target.value.reviewQueue(
      request(),
      CLASSROOM_ID,
      ATTEMPT_ID,
      RUN_A,
      'waiting_review',
      undefined,
      '20',
      second.previousCursor!,
    );
    expect(previous.items).toHaveLength(19);
    expect(previous.items.at(-1)!.seatId).toBe(values[18]!.detail.seatId);
    const completed = await target.value.reviewQueue(
      request(),
      CLASSROOM_ID,
      ATTEMPT_ID,
      RUN_A,
      'completed',
    );
    expect(completed.items[0]!.canonicalState?.selectedResult).toBeNull();
    expect(completed.items[0]!.state).toBe('completed');
  });
  it('rejects foreign exact runs and invalid filters/page discriminators without weakening the existing SQL scope', async () => {
    const target = controller(rows(1));
    await expect(
      target.value.reviewQueue(request(), CLASSROOM_ID, ATTEMPT_ID, RUN_B),
    ).rejects.toMatchObject({ status: 404 });
    for (const invalid of ['', null, [], {}, 'invalid']) {
      await expect(
        target.value.reviewQueue(request(), CLASSROOM_ID, ATTEMPT_ID, invalid),
      ).rejects.toMatchObject({ status: 400 });
    }
    await expect(
      target.value.reviewQueue(request(), CLASSROOM_ID, ATTEMPT_ID, RUN_A, 'unknown'),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      target.value.reviewQueue(request(), CLASSROOM_ID, ATTEMPT_ID, RUN_A, 'all', undefined, '51'),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      target.value.reviewQueue(
        request(),
        CLASSROOM_ID,
        ATTEMPT_ID,
        RUN_A,
        'all',
        RUN_A,
        '20',
        RUN_B,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
