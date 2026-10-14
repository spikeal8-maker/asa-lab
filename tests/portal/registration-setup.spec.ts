import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIRequestContext, TestInfo } from '@playwright/test';
import { registerAccountSetup } from '../../e2e/registration-setup';

const options = {
  headers: { origin: 'http://127.0.0.1:4612' },
  data: {
    email: 'modern-account@setup.test',
    username: 'modern_account',
    displayName: 'Modern personal Account',
    password: 'Safe-registration-password',
    birthDate: '1990-04-12',
    country: 'RU',
  },
};

function response(
  status = 429,
  header = '171',
  seconds: unknown = 171,
  code = 'too_many_requests',
) {
  return {
    status: vi.fn(() => status),
    headers: vi.fn(() => ({ 'retry-after': header })),
    json: vi.fn(async () => ({ error: { code, retryAfterSeconds: seconds } })),
  };
}

function fixture(first = response(), second = response(201), timeout = 90_000) {
  const post = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const setTimeout = vi.fn();
  return {
    first,
    second,
    post,
    setTimeout,
    run: () =>
      registerAccountSetup({ post } as unknown as APIRequestContext, options, {
        timeout,
        setTimeout,
      } as unknown as TestInfo),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('registration setup respects the server mutation window', () => {
  it.each([201, 200, 400, 403, 500])(
    'returns HTTP %s without retries or timeout changes',
    async (status) => {
      const setup = fixture(response(status));
      expect(await setup.run()).toBe(setup.first);
      expect(setup.post).toHaveBeenCalledExactlyOnceWith('/api/auth/register', options);
      expect(setup.first.headers).not.toHaveBeenCalled();
      expect(setup.first.json).not.toHaveBeenCalled();
      expect(setup.setTimeout).not.toHaveBeenCalled();
    },
  );

  it.each([1, 171, 300])(
    'waits exactly the directed %s seconds, then reuses the request',
    async (seconds) => {
      vi.useFakeTimers();
      const setup = fixture(response(429, String(seconds), seconds));
      const result = setup.run();
      await vi.advanceTimersByTimeAsync(seconds * 1000 - 1);
      expect(setup.post).toHaveBeenCalledTimes(1);
      expect(setup.setTimeout).toHaveBeenCalledExactlyOnceWith(90_000 + seconds * 1000);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toBe(setup.second);
      expect(setup.post).toHaveBeenCalledTimes(2);
      expect(setup.post.mock.calls[0]![0]).toBe('/api/auth/register');
      expect(setup.post.mock.calls[1]![0]).toBe('/api/auth/register');
      expect(setup.post.mock.calls[0]![1]).toBe(options);
      expect(setup.post.mock.calls[1]![1]).toBe(options);
      expect(setup.setTimeout.mock.calls).toEqual([
        [90_000 + seconds * 1000],
        [90_000 + seconds * 1000],
      ]);
    },
  );

  it('reconciles to actual elapsed wait and preserves an existing owner budget', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(1017);
    const setup = fixture(response(429, '1', 1), response(201), 120_000);
    const result = setup.run();
    await vi.runAllTimersAsync();
    await result;
    expect(setup.setTimeout.mock.calls).toEqual([[121_000], [121_007]]);
  });

  it.each([
    ['missing', undefined, 171],
    ['empty', '', 171],
    ['zero', '0', 0],
    ['negative', '-1', -1],
    ['fractional', '1.5', 1.5],
    ['above window', '301', 301],
    ['unbounded', '3600', 3600],
    ['leading zero', '01', 1],
    ['whitespace', ' 1', 1],
    ['HTTP date', 'Wed, 14 Oct 2026 10:00:00 GMT', 171],
    ['mismatch', '171', 170],
    ['string body', '171', '171'],
    ['missing body interval', '171', undefined],
    ['nonfinite body', '171', Infinity],
  ])(
    'refuses %s Retry-After without sleeping or extending the budget',
    async (_label, header, seconds) => {
      vi.useFakeTimers();
      const first = response(429, header as string, seconds);
      // Explicitly represent a missing header rather than the response factory default.
      first.headers.mockReturnValue({ 'retry-after': header as string });
      first.json.mockResolvedValue({
        error: { code: 'too_many_requests', retryAfterSeconds: seconds },
      });
      const setup = fixture(first);
      expect(await setup.run()).toBe(first);
      expect(setup.post).toHaveBeenCalledTimes(1);
      expect(setup.setTimeout).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['too_many_attempts', 'unexpected_error'])(
    'refuses the unrelated %s error',
    async (code) => {
      const setup = fixture(response(429, '171', 171, code));
      expect(await setup.run()).toBe(setup.first);
      expect(setup.post).toHaveBeenCalledTimes(1);
      expect(setup.setTimeout).not.toHaveBeenCalled();
    },
  );

  it.each([null, {}, { error: null }])('refuses an invalid response body %j', async (body) => {
    const first = response();
    first.json.mockResolvedValue(body as never);
    const setup = fixture(first);
    expect(await setup.run()).toBe(first);
    expect(setup.post).toHaveBeenCalledTimes(1);
    expect(setup.setTimeout).not.toHaveBeenCalled();
  });

  it('refuses invalid JSON', async () => {
    const first = response();
    first.json.mockRejectedValue(new SyntaxError('invalid JSON'));
    const setup = fixture(first);
    expect(await setup.run()).toBe(first);
    expect(setup.post).toHaveBeenCalledTimes(1);
    expect(setup.setTimeout).not.toHaveBeenCalled();
  });

  it('returns a persistent 429 after one retry for the unchanged HTTP 201 assertion', async () => {
    vi.useFakeTimers();
    const setup = fixture(response(429, '1', 1), response(429, '1', 1));
    const result = setup.run();
    await vi.runAllTimersAsync();
    const finalResponse = await result;
    expect(finalResponse).toBe(setup.second);
    expect(finalResponse.status()).toBe(429);
    expect(setup.post).toHaveBeenCalledTimes(2);
    expect(setup.second.headers).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
