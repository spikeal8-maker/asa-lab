import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { aiIdentity, aiStudentAccessContract } from './ai-student-access.contract';

let db: PGlite;
let admin: pg.Pool;
let runtime: pg.Pool;
let prior: { owner: string; account: string; thread: string; request: string; message: string };
beforeAll(async () => {
  db = new PGlite();
  const adapter = {
    query: async (sql: string, params?: unknown[]) => {
      if (params?.length) return db.query(sql, params);
      const results = await db.exec(sql);
      return { rows: results.at(-1)?.rows ?? [] };
    },
  };
  admin = adapter as unknown as pg.Pool;
  runtime = {
    query: async (sql: string, params?: unknown[]) => {
      await db.exec('SET ROLE asalab_app');
      try {
        return await adapter.query(sql, params);
      } finally {
        await db.exec('RESET ROLE');
      }
    },
  } as unknown as pg.Pool;
  const plan = planMigrations('migrations');
  await applyPlan(
    adapter,
    plan.filter((m) => m.version < '0226'),
  );
  const identity = await aiIdentity(admin);
  const thread = (
    await runtime.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [identity.principal_id])
  ).rows[0]!.id;
  const request = randomUUID();
  // Valid legacy rows with their original identifiers, before ownership exists.
  const message = (
    await admin.query<{ id: string }>(
      "INSERT INTO ai_assistant_messages(thread_id,account_id,request_id,role,content) VALUES($1,$2,$3,'user','История до обновления') RETURNING id",
      [thread, identity.account_id, request],
    )
  ).rows[0]!.id;
  await admin.query('INSERT INTO ai_assistant_request_quota(account_id,request_id) VALUES($1,$2)', [
    identity.account_id,
    request,
  ]);
  prior = { owner: identity.principal_id, account: identity.account_id, thread, request, message };
  await applyPlan(adapter, plan);
}, 30000);
afterAll(async () => {
  await db?.close();
});

it('0226 preserves Account history, request IDs and quota through the forward upgrade', async () => {
  const rows = await admin.query(
    'SELECT t.id,t.account_id,t.owner_principal_id,m.id AS message_id,m.content FROM ai_assistant_threads t JOIN ai_assistant_messages m ON m.thread_id=t.id WHERE t.id=$1',
    [prior.thread],
  );
  expect(rows.rows).toEqual([
    {
      id: prior.thread,
      account_id: prior.account,
      owner_principal_id: prior.owner,
      message_id: prior.message,
      content: 'История до обновления',
    },
  ]);
  expect(
    (
      await runtime.query<{ admitted: boolean }>(
        "SELECT ai_chat_begin($1,$2,$3,'История до обновления') AS admitted",
        [prior.owner, prior.thread, prior.request],
      )
    ).rows[0]!.admitted,
  ).toBe(false);
  expect(
    (
      await admin.query(
        'SELECT account_id,owner_principal_id,request_id FROM ai_assistant_request_quota WHERE request_id=$1',
        [prior.request],
      )
    ).rows,
  ).toEqual([
    { account_id: prior.account, owner_principal_id: prior.owner, request_id: prior.request },
  ]);
});
aiStudentAccessContract(() => ({ admin, runtime }));
