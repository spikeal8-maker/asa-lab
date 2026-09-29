import type pg from 'pg';
import {
  canonicalProjectionFromEvidence,
  type CanonicalLearningSurfaceState,
  type EvidenceRow,
} from './learning-canonical-projection.service.js';

interface OriginContext {
  projectId: string;
  seatId: string;
  classroomAssignmentId: string;
  activityRunId: string;
  participationId: string;
  sourceKind: 'direct' | 'course';
  courseBlockId: string | null;
  brief: string | null;
  goal: string | null;
  blocks: unknown[] | null;
  blocksSnapshotPresent: boolean;
  submittedAt: string | null;
  snapshotRevision: number | null;
  updatedAt: string | null;
}

interface OriginRow {
  context: OriginContext;
  evidence: EvidenceRow;
}

interface DirectRunRow {
  seat_id: string;
  classroom_assignment_id: string;
  activity_run_id: string;
}

export interface OriginListWork extends OriginContext {
  canonicalState: CanonicalLearningSurfaceState;
}

function directKey(seatId: string, assignmentId: string): string {
  return `${seatId}:${assignmentId}`;
}

function courseKey(seatId: string, runId: string, blockId: string): string {
  return `${seatId}:${runId}:${blockId}`;
}

/** A duplicate exact key is incoherent; never choose one origin arbitrarily. */
function insertUnique<T>(map: Map<string, T | null>, key: string, value: T): void {
  map.set(key, map.has(key) ? null : value);
}

export class OriginLearnerList {
  private readonly direct = new Map<string, OriginListWork | null>();
  private readonly course = new Map<string, OriginListWork | null>();
  private readonly directRuns = new Map<string, string | null>();

  constructor(origins: OriginRow[], directRuns: DirectRunRow[], asOf: string) {
    for (const row of origins) {
      const context = row.context;
      if (
        !context?.projectId ||
        !context.seatId ||
        !context.classroomAssignmentId ||
        !context.activityRunId ||
        !context.participationId ||
        row.evidence?.projectId !== context.projectId ||
        row.evidence?.activityRunId !== context.activityRunId ||
        row.evidence?.seatId !== context.seatId
      )
        continue;
      const projection = canonicalProjectionFromEvidence(
        row.evidence,
        `${context.seatId}:${context.activityRunId}`,
        asOf,
      );
      const work = { ...context, canonicalState: projection.surface };
      if (context.sourceKind === 'direct' && context.courseBlockId === null) {
        insertUnique(this.direct, directKey(context.seatId, context.classroomAssignmentId), work);
      } else if (context.sourceKind === 'course' && context.courseBlockId) {
        insertUnique(
          this.course,
          courseKey(context.seatId, context.activityRunId, context.courseBlockId),
          work,
        );
      }
    }
    for (const row of directRuns) {
      if (!row.seat_id || !row.classroom_assignment_id || !row.activity_run_id) continue;
      insertUnique(
        this.directRuns,
        directKey(row.seat_id, row.classroom_assignment_id),
        row.activity_run_id,
      );
    }
  }

  directWork(seatId: string, assignmentId: string): OriginListWork | null {
    return this.direct.get(directKey(seatId, assignmentId)) ?? null;
  }

  directAmbiguous(seatId: string, assignmentId: string): boolean {
    const key = directKey(seatId, assignmentId);
    return (
      (this.direct.has(key) && this.direct.get(key) === null) ||
      (this.directRuns.has(key) && this.directRuns.get(key) === null)
    );
  }

  directRunId(seatId: string, assignmentId: string): string | null {
    if (this.directAmbiguous(seatId, assignmentId)) return null;
    return (
      this.directWork(seatId, assignmentId)?.activityRunId ??
      this.directRuns.get(directKey(seatId, assignmentId)) ??
      null
    );
  }

  courseWork(seatId: string, runId: string, blockId: string): OriginListWork | null {
    return this.course.get(courseKey(seatId, runId, blockId)) ?? null;
  }
}

/** The two inputs come only from a validated Seat or Account session. */
export async function readOriginLearnerList(
  pool: pg.Pool,
  seatId: string | null,
  accountId: string | null,
): Promise<OriginLearnerList> {
  const [origins, directRuns] = await Promise.all([
    pool.query<OriginRow>('SELECT context,evidence FROM learning_origin_learner_list($1,$2)', [
      seatId,
      accountId,
    ]),
    pool.query<DirectRunRow>(
      'SELECT seat_id,classroom_assignment_id,activity_run_id FROM learning_direct_learner_runs($1,$2)',
      [seatId, accountId],
    ),
  ]);
  return new OriginLearnerList(origins.rows, directRuns.rows, new Date().toISOString());
}
