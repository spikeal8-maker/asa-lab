import type pg from 'pg';
import { AiPolicyError } from './ai-generation-policy.js';

/** Metadata only. Neither endpoint proves compatibility with an ASA adapter.
 * https://developers.openai.com/api/reference/resources/models/methods/list
 * https://api-docs.deepseek.com/api/list-models/
 */
export const AI_CATALOG_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/models',
  deepseek: 'https://api.deepseek.com/models',
} as const;
export function parseObservedModels(raw: unknown): string[] {
  const value = raw as { data?: unknown; has_more?: unknown } | null;
  if (!value || !Array.isArray(value.data) || value.data.length > 300 || value.has_more === true)
    throw new Error('AI_CATALOG_INVALID');
  const ids = value.data.map((row) => {
    const id = (row as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/.test(id))
      throw new Error('AI_CATALOG_INVALID');
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new Error('AI_CATALOG_INVALID');
  return ids.sort();
}
export async function discoverProviderModels(
  provider: keyof typeof AI_CATALOG_ENDPOINTS,
  key: string,
  fetchImpl: typeof fetch,
): Promise<string[]> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  try {
    const response = await fetchImpl(AI_CATALOG_ENDPOINTS[provider], {
      method: 'GET',
      redirect: 'error',
      signal: abort.signal,
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
    });
    if (!response.ok || !response.body) throw new Error('AI_CATALOG_UNAVAILABLE');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 262144) throw new Error('AI_CATALOG_TOO_LARGE');
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return parseObservedModels(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } finally {
    clearTimeout(timer);
  }
}
export async function applyCatalogObservation(
  pool: pg.Pool,
  actor: string,
  provider: string,
  revision: number,
  ids: string[] | null,
): Promise<void> {
  try {
    await pool.query('SELECT ai_provider_catalog_apply($1,$2,$3,$4::jsonb)', [
      actor,
      provider,
      revision,
      ids === null ? null : JSON.stringify(ids),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === '40001')
      throw new AiPolicyError(
        'ai_config_changed',
        409,
        'Ключ изменился во время обновления каталога.',
      );
    throw error;
  }
}
