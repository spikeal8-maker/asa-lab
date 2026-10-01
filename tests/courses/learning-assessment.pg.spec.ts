import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let teacher: SeededTeacher;
let principalId: string;
let accountId: string;

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  teacher = await seedTeacher(admin, 'learning-assessment');
  const identity = await admin.query(
    `SELECT principal_id, account_id
       FROM legacy_user_account_links
      WHERE tenant_id = $1 AND user_id = $2`,
    [teacher.tenantId, teacher.teacherId],
  );
  principalId = identity.rows[0].principal_id as string;
  accountId = identity.rows[0].account_id as string;
});

afterAll(async () => {
  await app.end();
  await admin.end();
});

describe('immutable learning assessment chain', () => {
  it('freezes a project attempt, reviews it and publishes the same result to the gradebook', async () => {
    const classroom = await admin.query(
      `INSERT INTO classrooms
         (tenant_id, school_id, academic_period_id, title, created_by)
       VALUES ($1, $2, $3, '7А — оценивание', $4) RETURNING id`,
      [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
    );
    const classroomId = classroom.rows[0].id as string;
    await admin.query(
      `INSERT INTO classroom_memberships
         (tenant_id, classroom_id, user_id, account_id, member_role)
       VALUES ($1, $2, $3, $4, 'owner')`,
      [teacher.tenantId, classroomId, teacher.teacherId, accountId],
    );
    const seat = await admin.query(
      `INSERT INTO classroom_student_seats
         (tenant_id, classroom_id, display_label, login_handle,
          normalized_login_handle, safe_mode, status, created_by)
       VALUES ($1, $2, 'Анна', 'anna-assessment', 'anna-assessment', true, 'active', $3)
       RETURNING id`,
      [teacher.tenantId, classroomId, teacher.teacherId],
    );
    const seatId = seat.rows[0].id as string;
    const seatPrincipal = await admin.query(`SELECT principal_id FROM student_seat_principal($1)`, [
      seatId,
    ]);
    const learnerPrincipalId = seatPrincipal.rows[0].principal_id as string;

    const task = await admin.query(
      `INSERT INTO teacher_assignments
         (tenant_id, owner_principal_id, title, brief, module_key, visibility)
       VALUES ($1, $2, 'Первая схема', 'Соберите рабочую цепь',
               'electronics', 'private') RETURNING id`,
      [teacher.tenantId, principalId],
    );
    const handout = await admin.query(
      `INSERT INTO classroom_assignments
         (tenant_id, classroom_id, assignment_id, due_at, status, created_by)
       VALUES ($1, $2, $3, now() + interval '1 day', 'open', $4) RETURNING id`,
      [teacher.tenantId, classroomId, task.rows[0].id, teacher.teacherId],
    );
    const assignmentId = handout.rows[0].id as string;

    const project = await admin.query(
      `INSERT INTO projects
         (tenant_id, project_scope, classroom_id, module_key, title,
          created_by, owner_principal_id)
       VALUES ($1, 'classroom', $2, 'electronics', 'Схема Анны',
               NULL, $3) RETURNING id`,
      [teacher.tenantId, classroomId, learnerPrincipalId],
    );
    const projectId = project.rows[0].id as string;
    await admin.query(
      `INSERT INTO project_drafts
         (tenant_id, project_id, document_json, revision, updated_by,
          updated_by_principal_id)
       VALUES ($1, $2, '{"schemaVersion":1,"components":[]}'::jsonb,
               1, NULL, $3)`,
      [teacher.tenantId, projectId, learnerPrincipalId],
    );
    await admin.query(
      `INSERT INTO classroom_assignment_work
         (tenant_id, assignment_id, seat_id, project_id)
       VALUES ($1, $2, $3, $4)`,
      [teacher.tenantId, assignmentId, seatId, projectId],
    );

    const first = await admin.query(
      `SELECT * FROM learning_project_submission_create($1, $2, $3)`,
      [seatId, assignmentId, 'submit:assessment:0001'],
    );
    expect(first.rows[0]).toMatchObject({
      result_code: 'ok',
      attempt_number: 1,
      attempt_state: 'evaluating',
      project_id: projectId,
      reused: false,
    });
    expect(first.rows[0].project_version_id).toBeTruthy();
    expect(first.rows[0].submission_id).toBeTruthy();

    const retry = await admin.query(
      `SELECT * FROM learning_project_submission_create($1, $2, $3)`,
      [seatId, assignmentId, 'submit:assessment:0001'],
    );
    expect(retry.rows[0]).toMatchObject({
      attempt_id: first.rows[0].attempt_id,
      submission_id: first.rows[0].submission_id,
      reused: true,
    });
    const duplicate = await admin.query(
      `SELECT * FROM learning_project_submission_create($1, $2, $3)`,
      [seatId, assignmentId, 'submit:assessment:0002'],
    );
    expect(duplicate.rows[0]).toMatchObject({ result_code: 'attempt_already_submitted' });

    const reviewed = await admin.query(
      `SELECT * FROM learning_attempt_review($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        accountId,
        principalId,
        classroomId,
        first.rows[0].attempt_id,
        'accepted',
        84,
        'Схема работает и аккуратно собрана.',
        null,
      ],
    );
    expect(reviewed.rows[0]).toMatchObject({
      result_code: 'ok',
      attempt_state: 'closed',
      percentage_basis_points: 8400,
    });

    const reviewedLifecycle = (
      await admin.query(
        'SELECT attempt.state, result.review_decision FROM learning_attempts attempt JOIN assessment_results result ON result.attempt_id=attempt.id WHERE attempt.id=$1',
        [first.rows[0].attempt_id],
      )
    ).rows[0];
    expect(reviewedLifecycle).toMatchObject({ state: 'closed', review_decision: 'accepted' });

    const gradebook = await admin.query(`SELECT * FROM classroom_gradebook_list($1, $2)`, [
      accountId,
      classroomId,
    ]);
    expect(gradebook.rows).toEqual([
      expect.objectContaining({
        seat_id: seatId,
        assignment_id: assignmentId,
        attempt_id: first.rows[0].attempt_id,
        attempt_number: 1,
        attempt_state: 'closed',
        raw_points: 84,
        max_points: 100,
        percentage_basis_points: 8400,
        outcome: 'passed',
      }),
    ]);

    await expect(
      admin.query(`UPDATE learning_submissions SET late_state = 'late' WHERE id = $1`, [
        first.rows[0].submission_id,
      ]),
    ).rejects.toThrow(/immutable/);
    const evidence = await admin.query(
      `SELECT count(*)::integer AS submissions,
              count(DISTINCT project_version_id)::integer AS versions
         FROM learning_submissions WHERE attempt_id = $1`,
      [first.rows[0].attempt_id],
    );
    expect(evidence.rows[0]).toEqual({ submissions: 1, versions: 1 });
  });

  it('reworks only the previously linked historical Project after changes are requested', async () => {
    const classroomId = (
      await admin.query(
        `INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by)
         VALUES($1,$2,$3,'Historical rework',$4) RETURNING id`,
        [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role)
       VALUES($1,$2,$3,$4,'owner')`,
      [teacher.tenantId, classroomId, teacher.teacherId, accountId],
    );
    const seatId = (
      await admin.query(
        `INSERT INTO classroom_student_seats
         (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by)
         VALUES($1,$2,'Rework learner','historical-rework-learner','historical-rework-learner',true,'active',$3)
         RETURNING id`,
        [teacher.tenantId, classroomId, teacher.teacherId],
      )
    ).rows[0].id as string;
    const wrongSeat = (
      await admin.query(
        `INSERT INTO classroom_student_seats
         (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by)
         VALUES($1,$2,'Wrong learner','historical-rework-wrong','historical-rework-wrong',true,'active',$3)
         RETURNING id`,
        [teacher.tenantId, classroomId, teacher.teacherId],
      )
    ).rows[0].id as string;
    const seatPrincipal = (
      await admin.query('SELECT principal_id FROM student_seat_principal($1)', [seatId])
    ).rows[0].principal_id as string;
    const wrongPrincipal = (
      await admin.query('SELECT principal_id FROM student_seat_principal($1)', [wrongSeat])
    ).rows[0].principal_id as string;
    const taskId = (
      await admin.query(
        `INSERT INTO teacher_assignments(tenant_id,owner_principal_id,title,brief,module_key,visibility)
         VALUES($1,$2,'Old rework','Revise the circuit','electronics','private') RETURNING id`,
        [teacher.tenantId, principalId],
      )
    ).rows[0].id as string;
    const assignmentId = (
      await admin.query(
        `INSERT INTO classroom_assignments
         (tenant_id,classroom_id,assignment_id,due_at,status,created_by)
         VALUES($1,$2,$3,now()+interval '1 day','open',$4) RETURNING id`,
        [teacher.tenantId, classroomId, taskId, teacher.teacherId],
      )
    ).rows[0].id as string;
    const projectId = (
      await admin.query(
        `INSERT INTO projects(tenant_id,project_scope,classroom_id,module_key,title,owner_principal_id)
         VALUES($1,'classroom',$2,'electronics','Linked historical work',$3) RETURNING id`,
        [teacher.tenantId, classroomId, seatPrincipal],
      )
    ).rows[0].id as string;
    const unboundProjectId = (
      await admin.query(
        `INSERT INTO projects(tenant_id,project_scope,classroom_id,module_key,title,owner_principal_id)
         VALUES($1,'classroom',$2,'electronics','Unbound ordinary project',$3) RETURNING id`,
        [teacher.tenantId, classroomId, seatPrincipal],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO project_drafts(tenant_id,project_id,document_json,revision,updated_by_principal_id)
       VALUES($1,$2,'{"schemaVersion":1,"components":[]}'::jsonb,1,$3)`,
      [teacher.tenantId, projectId, seatPrincipal],
    );
    await admin.query(
      `INSERT INTO classroom_assignment_work(tenant_id,assignment_id,seat_id,project_id)
       VALUES($1,$2,$3,$4)`,
      [teacher.tenantId, assignmentId, seatId, projectId],
    );
    const first = (
      await admin.query('SELECT * FROM learning_project_submission_create($1,$2,$3)', [
        seatId,
        assignmentId,
        'legacy:rework:first',
      ])
    ).rows[0];
    expect(first).toMatchObject({ result_code: 'ok', project_id: projectId, attempt_number: 1 });
    expect(
      (
        await admin.query('SELECT * FROM learning_attempt_review($1,$2,$3,$4,$5,$6,$7,$8)', [
          accountId,
          principalId,
          classroomId,
          first.attempt_id,
          'changes_requested',
          null,
          'Please revise',
          'Needs correction',
        ])
      ).rows[0],
    ).toMatchObject({ result_code: 'ok', attempt_state: 'closed' });

    async function lockedProof(actor: string, project: string) {
      const client = await app.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [teacher.tenantId]);
        const proof = await client.query(
          'SELECT learning_legacy_assignment_write_provenance($1,$2,$3,$4) AS proof',
          [actor, seatId, assignmentId, project],
        );
        await client.query('COMMIT');
        return proof.rows[0].proof as { startAllowed: boolean; submitAllowed: boolean };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    expect(await lockedProof(seatPrincipal, projectId)).toMatchObject({
      startAllowed: false,
      submitAllowed: true,
    });
    expect(await lockedProof(seatPrincipal, unboundProjectId)).toMatchObject({
      submitAllowed: false,
    });
    expect(await lockedProof(wrongPrincipal, projectId)).toMatchObject({
      submitAllowed: false,
    });

    await admin.query(
      `UPDATE project_drafts SET document_json='{"schemaVersion":1,"components":[{"kind":"reworked"}]}'::jsonb,
          revision=revision+1 WHERE project_id=$1`,
      [projectId],
    );
    const second = (
      await admin.query('SELECT * FROM learning_project_submission_create($1,$2,$3)', [
        seatId,
        assignmentId,
        'legacy:rework:second',
      ])
    ).rows[0];
    expect(second).toMatchObject({ result_code: 'ok', project_id: projectId, attempt_number: 2 });
    expect(second.attempt_id).not.toBe(first.attempt_id);
    expect(second.project_version_id).not.toBe(first.project_version_id);
    expect(
      (
        await admin.query(
          `SELECT count(*)::integer AS work_count FROM classroom_assignment_work
           WHERE assignment_id=$1 AND seat_id=$2 AND project_id=$3`,
          [assignmentId, seatId, projectId],
        )
      ).rows[0].work_count,
    ).toBe(1);
    expect(
      (
        await admin.query(
          'SELECT count(*)::integer AS origin_count FROM learning_project_origins WHERE project_id=$1',
          [projectId],
        )
      ).rows[0].origin_count,
    ).toBe(0);
    await admin.query(`UPDATE classroom_student_seats SET status='removed' WHERE id=$1`, [seatId]);
    expect(await lockedProof(seatPrincipal, projectId)).toMatchObject({ submitAllowed: false });
  });
});
