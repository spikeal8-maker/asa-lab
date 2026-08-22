import { createHmac, timingSafeEqual } from 'node:crypto';
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
  readonly enabled?: boolean;
  readonly now?: () => number;
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function normalizedBotUsername(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/^@/, '') ?? '';
  return /^[A-Za-z0-9_]{3,64}$/.test(normalized) ? normalized : null;
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
  private readonly botToken: string | null;
  private readonly botUsername: string | null;
  private readonly enabled: boolean;
  private readonly now: () => number;

  constructor(
    private readonly pool: pg.Pool,
    options: MaxAuthOptions = {},
  ) {
    this.botToken = boundedText(options.botToken ?? process.env['MAX_BOT_TOKEN'], 512);
    this.botUsername = normalizedBotUsername(
      options.botUsername ?? process.env['MAX_BOT_USERNAME'] ?? 'id231408577954_3_bot',
    );
    this.enabled = options.enabled ?? process.env['MAX_AUTH_ENABLED'] === '1';
    this.now = options.now ?? Date.now;
  }

  config(): { enabled: boolean; launchUrl: string | null } {
    return {
      enabled: this.enabled && this.botToken !== null && this.botUsername !== null,
      launchUrl:
        this.botUsername === null
          ? null
          : `https://max.ru/${encodeURIComponent(this.botUsername)}?startapp=asa_login`,
    };
  }

  private identity(rawInitData: unknown): ValidatedMaxIdentity {
    if (!this.enabled || this.botToken === null || this.botUsername === null) {
      throw new MaxInitDataError('max_auth_disabled');
    }
    return validateMaxInitData(rawInitData, this.botToken, this.now());
  }

  async signIn(rawInitData: unknown, userAgentSummary?: string): Promise<MaxSignInResult> {
    const identity = this.identity(rawInitData);
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
    const identity = this.identity(rawInitData);
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
}
