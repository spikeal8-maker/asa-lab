import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';
let admin: pg.Pool, app: pg.Pool, teacher: SeededTeacher, principal: string, account: string;
let seq = 0;
const policies = {
  attemptPolicy: { maxAttempts: 2 },
  resultSelectionPolicy: { mode: 'latest_accepted' },
  completionPolicy: { mode: 'accepted' },
  latePolicy: { mode: 'allow_until_close' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'immediate' },
};
async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>) {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.tenantId]);
    const value = await fn(c);
    await c.query('COMMIT');
    return value;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  teacher = await seedTeacher(admin, 'course01-canonical');
  const who = await admin.query(
    'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
    [teacher.tenantId, teacher.teacherId],
  );
  principal = who.rows[0].principal_id;
  account = who.rows[0].account_id;
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});
async function material(module = 'electronics') {
  const created = await tx((c) =>
    c.query(
      "SELECT * FROM learning_activity_create($1,$2,'school','private','project',$3,'Практическая работа','completion',NULL,$4::jsonb,$5,NULL,NULL,NULL,$6)",
      [
        principal,
        teacher.tenantId,
        'Материал ' + ++seq,
        JSON.stringify(policies),
        module,
        'course01:create:' + seq,
      ],
    ),
  );
  expect(created.rows[0].result_code).toBe('ok');
  const published = await tx((c) =>
    c.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
      principal,
      teacher.tenantId,
      created.rows[0].activity_id,
      'course01:publish:' + seq,
    ]),
  );
  expect(published.rows[0].result_code).toBe('ok');
  return {
    id: created.rows[0].activity_id as string,
    version: published.rows[0].activity_version_id as string,
  };
}
async function classroom() {
  const cls = await admin.query(
    "INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,'Курс в классе',$4) RETURNING id",
    [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
  );
  const id = cls.rows[0].id as string;
  await admin.query(
    "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
    [teacher.tenantId, id, teacher.teacherId, account],
  );
  return id;
}
async function seat(classId: string) {
  const result = await admin.query(
    "INSERT INTO classroom_student_seats(tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by) VALUES($1,$2,'Ученик',$3,$3,true,'active',$4) RETURNING id",
    [teacher.tenantId, classId, 'course01-seat-' + ++seq, teacher.teacherId],
  );
  return result.rows[0].id as string;
}
async function course(version: string) {
  const saved = await tx((c) =>
    c.query(
      "SELECT * FROM course_save_v2($1,$2,NULL,'Курс с практикой',NULL,NULL,'private',NULL,$3)",
      [principal, teacher.tenantId, 'course01:course:' + ++seq],
    ),
  );
  const id = saved.rows[0].id as string;
  expect(id).toBeTruthy();
  const outline = await tx((c) =>
    c.query('SELECT * FROM course_outline_v3($1,$2,$3,$4)', [
      id,
      principal,
      account,
      teacher.tenantId,
    ]),
  );
  const section = outline.rows[0].section_id;
  for (let i = 0; i < 2; i++) {
    const lesson = await tx((c) =>
      c.query(
        "SELECT course_lesson_save_v3($1,$2,$3,NULL,$4,NULL,'[]'::jsonb,'assignment',NULL,15,$5) AS id",
        [principal, id, section, 'Практика ' + i, version],
      ),
    );
    expect(lesson.rows[0].id).toBeTruthy();
  }
  const published = await tx((c) =>
    c.query('SELECT * FROM course_publish($1,$2)', [principal, id]),
  );
  expect(published.rows[0].version_number).toBe(1);
  return { id, versionId: published.rows[0].version_id as string };
}
async function assign(courseId: string, classId: string, seats: string[], request: string) {
  return tx(
    async (c) =>
      (
        await c.query(
          'SELECT * FROM classroom_course_run_assign_v3($1,$2,$3,NULL,1,$4,$5::uuid[],$6)',
          [
            principal,
            classId,
            courseId,
            seats.length ? 'named_learners' : 'whole_class',
            seats,
            request,
          ],
        )
      ).rows[0],
  );
}
describe('Э1 existing course → exact versions → runs → inherited participation', () => {
  it('excused changes the required denominator without generating academic results', async () => {
    const authored = await material(),
      published = await course(authored.version),
      cls = await classroom(),
      student = await seat(cls);
    const delivery = await assign(published.id, cls, [student], 'course01:denominator:' + ++seq);
    const parts = (
      await admin.query(
        'SELECT part.id,part.source_course_enrollment_id AS enrollment FROM activity_participations part JOIN activity_runs run ON run.id=part.activity_run_id WHERE run.source_course_run_id=$1',
        [delivery.run_id],
      )
    ).rows;
    const completion = async () =>
      (
        await admin.query('SELECT learning_course_completion_internal($1) AS value', [
          parts[0].enrollment,
        ])
      ).rows[0].value;
    expect(await completion()).toMatchObject({
      total: 2,
      completedCount: 0,
      completed: false,
      excusedCount: 0,
      resultPolicy: 'no_course_grade',
    });
    for (let i = 0; i < parts.length; i++) {
      const result = (
        await tx((c) =>
          c.query(
            "SELECT * FROM activity_participation_excuse($1,$2,'Индивидуальное освобождение')",
            [principal, parts[i].id],
          ),
        )
      ).rows[0];
      expect(result.result_code).toBe('ok');
      expect(await completion()).toMatchObject({
        total: 1 - i,
        excusedCount: i + 1,
        completed: false,
      });
    }
    expect(await completion()).toMatchObject({ reason: 'no_required_lessons', basisIds: [] });
    expect(
      (
        await admin.query(
          'SELECT id FROM learning_attempts WHERE activity_participation_id=ANY($1::uuid[])',
          [parts.map((p) => p.id)],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it('pins canonical material without a legacy root, materializes repeated blocks, retries and explicit repeat delivery', async () => {
    const authored = await material('three-d');
    const published = await course(authored.version);
    const cls = await classroom();
    const first = await seat(cls);
    const excluded = await seat(cls);
    const delivery = await assign(published.id, cls, [first], 'course01:delivery:' + ++seq);
    expect(delivery).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });
    const rows = await admin.query(
      'SELECT run.id,run.learning_activity_version_id,part.source_course_enrollment_id FROM activity_runs run JOIN activity_participations part ON part.activity_run_id=run.id WHERE run.source_course_run_id=$1',
      [delivery.run_id],
    );
    expect(rows.rows).toHaveLength(2);
    expect(new Set(rows.rows.map((row) => row.id)).size).toBe(2);
    expect(
      rows.rows.every(
        (row) =>
          row.learning_activity_version_id === authored.version && row.source_course_enrollment_id,
      ),
    ).toBe(true);
    expect(
      (await tx((c) => c.query('SELECT * FROM classroom_course_runs_for_seat_v2($1)', [first])))
        .rows,
    ).toHaveLength(2);
    expect(
      (await tx((c) => c.query('SELECT * FROM classroom_course_runs_for_seat_v2($1)', [excluded])))
        .rows,
    ).toHaveLength(0);
    const retried = await assign(published.id, cls, [first], 'course01:delivery:' + seq);
    expect(retried).toMatchObject({ run_id: delivery.run_id, reused: true });
    const repeated = await assign(published.id, cls, [first], 'course01:new-delivery:' + seq);
    expect(repeated.result_code).toBe('ok');
    expect(repeated.run_id).not.toBe(delivery.run_id);
    const source = await admin.query(
      'SELECT source_teacher_assignment_id FROM learning_activities WHERE id=$1',
      [authored.id],
    );
    expect(source.rows[0].source_teacher_assignment_id).toBeNull();
    const frozen = await admin.query(
      "SELECT outline #>> '{sections,0,lessons,0,learningActivityVersionId}' AS pin FROM course_versions WHERE id=$1",
      [published.versionId],
    );
    expect(frozen.rows[0].pin).toBe(authored.version);
    const audience = (
      await app.query('SELECT learning_audience_for_teacher($1,$2,NULL,$3) AS value', [
        account,
        cls,
        delivery.run_id,
      ])
    ).rows[0].value;
    expect(audience.type).toBe('named_learners');
    const change = async (student: string, include: boolean, expected: boolean, key: string) =>
      (
        await app.query(
          "SELECT learning_audience_member_change($1,$2,$3,$4,$5,$6,$7,'Изменение списка курса',$8) AS code",
          [account, principal, cls, audience.id, student, include, expected, key],
        )
      ).rows[0].code;
    const addKey = 'course01:named-add:' + ++seq;
    expect(await change(excluded, true, false, addKey)).toBe('ok');
    expect(await change(excluded, true, false, addKey)).toBe('ok');
    const addedActor = (
      await admin.query('SELECT principal_id FROM student_seat_principal($1)', [excluded])
    ).rows[0].principal_id;
    const notifications = async () =>
      (await app.query('SELECT item FROM learning_notifications_list($1)', [addedActor])).rows.map(
        (row) => row.item,
      );
    const delivered = (await notifications()).filter(
      (item) => item.courseRunId === delivery.run_id,
    );
    expect(delivered).toHaveLength(2);
    expect(
      (await tx((c) => c.query('SELECT * FROM classroom_course_runs_for_seat_v2($1)', [excluded])))
        .rows,
    ).toHaveLength(2);
    const children = await admin.query(
      'SELECT part.id FROM activity_participations part JOIN activity_runs run ON run.id=part.activity_run_id WHERE run.source_course_run_id=$1',
      [delivery.run_id],
    );
    expect(children.rows).toHaveLength(4);
    expect(await change(excluded, false, false, 'course01:named-stale:' + ++seq)).toBe(
      'membership_conflict',
    );
    expect(await change(excluded, false, true, 'course01:named-remove:' + ++seq)).toBe('ok');
    expect(
      (await notifications()).filter((item) => item.courseRunId === delivery.run_id),
    ).toHaveLength(0);
    expect(
      (
        await app.query('SELECT learning_notifications_mark_read($1,$2::uuid[],now()) AS n', [
          addedActor,
          delivered.map((item) => item.id),
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await admin.query('SELECT id FROM learning_notifications WHERE id=ANY($1::uuid[])', [
          delivered.map((item) => item.id),
        ])
      ).rows,
    ).toHaveLength(2);
    expect(
      (await tx((c) => c.query('SELECT * FROM classroom_course_runs_for_seat_v2($1)', [excluded])))
        .rows,
    ).toHaveLength(0);
    expect(await change(excluded, true, false, 'course01:named-rejoin:' + ++seq)).toBe(
      'rejoin_requires_explicit_policy',
    );
    expect(
      (
        await admin.query(
          'SELECT count(*)::integer AS n FROM activity_participations WHERE id=ANY($1::uuid[])',
          [children.rows.map((row) => row.id)],
        )
      ).rows[0].n,
    ).toBe(4);
  });
  it('dynamic late enrollment inherits children; a foreign named seat cannot create a partial run', async () => {
    const authored = await material();
    const published = await course(authored.version);
    const cls = await classroom();
    const delivery = await assign(published.id, cls, [], 'course01:dynamic:' + ++seq);
    expect(delivery.result_code).toBe('ok');
    const late = await seat(cls);
    const enrollment = await admin.query(
      'SELECT enrollment.id FROM course_enrollments enrollment JOIN learner_identity_links link ON link.learner_identity_id=enrollment.learner_identity_id WHERE enrollment.course_run_id=$1 AND link.seat_id=$2',
      [delivery.run_id, late],
    );
    expect(enrollment.rows).toHaveLength(1);
    expect(
      (
        await admin.query(
          'SELECT id FROM activity_participations WHERE source_course_enrollment_id=$1',
          [enrollment.rows[0].id],
        )
      ).rows,
    ).toHaveLength(2);
    const other = await classroom();
    const foreign = await seat(other);
    const rejected = await assign(published.id, cls, [foreign], 'course01:rejected:' + ++seq);
    expect(rejected.result_code).toBe('audience_forbidden');
    const all = await admin.query('SELECT id FROM classroom_course_runs WHERE classroom_id=$1', [
      cls,
    ]);
    expect(all.rows).toHaveLength(1);
    await admin.query("UPDATE classroom_student_seats SET status='removed' WHERE id=$1", [late]);
    expect(
      (
        await admin.query('SELECT status FROM course_enrollments WHERE id=$1', [
          enrollment.rows[0].id,
        ])
      ).rows[0].status,
    ).toBe('withdrawn');
    expect(
      (
        await admin.query(
          'SELECT status FROM activity_participations WHERE source_course_enrollment_id=$1',
          [enrollment.rows[0].id],
        )
      ).rows.map((row) => row.status),
    ).toEqual(['withdrawn', 'withdrawn']);
    expect(
      (await tx((c) => c.query('SELECT * FROM classroom_course_runs_for_seat_v2($1)', [late])))
        .rows,
    ).toHaveLength(0);
  });
  it('class archive/restore preserves history and never reopens a closed run', async () => {
    const authored = await material();
    const published = await course(authored.version);
    const cls = await classroom();
    const student = await seat(cls);
    const delivery = await assign(published.id, cls, [student], 'course01:archive:' + ++seq);
    expect(delivery.result_code).toBe('ok');
    const enrollment = (
      await admin.query(
        'SELECT enrollment.id FROM course_enrollments enrollment JOIN learner_identity_links link ON link.learner_identity_id=enrollment.learner_identity_id WHERE enrollment.course_run_id=$1 AND link.seat_id=$2',
        [delivery.run_id, student],
      )
    ).rows[0].id as string;
    const withdrawn = (
      await tx((c) =>
        c.query('SELECT * FROM course_enrollment_withdraw($1,$2)', [principal, enrollment]),
      )
    ).rows[0];
    expect(withdrawn).toMatchObject({ result_code: 'ok', enrollment_status: 'withdrawn' });
    expect(
      (
        await tx((c) =>
          c.query('SELECT classroom_course_run_set_status($1,$2,$3,$4) AS ok', [
            principal,
            cls,
            delivery.run_id,
            'closed',
          ]),
        )
      ).rows[0].ok,
    ).toBe(true);
    const evidence = async () =>
      (
        await admin.query(
          `SELECT
             (SELECT status FROM classrooms WHERE id=$1) AS classroom_status,
             (SELECT status FROM classroom_course_runs WHERE id=$2) AS run_status,
             (SELECT status FROM course_enrollments WHERE id=$3) AS enrollment_status,
             (SELECT count(*)::integer FROM activity_runs WHERE source_course_run_id=$2) AS activity_runs,
             (SELECT count(*)::integer FROM activity_participations WHERE source_course_enrollment_id=$3) AS participations,
             (SELECT count(*)::integer FROM learning_attempts attempt JOIN activity_participations participation ON participation.id=attempt.activity_participation_id WHERE participation.source_course_enrollment_id=$3) AS attempts,
             (SELECT count(*)::integer FROM classroom_seat_credentials WHERE seat_id=$4) AS credentials`,
          [cls, delivery.run_id, enrollment, student],
        )
      ).rows[0];
    const before = await evidence();
    expect(before).toMatchObject({
      classroom_status: 'active',
      run_status: 'closed',
      enrollment_status: 'withdrawn',
      activity_runs: 2,
      participations: 2,
      attempts: 0,
      credentials: 0,
    });
    expect(
      (
        await app.query('SELECT classroom_management_set_status($1,$2,$3) AS ok', [
          account,
          cls,
          'archived',
        ])
      ).rows[0].ok,
    ).toBe(true);
    expect(await evidence()).toMatchObject({ ...before, classroom_status: 'archived' });
    expect(
      (
        await app.query('SELECT classroom_management_set_status($1,$2,$3) AS ok', [
          account,
          cls,
          'active',
        ])
      ).rows[0].ok,
    ).toBe(true);
    expect(await evidence()).toEqual(before);
  });
});
