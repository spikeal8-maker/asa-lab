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
      await db.query(`INSERT INTO principals (kind, account_id) VALUES ('account', $1)`, [
        accountId,
      ]);
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
});
