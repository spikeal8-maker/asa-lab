import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool } from './helpers';

/**
 * TST-IDENTITY-INTEGRITY-001 — the schema keeps its own promises.
 *
 * A principal always has a subject, capabilities and profile visibility follow
 * the normative sets, and the legacy tenant-scoped user lives in its own link
 * table with real composite integrity instead of riding on a membership.
 */

let admin: pg.Pool;

function unique(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function newAccount(label: string): Promise<string> {
  const account = await admin.query(
    `INSERT INTO accounts (email, password_hash, birth_date, country)
     VALUES ($1, 'x', DATE '1990-01-01', 'RU') RETURNING id`,
    [`${unique(label)}@test.local`],
  );
  return account.rows[0].id as string;
}

beforeAll(async () => {
  admin = testAdminPool();
});

afterAll(async () => {
  await admin.end();
});

describe('principal integrity', () => {
  it('refuses a principal with no subject', async () => {
    await expect(
      admin.query(`INSERT INTO principals (kind, account_id) VALUES ('student_seat', NULL)`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a seat principal until the seat entity exists', async () => {
    const accountId = await newAccount('seat-principal');
    // Even with a subject, `student_seat` has no table to point at yet.
    await expect(
      admin.query(`INSERT INTO principals (kind, account_id) VALUES ('student_seat', $1)`, [
        accountId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('accepts an account principal', async () => {
    const accountId = await newAccount('account-principal');
    const inserted = await admin.query(
      `INSERT INTO principals (kind, account_id) VALUES ('account', $1) RETURNING kind`,
      [accountId],
    );
    expect(inserted.rows[0].kind).toBe('account');
  });
});

describe('normative capability and visibility sets', () => {
  it('knows registered_student and refuses an invented capability', async () => {
    const accountId = await newAccount('caps');
    for (const capability of [
      'creator',
      'educator',
      'registered_student',
      'guardian',
      'platform_admin',
    ]) {
      const granted = await admin.query(
        `INSERT INTO capability_grants (account_id, capability, state, policy_version)
         VALUES ($1, $2, 'verified', 'asa-lab-2026-07') RETURNING capability`,
        [accountId, capability],
      );
      expect(granted.rows[0].capability).toBe(capability);
    }
    await expect(
      admin.query(
        `INSERT INTO capability_grants (account_id, capability, state, policy_version)
         VALUES ($1, 'superuser', 'verified', 'asa-lab-2026-07')`,
        [accountId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('gives a profile private | restricted | public visibility, not unlisted', async () => {
    const accountId = await newAccount('visibility');
    const created = await admin.query(
      `INSERT INTO profiles (account_id, username, display_name) VALUES ($1, $2, 'Тест')
       RETURNING visibility`,
      [accountId, unique('vis').slice(0, 40)],
    );
    expect(created.rows[0].visibility).toBe('private');

    for (const visibility of ['restricted', 'public', 'private']) {
      await admin.query(`UPDATE profiles SET visibility = $2 WHERE account_id = $1`, [
        accountId,
        visibility,
      ]);
    }
    await expect(
      admin.query(`UPDATE profiles SET visibility = 'unlisted' WHERE account_id = $1`, [accountId]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps workspace roles to the normative set', async () => {
    const teacher = await seedTeacher(admin, 'roles');
    const accountId = await newAccount('roles');
    const workspace = await admin.query(
      `INSERT INTO workspaces (tenant_id, kind, title) VALUES ($1, 'organization', 'Тест')
       ON CONFLICT (tenant_id) DO UPDATE SET title = EXCLUDED.title RETURNING id`,
      [teacher.tenantId],
    );
    for (const role of [
      'owner',
      'member',
      'educator',
      'school_admin',
      'billing_admin',
      'moderator',
    ]) {
      await admin.query(
        `INSERT INTO workspace_memberships (account_id, workspace_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (account_id, workspace_id) DO UPDATE SET role = EXCLUDED.role`,
        [accountId, workspace.rows[0].id, role],
      );
    }
    await expect(
      admin.query(`UPDATE workspace_memberships SET role = 'headmaster' WHERE account_id = $1`, [
        accountId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('legacy execution identity', () => {
  it('is a link table, not a column on membership', async () => {
    const column = await admin.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'workspace_memberships' AND column_name = 'user_id'`,
    );
    expect(column.rows).toHaveLength(0);
  });

  it('enforces composite tenant integrity on the linked user', async () => {
    const teacherA = await seedTeacher(admin, 'link-a');
    const teacherB = await seedTeacher(admin, 'link-b');
    const accountId = await newAccount('link');
    const principal = await admin.query(
      `INSERT INTO principals (kind, account_id) VALUES ('account', $1) RETURNING id`,
      [accountId],
    );

    // A user from another tenant cannot be linked into this one.
    await expect(
      admin.query(
        `INSERT INTO legacy_user_account_links (tenant_id, user_id, account_id, principal_id)
         VALUES ($1, $2, $3, $4)`,
        [teacherA.tenantId, teacherB.teacherId, accountId, principal.rows[0].id],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    const linked = await admin.query(
      `INSERT INTO legacy_user_account_links (tenant_id, user_id, account_id, principal_id)
       VALUES ($1, $2, $3, $4) RETURNING migration_state`,
      [teacherA.tenantId, teacherA.teacherId, accountId, principal.rows[0].id],
    );
    expect(linked.rows[0].migration_state).toBe('active');

    // One link per tenant user: the bridge cannot fork.
    await expect(
      admin.query(
        `INSERT INTO legacy_user_account_links (tenant_id, user_id, account_id, principal_id)
         VALUES ($1, $2, $3, $4)`,
        [teacherA.tenantId, teacherA.teacherId, accountId, principal.rows[0].id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('resolves the account of a legacy session through the link table', async () => {
    const teacher = await seedTeacher(admin, 'link-resolve');
    const accountId = await newAccount('link-resolve');
    const principal = await admin.query(
      `INSERT INTO principals (kind, account_id) VALUES ('account', $1) RETURNING id`,
      [accountId],
    );
    await admin.query(
      `INSERT INTO legacy_user_account_links (tenant_id, user_id, account_id, principal_id)
       VALUES ($1, $2, $3, $4)`,
      [teacher.tenantId, teacher.teacherId, accountId, principal.rows[0].id],
    );

    const resolved = await admin.query(`SELECT account_id FROM auth_account_for_user($1, $2)`, [
      teacher.tenantId,
      teacher.teacherId,
    ]);
    expect(resolved.rows[0].account_id).toBe(accountId);

    // A retired link stops resolving.
    await admin.query(
      `UPDATE legacy_user_account_links SET migration_state = 'retired' WHERE account_id = $1`,
      [accountId],
    );
    const afterRetire = await admin.query(`SELECT account_id FROM auth_account_for_user($1, $2)`, [
      teacher.tenantId,
      teacher.teacherId,
    ]);
    expect(afterRetire.rows).toHaveLength(0);
  });
});
