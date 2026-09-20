import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

type RunResult = {
  result_code: string;
  activity_run_id: string | null;
  lifecycle_status: string | null;
  reused: boolean;
};

const policies = {
  attemptPolicy: { maxAttempts: 2 },
  resultSelectionPolicy: { mode: 'latest' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};

let admin: pg.Pool;
let app: pg.Pool;
let owner: SeededTeacher;
let outsider: SeededTeacher;
let ownerPrincipalId: string;
let ownerAccountId: string;
let outsiderPrincipalId: string;
let classroomId: string;
let secondClassroomId: string;
let learnerPrincipalId: string;
let lavActivityId: string;
let lavV1: string;
let sequence = 0;

async function inTenant<T>(tenantId: string, callback: (client: pg.PoolClient) => Promise<T>) {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantId]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createCanonicalVersion(input: {
  principalId?: string;
  tenantId?: string;
  title?: string;
}) {
  sequence += 1;
  const principalId = input.principalId ?? ownerPrincipalId;
  const tenantId = input.tenantId ?? owner.tenantId;
  const request = `m1:003:activity:${sequence}`;
  const created = await admin.query(
    `SELECT * FROM learning_activity_create(
       $1,$2,'school','private','project',$3,$4,'graded',20,$5::jsonb,
       'electronics',NULL,NULL,NULL,$6
     )`,
    [
      principalId,
      tenantId,
      input.title ?? `Activity ${sequence}`,
      `Instructions ${sequence}`,
      JSON.stringify(policies),
      request,
    ],
  );
  expect(created.rows[0].result_code).toBe('ok');
  const published = await admin.query(`SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)`, [
    principalId,
    tenantId,
    created.rows[0].activity_id,
    `${request}:publish`,
  ]);
  expect(published.rows[0].result_code).toBe('ok');
  return {
    activityId: created.rows[0].activity_id as string,
    versionId: published.rows[0].activity_version_id as string,
  };
}

async function createDirectHandout(targetClassroomId = classroomId) {
  sequence += 1;
  const authored = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES ($1,$2,$3,'Build it','electronics','private') RETURNING id`,
    [owner.tenantId, ownerPrincipalId, `Direct ${sequence}`],
  );
  const handout = await admin.query(
    `INSERT INTO classroom_assignments
       (tenant_id,classroom_id,assignment_id,status,created_by)
     VALUES ($1,$2,$3,'open',$4) RETURNING id`,
    [owner.tenantId, targetClassroomId, authored.rows[0].id, owner.teacherId],
  );
  return handout.rows[0].id as string;
}

async function createCourseHandout(targetClassroomId = classroomId) {
  sequence += 1;
  const course = await admin.query(
    `INSERT INTO courses (tenant_id,owner_principal_id,title,visibility)
     VALUES ($1,$2,$3,'private') RETURNING id`,
    [owner.tenantId, ownerPrincipalId, `Course ${sequence}`],
  );
  const version = await admin.query(
    `INSERT INTO course_versions
       (tenant_id,course_id,version_number,title,outline,content_hash,
        published_by_principal_id)
     VALUES ($1,$2,1,$3,'{"sections":[]}'::jsonb,$4,$5) RETURNING id`,
    [owner.tenantId, course.rows[0].id, `Course ${sequence}`, `run-${sequence}`, ownerPrincipalId],
  );
  const run = await admin.query(
    `INSERT INTO classroom_course_runs
       (tenant_id,classroom_id,course_id,course_version_id,title,version_number,
        assigned_by_principal_id)
     VALUES ($1,$2,$3,$4,$5,1,$6) RETURNING id`,
    [
      owner.tenantId,
      targetClassroomId,
      course.rows[0].id,
      version.rows[0].id,
      `Course ${sequence}`,
      ownerPrincipalId,
    ],
  );
  const handout = await admin.query(
    `INSERT INTO classroom_assignments
       (tenant_id,classroom_id,status,created_by,course_run_id)
     VALUES ($1,$2,'open',$3,$4) RETURNING id`,
    [owner.tenantId, targetClassroomId, owner.teacherId, run.rows[0].id],
  );
  const lesson = await admin.query(
    `INSERT INTO classroom_course_run_lessons
       (tenant_id,run_id,source_section_id,source_lesson_id,section_title,
        section_position,title,kind,lesson_position,classroom_assignment_id,
        assignment_title,assignment_brief,module_key)
     VALUES ($1,$2,gen_random_uuid(),gen_random_uuid(),'Section',1,$3,'assignment',1,
             $4,$3,'Course work','electronics') RETURNING id`,
    [owner.tenantId, run.rows[0].id, `Course lesson ${sequence}`, handout.rows[0].id],
  );
  return {
    handoutId: handout.rows[0].id as string,
    courseRunId: run.rows[0].id as string,
    lessonId: lesson.rows[0].id as string,
  };
}

async function createCourseCompatibilityHandout(
  courseRunId: string,
  targetClassroomId = classroomId,
) {
  const handout = await admin.query(
    `INSERT INTO classroom_assignments
       (tenant_id,classroom_id,status,created_by,course_run_id)
     VALUES ($1,$2,'open',$3,$4) RETURNING id`,
    [owner.tenantId, targetClassroomId, owner.teacherId, courseRunId],
  );
  return handout.rows[0].id as string;
}

async function createCourseMaterialLesson(courseRunId: string) {
  sequence += 1;
  const lesson = await admin.query(
    `INSERT INTO classroom_course_run_lessons
       (tenant_id,run_id,source_section_id,source_lesson_id,section_title,
        section_position,title,kind,lesson_position)
     VALUES ($1,$2,gen_random_uuid(),gen_random_uuid(),'Section',1,$3,'material',2)
     RETURNING id`,
    [owner.tenantId, courseRunId, `Activity block lesson ${sequence}`],
  );
  return lesson.rows[0].id as string;
}

async function createRun(input: {
  handoutId: string;
  versionId?: string;
  sourceKind?: 'direct' | 'course';
  courseRunId?: string | null;
  lessonId?: string | null;
  blockId?: string | null;
  opensAt?: string | null;
  dueAt?: string | null;
  closesAt?: string | null;
  latePolicy?: string | null;
  gradingSchemeId?: string | null;
  runtimeExplicit?: Record<string, unknown>;
  requestId?: string;
  actorPrincipalId?: string;
  tenantId?: string;
}) {
  sequence += 1;
  return inTenant(input.tenantId ?? owner.tenantId, async (client) => {
    const requestId = input.requestId ?? `m1:003:run:${sequence}`;
    const values = [
      input.actorPrincipalId ?? ownerPrincipalId,
      input.handoutId,
      input.versionId ?? lavV1,
      input.sourceKind ?? 'direct',
      input.courseRunId ?? null,
      input.lessonId ?? null,
      input.opensAt ?? null,
      input.dueAt ?? null,
      input.closesAt ?? null,
      input.latePolicy ?? null,
      input.gradingSchemeId ?? null,
      JSON.stringify(input.runtimeExplicit ?? {}),
      requestId,
    ];
    const hasBlockId = Object.prototype.hasOwnProperty.call(input, 'blockId');
    const result = await client.query(
      hasBlockId
        ? `SELECT * FROM activity_run_create(
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14
           )`
        : `SELECT * FROM activity_run_create(
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13
           )`,
      hasBlockId ? [...values, input.blockId ?? null] : values,
    );
    return result.rows[0] as RunResult;
  });
}

async function cloneCourseOccurrence(sourceRunId: string, blockId: string | null) {
  sequence += 1;
  const result = await admin.query(
    `INSERT INTO activity_runs (
       tenant_id,school_id,classroom_id,learning_activity_version_id,source_kind,
       source_classroom_assignment_id,source_course_run_id,source_course_lesson_id,
       source_course_block_id,lifecycle_status,opens_at,due_at,closes_at,late_policy,
       grading_scheme_version_id,runtime_policy_snapshot,created_by_principal_id,
       creation_request_id,creation_request_digest,closed_at,cancelled_at,archived_at
     )
     SELECT tenant_id,school_id,classroom_id,learning_activity_version_id,source_kind,
       source_classroom_assignment_id,source_course_run_id,source_course_lesson_id,
       $2,lifecycle_status,opens_at,due_at,closes_at,late_policy,
       grading_scheme_version_id,runtime_policy_snapshot,created_by_principal_id,
       $3,$4,closed_at,cancelled_at,archived_at
       FROM activity_runs
      WHERE id=$1
     RETURNING id,source_course_block_id`,
    [sourceRunId, blockId, `e1:11d1:occurrence:${sequence}`, 'd'.repeat(64)],
  );
  return result.rows[0] as { id: string; source_course_block_id: string | null };
}

async function transition(runId: string, target: string | null) {
  return inTenant(owner.tenantId, async (client) => {
    const result = await client.query(`SELECT * FROM activity_run_transition($1,$2,$3)`, [
      ownerPrincipalId,
      runId,
      target,
    ]);
    return result.rows[0] as RunResult;
  });
}

async function availability(runId: string, asOf: string) {
  return inTenant(owner.tenantId, async (client) => {
    const result = await client.query(`SELECT * FROM activity_run_base_availability($1,$2,$3)`, [
      ownerPrincipalId,
      runId,
      asOf,
    ]);
    return result.rows[0] as Record<string, unknown>;
  });
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'learning-m1-003-owner');
  outsider = await seedTeacher(admin, 'learning-m1-003-outsider');
  const ownerIdentity = await admin.query(
    `SELECT principal_id,account_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [owner.tenantId, owner.teacherId],
  );
  ownerPrincipalId = ownerIdentity.rows[0].principal_id as string;
  ownerAccountId = ownerIdentity.rows[0].account_id as string;
  const outsiderIdentity = await admin.query(
    `SELECT principal_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [outsider.tenantId, outsider.teacherId],
  );
  outsiderPrincipalId = outsiderIdentity.rows[0].principal_id as string;

  const classroom = await admin.query(
    `INSERT INTO classrooms (tenant_id,school_id,academic_period_id,title,created_by)
     VALUES ($1,$2,$3,'M1-003 ActivityRun',$4) RETURNING id`,
    [owner.tenantId, owner.schoolId, owner.periodId, owner.teacherId],
  );
  classroomId = classroom.rows[0].id as string;
  const second = await admin.query(
    `INSERT INTO classrooms (tenant_id,school_id,academic_period_id,title,created_by)
     VALUES ($1,$2,$3,'M1-003 other class',$4) RETURNING id`,
    [owner.tenantId, owner.schoolId, owner.periodId, owner.teacherId],
  );
  secondClassroomId = second.rows[0].id as string;
  await admin.query(
    `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES ($1,$2,$3,$4,'owner'),($1,$5,$3,$4,'owner')`,
    [owner.tenantId, classroomId, owner.teacherId, ownerAccountId, secondClassroomId],
  );
  const seat = await admin.query(
    `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
        safe_mode,status,created_by)
     VALUES ($1,$2,'Learner','m1-003-learner','m1-003-learner',true,'active',$3)
     RETURNING id`,
    [owner.tenantId, classroomId, owner.teacherId],
  );
  const learnerPrincipal = await admin.query(
    `INSERT INTO principals (kind,seat_id) VALUES ('student_seat',$1) RETURNING id`,
    [seat.rows[0].id],
  );
  learnerPrincipalId = learnerPrincipal.rows[0].id as string;
  const lav = await createCanonicalVersion({ title: 'Canonical ActivityRun v1' });
  lavActivityId = lav.activityId;
  lavV1 = lav.versionId;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('LRN-M1-003 persistent ActivityRun', () => {
  it('creates direct and course runs in one physical model with exact provenance', async () => {
    const directHandout = await createDirectHandout();
    const course = await createCourseHandout();
    const direct = await createRun({ handoutId: directHandout });
    const courseRun = await createRun({
      handoutId: course.handoutId,
      sourceKind: 'course',
      courseRunId: course.courseRunId,
      lessonId: course.lessonId,
    });
    expect(direct).toMatchObject({ result_code: 'ok', lifecycle_status: 'active' });
    expect(courseRun).toMatchObject({ result_code: 'ok', lifecycle_status: 'active' });
    const stored = await admin.query(
      `SELECT id,source_kind,source_course_run_id,source_course_lesson_id,
              learning_activity_version_id
         FROM activity_runs WHERE id=ANY($1::uuid[]) ORDER BY source_kind`,
      [[direct.activity_run_id, courseRun.activity_run_id]],
    );
    expect(stored.rows).toEqual([
      expect.objectContaining({
        source_kind: 'course',
        source_course_run_id: course.courseRunId,
        source_course_lesson_id: course.lessonId,
        learning_activity_version_id: lavV1,
      }),
      expect.objectContaining({
        source_kind: 'direct',
        source_course_run_id: null,
        source_course_lesson_id: null,
        learning_activity_version_id: lavV1,
      }),
    ]);
  });

  it('pins LAV v1 immutably when the author later publishes v2', async () => {
    const handout = await createDirectHandout();
    const run = await createRun({ handoutId: handout });
    const draft = await admin.query(
      `SELECT * FROM learning_activity_draft_put(
         $1,$2,$3,1,'Canonical ActivityRun v2','Changed','graded',20,$4::jsonb,
         'electronics',NULL,NULL
       )`,
      [ownerPrincipalId, owner.tenantId, lavActivityId, JSON.stringify(policies)],
    );
    const published = await admin.query(`SELECT * FROM learning_activity_publish($1,$2,$3,2,$4)`, [
      ownerPrincipalId,
      owner.tenantId,
      lavActivityId,
      'm1:003:publish:v2',
    ]);
    expect(draft.rows[0].draft_revision).toBe(2);
    expect(published.rows[0].activity_version_id).not.toBe(lavV1);
    const stored = await admin.query(
      `SELECT learning_activity_version_id FROM activity_runs WHERE id=$1`,
      [run.activity_run_id],
    );
    expect(stored.rows[0].learning_activity_version_id).toBe(lavV1);
    await expect(
      admin.query(`UPDATE activity_runs SET learning_activity_version_id=$1 WHERE id=$2`, [
        published.rows[0].activity_version_id,
        run.activity_run_id,
      ]),
    ).rejects.toThrow(/immutable/);
  });

  it('makes direct create retry and concurrency one logical row', async () => {
    const handout = await createDirectHandout();
    const requestId = `m1:003:concurrent:${++sequence}`;
    const [a, b] = await Promise.all([
      createRun({ handoutId: handout, requestId }),
      createRun({ handoutId: handout, requestId }),
    ]);
    expect(a.activity_run_id).toBe(b.activity_run_id);
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    const count = await admin.query(
      `SELECT count(*)::int AS count FROM activity_runs
        WHERE source_classroom_assignment_id=$1`,
      [handout],
    );
    expect(count.rows[0].count).toBe(1);
    const retry = await createRun({ handoutId: handout, requestId });
    expect(retry).toMatchObject({ activity_run_id: a.activity_run_id, reused: true });
    await admin.query(`UPDATE classroom_assignments SET status='closed' WHERE id=$1`, [handout]);
    const delayedRetry = await createRun({ handoutId: handout, requestId });
    expect(delayedRetry).toMatchObject({ activity_run_id: a.activity_run_id, reused: true });
    const conflict = await createRun({
      handoutId: handout,
      requestId,
      dueAt: '2026-05-01T00:00:00Z',
    });
    expect(conflict.result_code).toBe('idempotency_conflict');
  });

  it('makes exact course lesson retry one row without inventing a block id', async () => {
    const source = await createCourseHandout();
    const requestId = `m1:003:course:${++sequence}`;
    const first = await createRun({
      handoutId: source.handoutId,
      sourceKind: 'course',
      courseRunId: source.courseRunId,
      lessonId: source.lessonId,
      requestId,
    });
    const retry = await createRun({
      handoutId: source.handoutId,
      sourceKind: 'course',
      courseRunId: source.courseRunId,
      lessonId: source.lessonId,
      requestId,
    });
    expect(retry).toMatchObject({ activity_run_id: first.activity_run_id, reused: true });
    await admin.query(`UPDATE classroom_course_runs SET status='closed' WHERE id=$1`, [
      source.courseRunId,
    ]);
    const delayedRetry = await createRun({
      handoutId: source.handoutId,
      sourceKind: 'course',
      courseRunId: source.courseRunId,
      lessonId: source.lessonId,
      requestId,
    });
    expect(delayedRetry).toMatchObject({ activity_run_id: first.activity_run_id, reused: true });
    const stored = await admin.query(
      `SELECT source_course_block_id FROM activity_runs WHERE id=$1`,
      [first.activity_run_id],
    );
    expect(stored.rows[0]).toEqual({ source_course_block_id: null });
  });

  it('E1-FIX-11D1 distinguishes course occurrences by nullable block identity', async () => {
    const source = await createCourseHandout();
    const legacy = await createRun({
      handoutId: source.handoutId,
      sourceKind: 'course',
      courseRunId: source.courseRunId,
      lessonId: source.lessonId,
    });
    expect(legacy).toMatchObject({ result_code: 'ok', lifecycle_status: 'active' });

    const legacyStored = await admin.query(
      `SELECT source_course_block_id FROM activity_runs WHERE id=$1`,
      [legacy.activity_run_id],
    );
    expect(legacyStored.rows[0]).toEqual({ source_course_block_id: null });

    await expect(cloneCourseOccurrence(legacy.activity_run_id!, null)).rejects.toThrow(
      /duplicate key/,
    );

    const blockA = await cloneCourseOccurrence(legacy.activity_run_id!, 'activity-block-a');
    const blockB = await cloneCourseOccurrence(legacy.activity_run_id!, 'activity-block-b');
    expect(blockA.source_course_block_id).toBe('activity-block-a');
    expect(blockB.source_course_block_id).toBe('activity-block-b');
    expect(blockA.id).not.toBe(blockB.id);

    const occurrences = await admin.query(
      `SELECT source_course_block_id
         FROM activity_runs
        WHERE source_course_run_id=$1 AND source_course_lesson_id=$2
        ORDER BY source_course_block_id NULLS FIRST`,
      [source.courseRunId, source.lessonId],
    );
    expect(occurrences.rows).toEqual([
      { source_course_block_id: null },
      { source_course_block_id: 'activity-block-a' },
      { source_course_block_id: 'activity-block-b' },
    ]);

    await expect(
      cloneCourseOccurrence(legacy.activity_run_id!, 'activity-block-a'),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      admin.query(`UPDATE activity_runs SET source_course_block_id='other-block' WHERE id=$1`, [
        blockA.id,
      ]),
    ).rejects.toThrow(/immutable/);
  });

  it('E1-FIX-11D3a creates block-aware course runs without collapsing lesson occurrences', async () => {
    const source = await createCourseHandout();
    const legacy = await createRun({
      handoutId: source.handoutId,
      sourceKind: 'course',
      courseRunId: source.courseRunId,
      lessonId: source.lessonId,
      blockId: null,
      requestId: `e1:11d3a:legacy:${++sequence}`,
    });
    expect(legacy).toMatchObject({ result_code: 'ok', reused: false });
    expect(
      (
        await admin.query('SELECT source_course_block_id FROM activity_runs WHERE id=$1', [
          legacy.activity_run_id,
        ])
      ).rows[0],
    ).toEqual({ source_course_block_id: null });

    const materialLessonId = await createCourseMaterialLesson(source.courseRunId);
    const blockAHandout = await createCourseCompatibilityHandout(source.courseRunId);
    const blockBHandout = await createCourseCompatibilityHandout(source.courseRunId);
    const blockARequest = `e1:11d3a:block-a:${++sequence}`;
    const blockA = await createRun({
      handoutId: blockAHandout,
      sourceKind: 'course',
      courseRunId: source.courseRunId,
      lessonId: materialLessonId,
      blockId: 'activity-block-a',
      requestId: blockARequest,
    });
    expect(blockA).toMatchObject({ result_code: 'ok', reused: false });

    const blockARetry = await createRun({
      handoutId: blockAHandout,
      sourceKind: 'course',
      courseRunId: source.courseRunId,
      lessonId: materialLessonId,
      blockId: 'activity-block-a',
      requestId: blockARequest,
    });
    expect(blockARetry).toMatchObject({ activity_run_id: blockA.activity_run_id, reused: true });

    const blockADuplicateRequest = await createRun({
      handoutId: blockAHandout,
      sourceKind: 'course',
      courseRunId: source.courseRunId,
      lessonId: materialLessonId,
      blockId: 'activity-block-a',
      requestId: `e1:11d3a:block-a-retry:${++sequence}`,
    });
    expect(blockADuplicateRequest).toMatchObject({
      activity_run_id: blockA.activity_run_id,
      reused: true,
    });

    const blockB = await createRun({
      handoutId: blockBHandout,
      sourceKind: 'course',
      courseRunId: source.courseRunId,
      lessonId: materialLessonId,
      blockId: 'activity-block-b',
      requestId: `e1:11d3a:block-b:${++sequence}`,
    });
    expect(blockB).toMatchObject({ result_code: 'ok', reused: false });
    expect(blockB.activity_run_id).not.toBe(blockA.activity_run_id);

    const occurrences = await admin.query(
      `SELECT id,source_classroom_assignment_id,source_course_block_id
         FROM activity_runs
        WHERE source_course_run_id=$1 AND source_course_lesson_id=$2
        ORDER BY source_course_block_id NULLS FIRST`,
      [source.courseRunId, materialLessonId],
    );
    expect(occurrences.rows).toEqual([
      {
        id: blockA.activity_run_id,
        source_classroom_assignment_id: blockAHandout,
        source_course_block_id: 'activity-block-a',
      },
      {
        id: blockB.activity_run_id,
        source_classroom_assignment_id: blockBHandout,
        source_course_block_id: 'activity-block-b',
      },
    ]);

    const legacyMismatch = await createRun({
      handoutId: blockAHandout,
      sourceKind: 'course',
      courseRunId: source.courseRunId,
      lessonId: source.lessonId,
      blockId: null,
      requestId: `e1:11d3a:legacy-mismatch:${++sequence}`,
    });
    expect(legacyMismatch.result_code).toBe('course_source_forbidden');

    const foreign = await createCourseHandout();
    const foreignLesson = await createRun({
      handoutId: blockAHandout,
      sourceKind: 'course',
      courseRunId: source.courseRunId,
      lessonId: foreign.lessonId,
      blockId: 'activity-block-foreign-lesson',
      requestId: `e1:11d3a:foreign-lesson:${++sequence}`,
    });
    expect(foreignLesson.result_code).toBe('course_source_forbidden');

    const foreignHandout = await createCourseCompatibilityHandout(foreign.courseRunId);
    const foreignAssignment = await createRun({
      handoutId: foreignHandout,
      sourceKind: 'course',
      courseRunId: source.courseRunId,
      lessonId: materialLessonId,
      blockId: 'activity-block-foreign-assignment',
      requestId: `e1:11d3a:foreign-assignment:${++sequence}`,
    });
    expect(foreignAssignment.result_code).toBe('course_source_forbidden');

    const malformedBlock = await createRun({
      handoutId: await createCourseCompatibilityHandout(source.courseRunId),
      sourceKind: 'course',
      courseRunId: source.courseRunId,
      lessonId: materialLessonId,
      blockId: 'bad block id',
      requestId: `e1:11d3a:bad-block:${++sequence}`,
    });
    expect(malformedBlock.result_code).toBe('invalid_source');
  });

  it('supports only active to closed/cancelled and closed to archived', async () => {
    const closedRun = await createRun({ handoutId: await createDirectHandout() });
    expect(await transition(closedRun.activity_run_id!, 'closed')).toMatchObject({
      result_code: 'ok',
      lifecycle_status: 'closed',
    });
    expect(await transition(closedRun.activity_run_id!, 'archived')).toMatchObject({
      result_code: 'ok',
      lifecycle_status: 'archived',
    });
    const cancelledRun = await createRun({ handoutId: await createDirectHandout() });
    expect(await transition(cancelledRun.activity_run_id!, 'cancelled')).toMatchObject({
      lifecycle_status: 'cancelled',
    });
    expect(await transition(cancelledRun.activity_run_id!, 'active')).toMatchObject({
      result_code: 'invalid_transition',
      lifecycle_status: 'cancelled',
    });
    expect(await transition(cancelledRun.activity_run_id!, null)).toMatchObject({
      result_code: 'invalid_transition',
      lifecycle_status: 'cancelled',
    });
    await expect(
      admin.query(`DELETE FROM activity_runs WHERE id=$1`, [closedRun.activity_run_id]),
    ).rejects.toThrow(/append-preserved/);
  });

  it('validates chronology and derives scheduled/open/late/closed-by-time without scheduler state', async () => {
    const invalid = await createRun({
      handoutId: await createDirectHandout(),
      opensAt: '2026-01-20T00:00:00Z',
      dueAt: '2026-01-10T00:00:00Z',
    });
    expect(invalid.result_code).toBe('invalid_dates');
    const run = await createRun({
      handoutId: await createDirectHandout(),
      opensAt: '2026-01-10T00:00:00Z',
      dueAt: '2026-01-20T00:00:00Z',
      closesAt: '2026-01-30T00:00:00Z',
      latePolicy: 'allow_mark_late',
    });
    expect(await availability(run.activity_run_id!, '2026-01-01T00:00:00Z')).toMatchObject({
      availability_status: 'scheduled',
      can_start: false,
    });
    expect(await availability(run.activity_run_id!, '2026-01-15T00:00:00Z')).toMatchObject({
      availability_status: 'open',
      is_late: false,
    });
    expect(await availability(run.activity_run_id!, '2026-01-25T00:00:00Z')).toMatchObject({
      availability_status: 'open',
      is_late: true,
    });
    expect(await availability(run.activity_run_id!, '2026-02-01T00:00:00Z')).toMatchObject({
      availability_status: 'closed_by_time',
      can_submit: false,
    });
    const blocked = await createRun({
      handoutId: await createDirectHandout(),
      dueAt: '2026-01-20T00:00:00Z',
      latePolicy: 'block_at_due',
    });
    expect(await availability(blocked.activity_run_id!, '2026-01-25T00:00:00Z')).toMatchObject({
      availability_status: 'closed_by_due',
      is_late: true,
      can_submit: false,
    });
    const statusConstraint = await admin.query(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conname='activity_runs_lifecycle_status_check'`,
    );
    expect(statusConstraint.rows[0].definition).not.toMatch(/scheduled|late|closed_by_time/);
  });

  it('keeps nullable late policy unresolved instead of flattening the LAV default', async () => {
    const run = await createRun({
      handoutId: await createDirectHandout(),
      dueAt: '2026-01-20T00:00:00Z',
      runtimeExplicit: { attemptLimit: 3, timeLimitMinutes: 40 },
    });
    const late = await availability(run.activity_run_id!, '2026-01-25T00:00:00Z');
    expect(late).toMatchObject({
      availability_status: 'open',
      is_late: true,
      can_start: null,
      can_submit: null,
      explicit_late_policy: null,
      policy_resolution_required: true,
    });
    const stored = await admin.query(
      `SELECT late_policy,runtime_policy_snapshot FROM activity_runs WHERE id=$1`,
      [run.activity_run_id],
    );
    expect(stored.rows[0]).toEqual({
      late_policy: null,
      runtime_policy_snapshot: {
        contractVersion: 1,
        explicit: { attemptLimit: 3, timeLimitMinutes: 40 },
        sources: {
          attemptLimit: 'activity_run_explicit',
          timeLimitMinutes: 'activity_run_explicit',
        },
      },
    });
  });

  it('pins only an explicit same-school grading version and invents no default', async () => {
    const noPin = await createRun({ handoutId: await createDirectHandout() });
    const noPinStored = await admin.query(
      `SELECT grading_scheme_version_id FROM activity_runs WHERE id=$1`,
      [noPin.activity_run_id],
    );
    expect(noPinStored.rows[0].grading_scheme_version_id).toBeNull();
    const scheme = await admin.query(
      `INSERT INTO grading_scheme_versions
       (tenant_id,school_id,version_number,title,bands,published_by_principal_id)
       VALUES ($1,$2,99,'Explicit run scale',
         '[{"minBasisPoints":0,"label":"A"},{"minBasisPoints":5000,"label":"B"}]'::jsonb,$3)
       RETURNING id`,
      [owner.tenantId, owner.schoolId, ownerPrincipalId],
    );
    const pinned = await createRun({
      handoutId: await createDirectHandout(),
      gradingSchemeId: scheme.rows[0].id,
    });
    const pinnedStored = await admin.query(
      `SELECT grading_scheme_version_id FROM activity_runs WHERE id=$1`,
      [pinned.activity_run_id],
    );
    expect(pinnedStored.rows[0].grading_scheme_version_id).toBe(scheme.rows[0].id);
  });

  it('lets a course parent limit availability without mutating or reopening the child', async () => {
    const source = await createCourseHandout();
    const run = await createRun({
      handoutId: source.handoutId,
      sourceKind: 'course',
      courseRunId: source.courseRunId,
      lessonId: source.lessonId,
    });
    await admin.query(`UPDATE classroom_course_runs SET status='closed' WHERE id=$1`, [
      source.courseRunId,
    ]);
    expect(await availability(run.activity_run_id!, '2026-01-01T00:00:00Z')).toMatchObject({
      availability_status: 'parent_closed',
      parent_limited: true,
    });
    expect(await transition(run.activity_run_id!, 'closed')).toMatchObject({
      lifecycle_status: 'closed',
    });
    await admin.query(`UPDATE classroom_course_runs SET status='open' WHERE id=$1`, [
      source.courseRunId,
    ]);
    expect(await availability(run.activity_run_id!, '2026-01-01T00:00:00Z')).toMatchObject({
      availability_status: 'closed',
      can_start: false,
    });
  });

  it('rejects wrong-class course provenance and forged direct/course source shapes', async () => {
    const source = await createCourseHandout();
    const wrongClass = await createCourseHandout(secondClassroomId);
    const mismatch = await createRun({
      handoutId: source.handoutId,
      sourceKind: 'course',
      courseRunId: wrongClass.courseRunId,
      lessonId: wrongClass.lessonId,
    });
    expect(mismatch.result_code).toBe('course_source_forbidden');
    const forgedDirect = await createRun({
      handoutId: source.handoutId,
      sourceKind: 'direct',
    });
    expect(forgedDirect.result_code).toBe('source_conflict');
  });

  it('rejects foreign tenant/owner LAV and learner or outside-teacher creation', async () => {
    const foreign = await createCanonicalVersion({
      principalId: outsiderPrincipalId,
      tenantId: outsider.tenantId,
      title: 'Foreign LAV',
    });
    const handout = await createDirectHandout();
    expect(
      (await createRun({ handoutId: handout, versionId: foreign.versionId })).result_code,
    ).toBe('activity_version_forbidden');
    expect(
      (
        await createRun({
          handoutId: await createDirectHandout(),
          actorPrincipalId: learnerPrincipalId,
        })
      ).result_code,
    ).toBe('forbidden');
    expect(
      (
        await createRun({
          handoutId: await createDirectHandout(),
          actorPrincipalId: outsiderPrincipalId,
        })
      ).result_code,
    ).toBe('forbidden');
  });

  it('rejects migration compatibility LAV as authored source', async () => {
    const handout = await createDirectHandout();
    const compatibilityLav = await createCanonicalVersion({ title: 'Compatibility-only LAV' });
    const batch = await admin.query(
      `INSERT INTO learning_migration_batches
       (id,tenant_id,school_id,batch_key,operation_kind,mode,state,source_snapshot_digest,as_of)
       VALUES (gen_random_uuid(),$1,$2,$3,'m0_identity_activity_convergence','manual','active',$4,now())
       RETURNING id`,
      [owner.tenantId, owner.schoolId, `m1-003-compat-${++sequence}`, 'c'.repeat(64)],
    );
    await admin.query(
      `INSERT INTO learning_migration_compatibility_activity_versions
       (tenant_id,classroom_assignment_id,learning_activity_version_id,source_batch_id,
        grading_semantics,reusable_authored_content)
       VALUES ($1,$2,$3,$4,'unknown',false)`,
      [owner.tenantId, handout, compatibilityLav.versionId, batch.rows[0].id],
    );
    const result = await createRun({ handoutId: handout, versionId: compatibilityLav.versionId });
    expect(result.result_code).toBe('compatibility_version_forbidden');
  });

  it('creates no learner runtime rows and leaves CourseEnrollment untouched', async () => {
    const handoutId = await createDirectHandout();
    const run = await createRun({ handoutId });
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM learning_attempts
            WHERE classroom_assignment_id=$1`,
          [handoutId],
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM learning_submissions submission
            JOIN learning_attempts attempt ON attempt.id=submission.attempt_id
           WHERE attempt.classroom_assignment_id=$1`,
          [handoutId],
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM course_enrollments
            WHERE assigned_by_principal_id=$1`,
          [ownerPrincipalId],
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    const participation = await admin.query(
      `SELECT count(*)::int AS count FROM activity_participations
        WHERE activity_run_id=$1`,
      [run.activity_run_id],
    );
    expect(participation.rows).toEqual([{ count: 0 }]);
  });

  it('denies runtime direct table access and immutable UUID mutation', async () => {
    const run = await createRun({ handoutId: await createDirectHandout() });
    await expect(
      inTenant(owner.tenantId, (client) =>
        client.query(`SELECT * FROM activity_runs WHERE id=$1`, [run.activity_run_id]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      inTenant(owner.tenantId, (client) =>
        client.query(`UPDATE activity_runs SET source_kind='course' WHERE id=$1`, [
          run.activity_run_id,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    const privileges = await admin.query(
      `SELECT has_table_privilege('asalab_app','activity_runs','SELECT') AS can_select,
              has_table_privilege('asalab_app','activity_runs','INSERT') AS can_insert,
              has_table_privilege('asalab_app','activity_runs','UPDATE') AS can_update,
              has_table_privilege('asalab_app','activity_runs','DELETE') AS can_delete`,
    );
    expect(privileges.rows[0]).toEqual({
      can_select: false,
      can_insert: false,
      can_update: false,
      can_delete: false,
    });
  });

  it('appends one audit event per real create/lifecycle transition', async () => {
    const run = await createRun({ handoutId: await createDirectHandout() });
    await transition(run.activity_run_id!, 'closed');
    await transition(run.activity_run_id!, 'closed');
    await transition(run.activity_run_id!, 'archived');
    const events = await admin.query(
      `SELECT action FROM audit_events
        WHERE entity_type='activity_run' AND entity_id=$1 ORDER BY id`,
      [run.activity_run_id],
    );
    expect(events.rows.map((row) => row.action)).toEqual([
      'activity_run.created',
      'activity_run.closed',
      'activity_run.archived',
    ]);
  });
});
