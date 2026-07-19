import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenantContext } from '../../packages/database/dist/index.js';
import { adminPool, appPool, seedTeacher, type SeededTeacher } from './helpers';

/** TST-MVP-RLS-001: cross-tenant isolation enforced by PostgreSQL RLS under
 * the runtime database role (no BYPASSRLS, owns nothing), even with direct
 * SQL access. */

let admin: pg.Pool;
let runtime: pg.Pool;
let teacherA: SeededTeacher;
let teacherB: SeededTeacher;
let classroomA: string;

beforeAll(async () => {
  admin = adminPool();
  runtime = appPool();
  teacherA = await seedTeacher(admin, 'rls-a');
  teacherB = await seedTeacher(admin, 'rls-b');
  const created = await admin.query(
    `INSERT INTO classrooms (tenant_id, school_id, academic_period_id, title, created_by)
     VALUES ($1, $2, $3, 'Класс A', $4) RETURNING id`,
    [teacherA.tenantId, teacherA.schoolId, teacherA.periodId, teacherA.teacherId],
  );
  classroomA = created.rows[0].id as string;
  await admin.query(
    `INSERT INTO classroom_memberships (tenant_id, classroom_id, user_id, member_role)
     VALUES ($1, $2, $3, 'owner')`,
    [teacherA.tenantId, classroomA, teacherA.teacherId],
  );
  await admin.query(
    `INSERT INTO audit_events (tenant_id, actor_user_id, entity_type, entity_id, action)
     VALUES ($1, $2, 'classroom', $3, 'classroom.created')`,
    [teacherA.tenantId, teacherA.teacherId, classroomA],
  );
});

afterAll(async () => {
  await admin.end();
  await runtime.end();
});

describe('runtime role hardening', () => {
  it('has no superuser and no BYPASSRLS', async () => {
    const flags = await runtime.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(flags.rows[0].rolsuper).toBe(false);
    expect(flags.rows[0].rolbypassrls).toBe(false);
  });

  it('does not own the protected tables', async () => {
    const owner = await runtime.query(
      `SELECT tableowner FROM pg_tables WHERE tablename = 'classrooms'`,
    );
    const me = await runtime.query(`SELECT current_user AS u`);
    expect(owner.rows[0].tableowner).not.toBe(me.rows[0].u);
  });
});

describe('row level security', () => {
  it('without a tenant context the runtime role sees no rows at all', async () => {
    const rows = await runtime.query(`SELECT count(*)::int AS n FROM classrooms`);
    expect(rows.rows[0].n).toBe(0);
  });

  it('tenant B cannot read tenant A rows even with direct SQL', async () => {
    const visible = await withTenantContext(runtime, teacherB.tenantId, async (client) => {
      const result = await client.query(`SELECT id FROM classrooms`);
      return result.rows as Array<{ id: string }>;
    });
    expect(visible.map((r) => r.id)).not.toContain(classroomA);

    const memberships = await withTenantContext(runtime, teacherB.tenantId, async (client) => {
      const result = await client.query(
        `SELECT count(*)::int AS n FROM classroom_memberships WHERE classroom_id = $1`,
        [classroomA],
      );
      return result.rows[0].n as number;
    });
    expect(memberships).toBe(0);

    const audit = await withTenantContext(runtime, teacherB.tenantId, async (client) => {
      const result = await client.query(
        `SELECT count(*)::int AS n FROM audit_events WHERE entity_id = $1`,
        [classroomA],
      );
      return result.rows[0].n as number;
    });
    expect(audit).toBe(0);
  });

  it('tenant A sees its own rows through the same connection pool', async () => {
    const visible = await withTenantContext(runtime, teacherA.tenantId, async (client) => {
      const result = await client.query(`SELECT id FROM classrooms`);
      return result.rows as Array<{ id: string }>;
    });
    expect(visible.map((r) => r.id)).toContain(classroomA);
  });

  it('WITH CHECK blocks writing a row for another tenant', async () => {
    const attempt = withTenantContext(runtime, teacherB.tenantId, (client) =>
      client.query(
        `INSERT INTO classrooms (tenant_id, school_id, academic_period_id, title, created_by)
         VALUES ($1, $2, $3, 'Взлом', $4)`,
        [teacherA.tenantId, teacherA.schoolId, teacherA.periodId, teacherA.teacherId],
      ),
    );
    // SQLSTATE 42501 = insufficient_privilege (RLS WITH CHECK violation),
    // asserted by code so the test is independent of the server locale.
    await expect(attempt).rejects.toMatchObject({ code: '42501' });
  });

  it('tenant B cannot modify tenant A rows (no visible target, no update grant abuse)', async () => {
    const updated = await withTenantContext(runtime, teacherB.tenantId, async (client) => {
      const result = await client
        .query(`UPDATE classrooms SET title = 'X' WHERE id = $1`, [classroomA])
        .catch(() => ({ rowCount: -1 }));
      return result.rowCount;
    });
    // Either permission denied (no UPDATE grant) or zero rows affected by RLS.
    expect(updated === 0 || updated === -1).toBe(true);
    const check = await admin.query(`SELECT title FROM classrooms WHERE id = $1`, [classroomA]);
    expect(check.rows[0].title).toBe('Класс A');
  });

  it('the runtime role cannot update or delete audit events', async () => {
    await expect(
      withTenantContext(runtime, teacherA.tenantId, (client) =>
        client.query(`UPDATE audit_events SET action = 'x' WHERE entity_id = $1`, [classroomA]),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantContext(runtime, teacherA.tenantId, (client) =>
        client.query(`DELETE FROM audit_events WHERE entity_id = $1`, [classroomA]),
      ),
    ).rejects.toThrow();
  });
});
