import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
let db: PGlite;
const client = () => ({
  query: async (sql: string, params?: unknown[]) =>
    params?.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] },
});
const pool = {
  query: async (sql: string, params: unknown[] = []) => {
    await db.exec('SET ROLE asalab_app');
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec('RESET ROLE');
    }
  },
} as unknown as pg.Pool;
async function identity(admin = false) {
  const account = (
    await db.query<{ id: string }>(
      "INSERT INTO accounts(email,password_hash,birth_date,country) VALUES($1,'test','1990-01-01','RU') RETURNING id",
      [randomUUID() + '@example.test'],
    )
  ).rows[0]!.id;
  const owner = (
    await db.query<{ id: string }>(
      "INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id",
      [account],
    )
  ).rows[0]!.id;
  if (admin)
    await db.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','admin-stage-a-2026-08','admin')",
      [account],
    );
  return owner;
}
beforeAll(async () => {
  db = new PGlite();
  await applyPlan(client(), planMigrations('migrations'));
}, 30000);
afterAll(async () => db?.close());

it('refreshes only the server catalogue with an authorized key and routes a discovered model through ordinary SQL admission', async () => {
  const admin = await identity(true),
    owner = await identity(),
    stranger = await identity();
  const key = 'private-test-cloud-key-001';
  const fetchImpl = vi.fn<typeof fetch>(
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).endsWith('/api/tags')
            ? {
                models: [
                  { name: 'future:27b', capabilities: ['completion', 'thinking'] },
                  { name: 'deepseek-v4-pro', capabilities: ['completion'] },
                ],
              }
            : String(url).endsWith('/api/balance')
              ? { included: { balance_usd: 12, allowance_usd: 60 }, purchased: { balance_usd: 3 } }
              : {
                  model: 'future:27b',
                  choices: [{ message: { content: 'Cloud answer' }, finish_reason: 'stop' }],
                  usage: { prompt_tokens: 5, completion_tokens: 2 },
                },
        ),
      ),
  );
  const service = new AiChatService(pool, { encryptionKey: '12'.repeat(32), fetchImpl });
  const initial = await service.adminConfig(admin);
  const saved = await service.saveAdminConfig(
    admin,
    {
      provider: 'ollama-cloud',
      model: 'gemma4:31b',
      enabled: false,
      apiKey: key,
      configurationVersion: initial.configurationVersion,
    },
    randomUUID(),
  );
  const inspected = await service.inspectOllamaCloud(
    admin,
    saved.configurationVersion,
    undefined,
    randomUUID(),
  );
  expect(inspected.account).toMatchObject({
    status: 'ok',
    balance: { includedUsd: 12, purchasedUsd: 3 },
  });
  expect(JSON.stringify(inspected)).not.toContain(key);
  expect(inspected.models.some((m) => m.id === 'ollama-cloud/future:27b' && m.active)).toBe(true);
  expect(fetchImpl.mock.calls).toHaveLength(2);
  expect(fetchImpl.mock.calls.every(([url]) => !String(url).includes('/chat'))).toBe(true);
  await expect(pool.query('SELECT * FROM ai_ollama_cloud_models')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(
    pool.query('SELECT * FROM ai_ollama_cloud_admin_credentials($1)', [stranger]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    service.inspectOllamaCloud(stranger, saved.configurationVersion, undefined, randomUUID()),
  ).rejects.toThrow();
  const before = await service.adminConfig(admin);
  await expect(
    service.saveAdminConfig(
      admin,
      {
        provider: 'ollama-cloud',
        model: 'ollama-cloud/invented',
        enabled: false,
        configurationVersion: before.configurationVersion,
      },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'ai_model_invalid' });
  const enabled = await service.saveAdminConfig(
    admin,
    {
      provider: 'ollama-cloud',
      model: 'ollama-cloud/future:27b',
      enabled: true,
      paidOperationsPerHour: 10,
      configurationVersion: before.configurationVersion,
    },
    randomUUID(),
  );
  const thread = (await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [owner]))
    .rows[0]!.id;
  await service.send(owner, thread, 'Hello', randomUUID());
  expect(String(fetchImpl.mock.calls.at(-1)?.[0])).toBe('https://ollama.com/v1/chat/completions');
  expect(JSON.parse(String(fetchImpl.mock.calls.at(-1)?.[1]?.body)).model).toBe('future:27b');
  await expect(
    service.inspectOllamaCloud(admin, saved.configurationVersion, undefined, randomUUID()),
  ).rejects.toMatchObject({ code: 'ai_config_changed' });
  const bad = [
    {
      id: 'ollama-cloud/forged',
      model: 'https://invalid',
      capabilities: ['completion'],
      active: true,
    },
  ];
  await expect(
    pool.query('SELECT ai_ollama_cloud_catalog_apply($1,$2,$3::jsonb,$4::varchar)', [
      admin,
      enabled.configurationVersion,
      JSON.stringify(bad),
      'bad-catalog',
    ]),
  ).rejects.toMatchObject({ code: '22023' });
  expect(
    (await service.adminConfig(admin)).providerConfigurations.find(
      (p) => p.provider === 'ollama-cloud',
    )?.apiKeyConfigured,
  ).toBe(true);
});

it('rejects metadata from a key/configuration superseded while the provider responds', async () => {
  const admin = await identity(true);
  let raced = false;
  const fetchImpl = vi.fn<typeof fetch>(async (url) => {
    if (String(url).endsWith('/api/balance') && !raced) {
      raced = true;
      const c = await service.adminConfig(admin);
      await service.saveAdminConfig(
        admin,
        {
          provider: c.provider,
          model: c.model,
          enabled: false,
          configurationVersion: c.configurationVersion,
        },
        randomUUID(),
      );
    }
    return new Response(
      JSON.stringify(
        String(url).endsWith('/api/tags')
          ? { models: [{ name: 'race-model', capabilities: ['completion'] }] }
          : { included: { balance_usd: 1 }, purchased: { balance_usd: 0 } },
      ),
    );
  });
  const service = new AiChatService(pool, { encryptionKey: '12'.repeat(32), fetchImpl });
  const before = await service.adminConfig(admin);
  const revision = (
    await db.query<{ revision: number }>('SELECT revision FROM ai_ollama_cloud_catalog_state')
  ).rows[0]!.revision;
  await expect(
    service.inspectOllamaCloud(
      admin,
      before.configurationVersion,
      'draft-key-for-race-test',
      randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'ai_config_changed', status: 409 });
  expect(
    (await db.query<{ revision: number }>('SELECT revision FROM ai_ollama_cloud_catalog_state'))
      .rows[0]!.revision,
  ).toBe(revision);
  expect(
    (await db.query('SELECT id FROM ai_ollama_cloud_models WHERE model=$1', ['race-model'])).rows,
  ).toHaveLength(0);
});
