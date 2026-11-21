import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createInitialRoboticsProject } from '@asa-lab/robotics/document';
import { inspectPlan, planMigrations } from '../../tools/migrate.mjs';
import { seedTeacher } from '../portal/helpers';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';

type FunctionSnapshot = {
  oid: number;
  signature: string;
  acl: string | null;
  definition: string;
};

async function functionSnapshots(client: pg.PoolClient): Promise<FunctionSnapshot[]> {
  return (
    await client.query<FunctionSnapshot>(
      `SELECT oid,oid::regprocedure::text AS signature,proacl::text AS acl,
            pg_get_functiondef(oid) AS definition
       FROM pg_proc
      WHERE pronamespace='public'::regnamespace
        AND proname IN ('analytics_record_event','analytics_start_module_session','admin_get_product_dashboard','analytics_ingest_v2')
      ORDER BY oid::regprocedure::text`,
    )
  ).rows;
}

async function history(client: pg.PoolClient) {
  const rows: Record<string, unknown[]> = {};
  for (const table of [
    'projects',
    'project_drafts',
    'product_analytics_events',
    'product_module_sessions',
    'analytics_operation_receipts',
  ])
    rows[table] = (
      await client.query(
        `SELECT to_jsonb(item) AS item FROM ${table} item ORDER BY to_jsonb(item)::text`,
      )
    ).rows;
  return rows;
}

describe('Robotics Project Core additive migration', () => {
  it('upgrades 0304 to 0305 and 0306 to 0307, preserving source, receipts, grants and learning limits', async () => {
    const source = process.env['TEST_DATABASE_URL'];
    const appSource = process.env['APP_TEST_DATABASE_URL'];
    if (
      !source ||
      !appSource ||
      !new URL(source).pathname.endsWith('_test') ||
      !new URL(appSource).pathname.endsWith('_test') ||
      new URL(source).host !== new URL(appSource).host ||
      new URL(source).pathname !== new URL(appSource).pathname
    )
      throw new Error('Admin and runtime URLs must name the same isolated _test database.');
    const name = `asa_robotics_upgrade_${randomUUID().replaceAll('-', '')}_test`;
    if (!/^asa_robotics_upgrade_[a-f0-9]{32}_test$/.test(name))
      throw new Error('Unsafe fixture database.');
    const owner = new pg.Client({ connectionString: source });
    let created = false;
    let pool: pg.Pool | undefined;
    let runtime: pg.Pool | undefined;
    try {
      await owner.connect();
      await owner.query(`CREATE DATABASE "${name}"`);
      created = true;
      const target = new URL(source);
      target.pathname = `/${name}`;
      const appTarget = new URL(appSource);
      appTarget.pathname = `/${name}`;
      pool = new pg.Pool({ connectionString: target.href, max: 3 });
      runtime = new pg.Pool({ connectionString: appTarget.href, max: 2 });
      const client = await pool.connect();
      try {
        const plan = planMigrations().filter((item) => Number(item.version) <= 305);
        const prefix = plan.filter((item) => Number(item.version) <= 304);
        expect(prefix.at(-1)?.version).toBe('0304');
        expect(plan.at(-1)?.version).toBe('0305');
        await applyIsolatedTestPlan(client, prefix);
        expect(
          (
            await runtime.query(
              'SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
            )
          ).rows,
        ).toEqual([{ role: 'asalab_app', rolsuper: false, rolbypassrls: false }]);

        const teacher = await seedTeacher(pool, 'robotics-forward');
        const actor = (
          await client.query<{ account_id: string; principal_id: string; workspace_id: string }>(
            `SELECT link.account_id,link.principal_id,workspace.id AS workspace_id
             FROM legacy_user_account_links link
             JOIN workspaces workspace ON workspace.tenant_id=link.tenant_id AND workspace.kind='organization'
            WHERE link.tenant_id=$1 AND link.user_id=$2`,
            [teacher.tenantId, teacher.teacherId],
          )
        ).rows[0]!;
        const project = async (module: string): Promise<string> =>
          (
            await client.query<{ id: string }>(
              `INSERT INTO projects(tenant_id,project_scope,module_key,title,created_by,owner_principal_id)
           VALUES ($1,'personal',$2,$3,$4,$5) RETURNING id`,
              [
                teacher.tenantId,
                module,
                `До обновления: ${module}`,
                teacher.teacherId,
                actor.principal_id,
              ],
            )
          ).rows[0]!.id;
        const existing = new Map<string, string>();
        for (const module of ['electronics', 'three-d', 'chess', 'checkers', 'blocks'])
          existing.set(module, await project(module));
        const electronicsId = existing.get('electronics')!;
        const oldSource = {
          schemaVersion: 4,
          components: [],
          connections: [],
          viewport: { x: 21, y: 9, zoom: 1 },
          simulation: { running: false, maxIterations: 24 },
        };
        await client.query(
          `INSERT INTO project_drafts(project_id,tenant_id,document_json,updated_by,updated_by_principal_id)
           VALUES ($1,$2,$3::jsonb,$4,$5)`,
          [
            electronicsId,
            teacher.tenantId,
            JSON.stringify(oldSource),
            teacher.teacherId,
            actor.principal_id,
          ],
        );
        const startSession = (module: string, projectId: string, sessionId = randomUUID()) =>
          runtime!.query(
            `SELECT analytics_start_module_session($1,'account',$2,$3,NULL,$4,$5,$6,
            '127.0.0.1','local_device','Robotics migration fixture') AS id`,
            [
              sessionId,
              actor.account_id,
              actor.principal_id,
              actor.workspace_id,
              module,
              projectId,
            ],
          );
        await startSession('electronics', electronicsId);
        await expect(project('robotics')).rejects.toMatchObject({ code: '23514' });
        await expect(startSession('robotics', electronicsId)).rejects.toMatchObject({
          code: '22023',
        });
        const beforeRows = await history(client);
        const beforeFunctions = await functionSnapshots(client);
        const beforeLedger = (
          await client.query(
            'SELECT to_jsonb(item) AS item FROM schema_migrations item ORDER BY version',
          )
        ).rows;
        const beforeCapabilities = (
          await client.query('SELECT * FROM module_learning_capabilities ORDER BY module_key')
        ).rows;

        expect((await inspectPlan(client, plan)).map((item) => item.version)).toEqual(['0305']);
        expect(await applyIsolatedTestPlan(client, plan)).toBe(1);
        expect(await applyIsolatedTestPlan(client, plan)).toBe(0);
        expect(await history(client)).toEqual(beforeRows);
        expect(
          (
            await client.query(
              "SELECT to_jsonb(item) AS item FROM schema_migrations item WHERE version<>'0305' ORDER BY version",
            )
          ).rows,
        ).toEqual(beforeLedger);
        expect(
          (await client.query('SELECT * FROM module_learning_capabilities ORDER BY module_key'))
            .rows,
        ).toEqual(
          beforeCapabilities.map((capability) =>
            capability.module_key === 'robotics' ? { ...capability, creatable: true } : capability,
          ),
        );
        expect(
          (
            await client.query(
              "SELECT * FROM module_learning_capabilities WHERE module_key='robotics'",
            )
          ).rows,
        ).toEqual([
          {
            module_key: 'robotics',
            creatable: true,
            assignable: false,
            editable_evidence: false,
            submit_project_version: false,
            preview: 'none',
          },
        ]);
        expect(
          (await runtime.query("SELECT module_learning_assignable('robotics') AS allowed")).rows,
        ).toEqual([{ allowed: false }]);

        // Exact function comparison protects context guards, SECURITY DEFINER
        // configuration and grants alongside the intended enum addition.
        const oldModules = "'electronics', 'three-d', 'chess', 'checkers', 'blocks'";
        const oldDashboard = "('electronics'), ('three-d'), ('chess'), ('checkers'), ('blocks')";
        expect(await functionSnapshots(client)).toEqual(
          beforeFunctions.map((snapshot) => ({
            ...snapshot,
            definition: snapshot.definition
              .replaceAll(oldModules, `${oldModules}, 'robotics'`)
              .replaceAll(oldDashboard, `${oldDashboard}, ('robotics')`),
          })),
        );
        await expect(project('unregistered')).rejects.toMatchObject({ code: '23514' });
        await expect(startSession('robotics', electronicsId)).rejects.toMatchObject({
          code: '42501',
        });

        const roboticsId = await project('robotics');
        const roboticsSource = createInitialRoboticsProject();
        await client.query(
          `INSERT INTO project_drafts(project_id,tenant_id,document_json,updated_by,updated_by_principal_id)
           VALUES ($1,$2,$3::jsonb,$4,$5)`,
          [
            roboticsId,
            teacher.tenantId,
            JSON.stringify(roboticsSource),
            teacher.teacherId,
            actor.principal_id,
          ],
        );
        const sessionId = randomUUID();
        expect((await startSession('robotics', roboticsId, sessionId)).rows).toEqual([
          { id: sessionId },
        ]);
        expect(
          (
            await client.query('SELECT document_json FROM project_drafts WHERE project_id=$1', [
              roboticsId,
            ])
          ).rows[0]?.document_json,
        ).toEqual(roboticsSource);
        expect(
          (
            await client.query('SELECT module_key FROM product_module_sessions WHERE id=$1', [
              sessionId,
            ])
          ).rows,
        ).toEqual([{ module_key: 'robotics' }]);
        expect(
          (
            await client.query(
              "SELECT module_key FROM product_analytics_events WHERE flow_id=$1 AND event_type='module.opened'",
              [sessionId],
            )
          ).rows,
        ).toEqual([{ module_key: 'robotics' }]);

        // The V2 browser writer also accepts a direct editor visit. Its SQL
        // boundary must retain all existing receipts and authority checks.
        const catalogPlan = planMigrations().filter((item) => Number(item.version) <= 306);
        expect(catalogPlan.at(-1)?.version).toBe('0306');
        expect(await applyIsolatedTestPlan(client, catalogPlan)).toBe(1);
        const ingest = (operation: string, semantic: object, eventId = randomUUID()) =>
          runtime!.query(
            `SELECT analytics_ingest_v2($1,'account',$2,$3,NULL,$4,NULL,$5,$6::jsonb,
              '{}'::jsonb,clock_timestamp()) AS receipt`,
            [
              eventId,
              actor.account_id,
              actor.principal_id,
              actor.workspace_id,
              operation,
              JSON.stringify(semantic),
            ],
          );
        const visit = {
          outcome: 'succeeded',
          visitId: randomUUID(),
          clientOccurredAt: new Date().toISOString(),
          entryRoute: 'editor.robotics',
          referrerOrigin: null,
        };
        const opened = { outcome: 'succeeded', moduleKey: 'robotics', flowId: randomUUID() };
        await ingest('visit.observed', { ...visit, entryRoute: 'editor.blocks' });
        await expect(ingest('visit.observed', visit)).rejects.toMatchObject({ code: '22023' });
        await expect(ingest('module.opened', opened)).rejects.toMatchObject({ code: '22023' });
        const beforeV2Rows = await history(client);
        const beforeV2Functions = await functionSnapshots(client);
        const beforeV2Ledger = (
          await client.query(
            'SELECT to_jsonb(item) AS item FROM schema_migrations item ORDER BY version',
          )
        ).rows;
        const v2Plan = planMigrations().filter((item) => Number(item.version) <= 307);
        expect(v2Plan.at(-1)?.version).toBe('0307');
        expect((await inspectPlan(client, v2Plan)).map((item) => item.version)).toEqual(['0307']);
        expect(await applyIsolatedTestPlan(client, v2Plan)).toBe(1);
        expect(await applyIsolatedTestPlan(client, v2Plan)).toBe(0);
        expect(await history(client)).toEqual(beforeV2Rows);
        expect(
          (
            await client.query(
              "SELECT to_jsonb(item) AS item FROM schema_migrations item WHERE version<>'0307' ORDER BY version",
            )
          ).rows,
        ).toEqual(beforeV2Ledger);
        const oldV2Modules = "'electronics','three-d','chess','checkers','blocks'";
        const oldV2Routes =
          "'home','projects','editor.electronics','editor.three-d','editor.chess','editor.checkers','editor.blocks','games','classes','learning','account','admin','public','unknown'";
        expect(await functionSnapshots(client)).toEqual(
          beforeV2Functions.map((snapshot) => ({
            ...snapshot,
            definition: snapshot.definition
              .replaceAll(oldV2Modules, `${oldV2Modules},'robotics'`)
              .replaceAll(
                oldV2Routes,
                oldV2Routes.replace("'editor.blocks',", "'editor.blocks','editor.robotics',"),
              ),
          })),
        );
        expect((await ingest('visit.observed', visit)).rows[0]?.receipt).toMatchObject({
          accepted: true,
          state: 'persisted',
          operation: 'visit.observed',
          recordId: expect.any(Number),
        });
        expect((await ingest('module.opened', opened)).rows[0]?.receipt).toMatchObject({
          accepted: true,
          state: 'persisted',
          operation: 'module.opened',
          recordId: expect.any(Number),
        });
        await expect(
          ingest('visit.observed', { ...visit, entryRoute: 'editor.robotics.invalid' }),
        ).rejects.toMatchObject({ code: '22023' });
        await expect(
          ingest('module.opened', { ...opened, moduleKey: 'robotics.invalid' }),
        ).rejects.toMatchObject({ code: '22023' });
      } finally {
        client.release();
      }
    } finally {
      await runtime?.end();
      await pool?.end();
      if (created) await owner.query(`DROP DATABASE "${name}"`);
      await owner.end();
    }
  }, 90_000);
});
