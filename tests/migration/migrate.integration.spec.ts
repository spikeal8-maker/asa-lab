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
  });

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
  });
});
