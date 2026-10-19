import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AiChatService,
  type AiAdminUpdate,
  type AiProvider,
} from '../../apps/api/src/ai-chat.service';
import { getAiModelCatalog, isModelForProvider } from '../../apps/api/src/ai-model-catalog';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';

const ROOT_KEY = '4c'.repeat(32);
const OBSERVED_AT = Date.parse('2026-10-19T12:00:00Z');
const plan = planMigrations('migrations');

function client(db: PGlite) {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (params?.length) return db.query(sql, params);
      const results = await db.exec(sql);
      return { rows: results.at(-1)?.rows ?? [] };
    },
  };
}

async function runtime<T>(db: PGlite, sql: string, params: unknown[] = []) {
  await db.exec('SET ROLE asalab_app');
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec('RESET ROLE');
  }
}

async function identity(db: PGlite, elevated = false): Promise<string> {
  const account = await db.query<{ id: string }>(
    `INSERT INTO accounts (email, password_hash, birth_date, country)
     VALUES ($1, 'catalog-test-only', DATE '1990-01-01', 'RU') RETURNING id`,
    [`catalog-${randomUUID()}@example.test`],
  );
  const id = account.rows[0]!.id;
  const principal = await db.query<{ id: string }>(
    "INSERT INTO principals (kind, account_id) VALUES ('account', $1) RETURNING id",
    [id],
  );
  if (elevated)
    await db.query(
      `INSERT INTO capability_grants (account_id, capability, state, policy_version, granted_by)
     VALUES ($1, 'platform_admin', 'verified', 'admin-stage-a-2026-08', 'admin')`,
      [id],
    );
  return principal.rows[0]!.id;
}

function encrypted(key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(ROOT_KEY, 'hex'), iv);
  return {
    api_key_ciphertext: Buffer.concat([cipher.update(key), cipher.final()]).toString('base64url'),
    api_key_iv: iv.toString('base64url'),
    api_key_auth_tag: cipher.getAuthTag().toString('base64url'),
    key_fingerprint: createHash('sha256').update(key).digest('hex').slice(0, 12),
  };
}

function serviceFor(db: PGlite, fetchImpl: typeof fetch) {
  return new AiChatService(
    {
      query: (sql: string, params?: unknown[]) => runtime(db, sql, params),
    } as unknown as pg.Pool,
    { encryptionKey: ROOT_KEY, fetchImpl },
  );
}

async function used(db: PGlite): Promise<number> {
  return (
    await db.query<{ n: number }>('SELECT count(*)::integer AS n FROM ai_paid_operation_quota')
  ).rows[0]!.n;
}

describe('0226 forward upgrade from the published configuration', () => {
  it('migrates retired DeepSeek explicitly, preserves exact ciphertext/history/quota and does not claim key verification', async () => {
    const upgrade = new PGlite();
    try {
      await applyPlan(
        client(upgrade),
        plan.filter((migration) => migration.version < '0226'),
      );
      const owner = await identity(upgrade);
      const administrator = await identity(upgrade, true);
      const bundle = encrypted('test-deepseek-original-credential');
      await upgrade.query(
        `UPDATE ai_assistant_config SET enabled = true, provider = 'deepseek', model = 'deepseek-chat',
         api_key_ciphertext = $1, api_key_iv = $2, api_key_auth_tag = $3, key_fingerprint = $4,
         configuration_version = 7, paid_operations_per_hour = 4`,
        Object.values(bundle),
      );
      const thread = (
        await runtime<{ id: string }>(upgrade, 'SELECT ai_chat_create($1) AS id', [owner])
      ).rows[0]!.id;
      const request = randomUUID();
      await runtime(upgrade, "SELECT ai_chat_begin_paid($1,$2,$3,'Сохранённый вопрос',7)", [
        owner,
        thread,
        request,
      ]);
      await runtime(upgrade, "SELECT ai_chat_finish($1,$2,$3,'Сохранённый ответ','complete')", [
        owner,
        thread,
        request,
      ]);
      const history = (
        await runtime(upgrade, 'SELECT * FROM ai_chat_messages($1,$2)', [owner, thread])
      ).rows;
      const ledger = (await upgrade.query('SELECT * FROM ai_paid_operation_quota')).rows;
      expect(await applyPlan(client(upgrade), plan)).toBe(1);
      const stored = (await upgrade.query('SELECT * FROM ai_assistant_config')).rows[0];
      expect(stored).toMatchObject({
        ...bundle,
        provider: 'deepseek',
        model: 'deepseek-flash',
        enabled: false,
        configuration_version: 8,
        migrated_from_model: 'deepseek-chat',
        paid_operations_per_hour: 4,
      });
      expect(
        (await upgrade.query("SELECT * FROM ai_provider_settings WHERE provider = 'deepseek'"))
          .rows[0],
      ).toMatchObject({ ...bundle, model: 'deepseek-flash' });
      expect(
        (await runtime(upgrade, 'SELECT * FROM ai_chat_messages($1,$2)', [owner, thread])).rows,
      ).toEqual(history);
      expect((await upgrade.query('SELECT * FROM ai_paid_operation_quota')).rows).toEqual(ledger);
      const fetchImpl = vi.fn<typeof fetch>(async (url, options) => {
        expect(url).toBe('https://api.deepseek.com/chat/completions');
        expect(new Headers(options?.headers).get('authorization')).toBe(
          'Bearer test-deepseek-original-credential',
        );
        expect(JSON.parse(String(options?.body))).toMatchObject({
          model: 'deepseek-flash',
          thinking: { type: 'disabled' },
        });
        return new Response(
          'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        );
      });
      const service = serviceFor(upgrade, fetchImpl);
      const config = await service.adminConfig(administrator);
      expect(config).toMatchObject({
        enabled: false,
        migratedFromModel: 'deepseek-chat',
        apiKeyConfigured: true,
        configurationVersion: 8,
      });
      expect(JSON.stringify(config)).not.toContain(bundle.api_key_ciphertext);
      expect(await service.status()).toMatchObject({ enabled: false, model: 'deepseek-flash' });
      expect(fetchImpl).not.toHaveBeenCalled();
      await expect(service.testConnection(administrator, 7)).rejects.toMatchObject({
        code: 'ai_config_changed',
      });
      expect(await used(upgrade)).toBe(1);
      const checked = await service.testConnection(administrator, 8);
      expect(checked).toMatchObject({
        provider: 'deepseek',
        model: 'deepseek-flash',
        configurationVersion: 8,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(await used(upgrade)).toBe(2);
      expect(await service.status()).toMatchObject({ enabled: false });
      expect(await applyPlan(client(upgrade), plan)).toBe(0);
      expect((await service.adminConfig(administrator)).configurationVersion).toBe(8);
    } finally {
      await upgrade.close();
    }
  }, 30000);

  it.each(['gpt-5-mini', 'gpt-4.1-mini'] as const)(
    'preserves an existing %s selection and secret without changing its version',
    async (model) => {
      const upgrade = new PGlite();
      try {
        await applyPlan(
          client(upgrade),
          plan.filter((migration) => migration.version < '0226'),
        );
        const bundle = encrypted('test-openai-original-credential');
        await upgrade.query(
          `UPDATE ai_assistant_config SET enabled = true, model = $1, configuration_version = 7,
         api_key_ciphertext = $2, api_key_iv = $3, api_key_auth_tag = $4, key_fingerprint = $5`,
          [model, ...Object.values(bundle)],
        );
        await applyPlan(client(upgrade), plan);
        expect((await upgrade.query('SELECT * FROM ai_assistant_config')).rows[0]).toMatchObject({
          ...bundle,
          provider: 'openai',
          model,
          enabled: true,
          configuration_version: 7,
          migrated_from_model: null,
          paid_operations_per_hour: 0,
        });
        expect(
          (await upgrade.query("SELECT * FROM ai_provider_settings WHERE provider = 'openai'"))
            .rows[0],
        ).toMatchObject({ ...bundle, model });
        expect(await used(upgrade)).toBe(0);
      } finally {
        await upgrade.close();
      }
    },
    30000,
  );
});

let db: PGlite;
let administrator: string;
let stranger: string;
beforeAll(async () => {
  db = new PGlite();
  await applyPlan(client(db), plan);
  administrator = await identity(db, true);
  stranger = await identity(db);
}, 30000);
afterAll(async () => db?.close());

describe('0226 credential isolation and persistence guards', () => {
  it('uses current defaults only for a new installation and keeps paid operations closed', async () => {
    const config = (await runtime(db, 'SELECT * FROM ai_admin_get_config($1)', [administrator]))
      .rows[0];
    expect(config).toMatchObject({
      provider: 'openai',
      model: 'gpt-6-luna',
      configuration_version: 1,
      enabled: false,
      api_key_configured: false,
      paid_operations_per_hour: 0,
    });
    expect(
      (
        await db.query(
          'SELECT provider, model, api_key_ciphertext FROM ai_provider_settings ORDER BY provider',
        )
      ).rows,
    ).toEqual([
      { provider: 'deepseek', model: 'deepseek-flash', api_key_ciphertext: null },
      { provider: 'openai', model: 'gpt-6-luna', api_key_ciphertext: null },
    ]);
  });

  it('keeps SQL provider/model and lifecycle validation in parity with the server catalog', async () => {
    const models = [
      ...getAiModelCatalog(OBSERVED_AT).models.map((model) => model.id),
      'deepseek-chat',
      'deepseek-reasoner',
      'unknown',
      null,
    ];
    for (const at of [
      '2026-10-19T12:00:00Z',
      '2026-12-10T23:59:59.999Z',
      '2026-12-11T00:00:00Z',
      '2027-01-13T23:59:59.999Z',
      '2027-01-14T00:00:00Z',
    ]) {
      for (const provider of ['openai', 'deepseek', 'unknown', null]) {
        for (const model of models) {
          const result = await db.query<{ valid: boolean }>(
            'SELECT ai_model_available($1::varchar,$2::varchar,$3::timestamptz) AS valid',
            [provider, model, at],
          );
          expect(result.rows[0]!.valid, `${provider}/${model} at ${at}`).toBe(
            isModelForProvider(provider, model, Date.parse(at)),
          );
        }
      }
    }
    expect(
      (
        await db.query<{ valid: boolean }>(
          "SELECT ai_model_available('openai','gpt-6-luna',NULL) AS valid",
        )
      ).rows[0]!.valid,
    ).toBe(false);
  });

  it('denies direct credential reads, writes, private helper bypass and unprivileged configuration', async () => {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      expect(
        (
          await db.query<{ allowed: boolean }>(
            "SELECT has_table_privilege('asalab_app','ai_provider_settings',$1) AS allowed",
            [privilege],
          )
        ).rows[0]!.allowed,
      ).toBe(false);
    }
    expect(
      (
        await db.query<{ relrowsecurity: boolean }>(
          "SELECT relrowsecurity FROM pg_class WHERE oid = 'ai_provider_settings'::regclass",
        )
      ).rows[0]!.relrowsecurity,
    ).toBe(true);
    await expect(runtime(db, 'SELECT * FROM ai_provider_settings')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      runtime(db, "SELECT ai_model_available('openai','gpt-6-luna',now())"),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runtime(db, "SELECT ai_model_provider_matches('openai','gpt-6-luna')"),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runtime(db, 'SELECT * FROM ai_admin_get_config($1)', [stranger]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runtime(
        db,
        "SELECT ai_admin_set_config($1,false,'openai','gpt-6-luna','keep',NULL,NULL,NULL,NULL,'denied')",
        [stranger],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it.each([
    ['openai', 'deepseek-flash', false, 'keep'],
    ['deepseek', 'gpt-6-luna', false, 'keep'],
    ['deepseek', 'deepseek-chat', false, 'keep'],
    [null, 'gpt-6-luna', false, 'keep'],
    ['openai', null, false, 'keep'],
    ['openai', 'gpt-6-luna', null, 'keep'],
    ['openai', 'gpt-6-luna', false, null],
  ])(
    'rejects invalid SQL settings %s/%s/%s/%s before any key/config/quota mutation',
    async (provider, model, enabled, action) => {
      const before = (await db.query('SELECT * FROM ai_assistant_config')).rows;
      await expect(
        runtime(
          db,
          "SELECT ai_admin_set_config($1,$2::boolean,$3::varchar,$4::varchar,$5::varchar,NULL,NULL,NULL,NULL,'invalid')",
          [administrator, enabled, provider, model, action],
        ),
      ).rejects.toMatchObject({ code: '22023' });
      expect((await db.query('SELECT * FROM ai_assistant_config')).rows).toEqual(before);
      expect(await used(db)).toBe(0);
    },
  );

  it('preserves both encrypted provider keys, active projection and stored models through switching and clearing', async () => {
    const credentials = {
      openai: 'test-openai-independent-key',
      deepseek: 'test-deepseek-independent-key',
    };
    const fetchImpl = vi.fn<typeof fetch>(async (url, options) => {
      const provider: AiProvider = String(url).includes('openai.com') ? 'openai' : 'deepseek';
      expect(new Headers(options?.headers).get('authorization')).toBe(
        `Bearer ${credentials[provider]}`,
      );
      return new Response(
        provider === 'openai'
          ? 'event: response.output_text.delta\ndata: {"delta":"OK"}\n\nevent: response.completed\ndata: {"type":"response.completed"}\n\n'
          : 'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    });
    const service = serviceFor(db, fetchImpl);
    const save = async (settings: AiAdminUpdate) =>
      service.saveAdminConfig(
        administrator,
        {
          ...settings,
          configurationVersion: (await service.adminConfig(administrator)).configurationVersion,
        },
        randomUUID(),
      );
    const openai = await save({
      provider: 'openai',
      model: 'gpt-6-luna',
      apiKey: credentials.openai,
      enabled: false,
    });
    const storedOpenai = (
      await db.query("SELECT * FROM ai_provider_settings WHERE provider = 'openai'")
    ).rows[0];
    await expect(
      service.testConnection(administrator, openai.configurationVersion),
    ).rejects.toMatchObject({ code: 'ai_platform_quota_exhausted' });
    expect(fetchImpl).not.toHaveBeenCalled();
    const deepseek = await save({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      apiKey: credentials.deepseek,
      enabled: false,
      paidOperationsPerHour: 4,
    });
    const storedDeepseek = (
      await db.query("SELECT * FROM ai_provider_settings WHERE provider = 'deepseek'")
    ).rows[0];
    expect(
      (await db.query("SELECT * FROM ai_provider_settings WHERE provider = 'openai'")).rows[0],
    ).toEqual(storedOpenai);
    expect(deepseek.providerConfigurations.every((slot) => slot.apiKeyConfigured)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    await service.testConnection(administrator, deepseek.configurationVersion);
    const switched = await save({ provider: 'openai', model: 'gpt-6-luna', enabled: false });
    await service.testConnection(administrator, switched.configurationVersion);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      (await db.query("SELECT * FROM ai_provider_settings WHERE provider = 'deepseek'")).rows[0],
    ).toEqual(storedDeepseek);
    expect(
      (
        await db.query(
          'SELECT api_key_ciphertext, api_key_iv, api_key_auth_tag, key_fingerprint FROM ai_assistant_config',
        )
      ).rows[0],
    ).toEqual({
      api_key_ciphertext: storedOpenai!['api_key_ciphertext'],
      api_key_iv: storedOpenai!['api_key_iv'],
      api_key_auth_tag: storedOpenai!['api_key_auth_tag'],
      key_fingerprint: storedOpenai!['key_fingerprint'],
    });
    const cleared = await save({
      provider: 'openai',
      model: 'gpt-6-luna',
      clearApiKey: true,
      enabled: false,
    });
    expect(cleared.providerConfigurations.find((slot) => slot.provider === 'openai')).toMatchObject(
      { apiKeyConfigured: false, keyFingerprint: null },
    );
    expect(
      (await db.query("SELECT * FROM ai_provider_settings WHERE provider = 'deepseek'")).rows[0],
    ).toEqual(storedDeepseek);
    expect(
      (
        await db.query(
          'SELECT api_key_ciphertext, api_key_iv, api_key_auth_tag, key_fingerprint FROM ai_assistant_config',
        )
      ).rows[0],
    ).toEqual({
      api_key_ciphertext: null,
      api_key_iv: null,
      api_key_auth_tag: null,
      key_fingerprint: null,
    });
    const back = await save({ provider: 'deepseek', model: 'deepseek-v4-pro', enabled: false });
    expect(back).toMatchObject({
      model: 'deepseek-v4-pro',
      apiKeyConfigured: true,
      keyFingerprint: storedDeepseek!['key_fingerprint'],
    });
    expect(await used(db)).toBe(2);
    expect(JSON.stringify(back)).not.toContain(credentials.openai);
    expect(JSON.stringify(back)).not.toContain(credentials.deepseek);
    const audit = (
      await db.query(
        "SELECT * FROM administrative_audit_events WHERE action = 'administration.ai_configuration.update'",
      )
    ).rows;
    expect(audit).toHaveLength(5);
    expect(JSON.stringify(audit)).not.toContain(credentials.openai);
    expect(JSON.stringify(audit)).not.toContain(storedDeepseek!['api_key_ciphertext'] as string);
  });
});
