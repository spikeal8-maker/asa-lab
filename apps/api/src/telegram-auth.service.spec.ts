import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import {
  TelegramAuthService,
  TelegramInitDataError,
  validateTelegramInitData,
} from './telegram-auth.service.js';

const TOKEN = '1001:test_only_telegram_token_000000';
const KEY = Buffer.alloc(32, 9);
const NOW = 1_800_000_000;
const PAIRING = 't'.repeat(43);

function signed(fields: Record<string, string> = {}) {
  const values = new Map(
    Object.entries({
      auth_date: String(NOW),
      user: JSON.stringify({ id: 123, first_name: 'Елена' }),
      ...fields,
    }),
  );
  const data = [...values.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  values.set('hash', createHmac('sha256', key).update(data).digest('hex'));
  return new URLSearchParams(values).toString();
}

describe('Telegram provider proof and real bot routes', () => {
  it('validates signed raw initData without requiring optional query_id', () => {
    expect(validateTelegramInitData(signed(), TOKEN, NOW * 1000)).toMatchObject({
      subject: '123',
      displayName: 'Елена',
      queryId: expect.stringMatching(/^init:[a-f0-9]{64}$/),
    });
    expect(
      validateTelegramInitData(signed({ query_id: 'query-1' }), TOKEN, NOW * 1000).queryId,
    ).toBe('query-1');
    expect(() =>
      validateTelegramInitData(signed().replace('123', '456'), TOKEN, NOW * 1000),
    ).toThrow(TelegramInitDataError);
    expect(() => validateTelegramInitData(signed(), 'wrong-token', NOW * 1000)).toThrow(
      TelegramInitDataError,
    );
    expect(() =>
      validateTelegramInitData(signed({ auth_date: String(NOW - 3601) }), TOKEN, NOW * 1000),
    ).toThrowError('telegram_init_data_expired');
  });

  it('authenticates callbacks by webhook secret and uses callback_query.from, never bot message.from', async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: [sql.includes('event_claim') ? { claimed: true } : { result: 'approved' }],
    }));
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _options?: RequestInit) =>
        new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    const service = new TelegramAuthService({ query } as unknown as pg.Pool, {
      botToken: TOKEN,
      botUsername: 'asa_test_bot',
      miniAppUrl: 'https://asa.example/telegram-login',
      encryptionKey: KEY.toString('base64url'),
      now: () => NOW * 1000,
      enabled: true,
      fetchImpl,
    });
    const secret = createHmac('sha256', KEY)
      .update('telegram-webhook:asa_test_bot:1')
      .digest('base64url');
    const update = {
      update_id: 1,
      callback_query: {
        id: 'callback-1',
        from: { id: 123, first_name: 'Елена', is_bot: false },
        data: `approve:pair_${PAIRING}`,
        message: { from: { id: 1001, is_bot: true } },
      },
    };
    await expect(service.handleWebhook(undefined, update)).resolves.toBe('unauthorized');
    await expect(service.handleWebhook('forged', update)).resolves.toBe('unauthorized');
    expect(query).not.toHaveBeenCalled();
    await expect(service.handleWebhook(secret, update)).resolves.toBe('accepted');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('pairing_approve'), [
      'telegram',
      expect.any(String),
      '123',
      expect.any(String),
      NOW,
      null,
      'Елена',
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"callback_query_id":"callback-1"'),
      }),
    );
  });

  it('uses an inline button on /start and does not equate start with approval', async () => {
    const query = vi.fn(async () => ({ rows: [{ claimed: true }] }));
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _options?: RequestInit) =>
        new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );
    const service = new TelegramAuthService({ query } as unknown as pg.Pool, {
      botToken: TOKEN,
      botUsername: 'asa_test_bot',
      miniAppUrl: 'https://asa.example/telegram-login',
      encryptionKey: KEY.toString('base64url'),
      enabled: true,
      fetchImpl,
    });
    const secret = createHmac('sha256', KEY)
      .update('telegram-webhook:asa_test_bot:1')
      .digest('base64url');
    await service.handleWebhook(secret, {
      update_id: 2,
      message: {
        text: `/start pair_${PAIRING}`,
        from: { id: 123 },
        chat: { id: 123, type: 'private' },
      },
    });
    const message = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(message.chat_id).toBe('123');
    expect(message.reply_markup.inline_keyboard[0][0].callback_data).toBe(
      `approve:pair_${PAIRING}`,
    );
    expect(
      Buffer.byteLength(message.reply_markup.inline_keyboard[0][0].callback_data),
    ).toBeLessThanOrEqual(64);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('event_claim'), expect.any(Array));
  });

  it('releases delivery receipts on a provider failure and immediately reports the channel unavailable', async () => {
    const query = vi.fn(async () => ({ rows: [{ claimed: true }] }));
    const fetchImpl = vi.fn(async () => {
      throw new Error(`failure URL contains ${TOKEN}`);
    });
    const service = new TelegramAuthService({ query } as unknown as pg.Pool, {
      botToken: TOKEN,
      botUsername: 'asa_test_bot',
      miniAppUrl: 'https://asa.example/telegram-login',
      encryptionKey: KEY.toString('base64url'),
      enabled: true,
      fetchImpl,
    });
    const secret = createHmac('sha256', KEY)
      .update('telegram-webhook:asa_test_bot:1')
      .digest('base64url');
    await expect(
      service.handleWebhook(secret, {
        update_id: 3,
        message: { text: `/start pair_${PAIRING}`, from: { id: 123 } },
      }),
    ).rejects.toThrowError('telegram_service_unavailable');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('event_release'), expect.any(Array));
    await expect(service.availability()).resolves.toMatchObject({
      available: false,
      reason: 'delivery_unavailable',
      launchUrl: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
