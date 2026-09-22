#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export class OwnerAdminError extends Error {}
const requireOwner = (condition, message) => {
  if (!condition) throw new OwnerAdminError(message);
};
const text = (value) => (typeof value === 'string' ? value.trim() : '');

export function ownerAdminOptions(input = {}, mode = 'verify') {
  requireOwner(['plan', 'verify', 'grant'].includes(mode), 'Unknown owner administration mode.');
  const options = {
    mode,
    email: text(input.email).toLowerCase(),
    accountId: text(input.accountId).toLowerCase(),
    expectedDatabase: text(input.expectedDatabase),
    reason: text(input.reason),
    operator: text(input.operator).slice(0, 128) || 'database-operator',
  };
  requireOwner(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.email),
    'An exact account email is required.',
  );
  if (mode === 'grant') {
    requireOwner(
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(options.accountId),
      'Grant requires the account UUID shown by --plan.',
    );
    requireOwner(options.expectedDatabase.length > 0, 'Grant requires the expected database name.');
    requireOwner(
      options.reason.length >= 3 && options.reason.length <= 500,
      'Grant requires a reason of 3 to 500 characters.',
    );
  }
  return options;
}

export async function administerOwner(client, input, mode = 'verify') {
  const options = ownerAdminOptions(input, mode);
  const grant = mode === 'grant';
  await client.query(grant ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const metadata = (
      await client.query('SELECT current_database() AS database, current_user AS actor')
    ).rows[0];
    requireOwner(
      !options.expectedDatabase || metadata.database === options.expectedDatabase,
      'Connected database does not match the expected database.',
    );
    const accounts = await client.query(
      `SELECT id, email, status FROM public.accounts WHERE lower(email) = $1 ${grant ? 'FOR UPDATE' : ''}`,
      [options.email],
    );
    requireOwner(
      accounts.rows.length === 1,
      'Expected exactly one existing account; no account was created.',
    );
    const account = accounts.rows[0];
    requireOwner(account.status === 'active', 'Owner account is inactive.');
    requireOwner(
      !options.accountId || account.id === options.accountId,
      'Account UUID does not match the confirmed email.',
    );
    const contexts = await client.query(
      `SELECT p.id AS principal_id, w.id AS workspace_id, w.tenant_id
         FROM public.principals p
         JOIN public.workspace_memberships m ON m.account_id = p.account_id AND m.state = 'active'
         JOIN public.workspaces w ON w.id = m.workspace_id AND w.kind = 'personal' AND w.status = 'active'
        WHERE p.account_id = $1 AND p.kind = 'account'
        ${grant ? 'FOR SHARE OF p, m, w' : ''}`,
      [account.id],
    );
    requireOwner(
      contexts.rows.length === 1,
      'Expected one active personal workspace and account principal.',
    );
    const context = contexts.rows[0];
    const previous =
      (
        await client.query(
          "SELECT state FROM public.capability_grants WHERE account_id = $1 AND capability = 'platform_admin'",
          [account.id],
        )
      ).rows[0]?.state ?? null;
    const changed = grant && previous !== 'verified';
    if (changed) {
      await client.query(
        `INSERT INTO public.capability_grants (account_id, capability, state, policy_version, granted_by)
         VALUES ($1, 'platform_admin', 'verified', 'owner-admin-cli-v2', 'admin')
         ON CONFLICT (account_id, capability) DO UPDATE
           SET state = 'verified', policy_version = EXCLUDED.policy_version,
               granted_by = EXCLUDED.granted_by, granted_at = now()`,
        [account.id],
      );
      await client.query(
        `INSERT INTO public.audit_events (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
         VALUES ($1, NULL, 'account', $2, 'platform_admin.owner_verified', $3::jsonb)`,
        [
          context.tenant_id,
          account.id,
          JSON.stringify({
            source: 'owner_admin_cli',
            reason: options.reason,
            operator: options.operator,
            databaseActor: metadata.actor,
            requestId: randomUUID(),
            previousState: previous,
          }),
        ],
      );
    }
    const authority = (
      await client.query(
        `SELECT public.runtime_owner_admin_ready($1) AS ready,
              public.admin_authorized_role($2, 'platform', NULL) AS role`,
        [options.email, context.principal_id],
      )
    ).rows[0];
    const ready = authority.ready === true && authority.role === 'platform_admin';
    if (mode !== 'plan')
      requireOwner(ready, 'Owner runtime authority verification failed; no change was committed.');
    await client.query('COMMIT');
    return {
      mode,
      database: metadata.database,
      accountId: account.id,
      email: account.email,
      platformAdmin: ready,
      changed,
      status: mode === 'plan' ? 'PLAN' : changed ? 'GRANTED' : 'VERIFIED',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function ownerAdminMain(args = process.argv.slice(2)) {
  let client;
  try {
    requireOwner(
      args.every((arg) => ['--plan', '--verify', '--grant', '--stdin'].includes(arg)),
      'Unknown owner administration option.',
    );
    const modes = args.filter((arg) => arg !== '--stdin');
    requireOwner(modes.length <= 1, 'Choose only one of --plan, --verify or --grant.');
    const mode = modes[0]?.slice(2) ?? 'verify';
    const input = args.includes('--stdin')
      ? JSON.parse(readFileSync(0, 'utf8'))
      : {
          email: process.env.ASA_OWNER_ADMIN_EMAIL,
          accountId: process.env.ASA_OWNER_ADMIN_ACCOUNT_ID,
          expectedDatabase: process.env.ASA_OWNER_ADMIN_DATABASE,
          reason: process.env.ASA_OWNER_ADMIN_REASON,
          operator: process.env.USERNAME ?? process.env.USER,
          databaseUrl: process.env.DATABASE_URL,
        };
    ownerAdminOptions(input, mode);
    requireOwner(
      typeof input.databaseUrl === 'string' && input.databaseUrl.length > 0,
      'A private database connection is required.',
    );
    client = new pg.Client({ connectionString: input.databaseUrl, connectionTimeoutMillis: 10000 });
    await client.connect();
    console.log(JSON.stringify(await administerOwner(client, input, mode)));
  } catch (error) {
    // Connection strings and database diagnostics never belong in operator output.
    console.error(
      `platform-admin FAIL: ${error instanceof OwnerAdminError ? error.message : 'Database operation failed; inspect the private connection and database state.'}`,
    );
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => undefined);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await ownerAdminMain();
}
