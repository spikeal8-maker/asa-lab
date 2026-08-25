import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import {
  LearningCanonicalProjectionService,
  canonicalProjectionKey,
  canonicalReadsEnabled,
} from './learning-canonical-projection.service.js';

const base = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  schoolId: '20000000-0000-4000-8000-000000000001',
  classroomId: '30000000-0000-4000-8000-000000000001',
  classroomAssignmentId: '40000000-0000-4000-8000-000000000001',
  kind: 'direct_project',
  dueAt: null,
  assignmentStatus: 'open',
  seatId: '50000000-0000-4000-8000-000000000001',
  accountId: null,
  principalId: '60000000-0000-4000-8000-000000000001',
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
} as const;

function poolWith(...rows: Array<Record<string, unknown>>): pg.Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: rows.map((evidence) => ({ evidence })) }),
  } as unknown as pg.Pool;
}

describe('LRN-M0-007 canonical projection boundary', () => {
  it('runs direct project, course project and quiz evidence through the same resolver boundary', async () => {
    const rows = (['direct_project', 'course_project', 'quiz'] as const).map((kind, index) => ({
      ...base,
      kind,
      classroomAssignmentId: `40000000-0000-4000-8000-00000000000${index + 1}`,
      legacyWork:
        kind === 'quiz'
          ? null
          : {
              projectId: `70000000-0000-4000-8000-00000000000${index + 1}`,
              startedAt: '2026-08-20T10:00:00.000Z',
              submittedAt: null,
            },
    }));
    const pool = poolWith(...rows);
    const result = await new LearningCanonicalProjectionService(pool, {}).forTeacher(
      'a0000000-0000-4000-8000-000000000001',
      base.classroomId,
      '2026-08-21T00:00:00.000Z',
    );

    expect(result.size).toBe(3);
    expect(
      rows.map(
        (row) =>
          result.get(canonicalProjectionKey(base.seatId, row.classroomAssignmentId))?.surface
            .workflowState,
      ),
    ).toEqual(['in_progress', 'in_progress', 'not_started']);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('maps legacy submitted to one submitted semantic state and redacts learner diagnostics', async () => {
    const pool = poolWith({
      ...base,
      legacyWork: {
        projectId: '70000000-0000-4000-8000-000000000001',
        startedAt: '2026-08-20T10:00:00.000Z',
        submittedAt: '2026-08-20T11:00:00.000Z',
      },
    });
    const service = new LearningCanonicalProjectionService(pool, {});
    const result = await service.forSeat(base.seatId, '2026-08-21T00:00:00.000Z');
    const item = result.get(canonicalProjectionKey(base.seatId, base.classroomAssignmentId));

    expect(item?.state.workflowState).toBe('submitted');
    expect(item?.state.flags).toEqual(['legacy_unresolved', 'legacy_compatibility']);
    expect(item?.surface.flags).toEqual([]);
    expect(item?.surface).not.toHaveProperty('compatibilityDiagnostic');
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('retains an old selected result while a new revision is in progress', async () => {
    const pool = poolWith({
      ...base,
      legacyWork: null,
      attempt: {
        id: '80000000-0000-4000-8000-000000000002',
        attemptNumber: 2,
        state: 'in_progress',
        startedAt: '2026-08-21T10:00:00.000Z',
        submittedAt: null,
        lateState: null,
      },
      selectedAttemptExists: true,
      resultSelectionSource: 'gradebook_pointer',
      selectedAttemptId: '80000000-0000-4000-8000-000000000001',
      selectedResult: {
        id: '90000000-0000-4000-8000-000000000001',
        attemptId: '80000000-0000-4000-8000-000000000001',
        rawPoints: 80,
        maxPoints: 100,
        percentageBasisPoints: 8000,
        displayGrade: '4',
        outcome: 'passed',
        publishedAt: '2026-08-20T12:00:00.000Z',
      },
    });
    const item = (
      await new LearningCanonicalProjectionService(pool, {}).forTeacher(
        'a0000000-0000-4000-8000-000000000001',
        base.classroomId,
        '2026-08-22T00:00:00.000Z',
      )
    ).get(canonicalProjectionKey(base.seatId, base.classroomAssignmentId));

    expect(item?.surface.workflowState).toBe('in_progress');
    expect(item?.surface.selectedResult?.displayGrade).toBe('4');
    expect(item?.surface.flags).toContain('revision_in_progress');
  });

  it('keeps compatibility grading unknown instead of fabricating a one-point scale', async () => {
    const pool = poolWith({
      ...base,
      legacyWork: null,
      attempt: {
        id: '80000000-0000-4000-8000-000000000001',
        attemptNumber: 1,
        state: 'accepted',
        startedAt: '2026-08-20T10:00:00.000Z',
        submittedAt: '2026-08-20T11:00:00.000Z',
        lateState: 'on_time',
      },
      selectedAttemptExists: true,
      resultSelectionSource: 'gradebook_pointer',
      selectedAttemptId: '80000000-0000-4000-8000-000000000001',
      selectedResult: {
        id: '90000000-0000-4000-8000-000000000001',
        attemptId: '80000000-0000-4000-8000-000000000001',
        rawPoints: null,
        maxPoints: null,
        percentageBasisPoints: null,
        displayGrade: null,
        outcome: null,
        publishedAt: '2026-08-20T12:00:00.000Z',
      },
      compatibilityGradingUnknown: true,
      reusableAuthoredContent: false,
    });
    const item = (
      await new LearningCanonicalProjectionService(pool, {}).forSeat(
        base.seatId,
        '2026-08-22T00:00:00.000Z',
      )
    ).get(canonicalProjectionKey(base.seatId, base.classroomAssignmentId));

    expect(item?.surface.selectedResult).toMatchObject({
      rawPoints: null,
      maxPoints: null,
      percentageBasisPoints: null,
      displayGrade: null,
    });
    expect(item?.compatibilityGradingUnknown).toBe(true);
    expect(item?.reusableAuthoredContent).toBe(false);
  });

  it('rejects a selected-result pointer whose scope does not match the assignment', async () => {
    const pool = poolWith({
      ...base,
      legacyWork: null,
      selectedAttemptExists: true,
      resultSelectionSource: 'gradebook_pointer',
      selectedAttemptId: '80000000-0000-4000-8000-000000000001',
      selectedResult: {
        id: '90000000-0000-4000-8000-000000000001',
        attemptId: '80000000-0000-4000-8000-000000000001',
        rawPoints: 100,
        maxPoints: 100,
        percentageBasisPoints: 10_000,
        displayGrade: '5',
        outcome: 'passed',
        publishedAt: '2026-08-20T12:00:00.000Z',
      },
      selectionConflict: 'pointer_scope_mismatch',
    });
    const item = (
      await new LearningCanonicalProjectionService(pool, {}).forTeacher(
        'a0000000-0000-4000-8000-000000000001',
        base.classroomId,
        '2026-08-22T00:00:00.000Z',
      )
    ).get(canonicalProjectionKey(base.seatId, base.classroomAssignmentId));

    expect(item?.surface.selectedResult).toBeNull();
    expect(item?.state.provenance.conflicts).toContain('pointer_scope_mismatch');
  });

  it('has an explicit reversible legacy cutover that bypasses canonical reads', async () => {
    expect(canonicalReadsEnabled({ LEARNING_CANONICAL_READS: 'legacy' })).toBe(false);
    expect(canonicalReadsEnabled({ LEARNING_CANONICAL_READS: 'canonical' })).toBe(true);
    expect(canonicalReadsEnabled({})).toBe(true);
    const pool = poolWith({ ...base, legacyWork: null });
    const projection = await new LearningCanonicalProjectionService(pool, {
      LEARNING_CANONICAL_READS: 'legacy',
    }).forSeat(base.seatId);
    expect(projection.size).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
