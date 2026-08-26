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
let ownerPrincipal: string;
let ownerAccount: string;
let outsiderPrincipal: string;
let classroom: string;
let otherClassroom: string;
let learner: string;
let secondLearner: string;
let learnerPrincipal: string;
let foreignLearner: string;
let lav: string;
let sequence = 0;

async function inTenant<T>(tenant: string, callback: (client: pg.PoolClient) => Promise<T>) {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenant]);
    const value = await callback(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function directHandout(targetClassroom = classroom) {
  const authored = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES ($1,$2,$3,'Build','electronics','private') RETURNING id`,
    [owner.tenantId, ownerPrincipal, `Participation direct ${++sequence}`],
  );
  const handout = await admin.query(
    `INSERT INTO classroom_assignments
       (tenant_id,classroom_id,assignment_id,status,created_by)
     VALUES ($1,$2,$3,'open',$4) RETURNING id`,
    [owner.tenantId, targetClassroom, authored.rows[0].id, owner.teacherId],
  );
  return handout.rows[0].id as string;
}

async function courseHandout(targetClassroom = classroom) {
  const course = await admin.query(
    `INSERT INTO courses (tenant_id,owner_principal_id,title,visibility)
     VALUES ($1,$2,$3,'private') RETURNING id`,
    [owner.tenantId, ownerPrincipal, `Participation course ${++sequence}`],
  );
  const version = await admin.query(
    `INSERT INTO course_versions
       (tenant_id,course_id,version_number,title,outline,content_hash,published_by_principal_id)
     VALUES ($1,$2,1,$3,'{"sections":[]}'::jsonb,$4,$5) RETURNING id`,
    [owner.tenantId, course.rows[0].id, `Course ${sequence}`, `part-${sequence}`, ownerPrincipal],
  );
  const run = await admin.query(
    `INSERT INTO classroom_course_runs
       (tenant_id,classroom_id,course_id,course_version_id,title,version_number,
        assigned_by_principal_id)
     VALUES ($1,$2,$3,$4,$5,1,$6) RETURNING id`,
    [
      owner.tenantId,
      targetClassroom,
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
    [owner.tenantId, targetClassroom, owner.teacherId, run.rows[0].id],
  );
  const lesson = await admin.query(
    `INSERT INTO classroom_course_run_lessons
       (tenant_id,run_id,source_section_id,source_lesson_id,section_title,section_position,
        title,kind,lesson_position,classroom_assignment_id,assignment_title,assignment_brief,module_key)
     VALUES ($1,$2,gen_random_uuid(),gen_random_uuid(),'Section',1,$3,'assignment',1,
             $4,$3,'Work','electronics') RETURNING id`,
    [owner.tenantId, run.rows[0].id, `Lesson ${sequence}`, handout.rows[0].id],
  );
  return {
    handout: handout.rows[0].id as string,
    courseRun: run.rows[0].id as string,
    lesson: lesson.rows[0].id as string,
  };
}

async function createRun(input: {
  handout: string;
  kind?: 'direct' | 'course';
  courseRun?: string | null;
  lesson?: string | null;
  opens?: string | null;
  due?: string | null;
  closes?: string | null;
  late?: string | null;
}) {
  return inTenant(owner.tenantId, async (client) => {
    const result = await client.query(
      `SELECT * FROM activity_run_create(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,'{}'::jsonb,$11)`,
      [
        ownerPrincipal,
        input.handout,
        lav,
        input.kind ?? 'direct',
        input.courseRun ?? null,
        input.lesson ?? null,
        input.opens ?? null,
        input.due ?? null,
        input.closes ?? null,
        input.late ?? null,
        `m1:004:run:${++sequence}`,
      ],
    );
    expect(result.rows[0].result_code).toBe('ok');
    return result.rows[0].activity_run_id as string;
  });
}

async function assign(
  run: string,
  learnerId = learner,
  enrollment: string | null = null,
  actor = ownerPrincipal,
  tenant = owner.tenantId,
) {
  return inTenant(tenant, async (client) => {
    const result = await client.query(`SELECT * FROM activity_participation_assign($1,$2,$3,$4)`, [
      actor,
      run,
      learnerId,
      enrollment,
    ]);
    return result.rows[0] as Record<string, unknown>;
  });
}

async function command(name: string, parameters: unknown[]) {
  return inTenant(owner.tenantId, async (client) => {
    const placeholders = parameters.map((_, index) => `$${index + 1}`).join(',');
    const result = await client.query(`SELECT * FROM ${name}(${placeholders})`, parameters);
    return result.rows[0] as Record<string, unknown>;
  });
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'learning-m1-004-owner');
  outsider = await seedTeacher(admin, 'learning-m1-004-outsider');
  const ownerIdentity = await admin.query(
    `SELECT principal_id,account_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [owner.tenantId, owner.teacherId],
  );
  ownerPrincipal = ownerIdentity.rows[0].principal_id as string;
  ownerAccount = ownerIdentity.rows[0].account_id as string;
  outsiderPrincipal = (
    await admin.query(
      `SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2`,
      [outsider.tenantId, outsider.teacherId],
    )
  ).rows[0].principal_id as string;
  classroom = (
    await admin.query(
      `INSERT INTO classrooms (tenant_id,school_id,academic_period_id,title,created_by)
       VALUES ($1,$2,$3,'M1-004 participation',$4) RETURNING id`,
      [owner.tenantId, owner.schoolId, owner.periodId, owner.teacherId],
    )
  ).rows[0].id as string;
  otherClassroom = (
    await admin.query(
      `INSERT INTO classrooms (tenant_id,school_id,academic_period_id,title,created_by)
       VALUES ($1,$2,$3,'M1-004 other class',$4) RETURNING id`,
      [owner.tenantId, owner.schoolId, owner.periodId, owner.teacherId],
    )
  ).rows[0].id as string;
  await admin.query(
    `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES ($1,$2,$3,$4,'owner'),($1,$5,$3,$4,'owner')`,
    [owner.tenantId, classroom, owner.teacherId, ownerAccount, otherClassroom],
  );
  const seat = (
    await admin.query(
      `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
        safe_mode,status,created_by)
       VALUES ($1,$2,'Learner','m1-004-learner','m1-004-learner',true,'active',$3)
       RETURNING id`,
      [owner.tenantId, classroom, owner.teacherId],
    )
  ).rows[0].id as string;
  learnerPrincipal = (
    await admin.query(
      `INSERT INTO principals (kind,seat_id) VALUES ('student_seat',$1) RETURNING id`,
      [seat],
    )
  ).rows[0].id as string;
  learner = (
    await admin.query(
      `INSERT INTO learner_identities (id,tenant_id,school_id)
       VALUES (gen_random_uuid(),$1,$2) RETURNING id`,
      [owner.tenantId, owner.schoolId],
    )
  ).rows[0].id as string;
  await admin.query(
    `INSERT INTO learner_identity_links
       (id,tenant_id,school_id,learner_identity_id,link_kind,seat_id)
     VALUES (gen_random_uuid(),$1,$2,$3,'student_seat',$4)`,
    [owner.tenantId, owner.schoolId, learner, seat],
  );
  const secondSeat = (
    await admin.query(
      `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
        safe_mode,status,created_by)
       VALUES ($1,$2,'Second learner','m1-004-learner-2','m1-004-learner-2',true,'active',$3)
       RETURNING id`,
      [owner.tenantId, classroom, owner.teacherId],
    )
  ).rows[0].id as string;
  secondLearner = (
    await admin.query(
      `INSERT INTO learner_identities (id,tenant_id,school_id)
       VALUES (gen_random_uuid(),$1,$2) RETURNING id`,
      [owner.tenantId, owner.schoolId],
    )
  ).rows[0].id as string;
  await admin.query(
    `INSERT INTO learner_identity_links
       (id,tenant_id,school_id,learner_identity_id,link_kind,seat_id)
     VALUES (gen_random_uuid(),$1,$2,$3,'student_seat',$4)`,
    [owner.tenantId, owner.schoolId, secondLearner, secondSeat],
  );
  foreignLearner = (
    await admin.query(
      `INSERT INTO learner_identities (id,tenant_id,school_id)
       VALUES (gen_random_uuid(),$1,$2) RETURNING id`,
      [outsider.tenantId, outsider.schoolId],
    )
  ).rows[0].id as string;

  const activity = await inTenant(owner.tenantId, (client) =>
    client.query(
      `SELECT * FROM learning_activity_create(
       $1,$2,'school','private','project','Participation activity','Work','graded',20,
       $3::jsonb,'electronics',NULL,NULL,NULL,'m1:004:activity:create')`,
      [ownerPrincipal, owner.tenantId, JSON.stringify(policies)],
    ),
  );
  const published = await inTenant(owner.tenantId, (client) =>
    client.query(`SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)`, [
      ownerPrincipal,
      owner.tenantId,
      activity.rows[0].activity_id,
      'm1:004:activity:publish',
    ]),
  );
  lav = published.rows[0].activity_version_id as string;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('LRN-M1-004 ActivityParticipation', () => {
  it('creates direct participation, retries/concurrent assigns as one row, and keeps two runs independent', async () => {
    const run = await createRun({ handout: await directHandout() });
    const [a, b] = await Promise.all([assign(run), assign(run)]);
    expect(a.participation_id).toBe(b.participation_id);
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    expect((await assign(run)).participation_id).toBe(a.participation_id);
    const run2 = await createRun({ handout: await directHandout() });
    const c = await assign(run2);
    expect(c.participation_id).not.toBe(a.participation_id);
    const rows = await admin.query(
      `SELECT count(*)::int AS count FROM activity_participations
        WHERE learner_identity_id=$1 AND activity_run_id=ANY($2::uuid[])`,
      [learner, [run, run2]],
    );
    expect(rows.rows[0].count).toBe(2);
  });

  it('uses only exact optional CourseEnrollment and never invents one for direct delivery', async () => {
    const source = await courseHandout();
    const run = await createRun({
      handout: source.handout,
      kind: 'course',
      courseRun: source.courseRun,
      lesson: source.lesson,
    });
    const enrollment = await inTenant(owner.tenantId, (client) =>
      client.query(`SELECT * FROM course_enrollment_assign($1,$2,$3)`, [
        ownerPrincipal,
        source.courseRun,
        learner,
      ]),
    );
    const result = await assign(run, learner, enrollment.rows[0].enrollment_id);
    expect(result.result_code).toBe('ok');
    expect(
      (
        await admin.query(
          `SELECT source_course_enrollment_id FROM activity_participations WHERE id=$1`,
          [result.participation_id],
        )
      ).rows[0].source_course_enrollment_id,
    ).toBe(enrollment.rows[0].enrollment_id);

    const otherSource = await courseHandout();
    const wrongEnrollment = await inTenant(owner.tenantId, (client) =>
      client.query(`SELECT * FROM course_enrollment_assign($1,$2,$3)`, [
        ownerPrincipal,
        otherSource.courseRun,
        learner,
      ]),
    );
    expect((await assign(run, learner, wrongEnrollment.rows[0].enrollment_id)).result_code).toBe(
      'course_enrollment_forbidden',
    );
    const wrongLearnerEnrollment = await inTenant(owner.tenantId, (client) =>
      client.query(`SELECT * FROM course_enrollment_assign($1,$2,$3)`, [
        ownerPrincipal,
        source.courseRun,
        secondLearner,
      ]),
    );
    const secondSource = await courseHandout();
    const secondRun = await createRun({
      handout: secondSource.handout,
      kind: 'course',
      courseRun: secondSource.courseRun,
      lesson: secondSource.lesson,
    });
    expect(
      (await assign(secondRun, learner, wrongLearnerEnrollment.rows[0].enrollment_id)).result_code,
    ).toBe('course_enrollment_forbidden');
    const withdrawnEnrollment = await inTenant(owner.tenantId, (client) =>
      client.query(`SELECT * FROM course_enrollment_assign($1,$2,$3)`, [
        ownerPrincipal,
        secondSource.courseRun,
        learner,
      ]),
    );
    await inTenant(owner.tenantId, (client) =>
      client.query(`SELECT * FROM course_enrollment_withdraw($1,$2)`, [
        ownerPrincipal,
        withdrawnEnrollment.rows[0].enrollment_id,
      ]),
    );
    expect(
      (await assign(secondRun, learner, withdrawnEnrollment.rows[0].enrollment_id)).result_code,
    ).toBe('course_enrollment_forbidden');
    const direct = await createRun({ handout: await directHandout() });
    expect((await assign(direct, learner, enrollment.rows[0].enrollment_id)).result_code).toBe(
      'course_enrollment_forbidden',
    );
  });

  it('enforces assigned-active-withdrawn lifecycle and preserves withdrawn history', async () => {
    const run = await createRun({ handout: await directHandout() });
    const participation = await assign(run);
    const active = await command('activity_participation_activate', [
      learnerPrincipal,
      participation.participation_id,
    ]);
    expect(active).toMatchObject({
      result_code: 'ok',
      participation_status: 'active',
      reused: false,
    });
    expect(
      await command('activity_participation_activate', [
        learnerPrincipal,
        participation.participation_id,
      ]),
    ).toMatchObject({ participation_status: 'active', reused: true });
    expect(
      await command('activity_participation_withdraw', [
        ownerPrincipal,
        participation.participation_id,
      ]),
    ).toMatchObject({ participation_status: 'withdrawn', reused: false });
    expect(
      await command('activity_participation_activate', [
        learnerPrincipal,
        participation.participation_id,
      ]),
    ).toMatchObject({ result_code: 'withdrawn', participation_status: 'withdrawn' });
    await expect(
      admin.query(`DELETE FROM activity_participations WHERE id=$1`, [
        participation.participation_id,
      ]),
    ).rejects.toThrow(/append-preserved/);

    const assigned = await assign(await createRun({ handout: await directHandout() }));
    expect(
      await command('activity_participation_withdraw', [ownerPrincipal, assigned.participation_id]),
    ).toMatchObject({ participation_status: 'withdrawn' });
  });

  it('requires real learner availability and an active exact CourseEnrollment', async () => {
    const source = await courseHandout();
    const run = await createRun({
      handout: source.handout,
      kind: 'course',
      courseRun: source.courseRun,
      lesson: source.lesson,
    });
    const enrollment = await inTenant(owner.tenantId, (client) =>
      client.query(`SELECT * FROM course_enrollment_assign($1,$2,$3)`, [
        ownerPrincipal,
        source.courseRun,
        learner,
      ]),
    );
    const participation = await assign(run, learner, enrollment.rows[0].enrollment_id);
    expect(
      await command('activity_participation_activate', [
        learnerPrincipal,
        participation.participation_id,
      ]),
    ).toMatchObject({ result_code: 'enrollment_not_active' });
    await inTenant(owner.tenantId, (client) =>
      client.query(`SELECT * FROM course_enrollment_activate($1,$2)`, [
        learnerPrincipal,
        enrollment.rows[0].enrollment_id,
      ]),
    );
    expect(
      await command('activity_participation_activate', [
        learnerPrincipal,
        participation.participation_id,
      ]),
    ).toMatchObject({ result_code: 'ok', participation_status: 'active' });
  });

  it('stores learner-specific overrides, accepts due-only, rejects contradictions, and creates no Attempt', async () => {
    const participation = await assign(await createRun({ handout: await directHandout() }));
    const attemptsBefore = (
      await admin.query(`SELECT count(*)::int AS count FROM learning_attempts`)
    ).rows[0].count;
    expect(
      await command('activity_participation_set_overrides', [
        ownerPrincipal,
        participation.participation_id,
        2,
        1800,
        null,
        '2027-05-01T00:00:00Z',
        null,
        true,
      ]),
    ).toMatchObject({ result_code: 'ok', reused: false });
    expect(
      (
        await admin.query(
          `SELECT extra_attempts,time_limit_override_seconds,opens_at_override,
                  due_at_override,closes_at_override,teacher_unlocked
             FROM activity_participations WHERE id=$1`,
          [participation.participation_id],
        )
      ).rows[0],
    ).toMatchObject({
      extra_attempts: 2,
      time_limit_override_seconds: 1800,
      opens_at_override: null,
      closes_at_override: null,
      teacher_unlocked: true,
    });
    expect(
      await command('activity_participation_set_overrides', [
        ownerPrincipal,
        participation.participation_id,
        0,
        null,
        '2027-06-01T00:00:00Z',
        '2027-05-01T00:00:00Z',
        null,
        false,
      ]),
    ).toMatchObject({ result_code: 'invalid_overrides' });
    expect(
      (await admin.query(`SELECT count(*)::int AS count FROM learning_attempts`)).rows[0].count,
    ).toBe(attemptsBefore);
  });

  it('keeps excused orthogonal, audited, idempotent, and result/grade neutral', async () => {
    const participation = await assign(await createRun({ handout: await directHandout() }));
    const resultsBefore = (
      await admin.query(`SELECT count(*)::int AS count FROM assessment_results`)
    ).rows[0].count;
    const gradesBefore = (await admin.query(`SELECT count(*)::int AS count FROM gradebook_entries`))
      .rows[0].count;
    expect(
      await command('activity_participation_excuse', [
        ownerPrincipal,
        participation.participation_id,
        'Approved absence',
      ]),
    ).toMatchObject({ result_code: 'ok', reused: false });
    expect(
      await command('activity_participation_excuse', [
        ownerPrincipal,
        participation.participation_id,
        'Ignored retry text',
      ]),
    ).toMatchObject({ reused: true });
    const row = await admin.query(
      `SELECT status,excused,excused_reason FROM activity_participations WHERE id=$1`,
      [participation.participation_id],
    );
    expect(row.rows[0]).toEqual({
      status: 'assigned',
      excused: true,
      excused_reason: 'Approved absence',
    });
    expect(
      (await admin.query(`SELECT count(*)::int AS count FROM assessment_results`)).rows[0].count,
    ).toBe(resultsBefore);
    expect(
      (await admin.query(`SELECT count(*)::int AS count FROM gradebook_entries`)).rows[0].count,
    ).toBe(gradesBefore);
  });

  it('returns not_available completion and stores no mutable completion/legacy handout identity', async () => {
    const participation = await assign(await createRun({ handout: await directHandout() }));
    expect(
      await command('activity_participation_completion_status', [
        ownerPrincipal,
        participation.participation_id,
      ]),
    ).toMatchObject({
      result_code: 'ok',
      completion_status: 'not_available',
      evidence_reason: 'canonical_attempt_result_lineage_not_available',
    });
    const forbiddenColumns = await admin.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='activity_participations'
          AND column_name=ANY($1::text[])`,
      [
        [
          'completed',
          'completed_at',
          'progress_percent',
          'grade',
          'result',
          'attempts_remaining',
          'expires_at',
          'classroom_assignment_id',
        ],
      ],
    );
    expect(forbiddenColumns.rows).toEqual([]);
  });

  it('does not let teacherUnlocked reopen a cancelled run', async () => {
    const run = await createRun({ handout: await directHandout() });
    const participation = await assign(run);
    await command('activity_participation_set_overrides', [
      ownerPrincipal,
      participation.participation_id,
      0,
      null,
      null,
      null,
      null,
      true,
    ]);
    await inTenant(owner.tenantId, (client) =>
      client.query(`SELECT * FROM activity_run_transition($1,$2,'cancelled')`, [
        ownerPrincipal,
        run,
      ]),
    );
    expect(
      await command('activity_participation_activate', [
        learnerPrincipal,
        participation.participation_id,
      ]),
    ).toMatchObject({ result_code: 'not_available', participation_status: 'assigned' });
  });

  it('denies cross-school/class-invalid, learner self-assign, outside teacher and UUID enumeration', async () => {
    const run = await createRun({ handout: await directHandout() });
    expect((await assign(run, foreignLearner)).result_code).toBe('learner_not_available');
    expect((await assign(run, learner, null, learnerPrincipal)).result_code).toBe('forbidden');
    expect((await assign(run, learner, null, outsiderPrincipal)).result_code).toBe('forbidden');
    expect((await assign(run, learner, null, ownerPrincipal, outsider.tenantId)).result_code).toBe(
      'forbidden',
    );
    const invalidRun = await createRun({ handout: await directHandout(otherClassroom) });
    expect((await assign(invalidRun)).result_code).toBe('learner_not_available');
    await expect(
      admin.query(
        `INSERT INTO activity_participations
          (tenant_id,school_id,activity_run_id,learner_identity_id,assigned_by_principal_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [owner.tenantId, owner.schoolId, run, foreignLearner, ownerPrincipal],
      ),
    ).rejects.toThrow(/foreign key|lineage/i);
  });

  it('denies broad runtime mutation and emits one audit event per real state change', async () => {
    const participation = await assign(await createRun({ handout: await directHandout() }));
    await assign(
      (
        await admin.query(`SELECT activity_run_id FROM activity_participations WHERE id=$1`, [
          participation.participation_id,
        ])
      ).rows[0].activity_run_id,
    );
    await command('activity_participation_set_overrides', [
      ownerPrincipal,
      participation.participation_id,
      1,
      null,
      null,
      null,
      null,
      false,
    ]);
    await command('activity_participation_set_overrides', [
      ownerPrincipal,
      participation.participation_id,
      1,
      null,
      null,
      null,
      null,
      false,
    ]);
    await expect(
      inTenant(owner.tenantId, (client) =>
        client.query(`UPDATE activity_participations SET extra_attempts=99 WHERE id=$1`, [
          participation.participation_id,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    const privileges = await admin.query(
      `SELECT has_table_privilege('asalab_app','activity_participations','SELECT') AS select,
              has_table_privilege('asalab_app','activity_participations','INSERT') AS insert,
              has_table_privilege('asalab_app','activity_participations','UPDATE') AS update,
              has_table_privilege('asalab_app','activity_participations','DELETE') AS delete`,
    );
    expect(privileges.rows[0]).toEqual({
      select: false,
      insert: false,
      update: false,
      delete: false,
    });
    const events = await admin.query(
      `SELECT action,count(*)::int AS count FROM audit_events
        WHERE entity_type='activity_participation' AND entity_id=$1
        GROUP BY action ORDER BY action`,
      [participation.participation_id],
    );
    expect(events.rows).toEqual([
      { action: 'participation.assigned', count: 1 },
      { action: 'participation.override_changed', count: 1 },
    ]);
  });
});
