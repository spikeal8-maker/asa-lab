#!/usr/bin/env node
import pg from 'pg';

const grant = process.argv.includes('--grant');
const email = process.env.ASA_OWNER_ADMIN_EMAIL?.trim().toLowerCase();
const databaseUrl = process.env.DATABASE_URL;

if (!email || !email.includes('@')) {
  console.error('BLOCKED: ASA_OWNER_ADMIN_EMAIL is required.');
  process.exit(78);
}
if (!databaseUrl) {
  console.error('BLOCKED: DATABASE_URL is required for owner administration.');
  process.exit(78);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  if (grant) {
    await client.query('BEGIN');
    try {
      const account = await client.query(
        `SELECT a.id, a.status, p.id AS principal_id, w.tenant_id
           FROM accounts a
           JOIN principals p ON p.account_id = a.id AND p.kind = 'account'
           JOIN workspace_memberships m ON m.account_id = a.id AND m.state = 'active'
           JOIN workspaces w ON w.id = m.workspace_id AND w.kind = 'personal'
          WHERE lower(a.email) = $1
          LIMIT 1
          FOR UPDATE OF a`,
        [email],
      );
      const row = account.rows[0];
      if (!row || row.status !== 'active') throw new Error('owner account is missing or inactive');
      await client.query(
        `INSERT INTO capability_grants
            (account_id, capability, state, policy_version, granted_by)
         VALUES ($1, 'platform_admin', 'verified', 'admin-auth-stability-v1', 'admin')
         ON CONFLICT (account_id, capability) DO UPDATE
             SET state = 'verified',
                 policy_version = EXCLUDED.policy_version,
                 granted_by = EXCLUDED.granted_by`,
        [row.id],
      );
      await client.query(
        `INSERT INTO audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
         VALUES ($1, NULL, 'account', $2, 'platform_admin.owner_verified',
                 jsonb_build_object('source', 'owner_preflight'))`,
        [row.tenant_id, row.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  const result = await client.query(
    `SELECT a.status,
            EXISTS (
              SELECT 1 FROM capability_grants g
               WHERE g.account_id = a.id
                 AND g.capability = 'platform_admin'
                 AND g.state = 'verified'
            ) AS platform_admin
       FROM accounts a
      WHERE lower(a.email) = $1`,
    [email],
  );
  const row = result.rows[0];
  if (!row || row.status !== 'active' || row.platform_admin !== true) {
    throw new Error('owner platform_admin verification failed');
  }
  console.log(`platform-admin ${grant ? 'grant+verify' : 'verify'} PASS`);
} catch (error) {
  console.error(`platform-admin FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
