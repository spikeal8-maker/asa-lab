import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedTeacher, testAdminPool } from './helpers';

/**
 * TST-PERSONAL-WORKSPACE-BACKFILL-001 — every account has exactly one personal
 * space, and the school it already worked in is untouched.
 *
 * The teacher who used ASA Lab yesterday keeps their account, their
 * organization workspace, their classes and their projects, and gains a
 * Personal Workspace next to them. Running the backfill again changes nothing,
 * because a migration that is only safe the first time is not safe.
 */

let admin: pg.Pool;

/** The backfill block of 0005, replayed exactly as the migration runs it. */
const BACKFILL_SQL = (() => {
  const source = readFileSync(
    join(process.cwd(), 'migrations/0005_global_account_identity.sql'),
    'utf8',
  );
  const start = source.indexOf('-- 1. Every existing tenant becomes an organization workspace.');
  const end = source.indexOf('-- Runtime role: identity tables stay unreachable');
  if (start < 0 || end < 0) throw new Error('backfill block not found in migration 0005');
  return source.slice(start, end);
})();

async function personalWorkspaces(accountId: string) {
  const result = await admin.query(
    `SELECT w.id, w.tenant_id, m.role FROM workspace_memberships m
       JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.account_id = $1 AND w.kind = 'personal'`,
    [accountId],
  );
  return result.rows;
}

beforeAll(async () => {
  admin = testAdminPool();
});

afterAll(async () => {
  await admin.end();
});

describe('personal workspace backfill', () => {
  it('gives an existing teacher one personal space beside their school, and repeats safely', async () => {
    const teacher = await seedTeacher(admin, 'backfill');
    const classroom = await admin.query(
      `INSERT INTO classrooms (tenant_id, school_id, academic_period_id, title, created_by)
       VALUES ($1, $2, $3, 'Класс до миграции', $4) RETURNING id`,
      [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
    );
    const classroomId = classroom.rows[0].id as string;
    const passwordBefore = await admin.query(`SELECT password_hash FROM users WHERE id = $1`, [
      teacher.teacherId,
    ]);

    await admin.query(BACKFILL_SQL);

    const account = await admin.query(`SELECT id FROM accounts WHERE lower(email) = $1`, [
      teacher.email.toLowerCase(),
    ]);
    expect(account.rows).toHaveLength(1);
    const accountId = account.rows[0].id as string;

    // One account, one personal workspace, and the school workspace intact.
    expect(await personalWorkspaces(accountId)).toHaveLength(1);
    const organization = await admin.query(
      `SELECT w.kind, m.role FROM workspace_memberships m
         JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.account_id = $1 AND w.tenant_id = $2`,
      [accountId, teacher.tenantId],
    );
    expect(organization.rows).toEqual([{ kind: 'organization', role: 'educator' }]);

    // Personal space is not a school: no school, period or teacher user in it.
    const personalTenant = (await personalWorkspaces(accountId))[0].tenant_id as string;
    const inside = await admin.query(
      `SELECT (SELECT count(*)::int FROM schools WHERE tenant_id = $1) AS schools,
              (SELECT count(*)::int FROM academic_periods WHERE tenant_id = $1) AS periods,
              (SELECT count(*)::int FROM users WHERE tenant_id = $1) AS users`,
      [personalTenant],
    );
    expect(inside.rows[0]).toEqual({ schools: 0, periods: 0, users: 0 });

    // Capabilities: creator for everyone, educator kept for a real teacher.
    const grants = await admin.query(
      `SELECT capability, state FROM capability_grants WHERE account_id = $1 ORDER BY capability`,
      [accountId],
    );
    expect(grants.rows).toEqual([
      { capability: 'creator', state: 'verified' },
      { capability: 'educator', state: 'verified' },
    ]);

    // The legacy bridge exists once, for the organization tenant only.
    const links = await admin.query(
      `SELECT tenant_id, migration_state FROM legacy_user_account_links WHERE account_id = $1`,
      [accountId],
    );
    expect(links.rows).toEqual([{ tenant_id: teacher.tenantId, migration_state: 'active' }]);

    // A second run is a no-op.
    await admin.query(BACKFILL_SQL);
    expect(await personalWorkspaces(accountId)).toHaveLength(1);
    const accountsAgain = await admin.query(
      `SELECT count(*)::int AS n FROM accounts WHERE lower(email) = $1`,
      [teacher.email.toLowerCase()],
    );
    expect(accountsAgain.rows[0].n).toBe(1);
    const membershipsAgain = await admin.query(
      `SELECT count(*)::int AS n FROM workspace_memberships WHERE account_id = $1`,
      [accountId],
    );
    expect(membershipsAgain.rows[0].n).toBe(2);
    const linksAgain = await admin.query(
      `SELECT count(*)::int AS n FROM legacy_user_account_links WHERE account_id = $1`,
      [accountId],
    );
    expect(linksAgain.rows[0].n).toBe(1);

    // Nothing that existed before the migration moved or changed.
    const classroomAfter = await admin.query(
      `SELECT id, tenant_id, created_by FROM classrooms WHERE id = $1`,
      [classroomId],
    );
    expect(classroomAfter.rows[0]).toEqual({
      id: classroomId,
      tenant_id: teacher.tenantId,
      created_by: teacher.teacherId,
    });
    const passwordAfter = await admin.query(`SELECT password_hash FROM users WHERE id = $1`, [
      teacher.teacherId,
    ]);
    expect(passwordAfter.rows[0].password_hash).toBe(passwordBefore.rows[0].password_hash);
  });

  it('never leaves a backfilled account without a personal workspace', async () => {
    // Scoped to accounts the backfill or registration actually built — a
    // profile is the marker — because other suites insert bare fixture rows.
    const missing = await admin.query(
      `SELECT count(*)::int AS n FROM accounts a
         JOIN profiles p ON p.account_id = a.id
        WHERE NOT EXISTS (
              SELECT 1 FROM workspace_memberships m
                JOIN workspaces w ON w.id = m.workspace_id
               WHERE m.account_id = a.id AND w.kind = 'personal')`,
    );
    expect(missing.rows[0].n).toBe(0);
  });

  it('never gives an account two personal workspaces', async () => {
    const doubled = await admin.query(
      `SELECT count(*)::int AS n FROM (
          SELECT m.account_id
            FROM workspace_memberships m
            JOIN workspaces w ON w.id = m.workspace_id
           WHERE w.kind = 'personal'
           GROUP BY m.account_id
          HAVING count(*) > 1) AS doubled`,
    );
    expect(doubled.rows[0].n).toBe(0);
  });
});
