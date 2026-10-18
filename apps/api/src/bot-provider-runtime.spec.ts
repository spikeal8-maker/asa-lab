import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { BotProviderRuntime, type RuntimeRow } from './bot-provider-runtime.js';
import type { BotAuthProvider } from './auth-provider-availability.js';

const KEY = Buffer.alloc(32, 5);
const TOKEN = '1001:test_only_telegram_token_000000';
const NOW = 1_800_000_000_000;

function body(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

function fixture(fetchImpl: typeof fetch, provider: BotAuthProvider = 'telegram', now = () => NOW) {
  return new BotProviderRuntime({} as pg.Pool, provider, {
    botToken: TOKEN,
    botUsername: 'asa_test_bot',
    miniAppUrl: 'https://asa.example/sign-in',
    enabled: true,
    encryptionKey: KEY.toString('base64url'),
    fetchImpl,
    now,
  });
}

function healthyTelegram(url: string | URL | Request): Response {
  return body({
    ok: true,
    result: String(url).endsWith('/getMe')
      ? { id: 1001, username: 'asa_test_bot', is_bot: true }
      : {
          url: 'https://asa.example/api/auth/telegram/webhook',
          allowed_updates: ['message', 'callback_query'],
          pending_update_count: 0,
        },
  });
}

describe('bounded provider runtime availability', () => {
  it('coalesces concurrent token/delivery probes and rechecks after the bounded cache expires', async () => {
    let now = NOW;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      await waiting;
      return healthyTelegram(url);
    });
    const runtime = fixture(fetchImpl, 'telegram', () => now);
    const requests = Array.from({ length: 20 }, () => runtime.availability());
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    release();
    const snapshots = await Promise.all(requests);
    expect(snapshots.every((value) => value.available && value.reason === 'ready')).toBe(true);
    await runtime.availability();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    now += 30_001;
    await runtime.availability();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('hides invalid tokens and webhook delivery failures even when featureEnabled is true', async () => {
    const invalid = fixture(vi.fn(async () => body({ ok: false }, 401)));
    await expect(invalid.availability()).resolves.toMatchObject({
      available: false,
      reason: 'invalid_token',
      launchUrl: null,
    });
    const missingDelivery = fixture(
      vi.fn(async (url) =>
        String(url).endsWith('/getMe')
          ? healthyTelegram(url)
          : body({ ok: true, result: { url: '', pending_update_count: 10 } }),
      ),
    );
    await expect(missingDelivery.adminConfig()).resolves.toMatchObject({
      featureEnabled: true,
      enabled: false,
      available: false,
      availabilityReason: 'delivery_unavailable',
    });
  });

  it('requires MAX callback delivery, not merely a working token or bot_started subscription', async () => {
    const runtime = fixture(
      vi.fn(async (url) =>
        body(
          String(url).endsWith('/me')
            ? { user_id: 1001, username: 'asa_test_bot', is_bot: true }
            : {
                subscriptions: [
                  {
                    url: 'https://asa.example/api/auth/max/webhook',
                    update_types: ['bot_started'],
                  },
                ],
              },
        ),
      ),
      'max',
    );
    await expect(runtime.availability()).resolves.toMatchObject({
      available: false,
      reason: 'delivery_unavailable',
    });
  });

  it('does not treat a token for another bot as available', async () => {
    const runtime = fixture(
      vi.fn(async (url) =>
        String(url).endsWith('/getMe')
          ? body({ ok: true, result: { id: 999, username: 'unrelated_bot', is_bot: true } })
          : healthyTelegram(url),
      ),
    );
    await expect(runtime.availability()).resolves.toMatchObject({
      available: false,
      reason: 'invalid_token',
    });
  });

  it('aborts both provider probes within one timeout and returns an unavailable snapshot', async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = options?.signal;
          if (!signal) throw new Error('bounded probe signal missing');
          signals.push(signal);
          signal.addEventListener('abort', () => reject(new Error('network timeout')), {
            once: true,
          });
        }),
    );
    const runtime = fixture(fetchImpl);
    const started = Date.now();
    await expect(runtime.availability()).resolves.toMatchObject({
      available: false,
      reason: 'unavailable',
      launchUrl: null,
    });
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('re-reads the configuration generation before returning a cached healthy result', async () => {
    const iv = Buffer.alloc(12, 4);
    const cipher = createCipheriv('aes-256-gcm', KEY, iv);
    let row: RuntimeRow = {
      enabled: true,
      bot_username: 'asa_test_bot',
      mini_app_url: 'https://asa.example/sign-in',
      token_ciphertext: Buffer.concat([cipher.update(TOKEN), cipher.final()]).toString('base64url'),
      token_iv: iv.toString('base64url'),
      token_auth_tag: cipher.getAuthTag().toString('base64url'),
      token_fingerprint: createHash('sha256').update(TOKEN).digest('hex').slice(0, 12),
      verified_bot_id: '1001',
      verified_bot_name: 'ASA Test',
      token_verified_at: new Date(NOW),
      configuration_version: 1,
      updated_at: new Date(NOW),
      webhook_url: 'https://asa.example/api/auth/telegram/webhook',
      webhook_verified_at: new Date(NOW),
      webhook_last_error: null,
    };
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes('runtime_config') ? [row] : [],
    }));
    const fetchImpl = vi.fn(async (url) => healthyTelegram(url));
    const runtime = new BotProviderRuntime({ query } as unknown as pg.Pool, 'telegram', {
      encryptionKey: KEY.toString('base64url'),
      fetchImpl,
      now: () => NOW,
    });
    await expect(runtime.availability()).resolves.toMatchObject({ available: true });
    row = { ...row, enabled: false, configuration_version: 2 };
    await expect(runtime.availability()).resolves.toMatchObject({
      available: false,
      reason: 'disabled',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('authorizes admin edits before token checks and sends the current webhook secret on configuration', async () => {
    let row: RuntimeRow = {
      enabled: false,
      bot_username: '',
      mini_app_url: '',
      token_ciphertext: null,
      token_iv: null,
      token_auth_tag: null,
      token_fingerprint: null,
      verified_bot_id: null,
      verified_bot_name: null,
      token_verified_at: null,
      configuration_version: 1,
      updated_at: null,
      webhook_url: null,
      webhook_verified_at: null,
      webhook_last_error: null,
    };
    const query = vi.fn(async (sql: string, args: unknown[] = []) => {
      if (sql.includes('admin_set_auth_provider_config'))
        row = {
          ...row,
          enabled: args[2] === true,
          bot_username: String(args[3]),
          mini_app_url: String(args[4]),
          token_ciphertext: String(args[6]),
          token_iv: String(args[7]),
          token_auth_tag: String(args[8]),
          token_fingerprint: String(args[9]),
          verified_bot_id: String(args[10]),
          verified_bot_name: String(args[11]),
          token_verified_at: new Date(NOW),
          configuration_version: 2,
        };
      if (sql.includes('webhook_status_set'))
        row = { ...row, webhook_url: String(args[2]), webhook_verified_at: new Date(NOW) };
      return { rows: [{ ...row, token_configured: row.token_ciphertext !== null }] };
    });
    const fetchImpl = vi.fn(async (url: string | URL | Request, _options?: RequestInit) => {
      expect(String(query.mock.calls[0]?.[0])).toContain('admin_get_auth_provider_config');
      return String(url).endsWith('/setWebhook')
        ? body({ ok: true, result: true })
        : healthyTelegram(url);
    });
    const runtime = new BotProviderRuntime({ query } as unknown as pg.Pool, 'telegram', {
      encryptionKey: KEY.toString('base64url'),
      fetchImpl,
      now: () => NOW,
    });
    const config = await runtime.updateAdminConfig(
      'admin-principal',
      {
        enabled: true,
        botUsername: 'asa_test_bot',
        miniAppUrl: 'https://asa.example/sign-in',
        botToken: TOKEN,
      },
      'request-id',
    );
    expect(config).toMatchObject({
      featureEnabled: true,
      available: true,
      configurationVersion: 2,
    });
    const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(row.token_iv!, 'base64url'));
    decipher.setAuthTag(Buffer.from(row.token_auth_tag!, 'base64url'));
    expect(
      Buffer.concat([
        decipher.update(Buffer.from(row.token_ciphertext!, 'base64url')),
        decipher.final(),
      ]).toString(),
    ).toBe(TOKEN);
    expect(JSON.stringify(query.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(config)).not.toContain(TOKEN);
    const webhook = fetchImpl.mock.calls.find((call) => String(call[0]).endsWith('/setWebhook'));
    const payload = JSON.parse(String(webhook?.[1]?.body));
    expect(payload.url).toBe('https://asa.example/api/auth/telegram/webhook');
    expect(payload.secret_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(payload.allowed_updates).toEqual(['message', 'callback_query']);
  });
});
