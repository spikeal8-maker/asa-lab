import type pg from 'pg';
import { afterEach, expect, it, vi } from 'vitest';
import { cloudPoolFetch, accountBlockUntil } from './ai-ollama-cloud-pool';
import { installOllamaCloudCatalog } from './ai-model-catalog';
const catalog = [
  { id: 'ollama-cloud/test', model: 'test', capabilities: ['completion'], active: true },
];
const keys = [1, 2, 3, 4, 5].map((slot) => ({
  slot,
  key_fingerprint: 'fingerprint-' + slot,
  api_key_ciphertext: 'encrypted-' + slot,
}));
afterEach(() => installOllamaCloudCatalog(catalog, null));
function setup(statuses: number[]) {
  installOllamaCloudCatalog(catalog, null, ['ollama-cloud/test']);
  const query = vi.fn(async (sql: string) =>
    sql.includes('candidates') ? { rows: keys } : { rows: [] },
  );
  const upstream = vi.fn<typeof fetch>(
    async () => new Response('response', { status: statuses.shift() ?? 200 }),
  );
  const routed = cloudPoolFetch(
    { query } as unknown as pg.Pool,
    upstream,
    (k) => 'secret-' + k.slot,
  );
  const send = () =>
    routed('https://ollama.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'test', stream: true }),
      headers: { authorization: 'Bearer must-not-be-used' },
    });
  return { query, upstream, routed, send };
}
it.each([401, 402, 403, 404, 429])(
  'tries the next priority after definite HTTP %s rejection, retaining the same model',
  async (status) => {
    const f = setup([status, 200]);
    expect((await f.send()).status).toBe(200);
    expect(f.upstream).toHaveBeenCalledTimes(2);
    expect(
      f.upstream.mock.calls.map(([, init]) => new Headers(init?.headers).get('authorization')),
    ).toEqual(['Bearer secret-1', 'Bearer secret-2']);
    expect(
      f.upstream.mock.calls.every(
        ([, init]) => JSON.parse(String(init?.body)).model === 'test' && init?.redirect === 'error',
      ),
    ).toBe(true);
    expect(f.query).toHaveBeenCalledWith(
      expect.stringContaining('key_observe'),
      expect.arrayContaining([1, 'fingerprint-1']),
    );
  },
);
it.each([200, 400, 500, 502, 503])(
  'never retries an answer or ambiguous status %s',
  async (status) => {
    const f = setup([status]);
    expect((await f.send()).status).toBe(status);
    expect(f.upstream).toHaveBeenCalledTimes(1);
  },
);
it('does not retry network exceptions or read a streaming answer looking for retries', async () => {
  const f = setup([]);
  f.upstream.mockRejectedValueOnce(new Error('network outcome unknown'));
  await expect(f.send()).rejects.toThrow('network outcome unknown');
  expect(f.upstream).toHaveBeenCalledTimes(1);
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('partial'));
      c.error(new Error('late failure'));
    },
  });
  f.upstream.mockResolvedValueOnce(new Response(stream));
  const answer = await f.send();
  await expect(answer.text()).rejects.toThrow('late failure');
  expect(f.upstream).toHaveBeenCalledTimes(2);
});
it('stops at five definite failures and never forwards the legacy credential', async () => {
  const f = setup([402, 402, 402, 402, 402]);
  expect((await f.send()).status).toBe(402);
  expect(f.upstream).toHaveBeenCalledTimes(5);
});
it('preserves non-cloud transports and never sends a key to another origin', async () => {
  const f = setup([200]);
  await f.routed('https://other.example/v1/chat/completions', { method: 'POST' });
  expect(f.query).not.toHaveBeenCalled();
  expect(f.upstream.mock.calls[0]?.[1]?.headers).toBeUndefined();
});
it('does not retry after cancellation', async () => {
  const f = setup([402, 200]);
  const abort = new AbortController();
  f.upstream.mockImplementationOnce(async () => {
    abort.abort();
    return new Response('', { status: 402 });
  });
  await expect(
    f.routed('https://ollama.com/v1/chat/completions', {
      body: JSON.stringify({ model: 'test' }),
      signal: abort.signal,
    }),
  ).rejects.toThrow();
  expect(f.upstream).toHaveBeenCalledTimes(1);
});
it('keeps unknown balance distinct from an exhausted balance', () => {
  const base = {
    status: 'ok' as const,
    checkedAt: new Date().toISOString(),
    retryAfterSeconds: null,
    balance: {
      includedUsd: null,
      purchasedUsd: 0,
      allowanceUsd: null,
      resetsAt: null,
      sessionRemainingPercent: null,
      weeklyRemainingPercent: null,
    },
  };
  expect(accountBlockUntil(base)).toBeNull();
  expect(
    accountBlockUntil({ ...base, balance: { ...base.balance, includedUsd: 0 } }),
  ).not.toBeNull();
  expect(accountBlockUntil({ ...base, status: 'unavailable' })).toBeUndefined();
});
