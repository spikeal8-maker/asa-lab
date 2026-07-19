import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { testAdminPool, testAppPool, seedTeacher, type SeededTeacher } from './helpers';
import { buildTestApp, fastifyOf, type NestApp } from './app';

/** TST-AUTHZ-001: negative authorization matrix through the real API running
 * on the runtime (RLS-constrained) role. */

let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;

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
  if (!cookie) throw new Error('session cookie missing');
  return cookie.value;
}

beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  app = await buildTestApp(runtime);
});

afterAll(async () => {
  await app.close();
  await admin.end();
});

describe('authentication negatives', () => {
  it('anonymous requests are rejected with 401', async () => {
    for (const [method, url] of [
      ['GET', '/api/auth/me'],
      ['GET', '/api/classrooms'],
      ['POST', '/api/classrooms'],
    ] as const) {
      const response = await fastifyOf(app).inject({ method, url });
      expect(response.statusCode).toBe(401);
    }
  });

  it('a revoked session stops working immediately', async () => {
    const teacher = await seedTeacher(admin, 'authz-revoke');
    const token = await login(teacher);
    await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { asa_session: token },
    });
    const after = await fastifyOf(app).inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { asa_session: token },
    });
    expect(after.statusCode).toBe(401);
  });

  it('wrong password and wrong workspace both yield 401', async () => {
    const teacher = await seedTeacher(admin, 'authz-deny');
    const other = await seedTeacher(admin, 'authz-deny2');
    const wrongPassword = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { workspace: teacher.workspace, email: teacher.email, password: 'nope' },
    });
    const wrongWorkspace = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { workspace: other.workspace, email: teacher.email, password: teacher.password },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongWorkspace.statusCode).toBe(401);
  });
});

describe('request validation', () => {
  it('malformed login bodies yield 400, not 500', async () => {
    for (const payload of [null, [], 'x', 5]) {
      const response = await fastifyOf(app).inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(payload),
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('malformed create-classroom bodies yield 400, not 500', async () => {
    const teacher = await seedTeacher(admin, 'authz-shape');
    const token = await login(teacher);
    for (const payload of [null, [], 'x', 5]) {
      const response = await fastifyOf(app).inject({
        method: 'POST',
        url: '/api/classrooms',
        cookies: { asa_session: token },
        headers: { 'content-type': 'application/json', 'idempotency-key': 'k-shape' },
        payload: JSON.stringify(payload),
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('an empty or whitespace Idempotency-Key yields 400', async () => {
    const teacher = await seedTeacher(admin, 'authz-wskey');
    const token = await login(teacher);
    for (const key of ['', '   ']) {
      const response = await fastifyOf(app).inject({
        method: 'POST',
        url: '/api/classrooms',
        cookies: { asa_session: token },
        headers: { 'idempotency-key': key },
        payload: { title: 'X' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('invalid_idempotency_key');
    }
  });

  it('additional properties are rejected with 400', async () => {
    const teacher = await seedTeacher(admin, 'authz-extra');
    const login400 = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        workspace: teacher.workspace,
        email: teacher.email,
        password: teacher.password,
        admin: true,
      },
    });
    expect(login400.statusCode).toBe(400);
    const token = await login(teacher);
    const create400 = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': 'k-extra' },
      payload: { title: 'X', status: 'archived' },
    });
    expect(create400.statusCode).toBe(400);
  });

  it('a client-supplied tenant id is rejected with 400', async () => {
    const teacher = await seedTeacher(admin, 'authz-forge');
    const token = await login(teacher);
    for (const body of [
      { title: 'X', tenant_id: '00000000-0000-0000-0000-000000000001' },
      { title: 'X', tenantId: '00000000-0000-0000-0000-000000000001' },
    ]) {
      const response = await fastifyOf(app).inject({
        method: 'POST',
        url: '/api/classrooms',
        cookies: { asa_session: token },
        headers: { 'idempotency-key': 'k-forge' },
        payload: body,
      });
      expect(response.statusCode).toBe(400);
    }
  });
});

describe('tenant and school invariants', () => {
  it('never leaks classrooms across tenants through the API', async () => {
    const teacherA = await seedTeacher(admin, 'authz-iso-a');
    const teacherB = await seedTeacher(admin, 'authz-iso-b');
    const tokenA = await login(teacherA);
    const tokenB = await login(teacherB);
    const created = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: tokenA },
      headers: { 'idempotency-key': 'k-iso' },
      payload: { title: 'Секрет A' },
    });
    expect(created.statusCode).toBe(201);
    const listB = await fastifyOf(app).inject({
      method: 'GET',
      url: '/api/classrooms',
      cookies: { asa_session: tokenB },
    });
    const idsB = (listB.json().items as Array<{ id: string }>).map((c) => c.id);
    expect(idsB).not.toContain(created.json().classroom.id);
  });

  it('a school without an active academic period yields an explicit 409', async () => {
    const teacher = await seedTeacher(admin, 'authz-noperiod', { withActivePeriod: false });
    const token = await login(teacher);
    const response = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': 'k-noperiod' },
      payload: { title: 'X' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('no_active_period');
  });

  it('a teacher without a school gets an explicit error', async () => {
    const teacher = await seedTeacher(admin, 'authz-noschool', { withSchool: false });
    const token = await login(teacher);
    const response = await fastifyOf(app).inject({
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': 'k-noschool' },
      payload: { title: 'X' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('no_school_assigned');
  });
});
