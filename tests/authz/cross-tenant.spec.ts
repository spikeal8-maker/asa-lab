import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, createTestPool, loginSession, seedTeacher } from '../helpers/slice';

/** TST-AUTHZ-001: cross-tenant read/write denial and immutable audit trail
 * against real PostgreSQL. */

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

describe('cross-tenant isolation', () => {
  it('a classroom of tenant A is never visible to tenant B', async () => {
    const teacherA = await seedTeacher(pool, 'a');
    const teacherB = await seedTeacher(pool, 'b');
    const tokenA = await loginSession(app, teacherA.email, teacherA.password);
    const tokenB = await loginSession(app, teacherB.email, teacherB.password);

    const created = await app.inject({
      method: 'POST',
      url: '/classrooms',
      cookies: { asa_session: tokenA },
      payload: { title: 'Секретный класс A' },
    });
    expect(created.statusCode).toBe(201);
    const classroomId = created.json().classroom.id as string;

    const listB = await app.inject({
      method: 'GET',
      url: '/classrooms',
      cookies: { asa_session: tokenB },
    });
    expect(listB.statusCode).toBe(200);
    const idsB = (listB.json().items as Array<{ id: string }>).map((c) => c.id);
    expect(idsB).not.toContain(classroomId);

    const listA = await app.inject({
      method: 'GET',
      url: '/classrooms',
      cookies: { asa_session: tokenA },
    });
    expect((listA.json().items as Array<{ id: string }>).map((c) => c.id)).toContain(classroomId);
  });

  it('tenant B cannot modify tenant A data through any exposed route', async () => {
    const teacherA = await seedTeacher(pool, 'mod-a');
    const teacherB = await seedTeacher(pool, 'mod-b');
    const tokenA = await loginSession(app, teacherA.email, teacherA.password);
    const tokenB = await loginSession(app, teacherB.email, teacherB.password);

    const created = await app.inject({
      method: 'POST',
      url: '/classrooms',
      cookies: { asa_session: tokenA },
      payload: { title: 'Неприкосновенный' },
    });
    const classroomId = created.json().classroom.id as string;

    // The only write route is POST /classrooms; B creating a classroom must
    // never attach anything to tenant A.
    const createdB = await app.inject({
      method: 'POST',
      url: '/classrooms',
      cookies: { asa_session: tokenB },
      payload: { title: 'Класс B' },
    });
    expect(createdB.statusCode).toBe(201);
    const rows = await pool.query(`SELECT tenant_id FROM classrooms WHERE id = $1`, [
      createdB.json().classroom.id,
    ]);
    expect(rows.rows[0].tenant_id).toBe(teacherB.tenantId);

    const untouched = await pool.query(`SELECT tenant_id, title FROM classrooms WHERE id = $1`, [
      classroomId,
    ]);
    expect(untouched.rows[0].tenant_id).toBe(teacherA.tenantId);
    expect(untouched.rows[0].title).toBe('Неприкосновенный');
  });

  it('classroom creation writes an immutable AuditEvent in the right tenant', async () => {
    const teacher = await seedTeacher(pool, 'audit');
    const token = await loginSession(app, teacher.email, teacher.password);
    const created = await app.inject({
      method: 'POST',
      url: '/classrooms',
      cookies: { asa_session: token },
      payload: { title: 'Класс с аудитом' },
    });
    const classroomId = created.json().classroom.id as string;

    const audit = await pool.query(
      `SELECT id, tenant_id, actor_user_id, action FROM audit_events
        WHERE entity_type = 'classroom' AND entity_id = $1`,
      [classroomId],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].tenant_id).toBe(teacher.tenantId);
    expect(audit.rows[0].actor_user_id).toBe(teacher.teacherId);
    expect(audit.rows[0].action).toBe('classroom.created');

    await expect(
      pool.query(`UPDATE audit_events SET action = 'tampered' WHERE id = $1`, [audit.rows[0].id]),
    ).rejects.toThrow(/immutable/);
    await expect(
      pool.query(`DELETE FROM audit_events WHERE id = $1`, [audit.rows[0].id]),
    ).rejects.toThrow(/immutable/);
  });
});
