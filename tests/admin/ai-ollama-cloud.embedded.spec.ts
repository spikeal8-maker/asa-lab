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

it('routes five private slots in priority order, deduplicates availability, and never repeats paid admission', async () => {
  const admin = await identity(true),
    owner = await identity(),
    stranger = await identity();
  const a = 'ollama-cloud/future:27b',
    b = 'ollama-cloud/deepseek-v4-pro';
  let denySecond = false;
  const upstream = vi.fn<typeof fetch>(async (_url, init) => {
    const auth = new Headers(init?.headers).get('authorization');
    if (auth === 'Bearer pool-private-key-one') return new Response('', { status: 402 });
    if (auth === 'Bearer pool-private-key-two' && denySecond)
      return new Response('', { status: 403 });
    const body = JSON.parse(String(init?.body));
    return body.stream
      ? new Response(
          'data: ' +
            JSON.stringify({ choices: [{ delta: { content: 'Ready' }, finish_reason: null }] }) +
            '\n\ndata: ' +
            JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
            '\n\ndata: [DONE]\n\n',
        )
      : new Response(
          JSON.stringify({
            model: body.model,
            choices: [{ message: { content: 'Ready' }, finish_reason: 'stop' }],
          }),
        );
  });
  const service = new AiChatService(pool, { encryptionKey: '12'.repeat(32), fetchImpl: upstream });
  const start = await service.ollamaCloudPool(admin);
  expect(start.keys).toHaveLength(5);
  const payload = start.keys.map((k, index) => ({
    slot: k.slot,
    label: 'Account ' + k.slot,
    priority: index + 1,
    enabled: index < 3,
    models: index < 2 ? [a] : index === 2 ? [b] : [],
    ...(index < 3
      ? {
          apiKey: ['pool-private-key-one', 'pool-private-key-two', 'pool-private-key-three'][index],
        }
      : {}),
  }));
  await expect(
    service.saveOllamaCloudPool(stranger, start.configurationVersion, payload, randomUUID()),
  ).rejects.toThrow();
  const saved = await service.saveOllamaCloudPool(
    admin,
    start.configurationVersion,
    payload,
    randomUUID(),
  );
  expect(saved.managed).toBe(true);
  expect(saved.keys.filter((k) => k.configured)).toHaveLength(3);
  expect(JSON.stringify(saved)).not.toContain('pool-private-key');
  await expect(pool.query('SELECT * FROM ai_ollama_cloud_keys')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(
    pool.query('SELECT * FROM ai_ollama_cloud_pool_credentials($1)', [stranger]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    service.saveOllamaCloudPool(admin, start.configurationVersion, payload, randomUUID()),
  ).rejects.toMatchObject({ status: 409 });
  await service.saveAdminConfig(
    admin,
    {
      provider: 'ollama-cloud',
      model: a,
      enabled: true,
      paidOperationsPerHour: 100,
      configurationVersion: saved.configurationVersion,
    },
    randomUUID(),
  );
  expect((await service.status()).availableModels.sort()).toEqual([a, b].sort());
  const thread = await service.createThread(owner);
  const quota = async () =>
    Number(
      (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM ai_paid_operation_quota'))
        .rows[0]!.n,
    );
  const count = await quota();
  const request = randomUUID();
  await service.send(owner, thread.id, 'First', request);
  expect(upstream.mock.calls).toHaveLength(2);
  expect(await quota()).toBe(count + 1);
  await service.send(owner, thread.id, 'First', request);
  expect(upstream.mock.calls).toHaveLength(2);
  expect(await quota()).toBe(count + 1);
  let state = await service.ollamaCloudPool(admin);
  expect(state.keys[0]?.account?.status).toBe('credits_required');
  expect((await service.status()).availableModels).toContain(a); // second key still serves the same model
  denySecond = true;
  await expect(service.send(owner, thread.id, 'Second', randomUUID())).rejects.toThrow();
  expect(upstream.mock.calls).toHaveLength(3);
  const available = await service.status();
  expect(available.availableModels).toEqual([b]);
  expect(available.model).toBe(b);
  const response = await service.sendStream(
    owner,
    thread.id,
    'Another model',
    randomUUID(),
    () => undefined,
    new AbortController().signal,
    b,
  );
  expect(response.messages.some((m) => m.content === 'Ready')).toBe(true);
  expect(new Headers(upstream.mock.calls.at(-1)?.[1]?.headers).get('authorization')).toBe(
    'Bearer pool-private-key-three',
  );
  state = await service.ollamaCloudPool(admin);
  const duplicate = state.keys.map((k) => ({
    slot: k.slot,
    label: k.label,
    priority: k.priority,
    enabled: k.enabled,
    models: k.models,
    ...(k.slot === 2 ? { apiKey: 'pool-private-key-three' } : {}),
  }));
  await expect(
    service.saveOllamaCloudPool(admin, state.configurationVersion, duplicate, randomUUID()),
  ).rejects.toMatchObject({ code: 'ai_cloud_pool_invalid' });
  expect((await service.ollamaCloudPool(admin)).configurationVersion).toBe(
    state.configurationVersion,
  );
  const replacement = state.keys.map((k) => ({
    slot: k.slot,
    label: k.label,
    priority: 6 - k.priority,
    enabled: k.enabled,
    models: k.models,
    ...(k.slot === 1 ? { apiKey: 'pool-private-key-replaced' } : {}),
  }));
  await service.saveOllamaCloudPool(admin, state.configurationVersion, replacement, randomUUID());
  await pool.query(
    'SELECT ai_ollama_cloud_key_observe($1,$2,$3::jsonb,$4::timestamptz,$5::varchar)',
    [1, state.keys.find((k) => k.slot === 1)!.fingerprint, null, 'infinity', null],
  );
  const fresh = await service.ollamaCloudPool(admin);
  expect(fresh.keys.map((k) => k.priority)).toEqual([1, 2, 3, 4, 5]);
  expect(
    (
      await pool.query<{ slot: number }>('SELECT * FROM ai_ollama_cloud_key_candidates($1)', [a])
    ).rows.map((k) => k.slot),
  ).toEqual([1]);
});

it('refreshes separate balances without generation, and a positive balance does not prove access to a refused model', async () => {
  const admin = await identity(true);
  const upstream = vi.fn<typeof fetch>(
    async (url, init) =>
      new Response(
        JSON.stringify(
          String(url).endsWith('/api/tags')
            ? {
                models: [
                  { name: 'future:27b', capabilities: ['completion'] },
                  { name: 'deepseek-v4-pro', capabilities: ['completion'] },
                ],
              }
            : {
                included: {
                  balance_usd:
                    new Headers(init?.headers).get('authorization') ===
                    'Bearer pool-private-key-three'
                      ? 0
                      : 9,
                  allowance_usd: 60,
                },
                purchased: { balance_usd: 0 },
              },
        ),
      ),
  );
  const service = new AiChatService(pool, { encryptionKey: '12'.repeat(32), fetchImpl: upstream });
  const before = await service.ollamaCloudPool(admin);
  const result = await service.inspectOllamaCloudPool(
    admin,
    before.configurationVersion,
    randomUUID(),
  );
  expect(upstream.mock.calls).toHaveLength(4);
  expect(upstream.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  expect(result.keys.find((k) => k.slot === 2)?.unavailableModels).toContain(
    'ollama-cloud/future:27b',
  );
  expect(result.keys.find((k) => k.slot === 3)?.account?.balance?.includedUsd).toBe(0);
  expect((await service.status()).availableModels).toEqual(['ollama-cloud/future:27b']);
  expect(JSON.stringify(result)).not.toContain('pool-private-key');
  const third = result.keys.find((k) => k.slot === 3)!;
  const newer = {
    status: 'credits_required',
    checkedAt: new Date(Date.now() + 1000).toISOString(),
    retryAfterSeconds: null,
    balance: null,
  };
  await pool.query(
    'SELECT ai_ollama_cloud_key_observe($1,$2,$3::jsonb,$4::timestamptz,$5::varchar)',
    [3, third.fingerprint, JSON.stringify(newer), 'infinity', null],
  );
  await pool.query(
    'SELECT ai_ollama_cloud_key_observe($1,$2,$3::jsonb,$4::timestamptz,$5::varchar)',
    [3, third.fingerprint, JSON.stringify({ ...third.account, status: 'ok' }), null, null],
  );
  expect(
    (await service.ollamaCloudPool(admin)).keys.find((k) => k.slot === 3)?.account?.status,
  ).toBe('credits_required');
});
