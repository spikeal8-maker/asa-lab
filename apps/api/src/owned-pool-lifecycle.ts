import type pg from 'pg';
import { safeServerError } from './server-diagnostics.js';

export function lifecycleEvent(phase: string, error?: unknown): void {
  const safe = error === undefined ? undefined : safeServerError(error);
  process.stderr.write(
    `${JSON.stringify({
      kind: 'api_lifecycle',
      level: error === undefined ? 'info' : 'error',
      time: new Date().toISOString(),
      phase,
      ...(safe ? { errorCode: safe.errorCode, errorClass: safe.errorClass } : {}),
    })}\n`,
  );
}
export async function boundedClose(
  action: () => Promise<unknown>,
  timeoutMs = 1500,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(action),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('resource_close_timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function poolErrorCode(error: unknown, fallback: string): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return typeof code === 'string' &&
    (/^[A-Z0-9]{5}$/.test(code) ||
      ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'].includes(code))
    ? code
    : fallback;
}

/** Owns transferred resources; minimal query/end test doubles remain supported. */
export class OwnedPools {
  private readonly pools = new Map<pg.Pool, { role: string; listener?: (error: Error) => void }>();
  private closing: Promise<void> | undefined;
  track(pool: pg.Pool | null, role: 'main' | 'analytics'): void {
    if (!pool || this.pools.has(pool)) return;
    const record: { role: string; listener?: (error: Error) => void } = { role };
    if (typeof pool.on === 'function') {
      let count = 0;
      let last = -Infinity;
      record.listener = (error) => {
        count += 1;
        if (Date.now() - last < 60_000) return;
        last = Date.now();
        const safe = safeServerError(error);
        process.stderr.write(
          `${JSON.stringify({
            kind: 'database_pool_error',
            level: 'error',
            role,
            count,
            time: new Date().toISOString(),
            errorCode: poolErrorCode(error, safe.errorCode),
            errorClass: safe.errorClass,
          })}\n`,
        );
      };
      pool.on('error', record.listener);
    }
    this.pools.set(pool, record);
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      const errors: unknown[] = [];
      for (const [pool, record] of [...this.pools].reverse()) {
        try {
          await boundedClose(async () => {
            await pool.end();
            // Keep the error listener while an unclosed/timed-out pool is live.
            if (record.listener && typeof pool.removeListener === 'function')
              pool.removeListener('error', record.listener);
          });
        } catch (error) {
          errors.push(error);
          lifecycleEvent(`pool_${record.role}_close_failed`, error);
        }
      }
      if (errors.length) throw new AggregateError(errors, 'resource_cleanup_failed');
    })();
    return this.closing;
  }
}
