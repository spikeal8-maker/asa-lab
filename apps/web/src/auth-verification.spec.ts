import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call } from './api-call';
import { adminApi } from './admin/admin-api';
import {
  notifyAccountVerificationRequired,
  onAccountVerificationRequired,
} from './auth-verification';

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock('./session-fetch', () => ({ fetchWithSessionRefresh: fetchMock }));

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('server verification restriction notification', () => {
  it('asks subscribed shells for server state and removes listeners on unmount', () => {
    const listener = vi.fn();
    const unsubscribe = onAccountVerificationRequired(listener);
    notifyAccountVerificationRequired();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    notifyAccountVerificationRequired();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the failed protected request failed while asking for a fresh session', async () => {
    const listener = vi.fn();
    const unsubscribe = onAccountVerificationRequired(listener);
    const error = { code: 'account_verification_required', message: 'Подтвердите аккаунт' };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error, verification: { required: true } }), { status: 403 }),
    );
    expect(await call('/api/projects')).toEqual({ ok: false, status: 403, error });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('handles the independent admin API client through the same shell event', async () => {
    const listener = vi.fn();
    const unsubscribe = onAccountVerificationRequired(listener);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'account_verification_required', message: 'Подтвердите аккаунт' },
        }),
        { status: 403 },
      ),
    );
    const result = await adminApi.verificationPolicy();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/v1/auth/verification-policy');
    unsubscribe();
  });

  it('does not change access in response to a network failure or unrelated denial', async () => {
    const listener = vi.fn();
    const unsubscribe = onAccountVerificationRequired(listener);
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    expect(await call('/api/auth/providers')).toMatchObject({ ok: false, status: 0 });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Недостаточно прав' } }), {
        status: 403,
      }),
    );
    expect(await call('/api/admin/v1/accounts')).toMatchObject({ ok: false, status: 403 });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
