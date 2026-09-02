import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { planMigrations, applyPlan } from '../../tools/migrate.mjs';

/** PGlite's query() uses the extended protocol (single statement only), while
 * real migrations contain multiple statements. Route parameterless calls
 * through exec() — exactly how multi-statement SQL runs on a real server. */
function pgliteClient(db: PGlite): {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
} {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (params && params.length > 0) {
        return db.query(sql, params) as Promise<{ rows: Record<string, unknown>[] }>;
      }
      const results = await db.exec(sql);
      const last = results[results.length - 1];
      return { rows: (last?.rows ?? []) as Record<string, unknown>[] };
    },
  };
}

interface MigrationRow {
  version: string;
  name: string;
  checksum: string;
}

describe('migration runner apply (embedded PostgreSQL via PGlite)', () => {
  it('applies pending migrations, records them, and is idempotent', async () => {
    const db = new PGlite();
    try {
      const planned = planMigrations('migrations');

      const client = pgliteClient(db);
      const firstPass = await applyPlan(client, planned);
      expect(firstPass).toBe(planned.length);

      const recorded = await db.query<MigrationRow>(
        'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
      );
      expect(recorded.rows.map((row) => row.version)).toEqual(planned.map((m) => m.version));
      expect(recorded.rows[0].checksum).toBe(planned[0].checksum);

      const secondPass = await applyPlan(client, planned);
      expect(secondPass).toBe(0);
    } finally {
      await db.close();
    }
  }, 30_000);

  it('rejects re-applying a migration whose checksum changed after apply', async () => {
    const db = new PGlite();
    try {
      const planned = planMigrations('migrations');
      const client = pgliteClient(db);
      await applyPlan(client, planned);

      const tampered = planned.map((migration) => ({
        ...migration,
        checksum: `tampered${migration.checksum.slice(8)}`,
      }));
      await expect(applyPlan(client, tampered)).rejects.toThrow(/modified after apply/);
    } finally {
      await db.close();
    }
  }, 30_000);

  it('enforces one-to-one MAX linking, replay protection and session creation', async () => {
    const db = new PGlite();
    try {
      await applyPlan(pgliteClient(db), planMigrations('migrations'));
      const account = await db.query<{ id: string }>(
        `INSERT INTO accounts (email, password_hash, birth_date, country)
         VALUES ('max-owner@example.test', 'not-used', DATE '1990-01-01', 'RU')
         RETURNING id`,
      );
      const accountId = account.rows[0].id;
      await db.query(
        `INSERT INTO profiles (account_id, username, display_name)
         VALUES ($1, 'max_owner', 'MAX Owner')`,
        [accountId],
      );
      const principal = await db.query<{ id: string }>(
        `INSERT INTO principals (kind, account_id) VALUES ('account', $1) RETURNING id`,
        [accountId],
      );
      const tenant = await db.query<{ id: string }>(
        `INSERT INTO tenants (title, workspace_slug)
         VALUES ('MAX test', 'max-test') RETURNING id`,
      );
      const workspace = await db.query<{ id: string }>(
        `INSERT INTO workspaces (tenant_id, kind, title)
         VALUES ($1, 'personal', 'Personal') RETURNING id`,
        [tenant.rows[0].id],
      );
      await db.query(
        `INSERT INTO workspace_memberships (account_id, workspace_id, role)
         VALUES ($1, $2, 'owner')`,
        [accountId, workspace.rows[0].id],
      );

      const now = Math.floor(Date.now() / 1000);
      const linked = await db.query<{ result: string }>(
        `SELECT result FROM auth_max_link($1, $2, $3, $4, $5, $6)`,
        [accountId, '231408577954', 'query-link-1', now, 'asa_owner', 'ASA Owner'],
      );
      expect(linked.rows[0].result).toBe('linked');

      const replayedLink = await db.query<{ result: string }>(
        `SELECT result FROM auth_max_link($1, $2, $3, $4, $5, $6)`,
        [accountId, '231408577954', 'query-link-1', now, 'asa_owner', 'ASA Owner'],
      );
      expect(replayedLink.rows[0].result).toBe('assertion_replayed');

      const signedIn = await db.query<{ result: string; account_id: string }>(
        `SELECT result, account_id
           FROM auth_max_login($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          '231408577954',
          'query-login-1',
          now,
          'asa_owner',
          'ASA Owner',
          'a'.repeat(64),
          12,
          'MAX · Windows',
        ],
      );
      expect(signedIn.rows[0]).toEqual({ result: 'authenticated', account_id: accountId });
      const sessions = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM sessions_v2
          WHERE token_hash = $1
            AND client_metadata ->> 'authenticationProvider' = 'max'`,
        ['a'.repeat(64)],
      );
      expect(sessions.rows[0].count).toBe(1);

      const replayedLogin = await db.query<{ result: string }>(
        `SELECT result FROM auth_max_login($1, $2, $3, $4, $5, $6, $7, $8)`,
        ['231408577954', 'query-login-1', now, null, null, 'b'.repeat(64), 12, null],
      );
      expect(replayedLogin.rows[0].result).toBe('assertion_replayed');

      const secondAccount = await db.query<{ id: string }>(
        `INSERT INTO accounts (email, password_hash, birth_date, country)
         VALUES ('max-second@example.test', 'not-used', DATE '1990-01-01', 'RU')
         RETURNING id`,
      );
      const taken = await db.query<{ result: string }>(
        `SELECT result FROM auth_max_link($1, $2, $3, $4, $5, $6)`,
        [secondAccount.rows[0].id, '231408577954', 'query-link-2', now, null, null],
      );
      expect(taken.rows[0].result).toBe('identity_taken');

      await db.query(`SELECT session_refresh_attach($1, $2, 'max', 30)`, [
        'a'.repeat(64),
        'c'.repeat(64),
      ]);
      await db.query(`SELECT session_v2_create($1, $2, $3, 12)`, [
        principal.rows[0].id,
        workspace.rows[0].id,
        'p'.repeat(64),
      ]);
      await db.query(`SELECT session_refresh_attach($1, $2, 'password', 30)`, [
        'p'.repeat(64),
        'd'.repeat(64),
      ]);
      const unlinked = await db.query<{ unlinked: boolean }>(
        `SELECT auth_max_unlink_self($1, $2) AS unlinked`,
        [accountId, principal.rows[0].id],
      );
      expect(unlinked.rows[0].unlinked).toBe(true);
      const lifecycle = await db.query<{
        active_identity: number;
        active_max_session: number;
        active_password_session: number;
        revoke_events: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM account_external_identities
             WHERE account_id = $1 AND provider = 'max' AND revoked_at IS NULL) AS active_identity,
           (SELECT count(*)::int FROM sessions_v2
             WHERE token_hash = $2 AND revoked_at IS NULL) AS active_max_session,
           (SELECT count(*)::int FROM sessions_v2
             WHERE token_hash = $3 AND revoked_at IS NULL) AS active_password_session,
           (SELECT count(*)::int FROM account_external_identity_events
             WHERE account_id = $1 AND event = 'revoked') AS revoke_events`,
        [accountId, 'a'.repeat(64), 'p'.repeat(64)],
      );
      expect(lifecycle.rows[0]).toEqual({
        active_identity: 0,
        active_max_session: 0,
        active_password_session: 1,
        revoke_events: 1,
      });

      const storedColumns = await db.query<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_name = 'account_external_identities'`,
      );
      expect(storedColumns.rows.map((row) => row.column_name)).not.toContain('ip');
    } finally {
      await db.close();
    }
  }, 30_000);

  it('registers through MAX, completes a one-time browser pairing and creates a password', async () => {
    const db = new PGlite();
    try {
      await applyPlan(pgliteClient(db), planMigrations('migrations'));
      const now = Math.floor(Date.now() / 1000);
      const registered = await db.query<{
        result: string;
        account_id: string;
      }>(
        `SELECT result, account_id
           FROM auth_max_register_account(
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12,$13,$14
           )`,
        [
          '231408577955',
          'query-register-1',
          now,
          'asa_new',
          'ASA New',
          'max-new@example.test',
          'initial-password-hash'.repeat(3),
          'ASA New',
          'max_new',
          '1990-01-01',
          'RU',
          'adult-v1',
          'r'.repeat(64),
          12,
        ],
      );
      expect(registered.rows[0].result).toBe('authenticated');
      const accountId = registered.rows[0].account_id;

      const created = await db.query<{ created: boolean }>(
        `SELECT auth_max_pairing_start($1, 10) AS created`,
        ['q'.repeat(64)],
      );
      expect(created.rows[0].created).toBe(true);
      const linkCreated = await db.query<{ created: boolean }>(
        `SELECT auth_max_pairing_start($1, 10, $2) AS created`,
        ['l'.repeat(64), accountId],
      );
      expect(linkCreated.rows[0].created).toBe(true);
      const linkTarget = await db.query<{ result: string; requested_account_id: string }>(
        `SELECT result, requested_account_id FROM auth_max_pairing_target($1)`,
        ['l'.repeat(64)],
      );
      expect(linkTarget.rows[0]).toEqual({ result: 'pending', requested_account_id: accountId });
      const approved = await db.query<{ approved: boolean }>(
        `SELECT auth_max_pairing_approve($1, $2) AS approved`,
        ['q'.repeat(64), accountId],
      );
      expect(approved.rows[0].approved).toBe(true);
      const consumed = await db.query<{ result: string; account_id: string }>(
        `SELECT result, account_id FROM auth_max_pairing_consume($1, $2, 12, $3)`,
        ['q'.repeat(64), 's'.repeat(64), 'MAX · Windows'],
      );
      expect(consumed.rows[0]).toEqual({ result: 'authenticated', account_id: accountId });
      const consumedAgain = await db.query<{ result: string }>(
        `SELECT result FROM auth_max_pairing_consume($1, $2, 12, NULL)`,
        ['q'.repeat(64), 'x'.repeat(64)],
      );
      expect(consumedAgain.rows[0].result).toBe('consumed');

      const context = await db.query<{
        password_configured: boolean;
        authentication_source: string;
      }>(
        `SELECT password_configured, authentication_source
           FROM auth_account_password_context($1, $2)`,
        [accountId, 's'.repeat(64)],
      );
      expect(context.rows[0]).toEqual({
        password_configured: false,
        authentication_source: 'max',
      });
      const changed = await db.query<{ changed: boolean }>(
        `SELECT auth_account_password_set($1, $2, $3) AS changed`,
        [accountId, 's'.repeat(64), 'new-password-hash'.repeat(3)],
      );
      expect(changed.rows[0].changed).toBe(true);
      const state = await db.query<{
        password_configured: boolean;
        current_active: boolean;
        original_revoked: boolean;
      }>(
        `SELECT a.password_configured,
                (current_session.revoked_at IS NULL) AS current_active,
                (original_session.revoked_at IS NOT NULL) AS original_revoked
           FROM accounts a
           JOIN sessions_v2 current_session ON current_session.token_hash = $2
           JOIN sessions_v2 original_session ON original_session.token_hash = $3
          WHERE a.id = $1`,
        [accountId, 's'.repeat(64), 'r'.repeat(64)],
      );
      expect(state.rows[0]).toEqual({
        password_configured: true,
        current_active: true,
        original_revoked: true,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
