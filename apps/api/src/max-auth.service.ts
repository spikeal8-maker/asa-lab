import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type pg from 'pg';
import { createSessionToken, hashSessionToken, SESSION_TTL_HOURS } from '@asa-lab/identity';

const MAX_INIT_DATA_LIMIT = 16 * 1024;
const MAX_INIT_DATA_MAX_AGE_SECONDS = 60 * 60;
const MAX_INIT_DATA_FUTURE_SKEW_SECONDS = 60;
const MAX_PARAMETER_LIMIT = 32;

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
}

export type MaxSignInResult =
  | { readonly status: 'authenticated'; readonly token: string }
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
}

export interface MaxAdminUpdateInput {
  readonly enabled: boolean;
  readonly botUsername: string;
  readonly miniAppUrl: string;
  readonly botToken?: string;
  readonly clearToken?: boolean;
  readonly reason: string;
}

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
  };
}

export class MaxAuthService {
  private readonly now: () => number;
  private readonly key: Buffer | null;
  private readonly fetchImpl: typeof fetch;
  private readonly staticRuntime: MaxRuntimeRow | null;

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
    return {
      enabled: runtime.enabled && token !== null,
      launchUrl:
        runtime.bot_username.length === 0
          ? null
          : `https://max.ru/${encodeURIComponent(runtime.bot_username)}?startapp=asa_login`,
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
      launchUrl: `https://max.ru/${encodeURIComponent(runtime.bot_username)}?startapp=asa_login`,
    };
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
        input.reason,
        requestId,
      ],
    );
    return this.adminConfig(actorPrincipalId);
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
    if (!activeIdentity.rows[0]?.account_id) return { status: 'link_required' };
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
    return status === 'authenticated' ? { status, token } : { status };
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
    return { status: String(result.rows[0]?.result ?? 'unavailable') as MaxLinkResult['status'] };
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
