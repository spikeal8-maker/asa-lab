import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { inspectPlan, planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';

const targets = [
  'public.classroom_participant_metrics(uuid)',
  'public.learning_canonical_evidence_for_seat(uuid)',
  'public.learning_canonical_evidence_for_account(uuid)',
  'public.learning_canonical_evidence_for_teacher(uuid,uuid)',
];
const controls = [
  'public.ai_access_status(uuid)',
  'public.learning_canonical_evidence_internal(uuid,uuid,boolean)',
  'public.learning_canonical_evidence_for_teacher_account(uuid)',
  'public.classroom_participant_roster(uuid,uuid)',
  'public.classroom_participant_profile(uuid,uuid,uuid)',
];

interface FunctionSnapshot {
  signature: string;
  metadata: Record<string, unknown>;
  config: string[] | null;
  app_execute: boolean;
  public_execute: boolean;
}

async function functionSnapshots(client: pg.PoolClient) {
  return (
    await client.query<FunctionSnapshot>(
      `SELECT requested.signature,to_jsonb(proc)-'proconfig' AS metadata,
          proc.proconfig AS config,
          has_function_privilege('asalab_app',proc.oid,'EXECUTE') AS app_execute,
          EXISTS (
            SELECT 1 FROM aclexplode(COALESCE(proc.proacl,acldefault('f',proc.proowner))) privilege
              WHERE privilege.grantee=0 AND privilege.privilege_type='EXECUTE'
          ) AS public_execute
        FROM unnest($1::text[]) requested(signature)
        JOIN pg_proc proc ON proc.oid=to_regprocedure(requested.signature)
        ORDER BY requested.signature`,
      [[...targets, ...controls]],
    )
  ).rows;
}

async function callerSettings(client: pg.PoolClient) {
  return (
    await client.query(`SELECT pg_backend_pid() AS pid,
      current_setting('jit') AS jit,current_setting('search_path') AS search_path,
      current_setting('TimeZone') AS timezone,
      current_setting('transaction_read_only') AS read_only,
      current_setting('default_transaction_read_only') AS default_read_only`)
  ).rows[0];
}

async function invokeWithoutCallerLeaks(client: pg.PoolClient, unknownId: string) {
  const outside = await callerSettings(client);
  const payloads: unknown[] = [];
  await client.query('BEGIN READ ONLY');
  try {
    // Transaction-local test settings differ from the function settings. The
    // same physical caller must recover them immediately after every call.
    await client.query(`SET LOCAL jit=on; SET LOCAL search_path=public,pg_catalog;
      SET LOCAL TimeZone='Europe/Moscow'`);
    const expected = await callerSettings(client);
    expect(expected).toMatchObject({
      pid: outside.pid,
      jit: 'on',
      search_path: 'public, pg_catalog',
      timezone: 'Europe/Moscow',
      read_only: 'on',
      default_read_only: outside.default_read_only,
    });
    // Empty scopes exercise actual function entry/exit without manufacturing
    // academic history. Populated payload/performance evidence is a separate proof.
    for (const sql of [
      'SELECT * FROM public.classroom_participant_metrics($1::uuid)',
      'SELECT * FROM public.learning_canonical_evidence_for_seat($1::uuid)',
      'SELECT * FROM public.learning_canonical_evidence_for_account($1::uuid)',
      'SELECT * FROM public.learning_canonical_evidence_for_teacher($1::uuid,$1::uuid)',
    ]) {
      const result = await client.query(sql, [unknownId]);
      expect(await callerSettings(client)).toEqual(expected);
      expect(result.rows).toEqual([]);
      payloads.push(result.rows);
    }
  } finally {
    await client.query('ROLLBACK');
  }
  expect(await callerSettings(client)).toEqual(outside);
  return payloads;
}

describe('0319 function-local canonical read JIT forward upgrade', () => {
  it('preserves function identity, metadata, privileges, history and caller settings across 0318 -> 0319', async () => {
    const source = process.env['TEST_DATABASE_URL'];
    if (!source || !decodeURIComponent(new URL(source).pathname).endsWith('_test'))
      throw new Error('Disposable TEST_DATABASE_URL required');
    const database = `asa_jit_upgrade_${randomUUID().replaceAll('-', '')}_test`;
    if (!/^asa_jit_upgrade_[a-f0-9]{32}_test$/.test(database))
      throw new Error('Unsafe generated test database name');
    const owner = new pg.Client({ connectionString: source });
    let created = false;
    let pool: pg.Pool | undefined;
    try {
      await owner.connect();
      await owner.query(`CREATE DATABASE "${database}"`);
      created = true;
      const target = new URL(source);
      target.pathname = '/' + database;
      pool = new pg.Pool({ connectionString: target.href, max: 1 });
      const client = await pool.connect();
      try {
        const plan = planMigrations().filter((migration) => Number(migration.version) <= 319);
        const prefix = plan.filter((migration) => Number(migration.version) <= 318);
        expect(prefix.at(-1)?.file).toBe('0318_admin_operational_overview.sql');
        const migration = plan.at(-1)!;
        expect(migration.file).toBe('0319_canonical_read_boundaries_jit.sql');
        expect(await applyIsolatedTestPlan(client, prefix)).toBe(prefix.length);
        const history = (
          await client.query(
            'SELECT to_jsonb(m) AS value FROM schema_migrations m ORDER BY version',
          )
        ).rows;
        const before = await functionSnapshots(client);
        expect(before).toHaveLength(targets.length + controls.length);
        const bySignature = new Map(before.map((snapshot) => [snapshot.signature, snapshot]));
        for (const signature of targets) {
          expect(
            bySignature.get(signature)?.config?.filter((setting) => setting.startsWith('jit=')),
          ).toEqual([]);
        }
        expect(bySignature.get(targets[0]!)?.config).toContain('TimeZone=UTC');
        const unknownId = randomUUID();
        const beforeReads = await invokeWithoutCallerLeaks(client, unknownId);
        expect((await inspectPlan(client, plan)).map((pending) => pending.version)).toEqual([
          '0319',
        ]);
        expect(await applyIsolatedTestPlan(client, plan)).toBe(1);

        const after = await functionSnapshots(client);
        expect(after).toHaveLength(before.length);
        for (const snapshot of after) {
          const original = bySignature.get(snapshot.signature)!;
          if (targets.includes(snapshot.signature)) {
            // All pg_proc columns except proconfig are compared, including OID,
            // source/body, owner, raw ACL, security, volatility and language.
            expect(snapshot.metadata).toEqual(original.metadata);
            expect(snapshot.app_execute).toBe(original.app_execute);
            expect(snapshot.public_execute).toBe(original.public_execute);
            expect(snapshot.config?.filter((setting) => setting.startsWith('jit='))).toEqual([
              'jit=off',
            ]);
            expect(snapshot.config?.filter((setting) => !setting.startsWith('jit='))).toEqual(
              original.config,
            );
          } else {
            // Existing roster/profile/teacher_account jit=off overrides stay
            // intact; AI access and the internal reader acquire no new override.
            expect(snapshot).toEqual(original);
          }
        }
        expect(await invokeWithoutCallerLeaks(client, unknownId)).toEqual(beforeReads);
        const upgradedHistory = (
          await client.query(
            'SELECT to_jsonb(m) AS value FROM schema_migrations m ORDER BY version',
          )
        ).rows;
        expect(upgradedHistory).toHaveLength(history.length + 1);
        expect(upgradedHistory.slice(0, -1)).toEqual(history);
        expect(upgradedHistory.at(-1)?.value).toMatchObject({
          version: '0319',
          name: migration.name,
          checksum: migration.checksum,
        });
        expect(await applyIsolatedTestPlan(client, plan)).toBe(0);
        expect(await functionSnapshots(client)).toEqual(after);
        expect(
          (
            await client.query(
              'SELECT to_jsonb(m) AS value FROM schema_migrations m ORDER BY version',
            )
          ).rows,
        ).toEqual(upgradedHistory);
      } finally {
        client.release();
      }
    } finally {
      try {
        await pool?.end();
        if (created) await owner.query(`DROP DATABASE "${database}"`);
      } finally {
        await owner.end();
      }
    }
  }, 180_000);
});
