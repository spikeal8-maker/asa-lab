#!/usr/bin/env node
// Production launcher for the single-process API + built Web SPA.
// It never builds at startup: deployment builds and verifies first, then this
// process starts only already-produced artifacts with the runtime-role DB URL.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiChildEnv } from './child-env.mjs';
import { verifyWebArtifact } from './verify-web-artifact.mjs';

function loadDotEnvLocal() {
  const file = '.env.local';
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

function resolvePort(raw) {
  const source = raw?.trim() || '4611';
  const port = Number.parseInt(source, 10);
  if (!Number.isInteger(port) || String(port) !== source || port < 1024 || port > 65535) {
    console.error(`ASA_API_PORT must be an integer port in 1024..65535, got: ${source}`);
    process.exit(78);
  }
  if (new Set([3000, 3100, 5173]).has(port)) {
    console.error(`ASA_API_PORT=${port} is forbidden by LOCAL_PORT_POLICY`);
    process.exit(78);
  }
  return port;
}

loadDotEnvLocal();
const port = resolvePort(process.env.ASA_API_PORT);
const entry = resolve('apps/api/dist/main.js');
const webEntry = resolve('apps/web/dist/index.html');
const webMetadataEntry = resolve('apps/web/dist/build-metadata.json');

if (!process.env.APP_DATABASE_URL) {
  console.error('APP_DATABASE_URL is required in the environment or uncommitted .env.local.');
  process.exit(78);
}
if (!existsSync(entry) || !existsSync(webEntry) || !existsSync(webMetadataEntry)) {
  console.error('Production artifacts are missing. Run `pnpm build` before startup.');
  process.exit(78);
}

const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
  windowsHide: true,
});
const checkoutRevision = revision.stdout.trim();
let webArtifact;
try {
  if (!checkoutRevision) throw new Error('Cannot determine checkout revision');
  webArtifact = verifyWebArtifact({
    webDist: resolve('apps/web/dist'),
    expectedRevision: checkoutRevision,
  });
} catch (error) {
  console.error(`${String(error)}. Rebuild before startup.`);
  process.exit(78);
}
const migrationVersions = readdirSync(resolve('migrations'))
  .map((name) => /^(\d{4})_.*\.sql$/.exec(name)?.[1])
  .filter(Boolean)
  .map(Number);
const expectedSchemaVersion = Math.max(...migrationVersions);
if (!Number.isSafeInteger(expectedSchemaVersion)) {
  console.error('Cannot determine the expected database schema version.');
  process.exit(78);
}
const ownerAdminEmail = process.env.ASA_OWNER_ADMIN_EMAIL?.trim();
if (!ownerAdminEmail) {
  console.error('ASA_OWNER_ADMIN_EMAIL is required for production owner preflight.');
  process.exit(78);
}
const settingsKey = process.env.ASA_SETTINGS_ENCRYPTION_KEY?.trim() ?? '';
const settingsKeyValid =
  /^[a-fA-F0-9]{64}$/.test(settingsKey) ||
  (/^[A-Za-z0-9_-]{43}$/.test(settingsKey) && Buffer.from(settingsKey, 'base64url').length === 32);
if (!settingsKeyValid) {
  console.error('ASA_SETTINGS_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  process.exit(78);
}
const pg = (await import('pg')).default;
const preflightClient = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
try {
  await preflightClient.connect();
  const result = await preflightClient.query(
    `SELECT runtime_owner_admin_ready($1) AS owner_ready,
            (SELECT version FROM runtime_schema_version()) AS schema_version`,
    [ownerAdminEmail],
  );
  if (result.rows[0]?.owner_ready !== true) {
    console.error('Owner platform_admin preflight failed. Production was not started.');
    process.exit(78);
  }
  const actualSchemaVersion = Number(result.rows[0]?.schema_version);
  if (actualSchemaVersion !== expectedSchemaVersion) {
    console.error(
      `Database schema mismatch: expected ${expectedSchemaVersion}, got ${String(result.rows[0]?.schema_version)}. Production was not started.`,
    );
    process.exit(78);
  }
} catch (error) {
  console.error(`Owner platform_admin preflight failed: ${String(error)}`);
  process.exit(78);
} finally {
  await preflightClient.end().catch(() => undefined);
}
const env = apiChildEnv(
  {
    ...process.env,
    NODE_ENV: 'production',
    ASA_SECURE_COOKIES: '1',
    ASA_PUBLIC_WEB_ORIGINS:
      process.env.ASA_PUBLIC_WEB_ORIGINS ?? 'https://asa-lab.ru,https://www.asa-lab.ru',
    ASA_BUILD_REVISION: webArtifact.metadata.revision,
    ASA_BUILT_AT: webArtifact.metadata.builtAt,
    ASA_EXPECTED_SCHEMA_VERSION: String(expectedSchemaVersion),
    ASA_ARTIFACT_INTEGRITY: 'verified',
    ASA_ARTIFACT_VERIFIED_AT: new Date().toISOString(),
  },
  port,
);

const child = spawn(process.execPath, [entry], {
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
  env,
});

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
child.once('error', (error) => {
  console.error(`ASA Lab production failed to start: ${String(error)}`);
  process.exit(1);
});
child.once('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});

console.log(`ASA Lab production: http://127.0.0.1:${port}`);
