import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { verifyPasswordAsync } from '@asa-lab/identity';
import { MaxAuthService, MaxInitDataError, validateMaxInitData } from './max-auth.service.js';
import { ProviderOperationError } from './auth-provider-availability.js';

const BOT_TOKEN = 'test-only-max-bot-token';
const BOT_NAME = 'asa_test_bot';
const KEY = Buffer.alloc(32, 7);
const NOW_SECONDS = 1_800_000_000;
const PAIRING = 'p'.repeat(43);
const NONCE = 'n'.repeat(43);

function signedInitData(
  options: {
    queryId?: string;
    authDate?: number;
    user?: Record<string, unknown>;
    startParam?: string;
  } = {},
): string {
  const values = new Map<string, string>([
    ['auth_date', String(options.authDate ?? NOW_SECONDS)],
    ['query_id', options.queryId ?? 'max-query-1'],
    [
      'user',
      JSON.stringify(
        options.user ?? {
          id: 231408577954,
          first_name: 'Александр',
          last_name: 'Сергеев',
          username: 'asa_owner',
          ip: '198.51.100.20',
        },
      ),
    ],
  ]);
  if (options.startParam) values.set('start_param', options.startParam);
  const checkString = [...values.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  values.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return new URLSearchParams(values).toString();
}

function readyService(
  query = vi.fn(async (_sql: string, _args?: unknown[]) => ({
    rows: [] as Record<string, unknown>[],
  })),
) {
  const fetchImpl = vi.fn(async (url: string | URL | Request, _options?: RequestInit) => {
    const path = String(url);
    const body = path.endsWith('/me')
      ? { user_id: 1001, username: BOT_NAME, is_bot: true, name: 'ASA Test' }
      : path.endsWith('/subscriptions')
        ? {
            subscriptions: [
              {
                url: 'https://asa.example/api/auth/max/webhook',
                update_types: ['bot_started', 'message_callback'],
              },
            ],
          }
        : { success: true };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const service = new MaxAuthService({ query } as unknown as pg.Pool, {
    botToken: BOT_TOKEN,
    botUsername: BOT_NAME,
    miniAppUrl: 'https://asa.example/max-login',
    enabled: true,
    encryptionKey: KEY.toString('base64url'),
    now: () => NOW_SECONDS * 1000,
    fetchImpl,
  });
  return { service, query, fetchImpl };
}

describe('MAX WebApp authentication boundary', () => {
  it('retains the validated MAX identity shape and omits unrelated profile fields', () => {
    expect(validateMaxInitData(signedInitData(), BOT_TOKEN, NOW_SECONDS * 1000)).toEqual({
      subject: '231408577954',
      queryId: 'max-query-1',
      authDate: NOW_SECONDS,
      username: 'asa_owner',
      displayName: 'Александр Сергеев',
      startParam: null,
    });
  });

  it('rejects forged, duplicate, expired, future and bot assertions', () => {
    const valid = signedInitData();
    for (const raw of [
      valid.replace('asa_owner', 'attacker'),
      `${valid}&auth_date=${NOW_SECONDS}`,
      signedInitData({ user: { id: 123, is_bot: true } }),
      signedInitData({ user: { id: Number.MAX_SAFE_INTEGER + 1 } }),
    ])
      expect(() => validateMaxInitData(raw, BOT_TOKEN, NOW_SECONDS * 1000)).toThrow(
        MaxInitDataError,
      );
    for (const authDate of [NOW_SECONDS - 3601, NOW_SECONDS + 61]) {
      expect(() =>
        validateMaxInitData(signedInitData({ authDate }), BOT_TOKEN, NOW_SECONDS * 1000),
      ).toThrowError('max_init_data_expired');
    }
  });

  it('retains the start parameter as data without silently approving its pairing', async () => {
    const { service, query } = readyService(
      vi.fn(async () => ({ rows: [{ result: 'link_required' }] })),
    );
    expect(
      validateMaxInitData(
        signedInitData({ startParam: `pair_${PAIRING}` }),
        BOT_TOKEN,
        NOW_SECONDS * 1000,
      ).startParam,
    ).toBe(`pair_${PAIRING}`);
    await expect(
      service.signIn(signedInitData({ startParam: `pair_${PAIRING}` })),
    ).resolves.toEqual({ status: 'link_required' });
    expect(query.mock.calls.some((call) => String(call[0]).includes('pairing_approve'))).toBe(
      false,
    );
    expect(query.mock.calls.some((call) => String(call[0]).includes('register'))).toBe(false);
  });

  it('preserves public config/sign-in shape and never returns a bot token', async () => {
    const { service } = readyService(
      vi.fn(async () => ({ rows: [{ result: 'authenticated', account_id: 'account-1' }] })),
    );
    const config = await service.config();
    expect(config).toEqual({
      enabled: true,
      launchUrl: 'https://max.ru/asa_test_bot?start=asa_login',
    });
    await expect(service.signIn(signedInitData())).resolves.toMatchObject({
      status: 'authenticated',
      accountId: 'account-1',
      token: expect.any(String),
    });
    const admin = await service.adminConfig();
    expect(admin).toMatchObject({
      enabled: true,
      featureEnabled: true,
      available: true,
      availabilityReason: 'ready',
      tokenConfigured: true,
      encryptionReady: true,
      configurationVersion: 1,
    });
    expect(JSON.stringify({ config, admin })).not.toContain(BOT_TOKEN);
  });

  it('keeps disabled or invalid-address configurations unavailable without network calls', async () => {
    const fetchImpl = vi.fn();
    const disabled = new MaxAuthService({} as pg.Pool, {
      botToken: BOT_TOKEN,
      enabled: false,
      fetchImpl,
    });
    await expect(disabled.signIn(signedInitData())).rejects.toThrowError('max_auth_disabled');
    await expect(disabled.config()).resolves.toEqual({ enabled: false, launchUrl: null });
    const invalid = new MaxAuthService({} as pg.Pool, {
      miniAppUrl: 'javascript:alert(1)',
      enabled: true,
      fetchImpl,
    });
    await expect(invalid.adminConfig()).resolves.toMatchObject({
      miniAppUrl: null,
      available: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('MAX browser capability and account lifecycle', () => {
  it('stores independent token/nonce hashes and requires the browser nonce on completion', async () => {
    const { service, query } = readyService(
      vi.fn(async (sql: string) => ({
        rows: [sql.includes('pairing_start') ? { created: true } : { result: 'pending' }],
      })),
    );
    const pairing = await service.startPairing();
    expect(pairing.pairingToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pairing.browserNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pairing.browserNonce).not.toBe(pairing.pairingToken);
    expect(pairing.launchUrl).toContain(`start=pair_${pairing.pairingToken}`);
    expect(JSON.stringify(query.mock.calls)).not.toContain(pairing.pairingToken);
    expect(JSON.stringify(query.mock.calls)).not.toContain(pairing.browserNonce);
    const count = query.mock.calls.length;
    await expect(service.consumePairing(pairing.pairingToken)).resolves.toEqual({
      status: 'invalid',
    });
    expect(query.mock.calls.length).toBe(count);
    await expect(
      service.consumePairing(pairing.pairingToken, undefined, pairing.browserNonce),
    ).resolves.toEqual({ status: 'pending' });
    await service.startPairing('account-1');
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('pairing_start'), [
      'max',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
      10,
      'account-1',
      'link',
    ]);
  });

  it('keeps unknown identities as registration_required with no account or provisional session', async () => {
    const { service, query } = readyService(
      vi.fn(async () => ({
        rows: [
          { result: 'registration_required', display_name: 'Новый участник', username: 'new_user' },
        ],
      })),
    );
    await expect(service.consumePairing(PAIRING, undefined, NONCE)).resolves.toEqual({
      status: 'registration_required',
      profile: { displayName: 'Новый участник', username: 'new_user' },
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('pairing_consume'),
      expect.any(Array),
    );
  });

  it('passes the current account into atomic link consume and does not mint a linked session', async () => {
    const { service, query } = readyService(
      vi.fn(async () => ({ rows: [{ result: 'linked', account_id: 'same-account' }] })),
    );
    await expect(
      service.consumePairing(PAIRING, 'Browser', NONCE, 'same-account'),
    ).resolves.toEqual({
      status: 'linked',
      accountId: 'same-account',
    });
    expect(query.mock.calls[0]?.[1]?.[6]).toBe('same-account');
  });

  it('requires a real fallback password and preserves ordinary registration hashing', async () => {
    const { service, query } = readyService(
      vi.fn(async () => ({ rows: [{ result: 'authenticated', account_id: 'new-account' }] })),
    );
    const profile = {
      email: 'person@example.test',
      password: 'Known-fallback-password-1',
      username: 'person_test',
      displayName: 'Участник',
      birthDate: '1990-04-12',
      country: 'RU',
    };
    await expect(
      service.register(signedInitData(), { ...profile, password: undefined }),
    ).resolves.toMatchObject({ status: 'validation_error' });
    expect(query).not.toHaveBeenCalled();
    await expect(service.register(signedInitData(), profile)).resolves.toMatchObject({
      status: 'authenticated',
      accountId: 'new-account',
    });
    const args = query.mock.calls[0]?.[1];
    expect(args?.[6]).toBe(profile.email);
    expect(args?.[10]).toBe(profile.birthDate);
    expect(args?.[11]).toBe('RU');
    expect(args?.[7]).not.toBe(profile.password);
    await expect(verifyPasswordAsync(profile.password, String(args?.[7]))).resolves.toBe(true);
    expect(JSON.stringify(query.mock.calls)).not.toContain(profile.password);
  });

  it('enforces self-unlink domain failures instead of returning a misleading success', async () => {
    const { service } = readyService(
      vi.fn(async () => ({ rows: [{ result: 'last_sign_in_method' }] })),
    );
    await expect(service.unlink('account-1', 'principal-1')).rejects.toEqual(
      new ProviderOperationError('last_sign_in_method'),
    );
  });

  it('asks for an explicit human callback and only records proof on approval', async () => {
    const { service, query, fetchImpl } = readyService(
      vi.fn(async (sql: string) => ({
        rows: [sql.includes('event_claim') ? { claimed: true } : { result: 'approved' }],
      })),
    );
    const secret = createHmac('sha256', KEY)
      .update(`max-webhook:${BOT_NAME}:1`)
      .digest('base64url');
    const start = {
      update_type: 'bot_started',
      payload: `pair_${PAIRING}`,
      user: { user_id: 123, name: 'Человек' },
    };
    await expect(service.handleWebhook('forged', start)).resolves.toBe('unauthorized');
    expect(query).not.toHaveBeenCalled();
    await expect(service.handleWebhook(secret, start)).resolves.toBe('accepted');
    expect(query.mock.calls.some((call) => String(call[0]).includes('pairing_approve'))).toBe(
      false,
    );
    const message = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(JSON.stringify(message)).toContain(`approve:pair_${PAIRING}`);
    const callback = {
      update_type: 'message_callback',
      callback: {
        callback_id: 'callback-1',
        user: { user_id: 123, name: 'Человек' },
        payload: `approve:pair_${PAIRING}`,
      },
      message: { sender: { user_id: 999, is_bot: true } },
    };
    await expect(service.handleWebhook(secret, callback)).resolves.toBe('accepted');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('pairing_approve'), [
      'max',
      expect.any(String),
      '123',
      expect.any(String),
      NOW_SECONDS,
      null,
      'Человек',
    ]);
    expect(
      query.mock.calls.some((call) =>
        /auth_provider_(link|register|session_create)/.test(String(call[0])),
      ),
    ).toBe(false);
  });
});
