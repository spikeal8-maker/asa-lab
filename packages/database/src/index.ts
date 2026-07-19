/** Typed PostgreSQL access helpers shared by Classroom Core contexts. */
import type pg from 'pg';

export const PACKAGE_NAME = '@asa-lab/database';

/**
 * Run `fn` inside a transaction with the verified tenant context applied via
 * `SET LOCAL app.tenant_id`. SET LOCAL is transaction-scoped, so the setting
 * clears automatically before the connection returns to the pool.
 */
export async function withTenantContext<T>(
  pool: pg.Pool,
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
