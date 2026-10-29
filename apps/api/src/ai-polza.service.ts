import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';

export const POLZA_API_BASE = 'https://polza.ai/api/v1';
export const POLZA_STT_MODEL = 'ai-sage/gigaam-v3';
export const POLZA_AUDIO_MAX_BYTES = 512_000;

export class AiPolzaError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AiPolzaError';
  }
}

export interface PolzaAdminConfig {
  configurationVersion: number;
  enabled: boolean;
  transcriptionEnabled: boolean;
  dailySecondsLimit: number;
  globalDailySecondsLimit: number;
  maxAudioSeconds: number;
  apiKeyConfigured: boolean;
  keyFingerprint: string | null;
  updatedAt: string;
  encryptionReady: boolean;
}

interface PolzaRuntime {
  enabled: boolean;
  transcription_enabled: boolean;
  daily_seconds_limit: number;
  global_daily_seconds_limit: number;
  max_audio_seconds: number;
  api_key_ciphertext: string | null;
  api_key_iv: string | null;
  api_key_auth_tag: string | null;
  revision: number;
}

export interface PolzaSttInput {
  requestId: string;
  audioBase64: string;
  mimeType: 'audio/webm' | 'audio/ogg' | 'audio/mp4';
  durationSeconds: number;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MIME = ['audio/webm', 'audio/ogg', 'audio/mp4'] as const;
const MAX_QUEUED = 24;
const MAX_ACTIVE = 2;

function keyFromEnvironment(raw: string | undefined): Buffer | null {
  const value = raw?.trim() ?? '';
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : /^[a-zA-Z0-9_-]{43}$/.test(value)
      ? Buffer.from(value, 'base64url')
      : Buffer.alloc(0);
  return key.length === 32 ? key : null;
}

function textRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AiPolzaError('ai_polza_invalid', 400, 'Неверные параметры подключения Polza AI.');
  return value as Record<string, unknown>;
}

function validateAudio(
  input: unknown,
  maxSeconds: number,
): { bytes: Buffer; mime: PolzaSttInput['mimeType']; seconds: number; requestId: string } {
  const data = textRecord(input);
  const { audioBase64, durationSeconds, mimeType, requestId } = data;
  if (
    Object.keys(data).sort().join(',') !== 'audioBase64,durationSeconds,mimeType,requestId' ||
    typeof requestId !== 'string' ||
    !UUID.test(requestId) ||
    !Number.isFinite(durationSeconds) ||
    typeof durationSeconds !== 'number' ||
    durationSeconds <= 0 ||
    durationSeconds > maxSeconds ||
    !MIME.includes(mimeType as PolzaSttInput['mimeType']) ||
    typeof audioBase64 !== 'string' ||
    audioBase64.length < 16 ||
    audioBase64.length > Math.ceil((POLZA_AUDIO_MAX_BYTES * 4) / 3) + 8 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audioBase64)
  )
    throw new AiPolzaError('ai_stt_input_invalid', 400, 'Запись повреждена или превышает лимит.');
  const bytes = Buffer.from(audioBase64, 'base64');
  if (
    bytes.length < 16 ||
    bytes.length > POLZA_AUDIO_MAX_BYTES ||
    bytes.toString('base64') !== audioBase64
  )
    throw new AiPolzaError('ai_stt_input_invalid', 400, 'Недопустимый размер записи.');
  const type = mimeType as PolzaSttInput['mimeType'];
  const validContainer =
    type === 'audio/webm'
      ? bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      : type === 'audio/ogg'
        ? bytes.toString('ascii', 0, 4) === 'OggS'
        : bytes.toString('ascii', 4, 8) === 'ftyp';
  if (!validContainer)
    throw new AiPolzaError('ai_stt_input_invalid', 400, 'Формат аудио не соответствует записи.');
  return { bytes, mime: type, seconds: durationSeconds, requestId: requestId.toLowerCase() };
}

/** Separate encrypted credential and bounded, non-retrying speech adapter.
 * The key can later be reused for text and image adapters without merging provider slots. */
export class AiPolzaService {
  private readonly key: Buffer | null;
  private readonly fetchImpl: typeof fetch;
  private active = 0;
  private readonly inFlightOwners = new Set<string>();
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly pool: pg.Pool,
    options: { encryptionKey?: string; fetchImpl?: typeof fetch } = {},
  ) {
    this.key = keyFromEnvironment(
      options.encryptionKey ?? process.env['ASA_SETTINGS_ENCRYPTION_KEY'],
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async sqlValue<T>(sql: string, values: readonly unknown[]): Promise<T> {
    try {
      const response = await this.pool.query<{ value: T }>(sql, [...values]);
      if (!response.rows[0] || response.rows[0].value === null)
        throw new AiPolzaError('ai_polza_unavailable', 503, 'Настройки Polza AI недоступны.');
      return response.rows[0].value;
    } catch (problem) {
      if (problem instanceof AiPolzaError) throw problem;
      const message = problem instanceof Error ? problem.message : '';
      if (message.includes('AI_ADMIN_DENIED'))
        throw new AiPolzaError('ai_polza_denied', 403, 'Доступ только администратору платформы.');
      if (message.includes('AI_CONFIG_CHANGED'))
        throw new AiPolzaError(
          'ai_polza_conflict',
          409,
          'Настройки изменились. Обновите страницу.',
        );
      if (message.includes('AI_STT_REPLAY_BLOCKED'))
        throw new AiPolzaError(
          'ai_stt_request_reused',
          409,
          'Эта запись уже отправлялась. Не повторяем платный запрос.',
        );
      if (message.includes('AI_STT_DAILY_LIMIT'))
        throw new AiPolzaError('ai_stt_limit', 429, 'Дневной лимит распознавания исчерпан.');
      if (message.includes('AI_STT_DISABLED'))
        throw new AiPolzaError('ai_stt_disabled', 503, 'Транскрибация отключена администратором.');
      if (message.includes('AI_POLZA_INVALID') || message.includes('AI_KEY_REQUIRED'))
        throw new AiPolzaError('ai_polza_invalid', 400, 'Проверьте ключ и настройки подключения.');
      throw problem;
    }
  }

  private encrypt(secret: string): {
    ciphertext: string;
    iv: string;
    tag: string;
    fingerprint: string;
  } {
    if (!this.key)
      throw new AiPolzaError(
        'ai_polza_encryption_unavailable',
        503,
        'Шифрование ключей на сервере недоступно.',
      );
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return {
      ciphertext: encrypted.toString('base64url'),
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      fingerprint: createHash('sha256').update(secret).digest('hex').slice(0, 12),
    };
  }

  private decrypt(row: PolzaRuntime): string {
    if (!this.key || !row.api_key_ciphertext || !row.api_key_iv || !row.api_key_auth_tag)
      throw new AiPolzaError('ai_polza_key_unavailable', 503, 'Ключ Polza AI не настроен.');
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(row.api_key_iv, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(row.api_key_auth_tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(row.api_key_ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new AiPolzaError(
        'ai_polza_key_invalid',
        503,
        'Не удалось прочитать сохранённый API-ключ.',
      );
    }
  }

  private async runtime(): Promise<PolzaRuntime> {
    const r = await this.pool.query<PolzaRuntime>('SELECT * FROM public.ai_polza_runtime()');
    if (!r.rows[0])
      throw new AiPolzaError('ai_polza_unavailable', 503, 'Настройки Polza AI не установлены.');
    return r.rows[0];
  }

  async admin(actor: string): Promise<PolzaAdminConfig> {
    const data = await this.sqlValue<Omit<PolzaAdminConfig, 'encryptionReady'>>(
      'SELECT public.ai_polza_admin_config($1::uuid) AS value',
      [actor],
    );
    return { ...data, encryptionReady: this.key !== null };
  }

  async save(actor: string, input: unknown): Promise<PolzaAdminConfig> {
    const body = textRecord(input);
    const {
      configurationVersion,
      enabled,
      transcriptionEnabled,
      dailySecondsLimit,
      globalDailySecondsLimit,
      maxAudioSeconds,
      apiKey,
      clearApiKey,
    } = body;
    if (
      !Number.isSafeInteger(configurationVersion) ||
      Number(configurationVersion) < 1 ||
      typeof enabled !== 'boolean' ||
      typeof transcriptionEnabled !== 'boolean' ||
      (enabled === false && transcriptionEnabled) ||
      !Number.isSafeInteger(dailySecondsLimit) ||
      Number(dailySecondsLimit) < 60 ||
      Number(dailySecondsLimit) > 3600 ||
      !Number.isSafeInteger(globalDailySecondsLimit) ||
      Number(globalDailySecondsLimit) < 600 ||
      Number(globalDailySecondsLimit) > 86400 ||
      !Number.isSafeInteger(maxAudioSeconds) ||
      Number(maxAudioSeconds) < 5 ||
      Number(maxAudioSeconds) > 30 ||
      (apiKey !== undefined &&
        (typeof apiKey !== 'string' || !/^pza_[A-Za-z0-9_-]{8,2040}$/.test(apiKey))) ||
      (clearApiKey !== undefined && typeof clearApiKey !== 'boolean') ||
      (clearApiKey === true && apiKey !== undefined)
    )
      throw new AiPolzaError('ai_polza_invalid', 400, 'Проверьте ключ, параметры и ограничения.');
    if (apiKey !== undefined && !this.key)
      throw new AiPolzaError(
        'ai_polza_encryption_unavailable',
        503,
        'Не настроено шифрование API-ключей.',
      );
    const encrypted = typeof apiKey === 'string' ? this.encrypt(apiKey) : {};
    await this.sqlValue<unknown>('SELECT public.ai_polza_admin_set($1::uuid,$2::jsonb) AS value', [
      actor,
      JSON.stringify({
        configurationVersion,
        enabled,
        transcriptionEnabled,
        dailySecondsLimit,
        globalDailySecondsLimit,
        maxAudioSeconds,
        requestId: randomUUID(),
        action: clearApiKey ? 'clear' : apiKey ? 'replace' : 'keep',
        ...encrypted,
      }),
    ]);
    return this.admin(actor);
  }

  async check(actor: string): Promise<{ ready: true; latencyMs: number; checkedAt: string }> {
    await this.admin(actor);
    const key = this.decrypt(await this.runtime());
    const began = Date.now();
    try {
      // Model listing does not perform paid transcription. Never log raw responses or the key.
      const response = await this.fetchImpl(POLZA_API_BASE + '/models', {
        method: 'GET',
        headers: { authorization: 'Bearer ' + key, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok)
        throw new AiPolzaError(
          response.status === 401 ? 'ai_polza_auth_failed' : 'ai_polza_check_failed',
          response.status === 401 ? 401 : 503,
          response.status === 401
            ? 'Polza AI отклонил API-ключ.'
            : 'Polza AI не подтвердил подключение.',
        );
      return { ready: true, latencyMs: Date.now() - began, checkedAt: new Date().toISOString() };
    } catch (problem) {
      if (problem instanceof AiPolzaError) throw problem;
      throw new AiPolzaError(
        'ai_polza_unavailable',
        503,
        'Polza AI недоступен или не ответил вовремя.',
      );
    }
  }

  async status(): Promise<{ enabled: boolean; model: string; maxAudioSeconds: number }> {
    const state = await this.runtime();
    return {
      enabled:
        state.enabled && state.transcription_enabled && !!state.api_key_ciphertext && !!this.key,
      model: POLZA_STT_MODEL,
      maxAudioSeconds: state.max_audio_seconds,
    };
  }

  private async acquire(signal?: AbortSignal): Promise<() => void> {
    const cancelled = () =>
      new AiPolzaError('ai_stt_cancelled', 409, 'Распознавание отменено.');
    if (signal?.aborted) throw cancelled();
    const release = () => {
      // Transfer the occupied slot directly to the next waiter; never admit a third
      // concurrent request in the gap between wakeup and awaited resumption.
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    };
    if (this.active < MAX_ACTIVE) {
      this.active += 1;
      return release;
    }
    if (this.waiting.length >= MAX_QUEUED)
      throw new AiPolzaError('ai_stt_busy', 429, 'Сервис распознавания занят. Повторите позже.');
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(deadline);
        signal?.removeEventListener('abort', onAbort);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        const index = this.waiting.indexOf(onReady);
        if (index !== -1) this.waiting.splice(index, 1);
        cleanup();
        reject(cancelled());
      };
      const deadline = setTimeout(() => {
        const index = this.waiting.indexOf(onReady);
        if (index !== -1) this.waiting.splice(index, 1);
        cleanup();
        reject(new AiPolzaError('ai_stt_busy', 429, 'Очередь распознавания переполнена.'));
      }, 25000);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      else this.waiting.push(onReady);
    });
    // The departing worker transferred its active slot; do not increment active.
    return release;
  }

  async transcribe(owner: string, raw: unknown, signal?: AbortSignal): Promise<{ text: string; model: string }> {
    const state = await this.runtime();
    if (!state.enabled || !state.transcription_enabled || !state.api_key_ciphertext)
      throw new AiPolzaError('ai_stt_disabled', 503, 'Голосовой ввод пока не настроен.');
    const audio = validateAudio(raw, state.max_audio_seconds);
    if (this.inFlightOwners.has(owner))
      throw new AiPolzaError('ai_stt_busy', 429, 'Предыдущая запись ещё распознаётся.');
    this.inFlightOwners.add(owner);
    let release: (() => void) | undefined;
    try {
      release = await this.acquire(signal);
      if (signal?.aborted)
        throw new AiPolzaError('ai_stt_cancelled', 409, 'Распознавание отменено.');
      // Durable per-owner budget and UUID replay guard happen BEFORE any paid network request.
      await this.sqlValue<number>('SELECT public.ai_polza_stt_admit($1::uuid,$2::uuid) AS value', [
        owner,
        audio.requestId,
      ]);
      if (signal?.aborted)
        throw new AiPolzaError('ai_stt_cancelled', 409, 'Распознавание отменено.');
      const key = this.decrypt(state);
      const extension =
        audio.mime === 'audio/mp4' ? 'm4a' : audio.mime === 'audio/ogg' ? 'ogg' : 'webm';
      const body = new FormData();
      body.append(
        'file',
        new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }),
        'speech.' + extension,
      );
      body.append('model', POLZA_STT_MODEL);
      body.append('language', 'ru');
      let response: Response;
      try {
        response = await this.fetchImpl(POLZA_API_BASE + '/audio/transcriptions', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + key },
          body,
          redirect: 'error',
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000),
        });
      } catch {
        throw new AiPolzaError(
          'ai_stt_uncertain',
          503,
          'Ответ Polza AI неизвестен. Автоповтора нет, проверьте баланс.',
        );
      }
      if (!response.ok) {
        const code =
          response.status === 401 || response.status === 403
            ? 'ai_stt_auth'
            : response.status === 402
              ? 'ai_stt_balance'
              : response.status === 429
                ? 'ai_stt_rate'
                : 'ai_stt_upstream';
        const message =
          response.status === 402
            ? 'Недостаточно средств у провайдера.'
            : response.status === 429
              ? 'Polza AI ограничил частоту запросов.'
              : response.status === 401 || response.status === 403
                ? 'Проверьте API-ключ Polza AI.'
                : 'Polza AI не смог распознать запись.';
        throw new AiPolzaError(code, response.status === 429 ? 429 : 503, message);
      }
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > 16_384)
        throw new AiPolzaError('ai_stt_response_invalid', 502, 'Некорректный ответ распознавания.');
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        throw new AiPolzaError(
          'ai_stt_response_invalid',
          502,
          'Не удалось прочитать ответ распознавания.',
        );
      }
      const text = (result as { text?: unknown } | null)?.text;
      if (typeof text !== 'string' || text.length > 6000)
        throw new AiPolzaError('ai_stt_response_invalid', 502, 'Сервис вернул недопустимый текст.');
      return { text: text.trim(), model: POLZA_STT_MODEL };
    } finally {
      release?.();
      this.inFlightOwners.delete(owner);
    }
  }
}
