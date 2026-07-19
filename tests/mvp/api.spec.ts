import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { createApiApp } from '../../apps/api/dist/app.factory.js';
import { adminPool, appPool, seedTeacher, type SeededTeacher } from './helpers';

/** TST-MVP-API-001: session auth, classroom create/list, owner membership,
 * audit event and idempotency through the real NestJS app running on the
 * runtime (RLS-constrained) database role. */

type NestApp = Awaited<ReturnType<typeof createApiApp>>;

let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;

function fastifyOf(a: NestApp) {
  return a.getHttpAdapter().getInstance();
}

async function login(teacher: SeededTeacher): Promise<string> {
  const response = await fastifyOf(app).inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { workspace: teacher.workspace, email: teacher.email, password: teacher.password },
  });
  if (response.statusCode !== 200) {
    throw new Error(`login failed: ${response.statusCode} ${response.body}`);
  }
  const cookie = response.cookies.find((c) => c.name === 'asa_session');
  if (!cookie) {
    throw new Error('session cookie missing');
  }
  return cookie.value;
}

beforeAll(async () => {
  admin = adminPool();
  runtime = appPool();
  app = await createApiApp({ pool: runtime, webDist: null });
});

afterAll(async () => {
  await app.close();
  await admin.end();
});

describe('auth', () => {
  it('logs in, resolves me, logs out and revokes the session', async () => {
    const teacher = await seedTeacher(admin, 'auth');
    const token = await login(teacher);

    const me = await fastifyOf(app).inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { asa_session: token },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(teacher.email);

    const out = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { asa_session: token },
    });
    expect(out.statusCode).toBe(200);

    const after = await fastifyOf(app).inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { asa_session: token },
    });
    expect(after.statusCode).toBe(401);
  });

  it('sets an HttpOnly SameSite=Lax cookie', async () => {
    const teacher = await seedTeacher(admin, 'cookie');
    const response = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { workspace: teacher.workspace, email: teacher.email, password: teacher.password },
    });
    const cookie = response.cookies.find((c) => c.name === 'asa_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(String(cookie?.sameSite).toLowerCase()).toBe('lax');
  });

  it('rejects a wrong password and a wrong workspace with 401', async () => {
    const teacher = await seedTeacher(admin, 'deny');
    const other = await seedTeacher(admin, 'deny2');
    const wrongPassword = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { workspace: teacher.workspace, email: teacher.email, password: 'nope' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    const wrongWorkspace = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { workspace: other.workspace, email: teacher.email, password: teacher.password },
    });
    expect(wrongWorkspace.statusCode).toBe(401);
  });
});

describe('classrooms', () => {
  it('requires a session', async () => {
    const list = await fastifyOf(app).inject({ method: 'GET', url: '/api/classrooms' });
    expect(list.statusCode).toBe(401);
  });

  it('rejects a client-supplied tenant id with 400', async () => {
    const teacher = await seedTeacher(admin, 'forge');
    const token = await login(teacher);
    const response = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      payload: { title: 'X', tenant_id: '00000000-0000-0000-0000-000000000001' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('creates a classroom atomically with owner membership and an audit event', async () => {
    const teacher = await seedTeacher(admin, 'create');
    const token = await login(teacher);
    const created = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      payload: { title: '8А Робототехника' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().classroom.id as string;

    const classroom = await admin.query(
      `SELECT tenant_id, school_id, academic_period_id, created_by FROM classrooms WHERE id = $1`,
      [id],
    );
    expect(classroom.rows[0].tenant_id).toBe(teacher.tenantId);
    expect(classroom.rows[0].school_id).toBe(teacher.schoolId);
    expect(classroom.rows[0].academic_period_id).toBe(teacher.periodId);
    expect(classroom.rows[0].created_by).toBe(teacher.teacherId);

    const membership = await admin.query(
      `SELECT member_role, user_id FROM classroom_memberships WHERE tenant_id = $1 AND classroom_id = $2`,
      [teacher.tenantId, id],
    );
    expect(membership.rows).toHaveLength(1);
    expect(membership.rows[0].member_role).toBe('owner');
    expect(membership.rows[0].user_id).toBe(teacher.teacherId);

    const audit = await admin.query(
      `SELECT action, actor_user_id FROM audit_events WHERE tenant_id = $1 AND entity_id = $2`,
      [teacher.tenantId, id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].action).toBe('classroom.created');
    expect(audit.rows[0].actor_user_id).toBe(teacher.teacherId);
  });

  it('is idempotent for the same Idempotency-Key', async () => {
    const teacher = await seedTeacher(admin, 'idem');
    const token = await login(teacher);
    const key = `key-${Date.now()}`;
    const first = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': key },
      payload: { title: 'Повторяемый' },
    });
    const second = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': key },
      payload: { title: 'Повторяемый' },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().classroom.id).toBe(first.json().classroom.id);
    expect(second.json().created).toBe(false);

    const count = await admin.query(
      `SELECT count(*)::int AS n FROM classrooms WHERE tenant_id = $1 AND idempotency_key = $2`,
      [teacher.tenantId, key],
    );
    expect(count.rows[0].n).toBe(1);
    const audit = await admin.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND entity_id = $2`,
      [teacher.tenantId, first.json().classroom.id],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('never leaks classrooms across tenants through the API', async () => {
    const teacherA = await seedTeacher(admin, 'iso-a');
    const teacherB = await seedTeacher(admin, 'iso-b');
    const tokenA = await login(teacherA);
    const tokenB = await login(teacherB);
    const created = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: tokenA },
      payload: { title: 'Секрет A' },
    });
    const id = created.json().classroom.id as string;
    const listB = await fastifyOf(app).inject({
      method: 'GET',
      url: '/api/classrooms',
      cookies: { asa_session: tokenB },
    });
    const idsB = (listB.json().items as Array<{ id: string }>).map((c) => c.id);
    expect(idsB).not.toContain(id);
  });

  it('keeps audit events append-only even for the admin role', async () => {
    const teacher = await seedTeacher(admin, 'audit-lock');
    const token = await login(teacher);
    const created = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      payload: { title: 'Аудит' },
    });
    const id = created.json().classroom.id as string;
    const audit = await admin.query(
      `SELECT id FROM audit_events WHERE tenant_id = $1 AND entity_id = $2`,
      [teacher.tenantId, id],
    );
    await expect(
      admin.query(`UPDATE audit_events SET action = 'x' WHERE id = $1`, [audit.rows[0].id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      admin.query(`DELETE FROM audit_events WHERE id = $1`, [audit.rows[0].id]),
    ).rejects.toThrow(/append-only/);
  });
});
