#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiChildEnv } from './child-env.mjs';
import { verifyReleaseArtifact } from './release-artifact.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = verifyReleaseArtifact(root);
const portSource = process.env.ASA_API_PORT?.trim() || '4611';
const port = Number.parseInt(portSource, 10);
if (!Number.isSafeInteger(port) || String(port) !== portSource || port < 1024 || port > 65535) {
  console.error(`ASA_API_PORT must be an integer port in 1024..65535, got: ${portSource}`);
  process.exit(78);
}
if (new Set([3000, 3100, 5173]).has(port)) {
  console.error(`ASA_API_PORT=${port} is forbidden by LOCAL_PORT_POLICY`);
  process.exit(78);
}
const settingsKey = process.env.ASA_SETTINGS_ENCRYPTION_KEY?.trim() ?? '';
const settingsKeyValid =
  /^[a-fA-F0-9]{64}$/.test(settingsKey) ||
  (/^[A-Za-z0-9_-]{43}$/.test(settingsKey) && Buffer.from(settingsKey, 'base64url').length === 32);
if (
  !process.env.APP_DATABASE_URL ||
  !process.env.ASA_OWNER_ADMIN_EMAIL?.trim() ||
  !settingsKeyValid
) {
  console.error(
    'APP_DATABASE_URL, ASA_OWNER_ADMIN_EMAIL and a 32-byte ASA_SETTINGS_ENCRYPTION_KEY are required.',
  );
  process.exit(78);
}

const requireFromRelease = createRequire(resolve(root, 'api', 'package.json'));
const pg = requireFromRelease('pg');
const client = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
try {
  await client.connect();
  const result = await client.query(
    `SELECT runtime_owner_admin_ready($1) AS owner_ready,
            (SELECT version FROM runtime_schema_version()) AS schema_version`,
    [process.env.ASA_OWNER_ADMIN_EMAIL.trim()],
  );
  if (result.rows[0]?.owner_ready !== true) throw new Error('owner platform_admin is not ready');
  if (Number(result.rows[0]?.schema_version) !== manifest.expectedSchemaVersion) {
    throw new Error(
      `schema mismatch: expected ${manifest.expectedSchemaVersion}, got ${String(result.rows[0]?.schema_version)}`,
    );
  }
} catch (error) {
  console.error(`Release database preflight failed: ${String(error)}`);
  process.exit(78);
} finally {
  await client.end().catch(() => undefined);
}

const verifiedAt = new Date().toISOString();
const env = apiChildEnv(
  {
    ...process.env,
    NODE_ENV: 'production',
    ASA_SECURE_COOKIES: '1',
    ASA_PUBLIC_WEB_ORIGINS:
      process.env.ASA_PUBLIC_WEB_ORIGINS ?? 'https://asa-lab.ru,https://www.asa-lab.ru',
    ASA_BUILD_REVISION: manifest.sourceRevision,
    ASA_BUILT_AT: manifest.builtAt,
    ASA_EXPECTED_SCHEMA_VERSION: String(manifest.expectedSchemaVersion),
    ASA_ARTIFACT_INTEGRITY: 'verified',
    ASA_ARTIFACT_VERIFIED_AT: verifiedAt,
  },
  port,
);
const child = spawn(process.execPath, [resolve(root, 'api', 'dist', 'main.js')], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
  env,
});

const integrityTimer = setInterval(() => {
  try {
    verifyReleaseArtifact(root);
  } catch (error) {
    console.error(`Release integrity changed after startup: ${String(error)}`);
    child.kill('SIGTERM');
  }
}, 30_000);
integrityTimer.unref();

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(integrityTimer);
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
child.once('error', (error) => {
  console.error(`ASA Lab release failed to start: ${String(error)}`);
  process.exit(1);
});
child.once('exit', (code, signal) => {
  clearInterval(integrityTimer);
  process.exit(code ?? (signal ? 1 : 0));
});
console.log(
  `ASA Lab ${manifest.releaseRole} release: http://127.0.0.1:${port} revision=${manifest.sourceRevision}`,
);
