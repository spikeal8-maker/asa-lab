import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { inspectPlan, planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';

describe('Blocks forward upgrade on real PostgreSQL', () => {
  it.each([false, true])(
    'preserves existing 0150 history (has0146=%s)',
    async (has0146) => {
      const source = process.env['TEST_DATABASE_URL'];
      if (!source || !new URL(source).pathname.endsWith('_test'))
        throw new Error('Isolated TEST_DATABASE_URL required');
      const name = `asa_blocks_forward_${randomUUID().replaceAll('-', '')}_test`;
      if (!/^asa_blocks_forward_[a-f0-9]{32}_test$/.test(name))
        throw new Error('Unsafe generated test database name');
      const owner = new pg.Client({ connectionString: source });
      let databaseCreated = false;
      let pool: pg.Pool | undefined;
      try {
        await owner.connect();
        await owner.query(`CREATE DATABASE "${name}"`);
        databaseCreated = true;
        const target = new URL(source);
        target.pathname = '/' + name;
        pool = new pg.Pool({ connectionString: target.toString(), max: 1 });
        const client = await pool.connect();
        try {
          const plan = planMigrations();
          const forwardVersions = plan
            .filter((item) => Number(item.version) > 150)
            .map((item) => item.version);
          const oldPlan = plan.filter(
            (item) => Number(item.version) <= 150 && (has0146 || item.version !== '0146'),
          );
          await applyIsolatedTestPlan(client, oldPlan);
          await client.query("INSERT INTO tenants(title,workspace_slug) VALUES ('keep','keep')");
          const before = (await client.query('SELECT * FROM schema_migrations ORDER BY version'))
            .rows;
          const tenants = (await client.query('SELECT * FROM tenants ORDER BY id')).rows;
          expect((await inspectPlan(client, plan)).map((item) => item.version)).toEqual(
            forwardVersions,
          );
          expect(await applyIsolatedTestPlan(client, plan)).toBe(forwardVersions.length);
          expect(await applyIsolatedTestPlan(client, plan)).toBe(0);
          expect(
            (
              await client.query(
                'SELECT * FROM schema_migrations WHERE NOT (version = ANY($1::text[])) ORDER BY version',
                [forwardVersions],
              )
            ).rows,
          ).toEqual(before);
          expect((await client.query('SELECT * FROM tenants ORDER BY id')).rows).toEqual(tenants);
          expect(
            (
              await client.query(
                "SELECT count(*)::int AS n FROM pg_class WHERE oid IN ('blocks_blobs'::regclass,'blocks_asset_aliases'::regclass) AND relrowsecurity AND relforcerowsecurity",
              )
            ).rows,
          ).toEqual([{ n: 2 }]);
        } finally {
          client.release();
        }
      } finally {
        await pool?.end();
        if (databaseCreated) await owner.query(`DROP DATABASE "${name}"`);
        await owner.end();
      }
    },
    30_000,
  );
});
