import type pg from 'pg';
import { LlamaCppError } from './ai-llamacpp.js';

export interface LlamaCppSlotIdentity {
  readonly owner: string;
  readonly threadId: string | null;
  readonly requestId: string;
}
export interface LlamaCppSlot {
  readonly client: pg.PoolClient;
  readonly signal: AbortSignal;
  release(): Promise<void>;
}

/** One installation-wide dispatch permit, held on the same database connection.
 * The upstream server remains responsible for slots shared by other installations.
 * Never expires a live permit or clears another owner's request to recover a crash.
 */
export async function acquireLlamaCppSlot(
  pool: pg.Pool,
  identity: LlamaCppSlotIdentity,
): Promise<LlamaCppSlot> {
  const client = await pool.connect();
  const abort = new AbortController();
  let broken = false;
  let released = false;
  const onError = () => {
    broken = true;
    abort.abort();
  };
  client.on('error', onError);
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT ai_llamacpp_slot_acquire($1,$2,$3::varchar) AS acquired',
      [identity.owner, identity.threadId, identity.requestId],
    );
    if (result.rows[0]?.acquired !== true)
      throw new LlamaCppError(
        'ai_llamacpp_busy',
        409,
        'Локальная модель занята. Дождитесь завершения текущего ответа.',
      );
    if (broken)
      throw new LlamaCppError(
        'ai_llamacpp_unavailable',
        503,
        'Соединение с журналом генерации прервано.',
      );
    return {
      client,
      signal: abort.signal,
      async release() {
        if (released) return;
        released = true;
        try {
          if (!broken) {
            const result = await client.query<{ released: boolean }>(
              'SELECT ai_llamacpp_slot_release($1,$2,$3::varchar) AS released',
              [identity.owner, identity.threadId, identity.requestId],
            );
            if (result.rows[0]?.released !== true) broken = true;
          }
        } catch {
          broken = true;
        } finally {
          client.removeListener('error', onError);
          // A failed unlock must destroy this connection; returning a locked
          // session to the pool would indefinitely block later generations.
          client.release(broken);
        }
      },
    };
  } catch (error) {
    client.removeListener('error', onError);
    client.release(true);
    throw error;
  }
}

export async function withLlamaCppSlot<T>(
  pool: pg.Pool,
  identity: LlamaCppSlotIdentity,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const slot = await acquireLlamaCppSlot(pool, identity);
  try {
    return await run(slot.signal);
  } finally {
    await slot.release();
  }
}
