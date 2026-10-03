import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type {
  CanonicalLearningProjection,
  EvidenceRow,
} from './learning-canonical-projection.service.js';
import { canonicalProjectionKey } from './learning-canonical-projection.service.js';
import { learningWorkContextForProject } from './learning-work-context.js';

const projectId = '10000000-0000-4000-8000-000000000001';
const seatId = '20000000-0000-4000-8000-000000000001';
const assignmentId = '30000000-0000-4000-8000-000000000001';
const runId = '40000000-0000-4000-8000-000000000001';
const versionId = '50000000-0000-4000-8000-000000000001';

const row = {
  projectId,
  seatId,
  classroomAssignmentId: assignmentId,
  activityRunId: runId,
  participationId: '60000000-0000-4000-8000-000000000001',
  learningActivityVersionId: versionId,
  assignmentVersionId: null,
  runVersionId: versionId,
  versionNumber: 2,
  contentDigest: 'a'.repeat(64),
  sourceKind: 'course',
  courseRunId: '70000000-0000-4000-8000-000000000001',
  courseLessonId: '80000000-0000-4000-8000-000000000001',
  courseBlockId: 'activity-a',
  title: 'Соберите робота',
  brief: 'Работайте по образцу.',
  goal: null,
  moduleKey: 'electronics',
  sampleImage: null,
  dueAt: null,
  assignmentStatus: 'open',
  runStatus: 'active',
  courseStatus: 'open',
  classroomStatus: 'active',
  seatStatus: 'active',
  participationStatus: 'active',
  participationExcused: false,
  effectiveConditions: {
    values: { opensAt: null, dueAt: null, closesAt: null, latePolicy: 'allow_mark_late' },
  },
  submittedAt: null,
  snapshotRevision: 1,
  updatedAt: null,
  attemptId: null,
  attemptNumber: null,
  submissionId: null,
  submittedProjectVersionId: null,
  classroomTitle: 'Класс',
  courseTitle: 'Курс',
  lessonTitle: 'Урок',
};

const projection = {
  projectId,
  surface: {
    workflowState: 'in_progress',
    selectedResult: null,
    flags: [],
    learnerMessageCode: null,
    effectiveDueAt: null,
    activityRunId: runId,
  },
  state: {
    provenance: { activityRunId: runId, workflowAttemptId: null, conflicts: [] },
    visibility: { learnerCurrentAccess: 'visible' },
  },
} as unknown as CanonicalLearningProjection;

function poolWith(...contexts: unknown[]): pg.Pool {
  return {
    query: vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('learning_origin_work_context_for_project')) return { rows: [] };
      if (sql.includes('learning_immutable_project_origin_exists'))
        return { rows: [{ linked: false }] };
      if (sql.includes('learning_work_context_for_project'))
        return { rows: contexts.map((context) => ({ context })) };
      if (sql.includes('learning_course_modern_provenance'))
        return {
          rows: [{ proof: { modernCourseRun: true, activityRunId: runId, projectReadable: true } }],
        };
      if (sql.includes('learning_direct_modern_project_readable'))
        return { rows: [{ readable: true }] };
      if (sql.includes('learning_legacy_direct_provenance'))
        return {
          rows: [
            {
              proof: { legacyDirect: true, legacyCourseLesson: true, legacyProjectReadable: true },
            },
          ],
        };
      return { rows: [{ linked: false }] };
    }),
  } as unknown as pg.Pool;
}

const projections = new Map([[canonicalProjectionKey(seatId, assignmentId), projection]]);

const originEvidence: EvidenceRow = {
  tenantId: 'school-tenant',
  schoolId: 'school',
  classroomId: 'classroom',
  classroomAssignmentId: assignmentId,
  kind: 'course_project',
  dueAt: null,
  assignmentStatus: 'open',
  seatId,
  accountId: null,
  principalId: 'seat-principal',
  learnerId: 'learner',
  identityResolution: 'learner_identity',
  seatStatus: 'active',
  classroomAccess: 'active',
  legacyWork: null,
  courseProgressPresent: true,
  attempt: {
    id: 'a0000000-0000-4000-8000-000000000001',
    attemptNumber: 1,
    state: 'in_progress',
    startedAt: '2026-09-26T00:00:00Z',
    submittedAt: null,
    lateState: null,
  },
  selectedAttemptExists: false,
  activityRunId: runId,
  participation: { applicable: true, status: 'active', excused: false },
  selectedRevision: null,
  resultSelectionSource: 'canonical',
  selectedAttemptId: null,
  selectedResult: null,
  selectionConflict: null,
  validUnselectedResultCount: 0,
  compatibilityGradingUnknown: false,
  reusableAuthoredContent: true,
  projectId,
};

describe('A1 project-scoped Learning Work Context', () => {
  it('uses exact immutable origin evidence even when handout projection points to a sibling', async () => {
    const exactAttempt = originEvidence.attempt!.id;
    const originRow = { ...row, attemptId: exactAttempt, attemptNumber: 1 };
    const pool = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('learning_origin_work_context_for_project'))
          return { rows: [{ context: originRow, evidence: originEvidence }] };
        if (sql.includes('learning_project_archive_bucket'))
          return { rows: [{ bucket: 'active' }] };
        if (sql.includes('learning_course_activity_sample_url_for_viewer'))
          return { rows: [{ sample_image: null }] };
        throw new Error('handout fallback was attempted');
      }),
    } as unknown as pg.Pool;
    const sibling = new Map([
      [
        canonicalProjectionKey(seatId, assignmentId),
        { ...projection, projectId: 'sibling', state: { ...projection.state } },
      ],
    ]) as Map<string, CanonicalLearningProjection>;
    const context = await learningWorkContextForProject(
      pool,
      'viewer',
      projectId,
      'electronics',
      sibling,
      '2026-09-27T00:00:00.000Z',
    );
    expect(context).toMatchObject({
      state: 'ready',
      origin: { immutable: true, activityRunId: runId, courseBlockId: 'activity-a' },
      workflow: { attemptId: exactAttempt, canonicalState: { workflowState: 'in_progress' } },
    });
  });

  it.each([
    ['completed', 'completed', true, false],
    ['learning_archive', 'learning_archive', false, true],
    ['active', 'working', false, false],
  ] as const)(
    'uses shared server archive policy %s for exact original actions',
    async (bucket, expectedCollection, canMove, canRestore) => {
      const completedEvidence =
        bucket === 'active'
          ? originEvidence
          : {
              ...originEvidence,
              attempt: {
                ...originEvidence.attempt!,
                state: 'closed' as const,
                reviewDecision: 'accepted' as const,
                submittedAt: '2026-09-26T01:00:00Z',
              },
            };
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('learning_origin_work_context_for_project'))
          return {
            rows: [
              {
                context: { ...row, attemptId: originEvidence.attempt!.id },
                evidence: completedEvidence,
              },
            ],
          };
        if (sql.includes('learning_project_archive_bucket')) return { rows: [{ bucket }] };
        throw new Error('unexpected project context query');
      });
      const result = await learningWorkContextForProject(
        { query } as unknown as pg.Pool,
        'viewer',
        projectId,
        'electronics',
        new Map(),
        '2026-09-27T00:00:00.000Z',
        undefined,
        false,
      );
      expect(result).toMatchObject({
        state: 'ready',
        presentation: { learnerCollectionState: expectedCollection },
        allowedActions: { moveToLearningArchive: canMove, restoreFromLearningArchive: canRestore },
      });
    },
  );

  it('never falls back to shared handout work when immutable origin is unreadable', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ linked: true }],
        }),
    } as unknown as pg.Pool;
    await expect(
      learningWorkContextForProject(pool, 'viewer', projectId, 'electronics', projections),
    ).resolves.toEqual({ state: 'denied', projectId });
    expect((pool.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('returns exact Course Activity block and canonical server actions', async () => {
    const result = await learningWorkContextForProject(
      poolWith(row),
      'viewer',
      projectId,
      'electronics',
      projections,
      '2026-09-27T00:00:00.000Z',
    );
    expect(result).toMatchObject({
      state: 'ready',
      origin: {
        immutable: false,
        courseBlockId: 'activity-a',
        learningActivityVersionId: versionId,
        sourceKind: 'course',
        activityRunId: runId,
        courseLessonId: row.courseLessonId,
      },
      task: { versionNumber: 2, contentDigest: 'a'.repeat(64) },
      workflow: { canonicalState: { workflowState: 'in_progress' } },
      allowedActions: {
        edit: true,
        submit: true,
        createPersonalCopy: false,
        changeGenericProjectStatus: false,
        publishOriginal: false,
      },
    });
  });

  it.each([
    ['course', row, 'learning_course_modern_provenance'],
    [
      'direct',
      {
        ...row,
        sourceKind: 'direct',
        courseRunId: null,
        courseLessonId: null,
        courseBlockId: null,
      },
      'learning_direct_modern_project_readable',
    ],
    [
      'historical course',
      { ...row, activityRunId: null, sourceKind: 'course', courseBlockId: null },
      'learning_legacy_direct_provenance',
    ],
  ] as const)(
    'denies remembered %s Project ID when its viewer-scoped no-origin proof is withdrawn',
    async (_name, candidate, proofFunction) => {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('learning_origin_work_context_for_project')) return { rows: [] };
        if (sql.includes('learning_immutable_project_origin_exists'))
          return { rows: [{ linked: false }] };
        if (sql.includes('learning_work_context_for_project'))
          return { rows: [{ context: candidate }] };
        if (sql.includes(proofFunction)) return { rows: [{ proof: {}, readable: false }] };
        throw new Error('unexpected context query after revoked proof');
      });
      const context = await learningWorkContextForProject(
        { query } as unknown as pg.Pool,
        'viewer',
        projectId,
        'electronics',
        projections,
      );
      expect(context).toEqual({ state: 'denied', projectId });
      expect(query.mock.calls.some(([sql]) => sql.includes(proofFunction))).toBe(true);
    },
  );

  it('only calls a provably personal project not_learning', async () => {
    await expect(
      learningWorkContextForProject(poolWith(), 'viewer', projectId, 'electronics', projections),
    ).resolves.toEqual({ state: 'not_learning', projectId });
  });

  it('distinguishes a linked project hidden from this viewer from a personal project', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ linked: false }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ linked: true }],
        }),
    } as unknown as pg.Pool;
    await expect(
      learningWorkContextForProject(pool, 'viewer', projectId, 'electronics', projections),
    ).resolves.toEqual({ state: 'denied', projectId });
  });

  it('fails closed on ambiguous origins, version mismatch, and missing canonical evidence', async () => {
    for (const [pool, canon] of [
      [poolWith(row, row), projections],
      [poolWith({ ...row, assignmentVersionId: 'different' }), projections],
      [poolWith(row), new Map()],
    ] as const) {
      await expect(
        learningWorkContextForProject(pool, 'viewer', projectId, 'electronics', canon),
      ).resolves.toEqual({ state: 'unavailable', projectId });
    }
  });

  it('denies restricted evidence and blocks actions after close', async () => {
    const restricted = new Map([
      [
        canonicalProjectionKey(seatId, assignmentId),
        {
          ...projection,
          state: {
            ...projection.state,
            visibility: {
              ...projection.state.visibility,
              learnerCurrentAccess: 'restricted',
            },
          },
        } as CanonicalLearningProjection,
      ],
    ]);
    await expect(
      learningWorkContextForProject(poolWith(row), 'viewer', projectId, 'electronics', restricted),
    ).resolves.toEqual({ state: 'denied', projectId });
    const closed = await learningWorkContextForProject(
      poolWith({
        ...row,
        effectiveConditions: {
          values: {
            opensAt: null,
            dueAt: null,
            closesAt: '2026-09-26T00:00:00.000Z',
            latePolicy: 'allow_mark_late',
          },
        },
      }),
      'viewer',
      projectId,
      'electronics',
      projections,
      '2026-09-27T00:00:00.000Z',
    );
    expect(closed.state).toBe('ready');
    if (closed.state === 'ready') expect(closed.allowedActions.submit).toBe(false);
  });

  it('allows a teacher-unlocked late submit and resume under block_at_due', async () => {
    const asOf = '2026-09-27T00:00:00.000Z';
    const overdue = {
      ...row,
      effectiveConditions: {
        values: {
          opensAt: null,
          dueAt: '2026-09-26T00:00:00.000Z',
          closesAt: null,
          latePolicy: 'block_at_due',
        },
        teacherUnlocked: false,
      },
    };
    const locked = await learningWorkContextForProject(
      poolWith(overdue),
      'viewer',
      projectId,
      'electronics',
      projections,
      asOf,
    );
    expect(locked.state).toBe('ready');
    if (locked.state === 'ready') expect(locked.allowedActions.submit).toBe(false);

    const unlocked = await learningWorkContextForProject(
      poolWith({
        ...overdue,
        effectiveConditions: { ...overdue.effectiveConditions, teacherUnlocked: true },
      }),
      'viewer',
      projectId,
      'electronics',
      projections,
      asOf,
    );
    expect(unlocked.state).toBe('ready');
    if (unlocked.state === 'ready') expect(unlocked.allowedActions.submit).toBe(true);

    const revisedProjection = {
      ...projection,
      surface: { ...projection.surface, workflowState: 'changes_requested' },
    } as CanonicalLearningProjection;
    const revised = new Map([[canonicalProjectionKey(seatId, assignmentId), revisedProjection]]);
    const resumed = await learningWorkContextForProject(
      poolWith({
        ...overdue,
        effectiveConditions: { ...overdue.effectiveConditions, teacherUnlocked: true },
      }),
      'viewer',
      projectId,
      'electronics',
      revised,
      asOf,
    );
    expect(resumed.state).toBe('ready');
    if (resumed.state === 'ready') {
      expect(resumed.allowedActions.resumeAfterChangesRequested).toBe(false);
      expect(resumed.allowedActions.submit).toBe(false);
    }
  });

  it('keeps returned direct work ready when the legacy submitted marker is cleared', async () => {
    const attemptId = '90000000-0000-4000-8000-000000000001';
    const submissionId = 'a0000000-0000-4000-8000-000000000001';
    const returnedRow = {
      ...row,
      sourceKind: 'direct' as const,
      courseRunId: null,
      courseLessonId: null,
      courseBlockId: null,
      attemptId,
      attemptNumber: 1,
      submissionId,
      submittedProjectVersionId: 'b0000000-0000-4000-8000-000000000001',
      submittedAt: null,
    };
    const returnedProjection = {
      ...projection,
      surface: { ...projection.surface, workflowState: 'changes_requested' },
      state: {
        ...projection.state,
        provenance: {
          ...projection.state.provenance,
          workflowAuthority: 'latest_attempt',
          workflowAttemptId: attemptId,
          conflicts: ['attempt_legacy_submission_mismatch'],
        },
      },
    } as CanonicalLearningProjection;
    const returned = new Map([[canonicalProjectionKey(seatId, assignmentId), returnedProjection]]);
    const returnedPool = poolWith(returnedRow);
    const context = await learningWorkContextForProject(
      returnedPool,
      'viewer',
      projectId,
      'electronics',
      returned,
    );
    expect(context).toMatchObject({
      state: 'ready',
      origin: { immutable: false, sourceKind: 'direct', learningActivityVersionId: versionId },
      workflow: { attemptId, submissionId, canonicalState: { workflowState: 'changes_requested' } },
      allowedActions: { edit: false, submit: false, resumeAfterChangesRequested: false },
    });
    expect(
      (returnedPool.query as ReturnType<typeof vi.fn>).mock.calls.some(([sql]) =>
        sql.includes('learning_direct_modern_project_readable'),
      ),
    ).toBe(true);

    for (const [candidateRow, candidateProjection] of [
      [{ ...returnedRow, submittedAt: '2026-09-26T00:00:00.000Z' }, returnedProjection],
      [{ ...returnedRow, submissionId: null }, returnedProjection],
      [
        returnedRow,
        {
          ...returnedProjection,
          state: {
            ...returnedProjection.state,
            provenance: {
              ...returnedProjection.state.provenance,
              conflicts: ['attempt_legacy_submission_mismatch', 'pointer_scope_mismatch'],
            },
          },
        } as CanonicalLearningProjection,
      ],
    ] as const) {
      await expect(
        learningWorkContextForProject(
          poolWith(candidateRow),
          'viewer',
          projectId,
          'electronics',
          new Map([[canonicalProjectionKey(seatId, assignmentId), candidateProjection]]),
        ),
      ).resolves.toEqual({ state: 'unavailable', projectId });
    }
  });

  it('offers rework only for an exact old linked Project with supported Submit proof', async () => {
    const oldRow = {
      ...row,
      activityRunId: null,
      participationId: null,
      runVersionId: null,
      sourceKind: 'direct' as const,
      courseRunId: null,
      courseLessonId: null,
      courseBlockId: null,
      attemptId: '90000000-0000-4000-8000-000000000010',
      submissionId: 'a0000000-0000-4000-8000-000000000010',
      submittedAt: null,
    };
    const returnedProjection = {
      ...projection,
      surface: { ...projection.surface, activityRunId: null, workflowState: 'changes_requested' },
      state: {
        ...projection.state,
        provenance: {
          ...projection.state.provenance,
          activityRunId: null,
          workflowAttemptId: oldRow.attemptId,
          workflowAuthority: 'latest_attempt',
          conflicts: ['attempt_legacy_submission_mismatch'],
        },
      },
    } as CanonicalLearningProjection;
    const returned = new Map([[canonicalProjectionKey(seatId, assignmentId), returnedProjection]]);
    for (const submitAllowed of [true, false]) {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('learning_origin_work_context_for_project')) return { rows: [] };
        if (sql.includes('learning_immutable_project_origin_exists'))
          return { rows: [{ linked: false }] };
        if (sql.includes('learning_work_context_for_project'))
          return { rows: [{ context: oldRow }] };
        if (sql.includes('learning_legacy_direct_provenance'))
          return {
            rows: [
              {
                proof: {
                  legacyDirect: true,
                  legacyProjectReadable: true,
                  submitAllowed,
                },
              },
            ],
          };
        return { rows: [] };
      });
      const result = await learningWorkContextForProject(
        { query } as unknown as pg.Pool,
        'viewer',
        projectId,
        'electronics',
        returned,
      );
      expect(result).toMatchObject({
        state: 'ready',
        allowedActions: {
          edit: submitAllowed,
          submit: submitAllowed,
          resumeAfterChangesRequested: submitAllowed,
        },
      });
    }
  });
});
