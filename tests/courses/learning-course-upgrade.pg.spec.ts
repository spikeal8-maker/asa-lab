import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect, it } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { seedTeacher } from '../portal/helpers';

it('upgrades populated baseline 0106 without rewriting projects, course versions, feedback or submitted history', async () => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw new Error('Isolated TEST_DATABASE_URL is required');
  const admin = new pg.Client({ connectionString: source });
  await admin.connect();
  // A newly generated database in the test cluster only; never the configured database.
  const name = 'asa_learning_upgrade_' + randomUUID().replaceAll('-', '') + '_test';
  if (!/^asa_learning_upgrade_[a-f0-9]{32}_test$/.test(name))
    throw new Error('Unsafe generated database name');
  let isolated: pg.Pool | null = null,
    app: pg.Pool | null = null;
  await admin.query(`CREATE DATABASE "${name}"`);
  try {
    const connection = new URL(source);
    connection.pathname = '/' + name;
    isolated = new pg.Pool({ connectionString: connection.toString(), max: 3 });
    const planned = planMigrations('migrations'),
      baseline = planned.filter((m: { version: string }) => m.version <= '0106');
    const client = await isolated.connect();
    try {
      expect(await applyPlan(client, baseline)).toBe(baseline.length);
    } finally {
      client.release();
    }
    const teacher = await seedTeacher(isolated, 'e1-supported-upgrade');
    const identity = (
      await isolated.query(
        'SELECT account_id,principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
        [teacher.tenantId, teacher.teacherId],
      )
    ).rows[0];
    const cls = (
      await isolated.query(
        "INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,'Существующий класс',$4) RETURNING id",
        [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
      )
    ).rows[0].id;
    await isolated.query(
      "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
      [teacher.tenantId, cls, teacher.teacherId, identity.account_id],
    );
    const seat = (
      await isolated.query(
        "INSERT INTO classroom_student_seats(tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by) VALUES($1,$2,'Исторический ученик','legacy','legacy',true,'active',$3) RETURNING id",
        [teacher.tenantId, cls, teacher.teacherId],
      )
    ).rows[0].id;
    const learner = (
      await isolated.query('SELECT principal_id FROM student_seat_principal($1)', [seat])
    ).rows[0].principal_id;
    const root = (
      await isolated.query(
        "SELECT classroom_assignment_create($1,$2,'Старая работа','Реальное legacy evidence','electronics',NULL) AS id",
        [identity.principal_id, cls],
      )
    ).rows[0].id;
    const assignment = (
      await isolated.query(
        'SELECT id FROM classroom_assignments WHERE classroom_id=$1 AND assignment_id=$2',
        [cls, root],
      )
    ).rows[0].id;
    const projects: string[] = [];
    for (const module of ['electronics', 'three-d']) {
      const project = (
        await isolated.query(
          "INSERT INTO projects(tenant_id,project_scope,module_key,title,owner_principal_id) VALUES($1,'personal',$2,$2,$3) RETURNING id",
          [teacher.tenantId, module, learner],
        )
      ).rows[0].id;
      const document = JSON.stringify({ schemaVersion: 1, module, evidence: 'PRE_UPGRADE' });
      await isolated.query(
        'INSERT INTO project_drafts(tenant_id,project_id,document_json,revision,updated_by_principal_id) VALUES($1,$2,$3,3,$4)',
        [teacher.tenantId, project, document, learner],
      );
      await isolated.query(
        "INSERT INTO project_versions(tenant_id,project_id,version_no,document_json,label,created_by_principal_id) VALUES($1,$2,1,$3,'Старый снимок',$4)",
        [teacher.tenantId, project, document, learner],
      );
      projects.push(project);
    }
    await isolated.query(
      "INSERT INTO classroom_assignment_work(tenant_id,assignment_id,seat_id,project_id,submitted_at) VALUES($1,$2,$3,$4,'2026-08-01T12:00:00Z')",
      [teacher.tenantId, assignment, seat, projects[0]],
    );
    await isolated.query(
      "INSERT INTO project_feedback(tenant_id,project_id,seat_id,author_principal_id,badge,comment) VALUES($1,$2,$3,$4,'excellent','Отлично — исторический отклик, не школьная оценка')",
      [teacher.tenantId, projects[0], seat, identity.principal_id],
    );
    const course = (
      await isolated.query(
        "SELECT course_save($1,NULL,'Старый частный курс',NULL,NULL,'private') AS id",
        [identity.principal_id],
      )
    ).rows[0].id;
    const section = (
      await isolated.query('SELECT section_id FROM course_outline_v2($1,$2,$3,$4) LIMIT 1', [
        course,
        identity.principal_id,
        identity.account_id,
        teacher.tenantId,
      ])
    ).rows[0].section_id;
    await isolated.query(
      "SELECT course_lesson_save_v2($1,$2,$3,NULL,'Теория',NULL,$4::jsonb,'material',NULL,15)",
      [
        identity.principal_id,
        course,
        section,
        JSON.stringify([{ id: 'old-text', type: 'paragraph', text: 'Сохранённое содержание' }]),
      ],
    );
    expect(
      (await isolated.query('SELECT * FROM course_publish($1,$2)', [identity.principal_id, course]))
        .rows[0].version_number,
    ).toBe(1);
    const snapshot = async () => {
      const result: Record<string, unknown[]> = {};
      for (const table of [
        'projects',
        'project_drafts',
        'project_versions',
        'project_feedback',
        'classroom_assignment_work',
        'course_versions',
        'principals',
      ]) {
        result[table] = (
          await isolated!.query(
            `SELECT to_jsonb(row) AS record FROM public.${table} row ORDER BY to_jsonb(row)::text`,
          )
        ).rows;
      }
      return result;
    };
    const before = await snapshot();
    const upgrade = await isolated.connect();
    try {
      expect(await applyPlan(upgrade, planned)).toBe(planned.length - baseline.length);
      expect(await applyPlan(upgrade, planned)).toBe(0);
    } finally {
      upgrade.release();
    }
    expect(await snapshot()).toEqual(before);
    expect((await isolated.query('SELECT id FROM assessment_results')).rows).toHaveLength(0);
    expect((await isolated.query('SELECT id FROM learning_attempts')).rows).toHaveLength(0);
    const runtime = process.env['APP_TEST_DATABASE_URL'];
    if (!runtime || new URL(runtime).pathname !== new URL(source).pathname)
      throw new Error('Matching APP_TEST_DATABASE_URL required');
    const runtimeUrl = new URL(runtime);
    runtimeUrl.pathname = '/' + name;
    app = new pg.Pool({ connectionString: runtimeUrl.toString(), max: 1 });
    expect(
      (
        await app.query('SELECT * FROM project_feedback_list($1,$2)', [
          identity.principal_id,
          projects[0],
        ])
      ).rows[0],
    ).toMatchObject({ badge: 'excellent' });
    const evidence = (
      await app.query('SELECT * FROM learning_canonical_evidence_for_seat($1)', [seat])
    ).rows[0].evidence;
    expect(evidence.legacyWork).toMatchObject({ projectId: projects[0] });
    expect(evidence.legacyWork.submittedAt).not.toBeNull();
    expect(evidence.selectedRevision).toBeNull();
    expect(
      (
        await app.query('SELECT * FROM course_outline_v2($1,$2,$3,$4)', [
          course,
          identity.principal_id,
          identity.account_id,
          teacher.tenantId,
        ])
      ).rows[0].lesson_title,
    ).toBe('Теория');
  } finally {
    await app?.end();
    await isolated?.end();
    await admin.query(`DROP DATABASE "${name}"`); // Only the generated, isolated test fixture database.
    await admin.end();
  }
}, 60000);

it('preserves legacy review decisions while 0133 converges Attempt lifecycle', async () => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) {
    throw new Error('Isolated TEST_DATABASE_URL is required');
  }
  const admin = new pg.Client({ connectionString: source });
  await admin.connect();
  const name = `asa_learning_attempt_lifecycle_${randomUUID().replaceAll('-', '')}_test`;
  if (!/^asa_learning_attempt_lifecycle_[a-f0-9]{32}_test$/.test(name)) {
    throw new Error('Unsafe generated database name');
  }
  let isolated: pg.Pool | null = null;
  await admin.query(`CREATE DATABASE "${name}"`);
  try {
    const connection = new URL(source);
    connection.pathname = '/' + name;
    isolated = new pg.Pool({ connectionString: connection.toString(), max: 3 });
    const planned = planMigrations('migrations');
    const baseline = planned.filter(
      (migration: { version: string }) => migration.version <= '0132',
    );
    const convergence = planned.filter(
      (migration: { version: string }) => migration.version === '0133',
    );
    const client = await isolated.connect();
    try {
      expect(await applyPlan(client, baseline)).toBe(baseline.length);
    } finally {
      client.release();
    }
    const teacher = await seedTeacher(isolated, 'attempt-lifecycle-upgrade');
    const identity = (
      await isolated.query(
        'SELECT account_id,principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
        [teacher.tenantId, teacher.teacherId],
      )
    ).rows[0];
    const classroomId = (
      await isolated.query(
        `INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by)
         VALUES($1,$2,$3,'Lifecycle upgrade',$4) RETURNING id`,
        [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
      )
    ).rows[0].id as string;
    await isolated.query(
      `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
       VALUES($1,$2,$3,$4,'owner')`,
      [teacher.tenantId, classroomId, teacher.teacherId, identity.account_id],
    );

    let sequence = 0;
    async function createReviewed(
      decision: 'accepted' | 'changes_requested',
      points: number | null,
    ) {
      sequence += 1;
      const login = `legacy-lifecycle-${sequence}`;
      const seatId = (
        await isolated!.query(
          `INSERT INTO classroom_student_seats
           (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by)
           VALUES($1,$2,$3,$4,$4,true,'active',$5) RETURNING id`,
          [teacher.tenantId, classroomId, `Legacy ${sequence}`, login, teacher.teacherId],
        )
      ).rows[0].id as string;
      const learnerPrincipal = (
        await isolated!.query('SELECT principal_id FROM student_seat_principal($1)', [seatId])
      ).rows[0].principal_id as string;
      const taskId = (
        await isolated!.query(
          `INSERT INTO teacher_assignments
           (tenant_id,owner_principal_id,title,brief,module_key,visibility)
           VALUES($1,$2,$3,'Legacy review','electronics','private') RETURNING id`,
          [teacher.tenantId, identity.principal_id, `Legacy task ${sequence}`],
        )
      ).rows[0].id as string;
      const assignmentId = (
        await isolated!.query(
          `INSERT INTO classroom_assignments
           (tenant_id,classroom_id,assignment_id,due_at,status,created_by)
           VALUES($1,$2,$3,now()+interval '1 day','open',$4) RETURNING id`,
          [teacher.tenantId, classroomId, taskId, teacher.teacherId],
        )
      ).rows[0].id as string;
      const projectId = (
        await isolated!.query(
          `INSERT INTO projects
           (tenant_id,project_scope,classroom_id,module_key,title,owner_principal_id)
           VALUES($1,'classroom',$2,'electronics',$3,$4) RETURNING id`,
          [teacher.tenantId, classroomId, `Legacy project ${sequence}`, learnerPrincipal],
        )
      ).rows[0].id as string;
      await isolated!.query(
        `INSERT INTO project_drafts
         (tenant_id,project_id,document_json,revision,updated_by_principal_id)
         VALUES($1,$2,'{"schemaVersion":1,"components":[]}'::jsonb,1,$3)`,
        [teacher.tenantId, projectId, learnerPrincipal],
      );
      await isolated!.query(
        `INSERT INTO classroom_assignment_work(tenant_id,assignment_id,seat_id,project_id)
         VALUES($1,$2,$3,$4)`,
        [teacher.tenantId, assignmentId, seatId, projectId],
      );
      const submitted = (
        await isolated!.query('SELECT * FROM learning_project_submission_create($1,$2,$3)', [
          seatId,
          assignmentId,
          `legacy:lifecycle:${sequence}:submit`,
        ])
      ).rows[0];
      expect(submitted.result_code).toBe('ok');
      const reviewed = (
        await isolated!.query(`SELECT * FROM learning_attempt_review($1,$2,$3,$4,$5,$6,$7,$8)`, [
          identity.account_id,
          identity.principal_id,
          classroomId,
          submitted.attempt_id,
          decision,
          points,
          decision === 'accepted' ? 'Принято до 0133' : 'Вернуть до 0133',
          decision === 'changes_requested' ? 'Нужна доработка' : null,
        ])
      ).rows[0];
      expect(reviewed.result_code).toBe('ok');
      return { attemptId: submitted.attempt_id as string, resultId: reviewed.assessment_result_id };
    }

    const accepted = await createReviewed('accepted', 84);
    const returned = await createReviewed('changes_requested', null);
    expect(
      (
        await isolated.query('SELECT state FROM learning_attempts WHERE id=$1', [
          accepted.attemptId,
        ])
      ).rows[0].state,
    ).toBe('accepted');
    expect(
      (
        await isolated.query('SELECT state FROM learning_attempts WHERE id=$1', [
          returned.attemptId,
        ])
      ).rows[0].state,
    ).toBe('changes_requested');
    expect(accepted.resultId).toBeTruthy();
    expect(returned.resultId).toBeNull();

    const upgrade = await isolated.connect();
    try {
      expect(convergence).toHaveLength(1);
      expect(await applyPlan(upgrade, convergence)).toBe(1);
      expect(
        await applyPlan(
          upgrade,
          planned.filter((migration: { version: string }) => migration.version <= '0133'),
        ),
      ).toBe(0);
    } finally {
      upgrade.release();
    }

    const attempts = (
      await isolated.query(
        `SELECT id,state,evaluated_at FROM learning_attempts WHERE id=ANY($1::uuid[]) ORDER BY id`,
        [[accepted.attemptId, returned.attemptId]],
      )
    ).rows;
    expect(attempts).toHaveLength(2);
    expect(attempts.every((attempt) => attempt.state === 'closed')).toBe(true);
    expect(attempts.every((attempt) => attempt.evaluated_at !== null)).toBe(true);

    const acceptedHistory = (
      await isolated.query(
        `SELECT id,revision_number,supersedes_result_id,review_decision,completion_value,raw_points,max_points,outcome
           FROM assessment_results WHERE attempt_id=$1 ORDER BY revision_number`,
        [accepted.attemptId],
      )
    ).rows;
    expect(acceptedHistory).toHaveLength(2);
    expect(acceptedHistory[0]).toMatchObject({
      id: accepted.resultId,
      revision_number: 1,
      supersedes_result_id: null,
      review_decision: null,
    });
    expect(acceptedHistory[1]).toMatchObject({
      revision_number: 2,
      supersedes_result_id: accepted.resultId,
      review_decision: 'accepted',
    });
    const acceptedResult = acceptedHistory[1];
    expect(acceptedResult).toMatchObject({
      review_decision: 'accepted',
      completion_value: true,
      raw_points: 84,
      max_points: 100,
      outcome: 'passed',
    });
    const returnedResult = (
      await isolated.query(
        `SELECT review_decision,completion_value,outcome,correction_reason
           FROM assessment_results WHERE attempt_id=$1 ORDER BY revision_number DESC LIMIT 1`,
        [returned.attemptId],
      )
    ).rows[0];
    expect(returnedResult).toMatchObject({
      review_decision: 'changes_requested',
      completion_value: false,
      outcome: 'incomplete',
      correction_reason: 'Migrated legacy Attempt decision during lifecycle convergence',
    });
    await expect(
      isolated.query("UPDATE learning_attempts SET state='accepted' WHERE id=$1", [
        accepted.attemptId,
      ]),
    ).rejects.toThrow(/learning_attempts_state_check/);
  } finally {
    await isolated?.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}, 60000);

it('0134 clears a stale canonical gradebook pointer without deleting its audit anchor', async () => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) {
    throw new Error('Isolated TEST_DATABASE_URL is required');
  }
  const admin = new pg.Client({ connectionString: source });
  await admin.connect();
  const name = `asa_learning_gradebook_sync_${randomUUID().replaceAll('-', '')}_test`;
  if (!/^asa_learning_gradebook_sync_[a-f0-9]{32}_test$/.test(name)) {
    throw new Error('Unsafe generated database name');
  }
  let isolated: pg.Pool | null = null;
  await admin.query(`CREATE DATABASE "${name}"`);
  try {
    const connection = new URL(source);
    connection.pathname = '/' + name;
    isolated = new pg.Pool({ connectionString: connection.toString(), max: 3 });
    const planned = planMigrations('migrations');
    const baseline = planned.filter(
      (migration: { version: string }) => migration.version <= '0133',
    );
    const convergence = planned.filter(
      (migration: { version: string }) => migration.version === '0134',
    );
    const through0134 = planned.filter(
      (migration: { version: string }) => migration.version <= '0134',
    );
    const migrate = await isolated.connect();
    try {
      expect(await applyPlan(migrate, baseline)).toBe(baseline.length);
    } finally {
      migrate.release();
    }
    const teacher = await seedTeacher(isolated, 'gradebook-sync-upgrade');
    const identity = (
      await isolated.query(
        'SELECT account_id,principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
        [teacher.tenantId, teacher.teacherId],
      )
    ).rows[0];
    const classroomId = (
      await isolated.query(
        `INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by)
         VALUES($1,$2,$3,'Gradebook sync upgrade',$4) RETURNING id`,
        [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
      )
    ).rows[0].id as string;
    await isolated.query(
      `INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role)
       VALUES($1,$2,$3,$4,'owner')`,
      [teacher.tenantId, classroomId, teacher.teacherId, identity.account_id],
    );
    const seatId = (
      await isolated.query(
        `INSERT INTO classroom_student_seats
         (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by)
         VALUES($1,$2,'Legacy pointer','grade-sync-legacy','grade-sync-legacy',true,'issued',$3) RETURNING id`,
        [teacher.tenantId, classroomId, teacher.teacherId],
      )
    ).rows[0].id as string;
    const inTenant = async (text: string, values: unknown[]) => {
      const client = await isolated!.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [teacher.tenantId]);
        const result = await client.query(text, values);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };
    const authored = await isolated.query(
      `INSERT INTO teacher_assignments(tenant_id,owner_principal_id,title,brief,module_key,visibility)
       VALUES($1,$2,'Legacy selected result','Review','electronics','private') RETURNING id`,
      [teacher.tenantId, identity.principal_id],
    );
    const policies = {
      attemptPolicy: { maxAttempts: 1 },
      resultSelectionPolicy: { mode: 'latest_accepted' },
      completionPolicy: { mode: 'submission' },
      latePolicy: { mode: 'allow_mark_late' },
      assessmentPolicy: { mode: 'manual' },
      feedbackReleasePolicy: { mode: 'after_review' },
    };
    const created = await inTenant(
      `SELECT * FROM learning_activity_create(
       $1,$2,'school','private','project',$3,'ignored',$7,$8,
       $4::jsonb,'electronics',NULL,NULL,$5,$6)`,
      [
        identity.principal_id,
        teacher.tenantId,
        'Legacy selected result',
        JSON.stringify(policies),
        authored.rows[0].id,
        'upgrade:grade-sync:create',
        'graded',
        10,
      ],
    );
    const published = await inTenant(`SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)`, [
      identity.principal_id,
      teacher.tenantId,
      created.rows[0].activity_id,
      'upgrade:grade-sync:publish',
    ]);
    const assigned = await inTenant(
      `SELECT * FROM learning_direct_assignment_create(
       $1,$2,$3,$4,'2027-05-30T20:59:00Z',$5,$6::uuid[],$7)`,
      [
        identity.principal_id,
        teacher.tenantId,
        classroomId,
        published.rows[0].activity_version_id,
        'whole_class',
        [],
        'upgrade:grade-sync:assign',
      ],
    );
    expect(assigned.rows[0].result_code).toBe('ok');
    const assignmentId = assigned.rows[0].classroom_assignment_id as string;
    await isolated.query(`UPDATE classroom_student_seats SET status='active' WHERE id=$1`, [
      seatId,
    ]);
    const learnerPrincipal = (
      await isolated.query('SELECT principal_id FROM student_seat_principal($1)', [seatId])
    ).rows[0].principal_id as string;
    const projectId = (
      await isolated.query(
        `INSERT INTO projects(tenant_id,project_scope,module_key,title,owner_principal_id)
         VALUES($1,'personal','electronics','Legacy pointer project',$2) RETURNING id`,
        [teacher.tenantId, learnerPrincipal],
      )
    ).rows[0].id as string;
    await isolated.query(
      `INSERT INTO project_drafts(tenant_id,project_id,document_json,revision,updated_by_principal_id)
       VALUES($1,$2,$3::jsonb,1,$4)`,
      [
        teacher.tenantId,
        projectId,
        JSON.stringify({ schemaVersion: 1, components: [] }),
        learnerPrincipal,
      ],
    );
    const started = (
      await inTenant('SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)', [
        learnerPrincipal,
        seatId,
        assignmentId,
        projectId,
      ])
    ).rows[0];
    expect(started.result_code).toBe('ok');
    const submitted = (
      await inTenant('SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4,1)', [
        learnerPrincipal,
        seatId,
        assignmentId,
        'upgrade:grade-sync:submit',
      ])
    ).rows[0];
    expect(submitted.result_code).toBe('ok');
    const accepted = (
      await inTenant(
        "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'accepted',8,'Accepted',NULL,NULL,$5)",
        [
          identity.account_id,
          identity.principal_id,
          classroomId,
          started.attempt_id,
          'upgrade:grade-sync:accepted',
        ],
      )
    ).rows[0];
    expect(accepted.result_code).toBe('ok');
    const staleGrade = (
      await isolated.query(
        'SELECT id,accepted_attempt_id,assessment_result_id FROM gradebook_entries WHERE classroom_assignment_id=$1 AND seat_id=$2',
        [assignmentId, seatId],
      )
    ).rows[0];
    expect(staleGrade.assessment_result_id).toBe(accepted.assessment_result_id);
    const incomplete = (
      await inTenant(
        "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'incomplete',NULL,'No final grade','Correction',$5,$6)",
        [
          identity.account_id,
          identity.principal_id,
          classroomId,
          started.attempt_id,
          accepted.assessment_result_id,
          'upgrade:grade-sync:incomplete',
        ],
      )
    ).rows[0];
    expect(incomplete.result_code).toBe('ok');
    const participationId = started.participation_id as string;
    expect(
      (
        await isolated.query('SELECT * FROM learning_selected_result_internal($1)', [
          participationId,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await isolated.query(
          'SELECT accepted_attempt_id,assessment_result_id FROM gradebook_entries WHERE id=$1',
          [staleGrade.id],
        )
      ).rows[0],
    ).toEqual({
      accepted_attempt_id: started.attempt_id,
      assessment_result_id: accepted.assessment_result_id,
    });

    const upgrade = await isolated.connect();
    try {
      expect(convergence).toHaveLength(1);
      expect(await applyPlan(upgrade, convergence)).toBe(1);
      expect(await applyPlan(upgrade, through0134)).toBe(0);
    } finally {
      upgrade.release();
    }
    expect(
      (
        await isolated.query(
          'SELECT id,accepted_attempt_id,assessment_result_id FROM gradebook_entries WHERE id=$1',
          [staleGrade.id],
        )
      ).rows[0],
    ).toEqual({ id: staleGrade.id, accepted_attempt_id: null, assessment_result_id: null });
    expect(
      (
        await isolated.query('SELECT * FROM learning_selected_result_internal($1)', [
          participationId,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      Number(
        (
          await isolated.query(
            'SELECT count(*) AS count FROM grade_change_events WHERE gradebook_entry_id=$1',
            [staleGrade.id],
          )
        ).rows[0].count,
      ),
    ).toBe(1);
  } finally {
    await isolated?.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}, 60000);

it('0135 adds batch StudentSeat support without rewriting existing Seat credentials', async () => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) {
    throw new Error('Isolated TEST_DATABASE_URL is required');
  }
  const admin = new pg.Client({ connectionString: source });
  await admin.connect();
  const name = `asa_studentseat_batch_upgrade_${randomUUID().replaceAll('-', '')}_test`;
  if (!/^asa_studentseat_batch_upgrade_[a-f0-9]{32}_test$/.test(name)) {
    throw new Error('Unsafe generated database name');
  }
  let isolated: pg.Pool | null = null;
  await admin.query(`CREATE DATABASE "${name}"`);
  try {
    const connection = new URL(source);
    connection.pathname = '/' + name;
    isolated = new pg.Pool({ connectionString: connection.toString(), max: 3 });
    const planned = planMigrations('migrations');
    const baseline = planned.filter(
      (migration: { version: string }) => migration.version <= '0134',
    );
    const throughBatch = planned.filter(
      (migration: { version: string }) => migration.version <= '0135',
    );
    const batchMigration = planned.filter(
      (migration: { version: string }) => migration.version === '0135',
    );
    const client = await isolated.connect();
    try {
      expect(await applyPlan(client, baseline)).toBe(baseline.length);
    } finally {
      client.release();
    }

    const teacher = await seedTeacher(isolated, 'studentseat-batch-upgrade');
    const identity = (
      await isolated.query(
        'SELECT account_id,principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
        [teacher.tenantId, teacher.teacherId],
      )
    ).rows[0];
    const classroomId = (
      await isolated.query(
        `INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by)
         VALUES($1,$2,$3,'Batch upgrade',$4) RETURNING id`,
        [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
      )
    ).rows[0].id as string;
    await isolated.query(
      `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
       VALUES($1,$2,$3,$4,'owner')`,
      [teacher.tenantId, classroomId, teacher.teacherId, identity.account_id],
    );
    const seatId = (
      await isolated.query(
        `INSERT INTO classroom_student_seats
         (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by)
         VALUES($1,$2,'Existing Learner','existing-batch','existing-batch',true,'active',$3)
         RETURNING id`,
        [teacher.tenantId, classroomId, teacher.teacherId],
      )
    ).rows[0].id as string;
    const credentialRequest = randomUUID();
    await isolated.query(
      `INSERT INTO classroom_seat_credentials
       (seat_id,credential_hash,version,last_request_id,issued_by_account_id,issued_at)
       VALUES($1,$2,4,$3,$4,'2026-09-01T10:00:00Z')`,
      [seatId, 'a'.repeat(64), credentialRequest, identity.account_id],
    );
    await isolated.query(
      `INSERT INTO classroom_seat_credential_receipts(seat_id,request_id,version)
       VALUES($1,$2,4)`,
      [seatId, credentialRequest],
    );
    const beforeSeat = (
      await isolated.query('SELECT to_jsonb(s) AS row FROM classroom_student_seats s WHERE id=$1', [
        seatId,
      ])
    ).rows[0].row;
    const beforeCredential = (
      await isolated.query(
        'SELECT to_jsonb(c) AS row FROM classroom_seat_credentials c WHERE seat_id=$1',
        [seatId],
      )
    ).rows[0].row;
    const beforeReceipt = (
      await isolated.query(
        'SELECT to_jsonb(r) AS row FROM classroom_seat_credential_receipts r WHERE seat_id=$1',
        [seatId],
      )
    ).rows[0].row;

    const upgrade = await isolated.connect();
    try {
      expect(batchMigration).toHaveLength(1);
      expect(await applyPlan(upgrade, batchMigration)).toBe(1);
      expect(await applyPlan(upgrade, throughBatch)).toBe(0);
    } finally {
      upgrade.release();
    }

    expect(
      (
        await isolated.query(
          'SELECT to_jsonb(s) AS row FROM classroom_student_seats s WHERE id=$1',
          [seatId],
        )
      ).rows[0].row,
    ).toEqual(beforeSeat);
    expect(
      (
        await isolated.query(
          'SELECT to_jsonb(c) AS row FROM classroom_seat_credentials c WHERE seat_id=$1',
          [seatId],
        )
      ).rows[0].row,
    ).toEqual(beforeCredential);
    expect(
      (
        await isolated.query(
          'SELECT to_jsonb(r) AS row FROM classroom_seat_credential_receipts r WHERE seat_id=$1',
          [seatId],
        )
      ).rows[0].row,
    ).toEqual(beforeReceipt);
    expect(
      Number(
        (await isolated.query('SELECT count(*) AS n FROM classroom_student_seat_batches')).rows[0]
          .n,
      ),
    ).toBe(0);
    expect(
      Number(
        (await isolated.query('SELECT count(*) AS n FROM classroom_student_seat_batch_rows'))
          .rows[0].n,
      ),
    ).toBe(0);

    const same = (
      await isolated.query(
        `SELECT row_status,reason_code FROM classroom_student_seat_batch_preview($1,$2,$3::jsonb)`,
        [
          identity.account_id,
          classroomId,
          JSON.stringify([
            { displayLabel: 'Existing Learner', loginHandle: 'existing-batch', safeMode: true },
          ]),
        ],
      )
    ).rows[0];
    expect(same).toEqual({ row_status: 'duplicate', reason_code: 'existing_same_seat' });
    const conflict = (
      await isolated.query(
        `SELECT row_status,reason_code FROM classroom_student_seat_batch_preview($1,$2,$3::jsonb)`,
        [
          identity.account_id,
          classroomId,
          JSON.stringify([
            { displayLabel: 'Different Learner', loginHandle: 'existing-batch', safeMode: true },
          ]),
        ],
      )
    ).rows[0];
    expect(conflict).toEqual({ row_status: 'conflict', reason_code: 'handle_in_use' });
  } finally {
    await isolated?.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}, 60000);
