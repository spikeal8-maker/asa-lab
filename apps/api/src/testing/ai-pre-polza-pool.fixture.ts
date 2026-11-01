import type pg from 'pg';
/** Existing config/CAS fixtures represent a schema without Polza text tables.
 * Answer the optional read-only probe without consuming their queued mutation replies. */
export function prePolzaPool(
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
): pg.Pool {
  return {
    query: (...args: [string, unknown[]?]) =>
      args[0].includes("to_regprocedure('public.ai_polza_catalog_runtime()')")
        ? Promise.resolve({ rows: [{ ready: false }] })
        : query(...args),
  } as unknown as pg.Pool;
}
