import type pg from 'pg';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiAdminFixture } from './testing/ai-admin-config.fixture';
import type { AdminControlPlaneService } from './admin-control-plane.service';
import { AiAdminController } from './ai-admin.controller';
import {
  AiChatService,
  type AiAdminConfig,
  type AiModel,
  type AiProvider,
} from './ai-chat.service';
import {
  buildAiTextRequest,
  getAiModelCatalog,
  isAiModel,
  installProviderObservations,
  isModelForProvider,
} from './ai-model-catalog';

const OBSERVED_AT = Date.parse('2026-10-19T12:00:00Z');
const PRINCIPAL = '11111111-1111-4111-8111-111111111111';

beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(OBSERVED_AT));
afterEach(() => {
  installProviderObservations([]);
  vi.restoreAllMocks();
});

function row(config: AiAdminConfig) {
  return {
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    paid_operations_per_hour: config.paidOperationsPerHour,
    api_key_configured: config.apiKeyConfigured,
    key_fingerprint: config.keyFingerprint,
    configuration_version: config.configurationVersion,
    updated_at: config.updatedAt,
    provider_configurations: config.providerConfigurations,
    migrated_from_model: config.migratedFromModel,
  };
}

describe('server-owned catalog and provider request policy', () => {
  it('exposes model modalities separately from implemented ASA product features', () => {
    const catalog = getAiModelCatalog();
    expect(catalog.providers.map((provider) => provider.defaultModel)).toEqual([
      'gpt-6-luna',
      'deepseek-flash',
      'gemma4:31b',
    ]);
    expect(catalog.models.find((model) => model.id === 'deepseek-flash')?.inputModalities).toEqual([
      'text',
      'image',
    ]);
    expect(catalog.models.find((model) => model.id === 'deepseek-v4-pro')?.inputModalities).toEqual(
      ['text'],
    );
    expect(catalog.models.every((model) => model.outputModalities.join() === 'text')).toBe(true);
    expect(catalog.productFeatures).toEqual({
      textChat: true,
      streaming: true,
      imageInput: true,
      fileAttachments: false,
      imageGeneration: false,
    });
  });

  it.each([
    ['gpt-5-mini', '2026-12-11'],
    ['gpt-4.1-mini', '2027-01-14'],
  ])(
    'keeps %s usable until its announced shutdown and fails closed from that date',
    (model, date) => {
      const shutdown = Date.parse(date + 'T00:00:00Z');
      expect(isModelForProvider('openai', model, shutdown - 1)).toBe(true);
      expect(isModelForProvider('openai', model, shutdown)).toBe(false);
      expect(getAiModelCatalog(shutdown).models.find((item) => item.id === model)).toMatchObject({
        selectable: false,
        lifecycle: 'retired',
        shutdownDate: date,
      });
    },
  );

  it.each([
    ['deepseek', 'deepseek-chat'],
    ['deepseek', 'deepseek-reasoner'],
    ['deepseek', 'gpt-6-luna'],
    ['openai', 'deepseek-flash'],
    ['openai', 'https://example.test/arbitrary-model'],
    ['unknown', 'gpt-6-luna'],
    [null, null],
  ])('rejects a retired, unknown or mismatched pair %s/%s', (provider, model) => {
    expect(isModelForProvider(provider, model)).toBe(false);
  });

  it('does not treat arbitrary values as model identifiers', () => {
    for (const value of [undefined, null, {}, ['gpt-6-luna'], 1, 'GPT-6-LUNA', 'gpt-6-luna ']) {
      expect(isAiModel(value)).toBe(false);
    }
  });

  it.each([
    ['openai', 'gpt-6-luna', { effort: 'none' }],
    ['openai', 'gpt-5-mini', { effort: 'minimal' }],
    ['openai', 'gpt-4.1-mini', undefined],
    ['deepseek', 'deepseek-flash', undefined],
    ['deepseek', 'deepseek-v4-pro', undefined],
  ] as const)(
    'uses the same bounded %s/%s policy for JSON and streaming/test calls',
    (provider, model, reasoning) => {
      const context = [{ role: 'user' as const, content: 'Помоги с проектом' }];
      const plain = buildAiTextRequest(provider, model, context, 'Инструкции', false);
      const streamed = buildAiTextRequest(provider, model, context, 'Инструкции', true);
      expect(streamed).toEqual({
        ...plain,
        body: {
          ...plain.body,
          stream: true,
          ...(provider === 'deepseek' ? { stream_options: { include_usage: true } } : {}),
        },
      });
      expect(plain.body).not.toHaveProperty('stream_options');
      if (provider === 'openai') {
        expect(plain.url).toBe('https://api.openai.com/v1/responses');
        expect(plain.body).toMatchObject({
          model,
          input: context,
          instructions: 'Инструкции',
          max_output_tokens: 8192,
          store: false,
        });
        expect(plain.body['reasoning']).toEqual(reasoning);
        expect(plain.body).not.toHaveProperty('thinking');
      } else {
        expect(plain.url).toBe('https://api.deepseek.com/chat/completions');
        expect(plain.body).toMatchObject({
          model,
          thinking: { type: 'disabled' },
          max_tokens: 8192,
        });
        expect(plain.body['messages']).toEqual([
          { role: 'system', content: 'Инструкции' },
          ...context,
        ]);
      }
    },
  );
});

describe('catalog/config API boundaries', () => {
  it.each(
    (['openai', 'deepseek'] as const).flatMap((provider) =>
      [false, true].flatMap((credentialChanged) =>
        (['replace', 'clear', 'disable'] as const).map((action) => ({
          provider,
          credentialChanged,
          action,
        })),
      ),
    ),
  )(
    'allows $provider $action maintenance with credentialChanged=$credentialChanged and an unavailable observation',
    async ({ provider, credentialChanged, action }) => {
      const model = provider === 'openai' ? 'gpt-6-luna' : 'deepseek-flash';
      installProviderObservations([
        {
          provider,
          source: 'https://fixture.invalid/models',
          checkedAt: '2026-10-19T12:00:00Z',
          failed: credentialChanged,
          credentialChanged,
          models: [],
        },
      ]);
      expect(isModelForProvider(provider, model)).toBe(false);
      const before = aiAdminFixture({ provider, model, enabled: true, apiKeyConfigured: true });
      const after = aiAdminFixture({
        ...before,
        configurationVersion: 2,
        providerConfigurations: before.providerConfigurations.map((slot) =>
          slot.provider === provider
            ? { ...slot, revision: 2, enabled: action === 'replace' }
            : slot,
        ),
      });
      const query = vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('ai_admin_get_config')) return { rows: [row(saved ? after : before)] };
        if (sql.includes('ai_admin_set_provider_config')) {
          expect(params).toHaveLength(13);
          saved = true;
          return { rows: [] };
        }
        return { rows: [] };
      });
      let saved = false;
      const fetchImpl = vi.fn<typeof fetch>();
      const service = new AiChatService({ query } as unknown as pg.Pool, {
        encryptionKey: '4c'.repeat(32),
        fetchImpl,
      });
      const controller = new AiAdminController(
        {
          resolve: vi.fn(async () => ({ principalId: PRINCIPAL })),
        } as unknown as ActiveContextUseCase,
        {
          resolveAccess: vi.fn(async () => ({
            scopes: [{ kind: 'platform', role: 'platform_admin' }],
          })),
        } as unknown as AdminControlPlaneService,
        service,
      );
      const request = {
        cookies: {},
        id: 'unavailable-maintenance',
        headers: {
          origin: 'https://asa.example.test',
          host: 'asa.example.test',
          'content-type': 'application/json',
        },
      } as unknown as FastifyRequest;
      const input = {
        provider,
        model,
        enabled: action === 'replace',
        configurationVersion: 1,
        providerConfigurationVersion: 1,
        ...(action === 'replace' ? { apiKey: 'private-replacement-test-key' } : {}),
        ...(action === 'clear' ? { clearApiKey: true } : {}),
      };
      await controller.update(request, input);
      const writes = query.mock.calls.filter(([sql]) =>
        sql.includes('ai_admin_set_provider_config'),
      );
      expect(writes).toHaveLength(1);
      expect(writes[0]![1][4]).toBe(action === 'disable' ? 'keep' : action);
      expect(writes[0]![1].slice(11)).toEqual([1, 1]);
      expect(JSON.stringify(writes)).not.toContain('private-replacement-test-key');
      expect(isModelForProvider(provider, model)).toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
      await expect(
        controller.update(request, {
          ...input,
          provider: provider === 'openai' ? 'deepseek' : 'openai',
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        service.saveAdminConfig(
          PRINCIPAL,
          { ...input, provider: provider === 'openai' ? 'deepseek' : 'openai' },
          'wrong-provider',
        ),
      ).rejects.toMatchObject({ code: 'ai_model_invalid' });
      await expect(
        service.saveAdminConfig(
          PRINCIPAL,
          { ...input, model: 'catalog:openai:unproven' },
          'invalid',
        ),
      ).rejects.toMatchObject({ code: 'ai_model_invalid' });
      expect(
        query.mock.calls.filter(([sql]) => sql.includes('ai_admin_set_provider_config')),
      ).toHaveLength(1);
    },
  );

  it.each([
    ['deepseek', 'deepseek-flash', true],
    ['deepseek', 'deepseek-v4-pro', true],
    ['openai', 'gpt-6-luna', true],
    ['deepseek', 'deepseek-chat', false],
    ['openai', 'deepseek-flash', false],
    ['unknown', 'gpt-6-luna', false],
  ] as const)(
    'validates admin selection %s/%s against the catalog',
    async (provider, model, valid) => {
      const saveAdminConfig = vi.fn(async () => aiAdminFixture());
      const controller = new AiAdminController(
        {
          resolve: vi.fn(async () => ({ principalId: PRINCIPAL })),
        } as unknown as ActiveContextUseCase,
        {
          resolveAccess: vi.fn(async () => ({
            scopes: [{ kind: 'platform', role: 'platform_admin' }],
          })),
        } as unknown as AdminControlPlaneService,
        { saveAdminConfig } as unknown as AiChatService,
      );
      const request = {
        cookies: {},
        id: 'catalog-test',
        headers: {
          origin: 'https://asa.example.test',
          host: 'asa.example.test',
          'content-type': 'application/json',
        },
      } as unknown as FastifyRequest;
      const result = controller.update(request, {
        provider,
        model,
        enabled: false,
        configurationVersion: 1,
      });
      if (valid) {
        await result;
        expect(saveAdminConfig).toHaveBeenCalledWith(
          PRINCIPAL,
          { provider, model, enabled: false, configurationVersion: 1 },
          'catalog-test',
        );
      } else {
        await expect(result).rejects.toMatchObject({ status: 400 });
        expect(saveAdminConfig).not.toHaveBeenCalled();
      }
    },
  );

  it('switches back to a separately saved key without resubmitting or exposing it', async () => {
    const slots = [
      {
        provider: 'openai' as const,
        model: 'gpt-6-luna' as const,
        enabled: false,
        revision: 1,
        apiKeyConfigured: true,
        keyFingerprint: 'openai-hash',
        updatedAt: null,
      },
      {
        provider: 'deepseek' as const,
        model: 'deepseek-v4-pro' as const,
        enabled: false,
        revision: 1,
        apiKeyConfigured: true,
        keyFingerprint: 'deepseek-hash',
        updatedAt: null,
      },
    ];
    const before = aiAdminFixture({
      apiKeyConfigured: true,
      keyFingerprint: 'openai-hash',
      providerConfigurations: slots,
    });
    const after = aiAdminFixture({
      ...before,
      providerConfigurations: slots.map((slot) =>
        slot.provider === 'deepseek' ? { ...slot, revision: 2 } : slot,
      ),
      configurationVersion: 2,
    });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row(before)] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ai_admin_set_provider_config: 2 }] })
      .mockResolvedValueOnce({ rows: [row(after)] })
      .mockResolvedValueOnce({ rows: [] });
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new AiChatService({ query } as unknown as pg.Pool, {
      encryptionKey: '4c'.repeat(32),
      fetchImpl,
    });
    const saved = await service.saveAdminConfig(
      PRINCIPAL,
      { provider: 'deepseek', model: 'deepseek-v4-pro', enabled: false, configurationVersion: 1 },
      'switch-back',
    );
    expect(saved).toEqual(after);
    expect(query.mock.calls[2]![1]).toEqual([
      PRINCIPAL,
      false,
      'deepseek',
      'deepseek-v4-pro',
      'keep',
      null,
      null,
      null,
      null,
      'switch-back',
      null,
      1,
      1,
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects stale configuration before encryption, SQL writes or provider work', async () => {
    const query = vi.fn(async () => ({ rows: [row(aiAdminFixture({ configurationVersion: 4 }))] }));
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new AiChatService({ query } as unknown as pg.Pool, { fetchImpl });
    await expect(
      service.saveAdminConfig(
        PRINCIPAL,
        {
          provider: 'openai',
          model: 'gpt-6-luna',
          enabled: false,
          configurationVersion: 3,
          apiKey: 'fake-key-for-stale-update',
        },
        'stale',
      ),
    ).rejects.toMatchObject({ code: 'ai_config_changed', status: 409 });
    expect(query).toHaveBeenCalledTimes(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not confirm a save that another settings update immediately superseded', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row(aiAdminFixture())] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ai_admin_set_provider_config: 2 }] })
      .mockResolvedValueOnce({ rows: [row(aiAdminFixture({ configurationVersion: 3 }))] })
      .mockResolvedValueOnce({ rows: [] });
    const service = new AiChatService({ query } as unknown as pg.Pool);
    await expect(
      service.saveAdminConfig(
        PRINCIPAL,
        { provider: 'openai', model: 'gpt-6-luna', enabled: false, configurationVersion: 1 },
        'superseded',
      ),
    ).rejects.toMatchObject({ code: 'ai_config_changed', status: 409 });
  });

  it('maps a version race rejected under the SQL lock to a reloadable conflict', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row(aiAdminFixture())] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('AI_CONFIG_CHANGED'));
    const service = new AiChatService({ query } as unknown as pg.Pool);
    await expect(
      service.saveAdminConfig(
        PRINCIPAL,
        { provider: 'openai', model: 'gpt-6-luna', enabled: false },
        'race',
      ),
    ).rejects.toMatchObject({ code: 'ai_config_changed', status: 409 });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('copies only approved metadata even if a database row accidentally contains extra secret fields', async () => {
    const config = aiAdminFixture();
    const source = {
      ...row(config),
      api_key_ciphertext: 'private-ciphertext',
      provider_configurations: config.providerConfigurations.map((slot) => ({
        ...slot,
        apiKey: 'private-raw-key',
        api_key_iv: 'private-iv',
      })),
    };
    const service = new AiChatService(
      { query: vi.fn(async () => ({ rows: [source] })) } as unknown as pg.Pool,
      { encryptionKey: '4c'.repeat(32) },
    );
    const metadata = await service.adminConfig(PRINCIPAL);
    expect(metadata).toEqual(config);
    expect(JSON.stringify(metadata)).not.toContain('private-');
  });

  it.each(['send', 'stream', 'test'] as const)(
    '%s rejects a retired runtime before paid admission or fetch',
    async (operation) => {
      const config = row(
        aiAdminFixture({ provider: 'deepseek', model: 'deepseek-flash', apiKeyConfigured: true }),
      );
      const query = vi.fn(async (sql: string) => ({
        rows: [
          sql.includes('ai_runtime_config')
            ? { ...config, model: 'deepseek-chat', enabled: true }
            : config,
        ],
      }));
      const fetchImpl = vi.fn<typeof fetch>();
      const service = new AiChatService({ query } as unknown as pg.Pool, {
        encryptionKey: '4c'.repeat(32),
        fetchImpl,
      });
      const call =
        operation === 'test'
          ? service.testConnection(PRINCIPAL, 1)
          : operation === 'send'
            ? service.send(PRINCIPAL, PRINCIPAL, 'Hello', PRINCIPAL)
            : service.sendStream(
                PRINCIPAL,
                PRINCIPAL,
                'Hello',
                PRINCIPAL,
                () => undefined,
                new AbortController().signal,
              );
      await expect(call).rejects.toMatchObject({
        code: operation === 'stream' ? 'ai_model_invalid' : 'ai_model_unavailable',
      });
      expect(query.mock.calls.some(([sql]) => /ai_chat_begin|ai_admin_test_begin/.test(sql))).toBe(
        false,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('refuses a model/provider mismatch before constructing a request', () => {
    expect(() =>
      buildAiTextRequest('deepseek' as AiProvider, 'gpt-6-luna' as AiModel, [], '', false),
    ).toThrow('AI_MODEL_UNAVAILABLE');
  });
});
