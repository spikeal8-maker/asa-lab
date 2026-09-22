import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { administerOwner } from '../../tools/platform-admin.mjs';
import { testAdminPool, testAppPool } from '../portal/helpers';

let admin: pg.Pool;
let runtime: pg.Pool;
let database: string;

beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  database = (await admin.query('SELECT current_database() AS name')).rows[0].name;
});
afterAll(async () => {
  await admin?.end();
  await runtime?.end();
});

async function seed() {
  const unique = randomUUID();
  const email = `owner-${unique}@example.test`;
  const tenantId = (
    await admin.query('INSERT INTO tenants (title, workspace_slug) VALUES ($1, $2) RETURNING id', [
      'Owner CLI test',
      `owner-${unique}`,
    ])
  ).rows[0].id as string;
  const workspaceId = (
    await admin.query(
      "INSERT INTO workspaces (tenant_id, kind, title) VALUES ($1, 'personal', 'Owner CLI test') RETURNING id",
      [tenantId],
    )
  ).rows[0].id as string;
  const accountId = (
    await admin.query(
      "INSERT INTO accounts (email, password_hash, birth_date, country) VALUES ($1, 'integration-test-only', DATE '1990-01-01', 'RU') RETURNING id",
      [email],
    )
  ).rows[0].id as string;
  const principalId = (
    await admin.query(
      "INSERT INTO principals (kind, account_id) VALUES ('account', $1) RETURNING id",
      [accountId],
    )
  ).rows[0].id as string;
  await admin.query(
    "INSERT INTO workspace_memberships (account_id, workspace_id, role) VALUES ($1, $2, 'owner')",
    [accountId, workspaceId],
  );
  return {
    email,
    accountId,
    principalId,
    workspaceId,
    tenantId,
    expectedDatabase: database,
    reason: 'Confirmed integration test request',
    operator: 'integration-test',
  };
}

async function run(input: Awaited<ReturnType<typeof seed>>, mode = 'grant') {
  const client = await admin.connect();
  try {
    return await administerOwner(client, input, mode);
  } finally {
    client.release();
  }
}

async function saved(accountId: string) {
  const grants = (
    await admin.query(
      "SELECT state, granted_at FROM capability_grants WHERE account_id = $1 AND capability = 'platform_admin'",
      [accountId],
    )
  ).rows;
  const audits = (
    await admin.query(
      "SELECT payload_json FROM audit_events WHERE entity_id = $1 AND action = 'platform_admin.owner_verified'",
      [accountId],
    )
  ).rows;
  return { grants, audits };
}

describe('owner administrator transaction on isolated PostgreSQL', () => {
  it('previews without writing, grants real runtime authority, and repeats without a new grant/audit', async () => {
    const owner = await seed();
    expect(await run(owner, 'plan')).toMatchObject({
      status: 'PLAN',
      platformAdmin: false,
      changed: false,
    });
    expect(await saved(owner.accountId)).toEqual({ grants: [], audits: [] });
    await expect(
      runtime.query("SELECT * FROM admin_list_audit_events($1, 'platform', NULL, 1, NULL, NULL)", [
        owner.principalId,
      ]),
    ).rejects.toThrow('administrative scope denied');
    expect(await run(owner)).toMatchObject({
      status: 'GRANTED',
      platformAdmin: true,
      changed: true,
    });
    expect(
      (await runtime.query('SELECT runtime_owner_admin_ready($1) AS ready', [owner.email])).rows[0]
        .ready,
    ).toBe(true);
    const authority = await admin.query(
      "SELECT admin_authorized_role($1, 'platform', NULL) AS role",
      [owner.principalId],
    );
    expect(authority.rows[0].role).toBe('platform_admin');
    // The application calls this allowed entry point; its internal role helper is private.
    await expect(
      runtime.query("SELECT * FROM admin_list_audit_events($1, 'platform', NULL, 1, NULL, NULL)", [
        owner.principalId,
      ]),
    ).resolves.toBeDefined();
    const first = await saved(owner.accountId);
    expect(first.audits).toHaveLength(1);
    expect(first.audits[0].payload_json).toMatchObject({
      reason: owner.reason,
      operator: owner.operator,
      previousState: null,
    });
    expect(await run(owner)).toMatchObject({ status: 'VERIFIED', changed: false });
    expect(await run(owner, 'verify')).toMatchObject({ platformAdmin: true, changed: false });
    expect(await saved(owner.accountId)).toEqual(first);
  });

  it.each(['accountId', 'expectedDatabase'])(
    'rejects a wrong %s without mutations',
    async (key) => {
      const owner = await seed();
      await expect(
        run({ ...owner, [key]: key === 'accountId' ? randomUUID() : 'different_test' }),
      ).rejects.toThrow();
      expect(await saved(owner.accountId)).toEqual({ grants: [], audits: [] });
    },
  );

  it.each(['account', 'workspace', 'membership'])(
    'rejects an inactive %s without mutations',
    async (kind) => {
      const owner = await seed();
      if (kind === 'account')
        await admin.query("UPDATE accounts SET status = 'suspended' WHERE id = $1", [
          owner.accountId,
        ]);
      if (kind === 'workspace')
        await admin.query("UPDATE workspaces SET status = 'suspended' WHERE id = $1", [
          owner.workspaceId,
        ]);
      if (kind === 'membership')
        await admin.query(
          "UPDATE workspace_memberships SET state = 'suspended' WHERE account_id = $1",
          [owner.accountId],
        );
      await expect(run(owner)).rejects.toThrow();
      expect(await saved(owner.accountId)).toEqual({ grants: [], audits: [] });
    },
  );

  it('never creates an account for an unknown email', async () => {
    const owner = await seed();
    const email = `missing-${randomUUID()}@example.test`;
    await expect(run({ ...owner, email })).rejects.toThrow('exactly one existing account');
    expect((await admin.query('SELECT id FROM accounts WHERE email = $1', [email])).rowCount).toBe(
      0,
    );
  });

  it('fails closed when the personal workspace context is ambiguous', async () => {
    const owner = await seed();
    const other = await seed();
    await admin.query(
      "INSERT INTO workspace_memberships (account_id, workspace_id, role) VALUES ($1, $2, 'owner')",
      [owner.accountId, other.workspaceId],
    );
    await expect(run(owner)).rejects.toThrow('one active personal workspace');
    expect(await saved(owner.accountId)).toEqual({ grants: [], audits: [] });
  });

  it('rolls back the real grant and audit if final runtime verification refuses authority', async () => {
    const owner = await seed();
    const client = await admin.connect();
    try {
      // Fault injection at the runtime authorization boundary; writes/rollback use real PostgreSQL.
      const refusingClient = {
        query: async (sql: string, values?: unknown[]) => {
          const result = await client.query(sql, values);
          if (sql.includes('AS ready')) result.rows = [{ ready: false, role: null }];
          return result;
        },
      };
      await expect(administerOwner(refusingClient, owner, 'grant')).rejects.toThrow(
        'no change was committed',
      );
    } finally {
      client.release();
    }
    expect(await saved(owner.accountId)).toEqual({ grants: [], audits: [] });
  });

  it('serializes concurrent grants and audits only the effective change', async () => {
    const owner = await seed();
    const results = await Promise.all([run(owner), run(owner)]);
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect((await saved(owner.accountId)).audits).toHaveLength(1);
  });

  it('records a revoked regrant with a fresh date and previous state', async () => {
    const owner = await seed();
    await admin.query(
      "INSERT INTO capability_grants (account_id, capability, state, policy_version, granted_by, granted_at) VALUES ($1, 'platform_admin', 'revoked', 'test', 'admin', DATE '2000-01-01')",
      [owner.accountId],
    );
    expect(await run(owner)).toMatchObject({ changed: true });
    const result = await saved(owner.accountId);
    expect(result.grants[0].granted_at.getUTCFullYear()).toBeGreaterThan(2000);
    expect(result.audits[0].payload_json.previousState).toBe('revoked');
  });
});
