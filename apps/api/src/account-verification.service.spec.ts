import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import {
  AccountVerificationService,
  evaluateAccountVerification,
  type VerificationPolicy,
} from './account-verification.service.js';
import type { AuthProviderAvailability } from './auth-provider-availability.js';

const START = Date.parse('2026-10-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const policy: VerificationPolicy = {
  enabled: true,
  activatedAt: new Date(START).toISOString(),
  graceHours: 24,
};
const max: AuthProviderAvailability = {
  id: 'max',
  available: true,
  reason: 'ready',
  checkedAt: new Date(START).toISOString(),
};
const telegram: AuthProviderAvailability = { ...max, id: 'telegram' };
const unavailable: AuthProviderAvailability = { ...max, available: false, reason: 'invalid_token' };

function evaluate(overrides: Partial<Parameters<typeof evaluateAccountVerification>[0]> = {}) {
  return evaluateAccountVerification({
    policy,
    firstAuthenticatedAt: new Date(START).toISOString(),
    verifiedProvider: null,
    providers: [max],
    now: START + DAY,
    ...overrides,
  });
}

describe('one-time account confirmation policy', () => {
  it('allows the first 24 hours and requires confirmation at the exact boundary', () => {
    expect(evaluate({ now: START + DAY - 1 })).toMatchObject({
      required: false,
      reason: 'grace_period',
    });
    expect(evaluate()).toMatchObject({
      required: true,
      reason: 'verification_required',
      dueAt: new Date(START + DAY).toISOString(),
    });
  });

  it('gives existing accounts a transition day when first activated', () => {
    const state = evaluate({
      firstAuthenticatedAt: '2020-01-01T00:00:00.000Z',
      now: START + DAY - 1,
    });
    expect(state.required).toBe(false);
    expect(state.dueAt).toBe(new Date(START + DAY).toISOString());
  });

  it('starts a new account deadline at its first authentication after activation', () => {
    const first = START + 10 * DAY;
    expect(
      evaluate({ firstAuthenticatedAt: new Date(first).toISOString(), now: first + DAY - 1 }),
    ).toMatchObject({ required: false, dueAt: new Date(first + DAY).toISOString() });
  });

  it('does not restrict a disabled policy, including an old account', () => {
    expect(
      evaluate({ policy: { ...policy, enabled: false }, now: START + 100 * DAY }),
    ).toMatchObject({ required: false, reason: 'disabled' });
    expect(
      evaluate({ policy: { enabled: false, activatedAt: null, graceHours: 24 } }).dueAt,
    ).toBeNull();
  });

  it.each(['max', 'telegram', 'email'] as const)(
    'accepts one already-verified %s proof without recurring daily checks',
    (verifiedProvider) => {
      expect(
        evaluate({ verifiedProvider, providers: [unavailable], now: START + 365 * DAY }),
      ).toMatchObject({ required: false, reason: 'verified', verifiedProvider });
    },
  );

  it.each([
    'invalid_token',
    'delivery_unavailable',
    'unavailable',
    'disabled',
    'not_configured',
  ] as const)('allows password access when all server provider states are %s', (reason) => {
    expect(
      evaluate({
        providers: [
          { ...max, available: false, reason },
          { ...telegram, available: false, reason },
        ],
      }),
    ).toMatchObject({ required: false, reason: 'providers_unavailable' });
  });

  it('requires confirmation through a healthy alternative when MAX is unavailable', () => {
    expect(evaluate({ providers: [unavailable, telegram] })).toMatchObject({ required: true });
  });

  it('does not treat a stale positive flag with a failed health result as ready', () => {
    expect(evaluate({ providers: [{ ...max, reason: 'invalid_token' }] })).toMatchObject({
      required: false,
      reason: 'providers_unavailable',
    });
  });

  it('does not turn corrupt policy state into a provider outage exception', () => {
    expect(() => evaluate({ policy: { ...policy, activatedAt: null } })).toThrow(
      'invalid account verification policy state',
    );
    expect(() => evaluate({ firstAuthenticatedAt: 'invalid' })).toThrow(
      'invalid account verification policy state',
    );
  });
});

describe('AccountVerificationService enforcement', () => {
  const row = {
    enabled: true,
    activated_at: new Date(START),
    first_authenticated_at: new Date(START),
    verified_provider: null,
  };

  it('does not hide database failures as an unavailable-provider password exception', async () => {
    const query = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const availability = vi.fn().mockResolvedValue(max);
    const service = new AccountVerificationService(
      { query } as unknown as pg.Pool,
      [{ availability }],
      () => START + DAY,
    );
    await expect(service.requireAccount('account-a')).rejects.toThrow('database unavailable');
    expect(availability).not.toHaveBeenCalled();
  });

  it('keeps a suspended or missing Account unauthorized even when providers are unavailable', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new AccountVerificationService(
      { query } as unknown as pg.Pool,
      [{ availability: async () => unavailable }],
      () => START + DAY,
    );
    await expect(service.requireAccount('suspended-account')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('returns a restricted context for an expired unverified Account', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const service = new AccountVerificationService(
      { query } as unknown as pg.Pool,
      [{ availability: async () => max }],
      () => START + DAY,
    );
    await expect(service.requireAccount('account-a')).rejects.toMatchObject({
      status: 403,
      response: {
        error: { code: 'account_verification_required' },
        verification: { required: true },
      },
    });
  });

  it('permits the same Account when the server reports all channels unavailable', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const service = new AccountVerificationService(
      { query } as unknown as pg.Pool,
      [{ availability: async () => unavailable }],
      () => START + DAY,
    );
    await expect(service.requireAccount('account-a')).resolves.toMatchObject({
      required: false,
      reason: 'providers_unavailable',
    });
    expect(query).toHaveBeenCalledWith('SELECT * FROM auth_account_verification_state($1)', [
      'account-a',
    ]);
  });

  it('checks an Account behind a valid bearer even without a browser cookie', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ account_id: 'account-a' }] })
      .mockResolvedValueOnce({ rows: [row] });
    const service = new AccountVerificationService(
      { query } as unknown as pg.Pool,
      [{ availability: async () => max }],
      () => START + DAY,
    );
    await expect(service.requirePrincipal('principal-a')).rejects.toMatchObject({ status: 403 });
  });

  it('preserves StudentSeat principals without creating or requiring an Account', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ account_id: null }] });
    const availability = vi.fn();
    const service = new AccountVerificationService(
      { query } as unknown as pg.Pool,
      [{ availability }],
      () => START + DAY,
    );
    await expect(service.requirePrincipal('seat-principal')).resolves.toBeUndefined();
    expect(availability).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('invalidates its policy cache after an authorized switch update', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ ...row, enabled: false }] })
      .mockResolvedValueOnce({ rows: [{ ...row, enabled: false }] });
    const service = new AccountVerificationService(
      { query } as unknown as pg.Pool,
      [],
      () => START,
    );
    expect(await service.isEnabled()).toBe(true);
    await service.updatePolicy('admin-principal', false, 'request-1');
    expect(await service.isEnabled()).toBe(false);
    expect(query).toHaveBeenCalledWith('SELECT * FROM admin_set_verification_policy($1, $2, $3)', [
      'admin-principal',
      false,
      'request-1',
    ]);
  });
});
