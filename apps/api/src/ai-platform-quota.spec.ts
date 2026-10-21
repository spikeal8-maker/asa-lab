import { classifyProviderHttpFailure } from './ai-provider-errors';
import { aiAdminFixture } from './testing/ai-admin-config.fixture';
import { createCipheriv } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AiChatService, type AiAdminUpdate } from './ai-chat.service';

const ROOT = '7a'.repeat(32);
const PRINCIPAL = '11111111-1111-4111-8111-111111111111';
const THREAD = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';

function fixture(admission: 'allow' | 'replay' | Error = 'allow') {
  const iv = Buffer.alloc(12, 1);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(ROOT, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update('fake-provider-key'), cipher.final()]);
  const config = {
    enabled: true,
    provider: 'openai',
    model: 'gpt-6-luna',
    api_key_configured: true,
    provider_configurations: aiAdminFixture({ apiKeyConfigured: true }).providerConfigurations,
    migrated_from_model: null,
    key_fingerprint: null,
    configuration_version: 2,
    updated_at: null,
    paid_operations_per_hour: 1,
    api_key_ciphertext: encrypted.toString('base64url'),
    api_key_iv: iv.toString('base64url'),
    api_key_auth_tag: cipher.getAuthTag().toString('base64url'),
  };
  const order: string[] = [];
  const query = vi.fn(async (...[sql]: [string, unknown[]?]) => {
    order.push(sql);
    if (sql.includes('ai_runtime_config') || sql.includes('ai_admin_get_config')) {
      return { rows: [config] };
    }
    if (sql.includes('ai_text_generation_context'))
      return { rows: [{ role: 'user', content: 'Hello' }] };
    if (sql.includes('ai_admin_set_config')) {
      config.configuration_version += 1;
      return { rows: [{ ai_admin_set_config: config.configuration_version }] };
    }
    if (sql.includes('ai_text_begin') || sql.includes('ai_admin_test_begin')) {
      if (admission instanceof Error) throw admission;
      return { rows: [{ admitted: admission === 'allow' }] };
    }
    return { rows: [] };
  });
  const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
    order.push('fetch');
    if (JSON.parse(String(options?.body)).stream) {
      return new Response(
        'event: response.output_text.delta\ndata: {"delta":"OK"}\n\n' +
          'event: response.completed\ndata: {"type":"response.completed"}\n\n',
      );
    }
    return new Response(JSON.stringify({ status: 'completed', output_text: 'OK' }));
  });
  const service = new AiChatService({ query } as unknown as pg.Pool, {
    encryptionKey: ROOT,
    fetchImpl,
  });
  return { service, query, fetchImpl, order, config };
}

const operations = {
  send: (service: AiChatService) => service.send(PRINCIPAL, THREAD, 'Hello', REQUEST),
  stream: (service: AiChatService) =>
    service.sendStream(
      PRINCIPAL,
      THREAD,
      'Hello',
      REQUEST,
      () => undefined,
      new AbortController().signal,
      'gpt-6-luna',
    ),
  test: (service: AiChatService) => service.testConnection(PRINCIPAL, 2),
};

describe('platform-wide paid operation admission at every upstream path', () => {
  for (const [name, run] of Object.entries(operations)) {
    it.each([400, 401, 402, 403, 404, 422, 429, 500, 503])(
      `${name}: preserves safe diagnosis for upstream HTTP %i without retry or body inspection`,
      async (status) => {
        const f = fixture();
        f.config.provider = 'deepseek';
        f.config.model = 'deepseek-flash';
        // sendStream chooses its explicit model; keep provider-compatible selection below.
        const response = new Response('private-upstream-body sk-secret-never-expose', { status });
        const json = vi.spyOn(response, 'json');
        const text = vi.spyOn(response, 'text');
        f.fetchImpl.mockImplementationOnce(async () => response);
        const failure = classifyProviderHttpFailure(status);
        const operation =
          name === 'stream'
            ? f.service.sendStream(
                PRINCIPAL,
                THREAD,
                'Hello',
                REQUEST,
                () => undefined,
                new AbortController().signal,
                'deepseek-flash',
              )
            : run(f.service);
        await expect(operation).rejects.toMatchObject(failure);
        expect(f.fetchImpl).toHaveBeenCalledTimes(1);
        expect(json).not.toHaveBeenCalled();
        expect(text).not.toHaveBeenCalled();
        expect(JSON.stringify(failure)).not.toContain('sk-secret');
      },
    );

    it(`${name}: distinguishes outgoing connection failures without exposing exceptions`, async () => {
      const f = fixture();
      f.fetchImpl.mockRejectedValueOnce(new Error('private URL and sk-secret'));
      await expect(run(f.service)).rejects.toMatchObject({
        code: 'ai_provider_unavailable',
        status: 503,
      });
      expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    });

    it(`${name}: reports missing server encryption before paid admission`, async () => {
      const f = fixture();
      const service = new AiChatService({ query: f.query } as unknown as pg.Pool, {
        encryptionKey: 'invalid-root-key',
        fetchImpl: f.fetchImpl,
      });
      await expect(run(service)).rejects.toMatchObject({
        code: 'ai_encryption_unavailable',
        status: 503,
      });
      expect(f.fetchImpl).not.toHaveBeenCalled();
      expect(f.order.some((sql) => sql.includes('begin'))).toBe(false);
    });

    it(`${name}: recognizes an actual timeout signal without retry`, async () => {
      const f = fixture();
      const controller = new AbortController();
      controller.abort();
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
      f.fetchImpl.mockRejectedValueOnce(new Error('private transport details'));
      try {
        await expect(run(f.service)).rejects.toMatchObject({
          code: 'ai_provider_timeout',
          status: 504,
        });
        expect(f.fetchImpl).toHaveBeenCalledTimes(1);
      } finally {
        timeout.mockRestore();
      }
    });

    it.each([
      ['missing', 'ai_key_required'],
      ['decryption', 'ai_key_decryption_failed'],
    ])(`${name}: reports %s credentials before paid admission`, async (kind, code) => {
      const f = fixture();
      f.config.api_key_ciphertext = kind === 'missing' ? '' : 'broken-ciphertext';
      await expect(run(f.service)).rejects.toMatchObject({ code, status: 503 });
      expect(f.fetchImpl).not.toHaveBeenCalled();
      expect(f.order.some((sql) => sql.includes('begin'))).toBe(false);
    });

    it(`${name}: maps zero/exhausted quota and never fetches`, async () => {
      const f = fixture(new Error('AI_PLATFORM_QUOTA_EXHAUSTED'));
      await expect(run(f.service)).rejects.toMatchObject({
        code: 'ai_platform_quota_exhausted',
        status: 429,
      });
      expect(f.fetchImpl).not.toHaveBeenCalled();
    });

    it(`${name}: database errors fail closed without fetching`, async () => {
      const f = fixture(new Error('database unavailable'));
      await expect(run(f.service)).rejects.toThrow('database unavailable');
      expect(f.fetchImpl).not.toHaveBeenCalled();
    });

    it(`${name}: awaits durable SQL admission before its one fetch`, async () => {
      const f = fixture();
      await run(f.service);
      const index = f.order.findIndex((sql) => /ai_text_begin|ai_admin_test_begin/.test(sql));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(f.order.indexOf('fetch')).toBeGreaterThan(index);
      expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    });
  }

  for (const name of ['send', 'stream'] as const) {
    it(`${name}: passes the exact runtime version to admission`, async () => {
      const f = fixture();
      await operations[name](f.service);
      expect(f.query).toHaveBeenCalledWith(
        'SELECT ai_text_begin_paid($1,$2,$3,$4::varchar,$5::bigint) AS admitted',
        [PRINCIPAL, THREAD, REQUEST, 'Hello', f.config.configuration_version],
      );
    });

    it(`${name}: maps a disabled admission without fetching`, async () => {
      const f = fixture(new Error('AI_DISABLED'));
      await expect(operations[name](f.service)).rejects.toMatchObject({
        code: 'ai_disabled',
        status: 503,
      });
      expect(f.fetchImpl).not.toHaveBeenCalled();
    });

    it(`${name}: an account replay never performs another paid operation`, async () => {
      const f = fixture('replay');
      expect(await operations[name](f.service)).toMatchObject({ replayed: true });
      expect(f.fetchImpl).not.toHaveBeenCalled();
    });
  }

  it('a provider test requires an affirmative admission and the saved version', async () => {
    const f = fixture('replay');
    await expect(f.service.testConnection(PRINCIPAL, 2)).rejects.toMatchObject({
      code: 'ai_admission_unavailable',
    });
    expect(f.query).toHaveBeenCalledWith('SELECT ai_admin_test_begin($1,$2::bigint) AS admitted', [
      PRINCIPAL,
      2,
    ]);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('a configuration race is rejected before a provider test fetch', async () => {
    const f = fixture(new Error('AI_CONFIG_CHANGED'));
    await expect(f.service.testConnection(PRINCIPAL, 2)).rejects.toMatchObject({
      code: 'ai_config_changed',
      status: 409,
    });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('an already aborted stream does not fetch after admission or retry', async () => {
    const f = fixture();
    const abort = new AbortController();
    abort.abort();
    await f.service.sendStream(
      PRINCIPAL,
      THREAD,
      'Hello',
      REQUEST,
      () => undefined,
      abort.signal,
      'gpt-6-luna',
    );
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.query.mock.calls.some(([sql]) => sql.includes('ai_chat_abort'))).toBe(true);
    expect(f.query.mock.calls.filter(([sql]) => sql.includes('ai_text_begin'))).toHaveLength(1);
  });

  it.each([-1, 1.5, NaN, Infinity, 2147483648, '10', null])(
    'rejects an invalid limit %s before saving settings',
    async (limit) => {
      const f = fixture();
      await expect(
        f.service.saveAdminConfig(
          PRINCIPAL,
          {
            enabled: false,
            provider: 'openai',
            model: 'gpt-6-luna',
            paidOperationsPerHour: limit,
          } as AiAdminUpdate,
          'settings',
        ),
      ).rejects.toMatchObject({ code: 'ai_config_invalid', status: 400 });
      expect(f.query).not.toHaveBeenCalled();
    },
  );

  it.each([0, 3, 2147483647])(
    'passes the explicit integer limit %s to the guarded setter',
    async (limit) => {
      const f = fixture();
      await f.service.saveAdminConfig(
        PRINCIPAL,
        {
          enabled: false,
          provider: 'openai',
          model: 'gpt-6-luna',
          paidOperationsPerHour: limit,
        },
        'settings',
      );
      const write = f.query.mock.calls.find(([sql]) => sql.includes('ai_admin_set_config'));
      expect(write?.[1]?.[10]).toBe(limit);
      expect(f.fetchImpl).not.toHaveBeenCalled();
    },
  );
});
