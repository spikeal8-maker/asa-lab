/** Backend-only settings, key binding and checked, idempotent llama.cpp apply. */
import { createHash } from 'node:crypto';
import type pg from 'pg';
import {
  discoverLlamaCpp,
  generateLlamaCppText,
  LlamaCppError,
  normalizeLlamaCppBaseUrl,
  validLlamaCppGeneration,
  validLlamaCppKey,
  validLlamaCppModel,
  type LlamaCppDiscovery,
  type LlamaCppStreamArgs,
} from './ai-llamacpp.js';
import type { NativeToolDefinition } from './ai-native-tools.js';

export interface LlamaCppSettings {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly model: string;
  readonly revision: number;
  readonly updatedAt: string | null;
  readonly apiKeyConfigured: boolean;
  readonly contextTokens: number | null;
  readonly confirmedContextTokens: number | null;
  readonly contextSource: 'metadata' | 'admin' | 'unknown';
  readonly toolsVerified: boolean;
  readonly temperature: number | null;
  readonly topP: number | null;
  readonly maxOutputTokens: number | null;
}
export interface LlamaCppRuntime extends LlamaCppSettings {
  readonly apiKey: string | null;
}
export interface LlamaCppApplyResult {
  readonly config: LlamaCppSettings;
  readonly verified: boolean;
  readonly test: {
    readonly model: string;
    readonly contextTokens: number | null;
    readonly toolsVerified: boolean;
  } | null;
}
export interface LlamaCppCredential {
  readonly api_key_ciphertext: string | null;
  readonly api_key_iv: string | null;
  readonly api_key_auth_tag: string | null;
}
interface RuntimeRow extends LlamaCppCredential {
  enabled: boolean;
  base_url: string;
  model: string;
  revision: string | number;
  updated_at?: string | Date | null;
  context_tokens?: number | null;
  confirmed_context_tokens?: number | null;
  tools_verified?: boolean;
  temperature?: number | null;
  top_p?: number | null;
  max_output_tokens?: number | null;
}
interface EncryptedKey {
  ciphertext: string;
  iv: string;
  tag: string;
  fingerprint: string;
}
export interface LlamaCppSettingsOptions {
  readonly encrypt: (secret: string) => EncryptedKey;
  readonly decrypt: (row: LlamaCppCredential) => string | null;
  /** Explicit test injection only. Production must use the transport's pinned HTTP client. */
  readonly fetchImpl?: typeof fetch | undefined;
  readonly withSlot?:
    | (<T>(
        actor: string,
        requestId: string,
        run: (signal: AbortSignal) => Promise<T>,
      ) => Promise<T>)
    | undefined;
}
interface ConnectionInput {
  baseUrl: string;
  revision: number;
  apiKey?: string;
  apiKeyEndpoint?: string;
  clearApiKey: boolean;
}
interface ApplyInput extends ConnectionInput {
  enabled: boolean;
  model: string;
  contextTokens: number | null;
  temperature: number | null;
  topP: number | null;
  maxOutputTokens: number | null;
}
type Receipt =
  | { state: 'claimed' | 'pending' }
  | { state: 'complete'; result: LlamaCppApplyResult }
  | { state: 'failed'; error: { code: string; status: number; message: string } };

const emptySettings: LlamaCppSettings = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:8080',
  model: '',
  revision: 0,
  updatedAt: null,
  apiKeyConfigured: false,
  contextTokens: null,
  confirmedContextTokens: null,
  contextSource: 'unknown',
  toolsVerified: false,
  temperature: null,
  topP: null,
  maxOutputTokens: null,
};
function safeSettings(value: LlamaCppSettings): LlamaCppSettings {
  return {
    enabled: value.enabled,
    baseUrl: value.baseUrl,
    model: value.model,
    revision: value.revision,
    updatedAt: value.updatedAt,
    apiKeyConfigured: value.apiKeyConfigured,
    contextTokens: value.contextTokens,
    confirmedContextTokens: value.confirmedContextTokens,
    contextSource: value.contextSource,
    toolsVerified: value.toolsVerified,
    temperature: value.temperature,
    topP: value.topP,
    maxOutputTokens: value.maxOutputTokens,
  };
}
function safeResult(value: LlamaCppApplyResult): LlamaCppApplyResult {
  return {
    config: safeSettings(value.config),
    verified: value.verified,
    test: value.test
      ? {
          model: value.test.model,
          contextTokens: value.test.contextTokens,
          toolsVerified: value.test.toolsVerified,
        }
      : null,
  };
}
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new LlamaCppError('ai_llamacpp_config_invalid', 400, 'Проверьте настройки llama.cpp.');
  return raw as Record<string, unknown>;
}
function connectionInput(raw: unknown): ConnectionInput {
  const input = record(raw);
  if (
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 0 ||
    (input.apiKey !== undefined && typeof input.apiKey !== 'string') ||
    (input.clearApiKey !== undefined && typeof input.clearApiKey !== 'boolean')
  )
    throw new LlamaCppError(
      'ai_llamacpp_config_invalid',
      400,
      'Нужна актуальная версия настроек llama.cpp.',
    );
  const baseUrl = normalizeLlamaCppBaseUrl(input.baseUrl);
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (apiKey && (!validLlamaCppKey(apiKey) || input.clearApiKey === true))
    throw new LlamaCppError('ai_llamacpp_key_invalid', 400, 'Проверьте API-ключ llama.cpp.');
  if (apiKey) {
    let endpoint: string | null;
    try {
      endpoint = normalizeLlamaCppBaseUrl(input.apiKeyEndpoint);
    } catch {
      endpoint = null;
    }
    if (endpoint !== baseUrl)
      throw new LlamaCppError(
        'ai_llamacpp_key_invalid',
        400,
        'Ключ привязан к другому адресу. Введите его для выбранного сервера.',
      );
  }
  return {
    baseUrl,
    revision: Number(input.revision),
    clearApiKey: input.clearApiKey === true,
    ...(apiKey ? { apiKey, apiKeyEndpoint: baseUrl } : {}),
  };
}
function applyInput(raw: unknown): ApplyInput {
  const input = record(raw);
  const base = connectionInput(input);
  if (
    typeof input.enabled !== 'boolean' ||
    typeof input.model !== 'string' ||
    (input.model !== '' && !validLlamaCppModel(input.model)) ||
    (input.enabled && !validLlamaCppModel(input.model))
  )
    throw new LlamaCppError(
      'ai_llamacpp_config_invalid',
      400,
      'Укажите модель и состояние подключения llama.cpp.',
    );
  const generation = {
    temperature: input.temperature ?? null,
    topP: input.topP ?? null,
    maxOutputTokens: input.maxOutputTokens ?? null,
    contextTokens: input.contextTokens ?? null,
  };
  if (!validLlamaCppGeneration(generation))
    throw new LlamaCppError(
      'ai_llamacpp_config_invalid',
      400,
      'Проверьте параметры генерации и контекст llama.cpp.',
    );
  return {
    ...base,
    enabled: input.enabled,
    model: input.model,
    temperature: generation.temperature as number | null,
    topP: generation.topP as number | null,
    maxOutputTokens: generation.maxOutputTokens as number | null,
    contextTokens: generation.contextTokens as number | null,
  };
}
function translate(error: unknown): LlamaCppError {
  if (error instanceof LlamaCppError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = (error as { message?: unknown } | null)?.message;
  if (code === '55000' && message === 'AI_LLAMACPP_APPLY_FAILED')
    return new LlamaCppError(
      'ai_llamacpp_apply_failed',
      409,
      'Проверка завершилась неудачно. Создайте новую попытку после исправления подключения.',
    );
  if (code === '42501')
    return new LlamaCppError(
      'ai_llamacpp_admin_denied',
      403,
      'Нет доступа к настройкам llama.cpp.',
    );
  if (code === '40001')
    return new LlamaCppError(
      'ai_llamacpp_config_changed',
      409,
      'Настройки llama.cpp изменились. Обновите страницу.',
    );
  if (code === '23505' || (code === '22023' && message === 'AI_LLAMACPP_REPLAY_CONFLICT'))
    return new LlamaCppError(
      'ai_llamacpp_replay_conflict',
      409,
      'Идентификатор проверки уже использован с другими настройками.',
    );
  if (code === '22023' || code === '22P02')
    return new LlamaCppError(
      'ai_llamacpp_config_invalid',
      400,
      'Не удалось применить настройки llama.cpp.',
    );
  return new LlamaCppError(
    'ai_llamacpp_unavailable',
    503,
    'Настройки llama.cpp временно недоступны.',
  );
}
function pendingApply(): LlamaCppError {
  return new LlamaCppError(
    'ai_llamacpp_apply_pending',
    409,
    'Эта проверка уже выполняется или ожидает восстановления результата. Повторная генерация не запущена.',
  );
}
const probeTool: NativeToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Acceptance probe only. Return its argument; this function is never executed.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', enum: ['asa_llamacpp_probe'] } },
      required: ['query'],
      additionalProperties: false,
    },
  },
};

export class LlamaCppSettingsStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly options: LlamaCppSettingsOptions,
  ) {}

  async admin(actor: string): Promise<LlamaCppSettings> {
    try {
      const row = await this.pool.query<{ value: LlamaCppSettings }>(
        'SELECT ai_llamacpp_admin_get($1) AS value',
        [actor],
      );
      if (!row.rows[0]?.value)
        throw new LlamaCppError('ai_llamacpp_unavailable', 503, 'Настройки llama.cpp недоступны.');
      return safeSettings(row.rows[0].value);
    } catch (error) {
      throw translate(error);
    }
  }

  async runtime(decryptDisabled = false): Promise<LlamaCppRuntime> {
    let row: RuntimeRow | undefined;
    try {
      row = (await this.pool.query<RuntimeRow>('SELECT * FROM ai_llamacpp_runtime()')).rows[0];
    } catch (error) {
      // Mixed deployment versions fail closed for the new provider without disabling old ones.
      if ((error as { code?: string }).code === '42883') return { ...emptySettings, apiKey: null };
      throw translate(error);
    }
    if (!row) return { ...emptySettings, apiKey: null };
    if (
      typeof row.enabled !== 'boolean' ||
      typeof row.base_url !== 'string' ||
      typeof row.model !== 'string' ||
      !Number.isSafeInteger(Number(row.revision)) ||
      Number(row.revision) < 0
    )
      return { ...emptySettings, apiKey: null };
    let apiKey: string | null = null;
    if ((row.enabled || decryptDisabled) && row.api_key_ciphertext) {
      try {
        apiKey = this.options.decrypt(row);
      } catch {
        apiKey = null;
      }
      if (!apiKey || !validLlamaCppKey(apiKey))
        throw new LlamaCppError(
          'ai_llamacpp_key_decryption_failed',
          503,
          'Не удалось прочитать сохранённый ключ llama.cpp. Проверьте шифрование сервера.',
        );
    }
    const contextTokens = row.context_tokens ?? null;
    const confirmedContextTokens = row.confirmed_context_tokens ?? null;
    return {
      enabled: row.enabled,
      baseUrl: row.base_url,
      model: row.model,
      revision: Number(row.revision),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      apiKeyConfigured: Boolean(row.api_key_ciphertext),
      apiKey,
      contextTokens,
      confirmedContextTokens,
      contextSource:
        confirmedContextTokens !== null ? 'metadata' : contextTokens !== null ? 'admin' : 'unknown',
      toolsVerified: row.tools_verified === true,
      temperature: row.temperature ?? null,
      topP: row.top_p ?? null,
      maxOutputTokens: row.max_output_tokens ?? null,
    };
  }

  private async candidateKey(
    input: ConnectionInput,
    current: LlamaCppSettings,
  ): Promise<string | undefined> {
    if (input.apiKey) return input.apiKey;
    if (
      input.clearApiKey ||
      normalizeLlamaCppBaseUrl(current.baseUrl) !== input.baseUrl ||
      !current.apiKeyConfigured
    )
      return undefined;
    const runtime = await this.runtime(true);
    if (
      runtime.revision !== input.revision ||
      normalizeLlamaCppBaseUrl(runtime.baseUrl) !== input.baseUrl
    )
      throw new LlamaCppError(
        'ai_llamacpp_config_changed',
        409,
        'Настройки llama.cpp изменились. Обновите страницу.',
      );
    return runtime.apiKey ?? undefined;
  }

  async discover(actor: string, raw: unknown): Promise<LlamaCppDiscovery> {
    const current = await this.admin(actor);
    const input = connectionInput(raw);
    if (current.revision !== input.revision)
      throw new LlamaCppError(
        'ai_llamacpp_config_changed',
        409,
        'Настройки llama.cpp изменились. Обновите страницу.',
      );
    const apiKey = await this.candidateKey(input, current);
    return discoverLlamaCpp({ baseUrl: input.baseUrl, apiKey, fetchImpl: this.options.fetchImpl });
  }

  async apply(actor: string, raw: unknown, requestId: string): Promise<LlamaCppApplyResult> {
    // Authorization is always checked before reading receipts or network access.
    await this.admin(actor);
    const input = applyInput(raw);
    if (
      typeof requestId !== 'string' ||
      !requestId.length ||
      requestId.length > 128 ||
      /[\p{Cc}\p{Cf}]/u.test(requestId)
    )
      throw new LlamaCppError(
        'ai_llamacpp_config_invalid',
        400,
        'Нужен постоянный идентификатор проверки.',
      );
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          enabled: input.enabled,
          baseUrl: input.baseUrl,
          model: input.model,
          revision: input.revision,
          temperature: input.temperature,
          topP: input.topP,
          maxOutputTokens: input.maxOutputTokens,
          contextTokens: input.contextTokens,
          keyAction: input.apiKey ? 'replace' : input.clearApiKey ? 'clear' : 'reuse_same_endpoint',
          keyFingerprint: input.apiKey
            ? createHash('sha256').update(input.apiKey).digest('hex')
            : null,
        }),
      )
      .digest('hex');
    let receipt: Receipt | undefined;
    try {
      receipt = (
        await this.pool.query<{ value: Receipt }>(
          'SELECT ai_llamacpp_apply_claim($1,$2::varchar,$3::varchar,$4::bigint) AS value',
          [actor, requestId, digest, input.revision],
        )
      ).rows[0]?.value;
    } catch (error) {
      const failure = translate(error);
      // A lost claim response can already have registered this request durably.
      throw failure.code === 'ai_llamacpp_unavailable' ? pendingApply() : failure;
    }
    if (receipt?.state === 'complete') return safeResult(receipt.result);
    if (receipt?.state === 'failed')
      throw new LlamaCppError(receipt.error.code, receipt.error.status, receipt.error.message);
    if (receipt?.state !== 'claimed') throw pendingApply();

    try {
      const current = await this.admin(actor);
      if (current.revision !== input.revision)
        throw new LlamaCppError(
          'ai_llamacpp_config_changed',
          409,
          'Настройки llama.cpp изменились. Обновите страницу.',
        );
      const sameEndpoint = normalizeLlamaCppBaseUrl(current.baseUrl) === input.baseUrl;
      const apiKey = input.enabled ? await this.candidateKey(input, current) : input.apiKey;
      let encrypted: EncryptedKey | null = null;
      if (input.apiKey) {
        try {
          encrypted = this.options.encrypt(input.apiKey);
        } catch {
          throw new LlamaCppError(
            'ai_llamacpp_encryption_unavailable',
            503,
            'На сервере недоступно шифрование ключей llama.cpp.',
          );
        }
      }
      const action = encrypted ? 'replace' : input.clearApiKey || !sameEndpoint ? 'clear' : 'keep';
      let confirmedContextTokens =
        sameEndpoint && current.model === input.model ? current.confirmedContextTokens : null;
      let toolsVerified =
        sameEndpoint && current.model === input.model ? current.toolsVerified : false;
      let test: LlamaCppApplyResult['test'] = null;
      if (input.enabled) {
        const verify = async (signal: AbortSignal) => {
          const discovery = await discoverLlamaCpp({
            baseUrl: input.baseUrl,
            apiKey,
            signal,
            fetchImpl: this.options.fetchImpl,
          });
          const model = discovery.models.find((item) => item.id === input.model);
          if (!model)
            throw new LlamaCppError(
              'ai_llamacpp_model_missing',
              503,
              'Выбранная модель отсутствует на сервере llama.cpp.',
            );
          confirmedContextTokens = model.contextTokens;
          if (
            (confirmedContextTokens !== null &&
              input.contextTokens !== null &&
              input.contextTokens > confirmedContextTokens) ||
            (input.maxOutputTokens !== null &&
              confirmedContextTokens !== null &&
              input.maxOutputTokens > confirmedContextTokens)
          )
            throw new LlamaCppError(
              'ai_llamacpp_context_invalid',
              400,
              'Лимит превышает подтверждённый рабочий контекст llama.cpp.',
            );
          const args: LlamaCppStreamArgs = {
            baseUrl: input.baseUrl,
            model: input.model,
            apiKey,
            signal,
            fetchImpl: this.options.fetchImpl,
            instructions:
              'This is a connection test. Reply with the single word OK, without reasoning.',
            context: [{ role: 'user', content: 'Reply OK.' }],
            onDelta: () => undefined,
            maxOutputTokens: 512,
            temperature: input.temperature,
            topP: input.topP,
          };
          const result = await generateLlamaCppText(args);
          if (!result.text.trim() || result.stopped || signal.aborted)
            throw new LlamaCppError(
              'ai_llamacpp_response_empty',
              503,
              'Проверка llama.cpp не получила завершённого ответа.',
            );
          toolsVerified = false;
          try {
            const probe = await generateLlamaCppText({
              ...args,
              tools: [probeTool],
              instructions:
                'Call web_search with query asa_llamacpp_probe. This is a tool syntax acceptance test; nothing will be executed.',
              context: [
                {
                  role: 'user',
                  content:
                    'Return the web_search function call with query exactly asa_llamacpp_probe.',
                },
              ],
            });
            toolsVerified =
              !probe.stopped &&
              probe.toolCalls?.length === 1 &&
              probe.toolCalls[0]?.name === 'web_search' &&
              probe.toolCalls[0]?.arguments.query === 'asa_llamacpp_probe';
          } catch (error) {
            if (
              !(error instanceof LlamaCppError) ||
              ![
                'ai_tool_call_invalid',
                'ai_llamacpp_response_empty',
                'ai_llamacpp_request_rejected',
                'ai_llamacpp_invalid',
              ].includes(error.code)
            )
              throw error;
            // An unsupported tool format does not invalidate a verified text connection.
          }
          if (signal.aborted)
            throw new LlamaCppError(
              'ai_llamacpp_apply_failed',
              503,
              'Проверка llama.cpp прервана. Настройки сохранены без изменений.',
            );
          test = { model: input.model, contextTokens: confirmedContextTokens, toolsVerified };
        };
        if (!this.options.withSlot)
          throw new LlamaCppError(
            'ai_llamacpp_unavailable',
            503,
            'Защита слота llama.cpp недоступна.',
          );
        await this.options.withSlot(actor, requestId, verify);
      }
      const body = {
        enabled: input.enabled,
        baseUrl: input.baseUrl,
        model: input.model,
        revision: input.revision,
        contextTokens: input.contextTokens,
        confirmedContextTokens,
        toolsVerified,
        temperature: input.temperature,
        topP: input.topP,
        maxOutputTokens: input.maxOutputTokens,
        action,
        ciphertext: encrypted?.ciphertext ?? null,
        iv: encrypted?.iv ?? null,
        tag: encrypted?.tag ?? null,
        fingerprint: encrypted?.fingerprint ?? null,
        applyDigest: digest,
        verified: input.enabled,
        test,
      };
      const saved = await this.pool.query<{ value: LlamaCppApplyResult }>(
        'SELECT ai_llamacpp_admin_set($1,$2::jsonb,$3::varchar) AS value',
        [actor, JSON.stringify(body), requestId],
      );
      if (!saved.rows[0]?.value)
        throw new LlamaCppError(
          'ai_llamacpp_unavailable',
          503,
          'Результат сохранения llama.cpp неизвестен. Повторите тот же запрос.',
        );
      return safeResult(saved.rows[0].value);
    } catch (error) {
      const failure = translate(error);
      // SQL only changes pending receipts. A lost successful commit response
      // must remain complete, and a lost failure response may already be failed.
      await this.pool
        .query('SELECT ai_llamacpp_apply_fail($1,$2::varchar,$3::varchar,$4::jsonb)', [
          actor,
          requestId,
          digest,
          JSON.stringify({ code: failure.code, status: failure.status, message: failure.message }),
        ])
        .catch(() => undefined);
      let outcome: Receipt | undefined;
      try {
        outcome = (
          await this.pool.query<{ value: Receipt }>(
            'SELECT ai_llamacpp_apply_claim($1,$2::varchar,$3::varchar,$4::bigint) AS value',
            [actor, requestId, digest, input.revision],
          )
        ).rows[0]?.value;
      } catch {
        throw pendingApply();
      }
      // Only a durable terminal receipt authorizes a terminal response. Keep
      // the same request ID when storage cannot establish the outcome.
      if (outcome?.state === 'complete') return safeResult(outcome.result);
      if (outcome?.state === 'failed')
        throw new LlamaCppError(outcome.error.code, outcome.error.status, outcome.error.message);
      throw pendingApply();
    }
  }
}
