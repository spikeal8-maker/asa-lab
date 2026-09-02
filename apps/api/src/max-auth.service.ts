import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
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
  isValidUsername,
  normalizeEmail,
  parseBirthDate,
  routeForMinor,
  SESSION_TTL_HOURS,
  type MinorRoute,
} from '@asa-lab/identity';

const MAX_INIT_DATA_LIMIT = 16 * 1024;
const MAX_INIT_DATA_MAX_AGE_SECONDS = 60 * 60;
const MAX_INIT_DATA_FUTURE_SKEW_SECONDS = 60;
const MAX_PARAMETER_LIMIT = 32;
const MAX_PAIRING_TTL_MINUTES = 10;
const MAX_START_PARAM_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

export type MaxInitDataErrorCode =
  'max_auth_disabled' | 'max_init_data_invalid' | 'max_init_data_expired';

export class MaxInitDataError extends Error {
  constructor(readonly code: MaxInitDataErrorCode) {
    super(code);
    this.name = 'MaxInitDataError';
  }
}

export interface ValidatedMaxIdentity {
  readonly subject: string;
  readonly queryId: string;
  readonly authDate: number;
  readonly username: string | null;
  readonly displayName: string | null;
  readonly startParam: string | null;
}

export type MaxSignInResult =
  | { readonly status: 'authenticated'; readonly token: string; readonly accountId: string }
  | {
      readonly status: 'link_required' | 'assertion_replayed' | 'account_suspended' | 'unavailable';
    };

export type MaxLinkResult =
  | { readonly status: 'linked' | 'already_linked' }
  | {
      readonly status:
        | 'identity_taken'
        | 'account_already_linked'
        | 'assertion_replayed'
        | 'account_suspended'
        | 'unavailable';
    };

export interface MaxAccountStatus {
  readonly linked: boolean;
  readonly verifiedAt: string | null;
  readonly firstAuthenticatedAt: string | null;
  readonly promptDue: boolean;
  readonly promptDismissedUntil: string | null;
}

interface MaxAuthOptions {
  readonly botToken?: string;
  readonly botUsername?: string;
  readonly miniAppUrl?: string;
  readonly enabled?: boolean;
  readonly now?: () => number;
  readonly encryptionKey?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface MaxAdminConfig {
  readonly enabled: boolean;
  readonly featureEnabled: boolean;
  readonly tokenConfigured: boolean;
  readonly botUsername: string | null;
  readonly launchUrl: string | null;
  readonly miniAppUrl: string | null;
  readonly encryptionReady: boolean;
  readonly tokenFingerprint: string | null;
  readonly verifiedBotId: string | null;
  readonly verifiedBotName: string | null;
  readonly tokenVerifiedAt: string | null;
  readonly configurationVersion: number;
  readonly updatedAt: string | null;
  readonly webhookUrl: string | null;
  readonly webhookVerifiedAt: string | null;
  readonly webhookLastError: string | null;
}

export interface MaxAdminUpdateInput {
  readonly enabled: boolean;
  readonly botUsername: string;
  readonly miniAppUrl: string;
  readonly botToken?: string;
  readonly clearToken?: boolean;
}

export type MaxRegisterResult =
  | { readonly status: 'authenticated'; readonly token: string; readonly accountId: string }
  | {
      readonly status:
        | 'validation_error'
        | 'age_routed'
        | 'email_taken'
        | 'username_taken'
        | 'identity_taken'
        | 'assertion_replayed'
        | 'unavailable';
      readonly message?: string;
      readonly routes?: readonly MinorRoute[];
    };

export type MaxPairingResult =
  | { readonly status: 'pending' | 'expired' | 'invalid' | 'consumed' }
  | { readonly status: 'authenticated'; readonly token: string; readonly accountId: string };

export type MaxConfigurationErrorCode =
  | 'max_encryption_key_missing'
  | 'max_token_missing'
  | 'max_token_invalid'
  | 'max_token_bot_mismatch'
  | 'max_service_unavailable';

export class MaxConfigurationError extends Error {
  constructor(readonly code: MaxConfigurationErrorCode) {
    super(code);
    this.name = 'MaxConfigurationError';
  }
}

interface MaxRuntimeRow {
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
  readonly configuration_version: string | number;
  readonly updated_at: Date | string | null;
}

interface MaxVerifiedBot {
  readonly id: string;
  readonly username: string;
  readonly name: string | null;
}

interface MaxWebhookStatusRow {
  readonly webhook_url: string | null;
  readonly webhook_verified_at: Date | string | null;
  readonly webhook_last_error: string | null;
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function normalizedMiniAppUrl(value: string | undefined): string | null {
  const normalized = boundedText(value, 2048);
  if (normalized === null) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizedBotUsername(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/^@/, '') ?? '';
  return /^[A-Za-z0-9_]{3,64}$/.test(normalized) ? normalized : null;
}

function encryptionKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  const trimmed = value.trim();
  const decoded = /^[a-fA-F0-9]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : /^[A-Za-z0-9_-]{43}$/.test(trimmed)
      ? Buffer.from(trimmed, 'base64url')
      : Buffer.alloc(0);
  return decoded.length === 32 ? decoded : null;
}

function isoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeVersion(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Verify MAX WebApp initData exactly as documented by MAX. The browser-provided
 * `initDataUnsafe` object is deliberately never accepted: only the signed raw
 * string crosses this trust boundary.
 */
export function validateMaxInitData(
  rawInitData: unknown,
  botToken: string,
  nowMs = Date.now(),
): ValidatedMaxIdentity {
  if (
    typeof rawInitData !== 'string' ||
    rawInitData.length === 0 ||
    rawInitData.length > MAX_INIT_DATA_LIMIT ||
    botToken.length === 0
  ) {
    throw new MaxInitDataError('max_init_data_invalid');
  }

  const params = new URLSearchParams(rawInitData.replace(/^\?/, ''));
  const seen = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (const pair of params.entries()) {
    if (seen.has(pair[0]) || seen.size >= MAX_PARAMETER_LIMIT) {
      throw new MaxInitDataError('max_init_data_invalid');
    }
    seen.add(pair[0]);
    pairs.push(pair);
  }

  const suppliedHash = params.get('hash');
  if (!suppliedHash || !/^[a-fA-F0-9]{64}$/.test(suppliedHash)) {
    throw new MaxInitDataError('max_init_data_invalid');
  }
  const checkString = pairs
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secret).update(checkString).digest();
  const suppliedBytes = Buffer.from(suppliedHash, 'hex');
  if (
    suppliedBytes.length !== expectedHash.length ||
    !timingSafeEqual(suppliedBytes, expectedHash)
  ) {
    throw new MaxInitDataError('max_init_data_invalid');
  }

  const authDateText = params.get('auth_date');
  const authDate = authDateText === null ? Number.NaN : Number(authDateText);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) {
    throw new MaxInitDataError('max_init_data_invalid');
  }
  if (
    authDate < nowSeconds - MAX_INIT_DATA_MAX_AGE_SECONDS ||
    authDate > nowSeconds + MAX_INIT_DATA_FUTURE_SKEW_SECONDS
  ) {
    throw new MaxInitDataError('max_init_data_expired');
  }

  const queryId = boundedText(params.get('query_id'), 255);
  const rawUser = params.get('user');
  if (!queryId || !rawUser || rawUser.length > 4096) {
    throw new MaxInitDataError('max_init_data_invalid');
  }

  let user: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawUser) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('user is not an object');
    }
    user = parsed as Record<string, unknown>;
  } catch {
    throw new MaxInitDataError('max_init_data_invalid');
  }

  const rawId = user['id'];
  const subject =
    typeof rawId === 'number' && Number.isSafeInteger(rawId) && rawId > 0
      ? String(rawId)
      : typeof rawId === 'string' && /^[0-9]{1,64}$/.test(rawId)
        ? rawId
        : null;
  if (!subject) throw new MaxInitDataError('max_init_data_invalid');

  const firstName = boundedText(user['first_name'], 128);
  const lastName = boundedText(user['last_name'], 128);
  const displayName = boundedText([firstName, lastName].filter(Boolean).join(' '), 255);
  return {
    subject,
    queryId,
    authDate,
    username: boundedText(user['username'], 64),
    displayName,
    startParam:
      typeof params.get('start_param') === 'string' &&
      MAX_START_PARAM_PATTERN.test(params.get('start_param') ?? '')
        ? params.get('start_param')
        : null,
  };
}

export class MaxAuthService {
  private readonly now: () => number;
  private readonly key: Buffer | null;
  private readonly fetchImpl: typeof fetch;
  private readonly staticRuntime: MaxRuntimeRow | null;
  private webhookSync: Promise<void> | null = null;
  private webhookNextSyncAt = 0;

  constructor(
    private readonly pool: pg.Pool,
    options: MaxAuthOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.key = encryptionKey(options.encryptionKey ?? process.env['ASA_SETTINGS_ENCRYPTION_KEY']);
    this.fetchImpl = options.fetchImpl ?? fetch;
    const hasStaticOptions =
      options.botToken !== undefined ||
      options.botUsername !== undefined ||
      options.miniAppUrl !== undefined ||
      options.enabled !== undefined;
    const staticToken = boundedText(options.botToken, 2048);
    this.staticRuntime = hasStaticOptions
      ? {
          enabled: options.enabled ?? false,
          bot_username:
            normalizedBotUsername(options.botUsername ?? 'id231408577954_3_bot') ??
            'id231408577954_3_bot',
          mini_app_url:
            normalizedMiniAppUrl(options.miniAppUrl ?? 'https://asa-lab.ru/max-login') ??
            'https://asa-lab.ru/max-login',
          token_ciphertext: staticToken,
          token_iv: null,
          token_auth_tag: null,
          token_fingerprint: staticToken
            ? createHash('sha256').update(staticToken).digest('hex').slice(0, 12)
            : null,
          verified_bot_id: null,
          verified_bot_name: null,
          token_verified_at: null,
          configuration_version: 1,
          updated_at: null,
        }
      : null;
  }

  async config(): Promise<{ enabled: boolean; launchUrl: string | null }> {
    const runtime = await this.runtime();
    const token = this.runtimeToken(runtime);
    if (!this.staticRuntime && runtime.enabled && token && this.now() >= this.webhookNextSyncAt) {
      this.webhookNextSyncAt = this.now() + 15 * 60 * 1000;
      void this.ensureWebhookSubscription().catch(() => undefined);
    }
    return {
      enabled: runtime.enabled && token !== null,
      launchUrl:
        runtime.bot_username.length === 0
          ? null
          : `https://max.ru/${encodeURIComponent(runtime.bot_username)}?start=asa_login`,
    };
  }

  async adminConfig(actorPrincipalId?: string): Promise<MaxAdminConfig> {
    const runtime = actorPrincipalId
      ? await this.adminRuntime(actorPrincipalId)
      : await this.runtime();
    const tokenConfigured = runtime.token_ciphertext !== null;
    const publicConfig = {
      enabled:
        runtime.enabled &&
        tokenConfigured &&
        (actorPrincipalId ? this.key !== null : this.runtimeToken(runtime) !== null),
      launchUrl: `https://max.ru/${encodeURIComponent(runtime.bot_username)}?start=asa_login`,
    };
    let webhook: MaxWebhookStatusRow | null = null;
    if (!this.staticRuntime) {
      const result = await this.pool.query<MaxWebhookStatusRow>(
        `SELECT webhook_url, webhook_verified_at, webhook_last_error
           FROM auth_max_webhook_status()`,
      );
      webhook = result.rows[0] ?? null;
    }
    return {
      ...publicConfig,
      featureEnabled: runtime.enabled,
      tokenConfigured,
      botUsername: runtime.bot_username,
      miniAppUrl: runtime.mini_app_url,
      encryptionReady: this.key !== null || this.staticRuntime !== null,
      tokenFingerprint: runtime.token_fingerprint,
      verifiedBotId: runtime.verified_bot_id,
      verifiedBotName: runtime.verified_bot_name,
      tokenVerifiedAt: isoOrNull(runtime.token_verified_at),
      configurationVersion: safeVersion(runtime.configuration_version),
      updatedAt: isoOrNull(runtime.updated_at),
      webhookUrl: webhook?.webhook_url ?? null,
      webhookVerifiedAt: isoOrNull(webhook?.webhook_verified_at ?? null),
      webhookLastError: webhook?.webhook_last_error ?? null,
    };
  }

  async updateAdminConfig(
    actorPrincipalId: string,
    input: MaxAdminUpdateInput,
    requestId: string,
  ): Promise<MaxAdminConfig> {
    if (this.staticRuntime) throw new MaxConfigurationError('max_service_unavailable');
    const botUsername = normalizedBotUsername(input.botUsername);
    const miniAppUrl = normalizedMiniAppUrl(input.miniAppUrl);
    if (!botUsername || !miniAppUrl) throw new MaxConfigurationError('max_token_bot_mismatch');
    if (input.clearToken && input.enabled) throw new MaxConfigurationError('max_token_missing');

    const current = await this.runtime();
    const suppliedToken = boundedText(input.botToken, 2048);
    if ((suppliedToken || input.enabled) && !this.key) {
      throw new MaxConfigurationError('max_encryption_key_missing');
    }
    const candidateToken = suppliedToken ?? this.runtimeToken(current);
    let verified: MaxVerifiedBot | null = null;
    if (suppliedToken || input.enabled) {
      if (!candidateToken) throw new MaxConfigurationError('max_token_missing');
      verified = await this.verifyBotToken(candidateToken);
      if (verified.username.toLowerCase() !== botUsername.toLowerCase()) {
        throw new MaxConfigurationError('max_token_bot_mismatch');
      }
    }

    let encrypted: { ciphertext: string; iv: string; tag: string; fingerprint: string } | null =
      null;
    if (suppliedToken) encrypted = this.encryptToken(suppliedToken);
    const tokenAction = input.clearToken ? 'clear' : suppliedToken ? 'replace' : 'keep';
    await this.pool.query(
      `SELECT admin_set_max_runtime_config($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        actorPrincipalId,
        input.enabled,
        botUsername,
        miniAppUrl,
        tokenAction,
        encrypted?.ciphertext ?? null,
        encrypted?.iv ?? null,
        encrypted?.tag ?? null,
        encrypted?.fingerprint ?? null,
        verified?.id ?? current.verified_bot_id,
        verified?.name ?? current.verified_bot_name,
        this.configurationReason(current, input, suppliedToken !== null),
        requestId,
      ],
    );
    if (input.enabled) await this.ensureWebhookSubscription(true).catch(() => undefined);
    return this.adminConfig(actorPrincipalId);
  }

  private configurationReason(
    current: MaxRuntimeRow,
    input: MaxAdminUpdateInput,
    tokenReplaced: boolean,
  ): string {
    const changes: string[] = [];
    if (current.enabled !== input.enabled) changes.push(input.enabled ? 'включение' : 'выключение');
    if (current.bot_username !== normalizedBotUsername(input.botUsername)) changes.push('имя бота');
    if (current.mini_app_url !== normalizedMiniAppUrl(input.miniAppUrl)) {
      changes.push('адрес возврата ASA Lab');
    }
    if (tokenReplaced) changes.push('замена токена');
    if (input.clearToken) changes.push('удаление токена');
    return `Настройка MAX: ${changes.join(', ') || 'проверка подключения'}`;
  }

  private async identity(rawInitData: unknown): Promise<ValidatedMaxIdentity> {
    const runtime = await this.runtime();
    const token = this.runtimeToken(runtime);
    if (!runtime.enabled || token === null) {
      throw new MaxInitDataError('max_auth_disabled');
    }
    return validateMaxInitData(rawInitData, token, this.now());
  }

  async signIn(rawInitData: unknown, userAgentSummary?: string): Promise<MaxSignInResult> {
    const identity = await this.identity(rawInitData);
    const activeIdentity = await this.pool.query<{ account_id: string | null }>(
      `SELECT auth_max_identity_account($1) AS account_id`,
      [identity.subject],
    );
    if (!activeIdentity.rows[0]?.account_id) {
      return this.registerGeneratedIdentity(identity, false);
    }
    const token = createSessionToken();
    const result = await this.pool.query(
      `SELECT result, account_id
         FROM auth_max_login($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        identity.subject,
        identity.queryId,
        identity.authDate,
        identity.username,
        identity.displayName,
        hashSessionToken(token),
        SESSION_TTL_HOURS,
        userAgentSummary ?? null,
      ],
    );
    const status = String(result.rows[0]?.result ?? 'unavailable') as MaxSignInResult['status'];
    const accountId = String(result.rows[0]?.account_id ?? '');
    if (status === 'authenticated' && accountId) {
      await this.approvePairing(identity.startParam, accountId);
      return { status, token, accountId };
    }
    return {
      status: status === 'authenticated' ? 'unavailable' : status,
    };
  }

  /**
   * MAX itself is the credential. A provider-only account therefore gets an
   * internal, non-routable identifier and a random unreachable password hash;
   * neither value is requested from or shown to the person signing in.
   */
  private async registerGeneratedIdentity(
    identity: ValidatedMaxIdentity,
    discardProvisionalSession: boolean,
  ): Promise<MaxSignInResult> {
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    const generatedPassword = randomBytes(48).toString('base64url');
    const subjectHash = createHash('sha256').update(identity.subject).digest('hex').slice(0, 20);
    const username = `max_${subjectHash}`;
    const displayName = identity.displayName ?? identity.username ?? 'Пользователь MAX';
    const technicalEmail = `max-${identity.subject}@users.asa.invalid`;
    const birthDate = new Date(this.now()).toISOString().slice(0, 10);
    try {
      const result = await this.pool.query(
        `SELECT result, account_id
           FROM auth_max_register_account(
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12,$13,$14
           )`,
        [
          identity.subject,
          identity.queryId,
          identity.authDate,
          identity.username,
          identity.displayName,
          technicalEmail,
          await hashPasswordAsync(generatedPassword),
          displayName,
          username,
          birthDate,
          'RU',
          AGE_POLICY_VERSION,
          tokenHash,
          SESSION_TTL_HOURS,
        ],
      );
      const status = String(result.rows[0]?.result ?? 'unavailable');
      const accountId = String(result.rows[0]?.account_id ?? '');
      if (status === 'authenticated' && accountId) {
        if (discardProvisionalSession) {
          await this.pool.query(`SELECT auth_max_discard_provisional_session($1) AS discarded`, [
            tokenHash,
          ]);
        }
        await this.approvePairing(identity.startParam, accountId);
        return { status: 'authenticated', token, accountId };
      }
      if (status === 'identity_taken') {
        const existing = await this.pool.query<{ account_id: string | null }>(
          `SELECT auth_max_identity_account($1) AS account_id`,
          [identity.subject],
        );
        const accountId = existing.rows[0]?.account_id;
        if (accountId && discardProvisionalSession) {
          await this.approvePairing(identity.startParam, accountId);
          return { status: 'authenticated', token, accountId };
        }
      }
      return { status: 'unavailable' };
    } catch (problem) {
      const failure = problem as { code?: string };
      if (failure.code === '23505') {
        const existing = await this.pool.query<{ account_id: string | null }>(
          `SELECT auth_max_identity_account($1) AS account_id`,
          [identity.subject],
        );
        const accountId = existing.rows[0]?.account_id;
        if (accountId && discardProvisionalSession) {
          await this.approvePairing(identity.startParam, accountId);
          return { status: 'authenticated', token, accountId };
        }
        return { status: 'unavailable' };
      }
      throw problem;
    }
  }

  async link(accountId: string, rawInitData: unknown): Promise<MaxLinkResult> {
    const identity = await this.identity(rawInitData);
    const result = await this.pool.query(
      `SELECT result
         FROM auth_max_link($1, $2, $3, $4, $5, $6)`,
      [
        accountId,
        identity.subject,
        identity.queryId,
        identity.authDate,
        identity.username,
        identity.displayName,
      ],
    );
    const status = String(result.rows[0]?.result ?? 'unavailable') as MaxLinkResult['status'];
    if (status === 'linked' || status === 'already_linked') {
      await this.approvePairing(identity.startParam, accountId);
    }
    return { status };
  }

  async register(
    rawInitData: unknown,
    input: {
      readonly email: unknown;
      readonly username: unknown;
      readonly displayName: unknown;
      readonly birthDate: unknown;
      readonly country: unknown;
    },
  ): Promise<MaxRegisterResult> {
    const identity = await this.identity(rawInitData);
    const email = typeof input.email === 'string' ? normalizeEmail(input.email) : input.email;
    if (!isValidEmail(email)) {
      return { status: 'validation_error', message: 'Введите корректный email.' };
    }
    if (!isValidUsername(input.username)) {
      return {
        status: 'validation_error',
        message:
          'Имя пользователя: 3–40 символов, латиница, цифры, точка, дефис или подчёркивание.',
      };
    }
    if (!isValidDisplayName(input.displayName)) {
      return { status: 'validation_error', message: 'Отображаемое имя слишком длинное.' };
    }
    if (!isValidCountryCode(input.country)) {
      return { status: 'validation_error', message: 'Укажите страну.' };
    }
    const birthDate = parseBirthDate(input.birthDate);
    if (!birthDate) {
      return { status: 'validation_error', message: 'Укажите дату рождения.' };
    }
    if (!isEligibleAdult(birthDate)) {
      return {
        status: 'age_routed',
        message: 'Личный аккаунт доступен с 18 лет — ученики заходят по коду класса.',
        routes: routeForMinor(),
      };
    }

    const username = (input.username as string).trim().toLowerCase();
    const displayName =
      typeof input.displayName === 'string' && input.displayName.trim()
        ? input.displayName.trim()
        : identity.displayName || username;
    const token = createSessionToken();
    const generatedPassword = randomBytes(48).toString('base64url');
    try {
      const result = await this.pool.query(
        `SELECT result, account_id
           FROM auth_max_register_account(
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12,$13,$14
           )`,
        [
          identity.subject,
          identity.queryId,
          identity.authDate,
          identity.username,
          identity.displayName,
          email,
          await hashPasswordAsync(generatedPassword),
          displayName,
          username,
          input.birthDate,
          (input.country as string).trim().toUpperCase(),
          AGE_POLICY_VERSION,
          hashSessionToken(token),
          SESSION_TTL_HOURS,
        ],
      );
      const status = String(result.rows[0]?.result ?? 'unavailable') as MaxRegisterResult['status'];
      const accountId = String(result.rows[0]?.account_id ?? '');
      if (status === 'authenticated' && accountId) {
        await this.approvePairing(identity.startParam, accountId);
        return { status, token, accountId };
      }
      return {
        status: status === 'authenticated' ? 'unavailable' : status,
      };
    } catch (problem) {
      const failure = problem as { code?: string; constraint?: string };
      if (failure.code === '23505') {
        return {
          status:
            failure.constraint === 'profiles_username_ci_idx' ? 'username_taken' : 'email_taken',
        };
      }
      throw problem;
    }
  }

  async startPairing(
    requestedAccountId?: string,
  ): Promise<{ pairingToken: string; launchUrl: string }> {
    const runtime = await this.runtime();
    const token = this.runtimeToken(runtime);
    if (!runtime.enabled || !token) throw new MaxInitDataError('max_auth_disabled');
    const pairingToken = randomBytes(32).toString('base64url');
    const created = await this.pool.query<{ created: boolean }>(
      `SELECT auth_max_pairing_start($1, $2, $3) AS created`,
      [hashSessionToken(pairingToken), MAX_PAIRING_TTL_MINUTES, requestedAccountId ?? null],
    );
    if (created.rows[0]?.created !== true) {
      throw new MaxConfigurationError('max_service_unavailable');
    }
    return {
      pairingToken,
      launchUrl: `https://max.ru/${encodeURIComponent(runtime.bot_username)}?start=pair_${pairingToken}`,
    };
  }

  async consumePairing(
    pairingToken: unknown,
    userAgentSummary?: string,
  ): Promise<MaxPairingResult> {
    if (typeof pairingToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pairingToken)) {
      return { status: 'invalid' };
    }
    const token = createSessionToken();
    const result = await this.pool.query(
      `SELECT result, account_id
         FROM auth_max_pairing_consume($1, $2, $3, $4)`,
      [
        hashSessionToken(pairingToken),
        hashSessionToken(token),
        SESSION_TTL_HOURS,
        userAgentSummary ?? null,
      ],
    );
    const status = String(result.rows[0]?.result ?? 'invalid') as MaxPairingResult['status'];
    const accountId = String(result.rows[0]?.account_id ?? '');
    return status === 'authenticated' && accountId
      ? { status, token, accountId }
      : { status: status === 'authenticated' ? 'invalid' : status };
  }

  private async approvePairing(startParam: string | null, accountId: string): Promise<boolean> {
    if (!startParam?.startsWith('pair_')) return false;
    const pairingToken = startParam.slice(5);
    if (!/^[A-Za-z0-9_-]{43}$/.test(pairingToken)) return false;
    const result = await this.pool.query<{ approved: boolean }>(
      `SELECT auth_max_pairing_approve($1, $2) AS approved`,
      [hashSessionToken(pairingToken), accountId],
    );
    return result.rows[0]?.approved === true;
  }

  private webhookSecret(runtime: MaxRuntimeRow): string | null {
    if (!this.key) return null;
    return createHmac('sha256', this.key)
      .update(`max-webhook:${runtime.verified_bot_id ?? runtime.bot_username}`)
      .digest('base64url');
  }

  private webhookUrl(runtime: MaxRuntimeRow): string | null {
    try {
      const url = new URL(runtime.mini_app_url);
      return url.protocol === 'https:' ? `${url.origin}/api/auth/max/webhook` : null;
    } catch {
      return null;
    }
  }

  private async confirmBotPairing(
    identity: ValidatedMaxIdentity,
  ): Promise<
    | 'authenticated'
    | 'linked'
    | 'identity_taken'
    | 'account_already_linked'
    | 'account_suspended'
    | 'invalid'
    | 'unavailable'
  > {
    if (!identity.startParam?.startsWith('pair_')) return 'invalid';
    const pairingToken = identity.startParam.slice(5);
    if (!/^[A-Za-z0-9_-]{43}$/.test(pairingToken)) return 'invalid';
    const pairingHash = hashSessionToken(pairingToken);
    const target = await this.pool.query<{
      result: string;
      requested_account_id: string | null;
    }>(`SELECT result, requested_account_id FROM auth_max_pairing_target($1)`, [pairingHash]);
    const pairing = target.rows[0];
    if (!pairing || !['pending', 'approved'].includes(pairing.result)) return 'invalid';
    if (pairing.result === 'approved') return 'authenticated';

    if (pairing.requested_account_id) {
      const linked = await this.pool.query<{ result: string }>(
        `SELECT result FROM auth_max_link($1, $2, $3, $4, $5, $6)`,
        [
          pairing.requested_account_id,
          identity.subject,
          identity.queryId,
          identity.authDate,
          identity.username,
          identity.displayName,
        ],
      );
      const result = String(linked.rows[0]?.result ?? 'unavailable');
      if (result === 'linked' || result === 'already_linked') {
        return (await this.approvePairing(identity.startParam, pairing.requested_account_id))
          ? 'linked'
          : 'invalid';
      }
      if (
        result === 'identity_taken' ||
        result === 'account_already_linked' ||
        result === 'account_suspended'
      ) {
        return result;
      }
      return 'unavailable';
    }

    const activeIdentity = await this.pool.query<{ account_id: string | null }>(
      `SELECT auth_max_identity_account($1) AS account_id`,
      [identity.subject],
    );
    const existingAccountId = activeIdentity.rows[0]?.account_id;
    if (existingAccountId) {
      return (await this.approvePairing(identity.startParam, existingAccountId))
        ? 'authenticated'
        : 'account_suspended';
    }
    const registered = await this.registerGeneratedIdentity(identity, true);
    return registered.status === 'authenticated' ? 'authenticated' : 'unavailable';
  }

  async ensureWebhookSubscription(force = false): Promise<void> {
    if (this.staticRuntime) return;
    if (this.webhookSync && !force) return this.webhookSync;
    const operation = this.syncWebhookSubscription(force);
    this.webhookSync = operation;
    try {
      await operation;
    } finally {
      if (this.webhookSync === operation) this.webhookSync = null;
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
      // MAX documents POST as both create and update. Re-applying it on startup
      // also rotates the delivery secret safely after an encryption-key change.
      const created = await this.fetchImpl('https://platform-api2.max.ru/subscriptions', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url,
          update_types: ['bot_started', 'message_created'],
          secret,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!created.ok) throw new Error(`MAX subscription returned ${created.status}`);
      const createdPayload = (await created.json()) as { success?: unknown; message?: unknown };
      if (createdPayload.success !== true) {
        throw new Error(
          typeof createdPayload.message === 'string'
            ? createdPayload.message
            : 'MAX rejected webhook subscription',
        );
      }
      await this.pool.query(`SELECT auth_max_webhook_status_set($1, true, NULL)`, [url]);
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : 'MAX webhook unavailable';
      await this.pool
        .query(`SELECT auth_max_webhook_status_set($1, false, $2)`, [url, message])
        .catch(() => undefined);
      if (force) throw new MaxConfigurationError('max_service_unavailable');
    }
  }

  async handleWebhook(
    suppliedSecret: unknown,
    body: unknown,
  ): Promise<'accepted' | 'duplicate' | 'unauthorized'> {
    const runtime = await this.runtime();
    const expected = this.webhookSecret(runtime);
    if (typeof suppliedSecret !== 'string' || !expected) return 'unauthorized';
    const actualBytes = Buffer.from(suppliedSecret);
    const expectedBytes = Buffer.from(expected);
    if (
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      return 'unauthorized';
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return 'accepted';
    const update = body as Record<string, unknown>;
    const eventHash = createHash('sha256')
      .update(JSON.stringify(update).slice(0, 64 * 1024))
      .digest('hex');
    const updateType = update['update_type'];
    if (updateType !== 'bot_started' && updateType !== 'message_created') return 'accepted';
    const directUser = update['user'];
    const message = update['message'];
    const sender =
      message && typeof message === 'object' && !Array.isArray(message)
        ? (message as Record<string, unknown>)['sender']
        : null;
    const user =
      directUser && typeof directUser === 'object' && !Array.isArray(directUser)
        ? (directUser as Record<string, unknown>)
        : sender && typeof sender === 'object' && !Array.isArray(sender)
          ? (sender as Record<string, unknown>)
          : null;
    const rawUserId = user?.['user_id'] ?? user?.['id'];
    const userId =
      typeof rawUserId === 'number' && Number.isSafeInteger(rawUserId) && rawUserId > 0
        ? String(rawUserId)
        : typeof rawUserId === 'string' && /^[0-9]{1,64}$/.test(rawUserId)
          ? rawUserId
          : null;
    const token = this.runtimeToken(runtime);
    if (!userId || !token) return 'accepted';
    const payload = boundedText(update['payload'], 512);
    const isPairingLaunch =
      updateType === 'bot_started' &&
      payload?.startsWith('pair_') === true &&
      /^[A-Za-z0-9_-]{43}$/.test(payload.slice(5));
    let responseText = 'Чтобы войти, нажмите «Войти через MAX» на сайте ASA Lab.';
    if (isPairingLaunch && payload) {
      const firstName = boundedText(user?.['first_name'], 128);
      const lastName = boundedText(user?.['last_name'], 128);
      const displayName =
        boundedText([firstName, lastName].filter(Boolean).join(' '), 255) ??
        boundedText(user?.['name'], 255);
      const rawTimestamp = update['timestamp'];
      const authDate =
        typeof rawTimestamp === 'number' && Number.isSafeInteger(rawTimestamp) && rawTimestamp > 0
          ? Math.floor(rawTimestamp / 1000)
          : Math.floor(this.now() / 1000);
      const confirmation = await this.confirmBotPairing({
        subject: userId,
        queryId: `webhook:${eventHash}`,
        authDate,
        username: boundedText(user?.['username'], 64),
        displayName,
        startParam: payload,
      });
      responseText =
        confirmation === 'authenticated'
          ? 'Готово. Личность подтверждена — вернитесь в ASA Lab, вход завершится автоматически.'
          : confirmation === 'linked'
            ? 'Готово. MAX подключён к вашему аккаунту ASA Lab.'
            : confirmation === 'identity_taken'
              ? 'Этот профиль MAX уже подключён к другому аккаунту ASA Lab.'
              : confirmation === 'account_already_linked'
                ? 'К этому аккаунту ASA Lab уже подключён другой профиль MAX.'
                : confirmation === 'account_suspended'
                  ? 'Аккаунт ASA Lab приостановлен. Обратитесь к администратору.'
                  : 'Запрос входа устарел. Вернитесь на сайт и нажмите «Войти через MAX» ещё раз.';
    } else {
      const claim = await this.pool.query<{ claimed: boolean }>(
        `SELECT auth_max_webhook_event_claim($1) AS claimed`,
        [eventHash],
      );
      if (claim.rows[0]?.claimed !== true) return 'duplicate';
    }
    let siteUrl = 'https://asa-lab.ru/#/sign-in';
    try {
      siteUrl = `${new URL(runtime.mini_app_url).origin}/#/sign-in`;
    } catch {
      // The runtime setting is validated on write; keep the canonical fallback.
    }
    await this.fetchImpl(
      `https://platform-api2.max.ru/messages?user_id=${encodeURIComponent(userId)}`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          text: responseText,
          attachments: [
            {
              type: 'inline_keyboard',
              payload: {
                buttons: [[{ type: 'link', text: 'Вернуться в ASA Lab', url: siteUrl }]],
              },
            },
          ],
        }),
        signal: AbortSignal.timeout(4_000),
      },
    ).catch(() => undefined);
    return 'accepted';
  }

  private async runtime(): Promise<MaxRuntimeRow> {
    if (this.staticRuntime) return this.staticRuntime;
    const result = await this.pool.query<MaxRuntimeRow>(
      `SELECT enabled, bot_username, mini_app_url,
              token_ciphertext, token_iv, token_auth_tag, token_fingerprint,
              verified_bot_id, verified_bot_name, token_verified_at,
              configuration_version, updated_at
         FROM auth_max_runtime_config()`,
    );
    const row = result.rows[0];
    if (!row) throw new MaxConfigurationError('max_service_unavailable');
    return row;
  }

  private async adminRuntime(actorPrincipalId: string): Promise<MaxRuntimeRow> {
    if (this.staticRuntime) return this.staticRuntime;
    const result = await this.pool.query<
      Omit<MaxRuntimeRow, 'token_ciphertext' | 'token_iv' | 'token_auth_tag'> & {
        readonly token_configured: boolean;
      }
    >(
      `SELECT enabled, bot_username, mini_app_url, token_configured,
              token_fingerprint, verified_bot_id, verified_bot_name,
              token_verified_at, configuration_version, updated_at
         FROM admin_get_max_runtime_config($1)`,
      [actorPrincipalId],
    );
    const row = result.rows[0];
    if (!row) throw new MaxConfigurationError('max_service_unavailable');
    return {
      ...row,
      token_ciphertext: row.token_configured ? 'configured' : null,
      token_iv: null,
      token_auth_tag: null,
    };
  }

  private runtimeToken(runtime: MaxRuntimeRow): string | null {
    if (runtime.token_ciphertext === null) return null;
    if (runtime === this.staticRuntime) return boundedText(runtime.token_ciphertext, 2048);
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
      return boundedText(clear, 2048);
    } catch {
      return null;
    }
  }

  private encryptToken(token: string): {
    readonly ciphertext: string;
    readonly iv: string;
    readonly tag: string;
    readonly fingerprint: string;
  } {
    if (!this.key) throw new MaxConfigurationError('max_encryption_key_missing');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64url'),
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      fingerprint: createHash('sha256').update(token).digest('hex').slice(0, 12),
    };
  }

  private async verifyBotToken(token: string): Promise<MaxVerifiedBot> {
    let response: Response;
    try {
      response = await this.fetchImpl('https://platform-api2.max.ru/me', {
        headers: { accept: 'application/json', authorization: token },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new MaxConfigurationError('max_service_unavailable');
    }
    if (response.status === 401 || response.status === 403) {
      throw new MaxConfigurationError('max_token_invalid');
    }
    if (!response.ok) throw new MaxConfigurationError('max_service_unavailable');
    let payload: Record<string, unknown>;
    try {
      const value = (await response.json()) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
      payload = value as Record<string, unknown>;
    } catch {
      throw new MaxConfigurationError('max_service_unavailable');
    }
    const username = normalizedBotUsername(
      typeof payload['username'] === 'string' ? payload['username'] : undefined,
    );
    const rawId = payload['user_id'] ?? payload['id'];
    const id =
      typeof rawId === 'number' && Number.isSafeInteger(rawId)
        ? String(rawId)
        : typeof rawId === 'string' && rawId.length <= 64
          ? rawId
          : null;
    if (payload['is_bot'] !== true || !username || !id) {
      throw new MaxConfigurationError('max_token_invalid');
    }
    return {
      id,
      username,
      name: boundedText(payload['name'], 128),
    };
  }

  async status(accountId: string): Promise<MaxAccountStatus | null> {
    const result = await this.pool.query(
      `SELECT linked, verified_at, first_authenticated_at, prompt_due, prompt_dismissed_until
         FROM auth_max_status($1)`,
      [accountId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const iso = (value: Date | string | null): string | null =>
      value === null
        ? null
        : value instanceof Date
          ? value.toISOString()
          : new Date(value).toISOString();
    return {
      linked: row.linked === true,
      verifiedAt: iso(row.verified_at ?? null),
      firstAuthenticatedAt: iso(row.first_authenticated_at ?? null),
      promptDue: row.prompt_due === true,
      promptDismissedUntil: iso(row.prompt_dismissed_until ?? null),
    };
  }

  async dismissPrompt(accountId: string): Promise<string | null> {
    const result = await this.pool.query<{ dismissed_until: Date | string | null }>(
      `SELECT auth_max_dismiss_prompt($1) AS dismissed_until`,
      [accountId],
    );
    const value = result.rows[0]?.dismissed_until;
    return value
      ? value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString()
      : null;
  }

  async unlink(accountId: string, actorPrincipalId: string): Promise<boolean> {
    const result = await this.pool.query<{ unlinked: boolean }>(
      `SELECT auth_max_unlink_self($1, $2) AS unlinked`,
      [accountId, actorPrincipalId],
    );
    return result.rows[0]?.unlinked === true;
  }
}
