import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  applyPlan,
  inspectPlan,
  planMigrations,
  validateMigrationHistory,
} from '../../tools/migrate.mjs';
import { verifySchema } from '../../tools/learning-migration-dry-run.mjs';

const plan = planMigrations('migrations');
const oldPlan = plan.filter((item) => Number(item.version) <= 150);
const without146 = oldPlan.filter((item) => item.version !== '0146');
const ledger = (items = without146) =>
  new Map(items.map((item) => [item.version, { checksum: item.checksum }]));
const rewriteSql = (item: ReturnType<typeof planMigrations>[number], sql: string) => ({
  ...item,
  sql,
  checksum: createHash('sha256').update(sql).digest('hex'),
});

function clientFor(db: PGlite) {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (params?.length) return db.query(sql, params);
      const results = await db.exec(sql);
      return { rows: results.at(-1)?.rows ?? [] };
    },
  };
}

describe('published Blocks forward migration', () => {
  it('only skips the pinned late 0146 when the pinned 0151 is in the plan', () => {
    expect(validateMigrationHistory(ledger(), plan).map((item) => item.version)).toEqual([
      '0151',
          '0152',
          '0153',
    ]);
    expect(() => validateMigrationHistory(ledger(), oldPlan)).toThrow(/out-of-order.*0146/);
    for (const version of ['0146', '0151']) {
      const altered = plan.map((item) =>
        item.version === version ? rewriteSql(item, `${item.sql}\n-- changed`) : item,
      );
      expect(() => validateMigrationHistory(ledger(), altered)).toThrow(/out-of-order.*0146/);
      const renamed = plan.map((item) =>
        item.version === version ? { ...item, file: `${version}_other.sql` } : item,
      );
      expect(() => validateMigrationHistory(ledger(), renamed)).toThrow(/out-of-order.*0146/);
    }
  });

  it('keeps all other late-history and applied-checksum guards', () => {
    const anotherGap = ledger(without146.filter((item) => item.version !== '0148'));
    expect(() => validateMigrationHistory(anotherGap, plan)).toThrow(/out-of-order.*0148/);
    const future = ledger();
    future.set('0154', { checksum: 'a'.repeat(64) });
    expect(() => validateMigrationHistory(future, plan)).toThrow(/out-of-order.*0151/);
    const corrupt146 = ledger(oldPlan);
    corrupt146.set('0146', { checksum: 'b'.repeat(64) });
    expect(() => validateMigrationHistory(corrupt146, plan)).toThrow(/modified after apply: 0146/);
    const corrupt151 = ledger();
    corrupt151.set('0151', { checksum: 'c'.repeat(64) });
    expect(() => validateMigrationHistory(corrupt151, plan)).toThrow(/modified after apply: 0151/);
  });

  it('keeps fresh plans unchanged and recognizes completed forward repair', () => {
    expect(validateMigrationHistory(new Map(), plan)).toEqual(plan);
    const repaired = ledger(plan.filter((item) => item.version !== '0146'));
    expect(validateMigrationHistory(repaired, plan)).toEqual([]);
  });

  it('preflights existing history in a read-only transaction and rolls back on failure', async () => {
    for (const candidate of [plan, oldPlan]) {
      const queries: string[] = [];
      const client = {
        query: async (sql: string) => {
          queries.push(sql);
          return {
            rows: sql.startsWith('SELECT version')
              ? without146.map((item) => ({ version: item.version, checksum: item.checksum }))
              : [],
          };
        },
      };
      if (candidate === plan)
        expect((await inspectPlan(client, candidate)).map((item) => item.version)).toEqual([
          '0151',
          '0152',
          '0153',
        ]);
      else await expect(inspectPlan(client, candidate)).rejects.toThrow(/out-of-order/);
      expect(queries).toEqual([
        'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
        'SELECT version, checksum FROM schema_migrations',
        'ROLLBACK',
      ]);
    }
  });

  it('learning dry-run accepts only a completed forward-repaired history', async () => {
    const rows = plan
      .filter((item) => item.version !== '0146')
      .map((item) => ({ version: item.version, checksum: item.checksum }));
    expect(await verifySchema({ query: async () => ({ rows }) })).toBe('0153');
    await expect(
      verifySchema({
        query: async () => ({
          rows: rows.filter((row) => row.version !== '0151' && row.version !== '0152' && row.version !== '0153'),
        }),
      }),
    ).rejects.toThrow(/unsupported_schema:migration_0146/);
    await expect(
      verifySchema({ query: async () => ({ rows: rows.filter((row) => row.version !== '0148') }) }),
    ).rejects.toThrow(/unsupported_schema/);
  });

  it.each([false, true])(
    'upgrades actual 0150 history (has0146=%s), preserves rows and tenant isolation',
    async (has0146) => {
      const db = new PGlite();
      try {
        const client = clientFor(db);
        await applyPlan(client, has0146 ? oldPlan : without146);
        const tenants = await db.query<{ id: string }>(
          `INSERT INTO tenants(title,workspace_slug) VALUES ('keep-a','keep-a'),('keep-b','keep-b') RETURNING id`,
        );
        const tenantA = tenants.rows[0].id;
        const tenantB = tenants.rows[1].id;
        const shaA = 'a'.repeat(64);
        const shaB = 'b'.repeat(64);
        if (has0146) {
          await db.query(
            `INSERT INTO blocks_blobs(tenant_id,sha256,data_format,size_bytes,object_key) VALUES ($1,$2,'png',1,'keep-object')`,
            [tenantA, shaA],
          );
          await db.query(
            `INSERT INTO blocks_asset_aliases(tenant_id,asset_id,data_format,sha256) VALUES ($1,$2,'png',$3)`,
            [tenantA, 'a'.repeat(32), shaA],
          );
        }
        const before = (
          await db.query(
            'SELECT version,name,checksum,applied_at FROM schema_migrations ORDER BY version',
          )
        ).rows;
        expect((await inspectPlan(client, plan)).map((item) => item.version)).toEqual([
          '0151',
          '0152',
          '0153',
        ]);
        expect(
          (
            await db.query(
              'SELECT version,name,checksum,applied_at FROM schema_migrations ORDER BY version',
            )
          ).rows,
        ).toEqual(before);
        expect(await applyPlan(client, plan)).toBe(3);
        expect(await applyPlan(client, plan)).toBe(0);
        expect(
          (
            await db.query(
              "SELECT version,name,checksum,applied_at FROM schema_migrations WHERE version NOT IN ('0151','0152','0153') ORDER BY version",
            )
          ).rows,
        ).toEqual(before);
        expect(
          (
            await db.query(
              "SELECT id FROM tenants WHERE workspace_slug IN ('keep-a','keep-b') ORDER BY workspace_slug",
            )
          ).rows,
        ).toEqual([{ id: tenantA }, { id: tenantB }]);
        if (has0146) {
          expect(
            (await db.query("SELECT object_key FROM blocks_blobs WHERE object_key='keep-object'"))
              .rows,
          ).toHaveLength(1);
          expect((await db.query('SELECT asset_id FROM blocks_asset_aliases')).rows).toEqual([
            { asset_id: 'a'.repeat(32) },
          ]);
        } else {
          expect(
            (await db.query("SELECT version FROM schema_migrations WHERE version='0146'")).rows,
          ).toHaveLength(0);
          await db.query(
            `INSERT INTO blocks_blobs(tenant_id,sha256,data_format,size_bytes,object_key) VALUES ($1,$2,'png',1,'keep-object')`,
            [tenantA, shaA],
          );
        }
        await db.query(
          `INSERT INTO blocks_blobs(tenant_id,sha256,data_format,size_bytes,object_key) VALUES ($1,$2,'png',2,'other-object')`,
          [tenantB, shaB],
        );
        await db.exec('SET ROLE asalab_app');
        await db.query("SELECT set_config('app.tenant_id',$1,false)", [tenantA]);
        expect((await db.query('SELECT object_key FROM blocks_blobs')).rows).toEqual([
          { object_key: 'keep-object' },
        ]);
        await expect(
          db.query(
            `INSERT INTO blocks_blobs(tenant_id,sha256,data_format,size_bytes,object_key) VALUES ($1,$2,'png',1,'cross-tenant')`,
            [tenantB, 'c'.repeat(64)],
          ),
        ).rejects.toThrow(/row-level security/);
        await expect(db.query('UPDATE blocks_blobs SET size_bytes=99')).rejects.toThrow(
          /permission denied/,
        );
      } finally {
        await db.close();
      }
    },
    30_000,
  );

  it.each(['missing', 'permissive', 'extra', 'unrecorded-partial'])(
    'fails closed on recorded 0146 schema/security contradiction: %s',
    async (drift) => {
      const db = new PGlite();
      try {
        const client = clientFor(db);
        await applyPlan(client, drift === 'unrecorded-partial' ? without146 : oldPlan);
        if (drift === 'unrecorded-partial')
          await db.exec('CREATE TABLE blocks_blobs (sentinel text)');
        if (drift === 'missing') await db.exec('DROP TABLE blocks_asset_aliases');
        if (drift === 'permissive')
          await db.exec(
            'ALTER POLICY blocks_blobs_tenant ON blocks_blobs USING (true) WITH CHECK (true)',
          );
        if (drift === 'extra')
          await db.exec('CREATE POLICY unexpected ON blocks_blobs USING (true)');
        await expect(applyPlan(client, plan)).rejects.toThrow(/0151:/);
        expect(
          (await db.query("SELECT version FROM schema_migrations WHERE version='0151'")).rows,
        ).toHaveLength(0);
      } finally {
        await db.close();
      }
    },
    30_000,
  );
});
