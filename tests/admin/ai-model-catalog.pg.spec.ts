import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AiChatService,
  type AiAdminUpdate,
  type AiProvider,
} from '../../apps/api/src/ai-chat.service';
import { lockAiPostgresSuite } from './ai-postgres-suite-lock';

// This suite must execute on independent real PostgreSQL backends. Every provider response
// is local test data; no saved installation credentials or paid upstream API calls are used.
let admin: pg.Pool;
let first: pg.Pool;
let second: pg.Pool;
let administrator: string;
let serviceA: AiChatService;
let serviceB: AiChatService;
let unlock: (() => Promise<void>) | undefined;
let originalConfig: Record<string, unknown> | undefined;
let originalProviders: Record<string, unknown>[] | undefined;
const credentials: Record<AiProvider, string> = {
  openai: 'test-openai-pg-independent-key',
  deepseek: 'test-deepseek-pg-independent-key',
  'ollama-cloud': 'test-ollama-cloud-pg-independent-key',
};
const fetchImpl = vi.fn<typeof fetch>(async (url, options) => {
  const provider: AiProvider = String(url).includes('openai.com') ? 'openai' : 'deepseek';
  expect(new Headers(options?.headers).get('authorization')).toBe(
    `Bearer ${credentials[provider]}`,
  );
  const body = JSON.parse(String(options?.body));
  if (provider === 'openai') {
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(body).toMatchObject({
      model: 'gpt-6-luna',
      reasoning: { effort: 'none' },
      max_output_tokens: 8192,
      store: false,
    });
    return new Response(
      'event: response.output_text.delta\ndata: {"delta":"OK"}\n\nevent: response.completed\ndata: {"type":"response.completed"}\n\n',
    );
  }
  expect(url).toBe('https://api.deepseek.com/chat/completions');
  expect(body).toMatchObject({ thinking: { type: 'disabled' }, max_tokens: 8192 });
  return new Response(
    'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
  );
});

it('Ollama Cloud uses encrypted credentials, paid admission and durable usage on real PostgreSQL', async () => {
  const existing = (
    await admin.query(
      "SELECT * FROM ai_provider_settings WHERE provider IN ('openai','deepseek') ORDER BY provider",
    )
  ).rows;
  const upstream = vi.fn<typeof fetch>(async (url, options) => {
    expect(url).toBe('https://ollama.com/v1/chat/completions');
    expect(options?.redirect).toBe('error');
    expect(new Headers(options?.headers).get('authorization')).toBe(
      'Bearer ' + credentials['ollama-cloud'],
    );
    const packet = {
      model: 'gemma4:31b',
      choices: [
        { delta: { content: 'Cloud PG' }, message: { content: 'Cloud PG' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    };
    return JSON.parse(String(options?.body)).stream
      ? new Response('data: ' + JSON.stringify(packet) + '\n\ndata: [DONE]\n\n')
      : new Response(JSON.stringify(packet));
  });
  const service = new AiChatService(first, { encryptionKey: '4c'.repeat(32), fetchImpl: upstream });
  const previousConfig = await service.adminConfig(administrator);
  const before = await used();
  const config = await save({
    provider: 'ollama-cloud',
    model: 'gemma4:31b',
    apiKey: credentials['ollama-cloud'],
    enabled: true,
    paidOperationsPerHour: before + 10,
  });
  expect(JSON.stringify(config)).not.toContain(credentials['ollama-cloud']);
  const thread = await service.createThread(administrator);
  const request = randomUUID();
  await service.send(administrator, thread.id, 'Cloud PG JSON', request);
  expect((await service.send(administrator, thread.id, 'Cloud PG JSON', request)).replayed).toBe(
    true,
  );
  await service.sendStream(
    administrator,
    thread.id,
    'Cloud PG SSE',
    randomUUID(),
    () => undefined,
    new AbortController().signal,
    'gemma4:31b',
  );
  expect(upstream).toHaveBeenCalledTimes(2);
  expect(await used()).toBe(before + 2);
  const usage = (
    await admin.query(
      'SELECT provider,status,input_tokens,output_tokens FROM ai_usage_journal WHERE thread_id=$1',
      [thread.id],
    )
  ).rows;
  expect(usage).toHaveLength(2);
  expect(
    usage.every(
      (row) =>
        row.provider === 'ollama-cloud' &&
        row.status === 'succeeded' &&
        Number(row.input_tokens) === 7 &&
        Number(row.output_tokens) === 3,
    ),
  ).toBe(true);
  await save({ provider: 'ollama-cloud', model: 'gemma4:31b', enabled: false, clearApiKey: true });
  expect(
    (
      await admin.query(
        "SELECT * FROM ai_provider_settings WHERE provider IN ('openai','deepseek') ORDER BY provider",
      )
    ).rows,
  ).toEqual(existing);
  // Restoring the prior active provider deliberately updates its own timestamp;
  // compare preservation before that separate cleanup operation.
  await save({
    provider: previousConfig.provider,
    model: previousConfig.model,
    enabled: previousConfig.enabled,
    paidOperationsPerHour: previousConfig.paidOperationsPerHour,
  });
});

async function used(): Promise<number> {
  return (
    await admin.query<{ n: number }>(
      "SELECT count(*)::integer AS n FROM ai_paid_operation_quota WHERE created_at > clock_timestamp() - interval '1 hour'",
    )
  ).rows[0]!.n;
}

async function save(settings: AiAdminUpdate) {
  return serviceA.saveAdminConfig(
    administrator,
    {
      ...settings,
      configurationVersion: (await serviceA.adminConfig(administrator)).configurationVersion,
    },
    randomUUID(),
  );
}

beforeAll(async () => {
  const urls = ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'].map((key) => {
    const value = process.env[key];
    if (!value) throw new Error(`${key} must explicitly name an isolated _test database`);
    const url = new URL(value);
    if (!decodeURIComponent(url.pathname).endsWith('_test'))
      throw new Error(`${key} must name an isolated _test database`);
    return url;
  });
  if (urls[0]!.host !== urls[1]!.host || urls[0]!.pathname !== urls[1]!.pathname) {
    throw new Error('Admin and runtime URLs must target the same isolated _test database');
  }
  admin = new pg.Pool({ connectionString: urls[0]!.href, max: 2 });
  first = new pg.Pool({ connectionString: urls[1]!.href, max: 2 });
  second = new pg.Pool({ connectionString: urls[1]!.href, max: 2 });
  unlock = await lockAiPostgresSuite(admin);
  originalConfig = (await admin.query('SELECT * FROM ai_assistant_config')).rows[0];
  originalProviders = (await admin.query('SELECT * FROM ai_provider_settings')).rows;
  const account = await admin.query<{ id: string }>(
    `INSERT INTO accounts (email,password_hash,birth_date,country)
     VALUES ($1,'model-catalog-pg-only',DATE '1990-01-01','RU') RETURNING id`,
    [`catalog-pg-${randomUUID()}@example.test`],
  );
  const id = account.rows[0]!.id;
  administrator = (
    await admin.query<{ id: string }>(
      "INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id",
      [id],
    )
  ).rows[0]!.id;
  await admin.query(
    `INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by)
     VALUES($1,'platform_admin','verified','admin-stage-a-2026-08','admin')`,
    [id],
  );
  serviceA = new AiChatService(first, { encryptionKey: '4c'.repeat(32), fetchImpl });
  serviceB = new AiChatService(second, { encryptionKey: '4c'.repeat(32), fetchImpl });
  await save({
    provider: 'openai',
    model: 'gpt-6-luna',
    apiKey: credentials.openai,
    enabled: false,
    paidOperationsPerHour: (await used()) + 10,
  });
  await save({
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    apiKey: credentials.deepseek,
    enabled: false,
  });
}, 60000);

afterAll(async () => {
  try {
    if (originalConfig)
      await admin.query(
        `UPDATE ai_assistant_config c SET
       enabled = saved.enabled, provider = saved.provider, model = saved.model,
       api_key_ciphertext = saved.api_key_ciphertext, api_key_iv = saved.api_key_iv,
       api_key_auth_tag = saved.api_key_auth_tag, key_fingerprint = saved.key_fingerprint,
       paid_operations_per_hour = saved.paid_operations_per_hour,
       configuration_version = saved.configuration_version,
       migrated_from_model = saved.migrated_from_model,
       updated_by_principal = saved.updated_by_principal, updated_at = saved.updated_at
       FROM json_populate_record(NULL::ai_assistant_config,$1::json) saved WHERE c.singleton_key`,
        [JSON.stringify(originalConfig)],
      );
    if (originalProviders)
      await admin.query(
        `UPDATE ai_provider_settings p SET
       model = saved.model, api_key_ciphertext = saved.api_key_ciphertext,
       api_key_iv = saved.api_key_iv, api_key_auth_tag = saved.api_key_auth_tag,
       key_fingerprint = saved.key_fingerprint, updated_at = saved.updated_at
       FROM json_populate_recordset(NULL::ai_provider_settings,$1::json) saved
       WHERE p.provider = saved.provider`,
        [JSON.stringify(originalProviders)],
      );
  } finally {
    await Promise.all([first?.end(), second?.end()]);
    await unlock?.();
    await admin?.end();
  }
});

describe('0227 catalog/config races on independent PostgreSQL connections', () => {
  it('uses separate runtime backends and exposes only slot fingerprints to a platform administrator', async () => {
    const a = (await first.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    const b = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    expect(a).not.toBe(b);
    await expect(first.query('SELECT * FROM ai_provider_settings')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      first.query("SELECT ai_model_available('openai','gpt-6-luna',now())"),
    ).rejects.toMatchObject({ code: '42501' });
    const config = await serviceA.adminConfig(administrator);
    expect(
      config.providerConfigurations
        .filter((slot) => slot.provider !== 'ollama-cloud')
        .every((slot) => slot.apiKeyConfigured),
    ).toBe(true);
    for (const slot of config.providerConfigurations) {
      expect(Object.keys(slot).sort()).toEqual([
        'apiKeyConfigured',
        'keyFingerprint',
        'model',
        'provider',
        'updatedAt',
      ]);
      if (slot.apiKeyConfigured) expect(slot.keyFingerprint).toMatch(/^[a-f0-9]{12}$/);
      else expect(slot.keyFingerprint).toBeNull();
    }
    expect(
      config.providerConfigurations.find((slot) => slot.provider === 'ollama-cloud'),
    ).toMatchObject({ apiKeyConfigured: false, keyFingerprint: null });
    expect(JSON.stringify(config)).not.toContain(credentials.openai);
    expect(JSON.stringify(config)).not.toContain(credentials.deepseek);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows one of two competing saves at the same version and commits one coherent projection', async () => {
    const version = (await serviceA.adminConfig(administrator)).configurationVersion;
    const previousSlots = (
      await admin.query('SELECT * FROM ai_provider_settings ORDER BY provider')
    ).rows;
    const baseline = await used();
    const results = await Promise.allSettled([
      serviceA.saveAdminConfig(
        administrator,
        { provider: 'openai', model: 'gpt-6-luna', enabled: false, configurationVersion: version },
        randomUUID(),
      ),
      serviceB.saveAdminConfig(
        administrator,
        {
          provider: 'deepseek',
          model: 'deepseek-flash',
          enabled: false,
          configurationVersion: version,
        },
        randomUUID(),
      ),
    ]);
    const winner = results.find((result) => result.status === 'fulfilled');
    const loser = results.find((result) => result.status === 'rejected');
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(loser?.status === 'rejected' && loser.reason).toMatchObject({
      code: 'ai_config_changed',
      status: 409,
    });
    if (!winner || winner.status !== 'fulfilled') throw new Error('One save must succeed');
    const current = winner.value;
    expect(current.configurationVersion).toBe(version + 1);
    const projection = (await admin.query('SELECT * FROM ai_assistant_config')).rows[0];
    const slots = (await admin.query('SELECT * FROM ai_provider_settings ORDER BY provider')).rows;
    const active = slots.find((slot) => slot['provider'] === current.provider)!;
    for (const key of [
      'provider',
      'model',
      'api_key_ciphertext',
      'api_key_iv',
      'api_key_auth_tag',
      'key_fingerprint',
    ]) {
      expect(projection[key]).toEqual(active[key]);
    }
    const untouched = slots.find((slot) => slot['provider'] !== current.provider)!;
    expect(untouched).toEqual(
      previousSlots.find((slot) => slot['provider'] === untouched['provider']),
    );
    expect(await used()).toBe(baseline);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(serviceB.testConnection(administrator, version)).rejects.toMatchObject({
      code: 'ai_config_changed',
    });
    expect(await used()).toBe(baseline);
    await serviceA.testConnection(administrator, current.configurationVersion);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await used()).toBe(baseline + 1);
  });

  it('switches both ways with no key in the update, decrypts the right key, and clears only the chosen provider', async () => {
    const baseline = await used();
    const calls = fetchImpl.mock.calls.length;
    for (const provider of ['openai', 'deepseek'] as const) {
      const model = provider === 'openai' ? 'gpt-6-luna' : 'deepseek-v4-pro';
      const config = await save({ provider, model, enabled: false });
      await serviceB.testConnection(administrator, config.configurationVersion);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(calls + 2);
    const openaiSlot = (
      await admin.query("SELECT * FROM ai_provider_settings WHERE provider='openai'")
    ).rows[0];
    const cleared = await save({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      enabled: false,
      clearApiKey: true,
    });
    expect(cleared.apiKeyConfigured).toBe(false);
    expect(
      cleared.providerConfigurations.find((slot) => slot.provider === 'openai')?.apiKeyConfigured,
    ).toBe(true);
    expect(
      (await admin.query("SELECT * FROM ai_provider_settings WHERE provider='openai'")).rows[0],
    ).toEqual(openaiSlot);
    await expect(
      serviceA.testConnection(administrator, cleared.configurationVersion),
    ).rejects.toMatchObject({ code: 'ai_key_required' });
    expect(fetchImpl).toHaveBeenCalledTimes(calls + 2);
    const back = await save({
      provider: 'openai',
      model: 'gpt-6-luna',
      enabled: false,
      paidOperationsPerHour: 0,
    });
    await expect(
      serviceA.testConnection(administrator, back.configurationVersion),
    ).rejects.toMatchObject({ code: 'ai_platform_quota_exhausted' });
    expect(fetchImpl).toHaveBeenCalledTimes(calls + 2);
    expect(await used()).toBe(baseline + 2);
  });
});
