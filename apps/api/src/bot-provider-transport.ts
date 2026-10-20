import { ProviderConfigurationError, type BotAuthProvider } from './auth-provider-availability.js';
import { providerText, providerUserId } from './provider-init-data.js';

export const PROVIDER_TIMEOUT_MS = 2_500;
export interface VerifiedBot {
  readonly id: string;
  readonly username: string;
  readonly name: string | null;
}

/** Recipient permissions and expired callbacks say nothing about other users. */
export class ProviderDeliveryError extends Error {
  constructor(readonly scope: 'recipient' | 'callback') {
    super('provider_delivery_unavailable');
    this.name = 'ProviderDeliveryError';
  }
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

function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new Error('provider deadline'));
    if (signal.aborted) return aborted();
    signal.addEventListener('abort', aborted, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
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
      | 'webhook_url_invalid'
      | 'webhook_conflict'
      | 'service_unavailable',
  ): ProviderConfigurationError {
    return new ProviderConfigurationError(`${this.provider}_${suffix}`);
  }

  private requestFailure(method: string, status: number): Error {
    const operation = method.split('?')[0];
    if ([400, 403].includes(status)) {
      if (operation === 'sendMessage' || operation === 'messages') {
        return new ProviderDeliveryError('recipient');
      }
      if (operation === 'answerCallbackQuery' || operation === 'answers') {
        return new ProviderDeliveryError('callback');
      }
    }
    return this.failure(
      [401, 403].includes(status) || (this.provider === 'telegram' && status === 404)
        ? 'token_invalid'
        : 'service_unavailable',
    );
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
      response = await bounded(
        this.fetchImpl(url, {
          method: body ? 'POST' : 'GET',
          headers: {
            accept: 'application/json',
            ...(this.provider === 'max' ? { authorization: token } : {}),
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal,
        }),
        signal,
      );
    } catch {
      // Do not propagate fetch messages: Telegram carries its token in the URL.
      throw this.failure('service_unavailable');
    }
    if (!response.ok) throw this.requestFailure(method, response.status);
    let value: unknown;
    try {
      value = await bounded(response.json(), signal);
    } catch {
      throw this.failure('service_unavailable');
    }
    if (this.provider === 'telegram') {
      const envelope = asRecord(value);
      if (envelope?.['ok'] !== true) {
        throw this.requestFailure(method, Number(envelope?.['error_code']));
      }
      return envelope['result'];
    }
    // MAX may report a rejected callback as HTTP 200 with success:false.
    if (method.split('?')[0] === 'answers' && asRecord(value)?.['success'] === false) {
      throw new ProviderDeliveryError('callback');
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
