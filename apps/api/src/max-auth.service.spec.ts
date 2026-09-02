import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { MaxAuthService, MaxInitDataError, validateMaxInitData } from './max-auth.service.js';

const BOT_TOKEN = 'test-only-max-bot-token';
const NOW_SECONDS = 1_800_000_000;

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
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  values.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'));
  return new URLSearchParams(values).toString();
}

describe('MAX WebApp authentication boundary', () => {
  it('accepts a fresh signed identity and exposes only bounded profile fields', () => {
    expect(validateMaxInitData(signedInitData(), BOT_TOKEN, NOW_SECONDS * 1000)).toEqual({
      subject: '231408577954',
      queryId: 'max-query-1',
      authDate: NOW_SECONDS,
      username: 'asa_owner',
      displayName: 'Александр Сергеев',
      startParam: null,
    });
  });

  it('rejects tampering, duplicate fields and expired launches', () => {
    const valid = signedInitData();
    expect(() =>
      validateMaxInitData(valid.replace('asa_owner', 'attacker'), BOT_TOKEN, NOW_SECONDS * 1000),
    ).toThrow(MaxInitDataError);
    expect(() =>
      validateMaxInitData(`${valid}&auth_date=${NOW_SECONDS}`, BOT_TOKEN, NOW_SECONDS * 1000),
    ).toThrow(MaxInitDataError);
    expect(() =>
      validateMaxInitData(
        signedInitData({ authDate: NOW_SECONDS - 3601 }),
        BOT_TOKEN,
        NOW_SECONDS * 1000,
      ),
    ).toThrowError('max_init_data_expired');
  });

  it('keeps an authenticated one-time browser pairing capability from a native bot link', () => {
    expect(
      validateMaxInitData(
        signedInitData({ startParam: `pair_${'a'.repeat(43)}` }),
        BOT_TOKEN,
        NOW_SECONDS * 1000,
      ).startParam,
    ).toBe(`pair_${'a'.repeat(43)}`);
  });

  it('never returns the bot credential in public configuration', async () => {
    const service = new MaxAuthService({} as pg.Pool, {
      botToken: BOT_TOKEN,
      botUsername: '@id231408577954_3_bot',
      miniAppUrl: 'https://asa-lab.ru/max-login',
      enabled: true,
      now: () => NOW_SECONDS * 1000,
    });
    const config = await service.config();
    expect(config).toEqual({
      enabled: true,
      launchUrl: 'https://max.ru/id231408577954_3_bot?start=asa_login',
    });
    expect(JSON.stringify(config)).not.toContain(BOT_TOKEN);
    const adminConfig = await service.adminConfig();
    expect(adminConfig).toMatchObject({
      enabled: true,
      featureEnabled: true,
      tokenConfigured: true,
      botUsername: 'id231408577954_3_bot',
      launchUrl: 'https://max.ru/id231408577954_3_bot?start=asa_login',
      miniAppUrl: 'https://asa-lab.ru/max-login',
      encryptionReady: true,
      tokenFingerprint: expect.any(String),
      configurationVersion: 1,
    });
    expect(JSON.stringify(adminConfig)).not.toContain(BOT_TOKEN);
  });

  it('keeps MAX disabled behind an explicit production flag even when a token exists', async () => {
    const service = new MaxAuthService({} as pg.Pool, {
      botToken: BOT_TOKEN,
      botUsername: 'id231408577954_3_bot',
      enabled: false,
      now: () => NOW_SECONDS * 1000,
    });
    await expect(service.config()).resolves.toMatchObject({ enabled: false });
    await expect(service.signIn(signedInitData())).rejects.toThrowError('max_auth_disabled');
  });

  it('publishes only an HTTPS mini-app address to administration', async () => {
    const service = new MaxAuthService({} as pg.Pool, {
      miniAppUrl: 'javascript:alert(1)',
    });
    await expect(service.adminConfig()).resolves.toMatchObject({
      miniAppUrl: 'https://asa-lab.ru/max-login',
    });
  });

  it('delegates unlink to the server-owned account and principal boundary', async () => {
    const query = vi.fn(async () => ({ rows: [{ unlinked: true }] }));
    const service = new MaxAuthService({ query } as unknown as pg.Pool, {
      botToken: BOT_TOKEN,
      botUsername: 'id231408577954_3_bot',
      enabled: true,
    });
    await expect(service.unlink('account-id', 'principal-id')).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith('SELECT auth_max_unlink_self($1, $2) AS unlinked', [
      'account-id',
      'principal-id',
    ]);
  });

  it('stores only a hash for desktop pairing and keeps pending requests anonymous', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('auth_max_pairing_start')) return { rows: [{ created: true }] };
      if (sql.includes('auth_max_pairing_consume')) return { rows: [{ result: 'pending' }] };
      return { rows: [] };
    });
    const service = new MaxAuthService({ query } as unknown as pg.Pool, {
      botToken: BOT_TOKEN,
      botUsername: 'id231408577954_3_bot',
      enabled: true,
    });
    const pairing = await service.startPairing();
    expect(pairing.pairingToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pairing.launchUrl).toContain(`start=pair_${pairing.pairingToken}`);
    expect(JSON.stringify(query.mock.calls[0])).not.toContain(pairing.pairingToken);
    expect(query.mock.calls[0]?.[1]).toEqual([expect.any(String), 10, null]);
    await expect(service.consumePairing(pairing.pairingToken)).resolves.toEqual({
      status: 'pending',
    });
    await service.startPairing('account-id');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('auth_max_pairing_start'), [
      expect.any(String),
      10,
      'account-id',
    ]);
  });

  it('uses a native bot deep link and confirms a linked account without a mini-app', async () => {
    const encryptionBytes = Buffer.alloc(32, 7);
    const pairingToken = 'p'.repeat(43);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('auth_max_pairing_target')) {
        return { rows: [{ result: 'pending', requested_account_id: null }] };
      }
      if (sql.includes('auth_max_identity_account')) {
        return { rows: [{ account_id: 'account-1' }] };
      }
      if (sql.includes('auth_max_pairing_approve')) {
        return { rows: [{ approved: true }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const service = new MaxAuthService({ query } as unknown as pg.Pool, {
      botToken: BOT_TOKEN,
      botUsername: 'id231408577954_3_bot',
      miniAppUrl: 'https://asa-lab.ru/max-login',
      enabled: true,
      encryptionKey: encryptionBytes.toString('base64url'),
      fetchImpl,
    });
    const secret = createHmac('sha256', encryptionBytes)
      .update('max-webhook:id231408577954_3_bot')
      .digest('base64url');

    await expect(
      service.handleWebhook(secret, {
        update_type: 'bot_started',
        timestamp: NOW_SECONDS * 1000,
        payload: `pair_${pairingToken}`,
        user: {
          user_id: 231408577954,
          first_name: 'Александр',
          last_name: 'Сергеев',
          username: 'asa_owner',
        },
      }),
    ).resolves.toBe('accepted');
    const messageBody = JSON.parse(
      String((fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as { text: string; attachments: Array<{ payload: { buttons: unknown[][] } }> };
    expect(messageBody.text).toContain('Личность подтверждена');
    expect(JSON.stringify(messageBody)).toContain('https://asa-lab.ru/#/sign-in');
    expect(JSON.stringify(messageBody)).not.toContain('max-login');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('auth_max_pairing_approve'), [
      expect.any(String),
      'account-1',
    ]);
  });

  it('creates a provider-only account automatically when MAX has no linked identity', async () => {
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      if (sql.includes('auth_max_identity_account')) return { rows: [{ account_id: null }] };
      if (sql.includes('auth_max_register_account')) {
        expect(parameters?.[5]).toBe('max-231408577954@users.asa.invalid');
        expect(parameters?.[8]).toMatch(/^max_[a-f0-9]{20}$/);
        return { rows: [{ result: 'authenticated', account_id: 'new-account' }] };
      }
      if (sql.includes('auth_max_discard_provisional_session')) {
        return { rows: [{ discarded: true }] };
      }
      if (sql.includes('auth_max_pairing_approve')) {
        return { rows: [{ approved: true }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const service = new MaxAuthService({ query } as unknown as pg.Pool, {
      botToken: BOT_TOKEN,
      botUsername: 'id231408577954_3_bot',
      enabled: true,
      now: () => NOW_SECONDS * 1000,
    });

    await expect(service.signIn(signedInitData())).resolves.toMatchObject({
      status: 'authenticated',
      accountId: 'new-account',
      token: expect.any(String),
    });
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('auth_max_discard_provisional_session'),
      expect.anything(),
    );
  });

  it('verifies, encrypts and applies a runtime token without returning the secret', async () => {
    const encryptionKey = Buffer.alloc(32, 7).toString('base64url');
    let runtime = {
      enabled: false,
      bot_username: 'id231408577954_3_bot',
      mini_app_url: 'https://asa-lab.ru/max-login',
      token_ciphertext: null as string | null,
      token_iv: null as string | null,
      token_auth_tag: null as string | null,
      token_fingerprint: null as string | null,
      verified_bot_id: null as string | null,
      verified_bot_name: null as string | null,
      token_verified_at: null as string | null,
      configuration_version: 1,
      updated_at: null as string | null,
    };
    const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
      if (sql.includes('admin_set_max_runtime_config')) {
        runtime = {
          ...runtime,
          enabled: parameters?.[1] === true,
          token_ciphertext: String(parameters?.[5]),
          token_iv: String(parameters?.[6]),
          token_auth_tag: String(parameters?.[7]),
          token_fingerprint: String(parameters?.[8]),
          verified_bot_id: String(parameters?.[9]),
          verified_bot_name: String(parameters?.[10]),
          token_verified_at: new Date().toISOString(),
          configuration_version: 2,
          updated_at: new Date().toISOString(),
        };
        return { rows: [{ admin_set_max_runtime_config: 2 }] };
      }
      if (sql.includes('admin_get_max_runtime_config')) {
        return { rows: [{ ...runtime, token_configured: runtime.token_ciphertext !== null }] };
      }
      return { rows: [runtime] };
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            user_id: 231408577954,
            username: 'id231408577954_3_bot',
            name: 'ASA Lab',
            is_bot: true,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const service = new MaxAuthService({ query } as unknown as pg.Pool, {
      encryptionKey,
      fetchImpl,
    });

    const result = await service.updateAdminConfig(
      'principal-id',
      {
        enabled: true,
        botUsername: '@id231408577954_3_bot',
        miniAppUrl: 'https://asa-lab.ru/max-login',
        botToken: BOT_TOKEN,
      },
      'request-id',
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://platform-api2.max.ru/me',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: BOT_TOKEN }) }),
    );
    expect(runtime.token_ciphertext).not.toBe(BOT_TOKEN);
    expect(JSON.stringify(query.mock.calls)).not.toContain(`"${BOT_TOKEN}"`);
    expect(JSON.stringify(result)).not.toContain(BOT_TOKEN);
    await expect(service.config()).resolves.toEqual({
      enabled: true,
      launchUrl: 'https://max.ru/id231408577954_3_bot?start=asa_login',
    });
  });
});
