import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { expect } from 'vitest';
import { seedTeacher } from './helpers';
export async function studentProjectPolicyFixture(admin: pg.Pool, runtime: pg.Pool) {
  const teacher = await seedTeacher(admin as pg.Pool, `distribution-${randomUUID().slice(0, 8)}`);
  const identity = (
    await admin.query(
      'SELECT account_id,principal_id FROM legacy_user_account_links WHERE user_id=$1',
      [teacher.teacherId],
    )
  ).rows[0]!;
  const actor = identity['principal_id'] as string;
  const account = identity['account_id'] as string;
  const classroomId = randomUUID();
  await admin.query(
    `INSERT INTO classrooms(id,tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,$4,'Publication policy',$5)`,
    [classroomId, teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
  );
  await admin.query(
    `INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')`,
    [teacher.tenantId, classroomId, teacher.teacherId, account],
  );
  const seatId = (
    await admin.query(`SELECT id FROM classroom_management_add_seat($1,$2,'Learner',$3,true)`, [
      account,
      classroomId,
      randomUUID().slice(0, 8),
    ])
  ).rows[0]!['id'] as string;
  // The canonical creation command materializes a genuinely new StudentCode
  // Seat, before sign-in or any teacher roster/participant preparation.
  expect(
    (
      await admin.query(
        `SELECT count(*)::int n FROM learner_identity_links link
     JOIN learner_identities learner ON learner.id=link.learner_identity_id
     WHERE link.seat_id=$1 AND link.link_kind='student_seat' AND link.status='active'
     AND link.disabled_at IS NULL AND learner.state='active'
     AND link.tenant_id=$2 AND learner.tenant_id=$2
     AND link.school_id=$3 AND learner.school_id=$3`,
        [seatId, teacher.tenantId, teacher.schoolId],
      )
    ).rows[0]?.['n'],
  ).toBe(1);
  // The creation command must also make the principal available immediately.
  // A fixture must not conceal a teacher-first lifecycle defect by calling
  // student_seat_principal or participant_prepare before checking its result.
  const principals = await admin.query(
    'SELECT id,kind,account_id FROM principals WHERE seat_id=$1',
    [seatId],
  );
  expect(principals.rows).toEqual([
    expect.objectContaining({ kind: 'student_seat', account_id: null }),
  ]);
  const principal = principals.rows[0]!['id'] as string;
  expect(typeof principal).toBe('string');
  await admin.query(`UPDATE classroom_student_seats SET status='active' WHERE id=$1`, [seatId]);
  const token = randomUUID().replaceAll('-', '').repeat(2);
  const hash = hashSessionToken(token);
  await admin.query(
    `INSERT INTO classroom_seat_credentials(seat_id,credential_hash,version,last_request_id,issued_by_account_id)
    VALUES($1,$2,1,$3,$4)`,
    [seatId, hash, randomUUID(), account],
  );
  await admin.query(
    `INSERT INTO classroom_student_sessions(seat_id,token_hash,expires_at,credential_version) VALUES($1,$2,now()+interval '1 hour',1)`,
    [seatId, hash],
  );

  const projectId = randomUUID();
  await admin.query(
    `INSERT INTO projects(id,tenant_id,project_scope,classroom_id,module_key,title,owner_principal_id,created_by_principal_id)
 VALUES($1,$2,'personal',NULL,'electronics','Seat frozen project',$3,$3)`,
    [projectId, teacher.tenantId, principal],
  );
  await admin.query(
    `INSERT INTO project_drafts(project_id,tenant_id,document_json,updated_by_principal_id) VALUES($1,$2,'{"schemaVersion":1,"components":[],"connections":[]}'::jsonb,$3)`,
    [projectId, teacher.tenantId, principal],
  );
  await admin.query(
    `INSERT INTO project_snapshots(project_id,tenant_id,source_revision,image,content_type,width,height,captured_by_principal_id) VALUES($1,$2,1,$3,'image/png',16,16,$4)`,
    [projectId, teacher.tenantId, Buffer.alloc(64, 17), principal],
  );
  const read = async (seat: string | null = null) =>
    (
      await runtime.query('SELECT classroom_project_policy_read($1,$2,$3,$4) data', [
        actor,
        teacher.tenantId,
        classroomId,
        seat,
      ])
    ).rows[0].data;
  const write = async (input: unknown, seat: string | null = null) =>
    (
      await runtime.query('SELECT classroom_project_policy_write($1,$2,$3,$4,$5::jsonb,$6) data', [
        actor,
        teacher.tenantId,
        classroomId,
        seat,
        JSON.stringify(input),
        randomUUID(),
      ])
    ).rows[0].data;
  const publish = async () =>
    (
      await runtime.query('SELECT project_publication_publish_seat($1,$2,$3::jsonb,$4) data', [
        principal,
        projectId,
        JSON.stringify({}),
        hash,
      ])
    ).rows[0].data;
  return {
    teacher,
    actor,
    account,
    classroomId,
    seatId,
    principal,
    token,
    hash,
    projectId,
    read,
    write,
    publish,
  };
}
