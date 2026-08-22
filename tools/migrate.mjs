#!/usr/bin/env node
// Migration runner for ASA Lab.
//
// Modes:
//   --check            Validate the migration set locally (names, order,
//                      checksums) without any database connection. Exit 0 on
//                      success.
//   --apply            Apply pending migrations to the database in DATABASE_URL.
//   --smoke (default)  Apply pending migrations to the ISOLATED test database
//                      (TEST_DATABASE_URL, name must end in _test), then verify
//                      a second run applies nothing (idempotency). The smoke
//                      never touches the development database.
//
// When a database is required but DATABASE_URL is unset, the runner exits with
// code 78 (EX_CONFIG) so the task runner records the test as BLOCKED — an
// honest "environment unavailable", not a false PASS/FAIL.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MIGRATIONS_DIR = 'migrations';
const EX_CONFIG = 78;
const ADVISORY_LOCK_KEY = 776_1001; // stable key for the migration advisory lock
const NAME_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
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
    const compatibleChecksums = new Set([sha256(lfSql), sha256(lfSql.replace(/\n/g, '\r\n'))]);
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
  for (const migration of planned) {
    const record = applied.get(migration.version);
    if (!record) {
      pending.push(migration);
    } else if (
      record.checksum !== migration.checksum &&
      !migration.compatibleChecksums?.has(record.checksum)
    ) {
      modified.push(migration);
    }
  }
  return { pending, modified };
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
    const { pending, modified } = reconcile(applied, planned);
    if (modified.length > 0) {
      const versions = modified.map((migration) => migration.version).join(', ');
      throw new Error(`Applied migration(s) were modified after apply: ${versions}`);
    }
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

async function runApply(smoke) {
  let databaseUrl;
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
    databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.error(
        'BLOCKED: DATABASE_URL is not set; a live PostgreSQL is required to apply migrations.',
      );
      return EX_CONFIG;
    }
  }
  const firstPass = await applyMigrations(databaseUrl);
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
    return await runApply(smoke);
  } catch (error) {
    console.error(`db:migrate FAIL: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
