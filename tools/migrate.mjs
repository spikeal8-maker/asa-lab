#!/usr/bin/env node
// Migration runner for ASA Lab.
//
// `--check` validates the migration set locally (naming, ordering, checksums)
// without applying anything. Applying migrations needs a live PostgreSQL, which
// is not available on the current machine; in that case the check exits with
// code 78 (EX_CONFIG) so the task test runner records the DB smoke as BLOCKED
// rather than a false PASS or FAIL.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'migrations';
const EX_CONFIG = 78;

function loadMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) {
    console.error(`No migrations directory at ${MIGRATIONS_DIR}`);
    process.exit(1);
  }
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    console.error('No migration files found');
    process.exit(1);
  }

  const pattern = /^(\d{4})_[a-z0-9_]+\.sql$/;
  const seen = new Set();
  const migrations = [];
  for (const file of files) {
    const match = pattern.exec(file);
    if (!match) {
      console.error(`Migration file has an invalid name: ${file}`);
      process.exit(1);
    }
    const version = match[1];
    if (seen.has(version)) {
      console.error(`Duplicate migration version: ${version}`);
      process.exit(1);
    }
    seen.add(version);
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    migrations.push({ version, file, checksum });
  }

  const versions = migrations.map((migration) => Number.parseInt(migration.version, 10));
  for (let index = 1; index < versions.length; index += 1) {
    if (versions[index] <= versions[index - 1]) {
      console.error('Migration versions are not strictly increasing');
      process.exit(1);
    }
  }
  return migrations;
}

const migrations = loadMigrations();
console.log(`Validated ${migrations.length} migration(s):`);
for (const migration of migrations) {
  console.log(`  ${migration.version} ${migration.file} sha256=${migration.checksum.slice(0, 12)}`);
}

const isCheck = process.argv.includes('--check');
const databaseUrl = process.env.DATABASE_URL;

if (isCheck && !databaseUrl) {
  console.error('BLOCKED: DATABASE_URL is not set and no PostgreSQL runtime is available.');
  console.error('Migration files are valid; applying them requires a live database.');
  process.exit(EX_CONFIG);
}

if (!databaseUrl) {
  console.error('BLOCKED: DATABASE_URL is required to apply migrations.');
  process.exit(EX_CONFIG);
}

// A real PostgreSQL client is introduced together with the first persistence
// task. Reaching here means a database URL exists but the driver is not part of
// the Bootstrap foundation yet.
console.error('BLOCKED: PostgreSQL driver is not part of the Bootstrap foundation.');
process.exit(EX_CONFIG);
