import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { aiOwnQualityContract } from './ai-own-quality.contract';
import { aiOwnQualityHttpContract } from './ai-own-quality-http.contract';
let db: PGlite;
const admin = {
  query: async (sql: string, params: unknown[] = []) =>
    params.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] },
} as unknown as pg.Pool;
let serial: Promise<unknown> = Promise.resolve();
const runtime = {
  query: async (sql: string, params: unknown[] = []) => {
    const pending = serial.then(async () => {
      await db.exec('SET ROLE asalab_app');
      try {
        return await admin.query(sql, params);
      } finally {
        await db.exec('RESET ROLE');
      }
    });
    serial = pending.catch(() => undefined);
    return pending;
  },
} as unknown as pg.Pool;
beforeAll(async () => {
  db = new PGlite();
  await applyPlan(admin, planMigrations('migrations'));
}, 30000);
afterAll(async () => db?.close());
aiOwnQualityContract(() => ({ admin, runtime }));
aiOwnQualityHttpContract(() => ({ admin, runtime }));
