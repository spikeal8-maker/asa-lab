import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { aiIdentity } from './ai-student-access.contract';
import { aiTextHistoryContract } from './ai-text-history.contract';

let db: PGlite, admin: pg.Pool, runtime: pg.Pool;
let prior: {
  owner: string;
  account: string;
  thread: string;
  request: string;
  user: string;
  answer: string;
};

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
    plan.filter((migration) => migration.version < '0228'),
  );
  const identity = await aiIdentity(admin);
  const thread = (
    await runtime.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [identity.principal_id])
  ).rows[0]!.id;
  const request = randomUUID(),
    user = randomUUID(),
    answer = randomUUID();
  await admin.query(
    `INSERT INTO ai_assistant_messages(id,thread_id,account_id,owner_principal_id,request_id,role,content,created_at)
     VALUES($1,$3,$4,$5,$6,'user','Исторический вопрос',TIMESTAMPTZ '2026-10-19 12:00:00.123111Z'),
           ($2,$3,$4,$5,$6,'assistant','Исторический ответ',TIMESTAMPTZ '2026-10-19 12:00:00.123222Z')`,
    [user, answer, thread, identity.account_id, identity.principal_id, request],
  );
  await admin.query(
    'INSERT INTO ai_assistant_request_quota(account_id,owner_principal_id,request_id) VALUES($1,$2,$3)',
    [identity.account_id, identity.principal_id, request],
  );
  await admin.query("INSERT INTO ai_paid_operation_quota(operation) VALUES('chat')");
  prior = {
    owner: identity.principal_id,
    account: identity.account_id,
    thread,
    request,
    user,
    answer,
  };
  await applyPlan(adapter, plan);
}, 30000);

afterAll(async () => {
  await db?.close();
});

it('0228 forward upgrade preserves original messages, microseconds, source relation and both paid ledgers', async () => {
  expect(
    (
      await admin.query(
        `SELECT id,account_id,owner_principal_id,request_id,role,content,ordinal::integer,
      source_user_message_id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
      FROM ai_assistant_messages WHERE thread_id=$1 ORDER BY ordinal`,
        [prior.thread],
      )
    ).rows,
  ).toEqual([
    {
      id: prior.user,
      account_id: prior.account,
      owner_principal_id: prior.owner,
      request_id: prior.request,
      role: 'user',
      content: 'Исторический вопрос',
      ordinal: 1,
      source_user_message_id: null,
      created_at: '2026-10-19T12:00:00.123111Z',
    },
    {
      id: prior.answer,
      account_id: prior.account,
      owner_principal_id: prior.owner,
      request_id: prior.request,
      role: 'assistant',
      content: 'Исторический ответ',
      ordinal: 2,
      source_user_message_id: prior.user,
      created_at: '2026-10-19T12:00:00.123222Z',
    },
  ]);
  expect(
    (
      await admin.query(
        'SELECT request_id FROM ai_assistant_request_quota WHERE owner_principal_id=$1',
        [prior.owner],
      )
    ).rows,
  ).toEqual([{ request_id: prior.request }]);
  expect(
    (await admin.query('SELECT count(*)::integer AS n FROM ai_paid_operation_quota')).rows,
  ).toEqual([{ n: 1 }]);
  expect(
    (
      await runtime.query<{ admitted: boolean }>(
        "SELECT ai_text_begin_paid($1,$2,$3,'Исторический вопрос',0) AS admitted",
        [prior.owner, prior.thread, prior.request],
      )
    ).rows[0]!.admitted,
  ).toBe(false);
});

aiTextHistoryContract(() => ({ admin, runtime }));
