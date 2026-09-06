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
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    const committed = await client.query('COMMIT');
    // PostgreSQL answers ROLLBACK (without throwing) when the callback has
    // swallowed a SQL error and left the transaction aborted.
    if (committed.command !== 'COMMIT') {
      throw new Error('Transaction was not committed');
    }
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {
      discard = true;
    });
    throw error;
  } finally {
    client.release(discard);
  }
}
