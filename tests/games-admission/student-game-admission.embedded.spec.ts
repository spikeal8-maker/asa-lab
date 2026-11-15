import { afterAll, beforeAll, describe } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { storageContract, type SqlClient } from './storage-contract';

/** Disposable in-memory engine only: no sockets, Docker, school or host DB. */
describe('admission SQL contract (embedded PostgreSQL, complete real migration chain)', () => {
  let db: PGlite;
  let admin: SqlClient;
  let runtime: SqlClient;
  beforeAll(async () => {
    db = new PGlite();
    admin = {
      query: async (sql, params) => {
        if (params?.length) return db.query(sql, params);
        const result = await db.exec(sql);
        return { rows: (result.at(-1)?.rows as Record<string, unknown>[]) ?? [] };
      },
    };
    await applyPlan(admin, planMigrations());
    runtime = {
      query: async (sql, params) => {
        await db.exec('SET ROLE asalab_app');
        try {
          return await admin.query(sql, params);
        } finally {
          await db.exec('RESET ROLE');
        }
      },
    };
  }, 60_000);
  afterAll(async () => {
    await db?.close();
  });
  storageContract(() => ({ admin, runtime }));
});
