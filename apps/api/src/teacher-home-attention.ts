import type pg from 'pg';
import type { Classroom } from '@asa-lab/classroom';
import {
  canonicalProjectionKey,
  LearningCanonicalProjectionService,
} from './learning-canonical-projection.service.js';

/** Presentation of the existing academic projection, never a persisted queue. */
export async function teacherHomeAttention(
  pool: pg.Pool,
  accountId: string,
  classrooms: Classroom[],
) {
  const active = classrooms.filter((item) => item.status === 'active');
  const classes = new Map(active.map((item) => [item.id, item.title]));
  // Constant database round trips. Existing functions retain their account/class
  // authorization; notifications and legacy counters never determine attention.
  const [projections, metadata] = await Promise.all([
    new LearningCanonicalProjectionService(pool).forTeacherAccount(accountId),
    pool.query<{
      kind: 'work' | 'request';
      classroom_id: string;
      detail: {
        id: string;
        seat_id: string;
        assignment_id: string;
        assignment_title: string;
        display_label: string;
        status: string;
      };
    }>(
      `WITH classes AS (SELECT unnest($2::uuid[]) AS id)
       SELECT 'work' AS kind, c.id AS classroom_id, to_jsonb(work) AS detail
         FROM classes c
         CROSS JOIN LATERAL classroom_gradebook_list($1,c.id) work
       UNION ALL
       SELECT 'request', c.id, to_jsonb(request)
         FROM classes c
         CROSS JOIN LATERAL classroom_account_join_requests_for_actor($1,c.id) request`,
      [accountId, [...classes.keys()]],
    ),
  ]);
  const reviews = new Map<
    string,
    {
      key: string;
      classroomId: string;
      classroomTitle: string;
      assignmentId: string;
      assignmentTitle: string;
      seatId: string;
      learnerName: string;
      attemptId: string | null;
    }
  >();
  const requests = new Map<
    string,
    { id: string; classroomId: string; classroomTitle: string; learnerName: string }
  >();
  const requestCounts = new Map<string, number>();
  for (const row of metadata.rows) {
    const classroomTitle = classes.get(row.classroom_id);
    if (classroomTitle === undefined) continue;
    const item = row.detail;
    if (row.kind === 'request') {
      requestCounts.set(row.classroom_id, (requestCounts.get(row.classroom_id) ?? 0) + 1);
      if (item.status === 'pending') {
        requests.set(item.id, {
          id: item.id,
          classroomId: row.classroom_id,
          classroomTitle,
          learnerName: item.display_label,
        });
      }
      continue;
    }
    const key = canonicalProjectionKey(item.seat_id, item.assignment_id);
    const projection = projections.get(key);
    if (
      !projection ||
      projection.surface.flags.includes('legacy_unresolved') ||
      !['submitted', 'waiting_review'].includes(projection.surface.workflowState)
    )
      continue;
    reviews.set(key, {
      key,
      classroomId: row.classroom_id,
      classroomTitle,
      assignmentId: item.assignment_id,
      assignmentTitle: item.assignment_title,
      seatId: item.seat_id,
      learnerName: item.display_label,
      // The workflow attempt can differ from the selected graded attempt.
      attemptId: projection.state.provenance.workflowAttemptId,
    });
  }
  return {
    reviews: [...reviews.values()],
    joinRequests: [...requests.values()],
    classrooms: active.map(({ id, title }) => ({ id, title })),
    // The existing join read caps history at 200 per class. Do not represent a
    // capped history with no visible pending rows as proof of no requests.
    joinRequestsMayBeLimited: [...requestCounts.values()].some((count) => count >= 200),
  };
}
