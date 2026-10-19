import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import {
  AGE_POLICY_VERSION,
  createSessionToken,
  hashPasswordAsync,
  hashSessionToken,
  isEligibleAdult,
  isValidCountryCode,
  isValidDisplayName,
  isValidEmail,
  isValidPassword,
  isValidUsername,
  normalizeEmail,
  parseBirthDate,
  routeForMinor,
  SESSION_TTL_HOURS,
} from '@asa-lab/identity';
import {
  ProviderInitDataError,
  ProviderOperationError,
  type AuthProviderAvailability,
  type BotAuthProvider,
  type ProviderAccountStatus,
  type ProviderAdminConfig,
  type ProviderAdminUpdateInput,
  type ProviderLinkResult,
  type ProviderPairingResult,
  type ProviderRegisterResult,
  type ProviderRegistrationInput,
  type ProviderSignInResult,
  type ValidatedProviderIdentity,
  type ProviderOperationErrorCode,
} from './auth-provider-availability.js';
import { providerText, validateProviderInitData } from './provider-init-data.js';
import { BotProviderRuntime, type BotProviderAuthOptions } from './bot-provider-runtime.js';
import { BotProviderWebhook } from './bot-provider-webhook.js';

export type { BotProviderAuthOptions } from './bot-provider-runtime.js';

const PAIRING_TTL_MINUTES = 10;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface NormalizedRegistration {
  readonly email: string;
  readonly password: string;
  readonly username: string;
  readonly displayName: string;
  readonly birthDate: string;
  readonly country: string;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

const OPERATION_ERRORS = new Set<string>([
  'last_sign_in_method',
  'identity_revoked',
  'identity_taken',
  'account_already_linked',
  'account_suspended',
]);

/** Account operations consume provider proof through atomic database functions. */
export class BotProviderAuthService {
  private readonly runtimeProvider: BotProviderRuntime;
  private readonly alternativeRuntime: BotProviderRuntime;
  private readonly webhook: BotProviderWebhook;

  constructor(
    private readonly pool: pg.Pool,
    readonly provider: BotAuthProvider,
    options: BotProviderAuthOptions = {},
  ) {
    this.runtimeProvider = new BotProviderRuntime(pool, provider, options);
    this.alternativeRuntime = new BotProviderRuntime(
      pool,
      provider === 'max' ? 'telegram' : 'max',
      {
        encryptionKey: options.encryptionKey ?? process.env['ASA_SETTINGS_ENCRYPTION_KEY'] ?? '',
        fetchImpl: options.fetchImpl ?? fetch,
        now: options.now ?? Date.now,
        ...(options.ingress ? { ingress: options.ingress } : {}),
        ...(options.publicWebOrigins ? { publicWebOrigins: options.publicWebOrigins } : {}),
      },
    );
    this.webhook = new BotProviderWebhook(pool, this.runtimeProvider);
  }

  availability(force = false): Promise<AuthProviderAvailability> {
    return this.runtimeProvider.availability(force);
  }

  config(): Promise<{ enabled: boolean; launchUrl: string | null }> {
    return this.runtimeProvider.config();
  }

  adminConfig(actorPrincipalId?: string): Promise<ProviderAdminConfig> {
    return this.runtimeProvider.adminConfig(actorPrincipalId);
  }

  checkAdminConfig(actorPrincipalId: string): Promise<ProviderAdminConfig> {
    return this.runtimeProvider.checkAdminConfig(actorPrincipalId);
  }

  updateAdminConfig(
    actorPrincipalId: string,
    input: ProviderAdminUpdateInput,
    requestId: string,
  ): Promise<ProviderAdminConfig> {
    return this.runtimeProvider.updateAdminConfig(actorPrincipalId, input, requestId);
  }

  ensureWebhookSubscription(force = false): Promise<void> {
    return this.runtimeProvider.ensureWebhookSubscription(force);
  }

  handleWebhook(suppliedSecret: unknown, body: unknown) {
    return this.webhook.handleWebhook(suppliedSecret, body);
  }

  private async identity(
    rawInitData: unknown,
  ): Promise<ValidatedProviderIdentity & { readonly configurationVersion: number }> {
    const runtime = await this.runtimeProvider.runtime();
    const credential = await this.runtimeProvider.credentialReadiness(runtime);
    const token = this.runtimeProvider.runtimeToken(runtime);
    const configurationVersion = Number(runtime.configuration_version);
    if (
      credential.state !== 'ok' ||
      !runtime.enabled ||
      !token ||
      !Number.isSafeInteger(configurationVersion) ||
      configurationVersion < 1
    ) {
      throw new ProviderInitDataError(`${this.provider}_auth_disabled`);
    }
    return {
      ...validateProviderInitData(rawInitData, token, this.provider, this.runtimeProvider.now()),
      configurationVersion,
    };
  }

  async signIn(rawInitData: unknown, userAgentSummary?: string): Promise<ProviderSignInResult> {
    const identity = await this.identity(rawInitData);
    const token = createSessionToken();
    const response = await this.pool.query(
      'SELECT result, account_id FROM auth_provider_login($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        this.provider,
        identity.subject,
        identity.queryId,
        identity.authDate,
        identity.username,
        identity.displayName,
        hashSessionToken(token),
        SESSION_TTL_HOURS,
        userAgentSummary ?? null,
        identity.configurationVersion,
      ],
    );
    const status = String(
      response.rows[0]?.result ?? 'unavailable',
    ) as ProviderSignInResult['status'];
    const accountId = String(response.rows[0]?.account_id ?? '');
    return status === 'authenticated' && accountId
      ? { status, token, accountId }
      : { status: status === 'authenticated' ? 'unavailable' : status };
  }

  async link(accountId: string, rawInitData: unknown): Promise<ProviderLinkResult> {
    const identity = await this.identity(rawInitData);
    const response = await this.pool.query<{ result: ProviderLinkResult['status'] }>(
      'SELECT auth_provider_link($1,$2,$3,$4,$5,$6,$7,$8) AS result',
      [
        this.provider,
        accountId,
        identity.subject,
        identity.queryId,
        identity.authDate,
        identity.username,
        identity.displayName,
        identity.configurationVersion,
      ],
    );
    return { status: response.rows[0]?.result ?? 'unavailable' };
  }

  private registration(
    input: ProviderRegistrationInput,
  ): { input: NormalizedRegistration } | { error: ProviderRegisterResult } {
    const invalid = (message: string) => ({
      error: { status: 'validation_error' as const, message },
    });
    const email = typeof input.email === 'string' ? normalizeEmail(input.email) : input.email;
    if (!isValidEmail(email)) return invalid('Введите корректный email.');
    if (!isValidPassword(input.password))
      return invalid('Пароль должен быть не короче 10 символов.');
    if (!isValidUsername(input.username))
      return invalid(
        'Имя пользователя: 3–40 символов, латиница, цифры, точка, дефис или подчёркивание.',
      );
    if (!isValidDisplayName(input.displayName))
      return invalid('Имя не должно быть длиннее 255 символов.');
    if (!isValidCountryCode(input.country)) return invalid('Укажите страну.');
    const birthDate = parseBirthDate(input.birthDate);
    if (!birthDate) return invalid('Укажите дату рождения.');
    if (!isEligibleAdult(birthDate))
      return {
        error: {
          status: 'age_routed',
          message: 'Личный аккаунт доступен с 18 лет — ученики заходят по коду класса.',
          routes: routeForMinor(),
        },
      };
    const username = (input.username as string).trim().toLowerCase();
    return {
      input: {
        email,
        password: input.password as string,
        username,
        displayName: providerText(input.displayName, 255) ?? username,
        birthDate: input.birthDate as string,
        country: (input.country as string).trim().toUpperCase(),
      },
    };
  }

  private registrationFailure(failure: unknown): ProviderRegisterResult | null {
    const problem = failure as { code?: string; constraint?: string };
    if (problem?.code !== '23505') return null;
    const status = problem.constraint?.includes('profiles_username')
      ? 'username_taken'
      : problem.constraint?.includes('external_auth_assertions')
        ? 'assertion_replayed'
        : problem.constraint?.includes('external_identities')
          ? 'identity_taken'
          : 'email_taken';
    return { status };
  }

  async register(
    rawInitData: unknown,
    input: ProviderRegistrationInput,
  ): Promise<ProviderRegisterResult> {
    const identity = await this.identity(rawInitData);
    const parsed = this.registration(input);
    if ('error' in parsed) return parsed.error;
    const profile = parsed.input;
    const token = createSessionToken();
    try {
      const result = await this.pool.query(
        'SELECT result, account_id FROM auth_provider_register($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12,$13,$14,$15,$16)',
        [
          this.provider,
          identity.subject,
          identity.queryId,
          identity.authDate,
          identity.username,
          identity.displayName,
          profile.email,
          await hashPasswordAsync(profile.password),
          profile.displayName,
          profile.username,
          profile.birthDate,
          profile.country,
          AGE_POLICY_VERSION,
          hashSessionToken(token),
          SESSION_TTL_HOURS,
          identity.configurationVersion,
        ],
      );
      const status = String(
        result.rows[0]?.result ?? 'unavailable',
      ) as ProviderRegisterResult['status'];
      const accountId = String(result.rows[0]?.account_id ?? '');
      return status === 'authenticated' && accountId
        ? { status, token, accountId }
        : { status: status === 'authenticated' ? 'unavailable' : status };
    } catch (failure) {
      const result = this.registrationFailure(failure);
      if (result) return result;
      throw failure;
    }
  }

  async startPairing(
    requestedAccountId?: string,
    purpose: 'login' | 'register' | 'link' = requestedAccountId ? 'link' : 'login',
  ): Promise<{ pairingToken: string; browserNonce: string; launchUrl: string; expiresAt: string }> {
    if (!(await this.availability()).available)
      throw new ProviderInitDataError(`${this.provider}_auth_disabled`);
    const runtime = await this.runtimeProvider.runtime();
    const pairingToken = randomBytes(32).toString('base64url');
    const browserNonce = randomBytes(32).toString('base64url');
    const launchUrl = this.runtimeProvider.launchUrl(runtime, `pair_${pairingToken}`);
    if (!runtime.enabled || !launchUrl)
      throw new ProviderInitDataError(`${this.provider}_auth_disabled`);
    const result = await this.pool.query<{ created: boolean }>(
      'SELECT auth_provider_pairing_start($1,$2,$3,$4,$5,$6) AS created',
      [
        this.provider,
        hashSessionToken(pairingToken),
        hashSessionToken(browserNonce),
        PAIRING_TTL_MINUTES,
        requestedAccountId ?? null,
        purpose,
      ],
    );
    if (!result.rows[0]?.created) throw this.runtimeProvider.failure('service_unavailable');
    return {
      pairingToken,
      browserNonce,
      launchUrl,
      expiresAt: new Date(this.runtimeProvider.now() + PAIRING_TTL_MINUTES * 60_000).toISOString(),
    };
  }

  async consumePairing(
    pairingToken: unknown,
    userAgentSummary?: string,
    browserNonce?: string,
    currentAccountId?: string,
  ): Promise<ProviderPairingResult> {
    if (
      typeof pairingToken !== 'string' ||
      !CAPABILITY_PATTERN.test(pairingToken) ||
      typeof browserNonce !== 'string' ||
      !CAPABILITY_PATTERN.test(browserNonce)
    )
      return { status: 'invalid' };
    if (!(await this.availability()).available) return { status: 'unavailable' };
    const token = createSessionToken();
    const result = await this.pool.query(
      'SELECT result, account_id, display_name, username FROM auth_provider_pairing_consume($1,$2,$3,$4,$5,$6,$7)',
      [
        this.provider,
        hashSessionToken(pairingToken),
        hashSessionToken(browserNonce),
        hashSessionToken(token),
        SESSION_TTL_HOURS,
        userAgentSummary ?? null,
        currentAccountId ?? null,
      ],
    );
    const row = result.rows[0];
    const status = String(row?.result ?? 'invalid');
    if (OPERATION_ERRORS.has(status))
      throw new ProviderOperationError(status as ProviderOperationErrorCode);
    if (status === 'assertion_replayed') return { status: 'invalid' };
    const accountId = String(row?.account_id ?? '');
    if (status === 'authenticated' && accountId) return { status, token, accountId };
    if (status === 'linked' && accountId) return { status, accountId };
    if (status === 'registration_required')
      return {
        status,
        profile: {
          displayName: providerText(row?.display_name, 255),
          username: providerText(row?.username, 64),
        },
      };
    return {
      status: ['pending', 'expired', 'consumed', 'unavailable'].includes(status)
        ? (status as 'pending' | 'expired' | 'consumed' | 'unavailable')
        : 'invalid',
    };
  }

  registerPairing(
    pairingToken: unknown,
    browserNonce: string | undefined,
    input: ProviderRegistrationInput,
    userAgentSummary?: string,
  ): Promise<ProviderRegisterResult>;
  async registerPairing(
    pairingToken: unknown,
    browserNonce: string | undefined,
    input: ProviderRegistrationInput,
  ): Promise<ProviderRegisterResult> {
    if (
      typeof pairingToken !== 'string' ||
      !CAPABILITY_PATTERN.test(pairingToken) ||
      typeof browserNonce !== 'string' ||
      !CAPABILITY_PATTERN.test(browserNonce)
    )
      return { status: 'unavailable' };
    if (!(await this.availability()).available) return { status: 'unavailable' };
    const parsed = this.registration(input);
    if ('error' in parsed) return parsed.error;
    const profile = parsed.input;
    const token = createSessionToken();
    try {
      const result = await this.pool.query(
        'SELECT result, account_id FROM auth_provider_pairing_register($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12)',
        [
          this.provider,
          hashSessionToken(pairingToken),
          hashSessionToken(browserNonce),
          profile.email,
          await hashPasswordAsync(profile.password),
          profile.displayName,
          profile.username,
          profile.birthDate,
          profile.country,
          AGE_POLICY_VERSION,
          hashSessionToken(token),
          SESSION_TTL_HOURS,
        ],
      );
      const status = String(
        result.rows[0]?.result ?? 'unavailable',
      ) as ProviderRegisterResult['status'];
      const accountId = String(result.rows[0]?.account_id ?? '');
      return status === 'authenticated' && accountId
        ? { status, token, accountId }
        : { status: status === 'authenticated' ? 'unavailable' : status };
    } catch (failure) {
      const result = this.registrationFailure(failure);
      if (result) return result;
      throw failure;
    }
  }

  async status(accountId: string): Promise<ProviderAccountStatus | null> {
    const result = await this.pool.query('SELECT * FROM auth_provider_status($1,$2)', [
      this.provider,
      accountId,
    ]);
    const row = result.rows[0];
    return row
      ? {
          linked: row.linked === true,
          verifiedAt: iso(row.verified_at),
          firstAuthenticatedAt: iso(row.first_authenticated_at),
          promptDue: row.prompt_due === true,
          promptDismissedUntil: iso(row.prompt_dismissed_until),
          canUnlink: row.can_unlink === true,
        }
      : null;
  }

  async dismissPrompt(accountId: string): Promise<string | null> {
    const result = await this.pool.query('SELECT auth_max_dismiss_prompt($1) AS dismissed_until', [
      accountId,
    ]);
    return iso(result.rows[0]?.dismissed_until);
  }

  async unlink(accountId: string, actorPrincipalId: string): Promise<boolean> {
    const alternativeVersion = await this.alternativeRuntime.availableConfigurationVersion();
    const result = await this.pool.query<{ result: string }>(
      "SELECT auth_provider_revoke($1,$2,$3,'self','self-service unlink',NULL,$4) AS result",
      [this.provider, accountId, actorPrincipalId, alternativeVersion],
    );
    const status = result.rows[0]?.result;
    if (status && OPERATION_ERRORS.has(status))
      throw new ProviderOperationError(status as ProviderOperationErrorCode);
    return status === 'unlinked';
  }
}
