import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';

export interface AdminAiConfiguration {
  readonly provider: 'deepseek';
  readonly enabled: boolean;
  readonly apiKeyConfigured: boolean;
  readonly encryptionReady: boolean;
  readonly keyFingerprint: string | null;
  readonly configurationVersion: number;
  readonly updatedAt: string | null;
}

export interface AdminAiUpdateInput {
  readonly enabled: boolean;
  readonly apiKey?: string;
  readonly clearApiKey?: boolean;
}

export type AiConfigurationErrorCode =
  'ai_encryption_key_missing' | 'ai_key_missing' | 'ai_service_unavailable';

export class AiConfigurationError extends Error {
  constructor(readonly code: AiConfigurationErrorCode) {
    super(code);
    this.name = 'AiConfigurationError';
  }
}

interface AiRuntimeRow {
  readonly enabled: boolean;
  readonly provider: 'deepseek';
  readonly api_key_ciphertext: string | null;
  readonly api_key_iv: string | null;
  readonly api_key_auth_tag: string | null;
  readonly key_fingerprint: string | null;
  readonly configuration_version: string | number;
  readonly updated_at: Date | string | null;
}

interface AiAdminRuntimeRow {
  readonly enabled: boolean;
  readonly provider: 'deepseek';
  readonly api_key_configured: boolean;
  readonly key_fingerprint: string | null;
  readonly configuration_version: string | number;
  readonly updated_at: Date | string | null;
}

interface AiProviderOptions {
  readonly encryptionKey?: string;
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

function normalizedSecret(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length >= 8 && normalized.length <= 2048 ? normalized : null;
}

function safeVersion(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function isoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export class AiProviderService {
  private readonly key: Buffer | null;

  constructor(
    private readonly pool: pg.Pool,
    options: AiProviderOptions = {},
  ) {
    this.key = encryptionKey(options.encryptionKey ?? process.env['ASA_SETTINGS_ENCRYPTION_KEY']);
  }

  async adminConfig(actorPrincipalId: string): Promise<AdminAiConfiguration> {
    const runtime = await this.adminRuntime(actorPrincipalId);
    return {
      provider: runtime.provider,
      enabled: runtime.enabled && runtime.api_key_configured && this.key !== null,
      apiKeyConfigured: runtime.api_key_configured,
      encryptionReady: this.key !== null,
      keyFingerprint: runtime.key_fingerprint,
      configurationVersion: safeVersion(runtime.configuration_version),
      updatedAt: isoOrNull(runtime.updated_at),
    };
  }

  async updateAdminConfig(
    actorPrincipalId: string,
    input: AdminAiUpdateInput,
    requestId: string,
  ): Promise<AdminAiConfiguration> {
    if (input.clearApiKey && input.enabled) throw new AiConfigurationError('ai_key_missing');

    const current = await this.adminRuntime(actorPrincipalId);
    const suppliedKey = normalizedSecret(input.apiKey);
    if (input.apiKey !== undefined && input.apiKey.trim().length > 0 && suppliedKey === null) {
      throw new AiConfigurationError('ai_key_missing');
    }
    if ((suppliedKey || input.enabled) && !this.key) {
      throw new AiConfigurationError('ai_encryption_key_missing');
    }

    const keyConfigured =
      suppliedKey !== null || (!input.clearApiKey && current.api_key_configured);
    if (input.enabled && !keyConfigured) throw new AiConfigurationError('ai_key_missing');

    const encrypted = suppliedKey ? this.encryptSecret(suppliedKey) : null;
    const keyAction = input.clearApiKey ? 'clear' : suppliedKey ? 'replace' : 'keep';

    await this.pool.query(`SELECT admin_set_ai_runtime_config($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
      actorPrincipalId,
      input.enabled,
      keyAction,
      encrypted?.ciphertext ?? null,
      encrypted?.iv ?? null,
      encrypted?.tag ?? null,
      encrypted?.fingerprint ?? null,
      this.configurationReason(current, input, suppliedKey !== null),
      requestId,
    ]);

    return this.adminConfig(actorPrincipalId);
  }

  async runtimeApiKey(): Promise<string | null> {
    const runtime = await this.runtime();
    if (!runtime.enabled || runtime.api_key_ciphertext === null) return null;
    if (!this.key || !runtime.api_key_iv || !runtime.api_key_auth_tag) return null;
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(runtime.api_key_iv, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(runtime.api_key_auth_tag, 'base64url'));
      const clear = Buffer.concat([
        decipher.update(Buffer.from(runtime.api_key_ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
      return normalizedSecret(clear);
    } catch {
      return null;
    }
  }

  private async runtime(): Promise<AiRuntimeRow> {
    const result = await this.pool.query<AiRuntimeRow>(
      `SELECT enabled, provider, api_key_ciphertext, api_key_iv, api_key_auth_tag,
              key_fingerprint, configuration_version, updated_at
         FROM ai_runtime_config()`,
    );
    const row = result.rows[0];
    if (!row) throw new AiConfigurationError('ai_service_unavailable');
    return row;
  }

  private async adminRuntime(actorPrincipalId: string): Promise<AiAdminRuntimeRow> {
    const result = await this.pool.query<AiAdminRuntimeRow>(
      `SELECT enabled, provider, api_key_configured, key_fingerprint,
              configuration_version, updated_at
         FROM admin_get_ai_runtime_config($1)`,
      [actorPrincipalId],
    );
    const row = result.rows[0];
    if (!row) throw new AiConfigurationError('ai_service_unavailable');
    return row;
  }

  private encryptSecret(secret: string): {
    readonly ciphertext: string;
    readonly iv: string;
    readonly tag: string;
    readonly fingerprint: string;
  } {
    if (!this.key) throw new AiConfigurationError('ai_encryption_key_missing');
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

  private configurationReason(
    current: AiAdminRuntimeRow,
    input: AdminAiUpdateInput,
    keyReplaced: boolean,
  ): string {
    const changes: string[] = [];
    if (current.enabled !== input.enabled) changes.push(input.enabled ? 'включение' : 'выключение');
    if (keyReplaced) changes.push('замена ключа');
    if (input.clearApiKey) changes.push('удаление ключа');
    return `Настройка ИИ: ${changes.join(', ') || 'проверка конфигурации'}`;
  }
}
