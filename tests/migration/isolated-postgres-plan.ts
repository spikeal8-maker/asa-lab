import pg from 'pg';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';

// Migration 0002 updates a cluster-wide role. Private fixture databases do not
// isolate that DDL, and applyPlan's existing advisory lock is database-local.
// All real PostgreSQL fixture plans coordinate through the original test DB.
export async function applyIsolatedTestPlan(
  client: pg.PoolClient,
  planned: ReturnType<typeof planMigrations>,
) {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw new Error('Isolated TEST_DATABASE_URL required for fixture migration coordination');
  const coordinator = new pg.Client({ connectionString: source });
  try {
    await coordinator.connect();
    await coordinator.query('SELECT pg_advisory_lock($1)', [776_1002]);
    try {
      return await applyPlan(client, planned);
    } finally {
      await coordinator.query('SELECT pg_advisory_unlock($1)', [776_1002]);
    }
  } finally {
    await coordinator.end();
  }
}
