import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

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
let ownerAccount: string;
let ownerPrincipal: string;
let outsiderPrincipal: string;
let lav: string;
let sequence = 0;

async function inTenant<T>(tenant: string, callback: (client: pg.PoolClient) => Promise<T>) {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenant]);
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

async function createClassroom(title = `Audience classroom ${++sequence}`) {
  const row = await admin.query(
    `INSERT INTO classrooms (tenant_id,school_id,academic_period_id,title,created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [owner.tenantId, owner.schoolId, owner.periodId, title, owner.teacherId],
  );
  await admin.query(
    `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES ($1,$2,$3,$4,'owner')`,
    [owner.tenantId, row.rows[0].id, owner.teacherId, ownerAccount],
  );
  return row.rows[0].id as string;
}

async function createSeat(
  classroom: string,
  status: 'issued' | 'active' | 'suspended' | 'removed' = 'issued',
  identity?: string,
) {
  const key = `aud-${++sequence}`;
  const seat = await admin.query(
    `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
        safe_mode,status,created_by)
     VALUES ($1,$2,$3,$4,$4,true,$5,$6) RETURNING id`,
    [owner.tenantId, classroom, `Learner ${sequence}`, key, status, owner.teacherId],
  );
  if (identity) {
    await admin.query(
      `INSERT INTO learner_identity_links
         (id,tenant_id,school_id,learner_identity_id,link_kind,seat_id)
       VALUES (gen_random_uuid(),$1,$2,$3,'student_seat',$4)`,
      [owner.tenantId, owner.schoolId, identity, seat.rows[0].id],
    );
  }
  return seat.rows[0].id as string;
}

async function createIdentity() {
  return (
    await admin.query(
      `INSERT INTO learner_identities (id,tenant_id,school_id)
       VALUES (gen_random_uuid(),$1,$2) RETURNING id`,
      [owner.tenantId, owner.schoolId],
    )
  ).rows[0].id as string;
}

async function learnerForSeat(seat: string) {
  return (
    await admin.query(
      `SELECT learner_identity_id FROM learner_identity_links
        WHERE seat_id=$1 AND status='active'`,
      [seat],
    )
  ).rows[0]?.learner_identity_id as string | undefined;
}

async function directRun(
  classroom: string,
  options: { opensAt?: string; lifecycle?: string; handoutStatus?: string } = {},
) {
  const authored = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES ($1,$2,$3,'Build','electronics','private') RETURNING id`,
    [owner.tenantId, ownerPrincipal, `Audience direct ${++sequence}`],
  );
  const handout = await admin.query(
    `INSERT INTO classroom_assignments
       (tenant_id,classroom_id,assignment_id,status,created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [
      owner.tenantId,
      classroom,
      authored.rows[0].id,
      options.handoutStatus ?? 'open',
      owner.teacherId,
    ],
  );
  const result = await inTenant(owner.tenantId, (client) =>
    client.query(
      `SELECT * FROM activity_run_create(
       $1,$2,$3,'direct',NULL,NULL,$4,NULL,NULL,NULL,NULL,'{}'::jsonb,$5)`,
      [
        ownerPrincipal,
        handout.rows[0].id,
        lav,
        options.opensAt ?? null,
        `m1:005:run:${++sequence}`,
      ],
    ),
  );
  expect(result.rows[0].result_code).toBe('ok');
  const run = result.rows[0].activity_run_id as string;
  if (options.lifecycle && options.lifecycle !== 'active') {
    await admin.query(
      `UPDATE activity_runs SET lifecycle_status=$2,
       closed_at=CASE WHEN $2='closed' THEN now() END,
       cancelled_at=CASE WHEN $2='cancelled' THEN now() END WHERE id=$1`,
      [run, options.lifecycle],
    );
  }
  return run;
}

async function courseRun(classroom: string, status: 'open' | 'closed' = 'open') {
  const course = await admin.query(
    `INSERT INTO courses (tenant_id,owner_principal_id,title,visibility)
     VALUES ($1,$2,$3,'private') RETURNING id`,
    [owner.tenantId, ownerPrincipal, `Audience course ${++sequence}`],
  );
  const version = await admin.query(
    `INSERT INTO course_versions
       (tenant_id,course_id,version_number,title,outline,content_hash,published_by_principal_id)
     VALUES ($1,$2,1,$3,'{"sections":[]}'::jsonb,$4,$5) RETURNING id`,
    [owner.tenantId, course.rows[0].id, `Course ${sequence}`, `aud-${sequence}`, ownerPrincipal],
  );
  const run = await admin.query(
    `INSERT INTO classroom_course_runs
       (tenant_id,classroom_id,course_id,course_version_id,title,version_number,
        assigned_by_principal_id,status)
     VALUES ($1,$2,$3,$4,$5,1,$6,$7) RETURNING id`,
    [
      owner.tenantId,
      classroom,
      course.rows[0].id,
      version.rows[0].id,
      `Course ${sequence}`,
      ownerPrincipal,
      status,
    ],
  );
  return run.rows[0].id as string;
}

async function courseActivityRun(classroom: string) {
  const course = await admin.query(
    `INSERT INTO courses (tenant_id,owner_principal_id,title,visibility)
     VALUES ($1,$2,$3,'private') RETURNING id`,
    [owner.tenantId, ownerPrincipal, `Course activity ${++sequence}`],
  );
  const version = await admin.query(
    `INSERT INTO course_versions
       (tenant_id,course_id,version_number,title,outline,content_hash,published_by_principal_id)
     VALUES ($1,$2,1,$3,'{"sections":[]}'::jsonb,$4,$5) RETURNING id`,
    [owner.tenantId, course.rows[0].id, `Course ${sequence}`, `ca-${sequence}`, ownerPrincipal],
  );
  const run = await admin.query(
    `INSERT INTO classroom_course_runs
       (tenant_id,classroom_id,course_id,course_version_id,title,version_number,
        assigned_by_principal_id)
     VALUES ($1,$2,$3,$4,$5,1,$6) RETURNING id`,
    [
      owner.tenantId,
      classroom,
      course.rows[0].id,
      version.rows[0].id,
      `Course ${sequence}`,
      ownerPrincipal,
    ],
  );
  const handout = await admin.query(
    `INSERT INTO classroom_assignments
       (tenant_id,classroom_id,status,created_by,course_run_id)
     VALUES ($1,$2,'open',$3,$4) RETURNING id`,
    [owner.tenantId, classroom, owner.teacherId, run.rows[0].id],
  );
  const lesson = await admin.query(
    `INSERT INTO classroom_course_run_lessons
       (tenant_id,run_id,source_section_id,source_lesson_id,section_title,section_position,
        title,kind,lesson_position,classroom_assignment_id,assignment_title,assignment_brief,module_key)
     VALUES ($1,$2,gen_random_uuid(),gen_random_uuid(),'Section',1,'Work','assignment',1,
             $3,'Work','Work','electronics') RETURNING id`,
    [owner.tenantId, run.rows[0].id, handout.rows[0].id],
  );
  const result = await inTenant(owner.tenantId, (client) =>
    client.query(
      `SELECT * FROM activity_run_create(
       $1,$2,$3,'course',$4,$5,NULL,NULL,NULL,NULL,NULL,'{}'::jsonb,$6)`,
      [
        ownerPrincipal,
        handout.rows[0].id,
        lav,
        run.rows[0].id,
        lesson.rows[0].id,
        `m1:005:course-run:${++sequence}`,
      ],
    ),
  );
  expect(result.rows[0].result_code).toBe('ok');
  return {
    activityRun: result.rows[0].activity_run_id as string,
    courseRun: run.rows[0].id as string,
  };
}

async function createAudience(input: {
  targetKind: 'course_run' | 'activity_run';
  targetId: string;
  type: 'whole_class' | 'named_learners';
  mode: 'dynamic' | 'snapshot';
  learners?: string[];
  request?: string;
  actor?: string;
  tenant?: string;
}) {
  return inTenant(input.tenant ?? owner.tenantId, async (client) => {
    const result = await client.query(
      `SELECT * FROM learning_audience_create($1,$2,$3,$4,$5,$6::uuid[],$7)`,
      [
        input.actor ?? ownerPrincipal,
        input.targetKind,
        input.targetId,
        input.type,
        input.mode,
        input.learners ?? [],
        input.request ?? `m1:005:audience:${++sequence}`,
      ],
    );
    return result.rows[0] as Record<string, unknown>;
  });
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'learning-m1-005-owner');
  outsider = await seedTeacher(admin, 'learning-m1-005-outsider');
  const ownerRow = await admin.query(
    `SELECT account_id,principal_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [owner.tenantId, owner.teacherId],
  );
  ownerAccount = ownerRow.rows[0].account_id as string;
  ownerPrincipal = ownerRow.rows[0].principal_id as string;
  outsiderPrincipal = (
    await admin.query(
      `SELECT principal_id FROM legacy_user_account_links
        WHERE tenant_id=$1 AND user_id=$2`,
      [outsider.tenantId, outsider.teacherId],
    )
  ).rows[0].principal_id as string;
  const activity = await inTenant(owner.tenantId, (client) =>
    client.query(
      `SELECT * FROM learning_activity_create(
       $1,$2,'school','private','project','Audience activity','Work','graded',20,
       $3::jsonb,'electronics',NULL,NULL,NULL,'m1:005:activity:create')`,
      [ownerPrincipal, owner.tenantId, JSON.stringify(policies)],
    ),
  );
  const published = await inTenant(owner.tenantId, (client) =>
    client.query(`SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)`, [
      ownerPrincipal,
      owner.tenantId,
      activity.rows[0].activity_id,
      'm1:005:activity:publish',
    ]),
  );
  lav = published.rows[0].activity_version_id as string;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('LRN-M1-005 canonical audience', () => {
  it('materializes direct whole-class learners set-wise, including issued but excluding suspended, without Attempts/Results', async () => {
    const sideEffectsBefore = (
      await admin.query(
        `SELECT (SELECT count(*)::int FROM learning_attempts) AS attempts,
                (SELECT count(*)::int FROM assessment_results) AS results,
                (SELECT count(*)::int FROM gradebook_entries) AS grades`,
      )
    ).rows[0];
    const classroom = await createClassroom();
    const issued = await createSeat(classroom, 'issued');
    const active = await createSeat(classroom, 'active');
    const suspended = await createSeat(classroom, 'suspended');
    const removed = await createSeat(classroom, 'removed');
    const run = await directRun(classroom, { opensAt: '2099-01-01T00:00:00.000Z' });
    const result = await createAudience({
      targetKind: 'activity_run',
      targetId: run,
      type: 'whole_class',
      mode: 'dynamic',
    });
    expect(result.result_code).toBe('ok');
    expect(result.created_count).toBe(2);
    const rows = await admin.query(
      `SELECT participation.status,participation.assignment_source,seat.status AS seat_status
         FROM activity_participations participation
         JOIN learner_identity_links link ON link.learner_identity_id=participation.learner_identity_id
         JOIN classroom_student_seats seat ON seat.id=link.seat_id
        WHERE participation.activity_run_id=$1 ORDER BY seat.status`,
      [run],
    );
    expect(rows.rows).toEqual([
      { status: 'assigned', assignment_source: 'whole_class_dynamic', seat_status: 'active' },
      { status: 'assigned', assignment_source: 'whole_class_dynamic', seat_status: 'issued' },
    ]);
    expect(await learnerForSeat(issued)).toBeTruthy();
    expect(await learnerForSeat(active)).toBeTruthy();
    expect(await learnerForSeat(suspended)).toBeUndefined();
    expect(await learnerForSeat(removed)).toBeUndefined();
    const activeLearner = await learnerForSeat(active);
    await admin.query(`UPDATE classroom_student_seats SET status='suspended' WHERE id=$1`, [
      active,
    ]);
    expect(
      (
        await admin.query(
          `SELECT status,withdrawal_source FROM activity_participations
            WHERE activity_run_id=$1 AND learner_identity_id=$2`,
          [run, activeLearner],
        )
      ).rows[0],
    ).toEqual({ status: 'withdrawn', withdrawal_source: 'classroom_membership_ended' });
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM learning_audience_membership_claims claim
            JOIN learning_audience_definitions audience ON audience.id=claim.audience_id
           WHERE audience.target_activity_run_id=$1 AND claim.learner_identity_id=$2
             AND claim.ended_at IS NOT NULL`,
          [run, activeLearner],
        )
      ).rows[0].count,
    ).toBe(1);
    const sideEffects = await admin.query(
      `SELECT (SELECT count(*)::int FROM learning_attempts) AS attempts,
              (SELECT count(*)::int FROM assessment_results) AS results,
              (SELECT count(*)::int FROM gradebook_entries) AS grades`,
    );
    expect(sideEffects.rows[0]).toEqual(sideEffectsBefore);
  });

  it('materializes CourseEnrollment only, dynamically adds once, withdraws on leave, and rejects silent rejoin', async () => {
    const classroom = await createClassroom();
    await createSeat(classroom, 'issued');
    const run = await courseRun(classroom);
    const audience = await createAudience({
      targetKind: 'course_run',
      targetId: run,
      type: 'whole_class',
      mode: 'dynamic',
    });
    const lateSeat = await createSeat(classroom, 'issued');
    const lateLearner = await learnerForSeat(lateSeat);
    expect(lateLearner).toBeTruthy();
    await Promise.all([
      admin.query(`UPDATE classroom_student_seats SET status='active' WHERE id=$1`, [lateSeat]),
      admin.query(`UPDATE classroom_student_seats SET status='active' WHERE id=$1`, [lateSeat]),
    ]);
    await admin.query(`UPDATE classroom_student_seats SET account_id=account_id WHERE id=$1`, [
      lateSeat,
    ]);
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM course_enrollments
            WHERE course_run_id=$1 AND learner_identity_id=$2`,
          [run, lateLearner],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM audit_events
            WHERE entity_id=$1 AND action='audience.dynamic_learner_materialized'
              AND payload_json->>'learnerIdentityId'=$2`,
          [audience.audience_id, lateLearner],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM activity_participations participation
            JOIN activity_runs activity ON activity.id=participation.activity_run_id
           WHERE activity.source_course_run_id=$1`,
          [run],
        )
      ).rows[0].count,
    ).toBe(0);
    await admin.query(`UPDATE classroom_student_seats SET status='suspended' WHERE id=$1`, [
      lateSeat,
    ]);
    const withdrawn = await admin.query(
      `SELECT status,withdrawal_source FROM course_enrollments
        WHERE course_run_id=$1 AND learner_identity_id=$2`,
      [run, lateLearner],
    );
    expect(withdrawn.rows[0]).toEqual({
      status: 'withdrawn',
      withdrawal_source: 'classroom_membership_ended',
    });
    await admin.query(`UPDATE classroom_student_seats SET status='active' WHERE id=$1`, [lateSeat]);
    expect(
      (
        await admin.query(
          `SELECT status FROM course_enrollments WHERE course_run_id=$1 AND learner_identity_id=$2`,
          [run, lateLearner],
        )
      ).rows[0].status,
    ).toBe('withdrawn');
    expect(
      (
        await admin.query(
          `SELECT result_code FROM learning_audience_operations
            WHERE audience_id=$1 AND learner_identity_id=$2 AND operation_kind='rejoin_rejected'`,
          [audience.audience_id, lateLearner],
        )
      ).rows[0].result_code,
    ).toBe('rejoin_requires_explicit_policy');
  });

  it('keeps named snapshot exact and performs explicit audited add/remove without silent re-add', async () => {
    const classroom = await createClassroom();
    const first = await createIdentity();
    const second = await createIdentity();
    await createSeat(classroom, 'issued', first);
    await createSeat(classroom, 'active', second);
    const run = await directRun(classroom);
    const audience = await createAudience({
      targetKind: 'activity_run',
      targetId: run,
      type: 'named_learners',
      mode: 'snapshot',
      learners: [first],
    });
    await createSeat(classroom, 'issued');
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM activity_participations WHERE activity_run_id=$1`,
          [run],
        )
      ).rows[0].count,
    ).toBe(1);
    const course = await courseRun(classroom);
    const courseAudience = await createAudience({
      targetKind: 'course_run',
      targetId: course,
      type: 'named_learners',
      mode: 'snapshot',
      learners: [first],
    });
    expect(courseAudience.created_count).toBe(1);
    const laterUnrelatedSeat = await createSeat(classroom, 'issued');
    const laterUnrelatedLearner = await learnerForSeat(laterUnrelatedSeat);
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM course_enrollments
            WHERE course_run_id=$1 AND learner_identity_id=$2`,
          [course, laterUnrelatedLearner],
        )
      ).rows[0].count,
    ).toBe(0);
    const addKey = `named:add:${++sequence}`;
    const [add, addRetry] = await Promise.all([
      inTenant(owner.tenantId, (client) =>
        client.query(`SELECT * FROM learning_audience_named_add($1,$2,$3,$4)`, [
          ownerPrincipal,
          audience.audience_id,
          second,
          addKey,
        ]),
      ),
      inTenant(owner.tenantId, (client) =>
        client.query(`SELECT * FROM learning_audience_named_add($1,$2,$3,$4)`, [
          ownerPrincipal,
          audience.audience_id,
          second,
          addKey,
        ]),
      ),
    ]);
    expect(add.rows[0].result_code).toBe('ok');
    expect([add.rows[0].reused, addRetry.rows[0].reused].sort()).toEqual([false, true]);
    const removeKey = `named:remove:${++sequence}`;
    const remove = await inTenant(owner.tenantId, (client) =>
      client.query(`SELECT * FROM learning_audience_named_remove($1,$2,$3,$4)`, [
        ownerPrincipal,
        audience.audience_id,
        second,
        removeKey,
      ]),
    );
    expect(remove.rows[0].result_code).toBe('ok');
    const retry = await inTenant(owner.tenantId, (client) =>
      client.query(`SELECT * FROM learning_audience_named_remove($1,$2,$3,$4)`, [
        ownerPrincipal,
        audience.audience_id,
        second,
        removeKey,
      ]),
    );
    expect(retry.rows[0].reused).toBe(true);
    const readd = await inTenant(owner.tenantId, (client) =>
      client.query(`SELECT * FROM learning_audience_named_add($1,$2,$3,$4)`, [
        ownerPrincipal,
        audience.audience_id,
        second,
        `named:readd:${++sequence}`,
      ]),
    );
    expect(readd.rows[0].result_code).toBe('rejoin_requires_explicit_policy');
    const evidence = await admin.query(
      `SELECT action,count(*)::int AS count FROM audit_events
        WHERE entity_id=$1 AND action IN ('audience.named_member_added','audience.named_member_removed')
       GROUP BY action ORDER BY action`,
      [audience.audience_id],
    );
    expect(evidence.rows).toEqual([
      { action: 'audience.named_member_added', count: 1 },
      { action: 'audience.named_member_removed', count: 1 },
    ]);
  });

  it('does not steal or withdraw independent manual CourseEnrollment and ActivityParticipation', async () => {
    const classroom = await createClassroom();
    const learner = await createIdentity();
    await createSeat(classroom, 'active', learner);
    const course = await courseRun(classroom);
    await inTenant(owner.tenantId, (client) =>
      client.query(`SELECT * FROM course_enrollment_assign($1,$2,$3)`, [
        ownerPrincipal,
        course,
        learner,
      ]),
    );
    const courseAudience = await createAudience({
      targetKind: 'course_run',
      targetId: course,
      type: 'named_learners',
      mode: 'snapshot',
      learners: [learner],
    });
    const direct = await directRun(classroom);
    await inTenant(owner.tenantId, (client) =>
      client.query(`SELECT * FROM activity_participation_assign($1,$2,$3,NULL)`, [
        ownerPrincipal,
        direct,
        learner,
      ]),
    );
    const activityAudience = await createAudience({
      targetKind: 'activity_run',
      targetId: direct,
      type: 'named_learners',
      mode: 'snapshot',
      learners: [learner],
    });
    const claims = await admin.query(
      `SELECT audience_id,ownership_kind FROM learning_audience_membership_claims
        WHERE audience_id=ANY($1::uuid[]) ORDER BY audience_id`,
      [[courseAudience.audience_id, activityAudience.audience_id]],
    );
    expect(claims.rows.every((row) => row.ownership_kind === 'independent')).toBe(true);
    for (const audience of [courseAudience, activityAudience]) {
      await inTenant(owner.tenantId, (client) =>
        client.query(`SELECT * FROM learning_audience_named_remove($1,$2,$3,$4)`, [
          ownerPrincipal,
          audience.audience_id,
          learner,
          `manual:remove:${++sequence}`,
        ]),
      );
    }
    expect(
      (
        await admin.query(
          `SELECT status,assignment_source FROM course_enrollments WHERE course_run_id=$1`,
          [course],
        )
      ).rows[0],
    ).toEqual({ status: 'assigned', assignment_source: 'teacher_command' });
    expect(
      (
        await admin.query(
          `SELECT status,assignment_source FROM activity_participations WHERE activity_run_id=$1`,
          [direct],
        )
      ).rows[0],
    ).toEqual({ status: 'assigned', assignment_source: 'teacher_command' });
  });

  it('enforces target/type/mode/idempotency and rolls back invalid named creation atomically', async () => {
    const classroom = await createClassroom();
    const learner = await createIdentity();
    const secondLearner = await createIdentity();
    await createSeat(classroom, 'issued', learner);
    await createSeat(classroom, 'issued', secondLearner);
    const run = await directRun(classroom);
    expect(
      (
        await createAudience({
          targetKind: 'activity_run',
          targetId: run,
          type: 'whole_class',
          mode: 'snapshot',
        })
      ).result_code,
    ).toBe('invalid_request');
    expect(
      (
        await createAudience({
          targetKind: 'activity_run',
          targetId: run,
          type: 'named_learners',
          mode: 'dynamic',
          learners: [learner],
        })
      ).result_code,
    ).toBe('invalid_request');
    const request = `atomic:create:${++sequence}`;
    const invalid = await createAudience({
      targetKind: 'activity_run',
      targetId: run,
      type: 'named_learners',
      mode: 'snapshot',
      learners: [learner, outsider.schoolId],
      request,
    });
    expect(invalid.result_code).toBe('named_learner_ineligible');
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM learning_audience_definitions WHERE target_activity_run_id=$1`,
          [run],
        )
      ).rows[0].count,
    ).toBe(0);
    const valid = await createAudience({
      targetKind: 'activity_run',
      targetId: run,
      type: 'named_learners',
      mode: 'snapshot',
      learners: [learner],
      request,
    });
    expect(valid.result_code).toBe('ok');
    const changed = await createAudience({
      targetKind: 'activity_run',
      targetId: run,
      type: 'named_learners',
      mode: 'snapshot',
      learners: [secondLearner],
      request,
    });
    expect(changed.result_code).toBe('idempotency_conflict');
    const second = await createAudience({
      targetKind: 'activity_run',
      targetId: run,
      type: 'named_learners',
      mode: 'snapshot',
      learners: [learner],
    });
    expect(second.result_code).toBe('target_has_audience');
    await expect(
      admin.query(`UPDATE learning_audience_definitions SET mode='dynamic' WHERE id=$1`, [
        valid.audience_id,
      ]),
    ).rejects.toThrow(/immutable|check constraint/);
  });

  it('rejects closed and course-child targets, outside teachers, learners, cross-school IDs and direct runtime CRUD', async () => {
    const classroom = await createClassroom();
    const learner = await createIdentity();
    const seat = await createSeat(classroom, 'active', learner);
    const closedCourse = await courseRun(classroom, 'closed');
    expect(
      (
        await createAudience({
          targetKind: 'course_run',
          targetId: closedCourse,
          type: 'whole_class',
          mode: 'dynamic',
        })
      ).result_code,
    ).toBe('target_closed');
    const closedActivity = await directRun(classroom);
    await admin.query(
      `UPDATE activity_runs SET lifecycle_status='closed',closed_at=now() WHERE id=$1`,
      [closedActivity],
    );
    expect(
      (
        await createAudience({
          targetKind: 'activity_run',
          targetId: closedActivity,
          type: 'whole_class',
          mode: 'dynamic',
        })
      ).result_code,
    ).toBe('target_closed');
    const courseChild = await courseActivityRun(classroom);
    expect(
      (
        await createAudience({
          targetKind: 'activity_run',
          targetId: courseChild.activityRun,
          type: 'whole_class',
          mode: 'dynamic',
        })
      ).result_code,
    ).toBe('course_activity_inherits_course_audience');
    const open = await directRun(classroom);
    const otherClassroom = await createClassroom('Audience cross-class');
    const crossClassLearner = await createIdentity();
    await createSeat(otherClassroom, 'active', crossClassLearner);
    const crossSchoolLearner = (
      await admin.query(
        `INSERT INTO learner_identities (id,tenant_id,school_id)
         VALUES (gen_random_uuid(),$1,$2) RETURNING id`,
        [outsider.tenantId, outsider.schoolId],
      )
    ).rows[0].id as string;
    expect(
      (
        await createAudience({
          targetKind: 'activity_run',
          targetId: open,
          type: 'named_learners',
          mode: 'snapshot',
          learners: [crossClassLearner],
        })
      ).result_code,
    ).toBe('named_learner_ineligible');
    expect(
      (
        await createAudience({
          targetKind: 'activity_run',
          targetId: open,
          type: 'named_learners',
          mode: 'snapshot',
          learners: [crossSchoolLearner],
        })
      ).result_code,
    ).toBe('named_learner_ineligible');
    expect(
      (
        await createAudience({
          targetKind: 'activity_run',
          targetId: open,
          type: 'whole_class',
          mode: 'dynamic',
          tenant: outsider.tenantId,
        })
      ).result_code,
    ).toBe('forbidden');
    expect(
      (
        await createAudience({
          targetKind: 'activity_run',
          targetId: open,
          type: 'whole_class',
          mode: 'dynamic',
          actor: outsiderPrincipal,
        })
      ).result_code,
    ).toBe('forbidden');
    const seatPrincipal = (
      await admin.query(
        `INSERT INTO principals(kind,seat_id) VALUES('student_seat',$1) RETURNING id`,
        [seat],
      )
    ).rows[0].id;
    expect(
      (
        await createAudience({
          targetKind: 'activity_run',
          targetId: open,
          type: 'whole_class',
          mode: 'dynamic',
          actor: seatPrincipal,
        })
      ).result_code,
    ).toBe('forbidden');
    await expect(
      inTenant(owner.tenantId, (client) =>
        client.query(
          `INSERT INTO learning_audience_definitions
          (tenant_id,school_id,classroom_id,target_kind,target_activity_run_id,
           audience_type,mode,created_by_principal_id,creation_request_id,creation_request_digest)
         VALUES($1,$2,$3,'activity_run',$4,'whole_class','dynamic',$5,'spoof:request',repeat('a',64))`,
          [owner.tenantId, owner.schoolId, classroom, open, ownerPrincipal],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      inTenant(owner.tenantId, (client) =>
        client.query(`SELECT learning_audience_ensure_seat_identity($1)`, [seat]),
      ),
    ).rejects.toThrow(/permission denied/);
    const protectedDiagnostic = await inTenant(owner.tenantId, (client) =>
      client.query(`SELECT * FROM learning_audience_diagnostic($1,$2)`, [
        outsiderPrincipal,
        '00000000-0000-0000-0000-000000000000',
      ]),
    );
    expect(protectedDiagnostic.rows[0].result_code).toBe('forbidden');
    const absentScopes = await admin.query(
      `SELECT to_regclass('public.classroom_groups') AS groups,
              to_regclass('public.learning_group_audiences') AS group_audiences`,
    );
    expect(absentScopes.rows[0]).toEqual({ groups: null, group_audiences: null });
  });

  it('serializes concurrent create and keeps duplicate logical seats as one learner membership', async () => {
    const classroom = await createClassroom();
    const learner = await createIdentity();
    await createSeat(classroom, 'issued', learner);
    await createSeat(classroom, 'active', learner);
    const run = await courseRun(classroom);
    const request = `concurrent:create:${++sequence}`;
    const [first, second] = await Promise.all([
      createAudience({
        targetKind: 'course_run',
        targetId: run,
        type: 'whole_class',
        mode: 'dynamic',
        request,
      }),
      createAudience({
        targetKind: 'course_run',
        targetId: run,
        type: 'whole_class',
        mode: 'dynamic',
        request,
      }),
    ]);
    expect(first.audience_id).toBe(second.audience_id);
    expect([first.reused, second.reused].sort()).toEqual([false, true]);
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM course_enrollments WHERE course_run_id=$1`,
          [run],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it('uses set-based materialization for 30 learners and one learner across 100 dynamic targets', async () => {
    const classroom30 = await createClassroom('Audience performance 30');
    for (let index = 0; index < 30; index += 1) await createSeat(classroom30, 'issued');
    const run30 = await directRun(classroom30);
    const started30 = performance.now();
    const audience30 = await createAudience({
      targetKind: 'activity_run',
      targetId: run30,
      type: 'whole_class',
      mode: 'dynamic',
    });
    const elapsed30 = performance.now() - started30;
    expect(audience30.created_count).toBe(30);

    const classroom100 = await createClassroom('Audience performance 100');
    const runs: string[] = [];
    for (let index = 0; index < 100; index += 1) runs.push(await directRun(classroom100));
    for (const run of runs) {
      const result = await createAudience({
        targetKind: 'activity_run',
        targetId: run,
        type: 'whole_class',
        mode: 'dynamic',
      });
      expect(result.created_count).toBe(0);
    }
    const started100 = performance.now();
    const lateSeat = await createSeat(classroom100, 'issued');
    const elapsed100 = performance.now() - started100;
    const lateLearner = await learnerForSeat(lateSeat);
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM activity_participations
            WHERE learner_identity_id=$1 AND activity_run_id=ANY($2::uuid[])`,
          [lateLearner, runs],
        )
      ).rows[0].count,
    ).toBe(100);
    expect(elapsed30).toBeLessThan(5_000);
    expect(elapsed100).toBeLessThan(5_000);
    console.info(
      `LRN-M1-005 performance: 30 learners=${elapsed30.toFixed(1)}ms; 1 learner x 100 targets=${elapsed100.toFixed(1)}ms; client queries=1 per measured operation`,
    );
  }, 30_000);
});
