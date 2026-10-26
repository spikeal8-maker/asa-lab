import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';

describe('0257 publication pin forward upgrade', () => {
  it('preserves prior schema history and denies direct restricted-role access', async () => {
    const source = process.env.TEST_DATABASE_URL;
    if (!source || !new URL(source).pathname.endsWith('_test'))
      throw new Error('Disposable TEST_DATABASE_URL required');
    const database = 'asa_pin_' + randomUUID().replaceAll('-', '') + '_test';
    const owner = new pg.Client({ connectionString: source });
    let created = false;
    let pool: pg.Pool | undefined;
    try {
      await owner.connect();
      await owner.query('CREATE DATABASE "' + database + '"');
      created = true;
      const target = new URL(source);
      target.pathname = '/' + database;
      pool = new pg.Pool({ connectionString: target.href, max: 2 });
      const plan = planMigrations();
      const prefix = plan.filter((item) => Number(item.version) <= 256);
      expect(prefix.at(-1)?.version).toBe('0256');
      expect(prefix.at(-1)?.file).toBe('0256_crm_user_dashboard.sql');
      const admin = await pool.connect();
      try {
        await applyIsolatedTestPlan(admin, prefix);
        const beforeHistory = await admin.query(
          'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
        );
        const complete = plan.filter((item) => Number(item.version) <= 257);
        expect(complete.at(-1)?.file).toBe('0257_project_publication_pins.sql');
        expect(await applyIsolatedTestPlan(admin, complete)).toBe(1);
        expect(await applyIsolatedTestPlan(admin, complete)).toBe(0);
        const preservedHistory = await admin.query(
          "SELECT version, name, checksum FROM schema_migrations WHERE version <> '0257' ORDER BY version",
        );
        expect(preservedHistory.rows).toEqual(beforeHistory.rows);
        const pinnedRows = await admin.query('SELECT * FROM project_publication_pin');
        expect(pinnedRows.rows).toEqual([]);
        const runtime = await pool.connect();
        try {
          await runtime.query('SET ROLE asalab_app');
          for (const command of [
            'SELECT * FROM project_publication_pin',
            'DELETE FROM project_publication_pin',
            'UPDATE project_publication_pin SET pinned=false',
          ]) {
            await expect(runtime.query(command)).rejects.toMatchObject({ code: '42501' });
          }
          await expect(
            runtime.query('SELECT * FROM project_publication_editorial_lifecycle'),
          ).rejects.toMatchObject({ code: '42501' });
          await expect(
            runtime.query('SELECT admin_publication_pin_set(NULL,NULL,true,NULL,0,NULL,0,0)'),
          ).rejects.toMatchObject({ code: '42501' });
          const readable = await runtime.query(
            'SELECT project_publication_pinned(NULL,NULL) AS pinned',
          );
          expect(readable.rows[0]?.pinned).toBe(false);
        } finally {
          await runtime.query('RESET ROLE');
          runtime.release();
        }
      } finally {
        admin.release();
      }
    } finally {
      if (pool) await pool.end();
      if (created) await owner.query('DROP DATABASE "' + database + '"');
      await owner.end();
    }
  }, 180_000);
});
