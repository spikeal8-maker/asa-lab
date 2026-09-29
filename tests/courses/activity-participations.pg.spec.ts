import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { FastifyRequest } from 'fastify';
import { CreateProjectUseCase } from '../../contexts/projects/application/project.usecases';
import type { ModuleCatalogPort } from '../../contexts/projects/application/ports';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import { LearningStartController } from '../../apps/api/src/learning-start.controller';
import { buildTestApp, inject } from '../portal/app';
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

async function learnerWithSeatStatus(status: 'issued' | 'active' | 'suspended' | 'removed') {
  const suffix = `${status}-${++sequence}`;
  const seat = (
    await admin.query(
      `INSERT INTO classroom_student_seats
         (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
          safe_mode,status,created_by)
       VALUES ($1,$2,$3,$4,$4,true,$5,$6) RETURNING id`,
      [
        owner.tenantId,
        classroom,
        `Participation ${status}`,
        `m1-004-${suffix}`,
        status,
        owner.teacherId,
      ],
    )
  ).rows[0].id as string;
  const learnerId = (
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
    [owner.tenantId, owner.schoolId, learnerId, seat],
  );
  return { learner: learnerId, seat };
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

  it('keeps issued seats Course-inherited only and rejects suspended or removed seats', async () => {
    const issued = await learnerWithSeatStatus('issued');
    const directRun = await createRun({ handout: await directHandout() });
    expect(await assign(directRun, issued.learner)).toMatchObject({
      result_code: 'learner_not_available',
    });

    const source = await courseHandout();
    const courseRun = await createRun({
      handout: source.handout,
      kind: 'course',
      courseRun: source.courseRun,
      lesson: source.lesson,
    });
    const enrollment = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT * FROM course_enrollment_assign($1,$2,$3)', [
        ownerPrincipal,
        source.courseRun,
        issued.learner,
      ]),
    );
    expect(enrollment.rows[0].result_code).toBe('ok');
    expect(
      (
        await admin.query(
          `SELECT enrollment.status,part.source_course_enrollment_id,part.status AS participation_status
             FROM course_enrollments enrollment
             JOIN activity_participations part
               ON part.source_course_enrollment_id=enrollment.id
            WHERE enrollment.id=$1 AND part.activity_run_id=$2`,
          [enrollment.rows[0].enrollment_id, courseRun],
        )
      ).rows[0],
    ).toEqual({
      status: 'assigned',
      source_course_enrollment_id: enrollment.rows[0].enrollment_id,
      participation_status: 'assigned',
    });

    for (const status of ['suspended', 'removed'] as const) {
      const blocked = await learnerWithSeatStatus(status);
      const blockedSource = await courseHandout();
      const blockedRun = await createRun({
        handout: blockedSource.handout,
        kind: 'course',
        courseRun: blockedSource.courseRun,
        lesson: blockedSource.lesson,
      });
      await expect(
        inTenant(owner.tenantId, (client) =>
          client.query('SELECT * FROM course_enrollment_assign($1,$2,$3)', [
            ownerPrincipal,
            blockedSource.courseRun,
            blocked.learner,
          ]),
        ),
      ).rejects.toThrow(/course participation: learner_not_available/);
      expect(
        (
          await admin.query(
            `SELECT count(*)::int AS count
               FROM activity_participations
              WHERE activity_run_id=$1 AND learner_identity_id=$2`,
            [blockedRun, blocked.learner],
          )
        ).rows[0].count,
      ).toBe(0);
    }
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

describe('A4-1 immutable learning project origin', () => {
  async function project(principalId: string, tenantId = owner.tenantId) {
    const created = await admin.query(
      `INSERT INTO projects (tenant_id,project_scope,module_key,title,owner_principal_id)
       VALUES ($1,'personal','electronics',$2,$3) RETURNING id`,
      [tenantId, `Origin project ${++sequence}`, principalId],
    );
    return created.rows[0].id as string;
  }

  async function originValues(
    participationId: string,
    projectId: string,
    projectTenantId = owner.tenantId,
    principalId = learnerPrincipal,
  ) {
    const source = await admin.query(
      `SELECT participation.id AS participation_id,participation.tenant_id AS school_tenant_id,
              participation.school_id,participation.learner_identity_id,
              run.id AS activity_run_id,run.learning_activity_version_id,run.source_kind,
              run.source_course_run_id,run.source_course_lesson_id,run.source_course_block_id
         FROM activity_participations participation
         JOIN activity_runs run ON run.id=participation.activity_run_id
        WHERE participation.id=$1`,
      [participationId],
    );
    return [projectId, projectTenantId, ...Object.values(source.rows[0]), principalId];
  }

  const insertSql = `INSERT INTO learning_project_origins
    (project_id,project_tenant_id,participation_id,school_tenant_id,school_id,
     learner_identity_id,activity_run_id,learning_activity_version_id,source_kind,
     source_course_run_id,source_course_lesson_id,source_course_block_id,owner_principal_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`;

  it('pins direct and block-aware course provenance and rejects identity substitution', async () => {
    const directRun = await createRun({ handout: await directHandout() });
    const directPart = await assign(directRun);
    expect(directPart.result_code).toBe('ok');
    const directProject = await project(learnerPrincipal);
    const directValues = await originValues(directPart.participation_id as string, directProject);
    await admin.query(insertSql, directValues);

    const course = await courseHandout();
    const legacyLessonRun = await createRun({
      handout: course.handout,
      kind: 'course',
      courseRun: course.courseRun,
      lesson: course.lesson,
    });
    const legacyLessonPart = await assign(legacyLessonRun);
    expect(legacyLessonPart.result_code).toBe('ok');
    const legacyLessonProject = await project(learnerPrincipal);
    await expect(
      admin.query(
        insertSql,
        await originValues(legacyLessonPart.participation_id as string, legacyLessonProject),
      ),
    ).rejects.toThrow(/learning_project_origins_source_shape_check/);

    const activityLesson = await admin.query(
      `INSERT INTO classroom_course_run_lessons
         (tenant_id,run_id,source_section_id,source_lesson_id,section_title,
          section_position,title,kind,lesson_position)
       VALUES ($1,$2,gen_random_uuid(),gen_random_uuid(),'Section',1,
               'Activity occurrence','material',2) RETURNING id`,
      [owner.tenantId, course.courseRun],
    );
    const activityLessonId = activityLesson.rows[0].id as string;
    const blockRun = await inTenant(owner.tenantId, (client) =>
      client.query(
        `SELECT * FROM activity_run_create($1,$2,$3,'course',$4,$5,
         NULL,NULL,NULL,NULL,NULL,'{}'::jsonb,$6,$7)`,
        [
          ownerPrincipal,
          course.handout,
          lav,
          course.courseRun,
          activityLessonId,
          `a4:origin:block:${++sequence}`,
          'course-block-a',
        ],
      ),
    );
    expect(blockRun.rows[0].result_code).toBe('ok');
    const coursePart = await assign(blockRun.rows[0].activity_run_id as string);
    expect(coursePart.result_code).toBe('ok');
    const courseProject = await project(learnerPrincipal);
    const courseValues = await originValues(coursePart.participation_id as string, courseProject);
    await admin.query(insertSql, courseValues);
    expect(
      (
        await admin.query(
          `SELECT source_kind,learning_activity_version_id,source_course_run_id,
                source_course_lesson_id,source_course_block_id
           FROM learning_project_origins WHERE project_id=$1`,
          [courseProject],
        )
      ).rows[0],
    ).toEqual({
      source_kind: 'course',
      learning_activity_version_id: lav,
      source_course_run_id: course.courseRun,
      source_course_lesson_id: activityLessonId,
      source_course_block_id: 'course-block-a',
    });
    expect(
      (
        await admin.query(
          `SELECT source_kind,source_course_block_id FROM learning_project_origins
        WHERE project_id=$1`,
          [directProject],
        )
      ).rows[0],
    ).toEqual({ source_kind: 'direct', source_course_block_id: null });

    await expect(admin.query(insertSql, [directProject, ...courseValues.slice(1)])).rejects.toThrow(
      /duplicate key/,
    );
    await expect(
      admin.query(insertSql, [
        await project(learnerPrincipal),
        directValues[1],
        ...directValues.slice(2),
      ]),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      admin.query(insertSql, [
        await project(learnerPrincipal),
        ...courseValues.slice(1, 5),
        secondLearner,
        ...courseValues.slice(6),
      ]),
    ).rejects.toThrow(/lineage is incoherent/);
    await expect(
      admin.query(insertSql, [
        await project(learnerPrincipal),
        ...courseValues.slice(1, 8),
        'direct',
        ...courseValues.slice(9),
      ]),
    ).rejects.toThrow(/source_shape|lineage is incoherent/);
    await expect(
      admin.query(insertSql, [
        await project(learnerPrincipal),
        ...courseValues.slice(1, 11),
        'other-block',
        courseValues[12],
      ]),
    ).rejects.toThrow(/lineage is incoherent/);
    await expect(
      admin.query(insertSql, [
        await project(ownerPrincipal),
        ...courseValues.slice(1, 12),
        ownerPrincipal,
      ]),
    ).rejects.toThrow(/owner\/learner lineage is incoherent/);
    await expect(
      admin.query(insertSql, [
        await project(learnerPrincipal),
        ...courseValues.slice(1, 3),
        outsider.tenantId,
        ...courseValues.slice(4),
      ]),
    ).rejects.toThrow(/foreign key|lineage is incoherent/);
    const otherSchool = await admin.query(
      `INSERT INTO schools (tenant_id,title) VALUES ($1,'Other origin school') RETURNING id`,
      [owner.tenantId],
    );
    await expect(
      admin.query(insertSql, [
        await project(learnerPrincipal),
        ...courseValues.slice(1, 4),
        otherSchool.rows[0].id,
        ...courseValues.slice(5),
      ]),
    ).rejects.toThrow(/foreign key|lineage is incoherent/);

    const copied = await admin.query(
      `INSERT INTO projects (tenant_id,project_scope,module_key,title,owner_principal_id,
        copied_from_project_id,copied_from_author,copied_from_title,copied_at)
       VALUES ($1,'personal','electronics','Personal copy',$2,$3,'Learner','Original',now())
       RETURNING id`,
      [owner.tenantId, learnerPrincipal, directProject],
    );
    await expect(
      admin.query(insertSql, [copied.rows[0].id, ...courseValues.slice(1)]),
    ).rejects.toThrow(/project lineage is incoherent/);

    const wrongModule = await admin.query(
      `INSERT INTO projects (tenant_id,project_scope,module_key,title,owner_principal_id)
       VALUES ($1,'personal','three-d','Wrong module',$2) RETURNING id`,
      [owner.tenantId, learnerPrincipal],
    );
    await expect(
      admin.query(insertSql, [wrongModule.rows[0].id, ...courseValues.slice(1)]),
    ).rejects.toThrow(/participation\/run\/version lineage is incoherent/);

    await expect(
      admin.query(
        `UPDATE learning_project_origins SET source_kind='course'
      WHERE project_id=$1`,
        [directProject],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      admin.query(`DELETE FROM learning_project_origins WHERE project_id=$1`, [directProject]),
    ).rejects.toThrow(/immutable/);
    await expect(
      admin.query(`UPDATE projects SET owner_principal_id=$1 WHERE id=$2`, [
        ownerPrincipal,
        directProject,
      ]),
    ).rejects.toThrow(/immutable/);
    await expect(
      admin.query(`UPDATE projects SET module_key='three-d' WHERE id=$1`, [directProject]),
    ).rejects.toThrow(/immutable/);
    await expect(admin.query(`DELETE FROM projects WHERE id=$1`, [directProject])).rejects.toThrow(
      /foreign key/,
    );
  });

  it('allows Account project tenant to differ while Seat→Account linking leaves origin unchanged', async () => {
    const run = await createRun({ handout: await directHandout() });
    const participation = await assign(run);
    expect(participation.result_code).toBe('ok');
    const seat = (
      await admin.query(
        `SELECT seat_id FROM learner_identity_links WHERE learner_identity_id=$1
       AND link_kind='student_seat'`,
        [learner],
      )
    ).rows[0].seat_id as string;
    const account = (
      await admin.query(
        `SELECT account_id,principal_id FROM legacy_user_account_links
       WHERE tenant_id=$1 AND user_id=$2`,
        [outsider.tenantId, outsider.teacherId],
      )
    ).rows[0];
    const seatProject = await project(learnerPrincipal);
    await admin.query(
      insertSql,
      await originValues(participation.participation_id as string, seatProject),
    );
    await admin.query(`UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2`, [
      account.account_id,
      seat,
    ]);
    const unchanged = await admin.query(
      `SELECT owner_principal_id,participation_id FROM learning_project_origins WHERE project_id=$1`,
      [seatProject],
    );
    expect(unchanged.rows[0]).toEqual({
      owner_principal_id: learnerPrincipal,
      participation_id: participation.participation_id,
    });

    const otherRun = await createRun({ handout: await directHandout() });
    const otherPart = await assign(otherRun);
    expect(otherPart.result_code).toBe('ok');
    const accountProject = await project(account.principal_id as string, outsider.tenantId);
    const accountValues = await originValues(
      otherPart.participation_id as string,
      accountProject,
      outsider.tenantId,
      account.principal_id as string,
    );
    await expect(admin.query(insertSql, accountValues)).rejects.toThrow(
      /owner\/learner lineage is incoherent/,
    );

    const wrongOwner = await seedTeacher(admin, 'a4-origin-wrong-account');
    const wrongAccount = (
      await admin.query(
        `SELECT account_id,principal_id FROM legacy_user_account_links
       WHERE tenant_id=$1 AND user_id=$2`,
        [wrongOwner.tenantId, wrongOwner.teacherId],
      )
    ).rows[0];
    await admin.query(`UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2`, [
      wrongAccount.account_id,
      seat,
    ]);
    const wrongLink = (
      await admin.query(
        `INSERT INTO learner_identity_links
         (id,tenant_id,school_id,learner_identity_id,link_kind,account_id)
       VALUES (gen_random_uuid(),$1,$2,$3,'account',$4) RETURNING id`,
        [owner.tenantId, owner.schoolId, secondLearner, wrongAccount.account_id],
      )
    ).rows[0].id as string;
    const wrongRun = await createRun({ handout: await directHandout() });
    const wrongPart = await assign(wrongRun);
    const wrongProject = await project(wrongAccount.principal_id as string, wrongOwner.tenantId);
    await expect(
      admin.query(
        insertSql,
        await originValues(
          wrongPart.participation_id as string,
          wrongProject,
          wrongOwner.tenantId,
          wrongAccount.principal_id as string,
        ),
      ),
    ).rejects.toThrow(/owner\/learner lineage is incoherent/);
    await admin.query(
      `UPDATE learner_identity_links SET status='inactive',disabled_at=now()
      WHERE id=$1`,
      [wrongLink],
    );

    const revokedOwner = await seedTeacher(admin, 'a4-origin-revoked-account');
    const revokedAccount = (
      await admin.query(
        `SELECT account_id,principal_id FROM legacy_user_account_links
       WHERE tenant_id=$1 AND user_id=$2`,
        [revokedOwner.tenantId, revokedOwner.teacherId],
      )
    ).rows[0];
    await admin.query(`UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2`, [
      revokedAccount.account_id,
      seat,
    ]);
    const revokedLink = (
      await admin.query(
        `INSERT INTO learner_identity_links
         (id,tenant_id,school_id,learner_identity_id,link_kind,account_id)
       VALUES (gen_random_uuid(),$1,$2,$3,'account',$4) RETURNING id`,
        [owner.tenantId, owner.schoolId, learner, revokedAccount.account_id],
      )
    ).rows[0].id as string;
    await admin.query(
      `UPDATE learner_identity_links SET status='inactive',disabled_at=now()
      WHERE id=$1`,
      [revokedLink],
    );
    const revokedRun = await createRun({ handout: await directHandout() });
    const revokedPart = await assign(revokedRun);
    const revokedProject = await project(
      revokedAccount.principal_id as string,
      revokedOwner.tenantId,
    );
    await expect(
      admin.query(
        insertSql,
        await originValues(
          revokedPart.participation_id as string,
          revokedProject,
          revokedOwner.tenantId,
          revokedAccount.principal_id as string,
        ),
      ),
    ).rejects.toThrow(/owner\/learner lineage is incoherent/);

    await admin.query(`UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2`, [
      account.account_id,
      seat,
    ]);
    await admin.query(
      `INSERT INTO learner_identity_links
         (id,tenant_id,school_id,learner_identity_id,link_kind,account_id)
       VALUES (gen_random_uuid(),$1,$2,$3,'account',$4)`,
      [owner.tenantId, owner.schoolId, learner, account.account_id],
    );
    await admin.query(insertSql, accountValues);
    const stored = (
      await admin.query(
        `SELECT project_tenant_id,school_tenant_id,
      owner_principal_id FROM learning_project_origins WHERE project_id=$1`,
        [accountProject],
      )
    ).rows[0];
    expect(stored).toEqual({
      project_tenant_id: outsider.tenantId,
      school_tenant_id: owner.tenantId,
      owner_principal_id: account.principal_id,
    });

    const revocationRun = await createRun({ handout: await directHandout() });
    const revocationPart = await assign(revocationRun);
    const revocationProject = await project(account.principal_id as string, outsider.tenantId);
    const revocationValues = await originValues(
      revocationPart.participation_id as string,
      revocationProject,
      outsider.tenantId,
      account.principal_id as string,
    );
    const activeLinkId = (
      await admin.query(
        `SELECT id FROM learner_identity_links WHERE tenant_id=$1 AND school_id=$2
       AND learner_identity_id=$3 AND link_kind='account' AND account_id=$4
       AND status='active'`,
        [owner.tenantId, owner.schoolId, learner, account.account_id],
      )
    ).rows[0].id as string;
    const linkWriter = await admin.connect();
    const originWriter = await admin.connect();
    let linkTransactionOpen = false;
    let originInsertion: Promise<{ error: Error | null }> | undefined;
    try {
      await linkWriter.query('BEGIN');
      linkTransactionOpen = true;
      await linkWriter.query(
        `UPDATE learner_identity_links
        SET status='inactive',disabled_at=now() WHERE id=$1`,
        [activeLinkId],
      );
      const originPid = (await originWriter.query('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid as number;
      let insertionSettled = false;
      originInsertion = originWriter
        .query(insertSql, revocationValues)
        .then(
          () => ({ error: null }),
          (error: Error) => ({ error }),
        )
        .finally(() => {
          insertionSettled = true;
        });
      let blockedOnLink = false;
      for (let i = 0; i < 200 && !insertionSettled; i += 1) {
        const state = await admin.query(
          `SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1`,
          [originPid],
        );
        if (state.rows[0]?.wait_event_type === 'Lock') {
          blockedOnLink = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blockedOnLink).toBe(true);
      await linkWriter.query('COMMIT');
      linkTransactionOpen = false;
      const outcome = await originInsertion;
      expect(outcome.error?.message).toMatch(/owner\/learner lineage is incoherent/);
      expect(
        (
          await admin.query(
            `SELECT count(*)::int AS count FROM learning_project_origins
        WHERE project_id=$1`,
            [revocationProject],
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      if (linkTransactionOpen) await linkWriter.query('ROLLBACK');
      if (originInsertion) await originInsertion;
      linkWriter.release();
      originWriter.release();
    }
  }, 30_000);

  it('serializes origin insertion with a concurrent project-owner change', async () => {
    const run = await createRun({ handout: await directHandout() });
    const participation = await assign(run);
    expect(participation.result_code).toBe('ok');
    const projectId = await project(learnerPrincipal);
    const values = await originValues(participation.participation_id as string, projectId);
    const projectWriter = await admin.connect();
    const originWriter = await admin.connect();
    let projectTransactionOpen = false;
    let originInsertion: Promise<{ error: Error | null }> | undefined;
    try {
      await projectWriter.query('BEGIN');
      projectTransactionOpen = true;
      await projectWriter.query(`UPDATE projects SET owner_principal_id=$1 WHERE id=$2`, [
        ownerPrincipal,
        projectId,
      ]);
      const originPid = (await originWriter.query('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid as number;
      let insertionSettled = false;
      originInsertion = originWriter
        .query(insertSql, values)
        .then(
          () => ({ error: null }),
          (error: Error) => ({ error }),
        )
        .finally(() => {
          insertionSettled = true;
        });
      let blockedOnProject = false;
      for (let i = 0; i < 200 && !insertionSettled; i += 1) {
        const state = await admin.query(
          `SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1`,
          [originPid],
        );
        if (state.rows[0]?.wait_event_type === 'Lock') {
          blockedOnProject = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blockedOnProject).toBe(true);
      await projectWriter.query('COMMIT');
      projectTransactionOpen = false;
      const outcome = await originInsertion;
      expect(outcome.error?.message).toMatch(/project lineage is incoherent/);
      expect(
        (
          await admin.query(
            `SELECT count(*)::int AS count FROM learning_project_origins
        WHERE project_id=$1`,
            [projectId],
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      if (projectTransactionOpen) await projectWriter.query('ROLLBACK');
      if (originInsertion) await originInsertion;
      projectWriter.release();
      originWriter.release();
    }
  }, 20_000);

  it('does not infer legacy origin and gives the runtime role no table privileges', async () => {
    const legacyProject = await project(learnerPrincipal);
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM learning_project_origins
      WHERE project_id=$1`,
          [legacyProject],
        )
      ).rows[0].count,
    ).toBe(0);
    const privileges = await admin.query(
      `SELECT has_table_privilege('asalab_app','learning_project_origins','SELECT') AS select,
              has_table_privilege('asalab_app','learning_project_origins','INSERT') AS insert,
              has_table_privilege('asalab_app','learning_project_origins','UPDATE') AS update,
              has_table_privilege('asalab_app','learning_project_origins','DELETE') AS delete`,
    );
    expect(privileges.rows[0]).toEqual({
      select: false,
      insert: false,
      update: false,
      delete: false,
    });
    await expect(
      inTenant(owner.tenantId, (client) => client.query(`SELECT * FROM learning_project_origins`)),
    ).rejects.toThrow(/permission denied/);
  });
});

const startRequest = {
  cookies: { asa_student_session: 'test-session' },
} as unknown as FastifyRequest;
const accountStartRequest = {
  cookies: { asa_session: 'test-session' },
} as unknown as FastifyRequest;

function startUseCase(): CreateProjectUseCase {
  const electronics = {
    moduleKey: 'electronics',
    defaultProjectTitlePrefix: 'Learning test',
    createEmptyProject: () => ({ source: 'module-empty-project' }),
    validateDocument: (document: unknown) => ({ ok: true as const, document }),
    describePreview: () => null,
  };
  const catalog: ModuleCatalogPort = {
    get: (key) => (key === 'electronics' ? electronics : null),
    getCreatable: (key) => (key === 'electronics' ? electronics : null),
  };
  return new CreateProjectUseCase(new PgProjectRepository(app), catalog);
}

async function startController(
  kind: 'seat' | 'account',
  accountPrincipal?: string,
  useCase = startUseCase(),
) {
  const seatId = (
    await admin.query('SELECT seat_id FROM principals WHERE id=$1', [learnerPrincipal])
  ).rows[0].seat_id as string;
  const principalId = kind === 'seat' ? learnerPrincipal : accountPrincipal!;
  const accountId =
    kind === 'account'
      ? ((await admin.query('SELECT account_id FROM principals WHERE id=$1', [principalId])).rows[0]
          .account_id as string)
      : null;
  const actor = {
    tenantId: owner.tenantId,
    principalId,
    userId: null,
    seatId,
    classroomId: classroom,
    accountId,
  };
  return new LearningStartController(
    app,
    { resolve: async () => (kind === 'account' ? actor : null) } as never,
    { resolve: async () => (kind === 'seat' ? actor : null) } as never,
    useCase,
  );
}

describe('A4-2b atomic StartLearningWork', () => {
  it('creates a module draft, origin and Attempt together; concurrent tabs and retries reuse them', async () => {
    const run = await createRun({ handout: await directHandout() });
    const participation = await assign(run);
    const controller = await startController('seat');
    const requestId = `start:${randomUUID()}`;
    const [first, retry] = await Promise.all([
      controller.start(startRequest, run, { requestId }),
      controller.start(startRequest, run, { requestId }),
    ]);
    expect(retry).toMatchObject({ projectId: first.projectId, attemptId: first.attemptId });
    expect(first.participationId).toBe(participation.participation_id);
    expect(first.attemptNumber).toBe(1);
    const secondTab = await controller.start(startRequest, run, {
      requestId: `start:${randomUUID()}`,
    });
    expect(secondTab).toMatchObject({ projectId: first.projectId, attemptId: first.attemptId });
    const stored = await admin.query(
      `SELECT project.project_scope, project.owner_principal_id,
              project.idempotency_key, draft.document_json,
              origin.participation_id, attempt.attempt_number,
              (SELECT count(*)::int FROM learning_project_origins
                WHERE participation_id=$2) AS origin_count
         FROM projects project
         JOIN project_drafts draft ON draft.project_id=project.id
         JOIN learning_project_origins origin ON origin.project_id=project.id
         JOIN learning_attempts attempt ON attempt.id=$3
        WHERE project.id=$1`,
      [first.projectId, participation.participation_id, first.attemptId],
    );
    expect(stored.rows[0]).toMatchObject({
      project_scope: 'personal',
      owner_principal_id: learnerPrincipal,
      idempotency_key: `learning:${participation.participation_id}`,
      document_json: { source: 'module-empty-project' },
      participation_id: participation.participation_id,
      attempt_number: 1,
      origin_count: 1,
    });
    const seatId = (
      await admin.query('SELECT seat_id FROM principals WHERE id=$1', [learnerPrincipal])
    ).rows[0].seat_id as string;
    const listed = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT context,evidence FROM learning_origin_learner_list($1,NULL)', [seatId]),
    );
    expect(listed.rows.find((row) => row.context.projectId === first.projectId)).toMatchObject({
      context: {
        projectId: first.projectId,
        participationId: participation.participation_id,
        activityRunId: run,
        sourceKind: 'direct',
        attemptId: first.attemptId,
      },
      evidence: { projectId: first.projectId, activityRunId: run },
    });
    const target = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT * FROM learning_direct_learner_runs($1,NULL) WHERE activity_run_id=$2', [
        seatId,
        run,
      ]),
    );
    expect(target.rows).toHaveLength(1);
    const legacy = await admin.query(
      'SELECT count(*)::int AS count FROM classroom_assignment_work WHERE project_id=$1',
      [first.projectId],
    );
    expect(legacy.rows[0].count).toBe(0);
    await admin.query('UPDATE classroom_assignments SET status=$1 WHERE id=$2', [
      'closed',
      target.rows[0].classroom_assignment_id,
    ]);
    const stillListed = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT id FROM classroom_assignments_for_seat($1) WHERE id=$2', [
        seatId,
        target.rows[0].classroom_assignment_id,
      ]),
    );
    expect(stillListed.rows).toHaveLength(1);
    const scheduled = await createRun({
      handout: await directHandout(),
      opens: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await assign(scheduled);
    const scheduledTarget = await inTenant(owner.tenantId, (client) =>
      client.query(
        'SELECT activity_run_id FROM learning_direct_learner_runs($1,NULL) WHERE activity_run_id=$2',
        [seatId, scheduled],
      ),
    );
    expect(scheduledTarget.rows).toEqual([{ activity_run_id: scheduled }]);
    const changedRun = await createRun({ handout: await directHandout() });
    await assign(changedRun);
    await expect(controller.start(startRequest, changedRun, { requestId })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('does not attach a previously prepared Project with the reserved Start key', async () => {
    const run = await createRun({ handout: await directHandout() });
    const participation = await assign(run);
    const idempotencyKey = `learning:${participation.participation_id}`;
    // Simulate a generic Project created before the API reserved this namespace.
    const prepared = await startUseCase().execute({
      tenantId: owner.tenantId,
      scope: 'personal',
      classroomId: null,
      actor: { principalId: learnerPrincipal, userId: null },
      moduleKey: 'electronics',
      title: undefined,
      automaticTitle: true,
      idempotencyKey,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error('prepared project creation failed');
    await admin.query(
      `UPDATE project_drafts SET document_json='{"source":"prepared"}'::jsonb
       WHERE project_id=$1`,
      [prepared.value.project.id],
    );
    await expect(
      inTenant(owner.tenantId, async (client) => {
        // Updating both old row versions in this transaction must not make
        // their xmin appear sufficient proof of a fresh Project.
        await client.query('UPDATE projects SET title=title WHERE id=$1', [
          prepared.value.project.id,
        ]);
        await client.query(
          'UPDATE project_drafts SET document_json=document_json WHERE project_id=$1',
          [prepared.value.project.id],
        );
        return client.query('SELECT * FROM learning_work_start_complete($1,$2,$3,$4)', [
          learnerPrincipal,
          run,
          `start:${randomUUID()}`,
          prepared.value.project.id,
        ]);
      }),
    ).rejects.toMatchObject({ code: 'PZ001' });
    const controller = await startController('seat');
    await expect(
      controller.start(startRequest, run, { requestId: `start:${randomUUID()}` }),
    ).rejects.toMatchObject({ status: 409 });
    const unchanged = await admin.query(
      `SELECT
         (SELECT document_json FROM project_drafts WHERE project_id=$1) AS document,
         (SELECT count(*)::int FROM learning_project_origins WHERE participation_id=$2) AS origins,
         (SELECT count(*)::int FROM learning_attempts WHERE activity_participation_id=$2) AS attempts,
         (SELECT count(*)::int FROM learning_work_start_requests WHERE participation_id=$2) AS requests,
         (SELECT status FROM activity_participations WHERE id=$2) AS participation_status`,
      [prepared.value.project.id, participation.participation_id],
    );
    expect(unchanged.rows[0]).toMatchObject({
      document: { source: 'prepared' },
      origins: 0,
      attempts: 0,
      requests: 0,
      participation_status: 'assigned',
    });
  });

  it('rolls back a created project and participation activation when completion is denied', async () => {
    const run = await createRun({ handout: await directHandout() });
    const participation = await assign(run);
    const original = startUseCase();
    const sabotaged = {
      withRepository(repository: PgProjectRepository) {
        const bound = original.withRepository(repository);
        return {
          execute: async (input: Parameters<CreateProjectUseCase['execute']>[0]) => {
            const result = await bound.execute(input);
            return result.ok
              ? {
                  ...result,
                  value: {
                    ...result.value,
                    project: { ...result.value.project, id: randomUUID() },
                  },
                }
              : result;
          },
        };
      },
    } as unknown as CreateProjectUseCase;
    const broken = await startController('seat', undefined, sabotaged);
    await expect(
      broken.start(startRequest, run, { requestId: `start:${randomUUID()}` }),
    ).rejects.toThrow();
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM projects
        WHERE idempotency_key=$1`,
          [`learning:${participation.participation_id}`],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await admin.query(`SELECT status FROM activity_participations WHERE id=$1`, [
          participation.participation_id,
        ])
      ).rows[0].status,
    ).toBe('assigned');
  });

  it('numbers a changes-requested revision per participation and enforces its attempt budget', async () => {
    const run = await createRun({ handout: await directHandout() });
    await assign(run);
    const controller = await startController('seat');
    const first = await controller.start(startRequest, run, {
      requestId: `start:${randomUUID()}`,
    });
    await admin.query(
      `UPDATE learning_attempts SET state='closed',evaluated_at=now()
        WHERE id=$1`,
      [first.attemptId],
    );
    await admin.query(
      `INSERT INTO assessment_results
         (tenant_id,attempt_id,max_points,outcome,review_decision,
          completion_value,correction_reason)
       VALUES ($1,$2,20,'incomplete','changes_requested',false,'Revise work')`,
      [owner.tenantId, first.attemptId],
    );
    const second = await controller.start(startRequest, run, {
      requestId: `start:${randomUUID()}`,
    });
    expect(second.projectId).toBe(first.projectId);
    expect(second.attemptNumber).toBe(2);
    expect(second.attemptId).not.toBe(first.attemptId);
    expect(
      (
        await admin.query('SELECT revision_of_attempt_id FROM learning_attempts WHERE id=$1', [
          second.attemptId,
        ])
      ).rows[0].revision_of_attempt_id,
    ).toBe(first.attemptId);
    await admin.query(
      `UPDATE learning_attempts SET state='closed',evaluated_at=now()
        WHERE id=$1`,
      [second.attemptId],
    );
    await admin.query(
      `INSERT INTO assessment_results
         (tenant_id,attempt_id,max_points,outcome,review_decision,
          completion_value,correction_reason)
       VALUES ($1,$2,20,'incomplete','changes_requested',false,'Revise again')`,
      [owner.tenantId, second.attemptId],
    );
    await expect(
      controller.start(startRequest, run, {
        requestId: `start:${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM learning_attempts
        WHERE activity_participation_id=$1`,
          [first.participationId],
        )
      ).rows[0].count,
    ).toBe(2);
  });

  it('denies a new Start for closed work without a learner revision action', async () => {
    const run = await createRun({ handout: await directHandout() });
    await assign(run);
    const controller = await startController('seat');
    const firstRequestId = `start:${randomUUID()}`;
    const first = await controller.start(startRequest, run, {
      requestId: firstRequestId,
    });
    await admin.query(
      `UPDATE learning_attempts SET state='closed',evaluated_at=now() WHERE id=$1`,
      [first.attemptId],
    );
    await expect(
      controller.start(startRequest, run, { requestId: `start:${randomUUID()}` }),
    ).rejects.toMatchObject({ status: 409 });
    const replay = await controller.start(startRequest, run, {
      requestId: firstRequestId,
    });
    expect(replay.attemptId).toBe(first.attemptId);
    expect(replay.projectId).toBe(first.projectId);
    await admin.query(
      `INSERT INTO assessment_results
         (tenant_id,attempt_id,max_points,outcome,review_decision,completion_value)
       VALUES ($1,$2,20,'passed','accepted',true)`,
      [owner.tenantId, first.attemptId],
    );
    await expect(
      controller.start(startRequest, run, { requestId: `start:${randomUUID()}` }),
    ).rejects.toMatchObject({ status: 409 });
    const counts = await admin.query(
      `SELECT
         (SELECT count(*)::int FROM learning_attempts
           WHERE activity_participation_id=$1) AS attempts,
         (SELECT count(*)::int FROM learning_work_start_requests
           WHERE participation_id=$1) AS requests`,
      [first.participationId],
    );
    expect(counts.rows[0]).toMatchObject({ attempts: 1, requests: 1 });
  });

  // This case opens two Projects over HTTP and checks linked edits, Start, and revocation in PostgreSQL.
  it('shares one exact Project and Attempt across linked Account and Seat in both directions', async () => {
    const personalOwner = await seedTeacher(admin, 'a4-start-account-owner');
    const accountIdentity = await admin.query(
      `SELECT principal_id,account_id FROM legacy_user_account_links
        WHERE tenant_id=$1 AND user_id=$2`,
      [personalOwner.tenantId, personalOwner.teacherId],
    );
    const accountPrincipal = accountIdentity.rows[0].principal_id as string;
    const accountId = accountIdentity.rows[0].account_id as string;
    const personalTenant = (
      await admin.query(
        `INSERT INTO tenants (workspace_slug,title)
         VALUES ($1,'Learning personal') RETURNING id`,
        [`personal-${accountId.replaceAll('-', '')}`],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO tenant_placements (tenant_id,mode) VALUES ($1,'SHARED_CLUSTER')`,
      [personalTenant],
    );
    const workspaceId = (
      await admin.query(
        `INSERT INTO workspaces (tenant_id,kind,title)
         VALUES ($1,'personal','Learning personal') RETURNING id`,
        [personalTenant],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO workspace_memberships (account_id,workspace_id,role)
       VALUES ($1,$2,'owner')`,
      [accountId, workspaceId],
    );
    const personal = await admin.query('SELECT tenant_id FROM auth_personal_workspace($1)', [
      accountId,
    ]);
    expect(personal.rows[0].tenant_id).not.toBe(owner.tenantId);
    const run = await createRun({ handout: await directHandout() });
    await assign(run);
    const denied = await startController('account', accountPrincipal);
    await expect(
      denied.start(accountStartRequest, run, {
        requestId: `start:${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const seatId = (
      await admin.query('SELECT seat_id FROM principals WHERE id=$1', [learnerPrincipal])
    ).rows[0].seat_id as string;
    await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2', [
      accountId,
      seatId,
    ]);
    await admin.query(
      `INSERT INTO learner_identity_links
         (id,tenant_id,school_id,learner_identity_id,link_kind,account_id)
       VALUES (gen_random_uuid(),$1,$2,$3,'account',$4)`,
      [owner.tenantId, owner.schoolId, learner, accountId],
    );
    const started = await denied.start(accountStartRequest, run, {
      requestId: `start:${randomUUID()}`,
    });
    const origin = await admin.query(
      `SELECT project_tenant_id,school_tenant_id,owner_principal_id
         FROM learning_project_origins WHERE project_id=$1`,
      [started.projectId],
    );
    expect(origin.rows[0]).toEqual({
      project_tenant_id: personal.rows[0].tenant_id,
      school_tenant_id: owner.tenantId,
      owner_principal_id: accountPrincipal,
    });
    const projects = new PgProjectRepository(app);
    const seatActor = { principalId: learnerPrincipal, userId: null };
    const accountActor = { principalId: accountPrincipal, userId: null };
    const ordinary = await startUseCase().execute({
      tenantId: owner.tenantId,
      scope: 'personal',
      classroomId: null,
      actor: seatActor,
      moduleKey: 'electronics',
      title: 'Seat private',
      idempotencyKey: `private:${randomUUID()}`,
    });
    expect(ordinary.ok).toBe(true);
    if (!ordinary.ok) throw new Error('ordinary project creation failed');
    expect(await projects.load(owner.tenantId, ordinary.value.project.id, accountActor)).toBeNull();
    expect(
      (await projects.authorize(owner.tenantId, started.projectId, learnerPrincipal, 'edit'))
        ?.tenantId,
    ).toBe(personalTenant);
    expect((await projects.load(owner.tenantId, started.projectId, seatActor))?.project.id).toBe(
      started.projectId,
    );
    expect(
      await projects.rename(owner.tenantId, started.projectId, seatActor, 'Seat edit'),
    ).toMatchObject({
      id: started.projectId,
      title: 'Seat edit',
    });
    const classActivity = await admin.query(
      `SELECT id,tenant_id,classroom_id,seat_id,actor_principal_id,project_title,
              occurrence_count
         FROM classroom_activity_events
        WHERE project_id=$1 AND action='project.renamed'`,
      [started.projectId],
    );
    expect(classActivity.rows).toHaveLength(1);
    expect(classActivity.rows[0]).toMatchObject({
      tenant_id: owner.tenantId,
      classroom_id: classroom,
      seat_id: seatId,
      actor_principal_id: learnerPrincipal,
      project_title: 'Seat edit',
      occurrence_count: 1,
    });
    const activityFeed = await inTenant(owner.tenantId, (client) =>
      client.query(
        `SELECT project_id,seat_id,action FROM classroom_activity_feed($1,$2,$3)
          WHERE project_id=$4 AND action='project.renamed'`,
        [ownerPrincipal, classroom, seatId, started.projectId],
      ),
    );
    expect(activityFeed.rows).toEqual([
      { project_id: started.projectId, seat_id: seatId, action: 'project.renamed' },
    ]);
    await inTenant(personalTenant, async (client) => {
      const recorded = await client.query(
        `SELECT classroom_activity_record_project($1,$2,'project.renamed') AS id`,
        [learnerPrincipal, started.projectId],
      );
      expect(recorded.rows[0].id).toBe(classActivity.rows[0].id);
      expect(
        (await client.query(`SELECT current_setting('app.tenant_id') AS tenant_id`)).rows[0],
      ).toEqual({ tenant_id: personalTenant });
    });
    expect(
      await projects.rename(
        owner.tenantId,
        started.projectId,
        accountActor,
        'Account learner edit',
      ),
    ).toMatchObject({ id: started.projectId, title: 'Account learner edit' });
    const learnerAccountActivity = await inTenant(owner.tenantId, (client) =>
      client.query(
        `SELECT seat_id,actor_is_teacher FROM classroom_activity_feed($1,$2,$3)
          WHERE project_id=$4 AND project_title='Account learner edit'`,
        [ownerPrincipal, classroom, seatId, started.projectId],
      ),
    );
    expect(learnerAccountActivity.rows).toEqual([{ seat_id: seatId, actor_is_teacher: false }]);
    const historical = await admin.query(
      `INSERT INTO classroom_activity_events
         (tenant_id,classroom_id,seat_id,actor_principal_id,action,project_id,project_title)
       VALUES ($1,$2,$3,$4,'legacy.project',$5,'Historical Account event')
       RETURNING id,actor_is_teacher_at_event`,
      [owner.tenantId, classroom, seatId, accountPrincipal, started.projectId],
    );
    expect(historical.rows[0].actor_is_teacher_at_event).toBeNull();
    const historicalFeed = await inTenant(owner.tenantId, (client) =>
      client.query(
        `SELECT actor_is_teacher FROM classroom_activity_feed($1,$2,$3)
          WHERE id=$4`,
        [ownerPrincipal, classroom, seatId, historical.rows[0].id],
      ),
    );
    expect(historicalFeed.rows).toEqual([{ actor_is_teacher: true }]);
    const freshAfterLegacy = await inTenant(owner.tenantId, (client) =>
      client.query(`SELECT classroom_activity_record($1,$2,$3,$4,'legacy.project',$5,$6) AS id`, [
        owner.tenantId,
        classroom,
        seatId,
        accountPrincipal,
        started.projectId,
        'Fresh event',
      ]),
    );
    expect(freshAfterLegacy.rows[0].id).not.toBe(historical.rows[0].id);
    const legacySegments = await admin.query(
      `SELECT id,actor_is_teacher_at_event,occurrence_count
         FROM classroom_activity_events
        WHERE project_id=$1 AND actor_principal_id=$2 AND action='legacy.project'`,
      [started.projectId, accountPrincipal],
    );
    expect(legacySegments.rows).toHaveLength(2);
    expect(legacySegments.rows).toContainEqual({
      id: historical.rows[0].id,
      actor_is_teacher_at_event: null,
      occurrence_count: 1,
    });
    expect(legacySegments.rows).toContainEqual({
      id: freshAfterLegacy.rows[0].id,
      actor_is_teacher_at_event: false,
      occurrence_count: 1,
    });
    const linkedTeacherUser = (
      await admin.query(
        `INSERT INTO users
           (tenant_id,school_id,role,email,display_name,password_hash)
         SELECT $1,$2,'teacher',$3,'Linked educator',source.password_hash
           FROM users source WHERE source.id=$4 RETURNING id`,
        [
          owner.tenantId,
          owner.schoolId,
          `linked-${randomUUID()}@test.local`,
          personalOwner.teacherId,
        ],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO classroom_memberships
         (tenant_id,classroom_id,user_id,account_id,member_role)
       VALUES ($1,$2,$3,$4,'co_teacher')`,
      [owner.tenantId, classroom, linkedTeacherUser, accountId],
    );
    expect(
      await projects.rename(
        owner.tenantId,
        started.projectId,
        accountActor,
        'Account teacher edit',
      ),
    ).toMatchObject({ id: started.projectId });
    expect(
      await projects.rename(
        owner.tenantId,
        started.projectId,
        accountActor,
        'Account teacher edit again',
      ),
    ).toMatchObject({ id: started.projectId });
    const roleSegments = await admin.query(
      `SELECT actor_is_teacher_at_event,occurrence_count,project_title
         FROM classroom_activity_events
        WHERE project_id=$1 AND actor_principal_id=$2 AND action='project.renamed'`,
      [started.projectId, accountPrincipal],
    );
    expect(roleSegments.rows).toHaveLength(2);
    expect(roleSegments.rows).toEqual(
      expect.arrayContaining([
        {
          actor_is_teacher_at_event: false,
          occurrence_count: 1,
          project_title: 'Account learner edit',
        },
        {
          actor_is_teacher_at_event: true,
          occurrence_count: 2,
          project_title: 'Account teacher edit again',
        },
      ]),
    );
    const learnerEventAfterPromotion = await inTenant(owner.tenantId, (client) =>
      client.query(
        `SELECT actor_is_teacher FROM classroom_activity_feed($1,$2,$3)
          WHERE project_id=$4 AND project_title='Account learner edit'`,
        [ownerPrincipal, classroom, seatId, started.projectId],
      ),
    );
    expect(learnerEventAfterPromotion.rows).toEqual([{ actor_is_teacher: false }]);
    const ordinaryAccount = await startUseCase().execute({
      tenantId: personalTenant,
      scope: 'personal',
      classroomId: null,
      actor: accountActor,
      moduleKey: 'electronics',
      title: 'Account private',
      idempotencyKey: `private:${randomUUID()}`,
    });
    expect(ordinaryAccount.ok).toBe(true);
    if (!ordinaryAccount.ok) throw new Error('ordinary Account project creation failed');
    expect(
      await projects.rename(
        personalTenant,
        ordinaryAccount.value.project.id,
        accountActor,
        'Account private edit',
      ),
    ).toMatchObject({ id: ordinaryAccount.value.project.id });
    expect(
      (
        await admin.query(
          'SELECT count(*)::int AS count FROM classroom_activity_events WHERE project_id=$1',
          [ordinaryAccount.value.project.id],
        )
      ).rows[0].count,
    ).toBe(0);
    const seatController = await startController('seat');
    const seatResumeRequestId = `start:${randomUUID()}`;
    const seatResume = await seatController.start(startRequest, run, {
      requestId: seatResumeRequestId,
    });
    expect(seatResume).toMatchObject({
      projectId: started.projectId,
      attemptId: started.attemptId,
    });
    const accountOwnedCounts = await admin.query(
      `SELECT (SELECT count(*)::int FROM learning_attempts
                WHERE activity_participation_id=$1) AS attempts,
              (SELECT count(*)::int FROM learning_work_start_requests
                WHERE participation_id=$1) AS requests,
              (SELECT count(*)::int FROM learning_project_origins
                WHERE participation_id=$1) AS origins`,
      [started.participationId],
    );
    expect(accountOwnedCounts.rows[0]).toEqual({ attempts: 1, requests: 2, origins: 1 });

    const seatOwnedRun = await createRun({ handout: await directHandout() });
    const seatOwnedParticipation = await assign(seatOwnedRun);
    const seatOwned = await seatController.start(startRequest, seatOwnedRun, {
      requestId: `start:${randomUUID()}`,
    });
    expect(
      (await projects.authorize(owner.tenantId, seatOwned.projectId, accountPrincipal, 'edit'))
        ?.tenantId,
    ).toBe(owner.tenantId);
    expect(
      (await projects.load(owner.tenantId, seatOwned.projectId, accountActor))?.project.id,
    ).toBe(seatOwned.projectId);
    expect(
      await projects.rename(owner.tenantId, seatOwned.projectId, accountActor, 'Account edit'),
    ).toMatchObject({ id: seatOwned.projectId, title: 'Account edit' });
    expect(
      await projects.rename(
        owner.tenantId,
        seatOwned.projectId,
        { principalId: ownerPrincipal, userId: owner.teacherId },
        'Teacher edit',
      ),
    ).toMatchObject({ id: seatOwned.projectId, title: 'Teacher edit' });
    const teacherActivity = await inTenant(owner.tenantId, (client) =>
      client.query(
        `SELECT seat_id,actor_is_teacher FROM classroom_activity_feed($1,$2,$3)
          WHERE project_id=$4 AND project_title='Teacher edit'`,
        [ownerPrincipal, classroom, seatId, seatOwned.projectId],
      ),
    );
    expect(teacherActivity.rows).toEqual([{ seat_id: seatId, actor_is_teacher: true }]);
    expect(
      await projects.rename(owner.tenantId, seatOwned.projectId, accountActor, 'Co-teacher edit'),
    ).toMatchObject({ id: seatOwned.projectId, title: 'Co-teacher edit' });
    await admin.query(
      `DELETE FROM classroom_memberships
        WHERE tenant_id=$1 AND classroom_id=$2 AND account_id=$3
          AND member_role='co_teacher'`,
      [owner.tenantId, classroom, accountId],
    );
    const formerTeacherEvent = await inTenant(owner.tenantId, (client) =>
      client.query(
        `SELECT actor_is_teacher,occurrence_count
           FROM classroom_activity_feed($1,$2,$3)
          WHERE project_id=$4 AND project_title='Co-teacher edit'`,
        [ownerPrincipal, classroom, seatId, seatOwned.projectId],
      ),
    );
    expect(formerTeacherEvent.rows).toEqual([{ actor_is_teacher: true, occurrence_count: 2 }]);
    const earlierLearnerEvent = await inTenant(owner.tenantId, (client) =>
      client.query(
        `SELECT actor_is_teacher FROM classroom_activity_feed($1,$2,$3)
          WHERE project_id=$4 AND project_title='Account learner edit'`,
        [ownerPrincipal, classroom, seatId, started.projectId],
      ),
    );
    expect(earlierLearnerEvent.rows).toEqual([{ actor_is_teacher: false }]);
    expect(
      await projects.rename(
        owner.tenantId,
        started.projectId,
        accountActor,
        'Account learner again',
      ),
    ).toMatchObject({ id: started.projectId });
    const afterRoleFlip = await admin.query(
      `SELECT actor_is_teacher_at_event,occurrence_count,project_title
         FROM classroom_activity_events
        WHERE project_id=$1 AND actor_principal_id=$2 AND action='project.renamed'`,
      [started.projectId, accountPrincipal],
    );
    expect(afterRoleFlip.rows).toHaveLength(3);
    expect(afterRoleFlip.rows).toContainEqual({
      actor_is_teacher_at_event: false,
      occurrence_count: 1,
      project_title: 'Account learner again',
    });
    const accountResume = await denied.start(accountStartRequest, seatOwnedRun, {
      requestId: `start:${randomUUID()}`,
    });
    expect(accountResume).toMatchObject({
      projectId: seatOwned.projectId,
      attemptId: seatOwned.attemptId,
    });
    const linkedAccountOwnedRead = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT context,evidence FROM learning_origin_work_context_for_project($1,$2)', [
        learnerPrincipal,
        started.projectId,
      ]),
    );
    expect(linkedAccountOwnedRead.rows).toHaveLength(1);
    expect(linkedAccountOwnedRead.rows[0].context).toMatchObject({
      projectId: started.projectId,
      participationId: started.participationId,
      activityRunId: run,
      attemptId: started.attemptId,
    });
    expect(linkedAccountOwnedRead.rows[0].evidence).toMatchObject({
      projectId: started.projectId,
      activityRunId: run,
      attempt: { id: started.attemptId },
    });
    const linkedSeatOwnedRead = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT context,evidence FROM learning_origin_work_context_for_project($1,$2)', [
        accountPrincipal,
        seatOwned.projectId,
      ]),
    );
    expect(linkedSeatOwnedRead.rows).toHaveLength(1);
    expect(linkedSeatOwnedRead.rows[0].context).toMatchObject({
      projectId: seatOwned.projectId,
      participationId: seatOwned.participationId,
      activityRunId: seatOwnedRun,
      attemptId: seatOwned.attemptId,
    });
    const unchanged = await admin.query(
      `SELECT (SELECT count(*)::int FROM learning_attempts
                WHERE activity_participation_id=$1) AS attempts,
              (SELECT count(*)::int FROM learning_work_start_requests
                WHERE participation_id=$1) AS requests,
              (SELECT count(*)::int FROM learning_project_origins
                WHERE participation_id=$1) AS origins`,
      [seatOwnedParticipation.participation_id],
    );
    expect(unchanged.rows[0]).toEqual({ attempts: 1, requests: 2, origins: 1 });
    const ledger = await admin.query(
      `SELECT actor_principal_id FROM learning_work_start_requests
        WHERE participation_id=$1`,
      [seatOwnedParticipation.participation_id],
    );
    expect(new Set(ledger.rows.map((row) => row.actor_principal_id))).toEqual(
      new Set([learnerPrincipal, accountPrincipal]),
    );
    const seatToken = `a4-linked-${randomUUID()}`;
    const tokenHash = createHash('sha256').update(seatToken).digest('hex');
    await admin.query(
      `INSERT INTO classroom_seat_credentials
         (seat_id,credential_hash,version,last_request_id,issued_by_account_id)
       VALUES ($1,$2,1,$3,$4)`,
      [seatId, createHash('sha256').update(randomUUID()).digest('hex'), randomUUID(), ownerAccount],
    );
    await admin.query(
      `INSERT INTO classroom_student_sessions
         (seat_id,token_hash,expires_at,credential_version)
       VALUES ($1,$2,now()+interval '1 hour',1)`,
      [seatId, tokenHash],
    );
    const api = await buildTestApp(testAppPool());
    try {
      const login = await inject(api, {
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          workspace: personalOwner.workspace,
          email: personalOwner.email,
          password: personalOwner.password,
        },
      });
      expect(login.statusCode).toBe(200);
      const accountToken = login.cookies.find((cookie) => cookie.name === 'asa_session')?.value;
      expect(accountToken).toBeTruthy();
      const seatOpen = await inject(api, {
        method: 'GET',
        url: `/api/projects/${started.projectId}`,
        cookies: { asa_student_session: seatToken },
      });
      expect(seatOpen.statusCode).toBe(200);
      expect(seatOpen.json().project.id).toBe(started.projectId);
      const seatWork = await inject(api, {
        method: 'GET',
        url: `/api/learning/projects/${started.projectId}/context`,
        cookies: { asa_student_session: seatToken },
      });
      expect(seatWork.statusCode).toBe(200);
      expect(seatWork.json()).toMatchObject({
        state: 'ready',
        projectId: started.projectId,
        origin: { participationId: started.participationId, activityRunId: run },
        workflow: { attemptId: started.attemptId },
      });
      const accountOpen = await inject(api, {
        method: 'GET',
        url: `/api/projects/${seatOwned.projectId}`,
        cookies: { asa_session: accountToken ?? '' },
      });
      expect(accountOpen.statusCode).toBe(200);
      expect(accountOpen.json().project.id).toBe(seatOwned.projectId);
      const accountWork = await inject(api, {
        method: 'GET',
        url: `/api/learning/projects/${seatOwned.projectId}/context`,
        cookies: { asa_session: accountToken ?? '' },
      });
      expect(accountWork.statusCode).toBe(200);
      expect(accountWork.json()).toMatchObject({
        state: 'ready',
        projectId: seatOwned.projectId,
        origin: { participationId: seatOwned.participationId, activityRunId: seatOwnedRun },
        workflow: { attemptId: seatOwned.attemptId },
      });
    } finally {
      await api.close();
    }
    expect(
      await projects.load(owner.tenantId, seatOwned.projectId, {
        principalId: outsiderPrincipal,
        userId: null,
      }),
    ).toBeNull();
    const wrongHandle = `a4-wrong-class-${randomUUID().slice(0, 8)}`;
    const wrongClassSeat = (
      await admin.query(
        `INSERT INTO classroom_student_seats
           (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
            safe_mode,status,created_by,account_id)
         VALUES ($1,$2,'Wrong classroom',$3,$3,true,'active',$4,$5) RETURNING id`,
        [owner.tenantId, otherClassroom, wrongHandle, owner.teacherId, accountId],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO learner_identity_links
         (id,tenant_id,school_id,learner_identity_id,link_kind,seat_id)
       VALUES (gen_random_uuid(),$1,$2,$3,'student_seat',$4)`,
      [owner.tenantId, owner.schoolId, learner, wrongClassSeat],
    );
    const wrongClassPrincipal = (
      await admin.query(
        `INSERT INTO principals (kind,seat_id)
         VALUES ('student_seat',$1) RETURNING id`,
        [wrongClassSeat],
      )
    ).rows[0].id as string;
    expect(
      await projects.load(owner.tenantId, started.projectId, {
        principalId: wrongClassPrincipal,
        userId: null,
      }),
    ).toBeNull();
    const wrongClassRead = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT * FROM learning_origin_work_context_for_project($1,$2)', [
        wrongClassPrincipal,
        started.projectId,
      ]),
    );
    expect(wrongClassRead.rows).toEqual([]);

    await admin.query(
      `UPDATE learner_identity_links SET status='inactive',disabled_at=now()
       WHERE tenant_id=$1 AND school_id=$2 AND learner_identity_id=$3
         AND link_kind='account' AND account_id=$4`,
      [owner.tenantId, owner.schoolId, learner, accountId],
    );
    expect(await projects.load(owner.tenantId, seatOwned.projectId, accountActor)).toBeNull();
    expect(await projects.load(owner.tenantId, started.projectId, seatActor)).toBeNull();
    const revokedRead = await inTenant(owner.tenantId, async (client) => ({
      seat: await client.query('SELECT * FROM learning_origin_work_context_for_project($1,$2)', [
        learnerPrincipal,
        started.projectId,
      ]),
      account: await client.query('SELECT * FROM learning_origin_work_context_for_project($1,$2)', [
        accountPrincipal,
        seatOwned.projectId,
      ]),
    }));
    expect(revokedRead.seat.rows).toEqual([]);
    expect(revokedRead.account.rows).toEqual([]);
    expect(
      await projects.rename(owner.tenantId, started.projectId, seatActor, 'Denied'),
    ).toBeNull();
    expect(
      (
        await admin.query(`SELECT occurrence_count FROM classroom_activity_events WHERE id=$1`, [
          classActivity.rows[0].id,
        ])
      ).rows[0].occurrence_count,
    ).toBe(2);
    await expect(
      denied.start(accountStartRequest, seatOwnedRun, { requestId: `start:${randomUUID()}` }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      seatController.start(startRequest, run, { requestId: `start:${randomUUID()}` }),
    ).rejects.toMatchObject({ status: 409 });
    const revokedApi = await buildTestApp(testAppPool());
    try {
      const replayAfterRevoke = await inject(revokedApi, {
        method: 'POST',
        url: `/api/learning/work/runs/${run}/start`,
        cookies: { asa_student_session: seatToken },
        payload: { requestId: seatResumeRequestId },
      });
      expect(replayAfterRevoke.statusCode).toBe(409);
      expect(replayAfterRevoke.body).not.toContain(started.projectId);
      expect(replayAfterRevoke.body).not.toContain(started.attemptId);
      const revokedContext = await inject(revokedApi, {
        method: 'GET',
        url: `/api/learning/projects/${started.projectId}/context`,
        cookies: { asa_student_session: seatToken },
      });
      expect(revokedContext.statusCode).toBe(200);
      expect(revokedContext.json()).toEqual({ state: 'denied', projectId: started.projectId });
      expect(revokedContext.body).not.toContain(started.attemptId);
    } finally {
      await revokedApi.close();
    }
    const afterRevocation = await admin.query(
      `SELECT (SELECT count(*)::int FROM learning_attempts
                WHERE activity_participation_id=$1) AS attempts,
              (SELECT count(*)::int FROM learning_work_start_requests
                WHERE participation_id=$1) AS requests,
              (SELECT count(*)::int FROM learning_project_origins
                WHERE participation_id=$1) AS origins`,
      [seatOwnedParticipation.participation_id],
    );
    expect(afterRevocation.rows[0]).toEqual({ attempts: 1, requests: 2, origins: 1 });
    const accountOwnedAfterRevocation = await admin.query(
      `SELECT (SELECT count(*)::int FROM learning_attempts
                WHERE activity_participation_id=$1) AS attempts,
              (SELECT count(*)::int FROM learning_work_start_requests
                WHERE participation_id=$1) AS requests,
              (SELECT count(*)::int FROM learning_project_origins
                WHERE participation_id=$1) AS origins`,
      [started.participationId],
    );
    expect(accountOwnedAfterRevocation.rows[0]).toEqual({ attempts: 1, requests: 2, origins: 1 });
    expect((await projects.load(owner.tenantId, seatOwned.projectId, seatActor))?.project.id).toBe(
      seatOwned.projectId,
    );
    expect((await projects.load(owner.tenantId, started.projectId, accountActor))?.project.id).toBe(
      started.projectId,
    );
    expect(seatOwnedParticipation.participation_id).not.toBe(started.participationId);
  }, 20_000);

  it('reopens a Seat-owned Project for a linked legacy Account without a personal workspace', async () => {
    const legacyOwner = await seedTeacher(admin, 'a4-linked-no-personal-workspace');
    const identity = await admin.query(
      `SELECT account_id,principal_id FROM legacy_user_account_links
        WHERE tenant_id=$1 AND user_id=$2`,
      [legacyOwner.tenantId, legacyOwner.teacherId],
    );
    const accountId = identity.rows[0].account_id as string;
    expect(
      (await admin.query('SELECT * FROM auth_personal_workspace($1)', [accountId])).rowCount,
    ).toBe(0);
    const seatId = (
      await admin.query('SELECT seat_id FROM principals WHERE id=$1', [learnerPrincipal])
    ).rows[0].seat_id as string;
    await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2', [
      accountId,
      seatId,
    ]);
    await admin.query(
      `INSERT INTO learner_identity_links
         (id,tenant_id,school_id,learner_identity_id,link_kind,account_id)
       VALUES (gen_random_uuid(),$1,$2,$3,'account',$4)`,
      [owner.tenantId, owner.schoolId, learner, accountId],
    );
    const run = await createRun({ handout: await directHandout() });
    const participation = await assign(run);
    const api = await buildTestApp(testAppPool());
    try {
      const login = await inject(api, {
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          workspace: legacyOwner.workspace,
          email: legacyOwner.email,
          password: legacyOwner.password,
        },
      });
      expect(login.statusCode).toBe(200);
      const accountToken = login.cookies.find((cookie) => cookie.name === 'asa_session')?.value;
      expect(accountToken).toBeTruthy();
      const cookies = { asa_session: accountToken ?? '' };
      const beforeOrigin = await inject(api, {
        method: 'POST',
        url: `/api/learning/work/runs/${run}/start`,
        cookies,
        payload: { requestId: `start:${randomUUID()}` },
      });
      expect(beforeOrigin.statusCode).toBe(404);
      const seatStarted = await (
        await startController('seat')
      ).start(startRequest, run, {
        requestId: `start:${randomUUID()}`,
      });
      const opened = await inject(api, {
        method: 'GET',
        url: `/api/projects/${seatStarted.projectId}`,
        cookies,
      });
      expect(opened.statusCode).toBe(200);
      expect(opened.json().project.id).toBe(seatStarted.projectId);
      const requestId = `start:${randomUUID()}`;
      const start = await inject(api, {
        method: 'POST',
        url: `/api/learning/work/runs/${run}/start`,
        cookies,
        payload: { requestId },
      });
      expect(start.statusCode).toBe(200);
      expect(start.json()).toMatchObject({
        projectId: seatStarted.projectId,
        attemptId: seatStarted.attemptId,
      });
      const replay = await inject(api, {
        method: 'POST',
        url: `/api/learning/work/runs/${run}/start`,
        cookies,
        payload: { requestId },
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({
        projectId: seatStarted.projectId,
        attemptId: seatStarted.attemptId,
      });
      await admin.query(
        `UPDATE learner_identity_links SET status='inactive',disabled_at=now()
         WHERE school_id=$1 AND account_id=$2 AND learner_identity_id=$3`,
        [owner.schoolId, accountId, learner],
      );
      const deniedOpen = await inject(api, {
        method: 'GET',
        url: `/api/projects/${seatStarted.projectId}`,
        cookies,
      });
      expect(deniedOpen.statusCode).toBe(404);
      const deniedReplay = await inject(api, {
        method: 'POST',
        url: `/api/learning/work/runs/${run}/start`,
        cookies,
        payload: { requestId },
      });
      expect(deniedReplay.statusCode).toBe(404);
      expect(deniedReplay.body).not.toContain(seatStarted.projectId);
      expect(deniedReplay.body).not.toContain(seatStarted.attemptId);
      const counts = await admin.query(
        `SELECT (SELECT count(*)::int FROM learning_project_origins
                  WHERE participation_id=$1) AS origins,
                (SELECT count(*)::int FROM learning_attempts
                  WHERE activity_participation_id=$1) AS attempts,
                (SELECT count(*)::int FROM learning_work_start_requests
                  WHERE participation_id=$1) AS requests`,
        [participation.participation_id],
      );
      expect(counts.rows[0]).toEqual({ origins: 1, attempts: 1, requests: 2 });
    } finally {
      await api.close();
    }
  }, 20_000);

  it('separates two exact Course blocks even when they share a legacy handout', async () => {
    const source = await courseHandout();
    const blocks = [
      { id: 'a', type: 'activity', learningActivityVersionId: lav },
      { id: 'b', type: 'activity', learningActivityVersionId: lav },
      { id: 'hidden', type: 'activity', learningActivityVersionId: lav, hidden: true },
    ];
    await admin.query('UPDATE classroom_course_run_lessons SET blocks=$1::jsonb WHERE id=$2', [
      JSON.stringify(blocks),
      source.lesson,
    ]);
    const enrollment = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT * FROM course_enrollment_assign($1,$2,$3)', [
        ownerPrincipal,
        source.courseRun,
        learner,
      ]),
    );
    expect(enrollment.rows[0].result_code).toBe('ok');
    const runs: string[] = [];
    for (const block of blocks) {
      const created = await inTenant(owner.tenantId, (client) =>
        client.query(
          `SELECT * FROM activity_run_create($1,$2,$3,'course',$4,$5,
           NULL,NULL,NULL,NULL,NULL,'{}'::jsonb,$6,$7)`,
          [
            ownerPrincipal,
            source.handout,
            lav,
            source.courseRun,
            source.lesson,
            `start:${randomUUID()}`,
            block.id,
          ],
        ),
      );
      expect(created.rows[0].result_code).toBe('ok');
      const run = created.rows[0].activity_run_id as string;
      runs.push(run);
      expect((await assign(run, learner, enrollment.rows[0].enrollment_id)).result_code).toBe('ok');
    }
    const controller = await startController('seat');
    const first = await controller.start(startRequest, runs[0]!, {
      requestId: `start:${randomUUID()}`,
    });
    const second = await controller.start(startRequest, runs[1]!, {
      requestId: `start:${randomUUID()}`,
    });
    expect(first.projectId).not.toBe(second.projectId);
    expect(first.attemptId).not.toBe(second.attemptId);
    expect(first.attemptNumber).toBe(1);
    expect(second.attemptNumber).toBe(1);
    const origins = await admin.query(
      `SELECT source_course_block_id FROM learning_project_origins
        WHERE project_id=ANY($1::uuid[]) ORDER BY source_course_block_id`,
      [[first.projectId, second.projectId]],
    );
    expect(origins.rows.map((row) => row.source_course_block_id)).toEqual(['a', 'b']);
    const submittedVersion = await admin.query(
      `INSERT INTO project_versions
         (tenant_id,project_id,version_no,document_json,created_by)
       SELECT project.tenant_id,project.id,1,draft.document_json,$2
         FROM projects project JOIN project_drafts draft ON draft.project_id=project.id
        WHERE project.id=$1 RETURNING id`,
      [first.projectId, owner.teacherId],
    );
    expect(submittedVersion.rows).toHaveLength(1);
    await admin.query(
      `UPDATE learning_attempts SET state='submitted',submitted_at=now()
        WHERE id=$1`,
      [first.attemptId],
    );
    const exactSubmission = await admin.query(
      `INSERT INTO learning_submissions
         (tenant_id,attempt_id,project_tenant_id,project_id,project_version_id,
          payload_manifest,payload_digest,client_request_id)
       VALUES ($1,$2,$1,$3,$4,'{}'::jsonb,$5,$6) RETURNING id`,
      [
        owner.tenantId,
        first.attemptId,
        first.projectId,
        submittedVersion.rows[0].id,
        '0'.repeat(64),
        `exact:${randomUUID()}`,
      ],
    );
    const exactReads = await inTenant(owner.tenantId, async (client) =>
      Promise.all(
        [first.projectId, second.projectId].map((projectId) =>
          client.query(
            'SELECT context,evidence FROM learning_origin_work_context_for_project($1,$2)',
            [learnerPrincipal, projectId],
          ),
        ),
      ),
    );
    for (const [index, read] of exactReads.entries()) {
      expect(read.rows).toHaveLength(1);
      expect(read.rows[0].context).toMatchObject({
        projectId: [first.projectId, second.projectId][index],
        activityRunId: runs[index],
        courseBlockId: blocks[index]?.id,
        attemptId: [first.attemptId, second.attemptId][index],
        submissionId: index === 0 ? exactSubmission.rows[0].id : null,
      });
      expect(read.rows[0].evidence).toMatchObject({
        projectId: [first.projectId, second.projectId][index],
        activityRunId: runs[index],
        attempt: { id: [first.attemptId, second.attemptId][index] },
      });
    }
    const unrelatedRead = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT * FROM learning_origin_work_context_for_project($1,$2)', [
        outsiderPrincipal,
        first.projectId,
      ]),
    );
    expect(unrelatedRead.rows).toEqual([]);
    await expect(
      controller.start(startRequest, runs[2]!, {
        requestId: `start:${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects closed work, withdrawal and direct table writes by the runtime role', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const run = await createRun({ handout: await directHandout(), closes: past });
    await assign(run);
    const controller = await startController('seat');
    await expect(
      controller.start(startRequest, run, { requestId: `start:${randomUUID()}` }),
    ).rejects.toMatchObject({ status: 409 });
    const another = await createRun({ handout: await directHandout() });
    const participation = await assign(another);
    const withdrawn = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT * FROM activity_participation_withdraw($1,$2)', [
        ownerPrincipal,
        participation.participation_id,
      ]),
    );
    expect(withdrawn.rows[0].result_code).toBe('ok');
    await expect(
      controller.start(startRequest, another, { requestId: `start:${randomUUID()}` }),
    ).rejects.toMatchObject({ status: 404 });
    const privilege = await admin.query(
      `SELECT has_table_privilege('asalab_app','learning_work_start_requests','INSERT') AS request_insert,
              has_table_privilege('asalab_app','learning_project_origins','INSERT') AS origin_insert,
              has_table_privilege('asalab_app','learning_attempts','INSERT') AS attempt_insert`,
    );
    expect(privilege.rows[0]).toEqual({
      request_insert: false,
      origin_insert: false,
      attempt_insert: false,
    });
  });

  it('denies a disabled module capability without activating the participation', async () => {
    const run = await createRun({ handout: await directHandout() });
    const participation = await assign(run);
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE module_learning_capabilities
            SET assignable=false,editable_evidence=false,
                submit_project_version=false,preview='none'
          WHERE module_key='electronics'`,
      );
      const denied = await client.query('SELECT * FROM learning_work_start_admit($1,$2,$3)', [
        learnerPrincipal,
        run,
        `start:${randomUUID()}`,
      ]);
      expect(denied.rows[0].result_code).toBe('not_available');
      expect(
        (
          await client.query('SELECT status FROM activity_participations WHERE id=$1', [
            participation.participation_id,
          ])
        ).rows[0].status,
      ).toBe('assigned');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

async function submitOrigin(
  principalId: string,
  projectId: string,
  requestId: string,
  revision: number,
) {
  return inTenant(owner.tenantId, async (client) => {
    const result = await client.query(
      'SELECT * FROM learning_origin_project_submission_create($1,$2,$3,$4)',
      [principalId, projectId, requestId, revision],
    );
    return result.rows[0] as Record<string, unknown>;
  });
}

describe('A4-3b immutable-origin Project Submission', () => {
  it('pins one direct ProjectVersion, serializes concurrent retries and rejects stale drafts', async () => {
    const run = await createRun({ handout: await directHandout() });
    await assign(run);
    const started = await (
      await startController('seat')
    ).start(startRequest, run, {
      requestId: `start:${randomUUID()}`,
    });
    const requestId = `submit:${randomUUID()}`;
    const stale = await submitOrigin(learnerPrincipal, started.projectId, requestId, 0);
    expect(stale.result_code).toBe('project_revision_conflict');
    const [first, retry] = await Promise.all([
      submitOrigin(learnerPrincipal, started.projectId, requestId, 1),
      submitOrigin(learnerPrincipal, started.projectId, requestId, 1),
    ]);
    expect([first.result_code, retry.result_code]).toEqual(['ok', 'ok']);
    expect([first.reused, retry.reused].sort()).toEqual([false, true]);
    expect(first).toMatchObject({
      project_id: started.projectId,
      participation_id: started.participationId,
      activity_run_id: run,
      attempt_id: started.attemptId,
      attempt_state: 'submitted',
    });
    expect(retry.submission_id).toBe(first.submission_id);
    expect(retry.project_version_id).toBe(first.project_version_id);
    const pinned = await admin.query(
      `SELECT submission.id,submission.payload_manifest,submission.payload_digest,
              version.document_json,version.project_id,attempt.state
         FROM learning_submissions submission
         JOIN project_versions version ON version.id=submission.project_version_id
         JOIN learning_attempts attempt ON attempt.id=submission.attempt_id
        WHERE submission.id=$1`,
      [first.submission_id],
    );
    expect(pinned.rows[0]).toMatchObject({
      project_id: started.projectId,
      state: 'submitted',
      payload_manifest: { sourceRevision: 1, projectVersionId: first.project_version_id },
    });
    expect(pinned.rows[0].payload_digest).toMatch(/^[0-9a-f]{64}$/);
    const savedDocument = pinned.rows[0].document_json;
    await admin.query(
      `UPDATE project_drafts
          SET revision=2,document_json='{"schemaVersion":1,"components":[]}'::jsonb
        WHERE project_id=$1`,
      [started.projectId],
    );
    expect((await submitOrigin(learnerPrincipal, started.projectId, requestId, 1)).reused).toBe(
      true,
    );
    expect(
      (await submitOrigin(learnerPrincipal, started.projectId, requestId, 2)).result_code,
    ).toBe('request_conflict');
    expect(
      (await submitOrigin(learnerPrincipal, started.projectId, `submit:${randomUUID()}`, 2))
        .result_code,
    ).toBe('attempt_already_submitted');
    expect(await submitOrigin(outsiderPrincipal, started.projectId, requestId, 1)).toMatchObject({
      result_code: 'forbidden',
      attempt_id: null,
      submission_id: null,
    });
    const final = await admin.query(
      `SELECT (SELECT count(*)::int FROM learning_submissions WHERE attempt_id=$1) AS submissions,
              (SELECT count(*)::int FROM project_versions WHERE project_id=$2) AS versions,
              (SELECT document_json FROM project_versions WHERE id=$3) AS pinned_document`,
      [started.attemptId, started.projectId, first.project_version_id],
    );
    expect(final.rows[0]).toEqual({ submissions: 1, versions: 1, pinned_document: savedDocument });
  }, 20_000);

  it('rolls back after Version insert when Submission insert fails, then safely retries', async () => {
    const run = await createRun({ handout: await directHandout() });
    await assign(run);
    const started = await (
      await startController('seat')
    ).start(startRequest, run, {
      requestId: `start:${randomUUID()}`,
    });
    const requestId = `submit:${randomUUID()}`;
    const client = await admin.connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const suffix = randomUUID().replaceAll('-', '');
      const triggerFunction = `learning_submit_fail_${suffix}`;
      const trigger = `learning_submit_inject_${suffix}`;
      // Both objects exist only in this transaction. The trigger fires after
      // the command inserts ProjectVersion and before Submission is persisted.
      await client.query(`
        CREATE FUNCTION public.${triggerFunction}() RETURNS trigger
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
        BEGIN
          IF NEW.client_request_id = '${requestId}' THEN
            IF NOT EXISTS (SELECT 1 FROM public.project_versions
                            WHERE id=NEW.project_version_id) THEN
              RAISE EXCEPTION 'Version was not inserted first' USING ERRCODE='PZ183';
            END IF;
            RAISE EXCEPTION 'injected Submission failure' USING ERRCODE='PZ182';
          END IF;
          RETURN NEW;
        END; $$`);
      await client.query(`
        CREATE TRIGGER ${trigger} BEFORE INSERT ON public.learning_submissions
        FOR EACH ROW EXECUTE FUNCTION public.${triggerFunction}()`);
      await client.query('SAVEPOINT before_submit');
      await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [owner.tenantId]);
      await client.query('SET LOCAL ROLE asalab_app');
      await expect(
        client.query('SELECT * FROM learning_origin_project_submission_create($1,$2,$3,$4)', [
          learnerPrincipal,
          started.projectId,
          requestId,
          1,
        ]),
      ).rejects.toMatchObject({ code: 'PZ182' });
      await client.query('ROLLBACK TO SAVEPOINT before_submit');
      const rolledBack = await client.query(
        `SELECT (SELECT count(*)::int FROM project_versions WHERE project_id=$1) AS versions,
                (SELECT count(*)::int FROM learning_submissions WHERE attempt_id=$2) AS submissions,
                (SELECT state FROM learning_attempts WHERE id=$2) AS state`,
        [started.projectId, started.attemptId],
      );
      expect(rolledBack.rows[0]).toEqual({
        versions: 0,
        submissions: 0,
        state: 'in_progress',
      });
      await client.query('ROLLBACK');
      transactionOpen = false;
    } finally {
      if (transactionOpen) await client.query('ROLLBACK');
      client.release();
    }
    const beforeRetry = await admin.query(
      `SELECT (SELECT count(*)::int FROM project_versions WHERE project_id=$1) AS versions,
              (SELECT count(*)::int FROM learning_submissions WHERE attempt_id=$2) AS submissions,
              (SELECT state FROM learning_attempts WHERE id=$2) AS state`,
      [started.projectId, started.attemptId],
    );
    expect(beforeRetry.rows[0]).toEqual({ versions: 0, submissions: 0, state: 'in_progress' });
    const retried = await submitOrigin(learnerPrincipal, started.projectId, requestId, 1);
    expect(retried).toMatchObject({
      result_code: 'ok',
      reused: false,
      attempt_id: started.attemptId,
    });
  }, 20_000);

  it('serializes different-tab request IDs to one receipt and replays a lost response', async () => {
    const run = await createRun({ handout: await directHandout() });
    await assign(run);
    const started = await (
      await startController('seat')
    ).start(startRequest, run, {
      requestId: `start:${randomUUID()}`,
    });
    const requests = [`submit:${randomUUID()}`, `submit:${randomUUID()}`];
    const results = await Promise.all(
      requests.map((requestId) => submitOrigin(learnerPrincipal, started.projectId, requestId, 1)),
    );
    expect(results.map((result) => result.result_code).sort()).toEqual([
      'attempt_already_submitted',
      'ok',
    ]);
    const winner = results.findIndex((result) => result.result_code === 'ok');
    const receipt = results[winner]!;
    expect(results[1 - winner]).toMatchObject({
      result_code: 'attempt_already_submitted',
      submission_id: null,
      project_version_id: null,
    });
    const replay = await submitOrigin(learnerPrincipal, started.projectId, requests[winner]!, 1);
    expect(replay).toEqual({ ...receipt, reused: true });
    const counts = await admin.query(
      `SELECT (SELECT count(*)::int FROM project_versions WHERE project_id=$1) AS versions,
              (SELECT count(*)::int FROM learning_submissions WHERE attempt_id=$2) AS submissions,
              (SELECT state FROM learning_attempts WHERE id=$2) AS state`,
      [started.projectId, started.attemptId],
    );
    expect(counts.rows[0]).toEqual({ versions: 1, submissions: 1, state: 'submitted' });
  }, 20_000);

  it('enforces submit-time windows, due policy, capability and Participation status', async () => {
    const run = await createRun({ handout: await directHandout() });
    await assign(run);
    const started = await (
      await startController('seat')
    ).start(startRequest, run, {
      requestId: `start:${randomUUID()}`,
    });
    const cases = [
      {
        name: 'not open',
        sql: `UPDATE activity_participations
                SET operational_overrides=jsonb_build_object('opensAt',now()+interval '1 day')
              WHERE id=$1`,
        args: [started.participationId],
        expected: 'not_available',
      },
      {
        name: 'closed',
        sql: `UPDATE activity_participations
                SET operational_overrides=jsonb_build_object('closesAt',now()-interval '1 day')
              WHERE id=$1`,
        args: [started.participationId],
        expected: 'not_available',
      },
      {
        name: 'due blocked',
        sql: `UPDATE activity_participations
                SET operational_overrides=jsonb_build_object(
                  'dueAt',now()-interval '1 day','latePolicy','block_at_due')
              WHERE id=$1`,
        args: [started.participationId],
        expected: 'not_available',
      },
      {
        name: 'teacher unlocked',
        sql: `UPDATE activity_participations
                SET teacher_unlocked=true,
                    operational_overrides=jsonb_build_object(
                      'dueAt',now()-interval '1 day','latePolicy','block_at_due')
              WHERE id=$1`,
        args: [started.participationId],
        expected: 'ok',
      },
      {
        name: 'submit capability disabled',
        sql: `UPDATE module_learning_capabilities
                SET submit_project_version=false WHERE module_key='electronics'`,
        args: [],
        expected: 'not_available',
      },
      {
        name: 'inactive Participation',
        sql: `UPDATE activity_participations
                SET status='withdrawn',withdrawn_at=now(),
                    withdrawn_by_principal_id=$2,withdrawal_source='teacher_command'
              WHERE id=$1`,
        args: [started.participationId, ownerPrincipal],
        expected: 'forbidden',
      },
    ];
    for (const gate of cases) {
      const client = await admin.connect();
      try {
        await client.query('BEGIN');
        await client.query(gate.sql, gate.args);
        await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [owner.tenantId]);
        await client.query('SET LOCAL ROLE asalab_app');
        const result = await client.query(
          'SELECT * FROM learning_origin_project_submission_create($1,$2,$3,$4)',
          [learnerPrincipal, started.projectId, `submit:${randomUUID()}`, 1],
        );
        expect(result.rows[0].result_code, gate.name).toBe(gate.expected);
        if (gate.expected === 'ok') {
          expect(result.rows[0].late_state).toBe('late');
        } else {
          expect(result.rows[0].submission_id).toBeNull();
          if (gate.expected === 'forbidden') {
            expect(result.rows[0]).toMatchObject({
              participation_id: null,
              activity_run_id: null,
              attempt_id: null,
              project_id: null,
              project_version_id: null,
            });
          }
        }
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    }
    const unchanged = await admin.query(
      `SELECT (SELECT count(*)::int FROM project_versions WHERE project_id=$1) AS versions,
              (SELECT count(*)::int FROM learning_submissions WHERE attempt_id=$2) AS submissions,
              (SELECT state FROM learning_attempts WHERE id=$2) AS state`,
      [started.projectId, started.attemptId],
    );
    expect(unchanged.rows[0]).toEqual({ versions: 0, submissions: 0, state: 'in_progress' });
  }, 20_000);

  it('submits two Course blocks sharing one handout to separate exact Attempts and Projects', async () => {
    const source = await courseHandout();
    await admin.query('UPDATE classroom_course_run_lessons SET blocks=$1::jsonb WHERE id=$2', [
      JSON.stringify([
        { id: 'first', type: 'activity', learningActivityVersionId: lav },
        { id: 'second', type: 'activity', learningActivityVersionId: lav },
      ]),
      source.lesson,
    ]);
    const enrollment = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT * FROM course_enrollment_assign($1,$2,$3)', [
        ownerPrincipal,
        source.courseRun,
        learner,
      ]),
    );
    const runs: string[] = [];
    for (const blockId of ['first', 'second']) {
      const created = await inTenant(owner.tenantId, (client) =>
        client.query(
          `SELECT * FROM activity_run_create($1,$2,$3,'course',$4,$5,
           NULL,NULL,NULL,NULL,NULL,'{}'::jsonb,$6,$7)`,
          [
            ownerPrincipal,
            source.handout,
            lav,
            source.courseRun,
            source.lesson,
            `submit:${randomUUID()}`,
            blockId,
          ],
        ),
      );
      expect(created.rows[0].result_code).toBe('ok');
      runs.push(created.rows[0].activity_run_id as string);
      expect(
        (await assign(runs.at(-1)!, learner, enrollment.rows[0].enrollment_id)).result_code,
      ).toBe('ok');
    }
    const starter = await startController('seat');
    const first = await starter.start(startRequest, runs[0]!, {
      requestId: `start:${randomUUID()}`,
    });
    const second = await starter.start(startRequest, runs[1]!, {
      requestId: `start:${randomUUID()}`,
    });
    const firstSubmit = await submitOrigin(
      learnerPrincipal,
      first.projectId,
      `submit:${randomUUID()}`,
      1,
    );
    expect(firstSubmit).toMatchObject({
      result_code: 'ok',
      project_id: first.projectId,
      activity_run_id: runs[0],
      attempt_id: first.attemptId,
    });
    const untouched = await admin.query('SELECT state FROM learning_attempts WHERE id=$1', [
      second.attemptId,
    ]);
    expect(untouched.rows[0].state).toBe('in_progress');
    const secondSubmit = await submitOrigin(
      learnerPrincipal,
      second.projectId,
      `submit:${randomUUID()}`,
      1,
    );
    expect(secondSubmit).toMatchObject({
      result_code: 'ok',
      project_id: second.projectId,
      activity_run_id: runs[1],
      attempt_id: second.attemptId,
    });
    expect(secondSubmit.submission_id).not.toBe(firstSubmit.submission_id);
    expect(secondSubmit.project_version_id).not.toBe(firstSubmit.project_version_id);
    const seatId = (
      await admin.query('SELECT seat_id FROM principals WHERE id=$1', [learnerPrincipal])
    ).rows[0].seat_id as string;
    const listed = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT context,evidence FROM learning_origin_learner_list($1,NULL)', [seatId]),
    );
    const exactRows = listed.rows.filter((row) => row.context.courseRunId === source.courseRun);
    expect(
      exactRows.map((row) => [
        row.context.courseBlockId,
        row.context.projectId,
        row.context.submissionId,
      ]),
    ).toEqual([
      ['first', first.projectId, firstSubmit.submission_id],
      ['second', second.projectId, secondSubmit.submission_id],
    ]);
    expect(exactRows.every((row) => row.evidence.attempt.state === 'submitted')).toBe(true);
    expect(
      (
        await admin.query(
          'SELECT count(*)::int AS count FROM classroom_assignment_work WHERE assignment_id=$1',
          [source.handout],
        )
      ).rows[0].count,
    ).toBe(0);
    await admin.query('UPDATE classroom_course_runs SET status=$1 WHERE id=$2', [
      'closed',
      source.courseRun,
    ]);
    const closedRun = await inTenant(owner.tenantId, (client) =>
      client.query(
        'SELECT DISTINCT run_id FROM classroom_course_runs_for_seat_v2($1) WHERE run_id=$2',
        [seatId, source.courseRun],
      ),
    );
    expect(closedRun.rows).toHaveLength(1);
    const exact = await admin.query(
      `SELECT submission.attempt_id,submission.project_id,version.project_id AS version_project_id
         FROM learning_submissions submission
         JOIN project_versions version ON version.id=submission.project_version_id
        WHERE submission.id=ANY($1::uuid[])`,
      [[firstSubmit.submission_id, secondSubmit.submission_id]],
    );
    expect(
      new Set(
        exact.rows.map((row) => `${row.attempt_id}:${row.project_id}:${row.version_project_id}`),
      ),
    ).toEqual(
      new Set([
        `${first.attemptId}:${first.projectId}:${first.projectId}`,
        `${second.attemptId}:${second.projectId}:${second.projectId}`,
      ]),
    );
  }, 20_000);

  it('permits reciprocal linked Seat and Account submissions and denies revoked replay', async () => {
    const accountOwner = await seedTeacher(admin, 'a4-submit-linked-account');
    const identity = await admin.query(
      `SELECT account_id,principal_id FROM legacy_user_account_links
        WHERE tenant_id=$1 AND user_id=$2`,
      [accountOwner.tenantId, accountOwner.teacherId],
    );
    const accountId = identity.rows[0].account_id as string;
    const accountPrincipal = identity.rows[0].principal_id as string;
    const personalTenant = (
      await admin.query(
        `INSERT INTO tenants (workspace_slug,title)
         VALUES ($1,'Learning submit personal') RETURNING id`,
        [`submit-${accountId.replaceAll('-', '')}`],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO tenant_placements (tenant_id,mode) VALUES ($1,'SHARED_CLUSTER')`,
      [personalTenant],
    );
    const workspaceId = (
      await admin.query(
        `INSERT INTO workspaces (tenant_id,kind,title)
         VALUES ($1,'personal','Learning submit personal') RETURNING id`,
        [personalTenant],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO workspace_memberships (account_id,workspace_id,role)
       VALUES ($1,$2,'owner')`,
      [accountId, workspaceId],
    );
    const seatId = (
      await admin.query('SELECT seat_id FROM principals WHERE id=$1', [learnerPrincipal])
    ).rows[0].seat_id as string;
    await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2', [
      accountId,
      seatId,
    ]);
    await admin.query(
      `INSERT INTO learner_identity_links
         (id,tenant_id,school_id,learner_identity_id,link_kind,account_id)
       VALUES (gen_random_uuid(),$1,$2,$3,'account',$4)`,
      [owner.tenantId, owner.schoolId, learner, accountId],
    );
    const accountRun = await createRun({ handout: await directHandout() });
    await assign(accountRun);
    const accountOwned = await (
      await startController('account', accountPrincipal)
    ).start(accountStartRequest, accountRun, { requestId: `start:${randomUUID()}` });
    expect(
      (
        await admin.query(
          'SELECT project_tenant_id FROM learning_project_origins WHERE project_id=$1',
          [accountOwned.projectId],
        )
      ).rows[0].project_tenant_id,
    ).toBe(personalTenant);
    const seatRun = await createRun({ handout: await directHandout() });
    await assign(seatRun);
    const seatOwned = await (
      await startController('seat')
    ).start(startRequest, seatRun, {
      requestId: `start:${randomUUID()}`,
    });
    const seatRequest = `submit:${randomUUID()}`;
    const accountRequest = `submit:${randomUUID()}`;
    const bySeat = await submitOrigin(learnerPrincipal, accountOwned.projectId, seatRequest, 1);
    const byAccount = await submitOrigin(accountPrincipal, seatOwned.projectId, accountRequest, 1);
    expect(bySeat).toMatchObject({
      result_code: 'ok',
      project_id: accountOwned.projectId,
      attempt_id: accountOwned.attemptId,
    });
    expect(byAccount).toMatchObject({
      result_code: 'ok',
      project_id: seatOwned.projectId,
      attempt_id: seatOwned.attemptId,
    });
    const bySeatList = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT context FROM learning_origin_learner_list($1,NULL)', [seatId]),
    );
    const byAccountList = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT context FROM learning_origin_learner_list(NULL,$1)', [accountId]),
    );
    for (const list of [bySeatList, byAccountList]) {
      expect(list.rows.map((row) => row.context.projectId)).toEqual(
        expect.arrayContaining([accountOwned.projectId, seatOwned.projectId]),
      );
    }
    const outsiderAccount = (
      await admin.query(
        `SELECT account_id FROM legacy_user_account_links
          WHERE tenant_id=$1 AND user_id=$2`,
        [outsider.tenantId, outsider.teacherId],
      )
    ).rows[0].account_id as string;
    const crossTenantList = await inTenant(outsider.tenantId, (client) =>
      client.query('SELECT context FROM learning_origin_learner_list(NULL,$1)', [outsiderAccount]),
    );
    expect(crossTenantList.rows).toEqual([]);
    const wrongClassSeat = (
      await admin.query(
        `INSERT INTO classroom_student_seats
           (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
            safe_mode,status,created_by,account_id)
         VALUES ($1,$2,'Wrong class',$3,$3,true,'active',$4,$5) RETURNING id`,
        [
          owner.tenantId,
          otherClassroom,
          `submit-wrong-${randomUUID().slice(0, 8)}`,
          owner.teacherId,
          accountId,
        ],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO learner_identity_links
         (id,tenant_id,school_id,learner_identity_id,link_kind,seat_id)
       VALUES (gen_random_uuid(),$1,$2,$3,'student_seat',$4)`,
      [owner.tenantId, owner.schoolId, learner, wrongClassSeat],
    );
    const wrongPrincipal = (
      await admin.query(
        `INSERT INTO principals (kind,seat_id) VALUES ('student_seat',$1) RETURNING id`,
        [wrongClassSeat],
      )
    ).rows[0].id as string;
    const wrongList = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT context FROM learning_origin_learner_list($1,NULL)', [wrongClassSeat]),
    );
    expect(wrongList.rows.some((row) => row.context.projectId === accountOwned.projectId)).toBe(
      false,
    );
    expect(
      await submitOrigin(wrongPrincipal, accountOwned.projectId, seatRequest, 1),
    ).toMatchObject({
      result_code: 'forbidden',
      project_id: null,
      attempt_id: null,
      submission_id: null,
    });
    expect(
      await submitOrigin(outsiderPrincipal, seatOwned.projectId, accountRequest, 1),
    ).toMatchObject({
      result_code: 'forbidden',
      project_id: null,
      attempt_id: null,
      submission_id: null,
    });
    await admin.query(
      `UPDATE learner_identity_links SET status='inactive',disabled_at=now()
       WHERE tenant_id=$1 AND school_id=$2 AND learner_identity_id=$3
         AND link_kind='account' AND account_id=$4`,
      [owner.tenantId, owner.schoolId, learner, accountId],
    );
    const revokedSeat = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT context FROM learning_origin_learner_list($1,NULL)', [seatId]),
    );
    const revokedAccount = await inTenant(owner.tenantId, (client) =>
      client.query('SELECT context FROM learning_origin_learner_list(NULL,$1)', [accountId]),
    );
    expect(revokedSeat.rows.some((row) => row.context.projectId === accountOwned.projectId)).toBe(
      false,
    );
    expect(revokedAccount.rows.some((row) => row.context.projectId === seatOwned.projectId)).toBe(
      false,
    );
    expect(
      await submitOrigin(learnerPrincipal, accountOwned.projectId, seatRequest, 1),
    ).toMatchObject({
      result_code: 'forbidden',
      project_id: null,
      attempt_id: null,
      submission_id: null,
    });
    expect(
      await submitOrigin(accountPrincipal, seatOwned.projectId, accountRequest, 1),
    ).toMatchObject({
      result_code: 'forbidden',
      project_id: null,
      attempt_id: null,
      submission_id: null,
    });
    const counts = await admin.query(
      `SELECT (SELECT count(*)::int FROM learning_project_origins
                WHERE project_id=ANY($1::uuid[])) AS origins,
              (SELECT count(*)::int FROM learning_attempts
                WHERE id=ANY($2::uuid[])) AS attempts,
              (SELECT count(*)::int FROM learning_submissions
                WHERE id=ANY($3::uuid[])) AS submissions`,
      [
        [accountOwned.projectId, seatOwned.projectId],
        [accountOwned.attemptId, seatOwned.attemptId],
        [bySeat.submission_id, byAccount.submission_id],
      ],
    );
    expect(counts.rows[0]).toEqual({ origins: 2, attempts: 2, submissions: 2 });
  }, 20_000);
});
