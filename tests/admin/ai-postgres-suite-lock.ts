import type pg from 'pg';

// Both AI suites mutate the singleton provider config and global paid ledger.
// Hold a session lock on a dedicated connection across setup, tests and cleanup;
// operation pools remain free to exercise actual multi-connection admission.
export async function lockAiPostgresSuite(pool: pg.Pool): Promise<() => Promise<void>> {
  const client = await pool.connect();
  try {
    // Leave time for hook cleanup if a different test process holds the lock.
    await client.query("SET statement_timeout = '55s'");
    await client.query('SELECT pg_advisory_lock(7312, 215)');
    await client.query('RESET statement_timeout');
  } catch (problem) {
    client.release(true);
    throw problem;
  }
  return async () => {
    try {
      await client.query('SELECT pg_advisory_unlock(7312, 215)');
    } finally {
      client.release();
    }
  };
}
