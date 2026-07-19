import pg from 'pg';
import { hashPassword } from '../../contexts/identity/dist/index.js';

/** Helpers for Teacher Portal integration tests (real PostgreSQL). */

export function adminPool(): pg.Pool {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL (admin) is required for integration tests');
  }
  return new pg.Pool({ connectionString: url, max: 3 });
}

export function appPool(): pg.Pool {
  const url = process.env['APP_DATABASE_URL'];
  if (!url) {
    throw new Error('APP_DATABASE_URL (runtime role) is required for integration tests');
  }
  return new pg.Pool({ connectionString: url, max: 3 });
}

export interface SeededTeacher {
  tenantId: string;
  workspace: string;
  schoolId: string;
  periodId: string;
  teacherId: string;
  email: string;
  password: string;
}

let n = 0;

export async function seedTeacher(admin: pg.Pool, label: string): Promise<SeededTeacher> {
  n += 1;
  const unique = `${Date.now()}-${n}-${Math.floor(Math.random() * 1e6)}`;
  const workspace = `ws-${label}-${unique}`.toLowerCase().slice(0, 60);
  const email = `teacher-${label}-${unique}@test.local`.toLowerCase();
  const password = `pw-${unique}`;

  const tenant = await admin.query(
    `INSERT INTO tenants (title, workspace_slug) VALUES ($1, $2) RETURNING id`,
    [`Тест ${label}`, workspace],
  );
  const tenantId = tenant.rows[0].id as string;
  await admin.query(`INSERT INTO tenant_placements (tenant_id) VALUES ($1)`, [tenantId]);
  const school = await admin.query(
    `INSERT INTO schools (tenant_id, title) VALUES ($1, 'Школа') RETURNING id`,
    [tenantId],
  );
  const schoolId = school.rows[0].id as string;
  const period = await admin.query(
    `INSERT INTO academic_periods (tenant_id, school_id, title, starts_on, ends_on, is_active)
     VALUES ($1, $2, 'Период', '2026-09-01', '2027-06-30', true) RETURNING id`,
    [tenantId, schoolId],
  );
  const teacher = await admin.query(
    `INSERT INTO users (tenant_id, school_id, role, email, display_name, password_hash)
     VALUES ($1, $2, 'teacher', $3, $4, $5) RETURNING id`,
    [tenantId, schoolId, email, `Педагог ${label}`, hashPassword(password)],
  );
  return {
    tenantId,
    workspace,
    schoolId,
    periodId: period.rows[0].id as string,
    teacherId: teacher.rows[0].id as string,
    email,
    password,
  };
}
