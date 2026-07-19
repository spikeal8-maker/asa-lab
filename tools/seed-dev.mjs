#!/usr/bin/env node
// Dev seed for the first classroom slice: one tenant, one school, one teacher.
// Idempotent. The teacher password comes from ASA_SEED_TEACHER_PASSWORD or is
// generated; a generated password is written only to a local file under
// %LOCALAPPDATA%/asa-lab-devenv (never committed, never printed to stdout).
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(78);
}

const TENANT = 'Локальная школа (dev)';
const WORKSPACE = process.env.ASA_SEED_WORKSPACE ?? 'local-school';
const SCHOOL = 'Школа №1 (dev)';
const EMAIL = process.env.ASA_SEED_TEACHER_EMAIL ?? 'teacher@asa-lab.local';
const NAME = 'Педагог (dev)';

function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}

const envPassword = process.env.ASA_SEED_TEACHER_PASSWORD;
const password = envPassword ?? randomBytes(12).toString('hex');

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
try {
  const tenant = await pool.query(
    `INSERT INTO tenants (title, slug) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
     RETURNING id`,
    [TENANT, WORKSPACE],
  );
  const tenantId = tenant.rows[0].id;

  const school = await pool.query(
    `INSERT INTO schools (tenant_id, title) SELECT $1::uuid, $2::varchar(255)
     WHERE NOT EXISTS (SELECT 1 FROM schools WHERE tenant_id = $1::uuid AND title = $2::varchar(255))
     RETURNING id`,
    [tenantId, SCHOOL],
  );
  const schoolId =
    school.rows[0]?.id ??
    (
      await pool.query(`SELECT id FROM schools WHERE tenant_id = $1 AND title = $2`, [
        tenantId,
        SCHOOL,
      ])
    ).rows[0].id;

  const existing = await pool.query(`SELECT id FROM users WHERE tenant_id = $1 AND email = $2`, [
    tenantId,
    EMAIL,
  ]);
  let passwordStored = false;
  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO users (tenant_id, school_id, role, email, display_name, password_hash)
       VALUES ($1, $2, 'teacher', $3, $4, $5)`,
      [tenantId, schoolId, EMAIL, NAME, hashPassword(password)],
    );
    passwordStored = true;
  } else if (envPassword) {
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      hashPassword(password),
      existing.rows[0].id,
    ]);
    passwordStored = true;
  }

  if (passwordStored && !envPassword) {
    const dir = join(process.env.LOCALAPPDATA ?? '.', 'asa-lab-devenv');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'seed-teacher-credentials.txt');
    writeFileSync(file, `email=${EMAIL}\npassword=${password}\n`, { encoding: 'utf8' });
    console.log(`seed: teacher password generated and written to ${file}`);
  }
  console.log(`seed: tenant, school and teacher ready (workspace=${WORKSPACE}, email=${EMAIL})`);
} finally {
  await pool.end();
}
