import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenantContext } from '../../packages/database/dist/index.js';
import { testAdminPool, testAppPool, seedTeacher, type SeededTeacher } from './helpers';

/** TST-RLS-001: runtime-role hardening and cross-tenant isolation enforced by
 * PostgreSQL itself, using direct SQL under the runtime role. */

let admin: pg.Pool;
let runtime: pg.Pool;
let teacherA: SeededTeacher;
let teacherB: SeededTeacher;
let classroomA: string;

beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
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
  it('is not superuser and has no BYPASSRLS', async () => {
    const flags = await runtime.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(flags.rows[0].rolsuper).toBe(false);
    expect(flags.rows[0].rolbypassrls).toBe(false);
  });

  it('owns none of the schema tables', async () => {
    const owners = await runtime.query(
      `SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'`,
    );
    const me = await runtime.query(`SELECT current_user AS u`);
    for (const row of owners.rows) {
      expect(row.tableowner).not.toBe(me.rows[0].u);
    }
  });

  it('has no direct access to tenants, users or sessions', async () => {
    for (const table of ['tenants', 'users', 'sessions', 'tenant_placements']) {
      await expect(runtime.query(`SELECT count(*) FROM ${table}`)).rejects.toMatchObject({
        code: '42501',
      });
    }
  });

  it('has exactly the hardened role attributes and no role memberships', async () => {
    const flags = await runtime.query(
      `SELECT rolinherit, rolcreaterole, rolcreatedb, rolreplication
         FROM pg_roles WHERE rolname = current_user`,
    );
    expect(flags.rows[0]).toEqual({
      rolinherit: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
    });
    const memberships = await runtime.query(
      `SELECT count(*)::int AS n FROM pg_auth_members
        WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user)`,
    );
    expect(memberships.rows[0].n).toBe(0);
  });

  it('cannot CREATE in the public schema', async () => {
    const priv = await runtime.query(
      `SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS can_create`,
    );
    expect(priv.rows[0].can_create).toBe(false);
    await expect(runtime.query(`CREATE TABLE public.hack (id int)`)).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('holds exactly the expected table and sequence privileges', async () => {
    const grants = await runtime.query(
      `SELECT table_name, privilege_type
         FROM information_schema.role_table_grants
        WHERE grantee = current_user AND table_schema = 'public'
        ORDER BY table_name, privilege_type`,
    );
    const actual = grants.rows.map((r) => `${r.table_name}:${r.privilege_type}`);
    expect(actual).toEqual([
      'academic_periods:SELECT',
      'audit_events:INSERT',
      'audit_events:SELECT',
      'chess_live_challenges:INSERT',
      'chess_live_challenges:SELECT',
      'chess_live_challenges:UPDATE',
      'chess_live_command_receipts:INSERT',
      'chess_live_command_receipts:SELECT',
      'chess_live_events:INSERT',
      'chess_live_events:SELECT',
      'chess_live_games:INSERT',
      'chess_live_games:SELECT',
      'chess_live_games:UPDATE',
      'chess_matchmaking_tickets:INSERT',
      'chess_matchmaking_tickets:SELECT',
      'chess_matchmaking_tickets:UPDATE',
      'chess_rating_ledger:INSERT',
      'chess_rating_ledger:SELECT',
      'chess_ratings:INSERT',
      'chess_ratings:SELECT',
      'chess_ratings:UPDATE',
      'classroom_memberships:INSERT',
      'classroom_memberships:SELECT',
      'classrooms:INSERT',
      'classrooms:SELECT',
      'project_drafts:INSERT',
      'project_drafts:SELECT',
      'project_drafts:UPDATE',
      'project_versions:INSERT',
      'project_versions:SELECT',
      'projects:INSERT',
      'projects:SELECT',
      'schools:SELECT',
    ]);
    const sequences = await runtime.query(
      `SELECT c.relname,
              has_sequence_privilege(current_user, c.oid, 'USAGE') AS usage
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'S' AND n.nspname = 'public'
        ORDER BY c.relname`,
    );
    const allowedSequences = new Set(['audit_events_id_seq', 'chess_live_command_receipts_id_seq']);
    for (const row of sequences.rows) {
      expect(row.usage).toBe(allowedSequences.has(row.relname));
    }
  });

  it('SECURITY DEFINER functions ignore hostile same-named temp tables', async () => {
    const client = await runtime.connect();
    try {
      await client.query(
        `CREATE TEMP TABLE sessions (token_hash varchar, tenant_id uuid, user_id uuid,
                                     revoked_at timestamptz, expires_at timestamptz)`,
      );
      await client.query(`CREATE TEMP TABLE users (id uuid, tenant_id uuid, email varchar)`);
      await client.query(
        `CREATE TEMP TABLE tenants (id uuid, workspace_slug varchar, status varchar)`,
      );
      // The locator still resolves against the real public.tenants row.
      const tenant = await client.query(`SELECT auth_lookup_tenant_id($1) AS id`, [
        teacherA.workspace,
      ]);
      expect(tenant.rows[0].id).toBe(teacherA.tenantId);
      // Session resolution also targets public.*, not the hostile temp copies.
      const resolved = await client.query(`SELECT * FROM auth_resolve_session($1)`, [
        'no-such-hash',
      ]);
      expect(resolved.rows).toHaveLength(0);
    } finally {
      await client.query(`DISCARD TEMP`).catch(() => undefined);
      client.release();
    }
  });

  it('reaches identity data only through the narrow auth functions', async () => {
    const tenant = await runtime.query(`SELECT auth_lookup_tenant_id($1) AS id`, [
      teacherA.workspace,
    ]);
    expect(tenant.rows[0].id).toBe(teacherA.tenantId);
    const teacher = await runtime.query(`SELECT * FROM auth_find_active_teacher($1, $2)`, [
      teacherA.tenantId,
      teacherA.email,
    ]);
    expect(teacher.rows[0].id).toBe(teacherA.teacherId);
  });
});

describe('row level security', () => {
  it('without a tenant context the runtime role sees no classroom or chess-live rows', async () => {
    for (const table of [
      'classrooms',
      'chess_live_challenges',
      'chess_live_games',
      'chess_live_events',
      'chess_live_command_receipts',
      'chess_matchmaking_tickets',
      'chess_ratings',
      'chess_rating_ledger',
    ]) {
      const rows = await runtime.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows.rows[0].n).toBe(0);
    }
  });

  it('tenant B cannot read tenant A classrooms/memberships/audit via direct SQL', async () => {
    const counts = await withTenantContext(runtime, teacherB.tenantId, async (client) => {
      const classroom = await client.query(
        `SELECT count(*)::int AS n FROM classrooms WHERE id = $1`,
        [classroomA],
      );
      const membership = await client.query(
        `SELECT count(*)::int AS n FROM classroom_memberships WHERE classroom_id = $1`,
        [classroomA],
      );
      const audit = await client.query(
        `SELECT count(*)::int AS n FROM audit_events WHERE entity_id = $1`,
        [classroomA],
      );
      return [classroom.rows[0].n, membership.rows[0].n, audit.rows[0].n];
    });
    expect(counts).toEqual([0, 0, 0]);
  });

  it('tenant A sees its own rows through the same pool', async () => {
    const visible = await withTenantContext(runtime, teacherA.tenantId, async (client) => {
      const result = await client.query(`SELECT id FROM classrooms`);
      return (result.rows as Array<{ id: string }>).map((r) => r.id);
    });
    expect(visible).toContain(classroomA);
  });

  it('WITH CHECK blocks writing a row for another tenant (SQLSTATE 42501)', async () => {
    const attempt = withTenantContext(runtime, teacherB.tenantId, (client) =>
      client.query(
        `INSERT INTO classrooms (tenant_id, school_id, academic_period_id, title, created_by)
         VALUES ($1, $2, $3, 'Взлом', $4)`,
        [teacherA.tenantId, teacherA.schoolId, teacherA.periodId, teacherA.teacherId],
      ),
    );
    await expect(attempt).rejects.toMatchObject({ code: '42501' });
  });

  it('a cross-tenant audit actor is rejected by the composite FK', async () => {
    const attempt = withTenantContext(runtime, teacherA.tenantId, (client) =>
      client.query(
        `INSERT INTO audit_events (tenant_id, actor_user_id, entity_type, action)
         VALUES ($1, $2, 'classroom', 'classroom.created')`,
        [teacherA.tenantId, teacherB.teacherId],
      ),
    );
    await expect(attempt).rejects.toMatchObject({ code: '23503' });
  });

  it('the runtime role cannot update or delete audit events', async () => {
    await expect(
      withTenantContext(runtime, teacherA.tenantId, (client) =>
        client.query(`UPDATE audit_events SET action = 'x' WHERE entity_id = $1`, [classroomA]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withTenantContext(runtime, teacherA.tenantId, (client) =>
        client.query(`DELETE FROM audit_events WHERE entity_id = $1`, [classroomA]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('audit events stay append-only even for the admin role', async () => {
    const audit = await admin.query(`SELECT id FROM audit_events WHERE entity_id = $1`, [
      classroomA,
    ]);
    await expect(
      admin.query(`UPDATE audit_events SET action = 'x' WHERE id = $1`, [audit.rows[0].id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      admin.query(`DELETE FROM audit_events WHERE id = $1`, [audit.rows[0].id]),
    ).rejects.toThrow(/append-only/);
  });
});
