import { createHash, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { hashSessionToken } from '@asa-lab/identity';
import { type BotAuthProvider } from './auth-provider-availability.js';
import { providerText, providerUserId } from './provider-init-data.js';
import { asRecord, ProviderDeliveryError } from './bot-provider-transport.js';
import type { IngressProbeResponse } from './bot-provider-ingress.js';
import { BotProviderRuntime } from './bot-provider-runtime.js';

interface BotUpdate {
  readonly subject: string;
  readonly username: string | null;
  readonly displayName: string | null;
  readonly payload: string | null;
  readonly action: 'start' | 'approve' | 'other';
  readonly callbackId: string | null;
}

export function parseBotUpdate(
  provider: BotAuthProvider,
  body: Record<string, unknown>,
): BotUpdate | null {
  let user: Record<string, unknown> | null;
  let payload: string | null;
  let action: BotUpdate['action'];
  let callbackId: string | null;
  if (provider === 'telegram') {
    const callback = asRecord(body['callback_query']);
    const message = asRecord(body['message']);
    user = callback ? asRecord(callback['from']) : asRecord(message?.['from']);
    const text = providerText(message?.['text'], 512);
    payload = callback
      ? providerText(callback['data'], 64)
      : (text?.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+(pair_[A-Za-z0-9_-]{43})$/)?.[1] ?? null);
    action = callback ? 'approve' : payload ? 'start' : 'other';
    callbackId = providerText(callback?.['id'], 255);
  } else {
    const callback = asRecord(body['callback']) ?? asRecord(body['message_callback']);
    const message = asRecord(body['message']);
    // The callback's human actor always precedes the original bot message.
    user = callback
      ? (asRecord(callback['user']) ?? asRecord(body['user']))
      : (asRecord(body['user']) ?? asRecord(message?.['sender']));
    const type = body['update_type'];
    payload = callback
      ? providerText(callback['payload'] ?? callback['data'], 512)
      : providerText(body['payload'], 512);
    action =
      type === 'message_callback' && callback
        ? 'approve'
        : type === 'bot_started'
          ? 'start'
          : 'other';
    callbackId = providerText(callback?.['callback_id'] ?? callback?.['id'], 255);
  }
  const subject = providerUserId(user?.['user_id'] ?? user?.['id']);
  if (!subject || user?.['is_bot'] === true) return null;
  const firstName = providerText(user?.['first_name'], 128);
  const lastName = providerText(user?.['last_name'], 128);
  return {
    subject,
    payload,
    action,
    callbackId,
    username: providerText(user?.['username'], 64),
    displayName:
      providerText([firstName, lastName].filter(Boolean).join(' '), 255) ??
      providerText(user?.['name'], 255),
  };
}

/** Webhook proof is recorded first; only the initiating browser can consume it. */
export class BotProviderWebhook {
  constructor(
    private readonly pool: pg.Pool,
    private readonly runtimeProvider: BotProviderRuntime,
  ) {}

  private async sendBotMessage(
    token: string,
    subject: string,
    text: string,
    confirmationPayload?: string,
  ): Promise<void> {
    const label = 'Подтвердить вход в ASA Lab';
    await this.runtimeProvider.request(
      token,
      this.runtimeProvider.provider === 'max'
        ? `messages?user_id=${encodeURIComponent(subject)}`
        : 'sendMessage',
      this.runtimeProvider.provider === 'max'
        ? {
            text,
            ...(confirmationPayload
              ? {
                  attachments: [
                    {
                      type: 'inline_keyboard',
                      payload: {
                        buttons: [
                          [{ type: 'callback', text: label, payload: confirmationPayload }],
                        ],
                      },
                    },
                  ],
                }
              : {}),
          }
        : {
            chat_id: subject,
            text,
            ...(confirmationPayload
              ? {
                  reply_markup: {
                    inline_keyboard: [[{ text: label, callback_data: confirmationPayload }]],
                  },
                }
              : {}),
          },
    );
  }

  async handleWebhook(
    suppliedSecret: unknown,
    body: unknown,
  ): Promise<'accepted' | 'duplicate' | 'unauthorized' | IngressProbeResponse> {
    const ingress = await this.runtimeProvider.answerIngressProbe(suppliedSecret, body);
    if (ingress !== null) return ingress;
    const runtime = await this.runtimeProvider.runtime();
    const expected = this.runtimeProvider.webhookSecret(runtime);
    if (typeof suppliedSecret !== 'string' || !expected) return 'unauthorized';
    const actualBytes = Buffer.from(suppliedSecret);
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes))
      return 'unauthorized';
    if (!runtime.enabled) return 'accepted';
    const token = this.runtimeProvider.runtimeToken(runtime);
    const record = asRecord(body);
    if (!token || !record || Buffer.byteLength(JSON.stringify(record)) > 64 * 1024)
      return 'accepted';
    const update = parseBotUpdate(this.runtimeProvider.provider, record);
    if (!update || update.action === 'other') return 'accepted';
    const pairing =
      update.action === 'approve'
        ? update.payload?.match(/^approve:pair_([A-Za-z0-9_-]{43})$/)?.[1]
        : update.payload?.match(/^pair_([A-Za-z0-9_-]{43})$/)?.[1];
    if (!pairing) return 'accepted';
    const eventHash = createHash('sha256')
      .update(this.runtimeProvider.provider)
      .update(JSON.stringify(record))
      .digest('hex');
    const claimed = await this.pool.query<{ claimed: boolean }>(
      'SELECT auth_max_webhook_event_claim($1) AS claimed',
      [eventHash],
    );
    if (!claimed.rows[0]?.claimed) return 'duplicate';
    try {
      if (update.action === 'start') {
        const site = new URL(runtime.mini_app_url).hostname;
        await this.sendBotMessage(
          token,
          update.subject,
          `Вы начали вход или подключение аккаунта на ${site}. Подтвердите действие, только если сами открыли ASA Lab. Затем вернитесь на сайт.`,
          `approve:pair_${pairing}`,
        );
      } else {
        const approval = await this.pool.query<{ result: string }>(
          'SELECT auth_provider_pairing_approve($1,$2,$3,$4,$5,$6,$7,$8) AS result',
          [
            this.runtimeProvider.provider,
            hashSessionToken(pairing),
            update.subject,
            `webhook:${eventHash}`,
            Math.floor(this.runtimeProvider.now() / 1000),
            update.username,
            update.displayName,
            Number(runtime.configuration_version),
          ],
        );
        const accepted = approval.rows[0]?.result === 'approved';
        const text = accepted
          ? 'Подтверждение получено. Вернитесь в ASA Lab, чтобы завершить вход или заполнить профиль.'
          : 'Запрос недействителен или истёк. Вернитесь в ASA Lab и начните заново.';
        if (update.callbackId) {
          await this.runtimeProvider.request(
            token,
            this.runtimeProvider.provider === 'max'
              ? `answers?callback_id=${encodeURIComponent(update.callbackId)}`
              : 'answerCallbackQuery',
            this.runtimeProvider.provider === 'max'
              ? { notification: text }
              : { callback_query_id: update.callbackId, text },
          );
        } else {
          await this.sendBotMessage(token, update.subject, text);
        }
      }
      return 'accepted';
    } catch (failure) {
      // Only independent token/webhook probes may change global availability.
      // A blocked recipient or stale callback must never disable verification
      // for other Accounts. These terminal local errors are acknowledged.
      await this.runtimeProvider.availability(true);
      if (failure instanceof ProviderDeliveryError) return 'accepted';
      await this.pool
        .query('SELECT auth_provider_webhook_event_release($1)', [eventHash])
        .catch(() => undefined);
      throw this.runtimeProvider.failure('service_unavailable');
    }
  }
}
