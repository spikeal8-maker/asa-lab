import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api/src/app';
import { hashPassword } from '../../apps/api/src/security';

/** Shared helpers for the classroom-slice integration tests (real PostgreSQL). */

export function requireDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL is required for integration tests: start the local PostgreSQL and export DATABASE_URL',
    );
  }
  return url;
}

export function createTestPool(): pg.Pool {
  return new pg.Pool({ connectionString: requireDatabaseUrl(), max: 3 });
}

export interface SeededTeacher {
  readonly tenantId: string;
  readonly workspace: string;
  readonly schoolId: string;
  readonly teacherId: string;
  readonly email: string;
  readonly password: string;
}

let counter = 0;

/** Create an isolated tenant + school + teacher for one test run.
 * `options.email` lets two tenants share the same e-mail on purpose. */
export async function seedTeacher(
  pool: pg.Pool,
  label: string,
  options: { email?: string } = {},
): Promise<SeededTeacher> {
  counter += 1;
  const unique = `${Date.now()}-${counter}-${Math.floor(Math.random() * 1e6)}`;
  const email = options.email ?? `teacher-${label}-${unique}@test.asa-lab.local`;
  const password = `pw-${unique}`;
  const workspace = `ws-${label}-${unique}`.toLowerCase();

  const tenant = await pool.query(
    `INSERT INTO tenants (title, slug) VALUES ($1, $2) RETURNING id`,
    [`Test tenant ${label} ${unique}`, workspace],
  );
  const tenantId = tenant.rows[0].id as string;
  const school = await pool.query(
    `INSERT INTO schools (tenant_id, title) VALUES ($1, $2) RETURNING id`,
    [tenantId, `Test school ${label}`],
  );
  const schoolId = school.rows[0].id as string;
  const teacher = await pool.query(
    `INSERT INTO users (tenant_id, school_id, role, email, display_name, password_hash)
     VALUES ($1, $2, 'teacher', $3, $4, $5) RETURNING id`,
    [tenantId, schoolId, email, `Teacher ${label}`, hashPassword(password)],
  );
  return {
    tenantId,
    workspace,
    schoolId,
    teacherId: teacher.rows[0].id as string,
    email,
    password,
  };
}

/** Login through the real route and return the session cookie value. */
export async function loginSession(
  app: FastifyInstance,
  workspace: string,
  email: string,
  password: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { workspace, email, password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`login failed: ${response.statusCode} ${response.body}`);
  }
  const cookie = response.cookies.find((c) => c.name === 'asa_session');
  if (!cookie) {
    throw new Error('no session cookie set');
  }
  return cookie.value;
}

export function buildTestApp(pool: pg.Pool): FastifyInstance {
  return buildApp({ pool });
}
