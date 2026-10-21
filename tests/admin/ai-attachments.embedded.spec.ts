import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { aiAttachmentsContract } from '../ai-attachments/contract';
import { aiTextFixture } from './ai-text-history.contract';

let db: PGlite, admin: pg.Pool, runtime: pg.Pool;
let prior: {
  owner: string;
  thread: string;
  request: string;
  regeneration: string;
  source: string;
  messages: unknown[];
  receipts: unknown[];
  ownerQuota: unknown[];
  paidQuota: unknown[];
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
    plan.filter((migration) => migration.version < '0229'),
  );
  const f = await aiTextFixture(admin, runtime),
    request = randomUUID(),
    regeneration = randomUUID();
  await runtime.query("SELECT ai_text_begin_paid($1,$2,$3,'Сохранённый вопрос',$4)", [
    f.owner.principal_id,
    f.thread.id,
    request,
    await f.version(),
  ]);
  await runtime.query("SELECT ai_chat_finish($1,$2,$3,'Первый вариант','complete')", [
    f.owner.principal_id,
    f.thread.id,
    request,
  ]);
  const source = (
    await admin.query<{ id: string }>(
      "SELECT id FROM ai_assistant_messages WHERE request_id=$1 AND role='user'",
      [request],
    )
  ).rows[0]!.id;
  await runtime.query('SELECT ai_text_regenerate_begin($1,$2,$3,$4,$5)', [
    f.owner.principal_id,
    f.thread.id,
    regeneration,
    source,
    await f.version(),
  ]);
  await runtime.query("SELECT ai_chat_finish($1,$2,$3,'Второй вариант','complete')", [
    f.owner.principal_id,
    f.thread.id,
    regeneration,
  ]);
  await f.service.archiveThread(f.owner.principal_id, f.thread.id, true);
  prior = {
    owner: f.owner.principal_id,
    thread: f.thread.id,
    request,
    regeneration,
    source,
    messages: (
      await admin.query(
        'SELECT row_to_json(m) AS snapshot FROM ai_assistant_messages m WHERE thread_id=$1 ORDER BY ordinal',
        [f.thread.id],
      )
    ).rows,
    receipts: (
      await admin.query(
        'SELECT row_to_json(r) AS snapshot FROM ai_assistant_regenerations r WHERE owner_principal_id=$1 ORDER BY request_id',
        [f.owner.principal_id],
      )
    ).rows,
    ownerQuota: (
      await admin.query(
        'SELECT row_to_json(q) AS snapshot FROM ai_assistant_request_quota q WHERE owner_principal_id=$1 ORDER BY request_id',
        [f.owner.principal_id],
      )
    ).rows,
    paidQuota: (
      await admin.query(
        'SELECT row_to_json(q) AS snapshot FROM ai_paid_operation_quota q ORDER BY id',
      )
    ).rows,
  };
  await applyPlan(adapter, plan);
  expect(f.upstream).not.toHaveBeenCalled();
}, 30000);

afterAll(async () => {
  await db?.close();
});

it('0229 upgrades 005 without changing messages, archived variants, original source or either exact paid ledger', async () => {
  expect(
    (
      await admin.query(
        'SELECT row_to_json(m) AS snapshot FROM ai_assistant_messages m WHERE thread_id=$1 ORDER BY ordinal',
        [prior.thread],
      )
    ).rows,
  ).toEqual(prior.messages);
  expect(
    (
      await admin.query(
        'SELECT row_to_json(r) AS snapshot FROM ai_assistant_regenerations r WHERE owner_principal_id=$1 ORDER BY request_id',
        [prior.owner],
      )
    ).rows,
  ).toEqual(prior.receipts);
  expect(
    (
      await admin.query(
        'SELECT row_to_json(q) AS snapshot FROM ai_assistant_request_quota q WHERE owner_principal_id=$1 ORDER BY request_id',
        [prior.owner],
      )
    ).rows,
  ).toEqual(prior.ownerQuota);
  expect(
    (
      await admin.query(
        'SELECT row_to_json(q) AS snapshot FROM ai_paid_operation_quota q ORDER BY id',
      )
    ).rows,
  ).toEqual(prior.paidQuota);
  expect(
    (
      await admin.query(
        'SELECT archived_at IS NOT NULL AS archived FROM ai_assistant_threads WHERE id=$1',
        [prior.thread],
      )
    ).rows,
  ).toEqual([{ archived: true }]);
  for (const request of [prior.request, prior.regeneration])
    expect(
      (
        await runtime.query('SELECT ai_attachment_request_source($1,$2,$3) AS value', [
          prior.owner,
          prior.thread,
          request,
        ])
      ).rows,
    ).toEqual([{ value: { sourceUserMessageId: prior.source, items: [] } }]);
});

aiAttachmentsContract(() => ({ admin, runtime }));
