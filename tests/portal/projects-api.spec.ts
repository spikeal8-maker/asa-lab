import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { testAdminPool, testAppPool, seedTeacher, type SeededTeacher } from './helpers';
import { buildTestApp, inject, type NestApp } from './app';

/** TST-PROJECT-SLICE-001: project shell over the real API and the runtime
 * (RLS-constrained) role — create, draft save/reload, checkpoint immutability
 * and cross-tenant isolation. */

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

async function createClassroom(token: string, title: string): Promise<string> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/classrooms',
    cookies: { asa_session: token },
    headers: { 'idempotency-key': `cls-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    payload: { title },
  });
  expect(response.statusCode).toBe(201);
  return response.json().classroom.id as string;
}

async function createProject(token: string, classroomId: string, title: string): Promise<string> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/projects',
    cookies: { asa_session: token },
    headers: { 'idempotency-key': `prj-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    payload: { classroomId, module: 'electronics', title },
  });
  expect(response.statusCode).toBe(201);
  return response.json().project.id as string;
}

/** source -> resistor -> led -> source: the teaching circuit. */
function seriesDocument(volts = 5, ohms = 300, ledDrop = 2) {
  return {
    schemaVersion: 1,
    components: [
      { id: 'src', kind: 'source', position: { x: 0, y: 0 }, value: volts },
      { id: 'r1', kind: 'resistor', position: { x: 100, y: 0 }, value: ohms },
      { id: 'led1', kind: 'led', position: { x: 200, y: 0 }, value: ledDrop },
    ],
    connections: [
      {
        id: 'c1',
        from: { componentId: 'src', terminal: 'a' },
        to: { componentId: 'r1', terminal: 'a' },
      },
      {
        id: 'c2',
        from: { componentId: 'r1', terminal: 'b' },
        to: { componentId: 'led1', terminal: 'a' },
      },
      {
        id: 'c3',
        from: { componentId: 'led1', terminal: 'b' },
        to: { componentId: 'src', terminal: 'b' },
      },
    ],
  };
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

describe('project lifecycle', () => {
  it('creates a project with an empty draft and lists it in the classroom', async () => {
    const teacher = await seedTeacher(admin, 'proj-create');
    const token = await login(teacher);
    const classroomId = await createClassroom(token, 'Класс с проектами');
    const projectId = await createProject(token, classroomId, 'Первая схема');

    const list = await inject(app, {
      method: 'GET',
      url: `/api/projects?classroomId=${classroomId}`,
      cookies: { asa_session: token },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((item: { id: string }) => item.id)).toContain(projectId);

    const opened = await inject(app, {
      method: 'GET',
      url: `/api/projects/${projectId}`,
      cookies: { asa_session: token },
    });
    expect(opened.statusCode).toBe(200);
    expect(opened.json().draft.document).toEqual({
      schemaVersion: 1,
      components: [],
      connections: [],
    });

    const audit = await admin.query(
      `SELECT action FROM audit_events WHERE tenant_id = $1 AND entity_id = $2`,
      [teacher.tenantId, projectId],
    );
    expect(audit.rows.map((row) => row.action)).toContain('project.created');
  });

  it('saves the schematic, returns the DC result and reloads it unchanged', async () => {
    const teacher = await seedTeacher(admin, 'proj-draft');
    const token = await login(teacher);
    const classroomId = await createClassroom(token, 'Класс');
    const projectId = await createProject(token, classroomId, 'Цепь');

    const saved = await inject(app, {
      method: 'PUT',
      url: `/api/projects/${projectId}/draft`,
      cookies: { asa_session: token },
      payload: { document: seriesDocument() },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().draft.revision).toBe(2);
    // (5V - 2V) / 300 ohm = 10 mA and the LED lights up.
    expect(saved.json().result.solved).toBe(true);
    expect(saved.json().result.current).toBeCloseTo(0.01, 6);
    expect(
      saved
        .json()
        .result.components.find((entry: { componentId: string }) => entry.componentId === 'led1')
        .lit,
    ).toBe(true);

    const reloaded = await inject(app, {
      method: 'GET',
      url: `/api/projects/${projectId}`,
      cookies: { asa_session: token },
    });
    expect(reloaded.json().draft.document).toEqual(seriesDocument());
    expect(reloaded.json().result.current).toBeCloseTo(0.01, 6);
  });

  it('rejects a malformed schematic document with 400', async () => {
    const teacher = await seedTeacher(admin, 'proj-bad');
    const token = await login(teacher);
    const classroomId = await createClassroom(token, 'Класс');
    const projectId = await createProject(token, classroomId, 'Цепь');
    for (const document of [
      null,
      'x',
      { schemaVersion: 2 },
      {
        schemaVersion: 1,
        components: [{ id: 'a', kind: 'capacitor', position: { x: 0, y: 0 }, value: 1 }],
        connections: [],
      },
    ]) {
      const response = await inject(app, {
        method: 'PUT',
        url: `/api/projects/${projectId}/draft`,
        cookies: { asa_session: token },
        payload: { document },
      });
      expect(response.statusCode, JSON.stringify(document)).toBe(400);
    }
  });

  it('creates immutable numbered checkpoints', async () => {
    const teacher = await seedTeacher(admin, 'proj-checkpoint');
    const token = await login(teacher);
    const classroomId = await createClassroom(token, 'Класс');
    const projectId = await createProject(token, classroomId, 'Цепь');
    await inject(app, {
      method: 'PUT',
      url: `/api/projects/${projectId}/draft`,
      cookies: { asa_session: token },
      payload: { document: seriesDocument() },
    });

    const first = await inject(app, {
      method: 'POST',
      url: `/api/projects/${projectId}/checkpoints`,
      cookies: { asa_session: token },
      payload: {},
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().version.versionNo).toBe(1);

    const second = await inject(app, {
      method: 'POST',
      url: `/api/projects/${projectId}/checkpoints`,
      cookies: { asa_session: token },
      payload: { label: 'Рабочая схема' },
    });
    expect(second.json().version.versionNo).toBe(2);

    const stored = await admin.query(
      `SELECT id, version_no FROM project_versions WHERE tenant_id = $1 AND project_id = $2 ORDER BY version_no`,
      [teacher.tenantId, projectId],
    );
    expect(stored.rows.map((row) => row.version_no)).toEqual([1, 2]);
    await expect(
      admin.query(`UPDATE project_versions SET label = 'x' WHERE id = $1`, [stored.rows[0].id]),
    ).rejects.toThrow(/immutable/);
    await expect(
      admin.query(`DELETE FROM project_versions WHERE id = $1`, [stored.rows[0].id]),
    ).rejects.toThrow(/immutable/);
  });

  it('is idempotent per key and conflicts on a different payload', async () => {
    const teacher = await seedTeacher(admin, 'proj-idem');
    const token = await login(teacher);
    const classroomId = await createClassroom(token, 'Класс');
    const key = `prj-${Date.now()}`;
    const payload = { classroomId, module: 'electronics', title: 'Повтор' };
    const first = await inject(app, {
      method: 'POST',
      url: '/api/projects',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': key },
      payload,
    });
    const repeat = await inject(app, {
      method: 'POST',
      url: '/api/projects',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': key },
      payload,
    });
    const conflict = await inject(app, {
      method: 'POST',
      url: '/api/projects',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': key },
      payload: { ...payload, title: 'Другое' },
    });
    expect(first.statusCode).toBe(201);
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().project.id).toBe(first.json().project.id);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('idempotency_conflict');
  });

  it('rejects unsupported modules and a missing Idempotency-Key', async () => {
    const teacher = await seedTeacher(admin, 'proj-guard');
    const token = await login(teacher);
    const classroomId = await createClassroom(token, 'Класс');
    const wrongModule = await inject(app, {
      method: 'POST',
      url: '/api/projects',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': 'k-module' },
      payload: { classroomId, module: 'checkers', title: 'X' },
    });
    expect(wrongModule.statusCode).toBe(400);
    const noKey = await inject(app, {
      method: 'POST',
      url: '/api/projects',
      cookies: { asa_session: token },
      payload: { classroomId, module: 'electronics', title: 'X' },
    });
    expect(noKey.statusCode).toBe(400);
  });
});

describe('project authorization', () => {
  it('requires a session for every project endpoint', async () => {
    for (const [method, url] of [
      ['GET', '/api/projects?classroomId=x'],
      ['POST', '/api/projects'],
      ['GET', '/api/projects/00000000-0000-0000-0000-000000000001'],
      ['PUT', '/api/projects/00000000-0000-0000-0000-000000000001/draft'],
      ['POST', '/api/projects/00000000-0000-0000-0000-000000000001/checkpoints'],
    ] as const) {
      const response = await inject(app, { method, url, payload: {} });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('never exposes another tenant project', async () => {
    const teacherA = await seedTeacher(admin, 'proj-iso-a');
    const teacherB = await seedTeacher(admin, 'proj-iso-b');
    const tokenA = await login(teacherA);
    const tokenB = await login(teacherB);
    const classroomA = await createClassroom(tokenA, 'Класс A');
    const projectA = await createProject(tokenA, classroomA, 'Секретная схема');

    const openedByB = await inject(app, {
      method: 'GET',
      url: `/api/projects/${projectA}`,
      cookies: { asa_session: tokenB },
    });
    expect(openedByB.statusCode).toBe(404);

    const savedByB = await inject(app, {
      method: 'PUT',
      url: `/api/projects/${projectA}/draft`,
      cookies: { asa_session: tokenB },
      payload: { document: seriesDocument() },
    });
    expect(savedByB.statusCode).toBe(404);

    const checkpointByB = await inject(app, {
      method: 'POST',
      url: `/api/projects/${projectA}/checkpoints`,
      cookies: { asa_session: tokenB },
      payload: {},
    });
    expect(checkpointByB.statusCode).toBe(404);

    const listB = await inject(app, {
      method: 'GET',
      url: `/api/projects?classroomId=${classroomA}`,
      cookies: { asa_session: tokenB },
    });
    expect(listB.json().items).toEqual([]);
  });

  it('refuses to create a project in a classroom the teacher does not own', async () => {
    const teacherA = await seedTeacher(admin, 'proj-foreign-a');
    const teacherB = await seedTeacher(admin, 'proj-foreign-b');
    const tokenA = await login(teacherA);
    const tokenB = await login(teacherB);
    const classroomA = await createClassroom(tokenA, 'Класс A');
    const response = await inject(app, {
      method: 'POST',
      url: '/api/projects',
      cookies: { asa_session: tokenB },
      headers: { 'idempotency-key': 'k-foreign' },
      payload: { classroomId: classroomA, module: 'electronics', title: 'Чужой' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('classroom_not_found');
  });
});
