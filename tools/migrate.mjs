#!/usr/bin/env node
// Migration runner for ASA Lab.
//
// Modes:
//   --check            Validate the migration set locally (names, order,
//                      checksums) without any database connection. Exit 0 on
//                      success.
//   --plan             Check attested database history in a read-only
//                      transaction; never create tables or apply pending SQL.
//   --apply            Apply pending migrations only through the dedicated
//                      MIGRATION_DATABASE_URL plus two exact target attestations.
//   --smoke (default)  Apply pending migrations to the ISOLATED test database
//                      (TEST_DATABASE_URL, name must end in _test), then verify
//                      a second run applies nothing (idempotency). The smoke
//                      never touches the development database.
//
// When an explicit migration target is incomplete, the runner exits with
// code 78 (EX_CONFIG) so the task runner records the test as BLOCKED — an
// honest "environment unavailable", not a false PASS/FAIL.
import { createHash } from 'node:crypto';
import console from 'node:console';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL, URL } from 'node:url';

const MIGRATIONS_DIR = 'migrations';
const EX_CONFIG = 78;
const ADVISORY_LOCK_KEY = 776_1001; // stable key for the migration advisory lock

// 0086 was applied to the owner database from an intermediate, published SQL
// artifact before the repository copy gained the project-tenant lineage guard.
// The database records that exact checksum. Keep the lineage explicit and
// version-scoped: accepting arbitrary historical checksums would turn the
// tamper check into a bypass. Migration 0088 remains responsible for the later
// additive correction; 0086 itself must never be rewritten in the database.
const PUBLISHED_CHECKSUM_LINEAGE = new Map([
  ['0086', new Set(['9836902598ddea7071e43d365f5d82c611f93d5dfaab96b63beb5a9c683f7d8b'])],
]);
const NAME_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

// One published late migration has an additive forward repair. This is not a
// general allow-out-of-order switch: both immutable SQL artifacts must match.
const ASSET_FORWARD_REPAIR = {
  source: {
    version: '0146',
    file: '0146_blocks_asset_storage.sql',
    digest: '57213d0cf25809ebff042ff9a2aeaef550fe069cebd1c3e59c8cf440ab97fcae',
  },
  replacement: {
    version: '0151',
    file: '0151_blocks_asset_storage_forward.sql',
    digest: '2e2603918b52662a0010ba892aa5955eeb4e7a57d3443dcc2dc7ab23dac64714',
  },
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function matchesRepairArtifact(migration, expected) {
  return (
    migration?.version === expected.version &&
    migration.file === expected.file &&
    typeof migration.sql === 'string' &&
    migration.checksum === sha256(migration.sql) &&
    sha256(migration.sql.replace(/\r\n/g, '\n')) === expected.digest
  );
}

/** Approved omissions from a late history; existing ledger rows are never removed. */
export function forwardReplacedVersions(
  applied,
  planned,
  { requireAppliedReplacement = false } = {},
) {
  const { source, replacement } = ASSET_FORWARD_REPAIR;
  const maxApplied = Math.max(0, ...[...applied.keys()].map(Number));
  if (
    !applied.has(source.version) &&
    (!requireAppliedReplacement || applied.has(replacement.version)) &&
    maxApplied > Number(source.version) &&
    matchesRepairArtifact(
      planned.find((item) => item.version === source.version),
      source,
    ) &&
    matchesRepairArtifact(
      planned.find((item) => item.version === replacement.version),
      replacement,
    )
  ) {
    return new Set([source.version]);
  }
  return new Set();
}

/** Read and validate migration files. Pure filesystem logic, no database. */
export function planMigrations(dir = MIGRATIONS_DIR) {
  if (!existsSync(dir)) {
    throw new Error(`No migrations directory at ${dir}`);
  }
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    throw new Error('No migration files found');
  }

  const seen = new Set();
  const planned = [];
  for (const file of files) {
    const match = NAME_PATTERN.exec(file);
    if (!match) {
      throw new Error(`Migration file has an invalid name: ${file}`);
    }
    const [, version, name] = match;
    if (seen.has(version)) {
      throw new Error(`Duplicate migration version: ${version}`);
    }
    seen.add(version);
    const sql = readFileSync(join(dir, file), 'utf8');
    const checksum = sha256(sql);
    const lfSql = sql.replace(/\r\n/g, '\n');
    const compatibleChecksums = new Set([
      sha256(lfSql),
      sha256(lfSql.replace(/\n/g, '\r\n')),
      ...(PUBLISHED_CHECKSUM_LINEAGE.get(version) ?? []),
    ]);
    planned.push({ version, name, file, sql, checksum, compatibleChecksums });
  }

  const numbers = planned.map((migration) => Number.parseInt(migration.version, 10));
  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index] <= numbers[index - 1]) {
      throw new Error('Migration versions are not strictly increasing');
    }
  }
  return planned;
}

/**
 * Compare applied migrations against the plan.
 * @param {Map<string, {checksum: string}>} applied
 * @param {Array<{version: string, checksum: string}>} planned
 * @returns {{ pending: Array, modified: Array }}
 */
export function reconcile(applied, planned) {
  const pending = [];
  const modified = [];
  const replaced = forwardReplacedVersions(applied, planned);
  for (const migration of planned) {
    const record = applied.get(migration.version);
    if (!record) {
      if (!replaced.has(migration.version)) pending.push(migration);
    } else if (
      record.checksum !== migration.checksum &&
      !(
        migration.compatibleChecksums?.has(record.checksum) &&
        migration.compatibleChecksums.has(migration.checksum)
      )
    ) {
      modified.push(migration);
    }
  }
  return { pending, modified };
}

/**
 * Pending migrations must extend the already-applied history, never backfill
 * below it. Otherwise two databases can reach different final schemas from the
 * same repository depending on when a late lower-numbered file appeared.
 */
export function findOutOfOrderPending(applied, pending) {
  if (applied.size === 0 || pending.length === 0) {
    return { maxAppliedVersion: null, outOfOrder: [] };
  }
  const appliedVersions = [...applied.keys()].map((version) => Number.parseInt(version, 10));
  const maxAppliedVersion = Math.max(...appliedVersions);
  const outOfOrder = pending.filter(
    (migration) => Number.parseInt(migration.version, 10) < maxAppliedVersion,
  );
  return { maxAppliedVersion, outOfOrder };
}

/** Shared preflight/apply contract; no database writes. */
export function validateMigrationHistory(applied, planned) {
  const { pending, modified } = reconcile(applied, planned);
  if (modified.length > 0) {
    throw new Error(
      `Applied migration(s) were modified after apply: ${modified.map((item) => item.version).join(', ')}`,
    );
  }
  const { maxAppliedVersion, outOfOrder } = findOutOfOrderPending(applied, pending);
  if (outOfOrder.length > 0) {
    throw new Error(
      `Forbidden out-of-order pending migration(s): ${outOfOrder.map((item) => item.version).join(', ')}; maximum applied migration version is ${String(maxAppliedVersion).padStart(4, '0')}. New additive migrations must use a version greater than every applied migration.`,
    );
  }
  return pending;
}

export async function inspectPlan(client, planned) {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const applied = await readApplied(client);
    return validateMigrationHistory(applied, planned);
  } finally {
    await client.query('ROLLBACK');
  }
}

async function withClient(databaseUrl, fn) {
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id bigserial PRIMARY KEY,
      version varchar(64) NOT NULL UNIQUE,
      name varchar(255) NOT NULL,
      checksum varchar(128) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function readApplied(client) {
  const result = await client.query('SELECT version, checksum FROM schema_migrations');
  const applied = new Map();
  for (const row of result.rows) {
    applied.set(row.version, { checksum: row.checksum });
  }
  return applied;
}

/**
 * Apply a plan against any Postgres-compatible client exposing
 * `query(sql, params?) -> { rows }`. Works with node-postgres and with an
 * embedded PGlite instance. Takes an advisory lock, ensures the tracking table,
 * rejects modified applied migrations and applies pending ones in order inside
 * per-migration transactions. Returns the number applied.
 */
export async function applyPlan(client, planned) {
  await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  try {
    await ensureTable(client);
    const applied = await readApplied(client);
    const pending = validateMigrationHistory(applied, planned);
    for (const migration of pending) {
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return pending.length;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
  }
}

/** Apply pending migrations over a real DATABASE_URL connection. */
export async function applyMigrations(databaseUrl, dir = MIGRATIONS_DIR) {
  const planned = planMigrations(dir);
  return withClient(databaseUrl, (client) => applyPlan(client, planned));
}

function runCheck() {
  const planned = planMigrations();
  console.log(`Validated ${planned.length} migration(s):`);
  for (const migration of planned) {
    console.log(
      `  ${migration.version} ${migration.file} sha256=${migration.checksum.slice(0, 12)}`,
    );
  }
  console.log('db:migrate --check PASS (files valid; no database connection made)');
  return 0;
}

async function runApply(smoke, planOnly = false) {
  let databaseUrl;
  let expectedDatabase;
  if (smoke) {
    databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      console.error(
        'BLOCKED: TEST_DATABASE_URL is not set; the migration smoke runs only against the isolated test database.',
      );
      return EX_CONFIG;
    }
    const dbName = new URL(databaseUrl).pathname.replace(/^\//, '');
    if (!dbName.endsWith('_test')) {
      console.error(
        `BLOCKED: TEST_DATABASE_URL must point to an isolated *_test database, got "${dbName}"; refusing to touch it.`,
      );
      return EX_CONFIG;
    }
  } else {
    databaseUrl = process.env.MIGRATION_DATABASE_URL;
    expectedDatabase = process.env.MIGRATION_EXPECT_DATABASE;
    if (!databaseUrl || !expectedDatabase) {
      console.error(
        'BLOCKED: MIGRATION_DATABASE_URL and MIGRATION_EXPECT_DATABASE are required; DATABASE_URL is never an implicit migration target.',
      );
      return EX_CONFIG;
    }
    const urlDatabase = new URL(databaseUrl).pathname.replace(/^\//, '');
    if (urlDatabase !== expectedDatabase) {
      console.error(
        `BLOCKED: migration URL targets "${urlDatabase}" but MIGRATION_EXPECT_DATABASE is "${expectedDatabase}".`,
      );
      return EX_CONFIG;
    }
    if (process.env.MIGRATION_CONFIRM !== `APPLY:${expectedDatabase}`) {
      console.error(
        `BLOCKED: set MIGRATION_CONFIRM exactly to "APPLY:${expectedDatabase}" for this target.`,
      );
      return EX_CONFIG;
    }
  }
  const planned = planMigrations();
  const firstPass = await withClient(databaseUrl, async (client) => {
    const connected = await client.query('SELECT current_database() AS name');
    const connectedDatabase = connected.rows[0]?.name;
    if (!smoke && connectedDatabase !== expectedDatabase) {
      throw Object.assign(
        new Error(
          `connected database "${connectedDatabase}" does not match attested target "${expectedDatabase}"`,
        ),
        { exitCode: EX_CONFIG },
      );
    }
    return planOnly ? (await inspectPlan(client, planned)).length : applyPlan(client, planned);
  });
  if (planOnly) {
    console.log(`Planned ${firstPass} pending migration(s); read-only, no changes applied.`);
    console.log('db:migrate --plan PASS');
    return 0;
  }
  console.log(`Applied ${firstPass} migration(s).`);
  if (smoke) {
    const secondPass = await applyMigrations(databaseUrl);
    if (secondPass !== 0) {
      console.error(`Idempotency check failed: re-run applied ${secondPass} migration(s).`);
      return 1;
    }
    console.log('Idempotency verified: re-run applied 0 migrations.');
  }
  console.log('db:migrate PASS');
  return 0;
}

export async function main(argv) {
  try {
    if (argv.includes('--check')) {
      return runCheck();
    }
    const smoke = argv.includes('--smoke') || argv.length === 0;
    return await runApply(smoke, argv.includes('--plan'));
  } catch (error) {
    console.error(`db:migrate FAIL: ${error instanceof Error ? error.message : String(error)}`);
    return error?.exitCode || 1;
  }
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
