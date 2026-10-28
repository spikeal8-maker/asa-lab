import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { aiTextFixture } from './ai-text-history.contract';
import { aiAttachmentsFixture } from '../ai-attachments/contract';
import {
  fixtureChatSql,
  fixtureAttachmentSql,
  fixtureRegenerationSql,
  withLocalFixtureAdmissions,
} from './ai-model-policy.fixture';
let db: PGlite;
const admin = {
  query: async (sql: string, params: unknown[] = []) =>
    params.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] },
} as unknown as pg.Pool;
const runtime = {
  query: async (sql: string, params: unknown[] = []) => {
    await db.exec('SET ROLE asalab_app');
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec('RESET ROLE');
    }
  },
} as unknown as pg.Pool;
beforeAll(async () => {
  db = new PGlite();
  await applyPlan(admin, planMigrations('migrations'));
}, 30000);
afterAll(async () => db?.close());
it('admits the PG chat fixture through real policy/owner/quota guards and rejects changed-payload replay', async () => {
  const f = await aiTextFixture(admin, runtime),
    request = randomUUID();
  const before = await f.ledgers();
  const args = [f.owner.principal_id, f.thread.id, request, 'A real fixture admission'];
  expect((await runtime.query(fixtureChatSql, args)).rows[0].admitted).toBe(true);
  await runtime.query('SELECT ai_chat_abort($1,$2,$3)', args.slice(0, 3));
  expect((await runtime.query(fixtureChatSql, args)).rows[0].admitted).toBe(false);
  await expect(
    runtime.query(fixtureChatSql, [...args.slice(0, 3), 'changed']),
  ).rejects.toMatchObject({ code: '22023' });
  expect(await f.ledgers()).toEqual({ global: before.global + 1, owner: before.owner + 1 });
});
it('admits an ordered attachment manifest atomically and retains exact owner-bound free replay', async () => {
  const f = await aiAttachmentsFixture(admin, runtime),
    file = await f.ready(),
    request = randomUUID();
  const before = await f.ledgers();
  const args = [
    f.ownerId,
    f.thread.id,
    request,
    'Ordered private source',
    await f.version(),
    [file.receipt.uploadId],
  ];
  expect((await runtime.query(fixtureAttachmentSql, args)).rows[0].admitted).toBe(true);
  expect(
    (await f.store.requestSource(f.ownerId, f.thread.id, request)).items.map((i) => i.uploadId),
  ).toEqual([file.receipt.uploadId]);
  await runtime.query('SELECT ai_chat_abort($1,$2,$3)', args.slice(0, 3));
  expect((await runtime.query(fixtureAttachmentSql, args)).rows[0].admitted).toBe(false);
  expect(await f.ledgers()).toEqual({ global: before.global + 1, owner: before.owner + 1 });
});
it('regenerates the immutable source through current admission while preserving replay and foreign-owner denial', async () => {
  const f = await aiTextFixture(admin, runtime),
    source = await f.seedQuestion('Immutable fixture source'),
    request = randomUUID();
  const before = await f.ledgers();
  const args = [f.owner.principal_id, f.thread.id, request, source.sourceId, await f.version()];
  expect((await runtime.query(fixtureRegenerationSql, args)).rows[0].admitted).toBe(true);
  await runtime.query('SELECT ai_chat_abort($1,$2,$3)', args.slice(0, 3));
  expect((await runtime.query(fixtureRegenerationSql, args)).rows[0].admitted).toBe(false);
  await expect(
    runtime.query(fixtureRegenerationSql, [f.stranger.principal_id, ...args.slice(1)]),
  ).rejects.toBeDefined();
  expect(await f.ledgers()).toEqual({ global: before.global + 1, owner: before.owner + 1 });
});

it('keeps historical aggregate setup on one real admission transaction and restores settings and rows by rollback', async () => {
  const f = await aiTextFixture(admin, runtime),
    request = randomUUID();
  const before = (await admin.query('SELECT to_jsonb(p) AS value FROM ai_generation_policy p'))
    .rows[0].value;
  const localBefore = (await admin.query('SELECT to_jsonb(p) AS value FROM ai_ollama_settings p'))
    .rows[0].value;
  const connected = {
    query: admin.query.bind(admin),
    connect: async () => ({ query: admin.query.bind(admin), release: () => undefined }),
  } as unknown as pg.Pool;
  await withLocalFixtureAdmissions(
    connected,
    f.platform.principal_id,
    f.owner.principal_id,
    [request],
    async (client) => {
      expect(
        (
          await client.query(
            'SELECT count(*)::int n FROM ai_assistant_request_quota WHERE owner_principal_id=$1 AND request_id=$2',
            [f.owner.principal_id, request],
          )
        ).rows[0].n,
      ).toBe(1);
      await client.query(
        'DELETE FROM ai_usage_journal WHERE owner_principal_id=$1 AND request_id=$2',
        [f.owner.principal_id, request],
      );
      expect(
        (
          await client.query(
            'SELECT count(*)::int n FROM ai_usage_journal WHERE owner_principal_id=$1 AND request_id=$2',
            [f.owner.principal_id, request],
          )
        ).rows[0].n,
      ).toBe(0);
      const history = (
        await client.query('SELECT admin_user_history($1,$2,NULL,$3,$4,$5,100,NULL) AS value', [
          f.platform.principal_id,
          'platform',
          'account',
          f.owner.account_id,
          'ai',
        ])
      ).rows[0].value;
      const retained = history.items.find((item: { id: string }) => item.id === request);
      expect(retained).toMatchObject({ status: 'legacy_unknown' });
      expect(retained.model ?? null).toBeNull();
      const catalog = (
        await client.query(
          'SELECT admin_user_catalog_v2($1,$2,NULL,$3,$4,$5,$6,$7,100,NULL,$8::jsonb,$9) AS value',
          [
            f.platform.principal_id,
            'platform',
            '',
            'accounts',
            'all',
            'last_activity',
            'desc',
            '{}',
            'page',
          ],
        )
      ).rows[0].value;
      const row = catalog.items.find((item: { id: string }) => item.id === f.owner.account_id);
      expect(row).toMatchObject({
        aiRequests: 1,
        aiLegacyRequests: 1,
        aiTokenCovered: 0,
        aiInputTokens: null,
      });
    },
  );
  expect(
    (await admin.query('SELECT to_jsonb(p) AS value FROM ai_generation_policy p')).rows[0].value,
  ).toEqual(before);
  expect(
    (await admin.query('SELECT to_jsonb(p) AS value FROM ai_ollama_settings p')).rows[0].value,
  ).toEqual(localBefore);
  expect(
    (
      await admin.query(
        'SELECT count(*)::int n FROM ai_assistant_request_quota WHERE owner_principal_id=$1 AND request_id=$2',
        [f.owner.principal_id, request],
      )
    ).rows[0].n,
  ).toBe(0);
});
