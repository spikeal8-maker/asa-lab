import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type pg from 'pg';
import {
  ProviderConfigurationError,
  type AuthProviderAvailability,
  type AuthProviderAvailabilityReason,
  type BotAuthProvider,
  type ProviderAdminConfig,
  type ProviderAdminUpdateInput,
} from './auth-provider-availability.js';
import { providerText } from './provider-init-data.js';
import {
  BotProviderTransport,
  asRecord,
  normalizedUsername,
  PROVIDER_TIMEOUT_MS,
  type VerifiedBot,
} from './bot-provider-transport.js';

const HEALTH_CACHE_MS = 30_000;

export interface BotProviderAuthOptions {
  readonly botToken?: string;
  readonly botUsername?: string;
  readonly miniAppUrl?: string;
  readonly enabled?: boolean;
  readonly now?: () => number;
  readonly encryptionKey?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface RuntimeRow {
  readonly enabled: boolean;
  readonly bot_username: string;
  readonly mini_app_url: string;
  readonly token_ciphertext: string | null;
  readonly token_iv: string | null;
  readonly token_auth_tag: string | null;
  readonly token_fingerprint: string | null;
  readonly verified_bot_id: string | null;
  readonly verified_bot_name: string | null;
  readonly token_verified_at: Date | string | null;
  readonly configuration_version: number | string;
  readonly updated_at: Date | string | null;
  readonly webhook_url: string | null;
  readonly webhook_verified_at: Date | string | null;
  readonly webhook_last_error: string | null;
}

function normalizedReturnUrl(value: unknown): string | null {
  const text = providerText(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function readEncryptionKey(value: string | undefined): Buffer | null {
  const text = value?.trim() ?? '';
  const bytes = /^[a-fA-F0-9]{64}$/.test(text)
    ? Buffer.from(text, 'hex')
    : /^[A-Za-z0-9_-]{43}$/.test(text)
      ? Buffer.from(text, 'base64url')
      : Buffer.alloc(0);
  return bytes.length === 32 ? bytes : null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function version(row: RuntimeRow): number {
  const value = Number(row.configuration_version);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

/** Database settings and bounded health probes are versioned together. */
export class BotProviderRuntime extends BotProviderTransport {
  readonly now: () => number;
  private readonly key: Buffer | null;
  private readonly staticRuntime: RuntimeRow | null;
  private healthCache: {
    key: string;
    until: number;
    value: AuthProviderAvailability;
  } | null = null;
  private healthFlight: {
    key: string;
    promise: Promise<AuthProviderAvailability>;
  } | null = null;
  private webhookFlight: Promise<void> | null = null;

  constructor(
    private readonly pool: pg.Pool,
    provider: BotAuthProvider,
    options: BotProviderAuthOptions = {},
  ) {
    super(provider, options.fetchImpl ?? fetch);
    this.now = options.now ?? Date.now;
    this.key = readEncryptionKey(
      options.encryptionKey ?? process.env['ASA_SETTINGS_ENCRYPTION_KEY'],
    );
    const hasStaticOptions =
      options.botToken !== undefined ||
      options.botUsername !== undefined ||
      options.miniAppUrl !== undefined ||
      options.enabled !== undefined;
    const token = providerText(options.botToken, 2048);
    const botUsername =
      normalizedUsername(
        options.botUsername ?? (provider === 'max' ? 'id231408577954_3_bot' : ''),
      ) ?? '';
    const miniAppUrl =
      normalizedReturnUrl(
        options.miniAppUrl ?? (provider === 'max' ? 'https://asa-lab.ru/max-login' : ''),
      ) ?? '';
    this.staticRuntime = hasStaticOptions
      ? {
          enabled: options.enabled ?? false,
          bot_username: botUsername,
          mini_app_url: miniAppUrl,
          token_ciphertext: token,
          token_iv: null,
          token_auth_tag: null,
          token_fingerprint: token
            ? createHash('sha256').update(token).digest('hex').slice(0, 12)
            : null,
          verified_bot_id: null,
          verified_bot_name: null,
          token_verified_at: null,
          configuration_version: 1,
          updated_at: null,
          webhook_url: null,
          webhook_verified_at: new Date(this.now()),
          webhook_last_error: null,
        }
      : null;
  }

  async runtime(): Promise<RuntimeRow> {
    if (this.staticRuntime) return this.staticRuntime;
    const result = await this.pool.query<RuntimeRow>(
      'SELECT * FROM auth_provider_runtime_config($1)',
      [this.provider],
    );
    const runtime = result.rows[0];
    if (!runtime) throw this.failure('service_unavailable');
    return runtime;
  }

  runtimeToken(runtime: RuntimeRow): string | null {
    if (!runtime.token_ciphertext) return null;
    if (runtime === this.staticRuntime) return providerText(runtime.token_ciphertext, 2048);
    if (!this.key || !runtime.token_iv || !runtime.token_auth_tag) return null;
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(runtime.token_iv, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(runtime.token_auth_tag, 'base64url'));
      const clear = Buffer.concat([
        decipher.update(Buffer.from(runtime.token_ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
      return providerText(clear, 2048);
    } catch {
      return null;
    }
  }

  private encryptToken(token: string): {
    ciphertext: string;
    iv: string;
    tag: string;
    fingerprint: string;
  } {
    if (!this.key) throw this.failure('encryption_key_missing');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    return {
      ciphertext: Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]).toString(
        'base64url',
      ),
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      fingerprint: createHash('sha256').update(token).digest('hex').slice(0, 12),
    };
  }

  launchUrl(runtime: RuntimeRow, payload = 'asa_login'): string | null {
    if (!normalizedUsername(runtime.bot_username)) return null;
    const host = this.provider === 'max' ? 'https://max.ru' : 'https://t.me';
    return `${host}/${encodeURIComponent(runtime.bot_username)}?start=${encodeURIComponent(payload)}`;
  }

  private webhookUrl(runtime: RuntimeRow): string | null {
    const returnUrl = normalizedReturnUrl(runtime.mini_app_url);
    return returnUrl ? `${new URL(returnUrl).origin}/api/auth/${this.provider}/webhook` : null;
  }

  webhookSecret(runtime: RuntimeRow): string | null {
    if (!this.key) return null;
    return createHmac('sha256', this.key)
      .update(
        `${this.provider}-webhook:${runtime.verified_bot_id ?? runtime.bot_username}:${version(runtime)}`,
      )
      .digest('base64url');
  }

  private async deliveryAvailable(
    runtime: RuntimeRow,
    token: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const expectedUrl = this.webhookUrl(runtime);
    if (
      !expectedUrl ||
      !this.webhookSecret(runtime) ||
      !runtime.webhook_verified_at ||
      runtime.webhook_last_error
    )
      return false;
    const value = asRecord(
      await this.request(
        token,
        this.provider === 'max' ? 'subscriptions' : 'getWebhookInfo',
        undefined,
        signal,
      ),
    );
    if (this.provider === 'max') {
      const subscriptions = value?.['subscriptions'];
      return (
        Array.isArray(subscriptions) &&
        subscriptions.some((subscription) => {
          const row = asRecord(subscription);
          const updates = row?.['update_types'];
          return (
            row?.['url'] === expectedUrl &&
            Array.isArray(updates) &&
            updates.includes('bot_started') &&
            updates.includes('message_callback')
          );
        })
      );
    }
    const updates = value?.['allowed_updates'];
    const requiredUpdates =
      !Array.isArray(updates) ||
      updates.length === 0 ||
      (updates.includes('message') && updates.includes('callback_query'));
    const hasRecentDeliveryError =
      Number(value?.['pending_update_count'] ?? 0) > 0 &&
      Number(value?.['last_error_date'] ?? 0) > Math.floor(this.now() / 1000) - 300;
    return value?.['url'] === expectedUrl && requiredUpdates && !hasRecentDeliveryError;
  }

  private async saveHealth(runtime: RuntimeRow, result: AuthProviderAvailability): Promise<void> {
    if (this.staticRuntime) return;
    await this.pool
      .query('SELECT auth_provider_health_set($1,$2,$3,$4)', [
        this.provider,
        version(runtime),
        result.available,
        result.reason,
      ])
      .catch(() => undefined);
  }

  async availability(force = false): Promise<AuthProviderAvailability> {
    let runtime: RuntimeRow;
    try {
      runtime = await this.runtime();
    } catch {
      return {
        id: this.provider,
        available: false,
        reason: 'unavailable',
        checkedAt: null,
        launchUrl: null,
      };
    }
    const token = this.runtimeToken(runtime);
    const base = (reason: AuthProviderAvailabilityReason): AuthProviderAvailability => ({
      id: this.provider,
      available: reason === 'ready',
      reason,
      checkedAt: new Date(this.now()).toISOString(),
      launchUrl: reason === 'ready' ? this.launchUrl(runtime) : null,
    });
    if (!runtime.enabled) return base('disabled');
    if (!token || !this.launchUrl(runtime) || !this.webhookUrl(runtime) || !this.key) {
      return base('not_configured');
    }
    const key = `${version(runtime)}:${runtime.token_fingerprint ?? ''}`;
    if (!force && this.healthCache?.key === key && this.healthCache.until > this.now()) {
      return this.healthCache.value;
    }
    if (this.healthFlight?.key === key) return this.healthFlight.promise;
    const promise = (async (): Promise<AuthProviderAvailability> => {
      let result: AuthProviderAvailability;
      try {
        const signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
        const [bot, delivery] = await Promise.all([
          this.verifyBotToken(token, signal),
          this.deliveryAvailable(runtime, token, signal),
        ]);
        const matches =
          bot.username.toLowerCase() === runtime.bot_username.toLowerCase() &&
          (!runtime.verified_bot_id || bot.id === runtime.verified_bot_id);
        result = base(!matches ? 'invalid_token' : delivery ? 'ready' : 'delivery_unavailable');
      } catch (failure) {
        result = base(
          failure instanceof ProviderConfigurationError && failure.code.endsWith('_token_invalid')
            ? 'invalid_token'
            : 'unavailable',
        );
      }
      this.healthCache = { key, until: this.now() + HEALTH_CACHE_MS, value: result };
      await this.saveHealth(runtime, result);
      return result;
    })();
    this.healthFlight = { key, promise };
    try {
      return await promise;
    } finally {
      if (this.healthFlight?.promise === promise) this.healthFlight = null;
    }
  }

  async config(): Promise<{ enabled: boolean; launchUrl: string | null }> {
    const readiness = await this.availability();
    return { enabled: readiness.available, launchUrl: readiness.launchUrl ?? null };
  }

  async adminConfig(actorPrincipalId?: string): Promise<ProviderAdminConfig> {
    let row: RuntimeRow;
    let tokenConfigured: boolean;
    if (actorPrincipalId && !this.staticRuntime) {
      const result = await this.pool.query<
        Omit<RuntimeRow, 'token_ciphertext' | 'token_iv' | 'token_auth_tag'> & {
          token_configured: boolean;
        }
      >('SELECT * FROM admin_get_auth_provider_config($1,$2)', [actorPrincipalId, this.provider]);
      const value = result.rows[0];
      if (!value) throw this.failure('service_unavailable');
      tokenConfigured = value.token_configured;
      row = { ...value, token_ciphertext: null, token_iv: null, token_auth_tag: null };
    } else {
      row = await this.runtime();
      tokenConfigured = row.token_ciphertext !== null;
    }
    const readiness = await this.availability();
    return {
      enabled: readiness.available,
      featureEnabled: row.enabled,
      available: readiness.available,
      availabilityReason: readiness.reason,
      healthCheckedAt: readiness.checkedAt,
      tokenConfigured,
      botUsername: row.bot_username || null,
      launchUrl: this.launchUrl(row),
      miniAppUrl: row.mini_app_url || null,
      encryptionReady: this.key !== null,
      tokenFingerprint: row.token_fingerprint,
      verifiedBotId: row.verified_bot_id,
      verifiedBotName: row.verified_bot_name,
      tokenVerifiedAt: iso(row.token_verified_at),
      configurationVersion: version(row),
      updatedAt: iso(row.updated_at),
      webhookUrl: row.webhook_url,
      webhookVerifiedAt: iso(row.webhook_verified_at),
      webhookLastError: row.webhook_last_error,
    };
  }

  async updateAdminConfig(
    actorPrincipalId: string,
    input: ProviderAdminUpdateInput,
    requestId: string,
  ): Promise<ProviderAdminConfig> {
    if (this.staticRuntime) throw this.failure('service_unavailable');
    // Authorize before token verification or any provider network operation.
    await this.pool.query('SELECT * FROM admin_get_auth_provider_config($1,$2)', [
      actorPrincipalId,
      this.provider,
    ]);
    const current = await this.runtime();
    const botUsername = normalizedUsername(input.botUsername);
    const miniAppUrl = normalizedReturnUrl(input.miniAppUrl);
    const suppliedToken = providerText(input.botToken, 2048);
    if ((input.enabled || suppliedToken) && (!botUsername || !miniAppUrl))
      throw this.failure('token_bot_mismatch');
    if (input.clearToken && input.enabled) throw this.failure('token_missing');
    if ((input.enabled || suppliedToken) && !this.key) throw this.failure('encryption_key_missing');
    const candidate = suppliedToken ?? this.runtimeToken(current);
    let bot: VerifiedBot | null = null;
    if (input.enabled || suppliedToken) {
      if (!candidate) throw this.failure('token_missing');
      bot = await this.verifyBotToken(candidate);
      if (bot.username.toLowerCase() !== botUsername?.toLowerCase())
        throw this.failure('token_bot_mismatch');
    }
    const encrypted = suppliedToken ? this.encryptToken(suppliedToken) : null;
    await this.pool.query(
      'SELECT admin_set_auth_provider_config($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
      [
        actorPrincipalId,
        this.provider,
        input.enabled,
        botUsername ?? (input.enabled ? '' : current.bot_username),
        miniAppUrl ?? (input.enabled ? '' : current.mini_app_url),
        input.clearToken ? 'clear' : suppliedToken ? 'replace' : 'keep',
        encrypted?.ciphertext ?? null,
        encrypted?.iv ?? null,
        encrypted?.tag ?? null,
        encrypted?.fingerprint ?? null,
        bot?.id ?? current.verified_bot_id,
        bot?.name ?? current.verified_bot_name,
        `Настройка ${this.provider === 'max' ? 'MAX' : 'Telegram'}: ${input.enabled ? 'подключение и проверка' : 'выключение'}`,
        requestId,
      ],
    );
    this.healthCache = null;
    if (input.enabled) await this.ensureWebhookSubscription(true).catch(() => undefined);
    await this.availability(true);
    return this.adminConfig(actorPrincipalId);
  }

  async ensureWebhookSubscription(force = false): Promise<void> {
    if (this.staticRuntime) return;
    if (this.webhookFlight) return this.webhookFlight;
    const promise = this.syncWebhookSubscription(force);
    this.webhookFlight = promise;
    try {
      await promise;
    } finally {
      if (this.webhookFlight === promise) this.webhookFlight = null;
    }
  }

  private async syncWebhookSubscription(force: boolean): Promise<void> {
    const runtime = await this.runtime();
    if (!runtime.enabled) return;
    const token = this.runtimeToken(runtime);
    const secret = this.webhookSecret(runtime);
    const url = this.webhookUrl(runtime);
    if (!token || !secret || !url) return;
    try {
      const result = await this.request(
        token,
        this.provider === 'max' ? 'subscriptions' : 'setWebhook',
        this.provider === 'max'
          ? { url, secret, update_types: ['bot_started', 'message_callback', 'message_created'] }
          : { url, secret_token: secret, allowed_updates: ['message', 'callback_query'] },
      );
      if (this.provider === 'max' ? asRecord(result)?.['success'] !== true : result !== true) {
        throw this.failure('service_unavailable');
      }
      await this.pool.query('SELECT auth_provider_webhook_status_set($1,$2,$3,true,NULL)', [
        this.provider,
        version(runtime),
        url,
      ]);
    } catch (failure) {
      const reason =
        failure instanceof ProviderConfigurationError && failure.code.endsWith('_token_invalid')
          ? 'invalid_token'
          : 'delivery_unavailable';
      await this.pool
        .query('SELECT auth_provider_webhook_status_set($1,$2,$3,false,$4)', [
          this.provider,
          version(runtime),
          url,
          reason,
        ])
        .catch(() => undefined);
      if (force) throw this.failure('service_unavailable');
    } finally {
      this.healthCache = null;
    }
  }

  async markUnavailable(
    runtime: RuntimeRow,
    reason: AuthProviderAvailabilityReason,
  ): Promise<void> {
    const value: AuthProviderAvailability = {
      id: this.provider,
      available: false,
      reason,
      checkedAt: new Date(this.now()).toISOString(),
      launchUrl: null,
    };
    this.healthCache = {
      key: `${version(runtime)}:${runtime.token_fingerprint ?? ''}`,
      until: this.now() + HEALTH_CACHE_MS,
      value,
    };
    await this.saveHealth(runtime, value);
  }
}
