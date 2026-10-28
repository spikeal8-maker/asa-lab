import { publishFixtureModels } from './ai-model-policy.fixture';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
import { AiWebSearchService } from '../../apps/api/src/ai-web-search';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
const connection = process.env['TEST_DATABASE_URL'];
const suite = connection ? describe : describe.skip;
const dbName = 'asa_web_' + randomUUID().replaceAll('-', '') + '_test';
let host: pg.Pool,
  admin: pg.Pool,
  a: pg.Pool,
  b: pg.Pool,
  created = false;
const runtime = (pool: pg.Pool) =>
  ({
    query: async (sql: string, params?: unknown[]) => {
      const c = await pool.connect();
      try {
        await c.query('SET ROLE asalab_app');
        return await c.query(sql, params);
      } finally {
        await c.query('RESET ROLE');
        c.release();
      }
    },
  }) as unknown as pg.Pool;
async function identity(elevated = false) {
  const account = (
    await admin.query(
      "INSERT INTO accounts(email,password_hash,birth_date,country) VALUES($1,'test',DATE '1990-01-01','RU') RETURNING id",
      ['web-pg-' + randomUUID() + '@example.test'],
    )
  ).rows[0].id as string;
  const principal = (
    await admin.query("INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id", [
      account,
    ])
  ).rows[0].id as string;
  if (elevated)
    await admin.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','admin-stage-a-2026-08','admin')",
      [account],
    );
  return principal;
}
suite('free web lookup on independent PostgreSQL backends', () => {
  beforeAll(async () => {
    host = new pg.Pool({ connectionString: connection! });
    await host.query('CREATE DATABASE "' + dbName + '"');
    created = true;
    const target = new URL(connection!);
    target.pathname = '/' + dbName;
    admin = new pg.Pool({ connectionString: target.href });
    const client = await admin.connect();
    try {
      await applyPlan(client, planMigrations('migrations'));
    } finally {
      client.release();
    }
    a = new pg.Pool({ connectionString: target.href, max: 1 });
    b = new pg.Pool({ connectionString: target.href, max: 1 });
  }, 60000);
  afterAll(async () => {
    await a?.end();
    await b?.end();
    await admin?.end();
    if (created) await host.query('DROP DATABASE "' + dbName + '"');
    await host?.end();
  });
  it('atomically binds mode, never duplicates external lookup, and enforces global city admission/CAS/private history', async () => {
    expect((await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid).not.toBe(
      (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
    );
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      new URL(String(url)).hostname === 'search'
        ? new Response(
            JSON.stringify({
              results: [
                { title: 'Факт', url: 'https://example.org/fact', content: 'Проверенные данные.' },
              ],
            }),
          )
        : new Response(
            JSON.stringify({
              choices: [
                {
                  message: { content: 'Ответ [1](https://example.org/fact)' },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 8, completion_tokens: 2 },
            }),
          ),
    );
    const first = new AiChatService(runtime(a), { encryptionKey: '4c'.repeat(32), fetchImpl });
    const second = new AiChatService(runtime(b), { encryptionKey: '4c'.repeat(32), fetchImpl });
    const actor = await identity(true),
      owner = await identity(),
      stranger = await identity();
    await first.saveAdminConfig(
      actor,
      {
        enabled: true,
        provider: 'deepseek',
        model: 'deepseek-flash',
        apiKey: 'test-model-only-key',
        paidOperationsPerHour: 100,
      },
      randomUUID(),
    );
    await publishFixtureModels(first, actor, ['deepseek-flash']);
    await first.saveWebSearch(
      actor,
      { enabled: true, weatherEnabled: true, operationsPerHour: 100, configurationVersion: 1 },
      randomUUID(),
    );
    const thread = await first.createThread(owner),
      request = randomUUID();
    const outcomes = await Promise.allSettled([
      first.send(owner, thread.id, 'Найди факт', request, 'web'),
      second.send(owner, thread.id, 'Найди факт', request, 'images'),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({
      code: 'ai_request_id_reused',
      status: 409,
    });
    expect(
      fetchImpl.mock.calls.filter((c) => new URL(String(c[0])).hostname === 'search'),
    ).toHaveLength(1);
    expect(
      fetchImpl.mock.calls.filter((c) => new URL(String(c[0])).hostname === 'api.deepseek.com'),
    ).toHaveLength(1);
    const beforeReplay = fetchImpl.mock.calls.length;
    expect((await second.send(owner, thread.id, 'Найди факт', request)).replayed).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(beforeReplay);
    expect(
      await new AiWebSearchService(runtime(b), fetchImpl).evidence(stranger, thread.id, request),
    ).toBeNull();
    const claims = await Promise.all([
      runtime(a).query("SELECT ai_web_cache_claim('geocode','казань') AS value"),
      runtime(b).query("SELECT ai_web_cache_claim('geocode','москва') AS value"),
    ]);
    expect(claims.map((c) => c.rows[0].value.state).sort()).toEqual(['fetch', 'limited']);
    const index = claims.findIndex((c) => c.rows[0].value.state === 'fetch'),
      city = index === 0 ? 'казань' : 'москва';
    await expect(
      runtime(a).query(
        "SELECT ai_web_cache_save('geocode',$1,'[]'::jsonb,clock_timestamp()+INTERVAL '1 hour',NULL,$2::uuid)",
        [city, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '22023' });
    await runtime(a).query(
      "SELECT ai_web_cache_save('geocode',$1,'[]'::jsonb,clock_timestamp()+INTERVAL '1 hour',NULL,$2::uuid)",
      [city, claims[index]!.rows[0].value.lease],
    );
    expect(
      (await runtime(b).query("SELECT ai_web_cache_claim('geocode',$1) AS value", [city])).rows[0]
        .value.state,
    ).toBe('fresh');
    expect(
      (await admin.query('SELECT requests FROM ai_web_geocoder_budget')).rows[0].requests,
    ).toBe(1);
    await expect(runtime(a).query('SELECT * FROM ai_web_search_receipts')).rejects.toMatchObject({
      code: '42501',
    });
    await first.deleteThread(owner, thread.id);
    expect(
      (
        await admin.query(
          'SELECT query,evidence,forgotten,reserved_units FROM ai_web_search_receipts WHERE owner_principal_id=$1 AND request_id=$2',
          [owner, request],
        )
      ).rows[0],
    ).toEqual({ query: null, evidence: null, forgotten: true, reserved_units: 1 });
    expect(
      await new AiWebSearchService(runtime(b), fetchImpl).evidence(owner, thread.id, request),
    ).toBeNull();
  }, 30000);
});
