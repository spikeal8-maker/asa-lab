import { ProviderConfigurationError, type BotAuthProvider } from './auth-provider-availability.js';
import { providerText, providerUserId } from './provider-init-data.js';

export const PROVIDER_TIMEOUT_MS = 2_500;
export interface VerifiedBot {
  readonly id: string;
  readonly username: string;
  readonly name: string | null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizedUsername(value: unknown): string | null {
  const text = providerText(value, 65)?.replace(/^@/, '') ?? '';
  return /^[A-Za-z0-9_]{3,64}$/.test(text) ? text : null;
}

/** Only documented provider endpoints are constructed here; errors never retain URLs or tokens. */
export class BotProviderTransport {
  constructor(
    readonly provider: BotAuthProvider,
    private readonly fetchImpl: typeof fetch,
  ) {}

  failure(
    suffix:
      | 'encryption_key_missing'
      | 'token_missing'
      | 'token_invalid'
      | 'token_bot_mismatch'
      | 'service_unavailable',
  ): ProviderConfigurationError {
    return new ProviderConfigurationError(`${this.provider}_${suffix}`);
  }

  async request(
    token: string,
    method: string,
    body?: Record<string, unknown>,
    signal: AbortSignal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  ): Promise<unknown> {
    if (this.provider === 'telegram' && !/^[0-9]{1,20}:[A-Za-z0-9_-]{20,200}$/.test(token)) {
      throw this.failure('token_invalid');
    }
    const url =
      this.provider === 'max'
        ? `https://platform-api2.max.ru/${method}`
        : `https://api.telegram.org/bot${token}/${method}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: body ? 'POST' : 'GET',
        headers: {
          accept: 'application/json',
          ...(this.provider === 'max' ? { authorization: token } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal,
      });
    } catch {
      // Do not propagate fetch messages: Telegram carries its token in the URL.
      throw this.failure('service_unavailable');
    }
    if (
      [401, 403].includes(response.status) ||
      (this.provider === 'telegram' && response.status === 404)
    )
      throw this.failure('token_invalid');
    if (!response.ok) throw this.failure('service_unavailable');
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw this.failure('service_unavailable');
    }
    if (this.provider === 'telegram') {
      const envelope = asRecord(value);
      if (envelope?.['ok'] !== true) {
        if ([401, 403, 404].includes(Number(envelope?.['error_code'])))
          throw this.failure('token_invalid');
        throw this.failure('service_unavailable');
      }
      return envelope['result'];
    }
    return value;
  }

  async verifyBotToken(token: string, signal?: AbortSignal): Promise<VerifiedBot> {
    const value = asRecord(
      await this.request(token, this.provider === 'max' ? 'me' : 'getMe', undefined, signal),
    );
    const username = normalizedUsername(value?.['username']);
    const id = providerUserId(value?.['user_id'] ?? value?.['id']);
    if (value?.['is_bot'] !== true || !username || !id) throw this.failure('token_invalid');
    return {
      id,
      username,
      name: providerText(value['name'] ?? value['first_name'], 128),
    };
  }
}
