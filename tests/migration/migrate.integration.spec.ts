import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { planMigrations, applyPlan } from '../../tools/migrate.mjs';

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

      const firstPass = await applyPlan(db, planned);
      expect(firstPass).toBe(planned.length);

      const recorded = await db.query<MigrationRow>(
        'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
      );
      expect(recorded.rows.map((row) => row.version)).toEqual(planned.map((m) => m.version));
      expect(recorded.rows[0].checksum).toBe(planned[0].checksum);

      const secondPass = await applyPlan(db, planned);
      expect(secondPass).toBe(0);
    } finally {
      await db.close();
    }
  });

  it('rejects re-applying a migration whose checksum changed after apply', async () => {
    const db = new PGlite();
    try {
      const planned = planMigrations('migrations');
      await applyPlan(db, planned);

      const tampered = planned.map((migration) => ({
        ...migration,
        checksum: `tampered${migration.checksum.slice(8)}`,
      }));
      await expect(applyPlan(db, tampered)).rejects.toThrow(/modified after apply/);
    } finally {
      await db.close();
    }
  });
});
