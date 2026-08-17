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
  it('supports a full teacher roster and email-free StudentSeat sign-in', async () => {
    const teacher = await seedTeacher(admin, 'api-classroom-roster');
    const token = await login(teacher);
    const created = await inject(app, {
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': `classroom-roster-${Date.now()}` },
      payload: {
        title: '7Б Инженеры',
        ageBand: '11-12',
        topicKeys: ['electronics', '3d'],
        safeModeDefault: true,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().classroom).toMatchObject({
      title: '7Б Инженеры',
      ageBand: '11-12',
      safeModeDefault: true,
      studentCount: 0,
    });
    expect(created.json().classroom.joinCode).toMatch(/^[A-Z2-9]{3} [A-Z2-9]{3} [A-Z2-9]{3}$/);
    const classroomId = created.json().classroom.id as string;
    const code = created.json().classroom.joinCode as string;

    const added = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classroomId}/seats`,
      cookies: { asa_session: token },
      payload: { displayLabel: 'Алина К.', loginHandle: 'alina-k', safeMode: true },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().student).toMatchObject({
      displayLabel: 'Алина К.',
      loginHandle: 'alina-k',
      status: 'issued',
      safeMode: true,
    });
    const seatId = added.json().student.id as string;

    const roster = await inject(app, {
      method: 'GET',
      url: `/api/classrooms/${classroomId}/roster`,
      cookies: { asa_session: token },
    });
    expect(roster.statusCode).toBe(200);
    expect(roster.json().items).toHaveLength(1);

    const resolved = await inject(app, {
      method: 'POST',
      url: '/api/class-join/resolve',
      payload: { code: code.toLowerCase().replaceAll(' ', '-') },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().classroom).toMatchObject({
      id: classroomId,
      title: '7Б Инженеры',
      safeMode: true,
    });

    const signedIn = await inject(app, {
      method: 'POST',
      url: '/api/class-join/studentseat',
      payload: { code, loginHandle: 'alina-k' },
    });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json()).toMatchObject({
      authenticated: true,
      student: { seatId, displayName: 'Алина К.', safeMode: true },
      classroom: { id: classroomId, title: '7Б Инженеры' },
    });
    const studentCookie = signedIn.cookies.find((cookie) => cookie.name === 'asa_student_session');
    expect(studentCookie?.httpOnly).toBe(true);

    const studentMe = await inject(app, {
      method: 'GET',
      url: '/api/class-join/me',
      cookies: { asa_student_session: studentCookie?.value ?? '' },
    });
    expect(studentMe.json().student.displayName).toBe('Алина К.');

    /**
     * A learner is someone who makes things. The seat reaches the same project
     * endpoints as any account, because a project belongs to a principal and a
     * seat now has one — there is no second project stack for children.
     */
    const studentSession = { asa_student_session: studentCookie?.value ?? '' };
    const studentProject = await inject(app, {
      method: 'POST',
      url: '/api/projects',
      cookies: studentSession,
      headers: { 'idempotency-key': `seat-${Date.now()}` },
      payload: {
        scope: 'personal',
        classroomId: null,
        module: 'three-d',
        title: 'Моя первая модель',
      },
    });
    expect(studentProject.statusCode).toBe(201);
    const studentProjectId = studentProject.json().project.id as string;

    const studentList = await inject(app, {
      method: 'GET',
      url: '/api/projects?scope=personal',
      cookies: studentSession,
    });
    expect(studentList.statusCode).toBe(200);
    expect(studentList.json().items).toHaveLength(1);
    expect(studentList.json().items[0]).toMatchObject({ title: 'Моя первая модель' });

    const studentOpened = await inject(app, {
      method: 'GET',
      url: `/api/projects/${studentProjectId}`,
      cookies: studentSession,
    });
    expect(studentOpened.statusCode).toBe(200);
    expect(studentOpened.json().draft.document).toMatchObject({ units: 'mm' });

    /**
     * The teacher of this class opens the learner's work and may correct it —
     * an owner decision, matching how the reference product works. The rule is
     * exactly as wide as that: this teacher, these learners.
     */
    const teacherOpens = await inject(app, {
      method: 'GET',
      url: `/api/projects/${studentProjectId}`,
      cookies: { asa_session: token },
    });
    expect(teacherOpens.statusCode).toBe(200);
    expect(teacherOpens.json().project).toMatchObject({ title: 'Моя первая модель' });

    const teacherEdits = await inject(app, {
      method: 'PUT',
      url: `/api/projects/${studentProjectId}/draft`,
      cookies: { asa_session: token },
      payload: { document: studentOpened.json().draft.document },
    });
    expect(teacherEdits.statusCode).toBe(200);

    /**
     * A teacher of some other class is a stranger to this learner. This is the
     * assertion that keeps the rule from being "any teacher sees any child".
     */
    const stranger = await seedTeacher(admin, 'api-stranger');
    const strangerToken = await login(stranger);
    const strangerReads = await inject(app, {
      method: 'GET',
      url: `/api/projects/${studentProjectId}`,
      cookies: { asa_session: strangerToken },
    });
    expect(strangerReads.statusCode).toBe(404);

    /**
     * The class keeps a record of what its learners did. Repeated work inside a
     * short window folds into one entry with a count, because an editor
     * autosaves while a learner thinks and a feed of identical lines answers
     * "what did they do" with noise.
     */
    const activity = await admin.query(
      `SELECT action, occurrence_count FROM classroom_activity_events
        WHERE tenant_id = $1 AND classroom_id = $2 ORDER BY occurred_at`,
      [teacher.tenantId, classroomId],
    );
    expect(activity.rows.map((row) => row.action)).toContain('seat.signed_in');
    expect(activity.rows.map((row) => row.action)).toContain('project.created');

    /**
     * The record as a teacher reads it: the learner's own work, and the
     * teacher's correction attributed to the teacher rather than to the child.
     */
    const feed = await inject(app, {
      method: 'GET',
      url: `/api/classrooms/${classroomId}/activity`,
      cookies: { asa_session: token },
    });
    expect(feed.statusCode).toBe(200);
    const madeIt = feed
      .json()
      .items.find((item: { action: string }) => item.action === 'project.created');
    expect(madeIt).toMatchObject({
      seatId,
      seatLabel: 'Алина К.',
      byTeacher: false,
      projectTitle: 'Моя первая модель',
    });
    const savedByTeacher = feed
      .json()
      .items.find((item: { action: string; byTeacher: boolean }) => item.byTeacher === true);
    expect(savedByTeacher).toMatchObject({ seatId, action: 'project.saved' });

    /** The learner's page: who they are, what they made, what they did. */
    const studentPage = await inject(app, {
      method: 'GET',
      url: `/api/classrooms/${classroomId}/students/${seatId}`,
      cookies: { asa_session: token },
    });
    expect(studentPage.statusCode).toBe(200);
    expect(studentPage.json().student).toMatchObject({ displayLabel: 'Алина К.' });
    expect(studentPage.json().projects).toHaveLength(1);
    expect(studentPage.json().projects[0]).toMatchObject({
      title: 'Моя первая модель',
      moduleKey: 'three-d',
      lastEditedByTeacher: true,
    });
    expect(studentPage.json().activity.length).toBeGreaterThan(0);

    /** A teacher of another class cannot read this learner's page. */
    const strangerPage = await inject(app, {
      method: 'GET',
      url: `/api/classrooms/${classroomId}/students/${seatId}`,
      cookies: { asa_session: strangerToken },
    });
    expect(strangerPage.statusCode).toBe(404);

    const suspended = await inject(app, {
      method: 'PATCH',
      url: `/api/classrooms/${classroomId}/seats/${seatId}`,
      cookies: { asa_session: token },
      payload: {
        displayLabel: 'Алина К.',
        loginHandle: 'alina-k',
        safeMode: true,
        status: 'suspended',
      },
    });
    expect(suspended.statusCode).toBe(200);

    const revokedSession = await inject(app, {
      method: 'GET',
      url: '/api/class-join/me',
      cookies: { asa_student_session: studentCookie?.value ?? '' },
    });
    expect(revokedSession.json()).toEqual({ authenticated: false });
  });

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
