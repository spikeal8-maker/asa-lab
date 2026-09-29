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

describe('exact Course Activity sample route', () => {
  const activityRunId = '123e4567-e89b-42d3-a456-426614174012';

  it('uses the signed-in seat and returns the authorized pinned bytes', async () => {
    const image = Buffer.from('exact-sample');
    const query = vi.fn(async (sql: string) =>
      sql.includes('classroom_student_session_context')
        ? { rows: [{ seat_id: 'seat-id' }] }
        : {
            rows: [
              {
                sample_bytes: image,
                sample_content_type: 'image/png',
                content_hash: 'a'.repeat(64),
              },
            ],
          },
    );
    const controller = new ClassroomJoinController(
      { query } as unknown as pg.Pool,
      {} as ActiveContextUseCase,
    );
    const send = vi.fn();
    const response = { header: vi.fn().mockReturnThis(), type: vi.fn().mockReturnThis(), send };
    await controller.courseActivitySample(
      seatRequest(),
      response as unknown as FastifyReply,
      activityRunId,
    );
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('learning_course_activity_sample_for_viewer'),
      [activityRunId, null, 'seat-id'],
    );
    expect(response.header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(response.type).toHaveBeenCalledWith('image/png');
    expect(send).toHaveBeenCalledWith(image);
  });

  it('returns the same safe absence for unauthorized or unavailable media', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes('classroom_student_session_context')
        ? { rows: [{ seat_id: 'seat-id' }] }
        : { rows: [] },
    );
    const controller = new ClassroomJoinController(
      { query } as unknown as pg.Pool,
      {} as ActiveContextUseCase,
    );
    await expect(
      controller.courseActivitySample(seatRequest(), reply(), activityRunId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('uses the authenticated Account identity without accepting a claimed seat', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const activeContext = {
      resolve: vi.fn(async () => ({ accountId: 'account-id' })),
    } as unknown as ActiveContextUseCase;
    const controller = new ClassroomJoinController({ query } as unknown as pg.Pool, activeContext);
    const accountRequest = request('203.0.113.20');
    accountRequest.cookies['asa_session'] = 'account-session';
    await expect(
      controller.courseActivitySample(accountRequest, reply(), activityRunId),
    ).rejects.toMatchObject({ status: 404 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('learning_course_activity_sample_for_viewer'),
      [activityRunId, 'account-id', null],
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
      if (sql.includes('learning_course_activity_assignment_is_shared')) {
        return { rows: [{ shared: false }] };
      }
      if (sql.includes('learning_legacy_direct_provenance')) {
        return {
          rows: [{ proof: { legacyDirect: true, startAllowed: false, submitAllowed: true } }],
        };
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
      if (sql.includes('learning_course_activity_assignment_is_shared')) {
        return { rows: [{ shared: false }] };
      }
      if (sql.includes('learning_legacy_direct_provenance')) {
        return {
          rows: [{ proof: { legacyDirect: true, startAllowed: false, submitAllowed: true } }],
        };
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

describe('origin Direct learner list', () => {
  it('projects one exact started Project for Seat and Account while retaining legacy fallback', async () => {
    const seatId = '50000000-0000-4000-8000-000000000001';
    const accountId = '51000000-0000-4000-8000-000000000001';
    const assignmentId = '54000000-0000-4000-8000-000000000001';
    const runId = '55000000-0000-4000-8000-000000000001';
    const projectId = '57000000-0000-4000-8000-000000000001';
    const row = {
      id: assignmentId,
      seat_id: seatId,
      classroom_title: '7А',
      title: 'Exact Direct',
      brief: 'Build',
      goal: null,
      module_key: 'electronics',
      due_at: null,
      status: 'open',
      sample_image: null,
      project_id: null,
      submitted_at: null,
      snapshot_revision: null,
      updated_at: null,
      task_blocks: null,
      legacy_provenance: {
        legacyDirect: true,
        legacyProjectReadable: true,
        startAllowed: false,
        submitAllowed: true,
      },
    };
    let origins = [
      {
        context: {
          projectId,
          seatId,
          classroomAssignmentId: assignmentId,
          activityRunId: runId,
          participationId: '58000000-0000-4000-8000-000000000001',
          sourceKind: 'direct',
          courseBlockId: null,
          brief: 'Exact brief',
          goal: 'Exact goal',
          blocks: [{ id: 'exact-block' }],
          blocksSnapshotPresent: true,
          submittedAt: null,
          snapshotRevision: null,
          updatedAt: '2026-09-29T11:00:00.000Z',
        },
        evidence: {
          tenantId: '60000000-0000-4000-8000-000000000001',
          schoolId: '61000000-0000-4000-8000-000000000001',
          classroomId: '62000000-0000-4000-8000-000000000001',
          classroomAssignmentId: assignmentId,
          kind: 'direct_project',
          dueAt: null,
          assignmentStatus: 'open',
          seatId,
          accountId,
          principalId: '63000000-0000-4000-8000-000000000001',
          learnerId: '64000000-0000-4000-8000-000000000001',
          identityResolution: 'learner_identity',
          seatStatus: 'active',
          classroomAccess: 'active',
          legacyWork: null,
          courseProgressPresent: false,
          activityRunId: runId,
          participation: { applicable: true, status: 'active', excused: false },
          attempt: {
            id: '65000000-0000-4000-8000-000000000001',
            attemptNumber: 1,
            revisionOfAttemptId: null,
            state: 'in_progress',
            reviewDecision: null,
            startedAt: '2026-09-29T10:00:00.000Z',
            submittedAt: null,
            lateState: null,
          },
          selectedAttemptExists: false,
          resultSelectionSource: 'canonical',
          selectedAttemptId: null,
          selectedResult: null,
          selectionConflict: null,
          validUnselectedResultCount: 0,
          compatibilityGradingUnknown: false,
          reusableAuthoredContent: true,
          projectId,
        },
      },
    ];
    let presenceRows: Array<Record<string, unknown>> = [];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('classroom_student_session_context')) return { rows: [{ seat_id: seatId }] };
      if (sql.includes('classroom_assignments_for_')) return { rows: [row] };
      if (sql.includes('learning_direct_assignment_visibility_for_'))
        return {
          rows: [{ seat_id: seatId, classroom_assignment_id: assignmentId, visible: true }],
        };
      if (sql.includes('learning_origin_learner_list')) return { rows: origins };
      if (sql.includes('learning_origin_learner_presence')) return { rows: presenceRows };
      if (sql.includes('learning_direct_learner_runs'))
        return {
          rows: [
            { seat_id: seatId, classroom_assignment_id: assignmentId, activity_run_id: runId },
          ],
        };
      return { rows: [] };
    });
    const activeContext = {
      resolve: vi.fn(async () => ({ accountId })),
    } as unknown as ActiveContextUseCase;
    const controller = new ClassroomJoinController({ query } as unknown as pg.Pool, activeContext);
    const accountRequest = request('203.0.113.40');
    accountRequest.cookies['asa_session'] = 'account-session';
    for (const payload of [
      await controller.assignments(seatRequest()),
      await controller.accountAssignments(accountRequest),
    ]) {
      expect(payload.items[0]).toMatchObject({
        activityRunId: runId,
        projectId,
        brief: 'Exact brief',
        goal: 'Exact goal',
        blocks: [{ id: 'exact-block' }],
        canonicalState: { workflowState: 'in_progress', activityRunId: runId },
      });
    }
    const exactOrigin = origins[0];
    origins = [];
    row.project_id = '57000000-0000-4000-8000-000000000002';
    expect((await controller.assignments(seatRequest())).items[0]).toMatchObject({
      projectId: row.project_id,
      canonicalState: null,
      legacyStartAllowed: false,
      legacySubmitAllowed: true,
    });
    row.legacy_provenance = {
      legacyDirect: true,
      legacyProjectReadable: false,
      startAllowed: false,
      submitAllowed: false,
    };
    for (const payload of [
      await controller.assignments(seatRequest()),
      await controller.accountAssignments(accountRequest),
    ]) {
      expect(payload.items[0]).toMatchObject({
        projectId: null,
        submittedAt: null,
        snapshotRevision: null,
        updatedAt: null,
        canonicalState: null,
        legacyStartAllowed: false,
        legacySubmitAllowed: false,
      });
    }
    presenceRows = [
      {
        seat_id: seatId,
        source_kind: 'direct',
        classroom_assignment_id: assignmentId,
        activity_run_id: runId,
        course_block_id: null,
      },
    ];
    for (const payload of [
      await controller.assignments(seatRequest()),
      await controller.accountAssignments(accountRequest),
    ]) {
      expect(payload.items[0]).toMatchObject({
        activityRunId: null,
        projectId: null,
        submittedAt: null,
        snapshotRevision: null,
        updatedAt: null,
        canonicalState: null,
        legacyStartAllowed: false,
        legacySubmitAllowed: false,
      });
    }
    origins = [exactOrigin, exactOrigin];
    expect((await controller.assignments(seatRequest())).items[0]).toMatchObject({
      activityRunId: null,
      projectId: null,
      canonicalState: null,
    });
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
        shared_assignment: false,
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
        shared_assignment: false,
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
    let originRows: Array<{ context: Record<string, unknown>; evidence: Record<string, unknown> }> =
      [];
    let presenceRows: Array<Record<string, unknown>> = [];
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
      if (sql.includes('learning_origin_learner_list')) return { rows: originRows };
      if (sql.includes('learning_origin_learner_presence')) return { rows: presenceRows };
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

    Object.assign(courseRow, {
      classroom_assignment_id: assignmentA,
      project_id: projectA,
      snapshot_revision: 7,
      work_updated_at: '2026-09-20T22:00:00.000Z',
    });
    const [accountRead, seatRead] = await Promise.all([
      controller.accountCourseRuns(accountRequest),
      controller.courseRuns(seatRequest()),
    ]);

    for (const payload of [accountRead, seatRead]) {
      expect(payload.items[0]?.sections[0]?.lessons[0]?.projectId).toBe(projectA);
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
        workOriginAmbiguous: false,
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
        workOriginAmbiguous: false,
        canonicalState: {
          activityRunId: activityRunB,
          workflowState: 'not_started',
        },
      });
    }

    // The same legacy handout can back two exact runs. It proves neither
    // occurrence owns its assignment-level project or canonical work state.
    occurrenceRows[1]!.classroom_assignment_id = assignmentA;
    occurrenceRows[1]!.project_id = projectA;
    occurrenceRows[1]!.snapshot_revision = 7;
    Object.assign(occurrenceRows[0]!, { shared_assignment: true });
    Object.assign(occurrenceRows[1]!, { shared_assignment: true });
    evidenceRows[1]!.classroomAssignmentId = assignmentA;
    const [sharedAccountRead, sharedSeatRead] = await Promise.all([
      controller.accountCourseRuns(accountRequest),
      controller.courseRuns(seatRequest()),
    ]);
    for (const payload of [sharedAccountRead, sharedSeatRead]) {
      expect(payload.items[0]?.sections[0]?.lessons[0]).toMatchObject({
        projectId: null,
        snapshotRevision: null,
        updatedAt: null,
        canonicalState: null,
      });
      const occurrences = payload.items[0]?.sections[0]?.lessons[0]?.activityOccurrences;
      expect(occurrences).toHaveLength(2);
      expect(occurrences?.map((item) => item.workOriginAmbiguous)).toEqual([true, true]);
      expect(
        occurrences?.every(
          (item) =>
            item.projectId === null &&
            item.submittedAt === null &&
            item.snapshotRevision === null &&
            item.updatedAt === null &&
            item.canonicalState === null,
        ),
      ).toBe(true);
    }

    const exactProjects = [
      '57000000-0000-4000-8000-000000000011',
      '57000000-0000-4000-8000-000000000012',
    ];
    originRows = [activityRunA, activityRunB].map((activityRunId, index) => ({
      context: {
        projectId: exactProjects[index],
        seatId,
        classroomAssignmentId: assignmentA,
        activityRunId,
        participationId: `64000000-0000-4000-8000-00000000000${index + 1}`,
        sourceKind: 'course',
        courseBlockId: index === 0 ? 'activity-a' : 'activity-b',
        brief: `Exact brief ${index}`,
        goal: `Exact goal ${index}`,
        blocks: [{ id: `exact-block-${index}` }],
        blocksSnapshotPresent: true,
        submittedAt: null,
        snapshotRevision: null,
        updatedAt: '2026-09-20T23:00:00.000Z',
      },
      evidence: {
        ...evidenceBase,
        classroomAssignmentId: assignmentA,
        activityRunId,
        learnerId: '65000000-0000-4000-8000-000000000001',
        identityResolution: 'learner_identity',
        legacyWork: null,
        courseProgressPresent: true,
        participation: { applicable: true, status: 'active', excused: false },
        attempt: {
          id: `66000000-0000-4000-8000-00000000000${index + 1}`,
          attemptNumber: 1,
          revisionOfAttemptId: null,
          state: 'in_progress',
          reviewDecision: null,
          startedAt: '2026-09-20T21:00:00.000Z',
          submittedAt: null,
          lateState: null,
        },
        projectId: exactProjects[index],
      },
    }));
    const [exactAccountRead, exactSeatRead] = await Promise.all([
      controller.accountCourseRuns(accountRequest),
      controller.courseRuns(seatRequest()),
    ]);
    for (const payload of [exactAccountRead, exactSeatRead]) {
      const occurrences = payload.items[0]?.sections[0]?.lessons[0]?.activityOccurrences;
      expect(occurrences?.map((item) => item.projectId)).toEqual(exactProjects);
      expect(occurrences?.map((item) => item.goal)).toEqual(['Exact goal 0', 'Exact goal 1']);
      expect(occurrences?.map((item) => item.blocks)).toEqual([
        [{ id: 'exact-block-0' }],
        [{ id: 'exact-block-1' }],
      ]);
      expect(occurrences?.map((item) => item.workOriginAmbiguous)).toEqual([false, false]);
      expect(occurrences?.map((item) => item.canonicalState?.workflowState)).toEqual([
        'in_progress',
        'in_progress',
      ]);
    }
    const exactOriginRows = [...originRows];
    originRows = [];
    presenceRows = [
      {
        seat_id: seatId,
        source_kind: 'course',
        classroom_assignment_id: assignmentA,
        activity_run_id: activityRunA,
        course_block_id: 'activity-a',
      },
    ];
    occurrenceRows[0].shared_assignment = false;
    Object.assign(courseRow, { submitted_at: '2026-09-20T22:30:00.000Z' });
    Object.assign(occurrenceRows[0], { submitted_at: '2026-09-20T22:30:00.000Z' });
    const [deniedSeat, deniedAccount] = await Promise.all([
      controller.courseRuns(seatRequest()),
      controller.accountCourseRuns(accountRequest),
    ]);
    for (const payload of [deniedSeat, deniedAccount]) {
      const lesson = payload.items[0]?.sections[0]?.lessons[0];
      expect(lesson).toMatchObject({
        projectId: null,
        submittedAt: null,
        snapshotRevision: null,
        updatedAt: null,
        canonicalState: null,
      });
      expect(lesson?.activityOccurrences?.[0]).toMatchObject({
        projectId: null,
        submittedAt: null,
        snapshotRevision: null,
        updatedAt: null,
        canonicalState: null,
        workOriginAmbiguous: true,
      });
    }
    presenceRows = [];
    originRows = [exactOriginRows[0], exactOriginRows[0], exactOriginRows[1]];
    const duplicate = await controller.courseRuns(seatRequest());
    expect(duplicate.items[0]?.sections[0]?.lessons[0]?.activityOccurrences?.[0]).toMatchObject({
      projectId: null,
      submittedAt: null,
      snapshotRevision: null,
      updatedAt: null,
      canonicalState: null,
      workOriginAmbiguous: true,
    });
  });

  it('rejects legacy shared Course Activity start and submit before either mutation', async () => {
    const assignmentId = '54000000-0000-4000-8000-000000000001';
    const projectId = '57000000-0000-4000-8000-000000000001';
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('classroom_student_session_context')) {
        return {
          rows: [
            {
              seat_id: 'seat-id',
              classroom_id: 'classroom-id',
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
      if (sql.includes('principal_for_seat')) {
        return { rows: [{ principal_id: 'learner-principal-id' }] };
      }
      if (sql.includes('learning_direct_assignment_seat_visible')) {
        return { rows: [{ visible: true }] };
      }
      if (sql.includes('learning_course_activity_assignment_is_shared')) {
        return { rows: [{ shared: true }] };
      }
      return { rows: [] };
    });
    const controller = new ClassroomJoinController(
      { query } as unknown as pg.Pool,
      {} as ActiveContextUseCase,
    );
    await expect(
      controller.startAssignment(seatRequest(), assignmentId, { projectId }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      controller.submitAssignment(seatRequest(), assignmentId, {
        submitted: true,
        clientRequestId: 'shared:submit:001',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      query.mock.calls.some(([sql]) => sql.includes('learning_direct_project_attempt_start')),
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) => sql.includes('learning_direct_project_submission_create')),
    ).toBe(false);
  });

  it('keeps a single historical Course lesson on its existing Start and Submit adapter', async () => {
    const assignmentId = '54000000-0000-4000-8000-000000000010';
    const projectId = '57000000-0000-4000-8000-000000000010';
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('classroom_student_session_context'))
        return { rows: [{ seat_id: 'seat-id' }] };
      if (sql.includes('principal_for_seat'))
        return { rows: [{ principal_id: 'learner-principal-id' }] };
      if (sql.includes('learning_direct_assignment_seat_visible'))
        return { rows: [{ visible: true }] };
      if (sql.includes('learning_course_activity_assignment_is_shared'))
        return { rows: [{ shared: false }] };
      if (
        sql.includes('learning_legacy_direct_provenance') ||
        sql.includes('learning_legacy_assignment_write_provenance')
      )
        return {
          rows: [
            {
              proof: {
                legacyDirect: false,
                legacyCourseLesson: true,
                startAllowed: true,
                submitAllowed: true,
              },
            },
          ],
        };
      if (
        sql.includes('learning_direct_project_attempt_start') ||
        sql.includes('learning_direct_project_submission_create')
      )
        return { rows: [{ result_code: 'not_canonical' }] };
      if (sql.includes('classroom_assignment_work_start'))
        return { rows: [{ project_id: projectId, submitted_at: null }] };
      if (sql.includes('learning_project_submission_create'))
        return {
          rows: [
            {
              result_code: 'ok',
              project_id: projectId,
              project_version_id: 'version-id',
              attempt_id: 'attempt-id',
              submission_id: 'submission-id',
              attempt_number: 1,
              attempt_state: 'submitted',
              submitted_at: '2026-09-30T10:00:00Z',
              late_state: 'on_time',
              reused: false,
            },
          ],
        };
      return { rows: [] };
    });
    const controller = new ClassroomJoinController(
      { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as pg.Pool,
      {} as ActiveContextUseCase,
    );
    await expect(
      controller.startAssignment(seatRequest(), assignmentId, { projectId }),
    ).resolves.toMatchObject({ projectId });
    await expect(
      controller.submitAssignment(seatRequest(), assignmentId, {
        submitted: true,
        clientRequestId: 'course:legacy:submit:001',
        expectedRevision: 1,
      }),
    ).resolves.toMatchObject({ projectId, submissionId: 'submission-id' });
    expect(query.mock.calls.some(([sql]) => sql.includes('classroom_assignment_work_start'))).toBe(
      true,
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('learning_project_submission_create')),
    ).toBe(true);
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements).toContain('BEGIN');
    expect(statements).toContain('COMMIT');
    expect(
      statements.findIndex((sql) => sql.includes('learning_legacy_assignment_write_provenance')),
    ).toBeLessThan(statements.findIndex((sql) => sql.includes('classroom_assignment_work_start')));
  });

  it('rejects stale historical Direct proof before attaching or submitting work', async () => {
    const assignmentId = '54000000-0000-4000-8000-000000000011';
    const projectId = '57000000-0000-4000-8000-000000000011';
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('classroom_student_session_context'))
        return { rows: [{ seat_id: 'seat-id' }] };
      if (sql.includes('principal_for_seat'))
        return { rows: [{ principal_id: 'learner-principal-id' }] };
      if (sql.includes('learning_direct_assignment_seat_visible'))
        return { rows: [{ visible: true }] };
      if (sql.includes('learning_course_activity_assignment_is_shared'))
        return { rows: [{ shared: false }] };
      if (
        sql.includes('learning_legacy_direct_provenance') ||
        sql.includes('learning_legacy_assignment_write_provenance')
      )
        return {
          rows: [{ proof: { legacyDirect: true, startAllowed: false, submitAllowed: false } }],
        };
      return { rows: [] };
    });
    const controller = new ClassroomJoinController(
      { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as pg.Pool,
      {} as ActiveContextUseCase,
    );
    await expect(
      controller.startAssignment(seatRequest(), assignmentId, {
        projectId,
        legacyOnly: true,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      controller.submitAssignment(seatRequest(), assignmentId, {
        submitted: true,
        legacyOnly: true,
        clientRequestId: 'legacy:denied:001',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(query.mock.calls.some(([sql]) => sql.includes('classroom_assignment_work_start'))).toBe(
      false,
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('learning_project_submission_create')),
    ).toBe(false);
  });

  it('accepts only the freshly proven no-run Direct compatibility Start', async () => {
    const assignmentId = '54000000-0000-4000-8000-000000000012';
    const projectId = '57000000-0000-4000-8000-000000000012';
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('classroom_student_session_context'))
        return { rows: [{ seat_id: 'seat-id' }] };
      if (sql.includes('principal_for_seat'))
        return { rows: [{ principal_id: 'learner-principal-id' }] };
      if (sql.includes('learning_direct_assignment_seat_visible'))
        return { rows: [{ visible: true }] };
      if (sql.includes('learning_course_activity_assignment_is_shared'))
        return { rows: [{ shared: false }] };
      if (
        sql.includes('learning_legacy_direct_provenance') ||
        sql.includes('learning_legacy_assignment_write_provenance')
      )
        return {
          rows: [{ proof: { legacyDirect: true, startAllowed: true, submitAllowed: false } }],
        };
      if (sql.includes('classroom_assignment_work_start'))
        return { rows: [{ project_id: projectId, submitted_at: null }] };
      return { rows: [] };
    });
    const controller = new ClassroomJoinController(
      { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as pg.Pool,
      {} as ActiveContextUseCase,
    );
    await expect(
      controller.startAssignment(seatRequest(), assignmentId, {
        projectId,
        legacyOnly: true,
      }),
    ).resolves.toMatchObject({ projectId, participationId: null });
    expect(
      query.mock.calls.some(([sql]) => sql.includes('learning_direct_project_attempt_start')),
    ).toBe(false);
  });

  it('denies an unflagged LAV-backed Direct fallback with no Run before old adapters', async () => {
    const assignmentId = '54000000-0000-4000-8000-000000000013';
    const projectId = '57000000-0000-4000-8000-000000000013';
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('classroom_student_session_context'))
        return { rows: [{ seat_id: 'seat-id' }] };
      if (sql.includes('principal_for_seat')) return { rows: [{ principal_id: 'seat-principal' }] };
      if (sql.includes('learning_direct_assignment_seat_visible'))
        return { rows: [{ visible: true }] };
      if (sql.includes('learning_course_activity_assignment_is_shared'))
        return { rows: [{ shared: false }] };
      if (sql.includes('learning_legacy_direct_provenance'))
        return { rows: [{ proof: { legacyDirect: false, legacyCourseLesson: false } }] };
      if (
        sql.includes('learning_direct_project_attempt_start') ||
        sql.includes('learning_direct_project_submission_create')
      )
        return { rows: [{ result_code: 'not_canonical' }] };
      return { rows: [] };
    });
    const controller = new ClassroomJoinController(
      { query } as unknown as pg.Pool,
      {} as ActiveContextUseCase,
    );
    await expect(
      controller.startAssignment(seatRequest(), assignmentId, { projectId }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      controller.submitAssignment(seatRequest(), assignmentId, {
        submitted: true,
        clientRequestId: 'missing:run:submit:001',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(query.mock.calls.some(([sql]) => sql.includes('classroom_assignment_work_start'))).toBe(
      false,
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes('learning_project_submission_create')),
    ).toBe(false);
  });

  it('rolls back when historical proof is revoked between preliminary read and locked write', async () => {
    const assignmentId = '54000000-0000-4000-8000-000000000015';
    const projectId = '57000000-0000-4000-8000-000000000015';
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('classroom_student_session_context'))
        return { rows: [{ seat_id: 'seat-id' }] };
      if (sql.includes('principal_for_seat')) return { rows: [{ principal_id: 'seat-principal' }] };
      if (sql.includes('learning_direct_assignment_seat_visible'))
        return { rows: [{ visible: true }] };
      if (sql.includes('learning_course_activity_assignment_is_shared'))
        return { rows: [{ shared: false }] };
      if (sql.includes('learning_legacy_direct_provenance'))
        return { rows: [{ proof: { legacyDirect: true, startAllowed: true } }] };
      if (sql.includes('learning_legacy_assignment_write_provenance'))
        return { rows: [{ proof: { legacyDirect: true, startAllowed: false } }] };
      if (sql.includes('learning_direct_project_attempt_start'))
        return { rows: [{ result_code: 'not_canonical' }] };
      return { rows: [] };
    });
    const pool = {
      query,
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as unknown as pg.Pool;
    const controller = new ClassroomJoinController(pool, {} as ActiveContextUseCase);
    await expect(
      controller.startAssignment(seatRequest(), assignmentId, { projectId }),
    ).rejects.toMatchObject({ status: 404 });
    expect(query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(query.mock.calls.some(([sql]) => sql.includes('classroom_assignment_work_start'))).toBe(
      false,
    );
  });

  it('denies historical Direct Account Start before an old adapter can link its generic Project', async () => {
    const assignmentId = '54000000-0000-4000-8000-000000000014';
    const projectId = '57000000-0000-4000-8000-000000000014';
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('classroom_seat_for_account_assignment'))
        return { rows: [{ id: 'seat-id' }] };
      if (sql.includes('learning_direct_assignment_seat_visible'))
        return { rows: [{ visible: true }] };
      if (sql.includes('learning_course_activity_assignment_is_shared'))
        return { rows: [{ shared: false }] };
      if (sql.includes('learning_legacy_direct_provenance'))
        return { rows: [{ proof: { legacyDirect: true, startAllowed: false } }] };
      if (sql.includes('learning_direct_project_attempt_start'))
        return { rows: [{ result_code: 'not_canonical' }] };
      return { rows: [] };
    });
    const activeContext = {
      resolve: vi.fn(async () => ({ accountId: 'account-id', principalId: 'account-principal' })),
    } as unknown as ActiveContextUseCase;
    const controller = new ClassroomJoinController({ query } as unknown as pg.Pool, activeContext);
    const accountRequest = request('203.0.113.41');
    accountRequest.cookies['asa_session'] = 'account-session';
    await expect(
      controller.startAssignment(accountRequest, assignmentId, { projectId }),
    ).rejects.toMatchObject({ status: 404 });
    expect(query.mock.calls.some(([sql]) => sql.includes('classroom_assignment_work_start'))).toBe(
      false,
    );
  });
});
