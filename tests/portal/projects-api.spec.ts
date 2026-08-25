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

async function registerPersonalAccount(label: string): Promise<string> {
  const unique = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: `${unique}@personal.test`,
      username: unique.replaceAll(/[^a-z0-9_]/g, '_').slice(0, 36),
      displayName: 'Личный автор',
      password: `Safe-${unique}-Password`,
      birthDate: '1990-01-01',
      country: 'RU',
    },
  });
  expect(response.statusCode).toBe(201);
  const cookie = response.cookies.find((item) => item.name === 'asa_session');
  if (!cookie) throw new Error('personal registration did not return a session cookie');
  return cookie.value;
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

  it('keeps automatic project numbers increasing after a project enters the trash', async () => {
    const teacher = await seedTeacher(admin, 'personal-title-sequence');
    const token = await login(teacher);
    const firstSuggestion = await inject(app, {
      method: 'GET',
      url: '/api/projects/title-suggestion?scope=personal&module=electronics',
      cookies: { asa_session: token },
    });
    expect(firstSuggestion.statusCode).toBe(200);
    expect(firstSuggestion.json()).toEqual({ title: 'Электрическая цепь 1', sequence: 1 });

    const created = await createProject(token, {
      scope: 'personal',
      title: firstSuggestion.json().title as string,
    });
    expect(created.status).toBe(201);
    const trashed = await inject(app, {
      method: 'POST',
      url: `/api/projects/${created.body.project.id}/status`,
      cookies: { asa_session: token },
      payload: { status: 'trashed' },
    });
    expect(trashed.statusCode).toBe(201);

    const nextSuggestion = await inject(app, {
      method: 'GET',
      url: '/api/projects/title-suggestion?scope=personal&module=electronics',
      cookies: { asa_session: token },
    });
    expect(nextSuggestion.statusCode).toBe(200);
    expect(nextSuggestion.json()).toEqual({ title: 'Электрическая цепь 2', sequence: 2 });
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

  it('archives, trashes and restores a project without deleting its draft', async () => {
    const teacher = await seedTeacher(admin, 'personal-lifecycle');
    const token = await login(teacher);
    const created = await createProject(token, { scope: 'personal', title: 'Жизненный цикл' });
    const projectId = created.body.project.id;

    const archived = await inject(app, {
      method: 'POST',
      url: `/api/projects/${projectId}/status`,
      cookies: { asa_session: token },
      payload: { status: 'archived' },
    });
    expect(archived.statusCode).toBe(201);
    expect(archived.json().project.status).toBe('archived');

    const activeList = await inject(app, {
      method: 'GET',
      url: '/api/projects?scope=personal&status=active',
      cookies: { asa_session: token },
    });
    expect(activeList.json().items.map((item: { id: string }) => item.id)).not.toContain(projectId);

    const archivedList = await inject(app, {
      method: 'GET',
      url: '/api/projects?scope=personal&status=archived',
      cookies: { asa_session: token },
    });
    expect(archivedList.json().items.map((item: { id: string }) => item.id)).toContain(projectId);

    const trashed = await inject(app, {
      method: 'POST',
      url: `/api/projects/${projectId}/status`,
      cookies: { asa_session: token },
      payload: { status: 'trashed' },
    });
    expect(trashed.statusCode).toBe(201);

    const renameInTrash = await inject(app, {
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      cookies: { asa_session: token },
      payload: { title: 'Недопустимое изменение' },
    });
    expect(renameInTrash.statusCode).toBe(404);

    const restored = await inject(app, {
      method: 'POST',
      url: `/api/projects/${projectId}/status`,
      cookies: { asa_session: token },
      payload: { status: 'active' },
    });
    expect(restored.statusCode).toBe(201);
    expect(restored.json().project).toMatchObject({ id: projectId, status: 'active' });

    const stored = await admin.query(
      `SELECT p.status, d.project_id
         FROM projects p
         JOIN project_drafts d ON d.tenant_id = p.tenant_id AND d.project_id = p.id
        WHERE p.tenant_id = $1 AND p.id = $2`,
      [teacher.tenantId, projectId],
    );
    expect(stored.rows[0]).toMatchObject({ status: 'active', project_id: projectId });
  });

  it('restores an archived Personal Workspace project through its owner principal', async () => {
    const token = await registerPersonalAccount('principal-lifecycle');
    const created = await createProject(token, { scope: 'personal', title: 'Личный архив' });
    const projectId = created.body.project.id;

    const archived = await inject(app, {
      method: 'POST',
      url: `/api/projects/${projectId}/status`,
      cookies: { asa_session: token },
      payload: { status: 'archived' },
    });
    expect(archived.statusCode).toBe(201);

    const restored = await inject(app, {
      method: 'POST',
      url: `/api/projects/${projectId}/status`,
      cookies: { asa_session: token },
      payload: { status: 'active' },
    });
    expect(restored.statusCode).toBe(201);
    expect(restored.json().project).toMatchObject({ id: projectId, status: 'active' });
  });

  it('duplicates the current project document with an idempotent request', async () => {
    const teacher = await seedTeacher(admin, 'personal-duplicate');
    const token = await login(teacher);
    const created = await createProject(token, { scope: 'personal', title: 'Оригинал' });
    await inject(app, {
      method: 'PUT',
      url: `/api/projects/${created.body.project.id}/draft`,
      cookies: { asa_session: token },
      payload: { document: seriesDocument(), baseRevision: 1, mutationId: crypto.randomUUID() },
    });
    const key = `duplicate-${crypto.randomUUID()}`;
    const duplicate = async () =>
      inject(app, {
        method: 'POST',
        url: `/api/projects/${created.body.project.id}/duplicate`,
        cookies: { asa_session: token },
        headers: { 'idempotency-key': key },
        payload: { title: 'Оригинал — копия' },
      });
    const first = await duplicate();
    const repeat = await duplicate();
    expect(first.statusCode).toBe(201);
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().project.id).toBe(first.json().project.id);

    const opened = await inject(app, {
      method: 'GET',
      url: `/api/projects/${first.json().project.id}`,
      cookies: { asa_session: token },
    });
    expect(opened.json().draft.document).toEqual(seriesDocument());
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
      payload: { document, baseRevision: 1, mutationId: crypto.randomUUID() },
    });
    expect(saved.statusCode).toBe(200);
    // Persistence, not physics. This test asserts that what was saved comes back
    // unchanged; what the numbers ought to be belongs to
    // contexts/electronics/testing/solver.spec.ts. Asserting the LED model here
    // stopped the general gate twice in one week through a test that does not
    // exist to check the model.
    //
    // `solved` is kept because an unsupported circuit would make the round trip
    // vacuous — it is a status, not a measurement.
    expect(saved.json().result.solved).toBe(true);

    const reloaded = await inject(app, {
      method: 'GET',
      url: `/api/projects/${created.body.project.id}`,
      cookies: { asa_session: token },
    });
    expect(reloaded.statusCode).toBe(200);
    expect(reloaded.json().draft.document).toEqual(document);
    // Stronger than any single measurement, and independent of the model: every
    // voltage, current and component state has to survive the round trip exactly.
    expect(reloaded.json().result).toEqual(saved.json().result);
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

  it('keeps the first device save and rejects a stale second device', async () => {
    const teacher = await seedTeacher(admin, 'workbench-revision-conflict');
    const token = await login(teacher);
    const created = await createProject(token, { scope: 'personal', title: 'Два устройства' });
    const projectId = created.body.project.id;
    const firstDocument = seriesDocument();
    const secondDocument = {
      ...seriesDocument(),
      viewport: { x: 100, y: 50, zoom: 1.5 },
    };

    const first = await inject(app, {
      method: 'PUT',
      url: `/api/projects/${projectId}/draft`,
      cookies: { asa_session: token },
      payload: { document: firstDocument, baseRevision: 1, mutationId: crypto.randomUUID() },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().draft.revision).toBe(2);

    const stale = await inject(app, {
      method: 'PUT',
      url: `/api/projects/${projectId}/draft`,
      cookies: { asa_session: token },
      payload: { document: secondDocument, baseRevision: 1, mutationId: crypto.randomUUID() },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('project_revision_conflict');

    const reloaded = await inject(app, {
      method: 'GET',
      url: `/api/projects/${projectId}`,
      cookies: { asa_session: token },
    });
    expect(reloaded.json().draft.document).toEqual(firstDocument);
    expect(reloaded.json().draft.revision).toBe(2);
  });

  it('returns the same revision when an accepted mutation is retried', async () => {
    const teacher = await seedTeacher(admin, 'workbench-idempotent-save');
    const token = await login(teacher);
    const created = await createProject(token, { scope: 'personal', title: 'Повтор отправки' });
    const projectId = created.body.project.id;
    const mutationId = crypto.randomUUID();
    const payload = { document: seriesDocument(), baseRevision: 1, mutationId };

    const first = await inject(app, {
      method: 'PUT',
      url: `/api/projects/${projectId}/draft`,
      cookies: { asa_session: token },
      payload,
    });
    const repeated = await inject(app, {
      method: 'PUT',
      url: `/api/projects/${projectId}/draft`,
      cookies: { asa_session: token },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().draft.revision).toBe(2);
    const stored = await admin.query(
      'SELECT revision, last_mutation_id FROM project_drafts WHERE project_id=$1',
      [projectId],
    );
    expect(stored.rows[0]).toMatchObject({ revision: 2, last_mutation_id: mutationId });
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
      payload: { document: legacy, baseRevision: 1, mutationId: crypto.randomUUID() },
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
      payload: { document: seriesDocument(), baseRevision: 1, mutationId: crypto.randomUUID() },
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
      ['POST', '/api/projects/00000000-0000-0000-0000-000000000001/duplicate'],
      ['POST', '/api/projects/00000000-0000-0000-0000-000000000001/status'],
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
      ['POST', `/api/projects/${created.body.project.id}/status`, { status: 'trashed' }],
      [
        'PUT',
        `/api/projects/${created.body.project.id}/draft`,
        { document: seriesDocument(), baseRevision: 1, mutationId: crypto.randomUUID() },
      ],
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

    const duplicate = await inject(app, {
      method: 'POST',
      url: `/api/projects/${created.body.project.id}/duplicate`,
      cookies: { asa_session: tokenB },
      headers: { 'idempotency-key': `foreign-duplicate-${crypto.randomUUID()}` },
      payload: { title: 'Украденная копия' },
    });
    expect(duplicate.statusCode).toBe(404);
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
      payload: { scope: 'personal', classroomId: null, module: 'unsupported', title: 'X' },
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

  /**
   * The picture an editor takes of itself, over the real API and the
   * RLS-constrained runtime role. These bytes are uploaded by one learner and
   * delivered to their class, so what the server accepts and what it puts in
   * the response headers are both part of the contract.
   */
  describe('project snapshots', () => {
    function pngDataUrl(width = 320, height = 200): string {
      const bytes = new Uint8Array(160);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
      const view = new DataView(bytes.buffer);
      view.setUint32(16, width, false);
      view.setUint32(20, height, false);
      return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
    }

    async function saveSnapshot(
      token: string,
      projectId: string,
      imageDataUrl: string,
      sourceRevision = 1,
    ) {
      return inject(app, {
        method: 'PUT',
        url: `/api/projects/${projectId}/snapshot`,
        cookies: { asa_session: token },
        payload: { imageDataUrl, sourceRevision },
      });
    }

    it('stores a snapshot and reports the draft revision it belongs to', async () => {
      const token = await registerPersonalAccount('snapshot');
      const created = await createProject(token, { title: 'Схема со снимком', scope: 'personal' });
      const projectId = created.body.project.id;

      const saved = await saveSnapshot(token, projectId, pngDataUrl());
      expect(saved.statusCode).toBe(200);
      expect(saved.json().snapshot).toMatchObject({
        contentType: 'image/png',
        width: 320,
        height: 200,
        sourceRevision: 1,
      });
    });

    it('moves the revision forward when the work changes', async () => {
      const token = await registerPersonalAccount('snapshot-rev');
      const created = await createProject(token, { title: 'Схема', scope: 'personal' });
      const projectId = created.body.project.id;

      await inject(app, {
        method: 'PUT',
        url: `/api/projects/${projectId}/draft`,
        cookies: { asa_session: token },
        payload: { document: seriesDocument(), baseRevision: 1, mutationId: crypto.randomUUID() },
      });
      const saved = await saveSnapshot(token, projectId, pngDataUrl(), 2);
      expect(saved.json().snapshot.sourceRevision).toBe(2);
    });

    it('does not label an older canvas as the current project revision', async () => {
      const token = await registerPersonalAccount('snapshot-conflict');
      const created = await createProject(token, { title: 'Схема', scope: 'personal' });
      const projectId = created.body.project.id;
      await inject(app, {
        method: 'PUT',
        url: `/api/projects/${projectId}/draft`,
        cookies: { asa_session: token },
        payload: { document: seriesDocument(), baseRevision: 1, mutationId: crypto.randomUUID() },
      });

      const stale = await saveSnapshot(token, projectId, pngDataUrl(), 1);
      expect(stale.statusCode).toBe(409);
      const missing = await inject(app, {
        method: 'GET',
        url: `/api/projects/${projectId}/snapshot`,
        cookies: { asa_session: token },
      });
      expect(missing.statusCode).toBe(404);
    });

    it('lists the snapshot revision so a card can build a cacheable URL', async () => {
      const token = await registerPersonalAccount('snapshot-list');
      const created = await createProject(token, { title: 'Схема в списке', scope: 'personal' });
      const projectId = created.body.project.id;
      await saveSnapshot(token, projectId, pngDataUrl());

      const list = await inject(app, {
        method: 'GET',
        url: '/api/projects?scope=personal',
        cookies: { asa_session: token },
      });
      const item = list.json().items.find((entry: { id: string }) => entry.id === projectId);
      expect(item.snapshotRevision).toBe(1);
    });

    it('serves the bytes as a non-sniffable image and caches only the exact revision', async () => {
      const token = await registerPersonalAccount('snapshot-read');
      const created = await createProject(token, { title: 'Схема', scope: 'personal' });
      const projectId = created.body.project.id;
      await saveSnapshot(token, projectId, pngDataUrl());

      const current = await inject(app, {
        method: 'GET',
        url: `/api/projects/${projectId}/snapshot?rev=1`,
        cookies: { asa_session: token },
      });
      expect(current.statusCode).toBe(200);
      expect(current.headers['content-type']).toBe('image/png');
      expect(current.headers['x-content-type-options']).toBe('nosniff');
      expect(current.headers['cache-control']).toContain('immutable');
      expect(current.rawPayload.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );

      // A URL that does not name this revision may be pointing at older work,
      // so the answer is still given but must not be kept.
      const stale = await inject(app, {
        method: 'GET',
        url: `/api/projects/${projectId}/snapshot?rev=99`,
        cookies: { asa_session: token },
      });
      expect(stale.statusCode).toBe(200);
      expect(stale.headers['cache-control']).toContain('no-cache');
    });

    it('refuses an SVG and anything that is not really an image', async () => {
      const token = await registerPersonalAccount('snapshot-refuse');
      const created = await createProject(token, { title: 'Схема', scope: 'personal' });
      const projectId = created.body.project.id;

      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("//x")</script></svg>',
      ).toString('base64');
      const asSvg = await saveSnapshot(token, projectId, `data:image/svg+xml;base64,${svg}`);
      expect(asSvg.statusCode).toBe(400);

      const mislabelled = await saveSnapshot(token, projectId, `data:image/png;base64,${svg}`);
      expect(mislabelled.statusCode).toBe(400);
    });

    it('keeps a snapshot inside the project it belongs to', async () => {
      const owner = await registerPersonalAccount('snapshot-owner');
      const created = await createProject(owner, { title: 'Чужая схема', scope: 'personal' });
      const projectId = created.body.project.id;
      await saveSnapshot(owner, projectId, pngDataUrl());

      const stranger = await registerPersonalAccount('snapshot-stranger');
      const read = await inject(app, {
        method: 'GET',
        url: `/api/projects/${projectId}/snapshot?rev=1`,
        cookies: { asa_session: stranger },
      });
      expect(read.statusCode).toBe(404);

      const write = await saveSnapshot(stranger, projectId, pngDataUrl());
      expect(write.statusCode).toBe(404);
    });

    it('reports no snapshot for a project nobody has photographed', async () => {
      const token = await registerPersonalAccount('snapshot-absent');
      const created = await createProject(token, { title: 'Без снимка', scope: 'personal' });
      const read = await inject(app, {
        method: 'GET',
        url: `/api/projects/${created.body.project.id}/snapshot`,
        cookies: { asa_session: token },
      });
      expect(read.statusCode).toBe(404);
    });
  });
});
