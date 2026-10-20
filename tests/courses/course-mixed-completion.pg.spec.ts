import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

// CI only: the shared helpers refuse databases without the isolated _test suffix.
// No test replaces the selected-result resolver or fabricates a completed read.
let admin: pg.Pool;
let app: pg.Pool;
let teacher: SeededTeacher;
let teacherPrincipal: string;
let teacherAccount: string;
const requestId = (action: string) => `mixed:${action}:${randomUUID()}`;
const policy = {
  attemptPolicy: { maxAttempts: 3 },
  resultSelectionPolicy: { mode: 'latest_accepted' },
  completionPolicy: { mode: 'accepted' },
  latePolicy: { mode: 'allow_until_close' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'immediate' },
};
type Completion = {
  completed: boolean;
  total: number;
  completedCount: number;
  lessonCount: number;
  excusedCount: number;
  reason: string;
  basisIds?: string[];
  lessons: Array<{
    lessonId: string;
    completed: boolean;
    materialReadAt: string | null;
    practiceTotal: number;
    practiceCompleted: number;
    excusedPracticeCount: number;
    unresolved: boolean;
    practices: Array<{
      activityRunId: string;
      blockId: string | null;
      required: boolean;
      completed: boolean;
    }>;
  }>;
};

async function tx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  teacher = await seedTeacher(admin, 'mixed-completion');
  const identity = (
    await admin.query(
      'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [teacher.tenantId, teacher.teacherId],
    )
  ).rows[0];
  teacherPrincipal = identity.principal_id;
  teacherAccount = identity.account_id;
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

async function activity(moduleKey = 'electronics', completionMode = 'accepted') {
  const created = (
    await tx(app, (client) =>
      client.query(
        "SELECT * FROM learning_activity_create($1,$2,'school','private','project','Ночник','Создайте проект','completion',NULL,$3::jsonb,$4,NULL,NULL,NULL,$5)",
        [
          teacherPrincipal,
          teacher.tenantId,
          JSON.stringify({ ...policy, completionPolicy: { mode: completionMode } }),
          moduleKey,
          requestId('activity'),
        ],
      ),
    )
  ).rows[0];
  expect(created.result_code).toBe('ok');
  const published = (
    await tx(app, (client) =>
      client.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
        teacherPrincipal,
        teacher.tenantId,
        created.activity_id,
        requestId('publish-activity'),
      ]),
    )
  ).rows[0];
  expect(published.result_code).toBe('ok');
  return published.activity_version_id as string;
}

async function classroom() {
  const id = (
    await admin.query(
      "INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,'Ночник',$4) RETURNING id",
      [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
    )
  ).rows[0].id as string;
  await admin.query(
    "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
    [teacher.tenantId, id, teacher.teacherId, teacherAccount],
  );
  return id;
}

async function learner(classId: string) {
  const accountId = (
    await admin.query(
      "INSERT INTO accounts(email,password_hash,birth_date,country) VALUES('mixed-'||gen_random_uuid()::text||'@test.local','isolated-test-only',DATE '2000-01-01','RU') RETURNING id",
    )
  ).rows[0].id as string;
  await admin.query("INSERT INTO principals(kind,account_id) VALUES('account',$1)", [accountId]);
  const seatId = (
    await admin.query(
      "INSERT INTO classroom_student_seats(tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by,account_id) VALUES($1,$2,'Ученик',$3,$3,true,'active',$4,$5) RETURNING id",
      [teacher.tenantId, classId, `mixed-${randomUUID()}`, teacher.teacherId, accountId],
    )
  ).rows[0].id as string;
  const principalId = (
    await admin.query('SELECT principal_id FROM student_seat_principal($1)', [seatId])
  ).rows[0].principal_id as string;
  return { seatId, accountId, principalId };
}

async function course(versions: string[], kind: 'material' | 'assignment' = 'material') {
  const saved = (
    await tx(app, (client) =>
      client.query(
        "SELECT * FROM course_save_v2($1,$2,NULL,'Ночник',NULL,NULL,'private',NULL,$3)",
        [teacherPrincipal, teacher.tenantId, requestId('course')],
      ),
    )
  ).rows[0];
  const id = saved.id as string;
  expect(id).toBeTruthy();
  const sectionId = (
    await tx(app, (client) =>
      client.query('SELECT * FROM course_outline_v3($1,$2,$3,$4)', [
        id,
        teacherPrincipal,
        teacherAccount,
        teacher.tenantId,
      ]),
    )
  ).rows[0].section_id as string;
  const blocks = [
    { id: 'theory', type: 'paragraph', text: 'Прочитайте схему и создайте корпус.' },
    ...versions.map((version, index) => ({
      id: `practice-${index}`,
      type: 'activity',
      learningActivityVersionId: version,
    })),
  ];
  const lessonId = (
    await tx(app, (client) =>
      client.query(
        "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Один урок',NULL,$4::jsonb,$5,NULL,15,$6) AS id",
        [
          teacherPrincipal,
          id,
          sectionId,
          JSON.stringify(kind === 'material' ? blocks : []),
          kind,
          kind === 'assignment' ? versions[0] : null,
        ],
      ),
    )
  ).rows[0].id as string;
  const published = (
    await admin.query('SELECT * FROM course_publish($1,$2)', [teacherPrincipal, id])
  ).rows[0];
  expect(published.version_number).toBe(1);
  return { id, lessonId, sectionId, blocks, versionId: published.version_id as string };
}

async function assign(courseId: string, classId: string, seatId: string, version = 1) {
  const assigned = (
    await tx(app, (client) =>
      client.query(
        "SELECT * FROM classroom_course_run_assign_v3($1,$2,$3,NULL,$4,'named_learners',$5::uuid[],$6)",
        [teacherPrincipal, classId, courseId, version, [seatId], requestId('assign')],
      ),
    )
  ).rows[0];
  expect(assigned.result_code).toBe('ok');
  const runId = assigned.run_id as string;
  const lessonId = (
    await admin.query('SELECT id FROM classroom_course_run_lessons WHERE run_id=$1', [runId])
  ).rows[0].id as string;
  const enrollmentId = (
    await admin.query('SELECT id FROM course_enrollments WHERE course_run_id=$1', [runId])
  ).rows[0].id as string;
  const parts = (
    await admin.query(
      `SELECT run.id AS run_id, run.source_course_block_id AS block_id, part.id AS participation_id
       FROM activity_runs run JOIN activity_participations part ON part.activity_run_id=run.id
      WHERE run.source_course_run_id=$1 ORDER BY run.source_course_block_id`,
      [runId],
    )
  ).rows as Array<{ run_id: string; block_id: string | null; participation_id: string }>;
  return { runId, lessonId, enrollmentId, parts };
}

async function projection(student: Awaited<ReturnType<typeof learner>>, runId: string) {
  const seat = (
    await tx(app, (c) =>
      c.query('SELECT * FROM learning_course_completions_for_seat($1)', [student.seatId]),
    )
  ).rows;
  const account = (
    await tx(app, (c) =>
      c.query('SELECT * FROM learning_course_completions_for_account($1)', [student.accountId]),
    )
  ).rows;
  const byRun = (left: { run_id: string }, right: { run_id: string }) =>
    left.run_id.localeCompare(right.run_id);
  expect(account.sort(byRun)).toEqual(seat.sort(byRun));
  const result = seat.find((row) => row.run_id === runId)?.completion as Completion | undefined;
  if (result) expect(result).not.toHaveProperty('basisIds');
  return result;
}

async function read(
  student: Awaited<ReturnType<typeof learner>>,
  delivery: Awaited<ReturnType<typeof assign>>,
  completed = true,
  account = false,
) {
  const fn = account
    ? 'classroom_course_material_progress_set_for_account'
    : 'classroom_course_material_progress_set';
  return (
    await tx(app, (c) =>
      c.query(`SELECT * FROM ${fn}($1,$2,$3,$4)`, [
        account ? student.accountId : student.seatId,
        delivery.runId,
        delivery.lessonId,
        completed,
      ]),
    )
  ).rows[0];
}

async function start(student: Awaited<ReturnType<typeof learner>>, activityRunId: string) {
  // Seed Project Core's two fresh rows in the same transaction; all admission,
  // immutable origin and Attempt writes still go through the production commands.
  return tx(admin, async (client) => {
    const request = requestId('start');
    const admission = (
      await client.query('SELECT * FROM learning_work_start_admit($1,$2,$3)', [
        student.principalId,
        activityRunId,
        request,
      ])
    ).rows[0];
    expect(admission.result_code).toBe('ok');
    let projectId = admission.existing_project_id as string | null;
    if (!projectId) {
      projectId = (
        await client.query(
          "INSERT INTO projects(tenant_id,project_scope,module_key,title,owner_principal_id,idempotency_key) VALUES($1,'personal',$2,'Проект ночника',$3,$4) RETURNING id",
          [
            admission.project_tenant_id,
            admission.module_key,
            student.principalId,
            `learning:${admission.participation_id}`,
          ],
        )
      ).rows[0].id as string;
      await client.query(
        'INSERT INTO project_drafts(tenant_id,project_id,document_json,revision,updated_by_principal_id) VALUES($1,$2,$3::jsonb,1,$4)',
        [
          admission.project_tenant_id,
          projectId,
          JSON.stringify(
            admission.module_key === 'electronics'
              ? {
                  schemaVersion: 1,
                  components: [{ id: 'resistor', type: 'resistor' }],
                  connections: [],
                }
              : { schemaVersion: 1, objects: [{ id: 'box', type: 'box' }] },
          ),
          student.principalId,
        ],
      );
    }
    const started = (
      await client.query('SELECT * FROM learning_work_start_complete($1,$2,$3,$4)', [
        student.principalId,
        activityRunId,
        request,
        projectId,
      ])
    ).rows[0];
    expect(started.result_code).toBe('ok');
    return { projectId: projectId!, attemptId: started.attempt_id as string };
  });
}

async function submit(student: Awaited<ReturnType<typeof learner>>, projectId: string) {
  const submitted = (
    await tx(app, (c) =>
      c.query('SELECT * FROM learning_origin_project_submission_create($1,$2,$3,1)', [
        student.principalId,
        projectId,
        requestId('submit'),
      ]),
    )
  ).rows[0];
  expect(submitted.result_code).toBe('ok');
  return submitted;
}

async function review(
  classId: string,
  attemptId: string,
  decision = 'accepted',
  prior: string | null = null,
) {
  const reviewed = (
    await tx(app, (c) =>
      c.query('SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9)', [
        teacherAccount,
        teacherPrincipal,
        classId,
        attemptId,
        decision,
        'Проверьте соединение.',
        'Проверка проекта',
        prior,
        requestId('review'),
      ]),
    )
  ).rows[0];
  expect(reviewed.result_code).toBe('ok');
  return reviewed;
}

describe('INT-E1-15 pinned mixed lesson completion', () => {
  it('requires reading and both exact accepted practices, preserves review history, and agrees for Seat/Account', async () => {
    // An old representable submission/manual policy still needs the existing
    // selected accepted result; submitting alone must not turn the lesson green.
    const published = await course([
      await activity('electronics', 'submission'),
      await activity('three-d'),
    ]);
    const classId = await classroom();
    const student = await learner(classId);
    const delivery = await assign(published.id, classId, student.seatId);
    const get = async () => (await projection(student, delivery.runId))!;
    expect(await get()).toMatchObject({
      total: 1,
      lessonCount: 1,
      completedCount: 0,
      completed: false,
      lessons: [{ practiceTotal: 2, practiceCompleted: 0, materialReadAt: null }],
    });
    const firstRead = await read(student, delivery);
    expect(firstRead.result_code).toBe('ok');
    expect(await read(student, delivery, true, true)).toEqual(firstRead);
    expect(await get()).toMatchObject({ completed: false, completedCount: 0 });
    expect(
      (
        await admin.query(
          'SELECT id FROM learning_attempts WHERE activity_participation_id=ANY($1::uuid[])',
          [delivery.parts.map((p) => p.participation_id)],
        )
      ).rows,
    ).toHaveLength(0);
    const first = await start(student, delivery.parts[0]!.run_id);
    const second = await start(student, delivery.parts[1]!.run_id);
    expect(first.projectId).not.toBe(second.projectId);
    await submit(student, first.projectId);
    await submit(student, second.projectId);
    expect(await get()).toMatchObject({ completed: false, lessons: [{ practiceCompleted: 0 }] });
    const accepted = await review(classId, first.attemptId);
    expect(await get()).toMatchObject({
      completed: false,
      completedCount: 0,
      lessons: [{ practiceTotal: 2, practiceCompleted: 1 }],
    });
    await review(classId, second.attemptId, 'changes_requested');
    const revision = await start(student, delivery.parts[1]!.run_id);
    expect(revision.projectId).toBe(second.projectId);
    expect(revision.attemptId).not.toBe(second.attemptId);
    await submit(student, revision.projectId);
    expect(await get()).toMatchObject({ completed: false, lessons: [{ practiceCompleted: 1 }] });
    const acceptedSecond = await review(classId, revision.attemptId);
    expect(await get()).toMatchObject({
      completed: true,
      total: 1,
      completedCount: 1,
      lessons: [{ completed: true, practiceCompleted: 2 }],
    });
    const historyBefore = (
      await admin.query(
        'SELECT to_jsonb(result) AS value FROM assessment_results result WHERE attempt_id=ANY($1::uuid[]) ORDER BY id',
        [[first.attemptId, second.attemptId, revision.attemptId]],
      )
    ).rows;
    await read(student, delivery, false, true);
    expect(await get()).toMatchObject({
      completed: false,
      lessons: [{ materialReadAt: null, practiceCompleted: 2 }],
    });
    await read(student, delivery);
    const internal = (
      await admin.query('SELECT learning_course_completion_internal($1) AS value', [
        delivery.enrollmentId,
      ])
    ).rows[0].value as Completion;
    expect(internal.basisIds).toEqual(
      expect.arrayContaining([accepted.assessment_result_id, acceptedSecond.assessment_result_id]),
    );
    expect(
      (
        await admin.query(
          'SELECT to_jsonb(result) AS value FROM assessment_results result WHERE attempt_id=ANY($1::uuid[]) ORDER BY id',
          [[first.attemptId, second.attemptId, revision.attemptId]],
        )
      ).rows,
    ).toEqual(historyBefore);
    expect(await get()).toMatchObject({ completed: true });
  });

  it('counts repeated pins separately and keeps an old version required when the new draft hides one', async () => {
    const version = await activity();
    const published = await course([version, version]);
    const classId = await classroom();
    const student = await learner(classId);
    const delivery = await assign(published.id, classId, student.seatId);
    expect(delivery.parts).toHaveLength(2);
    expect(new Set(delivery.parts.map((p) => p.run_id)).size).toBe(2);
    await read(student, delivery);
    const first = await start(student, delivery.parts[0]!.run_id);
    await submit(student, first.projectId);
    await review(classId, first.attemptId);
    const outlineBefore = (
      await admin.query('SELECT outline FROM course_versions WHERE id=$1', [published.versionId])
    ).rows[0].outline;
    const changed = published.blocks.map((block) =>
      block.id === 'practice-1' ? { ...block, hidden: true } : block,
    );
    await tx(app, (c) =>
      c.query(
        "SELECT course_lesson_save_v3($1,$2,$3,$4,$5,NULL,$6::jsonb,'material',NULL,15,NULL)",
        [
          teacherPrincipal,
          published.id,
          published.sectionId,
          published.lessonId,
          'Один урок',
          JSON.stringify(changed),
        ],
      ),
    );
    const secondVersion = (
      await admin.query('SELECT * FROM course_publish($1,$2)', [teacherPrincipal, published.id])
    ).rows[0];
    expect(secondVersion.version_number).toBe(2);
    const newDelivery = await assign(published.id, classId, student.seatId, 2);
    expect(newDelivery.parts).toHaveLength(1);
    expect(await projection(student, delivery.runId)).toMatchObject({
      completed: false,
      lessons: [{ practiceTotal: 2, practiceCompleted: 1 }],
    });
    expect(await projection(student, newDelivery.runId)).toMatchObject({
      completed: false,
      lessons: [{ practiceTotal: 1, practiceCompleted: 0 }],
    });
    expect(
      (await admin.query('SELECT outline FROM course_versions WHERE id=$1', [published.versionId]))
        .rows[0].outline,
    ).toEqual(outlineBefore);
  });

  it('excludes excused and withdrawn practice without making a zero-required course complete', async () => {
    const published = await course([await activity(), await activity('three-d')]);
    const classId = await classroom();
    const student = await learner(classId);
    const delivery = await assign(published.id, classId, student.seatId);
    expect(
      (
        await tx(app, (c) =>
          c.query('SELECT * FROM activity_participation_excuse($1,$2,$3)', [
            teacherPrincipal,
            delivery.parts[0]!.participation_id,
            'Освобождён',
          ]),
        )
      ).rows[0].result_code,
    ).toBe('ok');
    expect(
      (
        await tx(app, (c) =>
          c.query('SELECT * FROM activity_participation_withdraw($1,$2)', [
            teacherPrincipal,
            delivery.parts[1]!.participation_id,
          ]),
        )
      ).rows[0].result_code,
    ).toBe('ok');
    expect(await projection(student, delivery.runId)).toMatchObject({
      total: 1,
      completed: false,
      lessons: [{ practiceTotal: 0, excusedPracticeCount: 1 }],
    });
    await read(student, delivery);
    expect(await projection(student, delivery.runId)).toMatchObject({ completed: true });
    const assignment = await course([await activity()], 'assignment');
    const zero = await assign(assignment.id, classId, student.seatId);
    expect(
      (
        await tx(app, (c) =>
          c.query('SELECT * FROM activity_participation_excuse($1,$2,$3)', [
            teacherPrincipal,
            zero.parts[0]!.participation_id,
            'Освобождён',
          ]),
        )
      ).rows[0].result_code,
    ).toBe('ok');
    expect(await projection(student, zero.runId)).toMatchObject({
      total: 0,
      completed: false,
      reason: 'no_required_lessons',
      excusedCount: 1,
    });
  });

  it('supports pure theory and denies named, inactive and withdrawn learners for both identities', async () => {
    const published = await course([]);
    const classId = await classroom();
    const student = await learner(classId);
    const excluded = await learner(classId);
    const delivery = await assign(published.id, classId, student.seatId);
    expect(await projection(excluded, delivery.runId)).toBeUndefined();
    for (const account of [false, true])
      expect((await read(excluded, delivery, true, account)).result_code).toBe('lesson_not_found');
    expect(await projection(student, delivery.runId)).toMatchObject({
      completed: false,
      lessons: [{ practiceTotal: 0 }],
    });
    await read(student, delivery);
    expect(await projection(student, delivery.runId)).toMatchObject({
      completed: true,
      completedCount: 1,
    });
    await admin.query("UPDATE classroom_student_seats SET status='suspended' WHERE id=$1", [
      student.seatId,
    ]);
    expect(await projection(student, delivery.runId)).toBeUndefined();
    for (const account of [false, true])
      expect((await read(student, delivery, true, account)).result_code).toBe('lesson_not_found');
    await admin.query("UPDATE classroom_student_seats SET status='active' WHERE id=$1", [
      student.seatId,
    ]);
    expect(
      (
        await tx(app, (c) =>
          c.query('SELECT * FROM course_enrollment_withdraw($1,$2)', [
            teacherPrincipal,
            delivery.enrollmentId,
          ]),
        )
      ).rows[0].result_code,
    ).toBe('ok');
    expect(await projection(student, delivery.runId)).toBeUndefined();
    expect(
      (
        await admin.query(
          'SELECT completed_at FROM classroom_course_lesson_progress WHERE lesson_id=$1',
          [delivery.lessonId],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it('cannot invent optional requirements or treat an unproven legacy pin as complete', async () => {
    const version = await activity();
    expect(
      (
        await admin.query('SELECT course_lesson_blocks_valid($1::jsonb) AS valid', [
          JSON.stringify([
            {
              id: 'optional',
              type: 'activity',
              learningActivityVersionId: version,
              optional: true,
            },
          ]),
        ])
      ).rows[0].valid,
    ).toBe(false);
    const published = await course([version]);
    const classId = await classroom();
    const student = await learner(classId);
    const delivery = await assign(published.id, classId, student.seatId);
    await read(student, delivery);
    // A copied historical run lesson can have no provable source in its pinned
    // snapshot. Construct that isolated fixture without changing the version or
    // existing Attempts/Results: the read stays visible, completion stays unknown.
    const oldSource = (
      await admin.query('SELECT source_lesson_id FROM classroom_course_run_lessons WHERE id=$1', [
        delivery.lessonId,
      ])
    ).rows[0].source_lesson_id;
    await admin.query('UPDATE classroom_course_run_lessons SET source_lesson_id=$2 WHERE id=$1', [
      delivery.lessonId,
      randomUUID(),
    ]);
    expect(await projection(student, delivery.runId)).toMatchObject({
      completed: false,
      reason: 'completion_unresolved',
      lessons: [{ completed: false, unresolved: true }],
    });
    await admin.query('UPDATE classroom_course_run_lessons SET source_lesson_id=$2 WHERE id=$1', [
      delivery.lessonId,
      oldSource,
    ]);
    expect(await projection(student, delivery.runId)).toMatchObject({
      completed: false,
      lessons: [{ unresolved: false, practiceTotal: 1 }],
    });
  });
});
