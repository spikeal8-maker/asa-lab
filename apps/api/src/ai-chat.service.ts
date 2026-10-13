import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';

export type AiProvider = 'openai' | 'deepseek';
export type AiModel = 'gpt-5-mini' | 'gpt-4.1-mini' | 'deepseek-chat';

export interface AiAdminConfig {
  readonly enabled: boolean;
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
  readonly provider: AiProvider;
  readonly model: AiModel;
  readonly apiKey?: string;
  readonly clearApiKey?: boolean;
}

export interface AiThread {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
}

export interface AiMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly createdAt: string;
}

interface AdminRow {
  readonly enabled: boolean;
  readonly provider: AiProvider;
  readonly model: AiModel;
  readonly api_key_configured: boolean;
  readonly key_fingerprint: string | null;
  readonly configuration_version: string | number;
  readonly updated_at: Date | string | null;
}

interface RuntimeRow {
  readonly enabled: boolean;
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

function validModel(provider: AiProvider, model: string): model is AiModel {
  return provider === 'openai'
    ? model === 'gpt-5-mini' || model === 'gpt-4.1-mini'
    : model === 'deepseek-chat';
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function extractOpenAiText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const result = value as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }>;
  };
  if (typeof result.output_text === 'string') return result.output_text;
  return (result.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('\n');
}

/**
 * Native ASA Lab AI adapter. No IZO auth, database or provider credentials are imported.
 * The existing IZO Chat is the source of the visual and interaction patterns.
 */
export class AiChatService {
  private readonly key: Buffer | null;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly pool: pg.Pool,
    options: AiServiceOptions = {},
  ) {
    this.key = rootKey(options.encryptionKey ?? process.env['ASA_SETTINGS_ENCRYPTION_KEY']);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async adminConfig(principalId: string): Promise<AiAdminConfig> {
    const result = await this.pool.query<AdminRow>(
      'SELECT * FROM ai_admin_get_config($1)',
      [principalId],
    );
    const row = result.rows[0];
    if (!row) throw new AiServiceError('ai_config_unavailable', 503, 'Настройки ИИ недоступны.');
    return {
      enabled: row.enabled,
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
    if (!validModel(input.provider, input.model)) {
      throw new AiServiceError('ai_model_invalid', 400, 'Модель не соответствует провайдеру.');
    }
    const before = await this.adminConfig(principalId);
    const candidate = input.apiKey?.trim() ?? '';
    if (input.apiKey !== undefined && candidate && (candidate.length < 12 || candidate.length > 2048)) {
      throw new AiServiceError('ai_key_invalid', 400, 'Недопустимая длина API-ключа.');
    }
    if (input.clearApiKey && candidate) {
      throw new AiServiceError('ai_key_invalid', 400, 'Нельзя заменить и очистить ключ одновременно.');
    }
    if (before.provider !== input.provider && !candidate) {
      throw new AiServiceError('ai_key_required', 409, 'Для другого провайдера нужен новый API-ключ.');
    }
    if (input.enabled && (input.clearApiKey || (!candidate && !before.apiKeyConfigured))) {
      throw new AiServiceError('ai_key_required', 409, 'Сначала добавьте API-ключ.');
    }
    if ((candidate || input.enabled) && !this.key) {
      throw new AiServiceError('ai_encryption_unavailable', 503, 'На сервере не настроено шифрование секретов.');
    }

    const encrypted = candidate ? this.encrypt(candidate) : null;
    const action = input.clearApiKey ? 'clear' : encrypted ? 'replace' : 'keep';
    try {
      await this.pool.query(
        'SELECT ai_admin_set_config($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
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
        ],
      );
    } catch (problem) {
      if ((problem as { code?: string }).code === '42501') {
        throw new AiServiceError('ai_admin_denied', 403, 'Нет доступа к настройкам ИИ.');
      }
      if ((problem as { code?: string }).code === '22023') {
        throw new AiServiceError('ai_config_invalid', 400, 'Не удалось сохранить настройки ИИ.');
      }
      throw problem;
    }
    return this.adminConfig(principalId);
  }

  async status(): Promise<{ enabled: boolean; provider: AiProvider; model: AiModel }> {
    const config = await this.runtime();
    return {
      enabled: config.enabled && this.key !== null && config.api_key_ciphertext !== null,
      provider: config.provider,
      model: config.model,
    };
  }

  async threads(principalId: string): Promise<readonly AiThread[]> {
    const result = await this.pool.query<{
      id: string;
      title: string;
      updated_at: Date | string;
    }>('SELECT * FROM ai_chat_list($1)', [principalId]);
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async createThread(principalId: string): Promise<{ id: string }> {
    const result = await this.pool.query<{ id: string }>(
      'SELECT ai_chat_create($1) AS id',
      [principalId],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new AiServiceError('ai_thread_unavailable', 503, 'Не удалось создать диалог.');
    return { id };
  }

  async messages(principalId: string, threadId: string): Promise<readonly AiMessage[]> {
    const result = await this.pool.query<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      created_at: Date | string;
    }>('SELECT * FROM ai_chat_messages($1,$2)', [principalId, threadId]);
    return result.rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async send(
    principalId: string,
    threadId: string,
    text: string,
  ): Promise<{ readonly messages: readonly AiMessage[] }> {
    const prompt = text.trim();
    if (prompt.length < 1 || prompt.length > 3000) {
      throw new AiServiceError('ai_input_invalid', 400, 'Сообщение должно содержать от 1 до 3000 символов.');
    }
    const runtime = await this.runtime();
    const apiKey = this.decrypt(runtime);
    if (!runtime.enabled || !apiKey) {
      throw new AiServiceError('ai_disabled', 503, 'ИИ не подключён. Настройте провайдера в админке.');
    }
    let requestId: string;
    try {
      const admitted = await this.pool.query<{ id: string }>(
        'SELECT ai_chat_begin($1,$2,$3::varchar) AS id',
        [principalId, threadId, prompt],
      );
      requestId = admitted.rows[0]?.id ?? '';
    } catch (problem) {
      if ((problem as { code?: string }).code === '42501') {
        throw new AiServiceError('ai_access_denied', 403, 'Доступ к диалогу запрещён.');
      }
      if ((problem as { code?: string }).code === '22023') {
        throw new AiServiceError('ai_input_invalid', 400, 'Сообщение слишком длинное.');
      }
      const message = (problem as Error).message;
      if (message.includes('AI_RATE_LIMIT')) {
        throw new AiServiceError('ai_rate_limit', 429, 'Лимит: 30 сообщений в час на аккаунт.');
      }
      if (message.includes('AI_THREAD_BUSY_OR_MISSING')) {
        throw new AiServiceError('ai_thread_busy', 409, 'Диалог недоступен или запрос уже выполняется.');
      }
      throw problem;
    }
    if (!requestId) throw new AiServiceError('ai_send_failed', 503, 'Не удалось отправить сообщение.');

    try {
      const history = await this.messages(principalId, threadId);
      const context = history.slice(-16).map((row) => ({
        role: row.role,
        content: row.content.slice(0, 3000),
      }));
      const reply = await this.generate(runtime, apiKey, context);
      await this.pool.query('SELECT ai_chat_finish($1,$2,$3,$4::varchar)', [
        principalId,
        threadId,
        requestId,
        reply.slice(0, 8192),
      ]);
      return { messages: await this.messages(principalId, threadId) };
    } catch (problem) {
      await this.pool.query('SELECT ai_chat_abort($1,$2,$3)', [
        principalId,
        threadId,
        requestId,
      ]).catch(() => undefined);
      if (problem instanceof AiServiceError) throw problem;
      throw new AiServiceError('ai_provider_unavailable', 503, 'ИИ временно недоступен. Сообщение сохранено.');
    }
  }

  private async runtime(): Promise<RuntimeRow> {
    const result = await this.pool.query<RuntimeRow>('SELECT * FROM ai_runtime_config()');
    const row = result.rows[0];
    if (!row) throw new AiServiceError('ai_config_unavailable', 503, 'Конфигурация ИИ недоступна.');
    return row;
  }

  private encrypt(secret: string): {
    ciphertext: string;
    iv: string;
    tag: string;
    fingerprint: string;
  } {
    if (!this.key) throw new AiServiceError('ai_encryption_unavailable', 503, 'Шифрование недоступно.');
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
  ): Promise<string> {
    const openai = runtime.provider === 'openai';
    const url = openai
      ? 'https://api.openai.com/v1/responses'
      : 'https://api.deepseek.com/chat/completions';
    const instructions =
      'Ты учебный помощник ASA Lab. Отвечай на русском, если пользователь не выбрал другой язык. '
      + 'Объясняй решения и не выдавай неподтверждённые результаты за факты.';
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(
          openai
            ? {
                model: runtime.model,
                instructions,
                input: context,
                max_output_tokens: 1600,
                store: false,
              }
            : {
                model: runtime.model,
                messages: [{ role: 'system', content: instructions }, ...context],
                max_tokens: 1600,
                stream: false,
              },
        ),
        signal: AbortSignal.timeout(65000),
      });
    } catch {
      throw new AiServiceError('ai_provider_timeout', 504, 'Нет ответа от модели. Сообщение сохранено.');
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
    let reply = '';
    if (openai) {
      reply = extractOpenAiText(body);
    } else {
      const result = body as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      reply = result.choices?.[0]?.message?.content ?? '';
    }
    if (!reply.trim()) {
      throw new AiServiceError('ai_response_empty', 503, 'Модель не вернула текст ответа.');
    }
    return reply.trim();
  }
}
