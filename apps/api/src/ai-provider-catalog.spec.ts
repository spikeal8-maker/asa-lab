import { afterEach, expect, it, vi } from 'vitest';
import { discoverProviderModels, parseObservedModels } from './ai-provider-catalog';
import {
  getAiModelCatalog,
  installProviderObservations,
  isAiModel,
  buildAiTextRequest,
} from './ai-model-catalog';
afterEach(() => installProviderObservations([]));
it('uses fixed metadata GET, bounds content and never follows redirects or infers capabilities', async () => {
  const transport = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'unknown-future-model', input_modalities: ['image'] }, { id: 'gpt-6-luna' }],
        }),
      ),
  );
  expect(await discoverProviderModels('openai', 'fixture-secret', transport)).toEqual([
    'gpt-6-luna',
    'unknown-future-model',
  ]);
  expect(transport).toHaveBeenCalledWith(
    'https://api.openai.com/v1/models',
    expect.objectContaining({ method: 'GET', redirect: 'error' }),
  );
  await expect(
    discoverProviderModels(
      'deepseek',
      'fixture-secret',
      async () => new Response('a'.repeat(262145)),
    ),
  ).rejects.toThrow('TOO_LARGE');
  await expect(
    discoverProviderModels(
      'deepseek',
      'fixture-secret',
      async () => new Response('', { status: 401 }),
    ),
  ).rejects.toThrow('UNAVAILABLE');
});
it('rejects truncated, duplicate, unbounded and malformed catalogues instead of silently truncating', () => {
  for (const value of [
    { data: [{ id: 'a' }, { id: 'a' }] },
    { data: [{ id: 'a' }], has_more: true },
    { data: Array.from({ length: 301 }, (_, i) => ({ id: String(i) })) },
    { data: [{ id: 'bad model' }] },
  ])
    expect(() => parseObservedModels(value)).toThrow();
  expect(parseObservedModels({ data: [] })).toEqual([]);
});
it('separates observed presence, adapter proof and lifecycle while preserving admitted model identity', () => {
  installProviderObservations([
    {
      provider: 'openai',
      source: 'https://api.openai.com/v1/models',
      checkedAt: '2026-10-28T00:00:00Z',
      failed: false,
      models: [
        { id: 'gpt-6-luna', active: false },
        { id: 'new-image-model', active: true },
      ],
    },
  ]);
  expect(isAiModel('gpt-6-luna')).toBe(false);
  const discovered = getAiModelCatalog().models.find(
    (m) => m.id === 'catalog:openai:new-image-model',
  );
  expect(discovered).toMatchObject({
    selectable: false,
    adapterCompatible: false,
    inputModalities: [],
    outputModalities: [],
  });
  expect(() => buildAiTextRequest('openai', 'new-image-model', [], '', false)).toThrow();
  expect(buildAiTextRequest('openai', 'gpt-6-luna', [], '', false).body.model).toBe('gpt-6-luna');
});

it('cancels metadata transport at the fixed deadline', async () => {
  vi.useFakeTimers();
  try {
    const request = discoverProviderModels(
      'openai',
      'fixture-secret',
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const checked = expect(request).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(8000);
    await checked;
  } finally {
    vi.useRealTimers();
  }
});

it('B keeps unproven catalog identities separate across providers without granting either adapter access', () => {
  installProviderObservations(
    (['openai', 'deepseek'] as const).map((provider) => ({
      provider,
      source: 'metadata',
      checkedAt: '2026-10-28T00:00:00Z',
      failed: false,
      models: [{ id: 'same-future-name', active: true }],
    })),
  );
  const observed = getAiModelCatalog().models.filter((m) => m.label === 'same-future-name');
  expect(observed.map((m) => m.id)).toEqual([
    'catalog:openai:same-future-name',
    'catalog:deepseek:same-future-name',
  ]);
  expect(observed.every((m) => !m.adapterCompatible && !m.selectable)).toBe(true);
});
