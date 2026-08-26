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
let teacherPrincipal: string;
let teacherAccount: string;
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

async function createClass(): Promise<string> {
  const result = await admin.query(
    `INSERT INTO classrooms (tenant_id,school_id,academic_period_id,title,created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [owner.tenantId, owner.schoolId, owner.periodId, `VS002 ${++sequence}`, owner.teacherId],
  );
  const classroomId = result.rows[0].id as string;
  await admin.query(
    `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES ($1,$2,$3,$4,'owner')`,
    [owner.tenantId, classroomId, owner.teacherId, teacherAccount],
  );
  return classroomId;
}

async function createSeat(classroomId: string, label: string): Promise<string> {
  return (
    await admin.query(
      `INSERT INTO classroom_student_seats
         (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
          safe_mode,status,created_by)
       VALUES ($1,$2,$3,$4,$4,true,'issued',$5) RETURNING id`,
      [owner.tenantId, classroomId, label, `vs002-${++sequence}`, owner.teacherId],
    )
  ).rows[0].id as string;
}

async function createActivity(title: string): Promise<string> {
  const authored = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES ($1,$2,$3,'Соберите цепь.','electronics','private') RETURNING id`,
    [owner.tenantId, teacherPrincipal, title],
  );
  const created = await inTenant((client) =>
    client.query(
      `SELECT * FROM learning_activity_create(
       $1,$2,'school','private','project',$3,'ignored','completion',NULL,
       $4::jsonb,'electronics',NULL,NULL,$5,$6)`,
      [
        teacherPrincipal,
        owner.tenantId,
        title,
        JSON.stringify(policies),
        authored.rows[0].id,
        `vs002:create:${++sequence}`,
      ],
    ),
  );
  const published = await inTenant((client) =>
    client.query(`SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)`, [
      teacherPrincipal,
      owner.tenantId,
      created.rows[0].activity_id,
      `vs002:publish:${++sequence}`,
    ]),
  );
  return published.rows[0].activity_version_id as string;
}

async function assign(
  classroomId: string,
  versionId: string,
  audience: 'whole_class' | 'named_learners',
  seats: string[] = [],
): Promise<string> {
  const result = await inTenant((client) =>
    client.query(
      `SELECT * FROM learning_direct_assignment_create(
       $1,$2,$3,$4,'2027-05-30T20:59:00Z',$5,$6::uuid[],$7)`,
      [
        teacherPrincipal,
        owner.tenantId,
        classroomId,
        versionId,
        audience,
        seats,
        `vs002:assign:${++sequence}`,
      ],
    ),
  );
  expect(result.rows[0].result_code).toBe('ok');
  return result.rows[0].classroom_assignment_id as string;
}

async function activateSeat(seatId: string): Promise<string> {
  await admin.query(`UPDATE classroom_student_seats SET status='active' WHERE id=$1`, [seatId]);
  return (await admin.query(`SELECT principal_id FROM student_seat_principal($1)`, [seatId]))
    .rows[0].principal_id as string;
}

async function createProject(principalId: string, title: string): Promise<string> {
  const project = await admin.query(
    `INSERT INTO projects
       (tenant_id,project_scope,module_key,title,owner_principal_id)
     VALUES ($1,'personal','electronics',$2,$3) RETURNING id`,
    [owner.tenantId, title, principalId],
  );
  await admin.query(
    `INSERT INTO project_drafts
       (tenant_id,project_id,document_json,revision,updated_by_principal_id)
     VALUES ($1,$2,$3::jsonb,1,$4)`,
    [
      owner.tenantId,
      project.rows[0].id,
      JSON.stringify({ schemaVersion: 1, components: [{ id: 'r1', type: 'resistor' }] }),
      principalId,
    ],
  );
  return project.rows[0].id as string;
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'learning-vs-002');
  const identity = await admin.query(
    `SELECT account_id,principal_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [owner.tenantId, owner.teacherId],
  );
  teacherAccount = identity.rows[0].account_id as string;
  teacherPrincipal = identity.rows[0].principal_id as string;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('LRN-VS-002 canonical direct project attempt', () => {
  it('starts once, freezes the exact project, and submits idempotently', async () => {
    const classroomId = await createClass();
    const seatId = await createSeat(classroomId, 'Анна');
    const versionId = await createActivity('Светодиод и резистор');
    const assignmentId = await assign(classroomId, versionId, 'whole_class');
    const learnerPrincipal = await activateSeat(seatId);
    const projectId = await createProject(learnerPrincipal, 'Работа Анны');

    const start = async () =>
      (
        await inTenant((client) =>
          client.query(`SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)`, [
            learnerPrincipal,
            seatId,
            assignmentId,
            projectId,
          ]),
        )
      ).rows[0] as Record<string, unknown>;

    const first = await start();
    const retry = await start();
    expect(first).toMatchObject({ result_code: 'ok', attempt_state: 'in_progress', reused: false });
    expect(retry).toMatchObject({
      result_code: 'ok',
      participation_id: first.participation_id,
      attempt_id: first.attempt_id,
      reused: true,
    });

    const lineage = await admin.query(
      `SELECT attempt.activity_participation_id,attempt.learner_identity_id,
              attempt.state,participation.status,run.source_classroom_assignment_id
         FROM learning_attempts attempt
         JOIN activity_participations participation
           ON participation.id=attempt.activity_participation_id
         JOIN activity_runs run ON run.id=participation.activity_run_id
        WHERE attempt.id=$1`,
      [first.attempt_id],
    );
    expect(lineage.rows[0]).toMatchObject({
      activity_participation_id: first.participation_id,
      state: 'in_progress',
      status: 'active',
      source_classroom_assignment_id: assignmentId,
    });

    const requestId = `vs002:submit:${++sequence}`;
    const submit = async (id: string) =>
      (
        await inTenant((client) =>
          client.query(`SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4)`, [
            learnerPrincipal,
            seatId,
            assignmentId,
            id,
          ]),
        )
      ).rows[0] as Record<string, unknown>;

    const submitted = await submit(requestId);
    const submitRetry = await submit(requestId);
    expect(submitted).toMatchObject({
      result_code: 'ok',
      participation_id: first.participation_id,
      attempt_id: first.attempt_id,
      attempt_state: 'submitted',
      project_id: projectId,
      reused: false,
    });
    expect(submitRetry).toMatchObject({
      result_code: 'ok',
      attempt_id: first.attempt_id,
      submission_id: submitted.submission_id,
      project_version_id: submitted.project_version_id,
      reused: true,
    });

    const frozen = await admin.query(
      `SELECT submission.project_id,submission.project_version_id,
              version.document_json,attempt.state,work.submitted_at
         FROM learning_submissions submission
         JOIN learning_attempts attempt ON attempt.id=submission.attempt_id
         JOIN project_versions version ON version.id=submission.project_version_id
         JOIN classroom_assignment_work work
           ON work.assignment_id=attempt.classroom_assignment_id
          AND work.seat_id=attempt.seat_id
        WHERE submission.id=$1`,
      [submitted.submission_id],
    );
    expect(frozen.rows[0]).toMatchObject({
      project_id: projectId,
      state: 'submitted',
      document_json: { schemaVersion: 1, components: [{ id: 'r1', type: 'resistor' }] },
    });
    expect(frozen.rows[0].submitted_at).not.toBeNull();

    const distinctRetry = await submit(`vs002:submit:${++sequence}`);
    expect(distinctRetry.result_code).toBe('attempt_already_submitted');
    const counts = await admin.query(
      `SELECT
         (SELECT count(*)::int FROM learning_attempts
           WHERE activity_participation_id=$1) AS attempts,
         (SELECT count(*)::int FROM learning_submissions
           WHERE attempt_id=$2) AS submissions`,
      [first.participation_id, first.attempt_id],
    );
    expect(counts.rows[0]).toEqual({ attempts: 1, submissions: 1 });
  });

  it('denies excluded and suspended learners and runtime table CRUD', async () => {
    const classroomId = await createClass();
    const includedSeat = await createSeat(classroomId, 'Борис');
    const excludedSeat = await createSeat(classroomId, 'Вера');
    const versionId = await createActivity('Точная цепь');
    const assignmentId = await assign(classroomId, versionId, 'named_learners', [includedSeat]);
    const excludedPrincipal = await activateSeat(excludedSeat);
    const excludedProject = await createProject(excludedPrincipal, 'Чужая работа');

    const denied = await inTenant((client) =>
      client.query(`SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)`, [
        excludedPrincipal,
        excludedSeat,
        assignmentId,
        excludedProject,
      ]),
    );
    expect(denied.rows[0].result_code).toBe('forbidden');
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM learning_attempts
            WHERE classroom_assignment_id=$1 AND seat_id=$2`,
          [assignmentId, excludedSeat],
        )
      ).rows[0].count,
    ).toBe(0);

    const includedPrincipal = await activateSeat(includedSeat);
    const includedProject = await createProject(includedPrincipal, 'Работа Бориса');
    await admin.query(`UPDATE classroom_student_seats SET status='suspended' WHERE id=$1`, [
      includedSeat,
    ]);
    const suspended = await inTenant((client) =>
      client.query(`SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)`, [
        includedPrincipal,
        includedSeat,
        assignmentId,
        includedProject,
      ]),
    );
    expect(suspended.rows[0].result_code).toBe('forbidden');

    await expect(
      inTenant((client) =>
        client.query(
          `INSERT INTO learning_attempts
             (tenant_id,classroom_id,classroom_assignment_id,
              learning_activity_version_id,seat_id,attempt_number)
           VALUES ($1,$2,$3,$4,$5,99)`,
          [owner.tenantId, classroomId, assignmentId, versionId, excludedSeat],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      inTenant((client) => client.query(`UPDATE learning_submissions SET late_state='late'`)),
    ).rejects.toThrow(/permission denied/);
  });
});
