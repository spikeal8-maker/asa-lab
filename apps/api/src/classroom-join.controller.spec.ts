import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { ClassroomJoinController } from './classroom-join.controller.js';

function request(address: string): FastifyRequest {
  return {
    raw: { socket: { remoteAddress: '127.0.0.1' } },
    headers: { 'x-forwarded-for': address, 'user-agent': 'test-browser' },
    cookies: {},
  } as unknown as FastifyRequest;
}

function reply(): FastifyReply {
  return { setCookie: vi.fn(), clearCookie: vi.fn(), header: vi.fn() } as unknown as FastifyReply;
}

function seatRequest(): FastifyRequest {
  const value = request('203.0.113.10');
  value.cookies['asa_student_session'] = 'seat-session';
  return value;
}

describe('classroom seat sign-in abuse limits', () => {
  it('counts only failed exact class/candidate checks and limits the sixth invalid attempt', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes('classroom_public_resolve_join_code')
        ? { rows: [{ tenant_id: 'tenant-id', classroom_id: 'classroom-id' }] }
        : { rows: [] },
    );
    const controller = new ClassroomJoinController(
      { query } as unknown as pg.Pool,
      {} as ActiveContextUseCase,
    );
    const body = { code: 'ABC DEF 234', studentCode: 'ACD234' };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        controller.signIn(request(`203.0.113.${attempt + 1}`), reply(), body),
      ).rejects.toMatchObject({ status: 401 });
    }
    const sixthReply = reply();
    await expect(
      controller.signIn(request('203.0.113.99'), sixthReply, body),
    ).rejects.toMatchObject({ status: 429 });
    expect(sixthReply.header).toHaveBeenCalledWith('Retry-After', expect.any(String));
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
    const controller = new ClassroomJoinController({ query } as unknown as pg.Pool, activeContext);
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

describe('immutable classroom submissions', () => {
  it('submits a quiz for the session seat and returns released correctness', async () => {
    const assignmentId = '123e4567-e89b-42d3-a456-426614174020';
    const questionId = '123e4567-e89b-42d3-a456-426614174021';
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
        rows: [
          {
            result_code: 'ok',
            attempt_id: 'attempt-id',
            submission_id: 'submission-id',
            attempt_number: '1',
            raw_points: '2',
            max_points: '3',
            percentage_basis_points: '6666',
            outcome: 'passed',
            late_state: 'on_time',
            question_results: [
              { questionVersionId: questionId, correct: true, points: 2, maxPoints: 2 },
            ],
            reused: false,
          },
        ],
      };
    });
    const controller = new ClassroomJoinController(
      { query } as unknown as pg.Pool,
      {} as ActiveContextUseCase,
    );
    await expect(
      controller.submitQuiz(seatRequest(), assignmentId, {
        answers: [{ questionVersionId: questionId, answer: { value: 'b' } }],
        clientRequestId: 'quiz:test:0001',
      }),
    ).resolves.toMatchObject({
      attemptId: 'attempt-id',
      points: 2,
      maxPoints: 3,
      percentage: 66.66,
      outcome: 'passed',
    });
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('quiz_submission_create'), [
      'seat-id',
      assignmentId,
      expect.stringContaining(questionId),
      'quiz:test:0001',
    ]);
  });

  it('returns the numbered immutable attempt created for the seat', async () => {
    const assignmentId = '123e4567-e89b-42d3-a456-426614174020';
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
      if (sql.includes('learning_direct_assignment_seat_visible')) {
        return { rows: [{ visible: true }] };
      }
      if (sql.includes('principal_for_seat')) {
        return { rows: [{ principal_id: 'learner-principal-id' }] };
      }
      return {
        rows: [
          {
            result_code: 'ok',
            participation_id: 'participation-id',
            attempt_id: 'attempt-id',
            submission_id: 'submission-id',
            attempt_number: '1',
            attempt_state: 'submitted',
            project_id: 'project-id',
            project_version_id: 'project-version-id',
            submitted_at: '2026-08-22T12:00:00.000Z',
            late_state: 'on_time',
            reused: false,
          },
        ],
      };
    });
    const controller = new ClassroomJoinController(
      { query } as unknown as pg.Pool,
      {} as ActiveContextUseCase,
    );

    await expect(
      controller.submitAssignment(seatRequest(), assignmentId, {
        submitted: true,
        clientRequestId: 'submit:test:0001',
        expectedRevision: 1,
      }),
    ).resolves.toEqual({
      projectId: 'project-id',
      projectVersionId: 'project-version-id',
      participationId: 'participation-id',
      attemptId: 'attempt-id',
      submissionId: 'submission-id',
      attemptNumber: 1,
      state: 'submitted',
      submittedAt: '2026-08-22T12:00:00.000Z',
      lateState: 'on_time',
      reused: false,
    });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('learning_direct_project_submission_create'),
      ['learner-principal-id', 'seat-id', assignmentId, 'submit:test:0001', 1],
    );
  });

  it('starts the exact canonical participation attempt for the session seat', async () => {
    const assignmentId = '123e4567-e89b-42d3-a456-426614174020';
    const projectId = '123e4567-e89b-42d3-a456-426614174021';
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
      if (sql.includes('principal_for_seat')) {
        return { rows: [{ principal_id: 'learner-principal-id' }] };
      }
      if (sql.includes('learning_direct_assignment_seat_visible')) {
        return { rows: [{ visible: true }] };
      }
      return {
        rows: [
          {
            result_code: 'ok',
            participation_id: 'participation-id',
            attempt_id: 'attempt-id',
            attempt_number: '1',
            attempt_state: 'in_progress',
            project_id: projectId,
            reused: false,
          },
        ],
      };
    });
    const controller = new ClassroomJoinController(
      { query } as unknown as pg.Pool,
      {} as ActiveContextUseCase,
    );

    await expect(
      controller.startAssignment(seatRequest(), assignmentId, { projectId }),
    ).resolves.toEqual({
      projectId,
      submittedAt: null,
      participationId: 'participation-id',
      attemptId: 'attempt-id',
      attemptNumber: 1,
      state: 'in_progress',
      reused: false,
    });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('learning_direct_project_attempt_start'),
      ['learner-principal-id', 'seat-id', assignmentId, projectId],
    );
  });

  it('does not let the learner mutate a submitted snapshot back into a draft', async () => {
    const controller = new ClassroomJoinController(
      { query: vi.fn() } as unknown as pg.Pool,
      {} as ActiveContextUseCase,
    );
    await expect(
      controller.submitAssignment(seatRequest(), '123e4567-e89b-42d3-a456-426614174020', {
        submitted: false,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('E1-FIX-11D4b learner course Activity occurrences', () => {
  it('projects per-block runtime and canonical state for both Account and StudentSeat reads', async () => {
    const seatId = '50000000-0000-4000-8000-000000000001';
    const accountId = '51000000-0000-4000-8000-000000000001';
    const runId = '52000000-0000-4000-8000-000000000001';
    const lessonId = '53000000-0000-4000-8000-000000000001';
    const assignmentA = '54000000-0000-4000-8000-000000000001';
    const assignmentB = '54000000-0000-4000-8000-000000000002';
    const activityRunA = '55000000-0000-4000-8000-000000000001';
    const activityRunB = '55000000-0000-4000-8000-000000000002';
    const versionA = '56000000-0000-4000-8000-000000000001';
    const versionB = '56000000-0000-4000-8000-000000000002';
    const projectA = '57000000-0000-4000-8000-000000000001';
    const courseRow = {
      run_id: runId,
      course_id: '58000000-0000-4000-8000-000000000001',
      course_version_id: '59000000-0000-4000-8000-000000000001',
      version_number: 1,
      classroom_title: '7А',
      run_title: 'D4b course',
      run_summary: null,
      due_at: null,
      run_status: 'open',
      lesson_id: lessonId,
      source_lesson_id: '5a000000-0000-4000-8000-000000000001',
      section_title: 'Section',
      section_summary: null,
      section_position: 1,
      lesson_title: 'Activity lesson',
      lesson_summary: null,
      lesson_content: null,
      lesson_blocks: [
        { id: 'activity-a', type: 'activity', learningActivityVersionId: versionA },
        { id: 'activity-b', type: 'activity', learningActivityVersionId: versionB },
      ],
      lesson_kind: 'material',
      estimated_minutes: 15,
      lesson_position: 1,
      classroom_assignment_id: null,
      assignment_title: null,
      assignment_goal: null,
      assignment_brief: null,
      module_key: null,
      sample_image: null,
      project_id: null,
      submitted_at: null,
      snapshot_revision: null,
      work_updated_at: null,
      completed_at: null,
    };
    const occurrenceRows = [
      {
        seat_id: seatId,
        run_id: runId,
        lesson_id: lessonId,
        block_id: 'activity-a',
        activity_run_id: activityRunA,
        classroom_assignment_id: assignmentA,
        learning_activity_version_id: versionA,
        title: 'Electronics',
        module_key: 'electronics',
        project_id: projectA,
        submitted_at: null,
        snapshot_revision: 7,
        work_updated_at: '2026-09-20T22:00:00.000Z',
      },
      {
        seat_id: seatId,
        run_id: runId,
        lesson_id: lessonId,
        block_id: 'activity-b',
        activity_run_id: activityRunB,
        classroom_assignment_id: assignmentB,
        learning_activity_version_id: versionB,
        title: '3D',
        module_key: 'three-d',
        project_id: null,
        submitted_at: null,
        snapshot_revision: null,
        work_updated_at: null,
      },
    ];
    const evidenceBase = {
      tenantId: '60000000-0000-4000-8000-000000000001',
      schoolId: '61000000-0000-4000-8000-000000000001',
      classroomId: '62000000-0000-4000-8000-000000000001',
      kind: 'course_project',
      dueAt: null,
      assignmentStatus: 'open',
      seatId,
      accountId,
      principalId: '63000000-0000-4000-8000-000000000001',
      learnerId: null,
      identityResolution: 'seat_compatibility',
      seatStatus: 'active',
      classroomAccess: 'active',
      courseProgressPresent: false,
      attempt: null,
      selectedAttemptExists: false,
      resultSelectionSource: 'none',
      selectedAttemptId: null,
      selectedResult: null,
      selectionConflict: null,
      validUnselectedResultCount: 0,
      compatibilityGradingUnknown: false,
      reusableAuthoredContent: true,
    };
    const evidenceRows = [
      {
        ...evidenceBase,
        classroomAssignmentId: assignmentA,
        activityRunId: activityRunA,
        legacyWork: {
          projectId: projectA,
          startedAt: '2026-09-20T21:00:00.000Z',
          submittedAt: null,
        },
      },
      {
        ...evidenceBase,
        classroomAssignmentId: assignmentB,
        activityRunId: activityRunB,
        legacyWork: null,
      },
    ];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('classroom_student_session_context')) {
        return {
          rows: [
            {
              seat_id: seatId,
              classroom_id: evidenceBase.classroomId,
              classroom_title: '7А',
              display_label: 'Learner',
              teacher_display_name: 'Teacher',
              safe_mode: true,
              avatar_key: null,
              expires_at: '2026-09-21T00:00:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('learning_canonical_evidence_for_')) {
        return { rows: evidenceRows.map((evidence) => ({ evidence })) };
      }
      if (sql.includes('classroom_course_activity_occurrences_for_')) {
        return { rows: occurrenceRows };
      }
      if (sql.includes('classroom_course_runs_for_')) return { rows: [courseRow] };
      return { rows: [] };
    });
    const activeContext = {
      resolve: vi.fn(async () => ({ accountId })),
    } as unknown as ActiveContextUseCase;
    const controller = new ClassroomJoinController({ query } as unknown as pg.Pool, activeContext);
    const accountRequest = request('203.0.113.40');
    accountRequest.cookies['asa_session'] = 'account-session';

    const [accountRead, seatRead] = await Promise.all([
      controller.accountCourseRuns(accountRequest),
      controller.courseRuns(seatRequest()),
    ]);

    for (const payload of [accountRead, seatRead]) {
      const occurrences = payload.items[0]?.sections[0]?.lessons[0]?.activityOccurrences;
      expect(occurrences).toHaveLength(2);
      expect(occurrences?.[0]).toMatchObject({
        blockId: 'activity-a',
        activityRunId: activityRunA,
        classroomAssignmentId: assignmentA,
        learningActivityVersionId: versionA,
        moduleKey: 'electronics',
        projectId: projectA,
        snapshotRevision: 7,
        canonicalState: {
          activityRunId: activityRunA,
          workflowState: 'in_progress',
        },
      });
      expect(occurrences?.[1]).toMatchObject({
        blockId: 'activity-b',
        activityRunId: activityRunB,
        classroomAssignmentId: assignmentB,
        learningActivityVersionId: versionB,
        moduleKey: 'three-d',
        projectId: null,
        canonicalState: {
          activityRunId: activityRunB,
          workflowState: 'not_started',
        },
      });
    }
  });
});
