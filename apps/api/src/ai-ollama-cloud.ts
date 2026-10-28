import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { AiOllamaCloudModel, AiOllamaCloudAccount } from '@asa-lab/contracts';
import { installOllamaCloudCatalog } from './ai-model-catalog.js';

const ORIGIN = 'https://ollama.com';
const legacy = new Set(['gemma4:31b', 'gpt-oss:120b', 'gpt-oss:20b']);
export function cloudModelId(model: string): string {
  return legacy.has(model) ? model : 'ollama-cloud/' + model;
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const money = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9 ? v : null;
const percent = (v: unknown): number | null =>
  typeof v === 'number' && v >= 0 && v <= 100 ? v : null;
const date = (v: unknown): string | null =>
  typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v))
    ? new Date(v).toISOString()
    : null;
export async function reloadOllamaCloudCatalog(
  pool: pg.Pool,
): Promise<{ models: readonly AiOllamaCloudModel[]; checkedAt: string | null }> {
  const result = await pool.query<{
    value?: {
      models?: readonly AiOllamaCloudModel[];
      checkedAt?: string | null;
      poolManaged?: boolean;
      availableModels?: readonly string[];
    };
  }>('SELECT ai_ollama_cloud_catalog_runtime() AS value');
  const snapshot = result.rows[0]?.value;
  if (Array.isArray(snapshot?.models))
    installOllamaCloudCatalog(
      snapshot.models,
      snapshot.checkedAt ?? null,
      snapshot.poolManaged ? (snapshot.availableModels ?? []) : null,
    );
  return { models: snapshot?.models ?? [], checkedAt: snapshot?.checkedAt ?? null };
}
/** Only fixed Ollama metadata endpoints; this adapter cannot generate text or follow redirects. */
export class OllamaCloudMetadata {
  private readonly accountCache = new Map<
    string,
    { at: number; value: Promise<AiOllamaCloudAccount> }
  >();
  private catalogCache: { at: number; value: Promise<readonly AiOllamaCloudModel[]> } | null = null;
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  private async json(
    path: '/api/tags' | '/api/balance',
    key?: string,
  ): Promise<{ status: number; body: unknown; retry: number | null }> {
    const response = await this.fetchImpl(ORIGIN + path, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: { accept: 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) },
    });
    if (response.redirected) throw new Error('AI_CLOUD_METADATA_UNAVAILABLE');
    const retryHeader = response.headers.get('retry-after');
    const retry = retryHeader && /^\d{1,5}$/.test(retryHeader) ? Number(retryHeader) : null;
    if (!response.ok) {
      await response.body?.cancel();
      return { status: response.status, body: null, retry };
    }
    if (!response.body) throw new Error('AI_CLOUD_METADATA_UNAVAILABLE');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let count = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        count += part.value.length;
        if (count > 1024 * 1024) throw new Error('AI_CLOUD_METADATA_UNAVAILABLE');
        chunks.push(part.value);
      }
      return {
        status: response.status,
        body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
        retry,
      };
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  catalog(): Promise<readonly AiOllamaCloudModel[]> {
    if (this.catalogCache && Date.now() - this.catalogCache.at < 60000)
      return this.catalogCache.value;
    const value = this.fetchCatalog();
    this.catalogCache = { at: Date.now(), value };
    return value;
  }
  private async fetchCatalog(): Promise<readonly AiOllamaCloudModel[]> {
    const reply = await this.json('/api/tags');
    const rows = object(reply.body)['models'];
    if (reply.status !== 200 || !Array.isArray(rows) || rows.length < 1 || rows.length > 300)
      throw new Error('AI_CLOUD_CATALOG_UNAVAILABLE');
    const models: AiOllamaCloudModel[] = [];
    for (const value of rows) {
      const row = object(value);
      const model = row['name'];
      const caps = row['capabilities'];
      if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$/.test(model))
        throw new Error('AI_CLOUD_CATALOG_UNAVAILABLE');
      // Do not offer audio-only/unknown models for a text chat.
      if (!Array.isArray(caps) || !caps.includes('completion')) continue;
      const capabilities = [
        ...new Set(
          caps.filter(
            (v): v is string => typeof v === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(v),
          ),
        ),
      ].slice(0, 32);
      models.push({ id: cloudModelId(model), model, capabilities, active: true });
    }
    if (!models.length || new Set(models.map((m) => m.id)).size !== models.length)
      throw new Error('AI_CLOUD_CATALOG_UNAVAILABLE');
    return models.sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
  }
  account(key: string | null): Promise<AiOllamaCloudAccount> {
    if (!key)
      return Promise.resolve({
        status: 'key_required',
        checkedAt: new Date().toISOString(),
        retryAfterSeconds: null,
        balance: null,
      });
    if (key.length < 12 || key.length > 2048 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(key))
      throw new Error('AI_CLOUD_KEY_INVALID');
    const fingerprint = createHash('sha256').update(key).digest('hex');
    const cached = this.accountCache.get(fingerprint);
    if (cached && Date.now() - cached.at < 60000) return cached.value;
    if (this.accountCache.size >= 16)
      this.accountCache.delete(this.accountCache.keys().next().value!);
    const value = this.fetchAccount(key);
    this.accountCache.set(fingerprint, { at: Date.now(), value });
    return value;
  }
  private async fetchAccount(key: string): Promise<AiOllamaCloudAccount> {
    const base = { checkedAt: new Date().toISOString(), retryAfterSeconds: null, balance: null };
    try {
      const reply = await this.json('/api/balance', key);
      if (reply.status !== 200)
        return {
          ...base,
          retryAfterSeconds: reply.retry,
          status:
            reply.status === 401
              ? 'invalid_key'
              : reply.status === 403
                ? 'forbidden'
                : reply.status === 402
                  ? 'credits_required'
                  : reply.status === 429
                    ? 'rate_limited'
                    : 'unavailable',
        };
      const body = object(reply.body);
      const included = object(body['included']);
      const purchased = object(body['purchased']);
      if (
        [
          money(included['balance_usd']),
          money(purchased['balance_usd']),
          money(included['allowance_usd']),
          percent(object(included['session'])['remaining_percent']),
          percent(object(included['weekly'])['remaining_percent']),
        ].every((v) => v === null)
      )
        return { ...base, status: 'unavailable' };
      return {
        ...base,
        status: 'ok',
        balance: {
          includedUsd: money(included['balance_usd']),
          purchasedUsd: money(purchased['balance_usd']),
          allowanceUsd: money(included['allowance_usd']),
          resetsAt:
            date(object(included['period'])['until']) ??
            date(object(included['session'])['resets_at']),
          sessionRemainingPercent: percent(object(included['session'])['remaining_percent']),
          weeklyRemainingPercent: percent(object(included['weekly'])['remaining_percent']),
        },
      };
    } catch {
      return { ...base, status: 'unavailable' };
    }
  }
}
