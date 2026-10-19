import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortable, authRequest, AUTH_REQUEST_TIMEOUT_MS, isAuthRequest } from './auth-request';
import { call } from './api-call';
import { call as adminCall } from './admin/admin-api';
import { api } from './api';

vi.mock('./client-diagnostics', () => ({ reportClientDiagnostic: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('bounded authentication requests', () => {
  it('limits only authentication and selected provider administration endpoints', () => {
    for (const path of [
      '/api/auth/providers',
      '/api/auth/verification?fresh=1',
      '/api/admin/v1/integrations/max',
      '/api/admin/v1/integrations/telegram/check',
      '/api/admin/v1/auth/verification-policy',
    ])
      expect(isAuthRequest(path)).toBe(true);
    for (const path of [
      '/api/projects/id',
      '/api/account/profile',
      '/api/admin/v1/accounts',
      '/api/admin/v1/integrations/max-other',
      '/api/authentication',
    ]) {
      expect(isAuthRequest(path)).toBe(false);
    }
  });

  it('settles and aborts a stalled request even when transport ignores its signal', async () => {
    vi.useFakeTimers();
    const observed: { signal?: AbortSignal | null | undefined } = {};
    const operation = vi.fn((request: RequestInit) => {
      observed.signal = request.signal;
      return new Promise<never>(() => undefined);
    });
    const result = authRequest('/api/auth/providers', {}, operation);
    const rejected = expect(result).rejects.toMatchObject({ code: 'auth_timeout' });
    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);
    await rejected;
    expect(operation).toHaveBeenCalledTimes(1);
    expect(observed.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start an already cancelled operation', async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = vi.fn(async () => 'unexpected');
    await expect(
      authRequest('/api/auth/providers', { signal: controller.signal }, operation),
    ).rejects.toMatchObject({ code: 'auth_cancelled' });
    expect(operation).not.toHaveBeenCalled();
  });

  it('starts live operations immediately before a newer request cancels the older one', async () => {
    const controller = new AbortController();
    const firstTransport = vi.fn(() => new Promise<never>(() => undefined));
    const first = abortable(firstTransport, controller.signal);
    const rejected = expect(first).rejects.toBeDefined();
    expect(firstTransport).toHaveBeenCalledTimes(1);
    controller.abort();
    const secondTransport = vi.fn(async () => 'newer response');
    const second = abortable(secondTransport, new AbortController().signal);
    expect(secondTransport).toHaveBeenCalledTimes(1);
    await rejected;
    await expect(second).resolves.toBe('newer response');
  });

  it('turns an immediate operation error into a rejected promise', async () => {
    const failure = new Error('transport setup failed');
    const result = abortable(() => {
      throw failure;
    }, new AbortController().signal);
    await expect(result).rejects.toBe(failure);
  });

  it.each(['password', 'max'] as const)(
    'cancels the underlying %s registration request',
    async (method) => {
      const controller = new AbortController();
      const observed: { signal?: AbortSignal | null | undefined } = {};
      const transport = vi.fn<typeof fetch>().mockImplementation((_path, init) => {
        observed.signal = init?.signal;
        return new Promise<Response>(() => undefined);
      });
      vi.stubGlobal('fetch', transport);
      const input = {
        email: 'fixture@example.test',
        username: 'fixture-account',
        displayName: 'Fixture',
        birthDate: '1988-03-01',
        country: 'RU',
        password: 'fixture-password-2026',
      };
      const result =
        method === 'max'
          ? api.maxRegister({ ...input, initData: 'synthetic-max-data' }, controller.signal)
          : api.register(
              {
                ...input,
                botProof: {
                  action: 'register',
                  nonce: 'fixture',
                  salt: 'fixture',
                  difficulty: 0,
                  issuedAt: 1,
                  expiresAt: 2,
                  signature: 'fixture',
                  counter: 0,
                },
              },
              controller.signal,
            );
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0]?.[0]).toBe(
        method === 'max' ? '/api/auth/max/register' : '/api/auth/register',
      );
      controller.abort();
      await expect(result).resolves.toMatchObject({ ok: false, error: { code: 'auth_cancelled' } });
      expect(observed.signal?.aborted).toBe(true);
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );

  it('ignores a late successful result after cancellation', async () => {
    const controller = new AbortController();
    let finish!: (value: string) => void;
    const success = vi.fn();
    const result = authRequest(
      '/api/auth/max/pairing/complete',
      { signal: controller.signal },
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    ).then(success);
    const rejected = expect(result).rejects.toMatchObject({ code: 'auth_cancelled' });
    await Promise.resolve();
    controller.abort();
    await rejected;
    finish('another-account');
    await Promise.resolve();
    await Promise.resolve();
    expect(success).not.toHaveBeenCalled();
  });

  it('leaves unrelated mutation timing and request options unchanged', async () => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const init = { method: 'PUT', body: 'saved draft' };
    const operation = vi.fn((request: RequestInit) => {
      expect(request).toBe(init);
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    });
    const result = authRequest('/api/projects/id/snapshot', init, operation);
    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS * 2);
    expect(operation).toHaveBeenCalledTimes(1);
    finish('saved');
    await expect(result).resolves.toBe('saved');
  });

  it('includes response-body reading in the auth deadline', async () => {
    vi.useFakeTimers();
    const response = new Response(null, { status: 200 });
    vi.spyOn(response, 'json').mockImplementation(() => new Promise<never>(() => undefined));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );
    const result = call('/api/auth/providers');
    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);
    await expect(result).resolves.toMatchObject({
      ok: false,
      status: 0,
      error: { code: 'auth_timeout' },
    });
  });

  it.each([
    { path: '/api/auth/telegram/pairing/register', method: 'POST', send: call },
    { path: '/api/admin/v1/integrations/max', method: 'PUT', send: adminCall },
  ])('never retries an unknown write result for $path', async ({ path, method, send }) => {
    vi.useFakeTimers();
    const transport = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', transport);
    const result = send(path, { method, body: '{}' });
    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);
    await expect(result).resolves.toMatchObject({
      ok: false,
      error: { code: 'auth_timeout', message: expect.stringContaining('неизвестен') },
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('keeps cancellation of one waiter separate from the shared operation', async () => {
    const controller = new AbortController();
    let finish!: (value: boolean) => void;
    const shared = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const first = abortable(() => shared, controller.signal);
    const second = abortable(() => shared);
    const rejected = expect(first).rejects.toBeDefined();
    await Promise.resolve();
    controller.abort();
    await rejected;
    finish(true);
    await expect(second).resolves.toBe(true);
  });
});
