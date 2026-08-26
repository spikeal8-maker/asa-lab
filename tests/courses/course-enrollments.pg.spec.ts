import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

type EnrollmentResult = {
  result_code: string;
  enrollment_id: string | null;
  enrollment_status: 'assigned' | 'active' | 'withdrawn' | null;
  assigned_at: Date | null;
  activated_at: Date | null;
  withdrawn_at: Date | null;
  reused: boolean;
};

type LearnerFixture = {
  identityId: string;
  seatId: string;
  seatPrincipalId: string;
  accountId: string | null;
  accountPrincipalId: string | null;
};

let admin: pg.Pool;
let app: pg.Pool;
let owner: SeededTeacher;
let outsider: SeededTeacher;
let ownerAccountId: string;
let ownerPrincipalId: string;
let outsiderPrincipalId: string;
let classroomId: string;
let courseId: string;
let courseVersionId: string;
let runId: string;
let run2Id: string;
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

async function assign(
  courseRunId: string,
  learnerIdentityId: string,
  actorPrincipalId = ownerPrincipalId,
) {
  return inTenant(owner.tenantId, async (client) => {
    const result = await client.query(`SELECT * FROM course_enrollment_assign($1,$2,$3)`, [
      actorPrincipalId,
      courseRunId,
      learnerIdentityId,
    ]);
    return result.rows[0] as EnrollmentResult;
  });
}

async function activate(enrollmentId: string, actorPrincipalId: string) {
  return inTenant(owner.tenantId, async (client) => {
    const result = await client.query(`SELECT * FROM course_enrollment_activate($1,$2)`, [
      actorPrincipalId,
      enrollmentId,
    ]);
    return result.rows[0] as EnrollmentResult;
  });
}

async function withdraw(enrollmentId: string, actorPrincipalId = ownerPrincipalId) {
  return inTenant(owner.tenantId, async (client) => {
    const result = await client.query(`SELECT * FROM course_enrollment_withdraw($1,$2)`, [
      actorPrincipalId,
      enrollmentId,
    ]);
    return result.rows[0] as EnrollmentResult;
  });
}

async function createClassroom(input: {
  schoolId?: string;
  periodId?: string;
  addOwner?: boolean;
  title?: string;
}) {
  const classroom = await admin.query(
    `INSERT INTO classrooms (tenant_id,school_id,academic_period_id,title,created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [
      owner.tenantId,
      input.schoolId ?? owner.schoolId,
      input.periodId ?? owner.periodId,
      input.title ?? `Enrollment classroom ${++sequence}`,
      owner.teacherId,
    ],
  );
  if (input.addOwner !== false) {
    await admin.query(
      `INSERT INTO classroom_memberships
         (tenant_id,classroom_id,user_id,account_id,member_role)
       VALUES ($1,$2,$3,$4,'owner')`,
      [owner.tenantId, classroom.rows[0].id, owner.teacherId, ownerAccountId],
    );
  }
  return classroom.rows[0].id as string;
}

async function createRun(targetClassroomId: string, suffix: string) {
  const course = await admin.query(
    `INSERT INTO courses (tenant_id,owner_principal_id,title,visibility)
     VALUES ($1,$2,$3,'private') RETURNING id`,
    [owner.tenantId, ownerPrincipalId, `Enrollment ${suffix}`],
  );
  const version = await admin.query(
    `INSERT INTO course_versions
       (tenant_id,course_id,version_number,title,outline,content_hash,published_by_principal_id)
     VALUES ($1,$2,1,$3,'{"sections":[]}'::jsonb,$4,$5) RETURNING id`,
    [owner.tenantId, course.rows[0].id, `Enrollment ${suffix}`, `${suffix}-hash`, ownerPrincipalId],
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
      `Enrollment ${suffix}`,
      ownerPrincipalId,
    ],
  );
  await admin.query(
    `INSERT INTO classroom_course_run_lessons
       (tenant_id,run_id,source_section_id,source_lesson_id,section_title,
        section_position,title,kind,lesson_position)
     VALUES ($1,$2,gen_random_uuid(),gen_random_uuid(),'Section',1,'Lesson','material',1)`,
    [owner.tenantId, run.rows[0].id],
  );
  return {
    courseId: course.rows[0].id as string,
    courseVersionId: version.rows[0].id as string,
    runId: run.rows[0].id as string,
  };
}

async function createLearner(
  input: {
    classroomId?: string;
    schoolId?: string;
    accountId?: string;
    identityId?: string;
  } = {},
): Promise<LearnerFixture> {
  sequence += 1;
  const targetClassroom = input.classroomId ?? classroomId;
  const targetSchool = input.schoolId ?? owner.schoolId;
  let accountId = input.accountId ?? null;
  let accountPrincipalId: string | null = null;
  if (!accountId && Object.prototype.hasOwnProperty.call(input, 'accountId')) {
    accountId = null;
  } else if (!accountId) {
    const account = await admin.query(
      `INSERT INTO accounts (email,password_hash,birth_date,country)
       VALUES ('learner-m1-002-' || gen_random_uuid()::text || '@test.local',
               'isolated-test-only',DATE '2000-01-01','RU') RETURNING id`,
    );
    accountId = account.rows[0].id as string;
  }
  if (accountId) {
    const principal = await admin.query(
      `INSERT INTO principals (kind,account_id) VALUES ('account',$1)
       ON CONFLICT (account_id) WHERE account_id IS NOT NULL
       DO UPDATE SET account_id=EXCLUDED.account_id RETURNING id`,
      [accountId],
    );
    accountPrincipalId = principal.rows[0].id as string;
  }
  const handle = `m1-002-${sequence}`;
  const seat = await admin.query(
    `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
        safe_mode,status,created_by,account_id)
     VALUES ($1,$2,$3,$4,$4,true,'active',$5,$6) RETURNING id`,
    [owner.tenantId, targetClassroom, `Learner ${sequence}`, handle, owner.teacherId, accountId],
  );
  const seatPrincipal = await admin.query(
    `INSERT INTO principals (kind,seat_id) VALUES ('student_seat',$1) RETURNING id`,
    [seat.rows[0].id],
  );
  const identityId =
    input.identityId ??
    (
      await admin.query(
        `INSERT INTO learner_identities (id,tenant_id,school_id)
         VALUES (gen_random_uuid(),$1,$2) RETURNING id`,
        [owner.tenantId, targetSchool],
      )
    ).rows[0].id;
  await admin.query(
    `INSERT INTO learner_identity_links
       (id,tenant_id,school_id,learner_identity_id,link_kind,seat_id)
     VALUES (gen_random_uuid(),$1,$2,$3,'student_seat',$4)`,
    [owner.tenantId, targetSchool, identityId, seat.rows[0].id],
  );
  if (accountId) {
    await admin.query(
      `INSERT INTO learner_identity_links
         (id,tenant_id,school_id,learner_identity_id,link_kind,account_id)
       VALUES (gen_random_uuid(),$1,$2,$3,'account',$4)
       ON CONFLICT (school_id,account_id) WHERE account_id IS NOT NULL DO NOTHING`,
      [owner.tenantId, targetSchool, identityId, accountId],
    );
  }
  return {
    identityId,
    seatId: seat.rows[0].id as string,
    seatPrincipalId: seatPrincipal.rows[0].id as string,
    accountId,
    accountPrincipalId,
  };
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'learning-m1-002-owner');
  outsider = await seedTeacher(admin, 'learning-m1-002-outsider');
  const ownerIdentity = await admin.query(
    `SELECT account_id,principal_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [owner.tenantId, owner.teacherId],
  );
  ownerAccountId = ownerIdentity.rows[0].account_id as string;
  ownerPrincipalId = ownerIdentity.rows[0].principal_id as string;
  const outsiderIdentity = await admin.query(
    `SELECT principal_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [outsider.tenantId, outsider.teacherId],
  );
  outsiderPrincipalId = outsiderIdentity.rows[0].principal_id as string;
  classroomId = await createClassroom({ title: 'M1-002 CourseEnrollment' });
  const first = await createRun(classroomId, 'primary-run');
  courseId = first.courseId;
  courseVersionId = first.courseVersionId;
  runId = first.runId;
  run2Id = (await createRun(classroomId, 'second-run')).runId;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('LRN-M1-002 CourseEnrollment', () => {
  it('creates only an assigned stable-learner membership with exact lineage', async () => {
    const learner = await createLearner();
    const result = await assign(runId, learner.identityId);
    expect(result).toMatchObject({
      result_code: 'ok',
      enrollment_status: 'assigned',
      activated_at: null,
      withdrawn_at: null,
      reused: false,
    });
    const stored = await admin.query(`SELECT * FROM course_enrollments WHERE id=$1`, [
      result.enrollment_id,
    ]);
    expect(stored.rows[0]).toMatchObject({
      tenant_id: owner.tenantId,
      school_id: owner.schoolId,
      course_run_id: runId,
      learner_identity_id: learner.identityId,
      status: 'assigned',
      assignment_source: 'teacher_command',
    });
  });

  it('makes retry and concurrent identical assignment one logical row', async () => {
    const learner = await createLearner();
    const first = await assign(runId, learner.identityId);
    const retry = await assign(runId, learner.identityId);
    expect(retry).toMatchObject({ enrollment_id: first.enrollment_id, reused: true });
    const concurrentLearner = await createLearner();
    const [left, right] = await Promise.all([
      assign(runId, concurrentLearner.identityId),
      assign(runId, concurrentLearner.identityId),
    ]);
    expect(left.enrollment_id).toBe(right.enrollment_id);
    expect([left.reused, right.reused].sort()).toEqual([false, true]);
    const count = await admin.query(
      `SELECT count(*)::integer AS count FROM course_enrollments
        WHERE course_run_id=$1 AND learner_identity_id=$2`,
      [runId, concurrentLearner.identityId],
    );
    expect(count.rows[0].count).toBe(1);
  });

  it('activates only through the matching learner principal and repeats idempotently', async () => {
    const learner = await createLearner();
    const other = await createLearner();
    const enrollment = await assign(runId, learner.identityId);
    const forbidden = await activate(enrollment.enrollment_id!, other.accountPrincipalId!);
    expect(forbidden.result_code).toBe('forbidden');
    const first = await activate(enrollment.enrollment_id!, learner.accountPrincipalId!);
    expect(first).toMatchObject({ result_code: 'ok', enrollment_status: 'active', reused: false });
    expect(first.activated_at).not.toBeNull();
    const retry = await activate(enrollment.enrollment_id!, learner.seatPrincipalId);
    expect(retry).toMatchObject({
      result_code: 'ok',
      enrollment_status: 'active',
      activated_at: first.activated_at,
      reused: true,
    });
  });

  it('withdraws assigned and active enrollments without deleting history', async () => {
    const assignedLearner = await createLearner();
    const assigned = await assign(runId, assignedLearner.identityId);
    const assignedWithdrawal = await withdraw(assigned.enrollment_id!);
    expect(assignedWithdrawal).toMatchObject({
      enrollment_status: 'withdrawn',
      activated_at: null,
      reused: false,
    });

    const activeLearner = await createLearner();
    const active = await assign(runId, activeLearner.identityId);
    const activated = await activate(active.enrollment_id!, activeLearner.accountPrincipalId!);
    const activeWithdrawal = await withdraw(active.enrollment_id!);
    expect(activeWithdrawal).toMatchObject({ enrollment_status: 'withdrawn', reused: false });
    expect(activeWithdrawal.activated_at).toEqual(activated.activated_at);
    expect(activeWithdrawal.withdrawn_at).not.toBeNull();
    const retry = await withdraw(active.enrollment_id!);
    expect(retry).toMatchObject({
      enrollment_id: active.enrollment_id,
      withdrawn_at: activeWithdrawal.withdrawn_at,
      reused: true,
    });
    const preserved = await admin.query(
      `SELECT count(*)::integer AS count FROM course_enrollments WHERE id=$1`,
      [active.enrollment_id],
    );
    expect(preserved.rows[0].count).toBe(1);
  });

  it('rejects withdrawn reactivation and hard delete', async () => {
    const learner = await createLearner();
    const enrollment = await assign(runId, learner.identityId);
    await withdraw(enrollment.enrollment_id!);
    const activation = await activate(enrollment.enrollment_id!, learner.accountPrincipalId!);
    expect(activation).toMatchObject({ result_code: 'withdrawn', reused: true });
    await expect(
      admin.query(`DELETE FROM course_enrollments WHERE id=$1`, [enrollment.enrollment_id]),
    ).rejects.toThrow(/append-preserved/);
  });

  it('keeps separate enrollments for different CourseRuns', async () => {
    const learner = await createLearner();
    const [first, second] = await Promise.all([
      assign(runId, learner.identityId),
      assign(run2Id, learner.identityId),
    ]);
    expect(first.enrollment_id).not.toBe(second.enrollment_id);
  });

  it('converges two same-school seats for one Account onto one enrollment owner', async () => {
    const first = await createLearner();
    const secondClassroom = await createClassroom({ title: 'Same school second class' });
    const second = await createLearner({
      classroomId: secondClassroom,
      schoolId: owner.schoolId,
      accountId: first.accountId!,
      identityId: first.identityId,
    });
    expect(second.identityId).toBe(first.identityId);
    const [left, right] = await Promise.all([
      assign(runId, first.identityId),
      assign(runId, second.identityId),
    ]);
    expect(left.enrollment_id).toBe(right.enrollment_id);
    const links = await admin.query(
      `SELECT count(*)::integer AS count FROM learner_identity_links
        WHERE learner_identity_id=$1 AND link_kind='student_seat'`,
      [first.identityId],
    );
    expect(links.rows[0].count).toBe(2);
  });

  it('separates one Account by school and physically rejects cross-school enrollment', async () => {
    const schoolB = await admin.query(
      `INSERT INTO schools (tenant_id,title) VALUES ($1,'School B') RETURNING id`,
      [owner.tenantId],
    );
    const periodB = await admin.query(
      `INSERT INTO academic_periods
         (tenant_id,school_id,title,starts_on,ends_on,is_active)
       VALUES ($1,$2,'Period B',DATE '2026-09-01',DATE '2027-06-30',true) RETURNING id`,
      [owner.tenantId, schoolB.rows[0].id],
    );
    const classB = await createClassroom({
      schoolId: schoolB.rows[0].id,
      periodId: periodB.rows[0].id,
      title: 'School B class',
    });
    const account = await admin.query(
      `INSERT INTO accounts (email,password_hash,birth_date,country)
       VALUES ('multi-school-' || gen_random_uuid()::text || '@test.local',
               'isolated-test-only',DATE '2000-01-01','RU') RETURNING id`,
    );
    const learnerA = await createLearner({ accountId: account.rows[0].id });
    const learnerB = await createLearner({
      classroomId: classB,
      schoolId: schoolB.rows[0].id,
      accountId: account.rows[0].id,
    });
    expect(learnerA.identityId).not.toBe(learnerB.identityId);
    const command = await assign(runId, learnerB.identityId);
    expect(command.result_code).toBe('learner_not_found');
    await expect(
      admin.query(
        `INSERT INTO course_enrollments
           (tenant_id,school_id,course_run_id,learner_identity_id,assigned_by_principal_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [owner.tenantId, schoolB.rows[0].id, runId, learnerB.identityId, ownerPrincipalId],
      ),
    ).rejects.toThrow(/run school lineage is incoherent/);
    const runB = (await createRun(classB, 'school-b-run')).runId;
    const validB = await assign(runB, learnerB.identityId);
    expect(validB.result_code).toBe('ok');
  });

  it('denies outside teachers and learner assignment/withdraw authority', async () => {
    const learner = await createLearner();
    const outside = await assign(runId, learner.identityId, outsiderPrincipalId);
    expect(outside.result_code).toBe('forbidden');
    const selfAssign = await assign(runId, learner.identityId, learner.accountPrincipalId!);
    expect(selfAssign.result_code).toBe('forbidden');
    const enrollment = await assign(runId, learner.identityId);
    const selfWithdraw = await withdraw(enrollment.enrollment_id!, learner.accountPrincipalId!);
    expect(selfWithdraw.result_code).toBe('forbidden');
  });

  it('denies activation after the learner seat is suspended', async () => {
    const learner = await createLearner();
    const enrollment = await assign(runId, learner.identityId);
    await admin.query(`UPDATE classroom_student_seats SET status='suspended' WHERE id=$1`, [
      learner.seatId,
    ]);
    const activation = await activate(enrollment.enrollment_id!, learner.accountPrincipalId!);
    expect(activation.result_code).toBe('forbidden');
  });

  it('gives the runtime role no direct read, insert, update or delete authority', async () => {
    await expect(app.query(`SELECT * FROM course_enrollments LIMIT 1`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      app.query(
        `INSERT INTO course_enrollments
           (tenant_id,school_id,course_run_id,learner_identity_id,assigned_by_principal_id)
         VALUES ($1,$2,$3,gen_random_uuid(),$4)`,
        [owner.tenantId, owner.schoolId, runId, ownerPrincipalId],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(app.query(`UPDATE course_enrollments SET status='active'`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.query(`DELETE FROM course_enrollments`)).rejects.toThrow(/permission denied/);
  });

  it('stores no completion, grade, progress or ActivityParticipation fields', async () => {
    const columns = await admin.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='course_enrollments'`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).not.toEqual(
      expect.arrayContaining([
        'completed',
        'completed_at',
        'progress_percent',
        'final_grade',
        'extra_attempts',
        'time_limit_override_seconds',
        'excused',
      ]),
    );
    const statusConstraint = await admin.query(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conname='course_enrollments_status_check'`,
    );
    expect(statusConstraint.rows[0].definition).toContain("'assigned'");
    expect(statusConstraint.rows[0].definition).toContain("'active'");
    expect(statusConstraint.rows[0].definition).toContain("'withdrawn'");
    expect(statusConstraint.rows[0].definition).not.toMatch(/completed|passed|failed|excused/);
  });

  it('creates no ActivityRun row or ActivityParticipation runtime', async () => {
    const learner = await createLearner();
    const enrollment = await assign(runId, learner.identityId);
    const activityRunsForEnrollmentRun = await admin.query(
      `SELECT count(*)::int AS count
         FROM activity_runs
        WHERE source_course_run_id=$1`,
      [runId],
    );
    const participation = await admin.query(
      `SELECT count(*)::int AS count FROM activity_participations
        WHERE source_course_enrollment_id=$1`,
      [enrollment.enrollment_id],
    );
    expect(activityRunsForEnrollmentRun.rows).toEqual([{ count: 0 }]);
    expect(participation.rows).toEqual([{ count: 0 }]);
  });

  it('leaves the existing CourseRun and learner reader contract unchanged', async () => {
    const learner = await createLearner();
    const before = await admin.query(
      `SELECT run_id,course_id,course_version_id,run_status
         FROM classroom_course_runs_for_seat_v2($1) WHERE run_id=$2`,
      [learner.seatId, runId],
    );
    const enrollment = await assign(runId, learner.identityId);
    const after = await admin.query(
      `SELECT run_id,course_id,course_version_id,run_status
         FROM classroom_course_runs_for_seat_v2($1) WHERE run_id=$2`,
      [learner.seatId, runId],
    );
    expect(after.rows).toEqual(before.rows);
    expect(after.rows[0]).toEqual({
      run_id: runId,
      course_id: courseId,
      course_version_id: courseVersionId,
      run_status: 'open',
    });
    expect(enrollment.enrollment_status).toBe('assigned');
  });

  it('emits one append-only audit record per real lifecycle transition', async () => {
    const ambiguousLegacyUser = await admin.query(
      `INSERT INTO users (tenant_id,school_id,role,email,display_name,password_hash)
       VALUES ($1,$2,'teacher','ambiguous-' || gen_random_uuid()::text || '@test.local',
               'Ambiguous legacy link','isolated-test-only') RETURNING id`,
      [owner.tenantId, owner.schoolId],
    );
    await admin.query(
      `INSERT INTO legacy_user_account_links
         (tenant_id,user_id,account_id,principal_id,migration_state)
       VALUES ($1,$2,$3,$4,'active')`,
      [owner.tenantId, ambiguousLegacyUser.rows[0].id, ownerAccountId, ownerPrincipalId],
    );
    const learner = await createLearner();
    const enrollment = await assign(runId, learner.identityId);
    await assign(runId, learner.identityId);
    await activate(enrollment.enrollment_id!, learner.accountPrincipalId!);
    await activate(enrollment.enrollment_id!, learner.accountPrincipalId!);
    await withdraw(enrollment.enrollment_id!);
    await withdraw(enrollment.enrollment_id!);
    const events = await admin.query(
      `SELECT action,actor_user_id,payload_json FROM audit_events
        WHERE entity_type='course_enrollment' AND entity_id=$1 ORDER BY id`,
      [enrollment.enrollment_id],
    );
    expect(events.rows.map((row) => row.action)).toEqual([
      'course_enrollment.assigned',
      'course_enrollment.activated',
      'course_enrollment.withdrawn',
    ]);
    expect(events.rows.map((row) => row.actor_user_id)).toEqual([
      owner.teacherId,
      null,
      owner.teacherId,
    ]);
    expect(events.rows[0].payload_json).toMatchObject({
      actorPrincipalId: ownerPrincipalId,
      source: 'teacher_command',
      courseRunId: runId,
      learnerIdentityId: learner.identityId,
    });
    await expect(
      admin.query(`UPDATE audit_events SET action='tampered' WHERE entity_id=$1`, [
        enrollment.enrollment_id,
      ]),
    ).rejects.toThrow(/append-only/);
  });
});
