import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from '../migration/isolated-postgres-plan';
import { storageContract } from './storage-contract';
import { buildTestApp, type NestApp } from '../portal/app';
import { httpContract } from './http-contract';
import { listRevocationContract } from './reviewer-list-revocation';
import { galleryGameCopyContract } from './reviewer-gallery-game-copy';

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
    let app: NestApp;
    let runtimePassedToApp = false;
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
      admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 3 });
      const client = await admin.connect();
      try {
        await applyIsolatedTestPlan(client, planMigrations());
      } finally {
        client.release();
      }
      runtime = new pg.Pool({ connectionString: runtimeUrl.toString(), max: 6 });
      expect((await runtime.query('SELECT current_user')).rows[0]?.current_user).toBe('asalab_app');
      runtimePassedToApp = true;
      app = await buildTestApp(runtime);
    }, 120_000);
    afterAll(async () => {
      // createApiApp owns an injected pool, including failed construction.
      // End that runtime pool only when it was never handed to the application.
      const results = await Promise.allSettled([
        app?.close(),
        admin?.end(),
        runtimePassedToApp ? undefined : runtime?.end(),
      ]);
      try {
        if (created) await owner.query(`DROP DATABASE "${databaseName}"`);
      } catch (error) {
        results.push({ status: 'rejected', reason: error });
      } finally {
        try {
          await owner?.end();
        } catch (error) {
          results.push({ status: 'rejected', reason: error });
        }
      }
      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason);
      if (errors.length) throw new AggregateError(errors, 'Isolated games test cleanup failed');
    });
    const fixture = storageContract(() => ({ admin, runtime }));
    httpContract(() => ({ admin, runtime, app }), fixture);
    listRevocationContract(() => ({ admin, runtime, app }), fixture);
    galleryGameCopyContract(() => ({ admin, runtime, app }), fixture);
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
