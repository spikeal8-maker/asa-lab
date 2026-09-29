import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

const policies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};

let admin: pg.Pool;
let app: pg.Pool;
let owner: SeededTeacher;
let principal: string;
let account: string;
let sequence = 0;

async function inTenant<T>(callback: (client: pg.PoolClient) => Promise<T>) {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [owner.tenantId]);
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

async function classroom() {
  const created = await admin.query(
    `INSERT INTO classrooms (tenant_id,school_id,academic_period_id,title,created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [owner.tenantId, owner.schoolId, owner.periodId, `VS class ${++sequence}`, owner.teacherId],
  );
  await admin.query(
    `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES ($1,$2,$3,$4,'owner')`,
    [owner.tenantId, created.rows[0].id, owner.teacherId, account],
  );
  return created.rows[0].id as string;
}

async function seat(classroomId: string, label: string) {
  const handle = `vs-${++sequence}`;
  return (
    await admin.query(
      `INSERT INTO classroom_student_seats
         (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
          safe_mode,status,created_by)
       VALUES ($1,$2,$3,$4,$4,true,'issued',$5) RETURNING id`,
      [owner.tenantId, classroomId, label, handle, owner.teacherId],
    )
  ).rows[0].id as string;
}

async function activity(title: string) {
  const authored = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES ($1,$2,$3,'Соберите цепь.','electronics','private') RETURNING id`,
    [owner.tenantId, principal, title],
  );
  const created = await inTenant((client) =>
    client.query(
      `SELECT * FROM learning_activity_create(
       $1,$2,'school','private','project',$3,'ignored','completion',NULL,
       $4::jsonb,'electronics',NULL,NULL,$5,$6)`,
      [
        principal,
        owner.tenantId,
        title,
        JSON.stringify(policies),
        authored.rows[0].id,
        `vs:create:${++sequence}`,
      ],
    ),
  );
  const published = await inTenant((client) =>
    client.query(`SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)`, [
      principal,
      owner.tenantId,
      created.rows[0].activity_id,
      `vs:publish:${++sequence}`,
    ]),
  );
  return published.rows[0].activity_version_id as string;
}

async function assign(input: {
  classroomId: string;
  versionId: string;
  audience: 'whole_class' | 'named_learners';
  seats?: string[];
  request?: string;
}) {
  return inTenant(async (client) => {
    const result = await client.query(
      `SELECT * FROM learning_direct_assignment_create(
       $1,$2,$3,$4,'2026-09-30T20:59:00Z',$5,$6::uuid[],$7)`,
      [
        principal,
        owner.tenantId,
        input.classroomId,
        input.versionId,
        input.audience,
        input.seats ?? [],
        input.request ?? `vs:assign:${++sequence}`,
      ],
    );
    return result.rows[0] as Record<string, unknown>;
  });
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'learning-vs-001');
  const identity = await admin.query(
    `SELECT account_id,principal_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [owner.tenantId, owner.teacherId],
  );
  account = identity.rows[0].account_id as string;
  principal = identity.rows[0].principal_id as string;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('LRN-VS-001 canonical direct assignment', () => {
  it('does not certify an LAV-backed Direct assignment with no Run as historical work', async () => {
    const classId = await classroom();
    const learnerSeat = await seat(classId, 'No-run learner');
    await admin.query(`UPDATE classroom_student_seats SET status='active' WHERE id=$1`, [
      learnerSeat,
    ]);
    const versionId = await activity('Pinned version without Run');
    const assignment = await admin.query(
      `INSERT INTO classroom_assignments
         (tenant_id,classroom_id,module_key,created_by,learning_activity_version_id)
       VALUES ($1,$2,'electronics',$3,$4) RETURNING id`,
      [owner.tenantId, classId, owner.teacherId, versionId],
    );
    const seatPrincipal = (
      await admin.query(`SELECT principal_id FROM student_seat_principal($1)`, [learnerSeat])
    ).rows[0].principal_id;
    const proof = await inTenant((client) =>
      client.query(`SELECT learning_legacy_direct_provenance($1,$2,$3,NULL) AS proof`, [
        seatPrincipal,
        learnerSeat,
        assignment.rows[0].id,
      ]),
    );
    expect(proof.rows[0].proof).toMatchObject({
      legacyDirect: false,
      legacyCourseLesson: false,
      legacyProjectReadable: false,
      startAllowed: false,
      submitAllowed: false,
    });
  });

  it('proves an old Direct handout without a run, then only its linked historical Project', async () => {
    const classId = await classroom();
    const learnerSeat = await seat(classId, 'Исторический ученик');
    const otherSeat = await seat(classId, 'Другой ученик');
    await admin.query(
      `UPDATE classroom_student_seats SET status='active' WHERE id=ANY($1::uuid[])`,
      [[learnerSeat, otherSeat]],
    );
    const task = await admin.query(
      `INSERT INTO teacher_assignments
         (tenant_id,owner_principal_id,title,brief,module_key,visibility)
       VALUES ($1,$2,'Старое задание','Соберите цепь.','electronics','private') RETURNING id`,
      [owner.tenantId, principal],
    );
    await inTenant((client) =>
      client.query(`SELECT teacher_assignment_hand_out($1,$2,$3,true,NULL)`, [
        principal,
        task.rows[0].id,
        classId,
      ]),
    );
    const assignmentId = (
      await admin.query(
        `SELECT id FROM classroom_assignments WHERE classroom_id=$1 AND assignment_id=$2`,
        [classId, task.rows[0].id],
      )
    ).rows[0].id as string;
    const learnerPrincipal = (
      await admin.query(`SELECT principal_id FROM student_seat_principal($1)`, [learnerSeat])
    ).rows[0].principal_id as string;
    const otherPrincipal = (
      await admin.query(`SELECT principal_id FROM student_seat_principal($1)`, [otherSeat])
    ).rows[0].principal_id as string;
    const proof = async (actor: string, seatId: string, projectId: string | null) =>
      (
        await inTenant((client) =>
          client.query(`SELECT learning_legacy_direct_provenance($1,$2,$3,$4) AS proof`, [
            actor,
            seatId,
            assignmentId,
            projectId,
          ]),
        )
      ).rows[0].proof as {
        legacyDirect: boolean;
        legacyCourseLesson: boolean;
        legacyProjectReadable: boolean;
        startAllowed: boolean;
        submitAllowed: boolean;
      };
    expect(await proof(learnerPrincipal, learnerSeat, null)).toMatchObject({
      legacyDirect: true,
      legacyCourseLesson: false,
      legacyProjectReadable: false,
      startAllowed: true,
      submitAllowed: false,
    });
    expect(await proof(otherPrincipal, learnerSeat, null)).toMatchObject({
      startAllowed: false,
      submitAllowed: false,
    });
    // Fixture setup uses the privileged test owner; asalab_app must not gain
    // EXECUTE on the internal identity helper.
    await admin.query(`SELECT learning_audience_ensure_seat_identity($1)`, [learnerSeat]);
    const identity = await admin.query(
      `SELECT learner_identity_id FROM learner_identity_links
        WHERE seat_id=$1 AND link_kind='student_seat'`,
      [learnerSeat],
    );
    await admin.query(`UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2`, [
      account,
      learnerSeat,
    ]);
    await admin.query(
      `INSERT INTO learner_identity_links
         (id,tenant_id,school_id,learner_identity_id,link_kind,account_id)
       VALUES (gen_random_uuid(),$1,$2,$3,'account',$4)`,
      [owner.tenantId, owner.schoolId, identity.rows[0].learner_identity_id, account],
    );
    const accountProject = await admin.query(
      `INSERT INTO projects (tenant_id,project_scope,module_key,title,owner_principal_id)
       VALUES ($1,'personal','electronics','Account generic work',$2) RETURNING id`,
      [owner.tenantId, principal],
    );
    expect(await proof(principal, learnerSeat, accountProject.rows[0].id)).toMatchObject({
      legacyDirect: true,
      startAllowed: false,
      submitAllowed: false,
    });
    const projectId = (
      await admin.query(
        `INSERT INTO projects (tenant_id,project_scope,module_key,title,owner_principal_id)
       VALUES ($1,'personal','electronics','Историческая работа',$2) RETURNING id`,
        [owner.tenantId, learnerPrincipal],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO project_drafts
         (tenant_id,project_id,document_json,revision,updated_by_principal_id)
       VALUES ($1,$2,'{"schemaVersion":1,"components":[]}'::jsonb,1,$3)`,
      [owner.tenantId, projectId, learnerPrincipal],
    );
    const linked = await inTenant(async (client) => {
      const locked = await client.query(
        `SELECT learning_legacy_assignment_write_provenance($1,$2,$3,$4) AS proof`,
        [learnerPrincipal, learnerSeat, assignmentId, projectId],
      );
      expect(locked.rows[0].proof).toMatchObject({
        legacyDirect: true,
        startAllowed: true,
      });
      return client.query(`SELECT * FROM classroom_assignment_work_start($1,$2,$3)`, [
        learnerSeat,
        assignmentId,
        projectId,
      ]);
    });
    expect(linked.rows[0].project_id).toBe(projectId);
    expect(await proof(learnerPrincipal, learnerSeat, projectId)).toMatchObject({
      legacyDirect: true,
      legacyProjectReadable: true,
      startAllowed: false,
      submitAllowed: true,
    });
    expect(await proof(otherPrincipal, learnerSeat, projectId)).toMatchObject({
      startAllowed: false,
      submitAllowed: false,
    });
    await admin.query(
      `UPDATE learner_identity_links SET status='inactive',disabled_at=now()
        WHERE seat_id=$1 AND link_kind='student_seat'`,
      [learnerSeat],
    );
    expect(await proof(learnerPrincipal, learnerSeat, projectId)).toMatchObject({
      legacyProjectReadable: false,
      startAllowed: false,
      submitAllowed: false,
    });
    const lockedAfterRevocation = await inTenant((client) =>
      client.query(`SELECT learning_legacy_assignment_write_provenance($1,$2,$3,$4) AS proof`, [
        learnerPrincipal,
        learnerSeat,
        assignmentId,
        projectId,
      ]),
    );
    expect(lockedAfterRevocation.rows[0].proof).toMatchObject({
      legacyProjectReadable: false,
      submitAllowed: false,
    });
    await expect(
      inTenant((client) => client.query(`SELECT * FROM activity_runs LIMIT 1`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('proves only a readable historical Course lesson Project and withdraws Submit with its Seat link', async () => {
    const classId = await classroom();
    const learnerSeat = await seat(classId, 'Course learner');
    const wrongSeat = await seat(classId, 'Wrong learner');
    await admin.query(
      `UPDATE classroom_student_seats SET status='active' WHERE id=ANY($1::uuid[])`,
      [[learnerSeat, wrongSeat]],
    );
    const course = await admin.query(
      `INSERT INTO courses (tenant_id,owner_principal_id,title,visibility)
       VALUES ($1,$2,'Old course','private') RETURNING id`,
      [owner.tenantId, principal],
    );
    const version = await admin.query(
      `INSERT INTO course_versions
         (tenant_id,course_id,version_number,title,outline,content_hash,published_by_principal_id)
       VALUES ($1,$2,1,'Old course','{"sections":[]}'::jsonb,$3,$4) RETURNING id`,
      [owner.tenantId, course.rows[0].id, `old-course-${++sequence}`, principal],
    );
    const run = await admin.query(
      `INSERT INTO classroom_course_runs
         (tenant_id,classroom_id,course_id,course_version_id,title,version_number,assigned_by_principal_id)
       VALUES ($1,$2,$3,$4,'Old course',1,$5) RETURNING id`,
      [owner.tenantId, classId, course.rows[0].id, version.rows[0].id, principal],
    );
    const handout = await admin.query(
      `INSERT INTO classroom_assignments
         (tenant_id,classroom_id,status,created_by,course_run_id)
       VALUES ($1,$2,'open',$3,$4) RETURNING id`,
      [owner.tenantId, classId, owner.teacherId, run.rows[0].id],
    );
    await admin.query(
      `INSERT INTO classroom_course_run_lessons
         (tenant_id,run_id,source_section_id,source_lesson_id,section_title,section_position,
          title,kind,lesson_position,classroom_assignment_id,assignment_title,assignment_brief,module_key)
       VALUES ($1,$2,gen_random_uuid(),gen_random_uuid(),'Section',1,'Work','assignment',1,
               $3,'Work','Build it','electronics')`,
      [owner.tenantId, run.rows[0].id, handout.rows[0].id],
    );
    const learnerPrincipal = (
      await admin.query(`SELECT principal_id FROM student_seat_principal($1)`, [learnerSeat])
    ).rows[0].principal_id as string;
    const wrongPrincipal = (
      await admin.query(`SELECT principal_id FROM student_seat_principal($1)`, [wrongSeat])
    ).rows[0].principal_id as string;
    const projectId = (
      await admin.query(
        `INSERT INTO projects (tenant_id,project_scope,module_key,title,owner_principal_id)
         VALUES ($1,'personal','electronics','Old course work',$2) RETURNING id`,
        [owner.tenantId, learnerPrincipal],
      )
    ).rows[0].id as string;
    const proof = async (actor: string, seatId: string) =>
      (
        await inTenant((client) =>
          client.query(`SELECT learning_legacy_direct_provenance($1,$2,$3,$4) AS proof`, [
            actor,
            seatId,
            handout.rows[0].id,
            projectId,
          ]),
        )
      ).rows[0].proof as Record<string, boolean>;
    expect(await proof(learnerPrincipal, learnerSeat)).toMatchObject({
      legacyDirect: false,
      legacyCourseLesson: true,
      legacyProjectReadable: false,
      startAllowed: true,
      submitAllowed: false,
    });
    await inTenant((client) =>
      client.query(`SELECT * FROM classroom_assignment_work_start($1,$2,$3)`, [
        learnerSeat,
        handout.rows[0].id,
        projectId,
      ]),
    );
    expect(await proof(learnerPrincipal, learnerSeat)).toMatchObject({
      legacyProjectReadable: true,
      submitAllowed: false,
    });
    await admin.query(
      `INSERT INTO project_drafts
         (tenant_id,project_id,document_json,revision,updated_by_principal_id)
       VALUES ($1,$2,'{"schemaVersion":1,"components":[]}'::jsonb,1,$3)`,
      [owner.tenantId, projectId, learnerPrincipal],
    );
    expect(await proof(learnerPrincipal, learnerSeat)).toMatchObject({
      legacyProjectReadable: true,
      submitAllowed: true,
    });
    await admin.query(`UPDATE classroom_course_runs SET status='closed' WHERE id=$1`, [
      run.rows[0].id,
    ]);
    expect(await proof(learnerPrincipal, learnerSeat)).toMatchObject({
      legacyCourseLesson: true,
      legacyProjectReadable: true,
      startAllowed: false,
      submitAllowed: false,
    });
    await admin.query(`UPDATE classroom_course_runs SET status='open' WHERE id=$1`, [
      run.rows[0].id,
    ]);
    expect(await proof(wrongPrincipal, wrongSeat)).toMatchObject({
      legacyProjectReadable: false,
      submitAllowed: false,
    });
    await admin.query(`SELECT learning_audience_ensure_seat_identity($1)`, [learnerSeat]);
    await admin.query(
      `UPDATE learner_identity_links SET status='inactive',disabled_at=now()
       WHERE seat_id=$1 AND link_kind='student_seat'`,
      [learnerSeat],
    );
    expect(await proof(learnerPrincipal, learnerSeat)).toMatchObject({
      legacyProjectReadable: false,
      submitAllowed: false,
    });
    await admin.query(
      `UPDATE learner_identity_links SET status='active',disabled_at=NULL
       WHERE seat_id=$1 AND link_kind='student_seat'`,
      [learnerSeat],
    );
    expect(await proof(learnerPrincipal, learnerSeat)).toMatchObject({
      legacyCourseLesson: true,
      legacyProjectReadable: true,
      submitAllowed: true,
    });
    const pinnedVersion = await activity('Course lesson pinned without Run');
    await admin.query(
      `UPDATE classroom_assignments SET learning_activity_version_id=$1 WHERE id=$2`,
      [pinnedVersion, handout.rows[0].id],
    );
    expect(await proof(learnerPrincipal, learnerSeat)).toMatchObject({
      legacyCourseLesson: false,
      legacyProjectReadable: false,
      submitAllowed: false,
    });
  }, 30_000);

  it('assigns one published activity to the whole class and exposes every eligible seat', async () => {
    const classId = await classroom();
    const seats = await Promise.all([
      seat(classId, 'Анна'),
      seat(classId, 'Борис'),
      seat(classId, 'Вера'),
    ]);
    const version = await activity('Светодиод и резистор');
    const request = `vs:whole:${++sequence}`;
    const first = await assign({
      classroomId: classId,
      versionId: version,
      audience: 'whole_class',
      request,
    });
    const retry = await assign({
      classroomId: classId,
      versionId: version,
      audience: 'whole_class',
      request,
    });
    expect(first).toMatchObject({ result_code: 'ok', assigned_count: 3, reused: false });
    expect(retry).toMatchObject({
      result_code: 'ok',
      classroom_assignment_id: first.classroom_assignment_id,
      reused: true,
    });
    for (const seatId of seats) {
      const visibility = await inTenant((client) =>
        client.query(`SELECT * FROM learning_direct_assignment_visibility_for_seat($1)`, [seatId]),
      );
      expect(visibility.rows).toEqual([
        { classroom_assignment_id: first.classroom_assignment_id, visible: true },
      ]);
    }
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM activity_runs
            WHERE source_classroom_assignment_id=$1`,
          [first.classroom_assignment_id],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it('assigns to exactly two named learners and hides the assignment from the third', async () => {
    const classId = await classroom();
    const first = await seat(classId, 'Галя');
    const second = await seat(classId, 'Дима');
    const third = await seat(classId, 'Егор');
    const version = await activity('Точная цепь');
    await admin.query(`UPDATE classroom_student_seats SET status='active' WHERE id=$1`, [third]);
    const source = await admin.query(
      `SELECT activity.source_teacher_assignment_id
         FROM learning_activity_versions version
         JOIN learning_activities activity ON activity.id=version.activity_id
        WHERE version.id=$1`,
      [version],
    );
    await inTenant((client) =>
      client.query(`SELECT teacher_assignment_hand_out($1,$2,$3,true,NULL)`, [
        principal,
        source.rows[0].source_teacher_assignment_id,
        classId,
      ]),
    );
    const handout = await admin.query(
      `SELECT id FROM classroom_assignments WHERE classroom_id=$1 AND assignment_id=$2`,
      [classId, source.rows[0].source_teacher_assignment_id],
    );
    const learner = await admin.query(`SELECT principal_id FROM student_seat_principal($1)`, [
      third,
    ]);
    const project = await admin.query(
      `INSERT INTO projects
         (tenant_id,project_scope,classroom_id,module_key,title,owner_principal_id)
       VALUES ($1,'classroom',$2,'electronics','Старая работа',$3) RETURNING id`,
      [owner.tenantId, classId, learner.rows[0].principal_id],
    );
    await admin.query(
      `INSERT INTO project_drafts
         (tenant_id,project_id,document_json,revision,updated_by_principal_id)
       VALUES ($1,$2,'{"schemaVersion":1,"components":[]}'::jsonb,1,$3)`,
      [owner.tenantId, project.rows[0].id, learner.rows[0].principal_id],
    );
    await inTenant((client) =>
      client.query(`SELECT * FROM classroom_assignment_work_start($1,$2,$3)`, [
        third,
        handout.rows[0].id,
        project.rows[0].id,
      ]),
    );
    const result = await assign({
      classroomId: classId,
      versionId: version,
      audience: 'named_learners',
      seats: [first, second],
    });
    expect(result).toMatchObject({ result_code: 'ok', assigned_count: 2 });
    const visible = async (seatId: string) =>
      (
        await inTenant((client) =>
          client.query(`SELECT visible FROM learning_direct_assignment_visibility_for_seat($1)`, [
            seatId,
          ]),
        )
      ).rows[0].visible as boolean;
    await expect(visible(first)).resolves.toBe(true);
    await expect(visible(second)).resolves.toBe(true);
    await expect(visible(third)).resolves.toBe(false);
    await admin.query(
      `UPDATE classroom_student_seats SET status='active' WHERE id=ANY($1::uuid[])`,
      [[first]],
    );
    const counts = async (seatId: string) =>
      (
        await inTenant((client) =>
          client.query(`SELECT * FROM classroom_seat_assignment_counts($1)`, [seatId]),
        )
      ).rows[0] as { open_count: number; unfinished_count: number };
    // A new canonical delivery must not retroactively narrow the earlier
    // legacy handout or confiscate its third learner's historical work.
    expect(result['classroom_assignment_id']).not.toBe(handout.rows[0].id);
    await expect(counts(first)).resolves.toMatchObject({ open_count: 2, unfinished_count: 2 });
    await expect(counts(third)).resolves.toMatchObject({ open_count: 1, unfinished_count: 1 });
    await expect(
      inTenant((client) =>
        client.query(`SELECT * FROM classroom_assignment_work_start($1,$2,$3)`, [
          third,
          result['classroom_assignment_id'],
          project.rows[0].id,
        ]),
      ),
    ).rejects.toThrow(/learning direct assignment unavailable/);
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM learning_attempts
            WHERE classroom_assignment_id=$1 AND seat_id=$2`,
          [result['classroom_assignment_id'], third],
        )
      ).rows[0].count,
    ).toBe(0);
  });

  it('rejects a seat from another class atomically and denies runtime table CRUD', async () => {
    const classId = await classroom();
    const otherClass = await classroom();
    const foreignSeat = await seat(otherClass, 'Чужой ученик');
    const version = await activity('Безопасная цепь');
    const rejected = await assign({
      classroomId: classId,
      versionId: version,
      audience: 'named_learners',
      seats: [foreignSeat],
    });
    expect(rejected.result_code).toBe('named_learner_ineligible');
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM classroom_assignments WHERE classroom_id=$1`,
          [classId],
        )
      ).rows[0].count,
    ).toBe(0);
    await expect(
      inTenant((client) => client.query(`SELECT * FROM activity_runs LIMIT 1`)),
    ).rejects.toThrow(/permission denied/);
  });
});
