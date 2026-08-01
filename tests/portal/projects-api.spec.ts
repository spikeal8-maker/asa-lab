import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildTestApp, inject, type NestApp } from './app';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from './helpers';

/** TST-PROJECT-SLICE-001: personal and classroom project lifecycle over the
 * real API and the RLS-constrained application role. */

let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;

async function login(teacher: SeededTeacher): Promise<string> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/login',
    payload: { workspace: teacher.workspace, email: teacher.email, password: teacher.password },
  });
  const cookie = response.cookies.find((item) => item.name === 'asa_session');
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
    headers: { 'idempotency-key': `cls-${crypto.randomUUID()}` },
    payload: { title },
  });
  expect(response.statusCode).toBe(201);
  return response.json().classroom.id as string;
}

async function createProject(
  token: string,
  options: { title: string; scope: 'personal' | 'classroom'; classroomId?: string; key?: string },
): Promise<{
  status: number;
  body: { project: { id: string; scope: string; classroomId: string | null } };
}> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/projects',
    cookies: { asa_session: token },
    headers: { 'idempotency-key': options.key ?? `prj-${crypto.randomUUID()}` },
    payload: {
      scope: options.scope,
      classroomId: options.scope === 'classroom' ? options.classroomId : null,
      module: 'electronics',
      title: options.title,
    },
  });
  return { status: response.statusCode, body: response.json() };
}

function seriesDocument() {
  return {
    schemaVersion: 3,
    components: [
      {
        id: 'src',
        kind: 'source',
        name: 'V1',
        position: { x: 120, y: 160 },
        value: 5,
        rotation: 0,
      },
      {
        id: 'sw1',
        kind: 'switch',
        name: 'SW1',
        position: { x: 280, y: 170 },
        value: 0,
        state: true,
        rotation: 0,
      },
      {
        id: 'r1',
        kind: 'resistor',
        name: 'R1',
        position: { x: 440, y: 180 },
        value: 300,
        rotation: 90,
      },
      {
        id: 'led1',
        kind: 'led',
        name: 'LED1',
        position: { x: 680, y: 160 },
        value: 2,
        rotation: 0,
      },
      {
        id: 'pot1',
        kind: 'potentiometer',
        name: 'RV1',
        position: { x: 840, y: 180 },
        value: 1000,
        wiperPosition: 0.4,
        rotation: 0,
      },
    ],
    connections: [
      {
        id: 'c1',
        from: { componentId: 'src', terminal: 'a' },
        to: { componentId: 'sw1', terminal: 'a' },
        color: '#e3212b',
        vertices: [{ x: 310, y: 205 }],
      },
      {
        id: 'c2',
        from: { componentId: 'sw1', terminal: 'b' },
        to: { componentId: 'r1', terminal: 'a' },
        color: '#149447',
      },
      {
        id: 'c3',
        from: { componentId: 'r1', terminal: 'b' },
        to: { componentId: 'led1', terminal: 'a' },
        color: '#149447',
      },
      {
        id: 'c4',
        from: { componentId: 'led1', terminal: 'b' },
        to: { componentId: 'src', terminal: 'b' },
        color: '#2a3035',
      },
    ],
    viewport: { x: 42, y: -18, zoom: 1.25 },
    simulation: { running: true, maxIterations: 24 },
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

describe('personal teacher projects', () => {
  it('creates and lists a project without a classroom', async () => {
    const teacher = await seedTeacher(admin, 'personal-create');
    const token = await login(teacher);
    const created = await createProject(token, {
      scope: 'personal',
      title: 'Личная демонстрация',
    });
    expect(created.status).toBe(201);
    expect(created.body.project).toMatchObject({ scope: 'personal', classroomId: null });

    const list = await inject(app, {
      method: 'GET',
      url: '/api/projects?scope=personal',
      cookies: { asa_session: token },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((item: { id: string }) => item.id)).toContain(
      created.body.project.id,
    );

    const stored = await admin.query(
      `SELECT project_scope, classroom_id FROM projects WHERE tenant_id = $1 AND id = $2`,
      [teacher.tenantId, created.body.project.id],
    );
    expect(stored.rows[0]).toMatchObject({ project_scope: 'personal', classroom_id: null });
  });

  it('renames only the owning teacher project', async () => {
    const teacher = await seedTeacher(admin, 'personal-rename');
    const token = await login(teacher);
    const created = await createProject(token, { scope: 'personal', title: 'Черновик' });
    const response = await inject(app, {
      method: 'PATCH',
      url: `/api/projects/${created.body.project.id}`,
      cookies: { asa_session: token },
      payload: { title: 'Демонстрация закона Ома' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().project.title).toBe('Демонстрация закона Ома');
  });

  it('is idempotent across scope and rejects a different payload', async () => {
    const teacher = await seedTeacher(admin, 'personal-idempotency');
    const token = await login(teacher);
    const key = `personal-${crypto.randomUUID()}`;
    const first = await createProject(token, { scope: 'personal', title: 'Повтор', key });
    const repeat = await createProject(token, { scope: 'personal', title: 'Повтор', key });
    const conflict = await createProject(token, { scope: 'personal', title: 'Другое', key });
    expect(first.status).toBe(201);
    expect(repeat.status).toBe(200);
    expect(repeat.body.project.id).toBe(first.body.project.id);
    expect(conflict.status).toBe(409);
  });
});

describe('classroom projects', () => {
  it('keeps classroom projects in the classroom collection', async () => {
    const teacher = await seedTeacher(admin, 'classroom-project');
    const token = await login(teacher);
    const classroomId = await createClassroom(token, '8А Электроника');
    const created = await createProject(token, {
      scope: 'classroom',
      classroomId,
      title: 'Схема класса',
    });
    expect(created.status).toBe(201);
    expect(created.body.project).toMatchObject({ scope: 'classroom', classroomId });

    const classroomList = await inject(app, {
      method: 'GET',
      url: `/api/projects?scope=classroom&classroomId=${classroomId}`,
      cookies: { asa_session: token },
    });
    expect(classroomList.json().items.map((item: { id: string }) => item.id)).toContain(
      created.body.project.id,
    );

    const personalList = await inject(app, {
      method: 'GET',
      url: '/api/projects?scope=personal',
      cookies: { asa_session: token },
    });
    expect(personalList.json().items.map((item: { id: string }) => item.id)).not.toContain(
      created.body.project.id,
    );
  });

  it('refuses a classroom project in a foreign classroom', async () => {
    const teacherA = await seedTeacher(admin, 'foreign-a');
    const teacherB = await seedTeacher(admin, 'foreign-b');
    const tokenA = await login(teacherA);
    const tokenB = await login(teacherB);
    const classroomA = await createClassroom(tokenA, 'Чужой класс');
    const response = await createProject(tokenB, {
      scope: 'classroom',
      classroomId: classroomA,
      title: 'Чужая схема',
    });
    expect(response.status).toBe(404);
  });
});

describe('workbench draft and immutable versions', () => {
  it('persists coordinates, rotation, wire color and vertices across reload', async () => {
    const teacher = await seedTeacher(admin, 'workbench-persist');
    const token = await login(teacher);
    const created = await createProject(token, { scope: 'personal', title: 'Рабочее поле' });
    const document = seriesDocument();
    const saved = await inject(app, {
      method: 'PUT',
      url: `/api/projects/${created.body.project.id}/draft`,
      cookies: { asa_session: token },
      payload: { document },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().result.current).toBeCloseTo((5 - 2) / (300 + 8.0001), 6);

    const reloaded = await inject(app, {
      method: 'GET',
      url: `/api/projects/${created.body.project.id}`,
      cookies: { asa_session: token },
    });
    expect(reloaded.statusCode).toBe(200);
    expect(reloaded.json().draft.document).toEqual(document);
    expect(
      reloaded
        .json()
        .result.components.find((item: { componentId: string }) => item.componentId === 'led1').lit,
    ).toBe(true);
    expect(reloaded.json().draft.document).toMatchObject({
      schemaVersion: 3,
      viewport: { x: 42, y: -18, zoom: 1.25 },
      simulation: { running: true, maxIterations: 24 },
      components: expect.arrayContaining([
        expect.objectContaining({ id: 'sw1', state: true }),
        expect.objectContaining({ id: 'pot1', wiperPosition: 0.4 }),
      ]),
    });
  });

  it('normalises a historical schema v1 draft additively when it is next saved', async () => {
    const teacher = await seedTeacher(admin, 'workbench-v1-normalize');
    const token = await login(teacher);
    const created = await createProject(token, { scope: 'personal', title: 'Старая схема' });
    const legacy = {
      schemaVersion: 1,
      components: [{ id: 'r1', kind: 'resistor', position: { x: 10, y: 20 }, value: 470 }],
      connections: [],
    };
    const saved = await inject(app, {
      method: 'PUT',
      url: `/api/projects/${created.body.project.id}/draft`,
      cookies: { asa_session: token },
      payload: { document: legacy },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().draft.document).toMatchObject({
      schemaVersion: 3,
      components: legacy.components,
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: false, maxIterations: 24 },
    });
  });

  it('creates immutable numbered checkpoints', async () => {
    const teacher = await seedTeacher(admin, 'workbench-checkpoint');
    const token = await login(teacher);
    const created = await createProject(token, { scope: 'personal', title: 'Версии' });
    await inject(app, {
      method: 'PUT',
      url: `/api/projects/${created.body.project.id}/draft`,
      cookies: { asa_session: token },
      payload: { document: seriesDocument() },
    });
    const first = await inject(app, {
      method: 'POST',
      url: `/api/projects/${created.body.project.id}/checkpoints`,
      cookies: { asa_session: token },
      payload: {},
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().version.versionNo).toBe(1);

    const stored = await admin.query(
      `SELECT id FROM project_versions WHERE tenant_id = $1 AND project_id = $2`,
      [teacher.tenantId, created.body.project.id],
    );
    await expect(
      admin.query(`UPDATE project_versions SET label = 'x' WHERE id = $1`, [stored.rows[0].id]),
    ).rejects.toThrow(/immutable/);
  });
});

describe('authorization and validation', () => {
  it('requires a session for all project routes', async () => {
    for (const [method, url] of [
      ['GET', '/api/projects?scope=personal'],
      ['POST', '/api/projects'],
      ['GET', '/api/projects/00000000-0000-0000-0000-000000000001'],
      ['PATCH', '/api/projects/00000000-0000-0000-0000-000000000001'],
      ['PUT', '/api/projects/00000000-0000-0000-0000-000000000001/draft'],
      ['POST', '/api/projects/00000000-0000-0000-0000-000000000001/checkpoints'],
    ] as const) {
      const response = await inject(app, { method, url, payload: {} });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('never exposes another tenant personal project', async () => {
    const teacherA = await seedTeacher(admin, 'personal-iso-a');
    const teacherB = await seedTeacher(admin, 'personal-iso-b');
    const tokenA = await login(teacherA);
    const tokenB = await login(teacherB);
    const created = await createProject(tokenA, { scope: 'personal', title: 'Секретная схема' });
    for (const [method, url, payload] of [
      ['GET', `/api/projects/${created.body.project.id}`, undefined],
      ['PATCH', `/api/projects/${created.body.project.id}`, { title: 'Украдено' }],
      ['PUT', `/api/projects/${created.body.project.id}/draft`, { document: seriesDocument() }],
      ['POST', `/api/projects/${created.body.project.id}/checkpoints`, {}],
    ] as const) {
      const response = await inject(app, {
        method,
        url,
        cookies: { asa_session: tokenB },
        ...(payload === undefined ? {} : { payload }),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('rejects inconsistent scope, unsupported modules and missing keys', async () => {
    const teacher = await seedTeacher(admin, 'project-guards');
    const token = await login(teacher);
    const invalid = await inject(app, {
      method: 'POST',
      url: '/api/projects',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': 'invalid-scope' },
      payload: { scope: 'personal', classroomId: 'x', module: 'electronics', title: 'X' },
    });
    expect(invalid.statusCode).toBe(400);

    const unsupported = await inject(app, {
      method: 'POST',
      url: '/api/projects',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': 'invalid-module' },
      payload: { scope: 'personal', classroomId: null, module: 'checkers', title: 'X' },
    });
    expect(unsupported.statusCode).toBe(400);

    const noKey = await inject(app, {
      method: 'POST',
      url: '/api/projects',
      cookies: { asa_session: token },
      payload: { scope: 'personal', classroomId: null, module: 'electronics', title: 'X' },
    });
    expect(noKey.statusCode).toBe(400);
  });
});
