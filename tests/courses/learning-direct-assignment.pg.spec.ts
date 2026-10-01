import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import { buildTestApp, inject } from '../portal/app';
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
         (tenant_id,classroom_id,created_by,learning_activity_version_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
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
    const learnerAccount = (
      await admin.query(
        `INSERT INTO accounts (email,password_hash,birth_date,country)
         VALUES ('legacy-classroom-' || gen_random_uuid()::text || '@test.local',
                 'isolated-test-only',DATE '2000-01-01','RU') RETURNING id`,
      )
    ).rows[0].id as string;
    const accountPrincipal = (
      await admin.query(
        `INSERT INTO principals (kind,account_id) VALUES ('account',$1) RETURNING id`,
        [learnerAccount],
      )
    ).rows[0].id as string;
    await admin.query(`UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2`, [
      learnerAccount,
      learnerSeat,
    ]);
    await admin.query(
      `INSERT INTO learner_identity_links
         (id,tenant_id,school_id,learner_identity_id,link_kind,account_id)
        VALUES (gen_random_uuid(),$1,$2,$3,'account',$4)`,
      [owner.tenantId, owner.schoolId, identity.rows[0].learner_identity_id, learnerAccount],
    );
    // Legacy account-based classroom memberships still contain student rows.
    // They must not make another Seat's claimed work readable as a class Project.
    const studentMember = async (accountId: string, label: string) => {
      const user = await admin.query(
        `INSERT INTO users (tenant_id,school_id,role,email,display_name,password_hash)
         VALUES ($1,$2,'teacher',$3,$4,'isolated-test-only') RETURNING id`,
        [owner.tenantId, owner.schoolId, `${label}-${++sequence}@test.local`, label],
      );
      await admin.query(
        `INSERT INTO classroom_memberships
           (tenant_id,classroom_id,user_id,account_id,member_role)
         VALUES ($1,$2,$3,$4,'student')`,
        [owner.tenantId, classId, user.rows[0].id, accountId],
      );
      return user.rows[0].id as string;
    };
    const learnerUser = await studentMember(learnerAccount, 'linked-member');
    const foreignAccount = (
      await admin.query(
        `INSERT INTO accounts (email,password_hash,birth_date,country)
         VALUES ('other-classroom-' || gen_random_uuid()::text || '@test.local',
                 'isolated-test-only',DATE '2000-01-01','RU') RETURNING id`,
      )
    ).rows[0].id as string;
    const foreignAccountPrincipal = (
      await admin.query(
        `INSERT INTO principals (kind,account_id) VALUES ('account',$1) RETURNING id`,
        [foreignAccount],
      )
    ).rows[0].id as string;
    await admin.query(`UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2`, [
      foreignAccount,
      otherSeat,
    ]);
    const foreignUser = await studentMember(foreignAccount, 'foreign-member');
    const accountProject = await admin.query(
      `INSERT INTO projects (tenant_id,project_scope,module_key,title,owner_principal_id)
       VALUES ($1,'personal','electronics','Account generic work',$2) RETURNING id`,
      [owner.tenantId, principal],
    );
    expect(await proof(accountPrincipal, learnerSeat, accountProject.rows[0].id)).toMatchObject({
      legacyDirect: true,
      startAllowed: false,
      submitAllowed: false,
    });
    const projectId = (
      await admin.query(
        `INSERT INTO projects
           (tenant_id,project_scope,classroom_id,module_key,title,owner_principal_id)
         VALUES ($1,'classroom',$2,'electronics','Историческая работа',$3) RETURNING id`,
        [owner.tenantId, classId, learnerPrincipal],
      )
    ).rows[0].id as string;
    const projectContext = async (actor: string, target: string) =>
      inTenant((client) =>
        client.query(`SELECT * FROM project_context_for_principal($1,$2)`, [actor, target]),
      );
    const projects = new PgProjectRepository(app);
    const listed = async (actor: string, userId: string) =>
      projects.listForActor(owner.tenantId, { principalId: actor, userId }, {});
    expect((await projectContext(learnerPrincipal, projectId)).rows).toHaveLength(0);
    expect(
      await new PgProjectRepository(app).authorize(
        owner.tenantId,
        projectId,
        learnerPrincipal,
        'read',
      ),
    ).toBeNull();
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
    expect((await projectContext(learnerPrincipal, projectId)).rows).toHaveLength(1);
    expect(
      await new PgProjectRepository(app).authorize(
        owner.tenantId,
        projectId,
        learnerPrincipal,
        'read',
      ),
    ).toMatchObject({ projectId });
    expect(
      await new PgProjectRepository(app).authorize(
        owner.tenantId,
        projectId,
        learnerPrincipal,
        'edit',
      ),
    ).toMatchObject({ projectId });
    expect(await proof(accountPrincipal, learnerSeat, projectId)).toMatchObject({
      legacyProjectReadable: true,
      submitAllowed: true,
    });
    expect((await projectContext(accountPrincipal, projectId)).rows).toHaveLength(1);
    expect(
      await new PgProjectRepository(app).authorize(
        owner.tenantId,
        projectId,
        accountPrincipal,
        'edit',
      ),
    ).toMatchObject({ projectId });
    expect(
      await projects.load(owner.tenantId, projectId, {
        principalId: accountPrincipal,
        userId: learnerUser,
      }),
    ).toMatchObject({ project: { id: projectId } });
    expect((await listed(accountPrincipal, learnerUser)).map((project) => project.id)).toContain(
      projectId,
    );
    expect((await projectContext(foreignAccountPrincipal, projectId)).rows).toHaveLength(0);
    expect(
      await projects.authorize(owner.tenantId, projectId, foreignAccountPrincipal, 'read'),
    ).toBeNull();
    expect(
      await projects.authorize(owner.tenantId, projectId, foreignAccountPrincipal, 'edit'),
    ).toBeNull();
    expect(
      await projects.load(owner.tenantId, projectId, {
        principalId: foreignAccountPrincipal,
        userId: foreignUser,
      }),
    ).toBeNull();
    expect(
      (await listed(foreignAccountPrincipal, foreignUser)).map((project) => project.id),
    ).not.toContain(projectId);
    expect((await projectContext(principal, projectId)).rows).toHaveLength(1);
    expect(await projects.authorize(owner.tenantId, projectId, principal, 'edit')).toMatchObject({
      projectId,
    });
    expect(
      (
        await projects.listForActor(
          owner.tenantId,
          {
            principalId: principal,
            userId: owner.teacherId,
          },
          { scope: 'classroom', classroomId: classId },
        )
      ).map((project) => project.id),
    ).toContain(projectId);
    await admin.query(
      `UPDATE learner_identity_links SET status='inactive',disabled_at=now()
        WHERE account_id=$1 AND link_kind='account'`,
      [learnerAccount],
    );
    expect(await proof(accountPrincipal, learnerSeat, projectId)).toMatchObject({
      legacyProjectReadable: false,
      submitAllowed: false,
    });
    expect((await projectContext(accountPrincipal, projectId)).rows).toHaveLength(0);
    expect(
      await projects.authorize(owner.tenantId, projectId, accountPrincipal, 'read'),
    ).toBeNull();
    expect(
      await projects.load(owner.tenantId, projectId, {
        principalId: accountPrincipal,
        userId: learnerUser,
      }),
    ).toBeNull();
    expect(
      (await listed(accountPrincipal, learnerUser)).map((project) => project.id),
    ).not.toContain(projectId);
    expect(await proof(learnerPrincipal, learnerSeat, projectId)).toMatchObject({
      legacyProjectReadable: true,
      submitAllowed: true,
    });
    await admin.query(
      `UPDATE learner_identity_links SET status='active',disabled_at=NULL
        WHERE account_id=$1 AND link_kind='account'`,
      [learnerAccount],
    );
    expect(await proof(otherPrincipal, learnerSeat, projectId)).toMatchObject({
      startAllowed: false,
      submitAllowed: false,
    });
    expect((await projectContext(otherPrincipal, projectId)).rows).toHaveLength(0);
    const unlinkedProject = (
      await admin.query(
        `INSERT INTO projects
           (tenant_id,project_scope,classroom_id,module_key,title,owner_principal_id)
         VALUES ($1,'classroom',$2,'electronics','Unlinked classroom work',$3) RETURNING id`,
        [owner.tenantId, classId, learnerPrincipal],
      )
    ).rows[0].id as string;
    expect((await projectContext(learnerPrincipal, unlinkedProject)).rows).toHaveLength(0);
    // Ordinary classroom Projects retain the existing student membership read.
    expect((await projectContext(foreignAccountPrincipal, unlinkedProject)).rows).toHaveLength(1);
    const otherClassId = await classroom();
    const wrongClassProject = (
      await admin.query(
        `INSERT INTO projects
           (tenant_id,project_scope,classroom_id,module_key,title,owner_principal_id)
         VALUES ($1,'classroom',$2,'electronics','Wrong classroom work',$3) RETURNING id`,
        [owner.tenantId, otherClassId, learnerPrincipal],
      )
    ).rows[0].id as string;
    await admin.query(
      `UPDATE classroom_assignment_work SET project_id=$1
      WHERE assignment_id=$2 AND seat_id=$3`,
      [wrongClassProject, assignmentId, learnerSeat],
    );
    expect((await projectContext(learnerPrincipal, wrongClassProject)).rows).toHaveLength(0);
    expect(await proof(learnerPrincipal, learnerSeat, wrongClassProject)).toMatchObject({
      legacyProjectReadable: false,
      submitAllowed: false,
    });
    await admin.query(
      `UPDATE classroom_assignment_work SET project_id=$1
      WHERE assignment_id=$2 AND seat_id=$3`,
      [projectId, assignmentId, learnerSeat],
    );
    const foreignOwnedProject = (
      await admin.query(
        `INSERT INTO projects
           (tenant_id,project_scope,classroom_id,module_key,title,owner_principal_id)
         VALUES ($1,'classroom',$2,'electronics','Other learner work',$3) RETURNING id`,
        [owner.tenantId, classId, otherPrincipal],
      )
    ).rows[0].id as string;
    await admin.query(
      `UPDATE classroom_assignment_work SET project_id=$1
      WHERE assignment_id=$2 AND seat_id=$3`,
      [foreignOwnedProject, assignmentId, learnerSeat],
    );
    expect((await projectContext(learnerPrincipal, foreignOwnedProject)).rows).toHaveLength(0);
    expect(await proof(accountPrincipal, learnerSeat, foreignOwnedProject)).toMatchObject({
      legacyProjectReadable: false,
      submitAllowed: false,
    });
    await admin.query(
      `UPDATE classroom_assignment_work SET project_id=$1
      WHERE assignment_id=$2 AND seat_id=$3`,
      [projectId, assignmentId, learnerSeat],
    );
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
    expect(await proof(accountPrincipal, learnerSeat, projectId)).toMatchObject({
      legacyProjectReadable: false,
      submitAllowed: false,
    });
    expect((await projectContext(learnerPrincipal, projectId)).rows).toHaveLength(0);
    expect((await projectContext(accountPrincipal, projectId)).rows).toHaveLength(0);
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
    const unboundProjectId = (
      await admin.query(
        `INSERT INTO projects (tenant_id,project_scope,module_key,title,owner_principal_id)
         VALUES ($1,'personal','electronics','Unbound old course work',$2) RETURNING id`,
        [owner.tenantId, learnerPrincipal],
      )
    ).rows[0].id as string;
    const seatToken = `old-course-${randomUUID()}`;
    await admin.query(
      `INSERT INTO classroom_seat_credentials
         (seat_id,credential_hash,version,last_request_id,issued_by_account_id)
       VALUES ($1,$2,1,$3,$4)`,
      [learnerSeat, createHash('sha256').update(randomUUID()).digest('hex'), randomUUID(), account],
    );
    await admin.query(
      `INSERT INTO classroom_student_sessions
         (seat_id,token_hash,expires_at,credential_version)
       VALUES ($1,$2,now()+interval '1 hour',1)`,
      [learnerSeat, createHash('sha256').update(seatToken).digest('hex')],
    );
    const wrongSeatToken = `wrong-old-course-${randomUUID()}`;
    await admin.query(
      `INSERT INTO classroom_seat_credentials
         (seat_id,credential_hash,version,last_request_id,issued_by_account_id)
       VALUES ($1,$2,1,$3,$4)`,
      [wrongSeat, createHash('sha256').update(randomUUID()).digest('hex'), randomUUID(), account],
    );
    await admin.query(
      `INSERT INTO classroom_student_sessions
         (seat_id,token_hash,expires_at,credential_version)
       VALUES ($1,$2,now()+interval '1 hour',1)`,
      [wrongSeat, createHash('sha256').update(wrongSeatToken).digest('hex')],
    );
    const api = await buildTestApp(testAppPool());
    const continueWork = (candidate: string, token = seatToken) =>
      inject(api, {
        method: 'POST',
        url: `/api/class-join/me/assignments/${handout.rows[0].id}/work`,
        cookies: { asa_student_session: token },
        payload: { projectId: candidate },
      });
    try {
      const linked = await continueWork(projectId);
      expect(linked.statusCode).toBe(200);
      expect(linked.json()).toMatchObject({ projectId, reused: true, attemptId: null });
      const unbound = await continueWork(unboundProjectId);
      expect(unbound.statusCode).toBe(409);
      expect(unbound.body).not.toContain(unboundProjectId);
      const wrongSeatResponse = await continueWork(projectId, wrongSeatToken);
      expect(wrongSeatResponse.statusCode).toBe(409);
      expect(wrongSeatResponse.body).not.toContain(projectId);
      const first = await inject(api, {
        method: 'POST',
        url: `/api/class-join/me/assignments/${handout.rows[0].id}/submit`,
        cookies: { asa_student_session: seatToken },
        payload: { submitted: true, clientRequestId: `old-course:first:${randomUUID()}` },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ projectId, attemptNumber: 1 });
      expect(
        (
          await admin.query(`SELECT * FROM learning_attempt_review($1,$2,$3,$4,$5,$6,$7,$8)`, [
            account,
            principal,
            classId,
            first.json().attemptId,
            'changes_requested',
            null,
            'Please revise',
            'Needs correction',
          ])
        ).rows[0],
      ).toMatchObject({ result_code: 'ok', attempt_state: 'closed' });
      const rework = await continueWork(projectId);
      expect(rework.statusCode).toBe(200);
      expect(rework.json()).toMatchObject({ projectId, reused: true });
      await admin.query(
        `UPDATE project_drafts
            SET document_json='{"schemaVersion":1,"components":[{"kind":"reworked"}]}'::jsonb,
                revision=revision+1 WHERE project_id=$1`,
        [projectId],
      );
      const second = await inject(api, {
        method: 'POST',
        url: `/api/class-join/me/assignments/${handout.rows[0].id}/submit`,
        cookies: { asa_student_session: seatToken },
        payload: { submitted: true, clientRequestId: `old-course:second:${randomUUID()}` },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ projectId, attemptNumber: 2 });
      expect(second.json().attemptId).not.toBe(first.json().attemptId);
      expect(
        (
          await admin.query(
            `SELECT count(*)::integer AS count FROM classroom_assignment_work
              WHERE assignment_id=$1 AND seat_id=$2 AND project_id=$3`,
            [handout.rows[0].id, learnerSeat, projectId],
          )
        ).rows[0].count,
      ).toBe(1);
      expect(
        (
          await admin.query(
            `SELECT count(*)::integer AS count FROM learning_project_origins WHERE project_id=$1`,
            [projectId],
          )
        ).rows[0].count,
      ).toBe(0);
      await admin.query(`UPDATE classroom_course_runs SET status='closed' WHERE id=$1`, [
        run.rows[0].id,
      ]);
      expect((await continueWork(projectId)).statusCode).toBe(409);
      await admin.query(`UPDATE classroom_course_runs SET status='open' WHERE id=$1`, [
        run.rows[0].id,
      ]);
      await admin.query(`SELECT learning_audience_ensure_seat_identity($1)`, [learnerSeat]);
      await admin.query(
        `UPDATE learner_identity_links SET status='inactive',disabled_at=now()
         WHERE seat_id=$1 AND link_kind='student_seat'`,
        [learnerSeat],
      );
      expect((await continueWork(projectId)).statusCode).toBe(409);
      await admin.query(
        `UPDATE learner_identity_links SET status='active',disabled_at=NULL
         WHERE seat_id=$1 AND link_kind='student_seat'`,
        [learnerSeat],
      );
    } finally {
      await api.close();
    }
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
