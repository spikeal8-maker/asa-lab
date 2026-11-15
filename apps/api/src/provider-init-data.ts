import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ProviderInitDataError,
  type BotAuthProvider,
  type ValidatedProviderIdentity,
} from './auth-provider-availability.js';

export function providerText(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= limit ? text : null;
}

export function providerUserId(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  return typeof value === 'string' && /^[1-9][0-9]{0,63}$/.test(value) ? value : null;
}

/** Verify only the signed raw launch string, never initDataUnsafe or browser IDs. */
export function validateProviderInitData(
  rawInitData: unknown,
  botToken: string,
  provider: BotAuthProvider,
  nowMs = Date.now(),
): ValidatedProviderIdentity {
  const invalid = () => new ProviderInitDataError(`${provider}_init_data_invalid`);
  if (
    typeof rawInitData !== 'string' ||
    rawInitData.length === 0 ||
    Buffer.byteLength(rawInitData, 'utf8') > 16 * 1024 ||
    !botToken
  )
    throw invalid();
  const params = new URLSearchParams(rawInitData.replace(/^\?/, ''));
  const seen = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (const pair of params.entries()) {
    if (seen.has(pair[0]) || seen.size >= 32) throw invalid();
    seen.add(pair[0]);
    pairs.push(pair);
  }
  const suppliedHash = params.get('hash');
  if (!suppliedHash || !/^[a-fA-F0-9]{64}$/.test(suppliedHash)) throw invalid();
  const checkString = pairs
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  const actual = Buffer.from(suppliedHash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
  const authDateText = params.get('auth_date');
  if (!authDateText || !/^[0-9]{1,12}$/.test(authDateText)) throw invalid();
  const authDate = Number(authDateText);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) throw invalid();
  if (authDate < nowSeconds - 3600 || authDate > nowSeconds + 60) {
    throw new ProviderInitDataError(`${provider}_init_data_expired`);
  }
  // Telegram's direct Mini App launch may omit query_id. The authenticated hash
  // is then the replay identifier; MAX's existing query_id contract is retained.
  const queryId =
    providerText(params.get('query_id'), 255) ??
    (provider === 'telegram' ? `init:${suppliedHash.toLowerCase()}` : null);
  const rawUser = params.get('user');
  if (!queryId || !rawUser || rawUser.length > 4096) throw invalid();
  let user: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(rawUser);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    user = value as Record<string, unknown>;
  } catch {
    throw invalid();
  }
  const subject = providerUserId(user['id']);
  if (!subject || user['is_bot'] === true) throw invalid();
  const firstName = providerText(user['first_name'], 128);
  const lastName = providerText(user['last_name'], 128);
  const startParam = params.get('start_param');
  return {
    subject,
    queryId,
    authDate,
    username: providerText(user['username'], 64),
    displayName: providerText([firstName, lastName].filter(Boolean).join(' '), 255),
    startParam: startParam && /^[A-Za-z0-9_-]{1,512}$/.test(startParam) ? startParam : null,
  };
}
