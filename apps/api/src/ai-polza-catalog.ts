import type pg from 'pg';
import { installPolzaModelCatalog } from './ai-model-catalog.js';

export interface PolzaModel {
  id: string;
  upstream: string;
  label: string;
  kind: string;
  vision: boolean;
  tools: boolean;
  maxOutputTokens: number;
  active: boolean;
  selected: boolean;
}
export interface PolzaCatalog {
  version: number;
  checkedAt: string | null;
  credentialCurrent: boolean;
  items: PolzaModel[];
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/;
/** Provider metadata confirms the supported wire endpoint; modality is never inferred from a name. */
export function parsePolzaModels(raw: unknown): PolzaModel[] {
  const value = raw as { data?: unknown; has_more?: unknown } | null;
  if (!value || !Array.isArray(value.data) || value.data.length > 1200 || value.has_more === true)
    throw new Error('AI_POLZA_CATALOG_INVALID');
  const seen = new Set<string>();
  return value.data.map((entry: unknown) => {
    const m = entry as Record<string, unknown> | null;
    if (!m || typeof m.id !== 'string' || !ID.test(m.id) || m.id.includes('://') || seen.has(m.id))
      throw new Error('AI_POLZA_CATALOG_INVALID');
    seen.add(m.id);
    const a = m.architecture as
      { input_modalities?: unknown; output_modalities?: unknown } | undefined;
    const top = m.top_provider as
      { supported_parameters?: unknown; max_completion_tokens?: unknown } | undefined;
    const inputs = Array.isArray(a?.input_modalities) ? a.input_modalities : [];
    const outputs = Array.isArray(a?.output_modalities) ? a.output_modalities : [];
    const endpoints = Array.isArray(m.endpoints) ? m.endpoints : [];
    const chat =
      m.type === 'chat' &&
      inputs.includes('text') &&
      outputs.includes('text') &&
      endpoints.includes('/api/v1/chat/completions');
    const maximum = top?.max_completion_tokens ?? m.max_completion_tokens;
    return {
      id: 'polza/' + m.id,
      upstream: m.id,
      label: typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 120) : m.id,
      kind: chat
        ? 'chat'
        : m.type === 'stt'
          ? 'stt'
          : outputs.includes('image')
            ? 'image'
            : 'other',
      vision: chat && inputs.includes('image'),
      tools:
        chat &&
        Array.isArray(top?.supported_parameters) &&
        top.supported_parameters.includes('tools'),
      maxOutputTokens:
        typeof maximum === 'number' && Number.isSafeInteger(maximum) && maximum > 0
          ? Math.min(maximum, 8192)
          : 8192,
      active: true,
      selected: false,
    };
  });
}
export async function discoverPolzaModels(
  key: string,
  transport: typeof fetch,
): Promise<PolzaModel[]> {
  const response = await transport('https://polza.ai/api/v1/models', {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: { authorization: 'Bearer ' + key, accept: 'application/json' },
  });
  if (!response.ok || !response.body) throw new Error('AI_POLZA_CATALOG_UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 2 * 1024 * 1024) throw new Error('AI_POLZA_CATALOG_TOO_LARGE');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return parsePolzaModels(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
export async function readPolzaCatalog(pool: pg.Pool): Promise<PolzaCatalog> {
  const result = await pool.query<{ value: PolzaCatalog }>(
    'SELECT ai_polza_catalog_runtime() AS value',
  );
  const value = result.rows[0]?.value;
  if (!value || !Array.isArray(value.items) || value.items.length > 1200)
    throw new Error('AI_POLZA_CATALOG_INVALID');
  return value;
}
export async function reloadPolzaCatalog(pool: pg.Pool): Promise<void> {
  const ready = await pool.query<{ ready: boolean }>(
    "SELECT to_regprocedure('public.ai_polza_catalog_runtime()') IS NOT NULL AS ready",
  );
  if (ready.rows[0]?.ready !== true) return;
  const value = await readPolzaCatalog(pool);
  installPolzaModelCatalog(value);
}
