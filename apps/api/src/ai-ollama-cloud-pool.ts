import type pg from 'pg';
import type { AiOllamaCloudAccount } from '@asa-lab/contracts';
import { cloudModelId } from './ai-ollama-cloud.js';
import { isOllamaCloudPoolManaged } from './ai-model-catalog.js';

export interface CloudKeyCredential {
  slot: number;
  key_fingerprint: string;
  api_key_ciphertext: string | null;
  api_key_iv: string | null;
  api_key_auth_tag: string | null;
  blocked_until: string | null;
}
export function accountBlockUntil(account: AiOllamaCloudAccount): string | null | undefined {
  if (account.status === 'invalid_key' || account.status === 'forbidden') return 'infinity';
  if (account.status === 'unavailable') return undefined;
  const b = account.balance;
  const empty =
    b &&
    ((b.includedUsd !== null &&
      b.includedUsd <= 0 &&
      b.purchasedUsd !== null &&
      b.purchasedUsd <= 0) ||
      ((b.sessionRemainingPercent === 0 || b.weeklyRemainingPercent === 0) &&
        b.purchasedUsd === 0));
  if (account.status === 'credits_required' || empty)
    return b?.resetsAt && Date.parse(b.resetsAt) > Date.now() ? b.resetsAt : 'infinity';
  if (account.status === 'rate_limited')
    return b?.resetsAt && Date.parse(b.resetsAt) > Date.now()
      ? b.resetsAt
      : new Date(Date.now() + (account.retryAfterSeconds ?? 900) * 1000).toISOString();
  return null;
}

/** Only definitive HTTP rejection before any answer may move to another key. Never retry an unknown paid outcome. */
export function cloudPoolFetch(
  pool: pg.Pool,
  upstream: typeof fetch,
  decrypt: (row: CloudKeyCredential) => string,
): typeof fetch {
  return async (input, init) => {
    if (String(input) !== 'https://ollama.com/v1/chat/completions' || !isOllamaCloudPoolManaged())
      return upstream(input, init);
    const request = JSON.parse(String(init?.body)) as { model?: unknown };
    if (typeof request.model !== 'string') throw new Error('AI_CLOUD_MODEL_INVALID');
    const model = cloudModelId(request.model);
    const candidates = (
      await pool.query<CloudKeyCredential>('SELECT * FROM ai_ollama_cloud_key_candidates($1)', [
        model,
      ])
    ).rows;
    let lastStatus = 503;
    for (const key of candidates.slice(0, 5)) {
      init?.signal?.throwIfAborted();
      const headers = new Headers(init?.headers);
      headers.set('authorization', 'Bearer ' + decrypt(key));
      // Network exceptions and HTTP 5xx have an ambiguous outcome: they propagate without another attempt.
      const response = await upstream(input, { ...init, redirect: 'error', headers });
      if (response.redirected) throw new Error('AI_CLOUD_REDIRECT_DENIED');
      if (![401, 402, 403, 404, 429].includes(response.status)) return response;
      lastStatus = response.status;
      const rawRetry = response.headers.get('retry-after');
      const seconds =
        rawRetry && /^\d{1,5}$/.test(rawRetry)
          ? Math.max(1, Math.min(86400, Number(rawRetry)))
          : response.status === 429
            ? 60
            : 900;
      const until = [401, 402].includes(response.status)
        ? 'infinity'
        : new Date(Date.now() + seconds * 1000).toISOString();
      const account = [401, 402, 429].includes(response.status)
        ? {
            status:
              response.status === 401
                ? 'invalid_key'
                : response.status === 402
                  ? 'credits_required'
                  : 'rate_limited',
            checkedAt: new Date().toISOString(),
            retryAfterSeconds: seconds,
            balance: null,
          }
        : null;
      await response.body?.cancel();
      await pool.query(
        'SELECT ai_ollama_cloud_key_observe($1,$2,$3::jsonb,$4::timestamptz,$5::varchar)',
        [
          key.slot,
          key.key_fingerprint,
          account ? JSON.stringify(account) : null,
          until,
          [403, 404].includes(response.status) ? model : null,
        ],
      );
    }
    return new Response(JSON.stringify({ error: 'No eligible Ollama Cloud key for this model' }), {
      status: lastStatus,
      headers: { 'content-type': 'application/json' },
    });
  };
}
