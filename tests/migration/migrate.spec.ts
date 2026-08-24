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

  it('treats CRLF and LF copies of the same migration as identical', () => {
    const planned = planMigrations('migrations');
    const migration = planned.find((item) => item.version === '0046');
    expect(migration).toBeDefined();
    const compatibleChecksum = [...(migration?.compatibleChecksums ?? [])].find(
      (checksum) => checksum !== migration?.checksum,
    );
    expect(compatibleChecksum).toMatch(/^[0-9a-f]{64}$/);

    const applied = new Map([[migration!.version, { checksum: compatibleChecksum! }]]);
    const { modified } = reconcile(applied, [migration!]);
    expect(modified).toEqual([]);
  });

  it('accepts only the recorded published checksum lineage for migration 0086', () => {
    const planned = planMigrations('migrations');
    const migration = planned.find((item) => item.version === '0086');
    expect(migration).toBeDefined();

    const publishedChecksum = '9836902598ddea7071e43d365f5d82c611f93d5dfaab96b63beb5a9c683f7d8b';
    expect(migration!.compatibleChecksums).toContain(publishedChecksum);
    expect(
      reconcile(new Map([['0086', { checksum: publishedChecksum }]]), [migration!]).modified,
    ).toEqual([]);

    const tamperedChecksum = `${publishedChecksum.slice(0, -1)}0`;
    expect(
      reconcile(new Map([['0086', { checksum: tamperedChecksum }]]), [migration!]).modified.map(
        (item) => item.version,
      ),
    ).toEqual(['0086']);
  });

  it('treats a correctly applied migration as neither pending nor modified', () => {
    const planned = planMigrations('migrations');
    const applied = new Map([[planned[0].version, { checksum: planned[0].checksum }]]);
    const { pending, modified } = reconcile(applied, planned);
    expect(pending.map((m) => m.version)).not.toContain(planned[0].version);
    expect(modified.length).toBe(0);
  });
});
