import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from '../migration/isolated-postgres-plan';
import { storageContract } from './storage-contract';

// Opt-in only on isolated CI. Never silently use an application/dev DB URL.
// Embedded tests above remain executable without any PostgreSQL service.
const enabled =
  process.env['CI'] === 'true' &&
  !!process.env['TEST_DATABASE_URL'] &&
  !!process.env['APP_TEST_DATABASE_URL'];
describe.skipIf(!enabled)(
  'admission SQL contract (isolated CI PostgreSQL, real runtime role)',
  () => {
    const databaseName = `asa_games_admission_${randomUUID().replaceAll('-', '')}_test`;
    let owner: pg.Pool;
    let admin: pg.Pool;
    let runtime: pg.Pool;
    let created = false;
    beforeAll(async () => {
      const adminUrl = new URL(process.env['TEST_DATABASE_URL']!);
      const runtimeUrl = new URL(process.env['APP_TEST_DATABASE_URL']!);
      if (
        !adminUrl.pathname.endsWith('_test') ||
        adminUrl.pathname !== runtimeUrl.pathname ||
        adminUrl.host !== runtimeUrl.host ||
        !/^asa_games_admission_[a-f0-9]{32}_test$/.test(databaseName)
      )
        throw new Error('Matching isolated _test URLs required');
      owner = new pg.Pool({ connectionString: adminUrl.toString(), max: 1 });
      await owner.query(`CREATE DATABASE "${databaseName}"`);
      created = true;
      adminUrl.pathname = runtimeUrl.pathname = '/' + databaseName;
      admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 2 });
      const client = await admin.connect();
      try {
        await applyIsolatedTestPlan(client, planMigrations());
      } finally {
        client.release();
      }
      runtime = new pg.Pool({ connectionString: runtimeUrl.toString(), max: 2 });
      expect((await runtime.query('SELECT current_user')).rows[0]?.current_user).toBe('asalab_app');
    }, 60_000);
    afterAll(async () => {
      await Promise.all([admin?.end(), runtime?.end()]);
      if (created) await owner.query(`DROP DATABASE "${databaseName}"`);
      await owner?.end();
    });
    const fixture = storageContract(() => ({ admin, runtime }));
    it('serializes competing initial updates on the existing class row', async () => {
      // Fresh class with no policy row, two actual runtime connections.
      const f = await fixture();
      const current = (await f.read()) as { version: number };
      const input = JSON.stringify({
        mode: 'deny',
        threshold: null,
        expectedVersion: current.version,
      });
      const sql = `SELECT public.classroom_games_policy_write($1,$2,$3,NULL,'class',$4::jsonb) data`;
      const results = await Promise.all([
        runtime.query(sql, [f.actor, f.teacher.tenantId, f.classroomId, input]),
        runtime.query(sql, [f.actor, f.teacher.tenantId, f.classroomId, input]),
      ]);
      expect(
        results.map((r) => r.rows[0].data).filter((d) => d.error === 'version_conflict'),
      ).toHaveLength(1);
      expect(
        results.map((r) => r.rows[0].data).filter((d) => d.version === current.version + 1),
      ).toHaveLength(1);
    });
  },
);
