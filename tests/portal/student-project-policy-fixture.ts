import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { expect } from 'vitest';
import { seedTeacher } from './helpers';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
export async function studentProjectPolicyFixture(
  admin: pg.Pool,
  runtime: pg.Pool,
  scope: 'personal' | 'classroom' = 'personal',
) {
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

  const repo = new PgProjectRepository(runtime);
  // Classroom Project Core creation belongs to the exact authorized teacher;
  // Seat creation does not gain a new classroom authoring capability here.
  const projectActor =
    scope === 'classroom'
      ? { principalId: actor, userId: teacher.teacherId }
      : { principalId: principal, userId: null };
  const created = await repo.createWithDraft({
    tenantId: teacher.tenantId,
    scope,
    classroomId: scope === 'classroom' ? classroomId : null,
    actor: projectActor,
    moduleKey: 'electronics',
    title: 'Seat frozen project',
    idempotencyKey: randomUUID(),
    requestFingerprint: randomUUID().replaceAll('-', '').repeat(2),
    initialDocument: { schemaVersion: 1, components: [], connections: [] },
    initialPreview: null,
  });
  if (created.kind !== 'created')
    throw new Error(`Project Core fixture creation failed: ${created.kind}`);
  const projectId = created.project.id;
  expect(created.project).toMatchObject({
    scope,
    classroomId: scope === 'classroom' ? classroomId : null,
  });
  expect(
    await repo.saveSnapshot({
      tenantId: teacher.tenantId,
      actor: projectActor,
      projectId,
      sourceRevision: 1,
      image: { bytes: Buffer.alloc(64, 17), contentType: 'image/png', width: 16, height: 16 },
    }),
  ).not.toBeNull();
  if (scope === 'classroom') {
    // Synthetic ownership setup, not an additional product command or grant.
    // Keep the repository-created exact class, draft and frozen preview intact.
    await admin.query('UPDATE projects SET owner_principal_id=$2 WHERE id=$1', [
      projectId,
      principal,
    ]);
  }
  expect(
    (
      await admin.query(
        'SELECT project_scope,classroom_id,owner_principal_id FROM projects WHERE id=$1',
        [projectId],
      )
    ).rows[0],
  ).toEqual({
    project_scope: scope,
    classroom_id: scope === 'classroom' ? classroomId : null,
    owner_principal_id: principal,
  });
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
