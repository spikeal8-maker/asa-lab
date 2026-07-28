#!/usr/bin/env node
/**
 * Records — and later verifies — the data that must survive the identity
 * migration chain.
 *
 * The point is not a row count for its own sake: it is the promise that the
 * teacher who already uses ASA Lab keeps their tenant, their classes, their
 * projects and their password. Identifiers are written out so a comparison
 * after the migrations proves the same rows, not merely the same number.
 *
 * Usage:
 *   DATABASE_URL=... node tools/identity-baseline.mjs capture <file>
 *   DATABASE_URL=... node tools/identity-baseline.mjs verify  <file>
 */
import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const COUNTED = [
  'tenants',
  'users',
  'schools',
  'academic_periods',
  'classrooms',
  'classroom_memberships',
  'projects',
  'project_drafts',
  'project_versions',
  'audit_events',
];

async function snapshot(pool) {
  const counts = {};
  for (const table of COUNTED) {
    const result = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    counts[table] = result.rows[0].n;
  }

  const ids = {};
  for (const [key, sql] of [
    ['tenants', `SELECT id FROM tenants ORDER BY id`],
    ['users', `SELECT id FROM users ORDER BY id`],
    ['classrooms', `SELECT id FROM classrooms ORDER BY id`],
    ['projects', `SELECT id FROM projects ORDER BY id`],
    ['project_versions', `SELECT id FROM project_versions ORDER BY id`],
  ]) {
    const result = await pool.query(sql);
    ids[key] = result.rows.map((row) => row.id);
  }

  // The seeded teacher, their tenant, classes and projects. The password hash
  // is fingerprinted, never copied: the check is "unchanged", not "readable".
  const teachers = await pool.query(
    `SELECT u.id, u.tenant_id, u.email, u.display_name, u.password_hash, u.school_id
       FROM users u ORDER BY u.created_at, u.id`,
  );
  const seeded = [];
  for (const row of teachers.rows) {
    const classrooms = await pool.query(
      `SELECT id, title FROM classrooms WHERE tenant_id = $1 AND created_by = $2 ORDER BY id`,
      [row.tenant_id, row.id],
    );
    const projects = await pool.query(
      `SELECT id, title, project_scope FROM projects WHERE tenant_id = $1 AND created_by = $2 ORDER BY id`,
      [row.tenant_id, row.id],
    );
    seeded.push({
      userId: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      displayName: row.display_name,
      schoolId: row.school_id,
      passwordHashFingerprint: createHash('sha256').update(row.password_hash).digest('hex'),
      classrooms: classrooms.rows,
      projects: projects.rows,
    });
  }

  return { capturedAt: new Date().toISOString(), counts, ids, teachers: seeded };
}

function difference(before, after) {
  const problems = [];
  for (const table of COUNTED) {
    if (after.counts[table] < before.counts[table]) {
      problems.push(
        `${table}: ${before.counts[table]} → ${after.counts[table]} (rows disappeared)`,
      );
    }
  }
  for (const key of Object.keys(before.ids)) {
    const present = new Set(after.ids[key] ?? []);
    const missing = before.ids[key].filter((id) => !present.has(id));
    if (missing.length > 0) {
      problems.push(`${key}: ${missing.length} identifier(s) missing, first ${missing[0]}`);
    }
  }
  for (const teacher of before.teachers) {
    const now = after.teachers.find((entry) => entry.userId === teacher.userId);
    if (!now) {
      problems.push(`teacher ${teacher.email}: user row disappeared`);
      continue;
    }
    if (now.tenantId !== teacher.tenantId)
      problems.push(`teacher ${teacher.email}: tenant changed`);
    if (now.passwordHashFingerprint !== teacher.passwordHashFingerprint) {
      problems.push(`teacher ${teacher.email}: password hash changed`);
    }
    for (const classroom of teacher.classrooms) {
      if (!now.classrooms.some((entry) => entry.id === classroom.id)) {
        problems.push(`teacher ${teacher.email}: classroom ${classroom.title} missing`);
      }
    }
    for (const project of teacher.projects) {
      if (!now.projects.some((entry) => entry.id === project.id)) {
        problems.push(`teacher ${teacher.email}: project ${project.title} missing`);
      }
    }
  }
  return problems;
}

const [mode, file] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !file || (mode !== 'capture' && mode !== 'verify')) {
  console.error('usage: DATABASE_URL=... node tools/identity-baseline.mjs capture|verify <file>');
  process.exit(78);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  const now = await snapshot(pool);
  if (mode === 'capture') {
    writeFileSync(file, JSON.stringify(now, null, 2), 'utf8');
    console.log(`baseline captured: ${file}`);
    for (const table of COUNTED) console.log(`  ${table}: ${now.counts[table]}`);
    process.exit(0);
  }
  const before = JSON.parse(readFileSync(file, 'utf8'));
  const problems = difference(before, now);
  for (const table of COUNTED) {
    console.log(`  ${table}: ${before.counts[table]} → ${now.counts[table]}`);
  }
  if (problems.length > 0) {
    console.error('baseline verification FAILED:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('baseline verification PASS: every recorded row and identifier is still there.');
} finally {
  await pool.end();
}
