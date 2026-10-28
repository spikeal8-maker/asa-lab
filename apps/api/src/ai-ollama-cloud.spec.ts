import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaCloudMetadata } from './ai-ollama-cloud';
import {
  buildAiTextRequest,
  installOllamaCloudCatalog,
  isModelForProvider,
} from './ai-model-catalog';
const key = 'test-private-cloud-key-001';
const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers });
const seed = [
  { id: 'gemma4:31b', model: 'gemma4:31b', capabilities: ['completion', 'vision'], active: true },
  { id: 'gpt-oss:120b', model: 'gpt-oss:120b', capabilities: ['completion'], active: true },
  { id: 'gpt-oss:20b', model: 'gpt-oss:20b', capabilities: ['completion'], active: true },
];
afterEach(() => installOllamaCloudCatalog(seed, null));
describe('one-key Ollama Cloud metadata', () => {
  it('uses only fixed GET metadata URLs, caches per key and keeps secrets out of results', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/api/tags')
        ? json({
            models: [
              { name: 'deepseek-v4-pro', capabilities: ['completion', 'thinking'] },
              { name: 'audio-only', capabilities: ['audio'] },
            ],
          })
        : json({
            included: {
              balance_usd: 12.5,
              allowance_usd: 60,
              period: { until: '2026-11-28T10:00:00Z' },
            },
            purchased: { balance_usd: 3 },
          }),
    );
    const client = new OllamaCloudMetadata(fetchImpl);
    const models = await client.catalog();
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe('ollama-cloud/deepseek-v4-pro');
    const balance = await client.account(key);
    expect(balance).toMatchObject({
      status: 'ok',
      balance: { includedUsd: 12.5, purchasedUsd: 3 },
    });
    await client.account(key);
    await client.catalog();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'application/json' },
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).not.toHaveProperty('authorization');
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toHaveProperty('authorization', 'Bearer ' + key);
    expect(JSON.stringify({ models, balance })).not.toContain(key);
    await client.account('test-private-cloud-key-002');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(
      fetchImpl.mock.calls.every(([url]) =>
        ['https://ollama.com/api/tags', 'https://ollama.com/api/balance'].includes(String(url)),
      ),
    ).toBe(true);
  });
  it.each([
    [401, 'invalid_key'],
    [402, 'credits_required'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [503, 'unavailable'],
  ] as const)('maps %s without leaking provider error text', async (status, expected) => {
    const client = new OllamaCloudMetadata(
      vi.fn(async () => json({ error: key }, status, { 'retry-after': '60' })),
    );
    expect(await client.account(key)).toMatchObject({
      status: expected,
      balance: null,
      retryAfterSeconds: 60,
    });
    expect(JSON.stringify(await client.account(key))).not.toContain(key);
  });
  it('preserves unknown buckets and recognizes legacy limits without inventing token balances', async () => {
    const a = new OllamaCloudMetadata(vi.fn(async () => json({ included: { balance_usd: 0 } })));
    expect(await a.account(key)).toMatchObject({
      status: 'ok',
      balance: { includedUsd: 0, purchasedUsd: null },
    });
    const b = new OllamaCloudMetadata(
      vi.fn(async () =>
        json({
          included: {
            session: { remaining_percent: 75, resets_at: '2026-10-29T00:00:00Z' },
            weekly: { remaining_percent: 40 },
          },
          purchased: { balance_usd: 0 },
        }),
      ),
    );
    expect(await b.account(key)).toMatchObject({
      balance: { sessionRemainingPercent: 75, weeklyRemainingPercent: 40, includedUsd: null },
    });
    const c = new OllamaCloudMetadata(vi.fn(async () => json({ included: { unexpected: true } })));
    expect(await c.account(key)).toMatchObject({ status: 'unavailable', balance: null });
  });
  it('rejects invalid keys before network access and does not follow redirects', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://example.invalid' } }),
    );
    const client = new OllamaCloudMetadata(fetchImpl);
    expect(() => client.account('bad\nkey-123456789')).toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await client.account(key)).toMatchObject({ status: 'unavailable' });
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe('error');
  });
  it.each([
    { models: [{ name: '<script>', capabilities: ['completion'] }] },
    {
      models: [
        { name: 'x', capabilities: ['completion'] },
        { name: 'x', capabilities: ['completion'] },
      ],
    },
    { models: [{ name: 'unknown', capabilities: [] }] },
  ])('rejects an invalid or unsupported catalogue', async (body) => {
    await expect(
      new OllamaCloudMetadata(vi.fn(async () => json(body))).catalog(),
    ).rejects.toThrow();
  });
  it('routes dynamic names to the fixed cloud host without changing the direct provider; admitted model identity survives retirement', () => {
    const model = {
      id: 'ollama-cloud/deepseek-v4-pro',
      model: 'deepseek-v4-pro',
      capabilities: ['completion'],
      active: true,
    };
    installOllamaCloudCatalog([...seed, model], '2026-10-28T10:00:00Z');
    expect(isModelForProvider('ollama-cloud', model.id)).toBe(true);
    expect(isModelForProvider('deepseek', model.id)).toBe(false);
    expect(buildAiTextRequest('ollama-cloud', model.id, [], '', false)).toMatchObject({
      url: 'https://ollama.com/v1/chat/completions',
      body: { model: 'deepseek-v4-pro' },
    });
    expect(buildAiTextRequest('deepseek', 'deepseek-v4-pro', [], '', false).url).toBe(
      'https://api.deepseek.com/chat/completions',
    );
    installOllamaCloudCatalog([...seed, { ...model, active: false }], null);
    expect(isModelForProvider('ollama-cloud', model.id)).toBe(false);
    expect(buildAiTextRequest('ollama-cloud', model.id, [], '', false).body.model).toBe(
      'deepseek-v4-pro',
    );
    expect(() =>
      buildAiTextRequest('ollama-cloud', 'ollama-cloud/invented', [], '', false),
    ).toThrow();
  });
});
