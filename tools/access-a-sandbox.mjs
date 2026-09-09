// One ephemeral native PostgreSQL cluster for Result A verification. Never
// connects to an existing cluster; no Docker/production settings are read.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import pg from 'pg';

const bin = process.env.ASA_TEST_PG_BIN;
if (!bin) throw new Error('ASA_TEST_PG_BIN must point to PostgreSQL test binaries');
const directory = mkdtempSync(join(tmpdir(), 'asa-access-a-test-'));
const data = join(directory, 'cluster');
const secret = randomBytes(24).toString('hex');
const passwordFile = join(directory, 'init-password');
writeFileSync(passwordFile, secret, { mode: 0o600 });
const listener = net.createServer();
await new Promise((resolve, reject) => {
  listener.once('error', reject);
  listener.listen(0, '127.0.0.1', resolve);
});
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const executable = (name) => join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { env, windowsHide: true, stdio: 'inherit' });
  if (result.status !== 0 || result.error)
    throw new Error(`Isolated check failed: ${command} (exit ${result.status})`);
};
let started = false;
try {
  run(executable('initdb'), [
    '-D',
    data,
    '-U',
    'postgres',
    '--encoding=UTF8',
    '--locale=C',
    '--auth-local=trust',
    '--auth-host=scram-sha-256',
    `--pwfile=${passwordFile}`,
  ]);
  run(executable('pg_ctl'), [
    '-D',
    data,
    '-l',
    join(directory, 'postgres.log'),
    '-o',
    `-h 127.0.0.1 -p ${port} -c max_connections=30 -c shared_buffers=32MB`,
    '-w',
    'start',
  ]);
  started = true;
  const rootUrl = `postgresql://postgres:${secret}@127.0.0.1:${port}/postgres`;
  const admin = new pg.Client({ connectionString: rootUrl });
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE asa_access_a_test');
  } finally {
    await admin.end();
  }
  const testUrl = `postgresql://postgres:${secret}@127.0.0.1:${port}/asa_access_a_test`;
  const appUrl = `postgresql://asalab_app:${secret}@127.0.0.1:${port}/asa_access_a_test`;
  const env = {
    ...process.env,
    NX_SKIP_NX_CACHE: 'true',
    // Vitest defaults to the forks pool. THREADS alone does not cap its DB
    // concurrency, so explicitly bound both pools in this small test cluster.
    VITEST_MAX_FORKS: '2',
    VITEST_MIN_FORKS: '1',
    VITEST_MAX_THREADS: '2',
    VITEST_MIN_THREADS: '1',
    ASA_ACCESS_A_SANDBOX: 'true',
    DATABASE_URL: rootUrl,
    TEST_DATABASE_URL: testUrl,
    APP_TEST_DATABASE_URL: appUrl,
    APP_DATABASE_URL: appUrl,
    MIGRATION_DATABASE_URL: testUrl,
    MIGRATION_EXPECT_DATABASE: 'asa_access_a_test',
    MIGRATION_CONFIRM: 'APPLY:asa_access_a_test',
  };
  run(process.execPath, ['tools/migrate.mjs', '--apply'], env);
  const testAdmin = new pg.Client({ connectionString: testUrl });
  await testAdmin.connect();
  try {
    await testAdmin.query(`ALTER ROLE asalab_app WITH LOGIN PASSWORD '${secret}'`);
  } finally {
    await testAdmin.end();
  }
  const args = process.argv.slice(2);
  if (args.length > 0) run(process.execPath, args, env);
  console.log('PASS: isolated Result A verification; existing clusters never opened.');
} finally {
  unlinkSync(passwordFile);
  if (started) run(executable('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
  console.log(`Stopped isolated cluster; diagnostic files retained in ${directory}`);
}
