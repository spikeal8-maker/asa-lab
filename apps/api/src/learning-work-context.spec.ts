import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { CanonicalLearningProjection } from './learning-canonical-projection.service.js';
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
    query: vi.fn().mockResolvedValue({ rows: contexts.map((context) => ({ context })) }),
  } as unknown as pg.Pool;
}

const projections = new Map([[canonicalProjectionKey(seatId, assignmentId), projection]]);

describe('A1 project-scoped Learning Work Context', () => {
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
        courseBlockId: 'activity-a',
        learningActivityVersionId: versionId,
        sourceKind: 'course',
        activityRunId: runId,
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
});
