import type pg from 'pg';
import { testAdminPool } from '../portal/helpers';

// ActivityParticipation temporarily installs a trigger on learning_submissions,
// while direct-attempt tests submit through that same table. Keep those two PG
// files serial without changing the parallelism of unrelated suites.
const LOCK_SQL = "hashtext('asa-learning-submission-suite')";

export async function acquireLearningSubmissionSuiteLock(): Promise<() => Promise<void>> {
  const pool = testAdminPool();
  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query(`SELECT pg_advisory_lock(${LOCK_SQL})`);
  } catch (error) {
    client?.release();
    await pool.end();
    throw error;
  }
  if (!client) throw new Error('Learning submission suite lock connection was not acquired');
  const heldClient = client;

  return async () => {
    try {
      const unlocked = await heldClient.query(`SELECT pg_advisory_unlock(${LOCK_SQL}) AS unlocked`);
      if (unlocked.rows[0]?.unlocked !== true) {
        throw new Error('Learning submission suite lock was not held');
      }
    } finally {
      heldClient.release();
      await pool.end();
    }
  };
}
