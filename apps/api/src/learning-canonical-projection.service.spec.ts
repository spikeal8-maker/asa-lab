import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import {
  LearningCanonicalProjectionService,
  canonicalCourseParticipationKey,
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

  it('exposes revision origin as a learner-safe flag with no selected result', async () => {
    const pool = poolWith({
      ...base,
      legacyWork: null,
      attempt: {
        id: '80000000-0000-4000-8000-000000000002',
        attemptNumber: 2,
        revisionOfAttemptId: '80000000-0000-4000-8000-000000000001',
        state: 'in_progress',
        reviewDecision: null,
        startedAt: '2026-08-21T10:00:00.000Z',
        submittedAt: null,
        lateState: null,
      },
    });
    const item = (
      await new LearningCanonicalProjectionService(pool, {}).forSeat(
        base.seatId,
        '2026-08-22T00:00:00.000Z',
      )
    ).get(canonicalProjectionKey(base.seatId, base.classroomAssignmentId));

    expect(item?.surface.workflowState).toBe('in_progress');
    expect(item?.surface.selectedResult).toBeNull();
    expect(item?.surface.flags).toContain('revision_in_progress');
  });

  it('retains an old selected result while a new revision is in progress', async () => {
    const pool = poolWith({
      ...base,
      legacyWork: null,
      attempt: {
        id: '80000000-0000-4000-8000-000000000002',
        attemptNumber: 2,
        state: 'in_progress',
        reviewDecision: null,
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
        state: 'closed',
        reviewDecision: 'accepted',
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

  it('exposes exact course participation applicability without work or an attempt', async () => {
    const runId = '70000000-0000-4000-8000-000000000041';
    const pool = poolWith({
      ...base,
      kind: 'course_project',
      activityRunId: runId,
      legacyWork: null,
      participation: { applicable: true, status: 'active', excused: true },
    });
    const projection = new LearningCanonicalProjectionService(pool, {});
    for (const result of [
      await projection.forSeat(base.seatId, '2026-08-21T00:00:00.000Z'),
      await projection.forAccount(
        '50000000-0000-4000-8000-000000000099',
        '2026-08-21T00:00:00.000Z',
      ),
    ]) {
      const value = result.get(canonicalProjectionKey(base.seatId, base.classroomAssignmentId));
      expect(value?.participationApplicability).toEqual({ applicable: true, excused: true });
      expect(value?.state.provenance.activityRunId).toBe(runId);
      expect(value?.surface.flags).toContain('excused');
    }
  });

  it('retains two distinct Activity Runs sharing one handout without hiding excusal', async () => {
    const runA = '70000000-0000-4000-8000-000000000041';
    const runB = '70000000-0000-4000-8000-000000000042';
    const pool = poolWith(
      {
        ...base,
        kind: 'course_project',
        activityRunId: runA,
        legacyWork: null,
        participation: { applicable: true, status: 'active', excused: false },
      },
      {
        ...base,
        kind: 'course_project',
        activityRunId: runB,
        legacyWork: null,
        participation: { applicable: true, status: 'active', excused: true },
      },
    );
    const service = new LearningCanonicalProjectionService(pool, {});
    for (const snapshot of [
      await service.forSeatCourseRuns(base.seatId, '2026-08-21T00:00:00.000Z'),
      await service.forAccountCourseRuns(
        '50000000-0000-4000-8000-000000000099',
        '2026-08-21T00:00:00.000Z',
      ),
    ]) {
      expect(snapshot.projections.size).toBe(1);
      expect(snapshot.participationByRun.size).toBe(2);
      expect(snapshot.courseProjectionsByRun.size).toBe(2);
      const runAKey = canonicalCourseParticipationKey(base.seatId, runA);
      const runBKey = canonicalCourseParticipationKey(base.seatId, runB);
      expect(snapshot.courseProjectionsByRun.get(runAKey)?.surface.activityRunId).toBe(runA);
      expect(snapshot.courseProjectionsByRun.get(runBKey)?.surface.activityRunId).toBe(runB);
      expect(
        snapshot.participationByRun.get(canonicalCourseParticipationKey(base.seatId, runA)),
      ).toEqual({
        classroomAssignmentId: base.classroomAssignmentId,
        applicable: true,
        excused: false,
      });
      expect(
        snapshot.participationByRun.get(canonicalCourseParticipationKey(base.seatId, runB)),
      ).toEqual({
        classroomAssignmentId: base.classroomAssignmentId,
        applicable: true,
        excused: true,
      });
    }
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('isolates a selected accepted result from another run and learner seat', async () => {
    const runA = '70000000-0000-4000-8000-000000000041';
    const runB = '70000000-0000-4000-8000-000000000042';
    const foreignSeat = '50000000-0000-4000-8000-000000000002';
    const acceptedAttempt = {
      id: '80000000-0000-4000-8000-000000000041',
      attemptNumber: 1,
      state: 'closed',
      reviewDecision: 'accepted',
      startedAt: '2026-10-27T09:00:00.000Z',
      submittedAt: '2026-10-27T09:20:00.000Z',
      lateState: 'on_time',
    };
    const acceptedResult = {
      id: '90000000-0000-4000-8000-000000000041',
      attemptId: acceptedAttempt.id,
      rawPoints: 20,
      maxPoints: 20,
      percentageBasisPoints: 10000,
      displayGrade: '5',
      outcome: 'passed',
      publishedAt: '2026-10-27T09:30:00.000Z',
      completionValue: true,
    };
    const accepted = {
      ...base,
      kind: 'course_project',
      activityRunId: runA,
      participation: { applicable: true, status: 'active', excused: false },
      legacyWork: null,
      attempt: acceptedAttempt,
      selectedAttemptExists: true,
      resultSelectionSource: 'canonical',
      selectedAttemptId: acceptedAttempt.id,
      selectedRevision: acceptedResult,
    };
    const awaiting = {
      ...base,
      kind: 'course_project',
      activityRunId: runB,
      participation: { applicable: true, status: 'active', excused: false },
      legacyWork: null,
      attempt: {
        ...acceptedAttempt,
        id: '80000000-0000-4000-8000-000000000042',
        state: 'submitted',
        reviewDecision: null,
      },
    };
    const pool = poolWith(accepted, awaiting, {
      ...accepted,
      seatId: foreignSeat,
      activityRunId: runB,
    });
    const snapshot = await new LearningCanonicalProjectionService(pool, {}).forAccountCourseRuns(
      '50000000-0000-4000-8000-000000000099',
      '2026-10-27T10:00:00.000Z',
    );
    expect(snapshot.projections.size).toBe(2);
    expect(snapshot.courseProjectionsByRun.size).toBe(3);
    const acceptedKey = canonicalCourseParticipationKey(base.seatId, runA);
    const awaitingKey = canonicalCourseParticipationKey(base.seatId, runB);
    const foreignKey = canonicalCourseParticipationKey(foreignSeat, runB);
    const acceptedState = snapshot.courseProjectionsByRun.get(acceptedKey)?.surface;
    const awaitingState = snapshot.courseProjectionsByRun.get(awaitingKey)?.surface;
    const foreignState = snapshot.courseProjectionsByRun.get(foreignKey)?.surface;
    expect(acceptedState?.selectedResult?.completionValue).toBe(true);
    expect(awaitingState).toMatchObject({
      activityRunId: runB,
      workflowState: 'submitted',
      selectedResult: null,
    });
    expect(foreignState?.selectedResult?.completionValue).toBe(true);
  });

  it('fails closed when one seat and ActivityRun have duplicate canonical evidence', async () => {
    const runId = '70000000-0000-4000-8000-000000000041';
    const evidence = {
      ...base,
      kind: 'course_project',
      activityRunId: runId,
      participation: { applicable: true, status: 'active', excused: false },
      legacyWork: null,
    };
    const service = new LearningCanonicalProjectionService(poolWith(evidence, evidence), {});
    const snapshot = await service.forSeatCourseRuns(base.seatId, '2026-10-27T10:00:00.000Z');
    const runKey = canonicalCourseParticipationKey(base.seatId, runId);
    expect(snapshot.courseProjectionsByRun.get(runKey)).toBeNull();
    expect(snapshot.participationByRun.has(runKey)).toBe(false);
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

  it('restores the same canonical state after a canonical to legacy to canonical round trip', async () => {
    const evidence = {
      ...base,
      legacyWork: {
        projectId: '70000000-0000-4000-8000-000000000001',
        startedAt: '2026-08-20T10:00:00.000Z',
        submittedAt: '2026-08-20T11:00:00.000Z',
      },
    };
    const before = structuredClone(evidence);
    const pool = poolWith(evidence);

    const first = await new LearningCanonicalProjectionService(pool, {
      LEARNING_CANONICAL_READS: 'canonical',
    }).forSeat(base.seatId, '2026-08-21T00:00:00.000Z');
    const legacy = await new LearningCanonicalProjectionService(pool, {
      LEARNING_CANONICAL_READS: 'legacy',
    }).forSeat(base.seatId, '2026-08-21T00:00:00.000Z');
    const restored = await new LearningCanonicalProjectionService(pool, {
      LEARNING_CANONICAL_READS: 'canonical',
    }).forSeat(base.seatId, '2026-08-21T00:00:00.000Z');

    expect(legacy.size).toBe(0);
    expect(restored).toEqual(first);
    expect(evidence).toEqual(before);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
});

describe('exact teacher review queue projection', () => {
  it('keeps direct and course sibling workflow attempts separate and fails closed on duplicate evidence', async () => {
    const runA = '70000000-0000-4000-8000-000000000071';
    const runB = '70000000-0000-4000-8000-000000000072';
    const row = (run: string, kind: string, attempt: unknown) => ({
      detail: { seatId: base.seatId, activityRunId: run, assignmentId: base.classroomAssignmentId },
      evidence: {
        ...base,
        kind,
        learnerId: '20000000-0000-4000-8000-000000000071',
        identityResolution: 'learner_identity',
        activityRunId: run,
        participation: { applicable: true, status: 'active', excused: false },
        legacyWork: null,
        attempt,
      },
    });
    const a = row(runA, 'direct_project', null);
    const b = row(runB, 'course_project', {
      id: '80000000-0000-4000-8000-000000000072',
      attemptNumber: 1,
      state: 'submitted',
      reviewDecision: null,
      startedAt: '2026-10-27T09:00:00Z',
      submittedAt: '2026-10-27T09:10:00Z',
      lateState: 'on_time',
    });
    const query = vi.fn().mockResolvedValue({ rows: [a, b] });
    const service = new LearningCanonicalProjectionService({ query } as unknown as pg.Pool, {});
    const result = await service.forTeacherReviewQueue(
      'actor',
      base.classroomId,
      base.classroomAssignmentId,
    );
    expect(
      result.projections.get(canonicalCourseParticipationKey(base.seatId, runA))?.state,
    ).toMatchObject({ workflowState: 'not_started', provenance: { workflowAttemptId: null } });
    expect(
      result.projections.get(canonicalCourseParticipationKey(base.seatId, runB))?.state,
    ).toMatchObject({
      workflowState: 'submitted',
      provenance: {
        workflowAttemptId: b.evidence.attempt && (b.evidence.attempt as { id: string }).id,
      },
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      'SELECT detail,evidence FROM learning_teacher_review_queue($1,$2,$3)',
      ['actor', base.classroomId, base.classroomAssignmentId],
    );
    query.mockResolvedValue({ rows: [a, a, b] });
    expect(
      (
        await service.forTeacherReviewQueue('actor', base.classroomId, base.classroomAssignmentId)
      ).projections.get(canonicalCourseParticipationKey(base.seatId, runA)),
    ).toBeNull();
  });
});
