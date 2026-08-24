import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let learnerId: string;
let foreignSeatId: string;
let tenantId: string;
let schoolId: string;

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  const first = await seedTeacher(admin, 'learning-identity-rls-a');
  const second = await seedTeacher(admin, 'learning-identity-rls-b');
  tenantId = first.tenantId;
  schoolId = first.schoolId;
  learnerId = (await admin.query(`SELECT gen_random_uuid() AS id`)).rows[0].id as string;
  await admin.query(
    `INSERT INTO learner_identities (id,tenant_id,school_id,state)
     VALUES ($1,$2,$3,'active')`,
    [learnerId, first.tenantId, first.schoolId],
  );
  const classroom = await admin.query(
    `INSERT INTO classrooms
       (tenant_id,school_id,academic_period_id,title,created_by)
     VALUES ($1,$2,$3,'Foreign learner scope',$4) RETURNING id`,
    [second.tenantId, second.schoolId, second.periodId, second.teacherId],
  );
  const seat = await admin.query(
    `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
        safe_mode,status,created_by)
     VALUES ($1,$2,'Foreign seat','foreign-seat-rls','foreign-seat-rls',
             true,'active',$3) RETURNING id`,
    [second.tenantId, classroom.rows[0].id, second.teacherId],
  );
  foreignSeatId = seat.rows[0].id as string;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('LRN-M0-006 learner identity least privilege', () => {
  it.each([
    'learner_identities',
    'learner_identity_links',
    'learning_migration_batches',
    'learning_migration_artifacts',
  ])('denies direct runtime UUID enumeration of %s', async (table) => {
    await expect(app.query(`SELECT * FROM ${table} LIMIT 1`)).rejects.toThrow(/permission denied/);
  });

  it('denies runtime mutation and migration procedure execution', async () => {
    await expect(
      app.query(
        `INSERT INTO learner_identities (id,tenant_id,school_id,state)
         VALUES (gen_random_uuid(),$1,$2,'active')`,
        [tenantId, schoolId],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      app.query(`SELECT learning_m0_convergence_report($1)`, [learnerId]),
    ).rejects.toThrow(/permission denied/);
  });

  it('rejects a seat-to-learner link across the physical school boundary', async () => {
    await expect(
      admin.query(
        `INSERT INTO learner_identity_links
           (id,tenant_id,school_id,learner_identity_id,link_kind,seat_id,status)
         VALUES (gen_random_uuid(),$1,$2,$3,'student_seat',$4,'active')`,
        [tenantId, schoolId, learnerId, foreignSeatId],
      ),
    ).rejects.toThrow(/does not belong to learner school scope/);
  });

  it('keeps the runtime role non-superuser and without BYPASSRLS', async () => {
    const role = await admin.query(
      `SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='asalab_app'`,
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});
