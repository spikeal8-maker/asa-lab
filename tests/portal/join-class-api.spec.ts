import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';
import { buildTestApp, inject, type NestApp } from './app';

/**
 * TST-JOIN-CODE-001 — class-code entry.
 *
 * Resolving a code answers which class it is and creates nothing: no session,
 * no membership, no roster. An unknown code is indistinguishable from a
 * malformed one, so the endpoint cannot be used to discover classes.
 */

let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;

async function seedClassroom(label: string): Promise<{ title: string; code: string }> {
  const teacher = await seedTeacher(admin, label);
  const title = `Класс ${label}`;
  const inserted = await admin.query(
    `INSERT INTO classrooms (tenant_id, school_id, academic_period_id, title, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING join_code`,
    [teacher.tenantId, teacher.schoolId, teacher.periodId, title, teacher.teacherId],
  );
  return { title, code: inserted.rows[0].join_code as string };
}

async function resolve(code: unknown) {
  return inject(app, { method: 'POST', url: '/api/join-class/resolve', payload: { code } });
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

describe('class code resolution', () => {
  it('gives every classroom a code and previews the class behind it', async () => {
    const classroom = await seedClassroom('code');
    expect(classroom.code).toMatch(/^[A-Z0-9]{6}$/);

    const response = await resolve(classroom.code);
    expect(response.statusCode).toBe(200);
    expect(response.json().classroom.title).toBe(classroom.title);
    expect(typeof response.json().classroom.educatorDisplayName).toBe('string');
  });

  it('accepts a code copied with spaces, dashes and the wrong case', async () => {
    const classroom = await seedClassroom('normalize');
    const messy = ` ${classroom.code.slice(0, 3).toLowerCase()}-${classroom.code.slice(3)} `;
    const response = await resolve(messy);
    expect(response.statusCode).toBe(200);
    expect(response.json().classroom.title).toBe(classroom.title);
  });

  it('creates no membership, no seat and no session', async () => {
    const classroom = await seedClassroom('no-side-effect');
    const before = await admin.query(`SELECT count(*)::int AS n FROM sessions`);
    const memberships = await admin.query(`SELECT count(*)::int AS n FROM classroom_memberships`);

    const response = await resolve(classroom.code);
    expect(response.cookies).toHaveLength(0);

    const afterSessions = await admin.query(`SELECT count(*)::int AS n FROM sessions`);
    const afterMemberships = await admin.query(
      `SELECT count(*)::int AS n FROM classroom_memberships`,
    );
    expect(afterSessions.rows[0].n).toBe(before.rows[0].n);
    expect(afterMemberships.rows[0].n).toBe(memberships.rows[0].n);
  });

  it('answers an unknown code exactly like a malformed one', async () => {
    const unknown = await resolve('ZZZZZZ');
    const malformed = await resolve('!!');
    expect(unknown.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(404);
    expect(malformed.json()).toEqual(unknown.json());
    expect(unknown.json().error.code).toBe('class_not_found');
  });

  it('rejects a body that carries anything but the code', async () => {
    const response = await inject(app, {
      method: 'POST',
      url: '/api/join-class/resolve',
      payload: { code: 'ABCDEF', tenantId: 'anything' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('reads the preview only through the narrow function, not through the table', async () => {
    const classroom = await seedClassroom('rls');
    // Without a tenant context row-level security hides every classroom from
    // the runtime role; the resolve function is the only way in.
    const direct = await runtime.query(`SELECT join_code FROM classrooms WHERE join_code = $1`, [
      classroom.code,
    ]);
    expect(direct.rows).toHaveLength(0);
    expect((await resolve(classroom.code)).statusCode).toBe(200);
  });
});
