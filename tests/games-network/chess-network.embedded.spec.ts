import { beforeAll, afterAll, describe } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { chessNetworkStorageContract, type NetworkSql } from './storage-contract';
describe('Chess network migrated SQL — disposable embedded PostgreSQL', () => {
  let db: PGlite;
  let admin: NetworkSql;
  let pool: pg.Pool;
  beforeAll(async () => {
    db = new PGlite();
    admin = {
      query: async (sql, values) =>
        values?.length
          ? db.query(sql, values)
          : { rows: ((await db.exec(sql)).at(-1)?.rows as Record<string, unknown>[]) ?? [] },
    };
    await applyPlan(admin, planMigrations());
    pool = {
      connect: async () => {
        await admin.query('SET ROLE asalab_app');
        return {
          query: admin.query,
          release: () => {
            void admin.query('RESET ROLE');
          },
        };
      },
    } as unknown as pg.Pool;
  }, 60_000);
  afterAll(async () => {
    await db?.close();
  });
  chessNetworkStorageContract(() => ({ admin, pool }));
});
