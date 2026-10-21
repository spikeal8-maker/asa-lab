import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { AiTextHistoryStore } from './ai-text-history.js';
import {
  AI_PRODUCT_FEATURES,
  buildAiTextRequest,
  getAiModelCatalog,
  isModelForProvider,
  type AiModel,
  type AiModelCatalog,
  type AiProvider,
} from './ai-model-catalog.js';
import {
  parseProviderText,
  ProviderStreamError,
  streamProviderText,
  type ProviderStreamResult,
} from './ai-provider-stream.js';

const ASSISTANT_INSTRUCTIONS =
  'Ты ИИ-помощник цифровой лаборатории ASA Lab. Помогай создавать проекты, программировать, ' +
  'разбираться в электронике, исследовать идеи и учиться. ' +
  'Отвечай на русском, если пользователь не выбрал другой язык. ' +
  'Объясняй решения и не выдавай неподтверждённые результаты за факты.';

export type { AiProvider, AiModel } from './ai-model-catalog.js';

export interface AiProviderConfiguration {
  readonly provider: AiProvider;
  readonly model: AiModel;
  readonly apiKeyConfigured: boolean;
  readonly keyFingerprint: string | null;
  readonly updatedAt: string | null;
}

export interface AiAdminConfig {
  readonly schemaVersion: 2;
  readonly modelCatalog: AiModelCatalog;
  readonly providerConfigurations: readonly AiProviderConfiguration[];
  readonly migratedFromModel: string | null;
  readonly enabled: boolean;
  readonly paidOperationsPerHour: number;
  readonly provider: AiProvider;
  readonly model: AiModel;
  readonly apiKeyConfigured: boolean;
  readonly encryptionReady: boolean;
  readonly keyFingerprint: string | null;
  readonly configurationVersion: number;
  readonly updatedAt: string | null;
}

export interface AiAdminUpdate {
  readonly enabled: boolean;
  readonly paidOperationsPerHour?: number;
  readonly provider: AiProvider;
  readonly model: AiModel;
  readonly apiKey?: string;
  readonly clearApiKey?: boolean;
  readonly configurationVersion?: number;
}

export interface AiThread {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
  readonly matchPreview?: string;
}

export interface AiMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly createdAt: string;
  readonly requestId: string;
  readonly state: 'complete' | 'stopped';
  readonly sourceUserMessageId?: string;
  readonly sourcePrompt?: string;
  readonly regenerated?: boolean;
}

export interface AiCursor {
  readonly at: string;
  readonly id: string;
}

export interface AiPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: AiCursor | null;
}

interface AdminRow {
  readonly provider_configurations: readonly AiProviderConfiguration[];
  readonly migrated_from_model: string | null;
  readonly enabled: boolean;
  readonly paid_operations_per_hour: number;
  readonly provider: AiProvider;
  readonly model: AiModel;
  readonly api_key_configured: boolean;
  readonly key_fingerprint: string | null;
  readonly configuration_version: string | number;
  readonly updated_at: Date | string | null;
}

interface RuntimeRow {
  readonly enabled: boolean;
  readonly configuration_version: string | number;
  readonly provider: AiProvider;
  readonly model: AiModel;
  readonly api_key_ciphertext: string | null;
  readonly api_key_iv: string | null;
  readonly api_key_auth_tag: string | null;
}

interface AiServiceOptions {
  readonly encryptionKey?: string;
  readonly fetchImpl?: typeof fetch;
}

export class AiServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AiServiceError';
  }
}

function rootKey(value: string | undefined): Buffer | null {
  const key = value?.trim() ?? '';
  const bytes = /^[a-fA-F0-9]{64}$/.test(key)
    ? Buffer.from(key, 'hex')
    : /^[A-Za-z0-9_-]{43}$/.test(key)
      ? Buffer.from(key, 'base64url')
      : Buffer.alloc(0);
  return bytes.length === 32 ? bytes : null;
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/**
 * Native ASA Lab AI adapter. No IZO auth, database or provider credentials are imported.
 * The existing IZO Chat is the source of the visual and interaction patterns.
 */
export class AiChatService {
  private readonly key: Buffer | null;
  private readonly fetchImpl: typeof fetch;
  private readonly history: AiTextHistoryStore;
  private readonly activeStreams = new Map<
    string,
    { principalId: string; threadId: string; abort: AbortController }
  >();

  constructor(
    private readonly pool: pg.Pool,
    options: AiServiceOptions = {},
  ) {
    this.key = rootKey(options.encryptionKey ?? process.env['ASA_SETTINGS_ENCRYPTION_KEY']);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.history = new AiTextHistoryStore(pool);
  }

  async adminConfig(principalId: string): Promise<AiAdminConfig> {
    const result = await this.pool.query<AdminRow>('SELECT * FROM ai_admin_get_config($1)', [
      principalId,
    ]);
    const row = result.rows[0];
    if (!row) throw new AiServiceError('ai_config_unavailable', 503, 'Настройки ИИ недоступны.');
    if (!Array.isArray(row.provider_configurations)) {
      throw new AiServiceError(
        'ai_config_schema_unsupported',
        503,
        'Требуется обновление схемы настроек ИИ.',
      );
    }
    return {
      schemaVersion: 2,
      modelCatalog: getAiModelCatalog(),
      providerConfigurations: row.provider_configurations.map((slot) => ({
        provider: slot.provider,
        model: slot.model,
        apiKeyConfigured: slot.apiKeyConfigured,
        keyFingerprint: slot.keyFingerprint,
        updatedAt: iso(slot.updatedAt),
      })),
      migratedFromModel: row.migrated_from_model,
      enabled: row.enabled,
      paidOperationsPerHour: row.paid_operations_per_hour ?? 0,
      provider: row.provider,
      model: row.model,
      apiKeyConfigured: row.api_key_configured,
      encryptionReady: this.key !== null,
      keyFingerprint: row.key_fingerprint,
      configurationVersion: Number(row.configuration_version),
      updatedAt: iso(row.updated_at),
    };
  }

  async saveAdminConfig(
    principalId: string,
    input: AiAdminUpdate,
    requestId: string,
  ): Promise<AiAdminConfig> {
    if (
      input.paidOperationsPerHour !== undefined &&
      (!Number.isInteger(input.paidOperationsPerHour) ||
        input.paidOperationsPerHour < 0 ||
        input.paidOperationsPerHour > 2147483647)
    ) {
      throw new AiServiceError(
        'ai_config_invalid',
        400,
        'Лимит должен быть целым числом от 0 до 2147483647.',
      );
    }
    if (!isModelForProvider(input.provider, input.model)) {
      throw new AiServiceError('ai_model_invalid', 400, 'Модель не соответствует провайдеру.');
    }
    const before = await this.adminConfig(principalId);
    const expectedVersion = input.configurationVersion ?? before.configurationVersion;
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1 ||
      expectedVersion !== before.configurationVersion
    ) {
      throw new AiServiceError(
        'ai_config_changed',
        409,
        'Настройки изменились. Перезагрузите страницу.',
      );
    }
    const target = before.providerConfigurations.find((slot) => slot.provider === input.provider);
    const candidate = input.apiKey?.trim() ?? '';
    if (
      input.apiKey !== undefined &&
      candidate &&
      (candidate.length < 12 || candidate.length > 2048)
    ) {
      throw new AiServiceError('ai_key_invalid', 400, 'Недопустимая длина API-ключа.');
    }
    if (input.clearApiKey && candidate) {
      throw new AiServiceError(
        'ai_key_invalid',
        400,
        'Нельзя заменить и очистить ключ одновременно.',
      );
    }
    if (before.provider !== input.provider && !candidate && !target?.apiKeyConfigured) {
      throw new AiServiceError(
        'ai_key_required',
        409,
        'Сначала добавьте API-ключ выбранного провайдера.',
      );
    }
    if (input.enabled && (input.clearApiKey || (!candidate && !target?.apiKeyConfigured))) {
      throw new AiServiceError('ai_key_required', 409, 'Сначала добавьте API-ключ.');
    }
    if ((candidate || input.enabled) && !this.key) {
      throw new AiServiceError(
        'ai_encryption_unavailable',
        503,
        'На сервере не настроено шифрование секретов.',
      );
    }

    const encrypted = candidate ? this.encrypt(candidate) : null;
    const action = input.clearApiKey ? 'clear' : encrypted ? 'replace' : 'keep';
    try {
      await this.pool.query(
        'SELECT ai_admin_set_config($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::integer,$12::bigint)',
        [
          principalId,
          input.enabled,
          input.provider,
          input.model,
          action,
          encrypted?.ciphertext ?? null,
          encrypted?.iv ?? null,
          encrypted?.tag ?? null,
          encrypted?.fingerprint ?? null,
          requestId,
          input.paidOperationsPerHour ?? null,
          expectedVersion,
        ],
      );
    } catch (problem) {
      this.rethrowAdmissionError(problem);
      if ((problem as { code?: string }).code === '42501') {
        throw new AiServiceError('ai_admin_denied', 403, 'Нет доступа к настройкам ИИ.');
      }
      if ((problem as { code?: string }).code === '22023') {
        throw new AiServiceError('ai_config_invalid', 400, 'Не удалось сохранить настройки ИИ.');
      }
      throw problem;
    }
    const after = await this.adminConfig(principalId);
    if (after.configurationVersion !== expectedVersion + 1) {
      throw new AiServiceError(
        'ai_config_changed',
        409,
        'После сохранения настройки снова изменились. Перезагрузите страницу.',
      );
    }
    return after;
  }

  async testConnection(
    principalId: string,
    expectedVersion: number,
  ): Promise<{
    provider: AiProvider;
    model: AiModel;
    testedAt: string;
    elapsedMs: number;
    configurationVersion: number;
  }> {
    const config = await this.adminConfig(principalId);
    if (config.configurationVersion !== expectedVersion) {
      throw new AiServiceError(
        'ai_config_changed',
        409,
        'Настройки изменились. Перезагрузите страницу.',
      );
    }
    const runtime = await this.runtime();
    this.requireSupportedModel(runtime);
    const key = this.decrypt(runtime);
    if (!key) {
      throw new AiServiceError(
        'ai_key_unavailable',
        503,
        'Сохранённый ключ отсутствует или не расшифровывается.',
      );
    }
    const started = Date.now();
    try {
      // SQL rechecks the real platform-admin role and configuration version,
      // then durably reserves from the same quota used by chat admission.
      const admission = await this.pool.query<{ admitted: boolean }>(
        'SELECT ai_admin_test_begin($1,$2::bigint) AS admitted',
        [principalId, expectedVersion],
      );
      if (admission.rows[0]?.admitted !== true) {
        throw new AiServiceError(
          'ai_admission_unavailable',
          503,
          'Допуск платной операции не подтверждён.',
        );
      }
      const result = await streamProviderText({
        fetchImpl: this.fetchImpl,
        provider: runtime.provider,
        model: runtime.model,
        apiKey: key,
        context: [{ role: 'user', content: 'Reply with the single word OK.' }],
        instructions: 'This is a connection test. Reply briefly.',
        signal: new AbortController().signal,
        onDelta: () => undefined,
      });
      if (result.stopped || !result.text.trim()) {
        throw new AiServiceError(
          'ai_test_incomplete',
          503,
          'Модель не завершила проверочный ответ.',
        );
      }
    } catch (problem) {
      this.rethrowAdmissionError(problem);
      if (problem instanceof ProviderStreamError) {
        throw new AiServiceError(problem.code, problem.status, problem.message);
      }
      throw problem;
    }
    const after = await this.adminConfig(principalId);
    if (after.configurationVersion !== expectedVersion) {
      throw new AiServiceError('ai_config_changed', 409, 'Во время проверки настройки изменились.');
    }
    return {
      provider: config.provider,
      model: config.model,
      testedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      configurationVersion: expectedVersion,
    };
  }

  async status(): Promise<{
    enabled: boolean;
    provider: AiProvider;
    model: AiModel;
    availableModels: readonly AiModel[];
    modelCatalog: AiModelCatalog;
    productFeatures: typeof AI_PRODUCT_FEATURES;
  }> {
    const config = await this.runtime();
    const modelCatalog = getAiModelCatalog();
    return {
      enabled:
        config.enabled &&
        isModelForProvider(config.provider, config.model) &&
        this.decrypt(config) !== null,
      provider: config.provider,
      model: config.model,
      availableModels: modelCatalog.models
        .filter((model) => model.provider === config.provider && model.selectable)
        .map((model) => model.id),
      modelCatalog,
      productFeatures: AI_PRODUCT_FEATURES,
    };
  }

  async threads(principalId: string): Promise<readonly AiThread[]> {
    return (await this.history.threads(principalId, null)).items;
  }

  async threadPage(
    principalId: string,
    cursor: AiCursor | null = null,
    query = '',
    archived = false,
  ): Promise<AiPage<AiThread>> {
    return this.history.threads(principalId, cursor, query, archived);
  }

  async archiveThread(principalId: string, threadId: string, archived: boolean): Promise<AiThread> {
    try {
      return await this.history.archive(principalId, threadId, archived);
    } catch (problem) {
      this.rethrowTextError(problem);
      throw problem;
    }
  }

  async renameThread(principalId: string, threadId: string, title: string): Promise<AiThread> {
    const trimmed = title.trim();
    if (trimmed.length < 1 || trimmed.length > 120) {
      throw new AiServiceError(
        'ai_title_invalid',
        400,
        'Название должно быть от 1 до 120 символов.',
      );
    }
    const result = await this.pool.query<{
      id: string;
      title: string;
      updated_at: Date | string;
    }>('SELECT * FROM ai_chat_rename($1,$2,$3::varchar)', [principalId, threadId, trimmed]);
    const row = result.rows[0];
    if (!row) throw new AiServiceError('ai_thread_not_found', 404, 'Диалог не найден.');
    return { id: row.id, title: row.title, updatedAt: new Date(row.updated_at).toISOString() };
  }

  async deleteThread(principalId: string, threadId: string): Promise<{ deleted: true }> {
    const result = await this.pool.query<{ deleted: boolean }>(
      'SELECT ai_chat_delete($1,$2) AS deleted',
      [principalId, threadId],
    );
    if (result.rows[0]?.deleted !== true) {
      throw new AiServiceError(
        'ai_thread_not_available',
        409,
        'Диалог не найден или запрос ещё выполняется.',
      );
    }
    return { deleted: true };
  }

  async createThread(principalId: string): Promise<{ id: string }> {
    try {
      const result = await this.pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [
        principalId,
      ]);
      const id = result.rows[0]?.id;
      if (!id) throw new AiServiceError('ai_thread_unavailable', 503, 'Не удалось создать диалог.');
      return { id };
    } catch (problem) {
      this.rethrowAdmissionError(problem);
      throw problem;
    }
  }

  async messages(principalId: string, threadId: string): Promise<readonly AiMessage[]> {
    return this.history.messages(principalId, threadId);
  }

  async requestMessages(
    principalId: string,
    threadId: string,
    requestId: string,
  ): Promise<readonly AiMessage[]> {
    return this.history.requestMessages(principalId, threadId, requestId);
  }

  async messagePage(
    principalId: string,
    threadId: string,
    cursor: AiCursor | null = null,
  ): Promise<AiPage<AiMessage>> {
    return this.history.messagePage(principalId, threadId, cursor);
  }

  async send(
    principalId: string,
    threadId: string,
    text: string,
    clientRequestId: string,
  ): Promise<{ readonly messages: readonly AiMessage[]; readonly replayed: boolean }> {
    const prompt = text.trim();
    if (prompt.length < 1 || prompt.length > 3000) {
      throw new AiServiceError(
        'ai_input_invalid',
        400,
        'Сообщение должно содержать от 1 до 3000 символов.',
      );
    }
    const runtime = await this.runtime();
    this.requireSupportedModel(runtime);
    const apiKey = this.decrypt(runtime);
    if (!runtime.enabled || !apiKey) {
      throw new AiServiceError(
        'ai_disabled',
        503,
        'ИИ не подключён. Настройте провайдера в админке.',
      );
    }
    const requestId = clientRequestId.toLowerCase();
    let accepted: boolean;
    try {
      const admitted = await this.pool.query<{ admitted: boolean }>(
        'SELECT ai_text_begin_paid($1,$2,$3,$4::varchar,$5::bigint) AS admitted',
        [principalId, threadId, requestId, prompt, runtime.configuration_version],
      );
      accepted = admitted.rows[0]?.admitted === true;
    } catch (problem) {
      this.rethrowTextError(problem);
      this.rethrowAdmissionError(problem);
      if ((problem as { code?: string }).code === '42501') {
        throw new AiServiceError('ai_access_denied', 403, 'Доступ к диалогу запрещён.');
      }
      if ((problem as { code?: string }).code === '22023') {
        throw new AiServiceError('ai_input_invalid', 400, 'Сообщение слишком длинное.');
      }
      const message = (problem as Error).message;
      if (message.includes('AI_RATE_LIMIT')) {
        throw new AiServiceError(
          'ai_rate_limit',
          429,
          'Лимит: 30 сообщений в час в выбранном контексте чата.',
        );
      }
      if (message.includes('AI_THREAD_BUSY_OR_MISSING')) {
        throw new AiServiceError(
          'ai_thread_busy',
          409,
          'Диалог недоступен или запрос уже выполняется.',
        );
      }
      throw problem;
    }
    if (!accepted) {
      // After a lost response, never repeat a paid model POST for the same operation.
      return { messages: await this.messages(principalId, threadId), replayed: true };
    }

    try {
      const context = await this.history.generationContext(principalId, threadId, requestId);
      const reply = await this.generate(runtime, apiKey, context);
      await this.pool.query('SELECT ai_chat_finish($1,$2,$3,$4::varchar,$5::varchar)', [
        principalId,
        threadId,
        requestId,
        reply.text,
        reply.stopped ? 'stopped' : 'complete',
      ]);
      return { messages: await this.messages(principalId, threadId), replayed: false };
    } catch (problem) {
      if (problem instanceof ProviderStreamError && problem.partialText.trim()) {
        await this.pool.query('SELECT ai_chat_finish($1,$2,$3,$4::varchar,$5::varchar)', [
          principalId,
          threadId,
          requestId,
          problem.partialText.slice(0, 8192),
          'stopped',
        ]);
      } else {
        await this.pool
          .query('SELECT ai_chat_abort($1,$2,$3)', [principalId, threadId, requestId])
          .catch(() => undefined);
      }
      if (problem instanceof ProviderStreamError) {
        throw new AiServiceError(problem.code, problem.status, problem.message);
      }
      if (problem instanceof AiServiceError) throw problem;
      throw new AiServiceError(
        'ai_provider_unavailable',
        503,
        'ИИ временно недоступен. Сообщение сохранено.',
      );
    }
  }

  /**
   * A single paid upstream invocation feeds an SSE browser connection.
   * The existing JSON endpoint stays intact for older clients.
   * Neither a replay nor a lost response can trigger another upstream POST.
   */
  async sendStream(
    principalId: string,
    threadId: string,
    text: string,
    requestId: string,
    onDelta: (delta: string) => void,
    clientSignal: AbortSignal,
    selectedModel?: AiModel,
    regenerateFrom?: string,
  ): Promise<{
    readonly messages: readonly AiMessage[];
    readonly replayed: boolean;
    readonly stopped: boolean;
  }> {
    principalId = principalId.toLowerCase();
    threadId = threadId.toLowerCase();
    requestId = requestId.toLowerCase();
    const sourceId = regenerateFrom?.toLowerCase();
    const prompt = text.trim();
    if (!sourceId && (prompt.length < 1 || prompt.length > 3000)) {
      throw new AiServiceError(
        'ai_input_invalid',
        400,
        'Сообщение должно содержать от 1 до 3000 символов.',
      );
    }
    if (sourceId) {
      try {
        const receipt = await this.pool.query<{ replayed: boolean }>(
          'SELECT ai_text_regeneration_replay($1,$2,$3,$4) AS replayed',
          [principalId, threadId, requestId, sourceId],
        );
        if (receipt.rows[0]?.replayed === true) {
          const messages = await this.requestMessages(principalId, threadId, requestId);
          return { messages, replayed: true, stopped: messages.some((m) => m.state === 'stopped') };
        }
      } catch (problem) {
        this.rethrowTextError(problem);
        throw problem;
      }
    }
    const runtime = await this.runtime();
    const model = selectedModel ?? runtime.model;
    if (!isModelForProvider(runtime.provider, model)) {
      throw new AiServiceError(
        'ai_model_invalid',
        400,
        'Модель не поддерживается выбранным провайдером.',
      );
    }
    const apiKey = this.decrypt(runtime);
    if (!runtime.enabled || !apiKey) {
      throw new AiServiceError(
        'ai_disabled',
        503,
        'ИИ не подключён. Настройте провайдера в админке.',
      );
    }

    let admitted: boolean;
    try {
      const result = await this.pool.query<{ admitted: boolean }>(
        sourceId
          ? 'SELECT ai_text_regenerate_begin($1,$2,$3,$4,$5::bigint) AS admitted'
          : 'SELECT ai_text_begin_paid($1,$2,$3,$4::varchar,$5::bigint) AS admitted',
        [principalId, threadId, requestId, sourceId ?? prompt, runtime.configuration_version],
      );
      admitted = result.rows[0]?.admitted === true;
    } catch (problem) {
      this.rethrowTextError(problem);
      const code = (problem as { code?: string }).code;
      const message = (problem as Error).message;
      this.rethrowAdmissionError(problem);
      if (code === '42501') {
        throw new AiServiceError('ai_access_denied', 403, 'Доступ к диалогу запрещён.');
      }
      if (code === '22023') {
        throw new AiServiceError('ai_input_invalid', 400, 'Неверный запрос или его идентификатор.');
      }
      if (message.includes('AI_RATE_LIMIT')) {
        throw new AiServiceError(
          'ai_rate_limit',
          429,
          'Лимит: 30 сообщений в час в выбранном контексте чата.',
        );
      }
      if (message.includes('AI_THREAD_BUSY_OR_MISSING')) {
        throw new AiServiceError(
          'ai_thread_busy',
          409,
          'Диалог недоступен или запрос уже выполняется.',
        );
      }
      throw problem;
    }

    if (!admitted) {
      const messages = sourceId
        ? await this.requestMessages(principalId, threadId, requestId)
        : await this.messages(principalId, threadId);
      return {
        replayed: true,
        stopped: sourceId ? messages.some((m) => m.state === 'stopped') : false,
        messages,
      };
    }

    const abort = new AbortController();
    const operationKey = principalId + ':' + requestId;
    const combined = AbortSignal.any([clientSignal, abort.signal]);
    this.activeStreams.set(operationKey, { principalId, threadId, abort });
    try {
      const context = await this.history.generationContext(principalId, threadId, requestId);
      const result = await streamProviderText({
        fetchImpl: this.fetchImpl,
        provider: runtime.provider,
        model,
        apiKey,
        context,
        instructions: ASSISTANT_INSTRUCTIONS,
        signal: combined,
        onDelta,
      });

      if (result.text.trim()) {
        await this.pool.query('SELECT ai_chat_finish($1,$2,$3,$4::varchar,$5::varchar)', [
          principalId,
          threadId,
          requestId,
          result.text.slice(0, 8192),
          result.stopped ? 'stopped' : 'complete',
        ]);
      } else {
        await this.pool.query('SELECT ai_chat_abort($1,$2,$3)', [principalId, threadId, requestId]);
      }
      return {
        messages: sourceId
          ? await this.requestMessages(principalId, threadId, requestId)
          : await this.messages(principalId, threadId),
        replayed: false,
        stopped: result.stopped,
      };
    } catch (problem) {
      if (problem instanceof ProviderStreamError && problem.partialText.trim()) {
        // Preserve a visible partial answer before releasing this request's SQL lease.
        await this.pool.query('SELECT ai_chat_finish($1,$2,$3,$4::varchar,$5::varchar)', [
          principalId,
          threadId,
          requestId,
          problem.partialText.slice(0, 8192),
          'stopped',
        ]);
      } else {
        await this.pool
          .query('SELECT ai_chat_abort($1,$2,$3)', [principalId, threadId, requestId])
          .catch(() => undefined);
      }
      if (problem instanceof ProviderStreamError) {
        throw new AiServiceError(problem.code, problem.status, problem.message);
      }
      if (problem instanceof AiServiceError) throw problem;
      throw new AiServiceError(
        'ai_provider_unavailable',
        503,
        'Поток ответа прервался. Сообщение сохранено.',
      );
    } finally {
      this.activeStreams.delete(operationKey);
    }
  }

  stopStream(principalId: string, threadId: string, requestId: string): { stopped: boolean } {
    principalId = principalId.toLowerCase();
    threadId = threadId.toLowerCase();
    requestId = requestId.toLowerCase();
    const operation = this.activeStreams.get(principalId + ':' + requestId);
    if (!operation || operation.threadId !== threadId || operation.principalId !== principalId) {
      return { stopped: false };
    }
    operation.abort.abort();
    return { stopped: true };
  }

  private async runtime(): Promise<RuntimeRow> {
    const result = await this.pool.query<RuntimeRow>('SELECT * FROM ai_runtime_config()');
    const row = result.rows[0];
    if (!row) throw new AiServiceError('ai_config_unavailable', 503, 'Конфигурация ИИ недоступна.');
    return row;
  }

  private requireSupportedModel(runtime: RuntimeRow): void {
    if (!isModelForProvider(runtime.provider, runtime.model)) {
      throw new AiServiceError(
        'ai_model_unavailable',
        503,
        'Сохранённая модель больше не поддерживается. Выберите актуальную модель в админке.',
      );
    }
  }

  private rethrowAdmissionError(problem: unknown): void {
    const message = problem instanceof Error ? problem.message : '';
    if (message.includes('AI_STUDENT_DENIED')) {
      throw new AiServiceError(
        'ai_student_denied',
        403,
        'Доступ к школьному ИИ-чату закрыт. Проверьте разрешение преподавателя и рейтинг.',
      );
    }
    if (message.includes('AI_SCOPE_DENIED')) {
      throw new AiServiceError(
        'ai_scope_denied',
        403,
        'Этот школьный контекст больше недоступен. Войдите в действующий класс.',
      );
    }
    if (message.includes('AI_REQUEST_ID_REUSED')) {
      throw new AiServiceError(
        'ai_request_id_reused',
        409,
        'Этот запрос уже использован. Начните новое сообщение.',
      );
    }
    if (message.includes('AI_DISABLED')) {
      throw new AiServiceError(
        'ai_disabled',
        503,
        'ИИ не подключён. Настройте провайдера в админке.',
      );
    }
    if (message.includes('AI_PLATFORM_QUOTA_EXHAUSTED')) {
      throw new AiServiceError(
        'ai_platform_quota_exhausted',
        429,
        'Общий лимит платных ИИ-операций за час исчерпан или равен 0. Обратитесь к администратору платформы.',
      );
    }
    if (message.includes('AI_CONFIG_CHANGED')) {
      throw new AiServiceError(
        'ai_config_changed',
        409,
        'Настройки изменились. Перезагрузите страницу.',
      );
    }
    if (message.includes('AI_MODEL_UNAVAILABLE')) {
      throw new AiServiceError(
        'ai_model_unavailable',
        503,
        'Выберите актуальную модель в админке.',
      );
    }
  }

  private rethrowTextError(problem: unknown): void {
    this.rethrowAdmissionError(problem);
    const message = problem instanceof Error ? problem.message : '';
    if (message.includes('AI_THREAD_ARCHIVED')) {
      throw new AiServiceError('ai_thread_archived', 409, 'Сначала восстановите диалог из архива.');
    }
    if (message.includes('AI_SOURCE_DENIED')) {
      throw new AiServiceError(
        'ai_source_not_found',
        404,
        'Исходный вопрос не найден в этом диалоге.',
      );
    }
    if (message.includes('AI_THREAD_DENIED')) {
      throw new AiServiceError('ai_thread_not_found', 404, 'Диалог не найден.');
    }
    if (message.includes('AI_THREAD_BUSY_OR_MISSING')) {
      throw new AiServiceError(
        'ai_thread_busy',
        409,
        'Диалог недоступен или запрос уже выполняется.',
      );
    }
  }

  private encrypt(secret: string): {
    ciphertext: string;
    iv: string;
    tag: string;
    fingerprint: string;
  } {
    if (!this.key)
      throw new AiServiceError('ai_encryption_unavailable', 503, 'Шифрование недоступно.');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64url'),
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      fingerprint: createHash('sha256').update(secret).digest('hex').slice(0, 12),
    };
  }

  private decrypt(row: RuntimeRow): string | null {
    if (!this.key || !row.api_key_ciphertext || !row.api_key_iv || !row.api_key_auth_tag) {
      return null;
    }
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
      return null;
    }
  }

  private async generate(
    runtime: RuntimeRow,
    apiKey: string,
    context: readonly { role: 'user' | 'assistant'; content: string }[],
  ): Promise<ProviderStreamResult> {
    const request = buildAiTextRequest(
      runtime.provider,
      runtime.model,
      context,
      ASSISTANT_INSTRUCTIONS,
      false,
    );
    let response: Response;
    try {
      response = await this.fetchImpl(request.url, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(65000),
      });
    } catch {
      throw new AiServiceError(
        'ai_provider_timeout',
        504,
        'Нет ответа от модели. Сообщение сохранено.',
      );
    }
    if (!response.ok) {
      const status = response.status === 429 ? 429 : 503;
      const code = response.status === 429 ? 'ai_provider_rate_limit' : 'ai_provider_error';
      throw new AiServiceError(
        code,
        status,
        response.status === 429
          ? 'Провайдер ограничил частоту запросов.'
          : 'Провайдер отклонил запрос. Проверьте ключ и модель в админке.',
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AiServiceError('ai_response_invalid', 503, 'Модель вернула некорректный ответ.');
    }
    return parseProviderText(runtime.provider, body);
  }
}
