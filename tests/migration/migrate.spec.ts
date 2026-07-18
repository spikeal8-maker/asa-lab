import { describe, it, expect } from 'vitest';
// The migration runner exposes its pure planning/reconciliation logic so it can
// be verified without a live database. Applying migrations is covered by the
// smoke mode against real PostgreSQL.
import { planMigrations, reconcile } from '../../tools/migrate.mjs';

describe('migration runner planning', () => {
  it('plans the repository migrations in order with checksums', () => {
    const planned = planMigrations('migrations');
    expect(planned.length).toBeGreaterThanOrEqual(1);
    expect(planned[0].version).toBe('0001');
    for (const migration of planned) {
      expect(migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('marks unapplied migrations as pending', () => {
    const planned = planMigrations('migrations');
    const { pending, modified } = reconcile(new Map(), planned);
    expect(pending.length).toBe(planned.length);
    expect(modified.length).toBe(0);
  });

  it('detects a modified already-applied migration', () => {
    const planned = planMigrations('migrations');
    const applied = new Map([[planned[0].version, { checksum: 'deadbeef' }]]);
    const { pending, modified } = reconcile(applied, planned);
    expect(modified.map((m) => m.version)).toContain(planned[0].version);
    expect(pending.map((m) => m.version)).not.toContain(planned[0].version);
  });

  it('treats a correctly applied migration as neither pending nor modified', () => {
    const planned = planMigrations('migrations');
    const applied = new Map([[planned[0].version, { checksum: planned[0].checksum }]]);
    const { pending, modified } = reconcile(applied, planned);
    expect(pending.map((m) => m.version)).not.toContain(planned[0].version);
    expect(modified.length).toBe(0);
  });
});
