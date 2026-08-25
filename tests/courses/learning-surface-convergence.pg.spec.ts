import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let teacher: SeededTeacher;
let accountId: string;
let principalId: string;
let classroomId: string;
let seatId: string;
let assignmentId: string;

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  teacher = await seedTeacher(admin, 'learning-m0-007');
  const identity = await admin.query(
    `SELECT account_id,principal_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [teacher.tenantId, teacher.teacherId],
  );
  accountId = identity.rows[0].account_id as string;
  principalId = identity.rows[0].principal_id as string;
  const classroom = await admin.query(
    `INSERT INTO classrooms
       (tenant_id,school_id,academic_period_id,title,created_by)
     VALUES ($1,$2,$3,'LRN M0-007',$4) RETURNING id`,
    [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
  );
  classroomId = classroom.rows[0].id as string;
  await admin.query(
    `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES ($1,$2,$3,$4,'owner')`,
    [teacher.tenantId, classroomId, teacher.teacherId, accountId],
  );
  const seat = await admin.query(
    `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
        safe_mode,status,created_by)
     VALUES ($1,$2,'Legacy learner','m007-legacy','m007-legacy',true,'active',$3)
     RETURNING id`,
    [teacher.tenantId, classroomId, teacher.teacherId],
  );
  seatId = seat.rows[0].id as string;
  const seatPrincipal = await admin.query(`SELECT principal_id FROM student_seat_principal($1)`, [
    seatId,
  ]);
  const task = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES ($1,$2,'Legacy submitted','Evidence fixture','electronics','private') RETURNING id`,
    [teacher.tenantId, principalId],
  );
  const assignment = await admin.query(
    `INSERT INTO classroom_assignments
       (tenant_id,classroom_id,assignment_id,status,created_by)
     VALUES ($1,$2,$3,'open',$4) RETURNING id`,
    [teacher.tenantId, classroomId, task.rows[0].id, teacher.teacherId],
  );
  assignmentId = assignment.rows[0].id as string;
  const project = await admin.query(
    `INSERT INTO projects
       (tenant_id,project_scope,classroom_id,module_key,title,owner_principal_id)
     VALUES ($1,'classroom',$2,'electronics','Legacy project',$3) RETURNING id`,
    [teacher.tenantId, classroomId, seatPrincipal.rows[0].principal_id],
  );
  await admin.query(
    `INSERT INTO classroom_assignment_work
       (tenant_id,assignment_id,seat_id,project_id,started_at,submitted_at)
     VALUES ($1,$2,$3,$4,'2026-08-24T10:00:00Z','2026-08-24T11:00:00Z')`,
    [teacher.tenantId, assignmentId, seatId, project.rows[0].id],
  );
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('LRN-M0-007 canonical read projection', () => {
  it('returns identical legacy-submitted evidence to learner and authorized teacher in one query each', async () => {
    const learner = await app.query(
      `SELECT evidence FROM learning_canonical_evidence_for_seat($1)`,
      [seatId],
    );
    const teacherView = await app.query(
      `SELECT evidence FROM learning_canonical_evidence_for_teacher($1,$2)`,
      [accountId, classroomId],
    );
    expect(learner.rows).toHaveLength(1);
    expect(teacherView.rows).toHaveLength(1);
    expect(learner.rows[0].evidence).toMatchObject({
      seatId,
      classroomAssignmentId: assignmentId,
      kind: 'direct_project',
      attempt: null,
      resultSelectionSource: 'none',
    });
    expect(teacherView.rows[0].evidence).toEqual(learner.rows[0].evidence);
  });

  it('denies outsiders and direct internal UUID access', async () => {
    const outsider = await seedTeacher(admin, 'learning-m0-007-outsider');
    const identity = await admin.query(
      `SELECT account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2`,
      [outsider.tenantId, outsider.teacherId],
    );
    const hidden = await app.query(
      `SELECT evidence FROM learning_canonical_evidence_for_teacher($1,$2)`,
      [identity.rows[0].account_id, classroomId],
    );
    expect(hidden.rows).toHaveLength(0);
    await expect(
      app.query(`SELECT evidence FROM learning_canonical_evidence_internal($1,$2,true)`, [
        classroomId,
        seatId,
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it('separates current learner access from authorized teacher history', async () => {
    await admin.query(`UPDATE classrooms SET status='archived' WHERE id=$1`, [classroomId]);
    const ended = await app.query(`SELECT evidence FROM learning_canonical_evidence_for_seat($1)`, [
      seatId,
    ]);
    expect(ended.rows[0].evidence.classroomAccess).toBe('ended');
    await admin.query(`UPDATE classrooms SET status='active' WHERE id=$1`, [classroomId]);
    await admin.query(`UPDATE classroom_student_seats SET status='suspended' WHERE id=$1`, [
      seatId,
    ]);
    const learner = await app.query(
      `SELECT evidence FROM learning_canonical_evidence_for_seat($1)`,
      [seatId],
    );
    const teacherView = await app.query(
      `SELECT evidence FROM learning_canonical_evidence_for_teacher($1,$2)`,
      [accountId, classroomId],
    );
    expect(learner.rows).toHaveLength(0);
    expect(teacherView.rows).toHaveLength(1);
    expect(teacherView.rows[0].evidence.seatStatus).toBe('suspended');
    await admin.query(`UPDATE classroom_student_seats SET status='removed' WHERE id=$1`, [seatId]);
    const removedHistory = await app.query(
      `SELECT evidence FROM learning_canonical_evidence_for_teacher($1,$2)`,
      [accountId, classroomId],
    );
    expect(removedHistory.rows[0].evidence.seatStatus).toBe('removed');
  });

  it('projects 30 learners x 100 assignments with one database query', async () => {
    const perfClass = await admin.query(
      `INSERT INTO classrooms
         (tenant_id,school_id,academic_period_id,title,created_by)
       VALUES ($1,$2,$3,'LRN M0-007 performance',$4) RETURNING id`,
      [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
    );
    const perfClassId = perfClass.rows[0].id as string;
    await admin.query(
      `INSERT INTO classroom_memberships
         (tenant_id,classroom_id,user_id,account_id,member_role)
       VALUES ($1,$2,$3,$4,'owner')`,
      [teacher.tenantId, perfClassId, teacher.teacherId, accountId],
    );
    await admin.query(
      `INSERT INTO classroom_student_seats
         (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
          safe_mode,status,created_by)
       SELECT $1,$2,'Learner '||n,'m007-perf-'||n,'m007-perf-'||n,true,'active',$3
         FROM generate_series(1,30) n`,
      [teacher.tenantId, perfClassId, teacher.teacherId],
    );
    await admin.query(
      `WITH tasks AS (
         INSERT INTO teacher_assignments
           (tenant_id,owner_principal_id,title,brief,module_key,visibility)
         SELECT $1,$2,'Task '||n,'Performance','electronics','private'
           FROM generate_series(1,100) n
         RETURNING id
       )
       INSERT INTO classroom_assignments
         (tenant_id,classroom_id,assignment_id,status,created_by)
       SELECT $1,$3,id,'open',$4 FROM tasks`,
      [teacher.tenantId, principalId, perfClassId, teacher.teacherId],
    );
    const started = performance.now();
    const result = await app.query(
      `SELECT evidence FROM learning_canonical_evidence_for_teacher($1,$2)`,
      [accountId, perfClassId],
    );
    const elapsedMs = performance.now() - started;
    console.info(
      `LRN-M0-007 performance rows=${result.rows.length} queries=1 elapsedMs=${elapsedMs.toFixed(1)}`,
    );
    expect(result.rows).toHaveLength(3000);
    expect(elapsedMs).toBeLessThan(10_000);
  }, 30_000);
});
