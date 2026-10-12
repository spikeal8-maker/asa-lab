import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { inspectPlan, planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';

describe('additive analytics receipt upgrade', () => {
  it('applies only the new migration after 0206 and preserves released history/signatures on repeat', async () => {
    const source = process.env['TEST_DATABASE_URL'];
    if (!source || !new URL(source).pathname.endsWith('_test'))
      throw new Error('Isolated TEST_DATABASE_URL required');
    const name = `asa_analytics_upgrade_${randomUUID().replaceAll('-', '')}_test`;
    if (!/^asa_analytics_upgrade_[a-f0-9]{32}_test$/.test(name))
      throw new Error('Unsafe fixture database');
    const owner = new pg.Client({ connectionString: source });
    let created = false;
    let pool: pg.Pool | undefined;
    try {
      await owner.connect();
      await owner.query(`CREATE DATABASE "${name}"`);
      created = true;
      const target = new URL(source);
      target.pathname = '/' + name;
      pool = new pg.Pool({ connectionString: target.toString(), max: 1 });
      const client = await pool.connect();
      try {
        // This isolated receipt test upgrades exactly 0206 → 0207.
        // Later Classroom migrations have independent full-forward upgrade tests.
        const plan = planMigrations().filter((item) => Number(item.version) <= 207);
        const old = plan.filter((item) => Number(item.version) <= 206);
        await applyIsolatedTestPlan(client, old);
        await client.query(
          "SELECT analytics_record_event('anonymous',NULL,NULL,NULL,NULL,'auth.login','failed','password',NULL,NULL,'203.0.113.1','old normalized')",
        );
        const history = (await client.query('SELECT * FROM product_analytics_events ORDER BY id'))
          .rows;
        const ledger = (await client.query('SELECT * FROM schema_migrations ORDER BY version'))
          .rows;
        const definitions = (
          await client.query(
            "SELECT oid::regprocedure::text signature,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('analytics_record_event','analytics_start_module_session','analytics_touch_module_session','classroom_activity_record','classroom_activity_record_project') ORDER BY oid::regprocedure::text",
          )
        ).rows;
        expect((await inspectPlan(client, plan)).map((item) => item.version)).toEqual(['0207']);
        expect(await applyIsolatedTestPlan(client, plan)).toBe(1);
        expect(await applyIsolatedTestPlan(client, plan)).toBe(0);
        expect(
          (
            await client.query(
              "SELECT * FROM schema_migrations WHERE version<>'0207' ORDER BY version",
            )
          ).rows,
        ).toEqual(ledger);
        // Additive columns are NULL for history; no reconstructed provenance.
        expect(
          (
            await client.query(
              'SELECT id,actor_kind,event_type,outcome,occurred_at,user_agent_summary FROM product_analytics_events ORDER BY id',
            )
          ).rows,
        ).toEqual(
          history.map(
            ({ id, actor_kind, event_type, outcome, occurred_at, user_agent_summary }) => ({
              id,
              actor_kind,
              event_type,
              outcome,
              occurred_at,
              user_agent_summary,
            }),
          ),
        );
        expect(
          (
            await client.query(
              'SELECT observation_version,receipt_event_id,browser_family FROM product_analytics_events',
            )
          ).rows.every(
            (row) =>
              row.observation_version === null &&
              row.receipt_event_id === null &&
              row.browser_family === null,
          ),
        ).toBe(true);
        expect(
          (
            await client.query(
              "SELECT oid::regprocedure::text signature,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('analytics_record_event','analytics_start_module_session','analytics_touch_module_session','classroom_activity_record','classroom_activity_record_project') ORDER BY oid::regprocedure::text",
            )
          ).rows,
        ).toEqual(definitions);
        const publicExecute = await client.query(
          "SELECT p.proname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE p.pronamespace='public'::regnamespace AND p.proname IN('analytics_ingest_v2','analytics_record_admission_v2') AND acl.grantee=0 AND acl.privilege_type='EXECUTE'",
        );
        expect(publicExecute.rows).toHaveLength(0);
      } finally {
        client.release();
      }
    } finally {
      await pool?.end();
      if (created) await owner.query(`DROP DATABASE "${name}"`);
      await owner.end();
    }
  }, 30_000);
});
