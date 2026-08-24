#!/usr/bin/env node
// Dev seed for Teacher Portal v0.1 (Issue #18): tenant school-1580 with a
// SHARED_CLUSTER placement, one school, one active academic period and one
// teacher. Also provisions the runtime DB role password. Idempotent.
// Secrets are stored only under %LOCALAPPDATA%/asa-lab-devenv and are never
// printed to the console.
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
if (!DATABASE_URL) {
  console.error('MIGRATION_DATABASE_URL (admin/migration connection) is required');
  process.exit(78);
}

const WORKSPACE = process.env.ASA_SEED_WORKSPACE ?? 'school-1580';
const EMAIL = process.env.ASA_SEED_TEACHER_EMAIL ?? `teacher@${WORKSPACE}.local`;
const LOCAL_DIR = join(process.env.LOCALAPPDATA ?? '.', 'asa-lab-devenv');

function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt-v1$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
try {
  const tenant = await pool.query(
    `INSERT INTO tenants (title, workspace_slug) VALUES ($1, $2)
     ON CONFLICT (workspace_slug) DO UPDATE SET title = EXCLUDED.title
     RETURNING id`,
    ['Школа №1580 (dev)', WORKSPACE],
  );
  const tenantId = tenant.rows[0].id;
  await pool.query(
    `INSERT INTO tenant_placements (tenant_id, mode) VALUES ($1, 'SHARED_CLUSTER')
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId],
  );

  let school = await pool.query(`SELECT id FROM schools WHERE tenant_id = $1 AND title = $2`, [
    tenantId,
    'Основная школа',
  ]);
  if (school.rows.length === 0) {
    school = await pool.query(
      `INSERT INTO schools (tenant_id, title) VALUES ($1, $2) RETURNING id`,
      [tenantId, 'Основная школа'],
    );
  }
  const schoolId = school.rows[0].id;

  const period = await pool.query(
    `SELECT id FROM academic_periods WHERE tenant_id = $1 AND school_id = $2 AND is_active`,
    [tenantId, schoolId],
  );
  if (period.rows.length === 0) {
    await pool.query(
      `INSERT INTO academic_periods (tenant_id, school_id, title, starts_on, ends_on, is_active)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [tenantId, schoolId, '2026/2027 учебный год', '2026-09-01', '2027-06-30'],
    );
  }

  const envPassword = process.env.ASA_SEED_TEACHER_PASSWORD;
  const teacherPassword = envPassword ?? randomBytes(12).toString('hex');
  const existing = await pool.query(
    `SELECT id FROM users WHERE tenant_id = $1 AND lower(email) = lower($2)`,
    [tenantId, EMAIL],
  );
  let wrotePassword = false;
  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO users (tenant_id, school_id, role, email, display_name, password_hash)
       VALUES ($1, $2, 'teacher', $3, $4, $5)`,
      [tenantId, schoolId, EMAIL.toLowerCase(), 'Педагог (dev)', hashPassword(teacherPassword)],
    );
    wrotePassword = true;
  } else if (envPassword) {
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      hashPassword(teacherPassword),
      existing.rows[0].id,
    ]);
    wrotePassword = true;
  }

  // The account/session-v2 migration backfilled only users that existed when
  // migration 0010 ran. A dev tenant may be seeded later, so keep the legacy
  // teacher and the modern account model linked on every idempotent seed run.
  const teacher = await pool.query(
    `SELECT id, email, display_name, password_hash
       FROM users
      WHERE tenant_id = $1 AND lower(email) = lower($2)
      LIMIT 1`,
    [tenantId, EMAIL],
  );
  const teacherRow = teacher.rows[0];

  const workspace = await pool.query(
    `INSERT INTO workspaces (tenant_id, kind, title)
     VALUES ($1, 'organization', $2)
     ON CONFLICT (tenant_id) DO UPDATE SET title = EXCLUDED.title
     RETURNING id`,
    [tenantId, 'Школа №1580 (dev)'],
  );
  const workspaceId = workspace.rows[0].id;

  let account = await pool.query(`SELECT id FROM accounts WHERE lower(email) = lower($1)`, [EMAIL]);
  if (account.rows.length === 0) {
    account = await pool.query(
      `INSERT INTO accounts (email, password_hash, birth_date, country)
       VALUES ($1, $2, DATE '1990-01-01', 'RU')
       RETURNING id`,
      [teacherRow.email, teacherRow.password_hash],
    );
  } else if (envPassword) {
    await pool.query(`UPDATE accounts SET password_hash = $1 WHERE id = $2`, [
      teacherRow.password_hash,
      account.rows[0].id,
    ]);
  }
  const accountId = account.rows[0].id;
  const username = `edu-${accountId.replaceAll('-', '').slice(0, 10)}`;

  await pool.query(
    `INSERT INTO profiles (account_id, username, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (account_id) DO NOTHING`,
    [accountId, username, teacherRow.display_name],
  );
  const principal = await pool.query(
    `INSERT INTO principals (kind, account_id)
     VALUES ('account', $1)
     ON CONFLICT (account_id) DO UPDATE SET account_id = EXCLUDED.account_id
     RETURNING id`,
    [accountId],
  );
  const principalId = principal.rows[0].id;

  await pool.query(
    `INSERT INTO capability_grants
       (account_id, capability, state, policy_version, granted_by)
     VALUES
       ($1, 'creator', 'verified', 'asa-lab-2026-07', 'migration'),
       ($1, 'educator', 'verified', 'asa-lab-2026-07', 'migration')
     ON CONFLICT (account_id, capability) DO UPDATE
       SET state = 'verified', policy_version = EXCLUDED.policy_version`,
    [accountId],
  );
  await pool.query(
    `INSERT INTO workspace_memberships (account_id, workspace_id, role)
     VALUES ($1, $2, 'educator')
     ON CONFLICT (account_id, workspace_id) DO NOTHING`,
    [accountId, workspaceId],
  );
  await pool.query(
    `INSERT INTO legacy_user_account_links (tenant_id, user_id, account_id, principal_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, user_id) DO NOTHING`,
    [tenantId, teacherRow.id, accountId, principalId],
  );

  mkdirSync(LOCAL_DIR, { recursive: true });
  if (wrotePassword && !envPassword) {
    writeFileSync(
      join(LOCAL_DIR, 'seed-teacher-credentials.txt'),
      `workspace=${WORKSPACE}\nemail=${EMAIL.toLowerCase()}\npassword=${teacherPassword}\n`,
      'utf8',
    );
  }

  // Runtime role password (never printed). Reused if already provisioned.
  const appFile = join(LOCAL_DIR, 'app-db.json');
  let appPassword = process.env.ASA_APP_DB_PASSWORD ?? null;
  if (!appPassword && existsSync(appFile)) {
    appPassword = JSON.parse(readFileSync(appFile, 'utf8')).password;
  }
  if (!appPassword) {
    appPassword = randomBytes(18).toString('hex');
  }
  await pool.query(
    `ALTER ROLE asalab_app WITH LOGIN PASSWORD '${appPassword.replaceAll("'", "''")}'`,
  );
  writeFileSync(appFile, JSON.stringify({ user: 'asalab_app', password: appPassword }), 'utf8');

  console.log(`seed: tenant "${WORKSPACE}", school, active period and teacher are ready`);
  console.log(
    `seed: teacher login = ${EMAIL.toLowerCase()} (password: env or ${join(LOCAL_DIR, 'seed-teacher-credentials.txt')})`,
  );
  console.log(`seed: runtime DB role asalab_app provisioned (password in ${appFile})`);
} finally {
  await pool.end();
}
