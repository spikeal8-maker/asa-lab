import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type pg from 'pg';
import {
  ProviderConfigurationError,
  type AuthProviderAvailability,
  type AuthProviderAvailabilityReason,
  type BotAuthProvider,
  type ProviderAdminConfig,
  type ProviderAdminUpdateInput,
  type ProviderReadinessCheck,
  type ProviderReadinessDiagnostics,
} from './auth-provider-availability.js';
import {
  BotProviderIngress,
  providerWebhookUrl,
  type IngressProbeResponse,
} from './bot-provider-ingress.js';
import { resolveAdditionalWebOrigins } from './origin-policy.js';
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
  readonly ingress?: BotProviderIngress;
  readonly publicWebOrigins?: readonly string[];
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
  readonly native_confirmation_configuration_version: number | string | null;
  readonly native_confirmation_verified_at: Date | string | null;
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

interface ReadinessProbe {
  readonly reason: AuthProviderAvailabilityReason;
  readonly checkedAt: string | null;
  readonly token: ProviderReadinessCheck;
  readonly subscription: ProviderReadinessCheck;
  readonly ingress: ProviderReadinessCheck;
}
const notChecked = (): ProviderReadinessCheck => ({
  state: 'not_checked',
  reason: null,
  checkedAt: null,
});

/** Database settings and bounded health probes are versioned together. */
export class BotProviderRuntime extends BotProviderTransport {
  readonly now: () => number;
  private readonly key: Buffer | null;
  private readonly staticRuntime: RuntimeRow | null;
  private readonly ingress: BotProviderIngress;
  private readonly publicWebOrigins: readonly string[];
  private credentialCache: { key: string; until: number; value: ProviderReadinessCheck } | null =
    null;
  private credentialFlight: { key: string; promise: Promise<ProviderReadinessCheck> } | null = null;
  private healthCache: {
    key: string;
    until: number;
    value: ReadinessProbe;
    enforcementEligible?: boolean;
  } | null = null;
  private healthFlight: {
    key: string;
    promise: Promise<ReadinessProbe>;
  } | null = null;
  private webhookFlight: Promise<void> | null = null;

  constructor(
    private readonly pool: pg.Pool,
    provider: BotAuthProvider,
    options: BotProviderAuthOptions = {},
  ) {
    super(provider, options.fetchImpl ?? fetch);
    this.now = options.now ?? Date.now;
    this.ingress = options.ingress ?? new BotProviderIngress({ now: this.now });
    this.publicWebOrigins =
      options.publicWebOrigins ??
      resolveAdditionalWebOrigins(process.env['ASA_PUBLIC_WEB_ORIGINS']);
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
          native_confirmation_configuration_version: null,
          native_confirmation_verified_at: null,
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
    return (
      providerWebhookUrl(runtime.mini_app_url, this.provider, this.publicWebOrigins)?.toString() ??
      null
    );
  }

  async answerIngressProbe(
    suppliedSignature: unknown,
    body: unknown,
  ): Promise<IngressProbeResponse | 'unauthorized' | null> {
    if (!this.ingress.accepts(body)) return null;
    const runtime = await this.runtime();
    const url = this.webhookUrl(runtime);
    if (!runtime.enabled || !this.key || !url) return 'unauthorized';
    return (
      this.ingress.answer(
        { provider: this.provider, configurationVersion: version(runtime), url, key: this.key },
        suppliedSignature,
        body,
      ) ?? 'unauthorized'
    );
  }

  webhookSecret(runtime: RuntimeRow): string | null {
    if (!this.key) return null;
    return createHmac('sha256', this.key)
      .update(
        `${this.provider}-webhook:${runtime.verified_bot_id ?? runtime.bot_username}:${version(runtime)}`,
      )
      .digest('base64url');
  }

  private checkResult(reason: ProviderReadinessCheck['reason']): ProviderReadinessCheck {
    return {
      state: reason === null ? 'ok' : 'failed',
      reason,
      checkedAt: new Date(this.now()).toISOString(),
    };
  }

  private runtimeKey(runtime: RuntimeRow): string {
    return `${version(runtime)}:${runtime.token_fingerprint ?? ''}`;
  }

  /** Raw signed Mini App authentication has no dependency on webhook delivery. */
  async credentialReadiness(
    runtime: RuntimeRow,
    force = false,
    signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  ): Promise<ProviderReadinessCheck> {
    const token = this.runtimeToken(runtime);
    if (!runtime.enabled) return this.checkResult('disabled');
    if (!token || !this.launchUrl(runtime)) return this.checkResult('not_configured');
    const key = this.runtimeKey(runtime);
    if (!force && this.credentialCache?.key === key && this.credentialCache.until > this.now())
      return this.credentialCache.value;
    if (this.credentialFlight?.key === key) return this.credentialFlight.promise;
    const promise = (async () => {
      let result: ProviderReadinessCheck;
      try {
        const bot = await this.verifyBotToken(token, signal);
        result = this.checkResult(
          bot.username.toLowerCase() === runtime.bot_username.toLowerCase() &&
            (!runtime.verified_bot_id || bot.id === runtime.verified_bot_id)
            ? null
            : 'bot_mismatch',
        );
      } catch (failure) {
        result = this.checkResult(
          failure instanceof ProviderConfigurationError && failure.code.endsWith('_token_invalid')
            ? 'invalid_token'
            : 'unavailable',
        );
      }
      this.credentialCache = { key, until: this.now() + HEALTH_CACHE_MS, value: result };
      return result;
    })();
    this.credentialFlight = { key, promise };
    try {
      return await promise;
    } finally {
      if (this.credentialFlight?.promise === promise) this.credentialFlight = null;
    }
  }

  private async subscriptionCheck(
    runtime: RuntimeRow,
    token: string,
    signal: AbortSignal,
  ): Promise<ProviderReadinessCheck> {
    const expectedUrl = this.webhookUrl(runtime);
    if (!expectedUrl || !this.webhookSecret(runtime)) return this.checkResult('not_configured');
    if (!runtime.webhook_verified_at || runtime.webhook_last_error)
      return this.checkResult('subscription_missing');
    try {
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
        if (!Array.isArray(subscriptions) || subscriptions.length === 0)
          return this.checkResult('subscription_missing');
        const valid =
          subscriptions.length === 1 &&
          subscriptions.some((subscription) => {
            const row = asRecord(subscription);
            const updates = row?.['update_types'];
            return (
              row?.['url'] === expectedUrl &&
              Array.isArray(updates) &&
              updates.includes('bot_started') &&
              updates.includes('message_callback')
            );
          });
        return this.checkResult(valid ? null : 'subscription_mismatch');
      }
      if (!value?.['url']) return this.checkResult('subscription_missing');
      const updates = value['allowed_updates'];
      const requiredUpdates =
        !Array.isArray(updates) ||
        updates.length === 0 ||
        (updates.includes('message') && updates.includes('callback_query'));
      const recentError =
        Number(value['pending_update_count'] ?? 0) > 0 &&
        Number(value['last_error_date'] ?? 0) > Math.floor(this.now() / 1000) - 300;
      return this.checkResult(
        value['url'] === expectedUrl && requiredUpdates && !recentError
          ? null
          : 'subscription_mismatch',
      );
    } catch {
      return this.checkResult('unavailable');
    }
  }

  private nativeConfirmation(
    runtime: RuntimeRow,
  ): ProviderReadinessDiagnostics['nativeConfirmation'] {
    const received = Number(runtime.native_confirmation_configuration_version);
    const verifiedAt = iso(runtime.native_confirmation_verified_at);
    return {
      current: runtime.enabled && received === version(runtime) && verifiedAt !== null,
      configurationVersion: Number.isSafeInteger(received) && received > 0 ? received : null,
      verifiedAt,
    };
  }

  private availabilityFrom(runtime: RuntimeRow, probe: ReadinessProbe): AuthProviderAvailability {
    const available = probe.reason === 'ready';
    const enforcementEligible = available && this.nativeConfirmation(runtime).current;
    return {
      id: this.provider,
      available,
      reason: probe.reason,
      checkedAt: probe.checkedAt,
      launchUrl: available ? this.launchUrl(runtime) : null,
      enforcementEligible,
      enforcementReason: !available
        ? probe.reason
        : enforcementEligible
          ? 'ready'
          : 'delivery_unverified',
    };
  }

  private async saveHealth(runtime: RuntimeRow, result: AuthProviderAvailability): Promise<void> {
    if (this.staticRuntime) return;
    await this.pool
      .query('SELECT auth_provider_health_set($1,$2,$3,$4)', [
        this.provider,
        version(runtime),
        result.enforcementEligible,
        result.available && !result.enforcementEligible ? 'delivery_unavailable' : result.reason,
      ])
      .catch(() => undefined);
  }

  private async probe(runtime: RuntimeRow, token: string, force: boolean): Promise<ReadinessProbe> {
    const signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
    const [credential, subscription, ingress] = await Promise.all([
      this.credentialReadiness(runtime, force, signal),
      this.subscriptionCheck(runtime, token, signal),
      this.ingress.check(
        {
          provider: this.provider,
          configurationVersion: version(runtime),
          url: this.webhookUrl(runtime)!,
          key: this.key!,
        },
        signal,
      ),
    ]);
    const reason =
      credential.state !== 'ok'
        ? credential.reason === 'invalid_token' || credential.reason === 'bot_mismatch'
          ? 'invalid_token'
          : 'unavailable'
        : subscription.state !== 'ok' || ingress.state !== 'ok'
          ? 'delivery_unavailable'
          : 'ready';
    return {
      reason,
      checkedAt: new Date(this.now()).toISOString(),
      token: credential,
      subscription,
      ingress,
    };
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
        enforcementEligible: false,
        enforcementReason: 'unavailable',
      };
    }
    const token = this.runtimeToken(runtime) ?? '';
    const key = this.runtimeKey(runtime);
    const localFailure = !runtime.enabled
      ? 'disabled'
      : !token || !this.launchUrl(runtime) || !this.key
        ? 'not_configured'
        : !this.webhookUrl(runtime)
          ? 'delivery_unavailable'
          : null;
    let probe: ReadinessProbe;
    if (localFailure) {
      probe =
        !force &&
        this.healthCache?.key === key &&
        this.healthCache.until > this.now() &&
        this.healthCache.value.reason === localFailure
          ? this.healthCache.value
          : {
              reason: localFailure,
              checkedAt: new Date(this.now()).toISOString(),
              token:
                localFailure === 'delivery_unavailable'
                  ? notChecked()
                  : this.checkResult(localFailure),
              subscription: notChecked(),
              ingress:
                localFailure === 'delivery_unavailable'
                  ? this.checkResult('ingress_invalid_url')
                  : notChecked(),
            };
    } else if (!force && this.healthCache?.key === key && this.healthCache.until > this.now()) {
      probe = this.healthCache.value;
    } else {
      if (!this.healthFlight || this.healthFlight.key !== key)
        this.healthFlight = { key, promise: this.probe(runtime, token, force) };
      const flight = this.healthFlight;
      try {
        probe = await flight.promise;
      } finally {
        if (this.healthFlight === flight) this.healthFlight = null;
      }
      // A configuration write during a probe invalidates all of its evidence.
      const current = await this.runtime();
      if (
        !current.enabled ||
        this.runtimeKey(current) !== key ||
        this.runtimeToken(current) !== token
      ) {
        return {
          id: this.provider,
          available: false,
          reason: 'unavailable',
          checkedAt: null,
          launchUrl: null,
          enforcementEligible: false,
          enforcementReason: 'unavailable',
        };
      }
      runtime = current;
    }
    const result = this.availabilityFrom(runtime, probe);
    const previous = this.healthCache;
    const publish =
      force ||
      previous?.key !== key ||
      previous.value !== probe ||
      previous.enforcementEligible !== result.enforcementEligible;
    this.healthCache = {
      key,
      until:
        previous?.key === key && previous.value === probe
          ? previous.until
          : this.now() + HEALTH_CACHE_MS,
      value: probe,
      enforcementEligible: result.enforcementEligible,
    };
    if (publish) await this.saveHealth(runtime, result);
    return result;
  }

  async config(): Promise<{ enabled: boolean; launchUrl: string | null }> {
    const runtime = await this.runtime();
    const credential = await this.credentialReadiness(runtime);
    return {
      enabled: credential.state === 'ok',
      launchUrl: credential.state === 'ok' ? this.launchUrl(runtime) : null,
    };
  }

  /** A destructive unlink requires current native proof and an uncached transport check. */
  async availableConfigurationVersion(): Promise<number | null> {
    const before = await this.runtime();
    if (!(await this.availability(true)).enforcementEligible) return null;
    const after = await this.runtime();
    const generation = Number(before.configuration_version);
    return after.enabled &&
      Number.isSafeInteger(generation) &&
      generation > 0 &&
      generation === Number(after.configuration_version) &&
      before.token_fingerprint === after.token_fingerprint
      ? generation
      : null;
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
    const probe = this.healthCache?.key === this.runtimeKey(row) ? this.healthCache.value : null;
    return {
      enabled: readiness.available,
      featureEnabled: row.enabled,
      available: readiness.available,
      availabilityReason: readiness.reason,
      healthCheckedAt: readiness.checkedAt,
      enforcementEligible: readiness.enforcementEligible,
      enforcementReason: readiness.enforcementReason,
      diagnostics: {
        token: probe?.token ?? notChecked(),
        subscription: probe?.subscription ?? notChecked(),
        ingress: probe?.ingress ?? notChecked(),
        nativeConfirmation: this.nativeConfirmation(row),
      },
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

  async checkAdminConfig(actorPrincipalId: string): Promise<ProviderAdminConfig> {
    // RBAC must run before external I/O, even when this method is called without HTTP.
    await this.pool.query('SELECT * FROM admin_get_auth_provider_config($1,$2)', [
      actorPrincipalId,
      this.provider,
    ]);
    await this.availability(true);
    return this.adminConfig(actorPrincipalId);
  }

  private async assertWebhookOwnership(
    token: string,
    expectedUrl: string,
    signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  ): Promise<void> {
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
      if (!Array.isArray(subscriptions)) throw this.failure('service_unavailable');
      if (subscriptions.some((item) => asRecord(item)?.['url'] !== expectedUrl))
        throw this.failure('webhook_conflict');
    } else {
      if (typeof value?.['url'] !== 'string') throw this.failure('service_unavailable');
      if (value['url'] !== '' && value['url'] !== expectedUrl)
        throw this.failure('webhook_conflict');
    }
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
    const botUsername = input.enabled
      ? normalizedUsername(input.botUsername)
      : current.bot_username;
    const miniAppUrl = input.enabled ? normalizedReturnUrl(input.miniAppUrl) : current.mini_app_url;
    // Disabling is an unconditional recovery operation. It neither rotates nor verifies a token.
    const suppliedToken = input.enabled ? providerText(input.botToken, 2048) : null;
    if (input.enabled && !botUsername) throw this.failure('token_bot_mismatch');
    const targetUrl = miniAppUrl
      ? providerWebhookUrl(miniAppUrl, this.provider, this.publicWebOrigins)
      : null;
    if (input.enabled && !targetUrl) throw this.failure('webhook_url_invalid');
    if (input.clearToken && input.enabled) throw this.failure('token_missing');
    if (input.enabled && !this.key) throw this.failure('encryption_key_missing');
    const candidate = suppliedToken ?? this.runtimeToken(current);
    let bot: VerifiedBot | null = null;
    if (input.enabled) {
      if (!candidate) throw this.failure('token_missing');
      const signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
      bot = await this.verifyBotToken(candidate, signal);
      if (bot.username.toLowerCase() !== botUsername?.toLowerCase())
        throw this.failure('token_bot_mismatch');
      // A foreign active webhook must leave the previous local configuration intact.
      await this.assertWebhookOwnership(candidate, targetUrl!.toString(), signal);
    }
    const encrypted = suppliedToken ? this.encryptToken(suppliedToken) : null;
    await this.pool.query(
      'SELECT admin_set_auth_provider_config($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
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
        version(current),
      ],
    );
    this.healthCache = null;
    this.credentialCache = null;
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
      await this.assertWebhookOwnership(token, url);
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
}
