import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { expect } from 'vitest';
import { seedTeacher, type SeededTeacher } from '../portal/helpers';

/** Real pre-E1 SQL interfaces, executed only in the upgrade suite's generated database. */
export async function seedMixedMainLearning(
  pool: pg.Pool,
  owner: SeededTeacher,
  classroom: string,
) {
  const teacher = (
    await pool.query(
      'SELECT account_id,principal_id FROM legacy_user_account_links WHERE user_id=$1',
      [owner.teacherId],
    )
  ).rows[0];
  const account = await seedTeacher(pool, 'existing-account-learner');
  const accountIdentity = (
    await pool.query(
      'SELECT account_id,principal_id FROM legacy_user_account_links WHERE user_id=$1',
      [account.teacherId],
    )
  ).rows[0];
  async function scoped(sql: string, values: unknown[]) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [owner.tenantId]);
      const result = await client.query(sql, values);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const seats: { id: string; principal: string; learner: string }[] = [];
  for (const linkedAccount of [null, accountIdentity.account_id]) {
    const login = randomUUID().replaceAll('-', '');
    const id = (
      await pool.query(
        `INSERT INTO classroom_student_seats
      (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by,account_id)
      VALUES($1,$2,'Mixed learner',$3,$3,true,'active',$4,$5) RETURNING id`,
        [owner.tenantId, classroom, login, owner.teacherId, linkedAccount],
      )
    ).rows[0].id;
    const principal = (
      await pool.query('SELECT principal_id FROM student_seat_principal($1)', [id])
    ).rows[0].principal_id;
    const learner = (
      await pool.query('SELECT learning_audience_ensure_seat_identity($1) AS id', [id])
    ).rows[0].id;
    seats.push({ id, principal, learner });
    await pool.query(
      `INSERT INTO classroom_seat_credentials(seat_id,credential_hash,version,last_request_id,issued_by_account_id,issued_at)
      VALUES($1,$2,4,$3,$4,'2026-09-01T10:00:00Z')`,
      [id, 'b'.repeat(64), randomUUID(), teacher.account_id],
    );
  }
  const material = (
    await pool.query(
      `INSERT INTO teacher_assignments(tenant_id,owner_principal_id,title,brief,module_key,visibility)
    VALUES($1,$2,'Pre-E1 canonical activity','Preserved review','electronics','private') RETURNING id`,
      [owner.tenantId, teacher.principal_id],
    )
  ).rows[0].id;
  const policies = {
    attemptPolicy: { maxAttempts: 1 },
    resultSelectionPolicy: { mode: 'latest_accepted' },
    completionPolicy: { mode: 'submission' },
    latePolicy: { mode: 'allow_mark_late' },
    assessmentPolicy: { mode: 'manual' },
    feedbackReleasePolicy: { mode: 'after_review' },
  };
  const activity = await scoped(
    `SELECT * FROM learning_activity_create($1,$2,'school','private','project','Pre-E1 canonical activity','ignored','graded',100,$3::jsonb,'electronics',NULL,NULL,$4,$5)`,
    [teacher.principal_id, owner.tenantId, JSON.stringify(policies), material, 'mixed:create'],
  );
  const version = await scoped('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
    teacher.principal_id,
    owner.tenantId,
    activity.activity_id,
    'mixed:publish',
  ]);
  const assigned = await scoped(
    `SELECT * FROM learning_direct_assignment_create($1,$2,$3,$4,'2027-05-30T20:59:00Z','named_learners',$5::uuid[],$6)`,
    [
      teacher.principal_id,
      owner.tenantId,
      classroom,
      version.activity_version_id,
      seats.map((s) => s.id),
      'mixed:assign',
    ],
  );
  expect(assigned.result_code).toBe('ok');
  const attempts: { id: string; participation: string; result: string | null; decision: string }[] =
    [];
  for (const [index, seat] of seats.entries()) {
    const project = (
      await pool.query(
        `INSERT INTO projects(tenant_id,project_scope,module_key,title,owner_principal_id)
      VALUES($1,'personal','electronics','Pre-E1 evidence',$2) RETURNING id`,
        [owner.tenantId, seat.principal],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO project_drafts(tenant_id,project_id,document_json,revision,updated_by_principal_id)
      VALUES($1,$2,'{"schemaVersion":1,"components":[]}'::jsonb,1,$3)`,
      [owner.tenantId, project, seat.principal],
    );
    const started = await scoped(
      'SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)',
      [seat.principal, seat.id, assigned.classroom_assignment_id, project],
    );
    expect(started.result_code).toBe('ok');
    // The four-argument interface is the actual main 0106 interface, before exact-revision E1.
    const submitted = await scoped(
      'SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4)',
      [seat.principal, seat.id, assigned.classroom_assignment_id, 'mixed:submit:' + index],
    );
    expect(submitted.result_code).toBe('ok');
    // Main's legacy reviewer consumed evaluating, not the new direct submitted state.
    // Seed that valid historical queue shape; this is an upgrade fixture, not UI acceptance.
    await pool.query("UPDATE learning_attempts SET state='evaluating' WHERE id=$1", [
      started.attempt_id,
    ]);
    const decision = index === 0 ? 'accepted' : 'changes_requested';
    const reviewed = await scoped(
      'SELECT * FROM learning_attempt_review($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        teacher.account_id,
        teacher.principal_id,
        classroom,
        started.attempt_id,
        decision,
        index === 0 ? 84 : null,
        'Historical feedback',
        index === 0 ? null : 'Historical return',
      ],
    );
    expect(reviewed.result_code).toBe('ok');
    attempts.push({
      id: started.attempt_id,
      participation: started.participation_id,
      result: reviewed.assessment_result_id,
      decision,
    });
  }
  const course = (
    await pool.query(
      `INSERT INTO courses(tenant_id,owner_principal_id,title,visibility) VALUES($1,$2,'Pre-E1 enrollment','private') RETURNING id`,
      [owner.tenantId, teacher.principal_id],
    )
  ).rows[0].id;
  const courseVersion = (
    await pool.query(
      `INSERT INTO course_versions(tenant_id,course_id,version_number,title,outline,content_hash,published_by_principal_id)
    VALUES($1,$2,1,'Pre-E1 enrollment','{"sections":[]}'::jsonb,'pre-e1-immutable',$3) RETURNING id`,
      [owner.tenantId, course, teacher.principal_id],
    )
  ).rows[0].id;
  const run = (
    await pool.query(
      `INSERT INTO classroom_course_runs(tenant_id,classroom_id,course_id,course_version_id,title,version_number,assigned_by_principal_id)
    VALUES($1,$2,$3,$4,'Pre-E1 enrollment',1,$5) RETURNING id`,
      [owner.tenantId, classroom, course, courseVersion, teacher.principal_id],
    )
  ).rows[0].id;
  const enrollments: string[] = [];
  for (const seat of seats) {
    const enrollment = await scoped('SELECT * FROM course_enrollment_assign($1,$2,$3)', [
      teacher.principal_id,
      run,
      seat.learner,
    ]);
    expect(enrollment.result_code).toBe('ok');
    enrollments.push(enrollment.enrollment_id);
  }
  expect(
    (
      await scoped('SELECT * FROM course_enrollment_withdraw($1,$2)', [
        teacher.principal_id,
        enrollments[1],
      ])
    ).result_code,
  ).toBe('ok');
  expect(
    (
      await scoped('SELECT * FROM activity_participation_withdraw($1,$2)', [
        teacher.principal_id,
        attempts[1].participation,
      ])
    ).result_code,
  ).toBe('ok');
  return {
    account,
    accountIdentity,
    seats,
    attempts,
    enrollments,
    assignment: assigned.classroom_assignment_id,
    teacher,
  };
}
