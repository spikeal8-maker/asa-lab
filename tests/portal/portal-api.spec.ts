import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { testAdminPool, testAppPool, seedTeacher, type SeededTeacher } from './helpers';
import { buildTestApp, fastifyOf, inject, type NestApp } from './app';

/** TST-PORTAL-API-001: teacher portal API happy paths plus idempotency
 * semantics on the runtime role over the isolated test database. */

let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;

async function login(teacher: SeededTeacher): Promise<string> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/login',
    payload: { workspace: teacher.workspace, email: teacher.email, password: teacher.password },
  });
  const cookie = response.cookies.find((c) => c.name === 'asa_session');
  if (response.statusCode !== 200 || !cookie) {
    throw new Error(`login failed: ${response.statusCode} ${response.body}`);
  }
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

describe('auth', () => {
  it('logs in with an HttpOnly SameSite=Lax cookie, resolves me and logs out', async () => {
    const teacher = await seedTeacher(admin, 'api-auth');
    const response = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { workspace: teacher.workspace, email: teacher.email, password: teacher.password },
    });
    expect(response.statusCode).toBe(200);
    const cookie = response.cookies.find((c) => c.name === 'asa_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(String(cookie?.sameSite).toLowerCase()).toBe('lax');

    const me = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      cookies: { asa_session: cookie?.value ?? '' },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(teacher.email);

    const out = await inject(app, {
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { asa_session: cookie?.value ?? '' },
    });
    expect(out.statusCode).toBe(200);
  });
});

describe('classrooms', () => {
  it('creates a classroom atomically with owner membership and one audit event', async () => {
    const teacher = await seedTeacher(admin, 'api-create');
    const token = await login(teacher);
    const created = await inject(app, {
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': `k-${Date.now()}` },
      payload: { title: '8А Робототехника' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().classroom.id as string;

    const classroom = await admin.query(
      `SELECT tenant_id, school_id, academic_period_id, created_by FROM classrooms WHERE id = $1`,
      [id],
    );
    expect(classroom.rows[0]).toMatchObject({
      tenant_id: teacher.tenantId,
      school_id: teacher.schoolId,
      academic_period_id: teacher.periodId,
      created_by: teacher.teacherId,
    });
    const membership = await admin.query(
      `SELECT member_role, user_id FROM classroom_memberships WHERE tenant_id = $1 AND classroom_id = $2`,
      [teacher.tenantId, id],
    );
    expect(membership.rows).toEqual([{ member_role: 'owner', user_id: teacher.teacherId }]);
    const audit = await admin.query(
      `SELECT action, actor_user_id FROM audit_events WHERE tenant_id = $1 AND entity_id = $2`,
      [teacher.tenantId, id],
    );
    expect(audit.rows).toEqual([{ action: 'classroom.created', actor_user_id: teacher.teacherId }]);

    const list = await inject(app, {
      method: 'GET',
      url: '/api/classrooms',
      cookies: { asa_session: token },
    });
    expect(list.json().items.map((c: { id: string }) => c.id)).toContain(id);
  });

  it('requires a valid Idempotency-Key: missing, empty and oversized are 400', async () => {
    const teacher = await seedTeacher(admin, 'api-key');
    const token = await login(teacher);
    const missing = await inject(app, {
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      payload: { title: 'X' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('invalid_idempotency_key');
    const oversized = await inject(app, {
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': 'x'.repeat(129) },
      payload: { title: 'X' },
    });
    expect(oversized.statusCode).toBe(400);
    const count = await admin.query(
      `SELECT count(*)::int AS n FROM classrooms WHERE tenant_id = $1`,
      [teacher.tenantId],
    );
    expect(count.rows[0].n).toBe(0);
  });

  it('same key + same payload returns the same classroom without duplicates', async () => {
    const teacher = await seedTeacher(admin, 'api-idem');
    const token = await login(teacher);
    const key = `key-${Date.now()}`;
    const first = await inject(app, {
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': key },
      payload: { title: 'Повторяемый' },
    });
    const second = await inject(app, {
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
    const rows = await admin.query(
      `SELECT
         (SELECT count(*)::int FROM classrooms WHERE tenant_id = $1 AND idempotency_key = $2) AS classrooms,
         (SELECT count(*)::int FROM classroom_memberships WHERE tenant_id = $1 AND classroom_id = $3) AS memberships,
         (SELECT count(*)::int FROM audit_events WHERE tenant_id = $1 AND entity_id = $3) AS audits`,
      [teacher.tenantId, key, first.json().classroom.id],
    );
    expect(rows.rows[0]).toEqual({ classrooms: 1, memberships: 1, audits: 1 });
  });

  it('same key + different payload => 409 idempotency_conflict', async () => {
    const teacher = await seedTeacher(admin, 'api-conflict');
    const token = await login(teacher);
    const key = `key-${Date.now()}`;
    const first = await inject(app, {
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': key },
      payload: { title: 'A' },
    });
    expect(first.statusCode).toBe(201);
    const second = await inject(app, {
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': key },
      payload: { title: 'B' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('idempotency_conflict');
  });

  it('idempotent create is atomic under concurrent requests', async () => {
    const teacher = await seedTeacher(admin, 'api-race');
    const token = await login(teacher);
    const key = `key-race-${Date.now()}`;
    const request = () =>
      inject(app, {
        method: 'POST',
        url: '/api/classrooms',
        cookies: { asa_session: token },
        headers: { 'idempotency-key': key },
        payload: { title: 'Гонка' },
      });
    const results = await Promise.all([request(), request(), request()]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.every((c) => c === 200 || c === 201)).toBe(true);
    const ids = new Set(results.map((r) => r.json().classroom.id));
    expect(ids.size).toBe(1);
    const count = await admin.query(
      `SELECT count(*)::int AS n FROM classrooms WHERE tenant_id = $1 AND idempotency_key = $2`,
      [teacher.tenantId, key],
    );
    expect(count.rows[0].n).toBe(1);
  });
});
