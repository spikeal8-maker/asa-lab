import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { OriginLearnerList, readOriginLearnerList } from './learning-origin-list.js';
import type { EvidenceRow } from './learning-canonical-projection.service.js';

const seatId = '50000000-0000-4000-8000-000000000001';
const assignmentId = '40000000-0000-4000-8000-000000000001';
const runId = '30000000-0000-4000-8000-000000000001';
const projectId = '70000000-0000-4000-8000-000000000001';
const participationId = '80000000-0000-4000-8000-000000000001';
const asOf = '2026-09-29T12:00:00.000Z';

function evidence(kind: EvidenceRow['kind'], activityRunId = runId): EvidenceRow {
  return {
    tenantId: '10000000-0000-4000-8000-000000000001',
    schoolId: '20000000-0000-4000-8000-000000000001',
    classroomId: '30000000-0000-4000-8000-000000000002',
    classroomAssignmentId: assignmentId,
    kind,
    dueAt: null,
    assignmentStatus: 'open',
    seatId,
    accountId: null,
    principalId: '60000000-0000-4000-8000-000000000001',
    learnerId: '90000000-0000-4000-8000-000000000001',
    identityResolution: 'learner_identity',
    seatStatus: 'active',
    classroomAccess: 'active',
    legacyWork: null,
    courseProgressPresent: kind === 'course_project',
    activityRunId,
    participation: { applicable: true, status: 'active', excused: false },
    attempt: {
      id: 'a0000000-0000-4000-8000-000000000001',
      attemptNumber: 1,
      revisionOfAttemptId: null,
      state: 'in_progress',
      reviewDecision: null,
      startedAt: '2026-09-29T11:00:00.000Z',
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
  };
}

function row(kind: 'direct' | 'course', activityRunId = runId, blockId: string | null = null) {
  return {
    context: {
      projectId,
      seatId,
      classroomAssignmentId: assignmentId,
      activityRunId,
      participationId,
      sourceKind: kind,
      courseBlockId: blockId,
      brief: 'Exact brief',
      goal: 'Exact goal',
      blocks: [{ id: 'exact-block' }],
      blocksSnapshotPresent: true,
      submittedAt: null,
      snapshotRevision: null,
      updatedAt: asOf,
    },
    evidence: evidence(kind === 'direct' ? 'direct_project' : 'course_project', activityRunId),
  };
}

describe('origin learner list adapter', () => {
  it('keeps Direct work and its pre-Start run target exact, with no handout inference', async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes('learning_origin_learner_list')
        ? [row('direct')]
        : [{ seat_id: seatId, classroom_assignment_id: assignmentId, activity_run_id: runId }],
    }));
    const list = await readOriginLearnerList({ query } as unknown as pg.Pool, seatId, null);
    expect(list.directWork(seatId, assignmentId)).toMatchObject({
      projectId,
      activityRunId: runId,
      canonicalState: { workflowState: 'in_progress' },
    });
    expect(list.directRunId(seatId, assignmentId)).toBe(runId);
    expect(list.directWork('wrong-seat', assignmentId)).toBeNull();
    const ambiguous = new OriginLearnerList(
      [row('direct'), row('direct', '30000000-0000-4000-8000-000000000099')],
      [
        { seat_id: seatId, classroom_assignment_id: assignmentId, activity_run_id: runId },
        { seat_id: seatId, classroom_assignment_id: assignmentId, activity_run_id: runId },
      ],
      asOf,
    );
    expect(ambiguous.directAmbiguous(seatId, assignmentId)).toBe(true);
    expect(ambiguous.directRunId(seatId, assignmentId)).toBeNull();
    expect(query).toHaveBeenCalledWith(expect.stringContaining('learning_origin_learner_list'), [
      seatId,
      null,
    ]);
  });

  it('keeps sibling Course blocks separate and treats duplicated exact keys as unavailable', () => {
    const siblingRun = '30000000-0000-4000-8000-000000000003';
    const first = row('course', runId, 'first');
    const second = row('course', siblingRun, 'second');
    second.context.projectId = '70000000-0000-4000-8000-000000000002';
    second.evidence.projectId = second.context.projectId;
    const list = new OriginLearnerList([first, second], [], asOf);
    expect(list.courseWork(seatId, runId, 'first')?.projectId).toBe(projectId);
    expect(list.courseWork(seatId, siblingRun, 'second')?.projectId).toBe(second.context.projectId);
    expect(list.courseWork(seatId, runId, 'second')).toBeNull();
    expect(
      new OriginLearnerList([first, first], [], asOf).courseWork(seatId, runId, 'first'),
    ).toBeNull();
  });
});
