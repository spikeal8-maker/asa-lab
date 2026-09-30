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

interface OriginPresenceRow {
  seat_id: string;
  source_kind: 'direct' | 'course';
  classroom_assignment_id: string;
  activity_run_id: string;
  course_block_id: string | null;
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
  private readonly courseLessons = new Map<string, OriginListWork | null>();
  private readonly directRuns = new Map<string, string | null>();
  private readonly directPresence = new Set<string>();
  private readonly coursePresence = new Set<string>();
  private readonly courseLessonPresence = new Set<string>();

  constructor(
    origins: OriginRow[],
    directRuns: DirectRunRow[],
    asOf: string,
    presence: OriginPresenceRow[] = [],
  ) {
    for (const row of presence) {
      if (row.source_kind === 'direct' && row.course_block_id === null)
        this.directPresence.add(directKey(row.seat_id, row.classroom_assignment_id));
      else if (row.source_kind === 'course' && row.course_block_id)
        this.coursePresence.add(courseKey(row.seat_id, row.activity_run_id, row.course_block_id));
      else if (row.source_kind === 'course' && row.course_block_id === null)
        this.courseLessonPresence.add(courseKey(row.seat_id, row.activity_run_id, 'lesson'));
    }
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
        const key = directKey(context.seatId, context.classroomAssignmentId);
        this.directPresence.add(key);
        insertUnique(this.direct, key, work);
      } else if (context.sourceKind === 'course' && context.courseBlockId) {
        const key = courseKey(context.seatId, context.activityRunId, context.courseBlockId);
        this.coursePresence.add(key);
        insertUnique(this.course, key, work);
      } else if (context.sourceKind === 'course' && context.courseBlockId === null) {
        const key = courseKey(context.seatId, context.activityRunId, 'lesson');
        this.courseLessonPresence.add(key);
        insertUnique(this.courseLessons, key, work);
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

  directHasOrigin(seatId: string, assignmentId: string): boolean {
    return this.directPresence.has(directKey(seatId, assignmentId));
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
    if (this.directHasOrigin(seatId, assignmentId) && !this.directWork(seatId, assignmentId))
      return null;
    return (
      this.directWork(seatId, assignmentId)?.activityRunId ??
      this.directRuns.get(directKey(seatId, assignmentId)) ??
      null
    );
  }

  courseWork(seatId: string, runId: string, blockId: string): OriginListWork | null {
    return this.course.get(courseKey(seatId, runId, blockId)) ?? null;
  }

  courseHasOrigin(seatId: string, runId: string, blockId: string): boolean {
    return this.coursePresence.has(courseKey(seatId, runId, blockId));
  }

  courseLessonWork(seatId: string, runId: string): OriginListWork | null {
    return this.courseLessons.get(courseKey(seatId, runId, 'lesson')) ?? null;
  }

  courseLessonHasOrigin(seatId: string, runId: string): boolean {
    return this.courseLessonPresence.has(courseKey(seatId, runId, 'lesson'));
  }
}

/** The two inputs come only from a validated Seat or Account session. */
export async function readOriginLearnerList(
  pool: pg.Pool,
  seatId: string | null,
  accountId: string | null,
): Promise<OriginLearnerList> {
  const [origins, directRuns, presence] = await Promise.all([
    pool.query<OriginRow>('SELECT context,evidence FROM learning_origin_learner_list($1,$2)', [
      seatId,
      accountId,
    ]),
    pool.query<DirectRunRow>(
      'SELECT seat_id,classroom_assignment_id,activity_run_id FROM learning_direct_learner_runs($1,$2)',
      [seatId, accountId],
    ),
    pool.query<OriginPresenceRow>(
      'SELECT seat_id,source_kind,classroom_assignment_id,activity_run_id,course_block_id FROM learning_origin_learner_presence($1,$2)',
      [seatId, accountId],
    ),
  ]);
  return new OriginLearnerList(
    origins.rows,
    directRuns.rows,
    new Date().toISOString(),
    presence.rows,
  );
}
