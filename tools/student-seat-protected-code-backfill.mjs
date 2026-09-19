#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const COUNTS_SQL = `
WITH active_seats AS (
  SELECT seat.id
  FROM public.classroom_student_seats seat
  WHERE seat.status <> 'removed'
)
SELECT
  count(*)::bigint AS active_student_seats,
  count(protected.seat_id)::bigint AS protected_active,
  count(*) FILTER (WHERE protected.seat_id IS NULL)::bigint AS unprotected_active,
  count(*) FILTER (
    WHERE protected.credential_state = 'legacy_predictable'
  )::bigint AS legacy_predictable
FROM active_seats active
LEFT JOIN public.classroom_student_code_protected protected
  ON protected.seat_id = active.id
`;

const ENCRYPTION_KEY_DISTRIBUTION_SQL = `
SELECT protected.encryption_key_id AS key_id, count(*)::bigint AS count
FROM public.classroom_student_seats seat
JOIN public.classroom_student_code_protected protected
  ON protected.seat_id = seat.id
WHERE seat.status <> 'removed'
GROUP BY protected.encryption_key_id
ORDER BY protected.encryption_key_id
`;

const LOOKUP_KEY_DISTRIBUTION_SQL = `
SELECT protected.lookup_key_id AS key_id, count(*)::bigint AS count
FROM public.classroom_student_seats seat
JOIN public.classroom_student_code_protected protected
  ON protected.seat_id = seat.id
WHERE seat.status <> 'removed'
GROUP BY protected.lookup_key_id
ORDER BY protected.lookup_key_id
`;

function countValue(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid aggregate returned for ${field}`);
  }
  return parsed;
}

function distribution(rows) {
  return rows.map((row) => ({
    key_id: String(row.key_id),
    count: countValue(row.count, `distribution:${String(row.key_id)}`),
  }));
}

export function resolveInventoryDatabaseUrl(env = process.env) {
  const explicitAdminUrl = env.STUDENT_CODE_BACKFILL_ADMIN_DATABASE_URL?.trim();
  const explicitTestUrl = env.TEST_DATABASE_URL?.trim();
  const databaseUrl = explicitAdminUrl || explicitTestUrl;

  if (!databaseUrl) {
    throw new Error(
      'BLOCKED: set STUDENT_CODE_BACKFILL_ADMIN_DATABASE_URL or TEST_DATABASE_URL explicitly; DATABASE_URL is intentionally ignored',
    );
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('BLOCKED: Student Code inventory database URL is invalid');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('BLOCKED: Student Code inventory requires a PostgreSQL URL');
  }

  if (!explicitAdminUrl) {
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!databaseName.endsWith('_test')) {
      throw new Error('BLOCKED: TEST_DATABASE_URL database name must end in _test');
    }
  }

  return databaseUrl;
}

export async function collectStudentSeatProtectedCodeInventory(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const countsResult = await client.query(COUNTS_SQL);
    const counts = countsResult.rows[0];
    if (!counts) {
      throw new Error('Student Code inventory aggregate query returned no row');
    }

    const encryptionResult = await client.query(ENCRYPTION_KEY_DISTRIBUTION_SQL);
    const lookupResult = await client.query(LOOKUP_KEY_DISTRIBUTION_SQL);

    const inventory = {
      active_student_seats: countValue(counts.active_student_seats, 'active_student_seats'),
      protected_active: countValue(counts.protected_active, 'protected_active'),
      unprotected_active: countValue(counts.unprotected_active, 'unprotected_active'),
      legacy_predictable: countValue(counts.legacy_predictable, 'legacy_predictable'),
      encryption_key_id_distribution: distribution(encryptionResult.rows),
      lookup_key_id_distribution: distribution(lookupResult.rows),
    };

    await client.query('COMMIT');
    return inventory;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original inventory failure.
    }
    throw error;
  }
}

export function formatStudentSeatProtectedCodeInventory(inventory) {
  return JSON.stringify(inventory, null, 2);
}

export async function runStudentSeatProtectedCodeInventoryCli({
  env = process.env,
  log = console.log,
  error = console.error,
} = {}) {
  let connectionString;
  try {
    connectionString = resolveInventoryDatabaseUrl(env);
  } catch (configurationError) {
    error(configurationError instanceof Error ? configurationError.message : String(configurationError));
    return 78;
  }

  const client = new pg.Client({
    connectionString,
    application_name: 'e1-fix-02c-student-code-inventory',
  });

  try {
    await client.connect();
    const inventory = await collectStudentSeatProtectedCodeInventory(client);
    log(formatStudentSeatProtectedCodeInventory(inventory));
    return 0;
  } catch (inventoryError) {
    error(
      `Student Code inventory failed: ${inventoryError instanceof Error ? inventoryError.message : String(inventoryError)}`,
    );
    return 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  process.exitCode = await runStudentSeatProtectedCodeInventoryCli();
}
