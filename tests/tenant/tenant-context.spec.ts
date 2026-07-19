import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, createTestPool, loginSession, seedTeacher } from '../helpers/slice';

/** TST-TENANT-001: the tenant context is derived on the server from the
 * session; client-supplied tenant identifiers are rejected; sessions behave
 * (login/me/logout) against real PostgreSQL. */

let pool: pg.Pool;
let app: FastifyInstance;

beforeAll(async () => {
  pool = createTestPool();
  app = buildTestApp(pool);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('tenant context from session', () => {
  it('login → me returns the session user; logout revokes it', async () => {
    const teacher = await seedTeacher(pool, 'ctx');
    const token = await loginSession(app, teacher.email, teacher.password);

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { asa_session: token },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(teacher.email);

    const out = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { asa_session: token },
    });
    expect(out.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { asa_session: token },
    });
    expect(after.statusCode).toBe(401);
  });

  it('rejects invalid credentials with 401', async () => {
    const teacher = await seedTeacher(pool, 'badpw');
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: teacher.email, password: 'wrong-password' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('sets an HttpOnly SameSite session cookie', async () => {
    const teacher = await seedTeacher(pool, 'cookie');
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: teacher.email, password: teacher.password },
    });
    const cookie = response.cookies.find((c) => c.name === 'asa_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(String(cookie?.sameSite).toLowerCase()).toBe('lax');
  });

  it('rejects a client-supplied tenant_id in the request body', async () => {
    const teacher = await seedTeacher(pool, 'forge');
    const token = await loginSession(app, teacher.email, teacher.password);
    const response = await app.inject({
      method: 'POST',
      url: '/classrooms',
      cookies: { asa_session: token },
      payload: { title: 'Forged', tenant_id: '00000000-0000-0000-0000-000000000001' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('assigns the classroom to the session tenant, not to any client value', async () => {
    const teacher = await seedTeacher(pool, 'assign');
    const token = await loginSession(app, teacher.email, teacher.password);
    const created = await app.inject({
      method: 'POST',
      url: '/classrooms',
      cookies: { asa_session: token },
      payload: { title: 'Мой класс' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().classroom.id as string;
    const row = await pool.query(`SELECT tenant_id, teacher_id FROM classrooms WHERE id = $1`, [
      id,
    ]);
    expect(row.rows[0].tenant_id).toBe(teacher.tenantId);
    expect(row.rows[0].teacher_id).toBe(teacher.teacherId);
  });

  it('requires a session for classroom routes', async () => {
    const list = await app.inject({ method: 'GET', url: '/classrooms' });
    expect(list.statusCode).toBe(401);
    const create = await app.inject({
      method: 'POST',
      url: '/classrooms',
      payload: { title: 'X' },
    });
    expect(create.statusCode).toBe(401);
  });
});
