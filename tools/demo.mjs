#!/usr/bin/env node
/**
 * Owner-facing local demo launcher.
 *
 * `pnpm dev` deliberately remains fail-closed and requires APP_DATABASE_URL.
 * This wrapper is only for an already-provisioned local ASA Lab demo: when the
 * environment variable is absent, it reads the runtime-role credential created
 * by `pnpm db:seed:dev` from LOCALAPPDATA, constructs a loopback-only database
 * URL, injects it into this process and starts the normal dev orchestrator.
 *
 * The password is never printed or written into the repository.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function blocked(message) {
  console.error(`BLOCKED: ${message}`);
  process.exit(78);
}

function resolveLocalDatabaseUrl() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    blocked('LOCALAPPDATA is unavailable; the local demo credential cannot be located.');
  }

  const credentialFile = join(localAppData, 'asa-lab-devenv', 'app-db.json');
  if (!existsSync(credentialFile)) {
    blocked(
      `local demo runtime credential is missing at ${credentialFile}. Ask the coding bot to prepare the local demo; do not paste database passwords into the terminal or chat.`,
    );
  }

  let credential;
  try {
    credential = JSON.parse(readFileSync(credentialFile, 'utf8'));
  } catch (error) {
    blocked(
      `local demo runtime credential cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const user = typeof credential?.user === 'string' ? credential.user.trim() : '';
  const password = typeof credential?.password === 'string' ? credential.password : '';
  if (!user || !password) {
    blocked(
      'local demo runtime credential is incomplete; ask the coding bot to provision it again.',
    );
  }

  const host = process.env.ASA_LOCAL_DB_HOST?.trim() || '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost') {
    blocked(`ASA_LOCAL_DB_HOST must be loopback-only for owner demo, got: ${host}`);
  }

  const portSource = process.env.ASA_LOCAL_DB_PORT?.trim() || '5433';
  const port = Number.parseInt(portSource, 10);
  if (!Number.isInteger(port) || String(port) !== portSource || port < 1024 || port > 65535) {
    blocked(`ASA_LOCAL_DB_PORT must be an integer in 1024..65535, got: ${portSource}`);
  }

  const database = process.env.ASA_LOCAL_DB_NAME?.trim() || 'asalab';
  if (!/^[A-Za-z0-9_-]+$/.test(database)) {
    blocked(`ASA_LOCAL_DB_NAME contains unsupported characters: ${database}`);
  }

  const url = new URL(`postgresql://${host}:${port}/${database}`);
  url.username = user;
  url.password = password;

  console.log(`ASA Lab demo: using local runtime credential from ${credentialFile}.`);
  console.log('ASA Lab demo: the database password is not printed.');
  return url.toString();
}

if (!process.env.APP_DATABASE_URL) {
  process.env.APP_DATABASE_URL = resolveLocalDatabaseUrl();
}

/**
 * Class-code digests need a server-side pepper. It is created locally on first
 * use and, like the database password, never printed.
 *
 * If the secret is gone while codes still exist, a fresh one is NOT generated:
 * every stored digest was computed with the old key, so a new secret would
 * quietly turn every class code a teacher already handed out into "not found".
 * The demo says so instead and leaves the choice — restore the secret, or
 * revoke and re-issue the codes — to a person.
 */
if (!process.env.ASA_JOIN_CODE_PEPPER) {
  const { joinCodePepperExists, resolveJoinCodePepper } = await import('./local-secrets.mjs');
  let activeCodes = 0;
  if (!joinCodePepperExists()) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 1 });
    try {
      const result = await pool.query(`SELECT classroom_active_join_code_count() AS n`);
      activeCodes = result.rows[0]?.n ?? 0;
    } catch {
      // A database without the class-code layer yet has no codes to protect.
      activeCodes = 0;
    } finally {
      await pool.end();
    }
  }
  try {
    process.env.ASA_JOIN_CODE_PEPPER = resolveJoinCodePepper({ create: activeCodes === 0 });
  } catch (error) {
    blocked(error instanceof Error ? error.message : String(error));
  }
}

await import('./dev.mjs');
