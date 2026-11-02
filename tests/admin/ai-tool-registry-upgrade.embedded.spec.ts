import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { expect, it } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { AI_TOOL_IDS } from '@asa-lab/contracts';
import { AiToolPolicyService } from '../../apps/api/src/ai-tool-policy';
import { aiTextFixture } from './ai-text-history.contract';
import { fixtureGenerationSql } from './ai-model-policy.fixture';

it('upgrades four rules without enabling disabled page reading or rewriting historical snapshots', async () => {
  const db = new PGlite();
  const query = async (sql: string, params: unknown[] = []) =>
    params.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] };
  const admin = { query } as unknown as pg.Pool;
  const runtime = {
    query: async (sql: string, params: unknown[] = []) => {
      await db.exec('SET ROLE asalab_app');
      try {
        return await query(sql, params);
      } finally {
        await db.exec('RESET ROLE');
      }
    },
  } as unknown as pg.Pool;
  try {
    const plan = planMigrations('migrations');
    await applyPlan(
      { query },
      plan.filter((item) => item.version < '0301'),
    );
    await admin.query(
      "UPDATE ai_tool_policy_settings SET tools=jsonb_set(tools,'{1,enabled}','false'::jsonb)",
    );
    const policy = new AiToolPolicyService(runtime);
    expect(await policy.schemaReady()).toBe(false);
    const f = await aiTextFixture(admin, runtime);
    const owner = f.owner.principal_id,
      thread = f.thread.id,
      request = randomUUID();
    await runtime.query(fixtureGenerationSql, [
      owner,
      thread,
      request,
      'Legacy tools',
      await f.version(),
    ]);
    const before = await runtime.query<{ value: unknown }>(
      'SELECT ai_tool_policy_snapshot($1,$2,$3) AS value',
      [owner, thread, request],
    );
    await applyPlan({ query }, plan);
    expect(await policy.schemaReady()).toBe(true);
    const current = await policy.runtime();
    expect(current.tools.map((item) => item.id)).toEqual(AI_TOOL_IDS);
    expect(current.tools.find((item) => item.id === 'read_page')?.enabled).toBe(false);
    expect(await policy.allowed(owner, thread, request, 'read_page')).toBe(false);
    expect(await policy.allowed(owner, thread, request, 'create_working_file')).toBe(true);
    expect(
      (
        await runtime.query('SELECT ai_tool_policy_snapshot($1,$2,$3) AS value', [
          owner,
          thread,
          request,
        ])
      ).rows,
    ).toEqual(before.rows);
  } finally {
    await db.close();
  }
}, 120000);
