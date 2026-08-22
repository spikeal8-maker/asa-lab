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

  it('never returns the bot credential in public configuration', () => {
    const service = new MaxAuthService({} as pg.Pool, {
      botToken: BOT_TOKEN,
      botUsername: '@id231408577954_3_bot',
      enabled: true,
      now: () => NOW_SECONDS * 1000,
    });
    const config = service.config();
    expect(config).toEqual({
      enabled: true,
      launchUrl: 'https://max.ru/id231408577954_3_bot?startapp=asa_login',
    });
    expect(JSON.stringify(config)).not.toContain(BOT_TOKEN);
  });

  it('keeps MAX disabled behind an explicit production flag even when a token exists', async () => {
    const service = new MaxAuthService({} as pg.Pool, {
      botToken: BOT_TOKEN,
      botUsername: 'id231408577954_3_bot',
      enabled: false,
      now: () => NOW_SECONDS * 1000,
    });
    expect(service.config()).toMatchObject({ enabled: false });
    await expect(service.signIn(signedInitData())).rejects.toThrowError('max_auth_disabled');
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
});
