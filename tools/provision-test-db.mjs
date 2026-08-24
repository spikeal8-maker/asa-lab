#!/usr/bin/env node
// Reproducible isolated-test-database preparation (no hidden local files):
//   pnpm db:test:provision [--reset]
// Requires explicit environment:
//   DATABASE_URL          cluster admin connection (any database)
//   TEST_DATABASE_URL     target admin URL; database name MUST end in _test
//   ASA_APP_DB_PASSWORD   password to (re)set for the asalab_app runtime role
// Creates the *_test database (drops first with --reset), applies migrations
// to it and provisions the runtime-role password. Prints no secrets.
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const adminUrl = process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;
const appPassword = process.env.ASA_APP_DB_PASSWORD;
if (!adminUrl || !testUrl || !appPassword) {
  console.error('BLOCKED: DATABASE_URL, TEST_DATABASE_URL and ASA_APP_DB_PASSWORD are required');
  process.exit(78);
}
const testDb = new URL(testUrl).pathname.replace(/^\//, '');
if (!testDb.endsWith('_test')) {
  console.error(`BLOCKED: TEST_DATABASE_URL database must end in _test, got "${testDb}"`);
  process.exit(78);
}

const clusterUrl = new URL(adminUrl);
clusterUrl.pathname = '/postgres';
const cluster = new pg.Client({ connectionString: clusterUrl.toString() });
await cluster.connect();
try {
  if (process.argv.includes('--reset')) {
    await cluster.query(`DROP DATABASE IF EXISTS "${testDb.replaceAll('"', '""')}" WITH (FORCE)`);
    console.log(`test database ${testDb} dropped`);
  }
  const exists = await cluster.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [testDb]);
  if (exists.rows.length === 0) {
    await cluster.query(`CREATE DATABASE "${testDb.replaceAll('"', '""')}"`);
    console.log(`test database ${testDb} created`);
  }
} finally {
  await cluster.end();
}

const migrate = spawnSync('node', ['tools/migrate.mjs', '--apply'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    MIGRATION_DATABASE_URL: testUrl,
    MIGRATION_EXPECT_DATABASE: testDb,
    MIGRATION_CONFIRM: `APPLY:${testDb}`,
  },
});
if (migrate.status !== 0) {
  console.error('migrations failed on the test database');
  process.exit(migrate.status ?? 1);
}

const test = new pg.Client({ connectionString: testUrl });
await test.connect();
try {
  await test.query(
    `ALTER ROLE asalab_app WITH LOGIN PASSWORD '${appPassword.replaceAll("'", "''")}'`,
  );
} finally {
  await test.end();
}
console.log(
  `test database ${testDb} ready; runtime role password applied (APP_TEST_DATABASE_URL should use role asalab_app)`,
);
