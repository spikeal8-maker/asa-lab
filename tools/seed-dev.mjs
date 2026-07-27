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

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL (admin/migration connection) is required');
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
