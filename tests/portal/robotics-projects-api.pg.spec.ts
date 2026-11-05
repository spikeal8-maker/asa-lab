import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createInitialRoboticsProject, type RoboticsProject } from '@asa-lab/robotics/document';
import { createRoboticsBall, createRoboticsFloorMark } from '@asa-lab/robotics/world';
import { buildTestApp, inject, type NestApp } from './app';
import { testAdminPool, testAppPool } from './helpers';

let admin: pg.Pool;
let app: NestApp;

beforeAll(async () => {
  admin = testAdminPool();
  const runtime = testAppPool();
  const role = await runtime.query(
    'SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
  );
  expect(role.rows).toEqual([{ role: 'asalab_app', rolsuper: false, rolbypassrls: false }]);
  app = await buildTestApp(runtime);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

async function registerAccount() {
  const username = `robotics_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const password = `Robo-${randomUUID()}-Password`;
  const registered = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: `${username}@robotics.test`,
      username,
      password,
      displayName: 'Автор робота',
      birthDate: '1990-01-01',
      country: 'RU',
    },
  });
  expect(registered.statusCode, registered.body).toBe(201);
  const token = registered.cookies.find(({ name }) => name === 'asa_session')?.value;
  if (!token) throw new Error('Account registration did not create a session.');
  return { token, username, password };
}

async function createProject(token: string) {
  const created = await inject(app, {
    method: 'POST',
    url: '/api/projects',
    cookies: { asa_session: token },
    headers: { 'idempotency-key': randomUUID() },
    payload: { scope: 'personal', module: 'robotics', automaticTitle: true },
  });
  expect(created.statusCode, created.body).toBe(201);
  expect(created.json().project).toMatchObject({
    moduleKey: 'robotics',
    scope: 'personal',
    title: 'Проект робототехники 1',
  });
  return created.json().project.id as string;
}

function editedProject(): RoboticsProject {
  const initial = createInitialRoboticsProject();
  return {
    ...initial,
    circuit: {
      ...initial.circuit,
      schemaVersion: 5,
      viewport: { x: 28, y: -31, zoom: 0.7 },
      annotations: [
        {
          id: 'assembly-note',
          text: 'Сохраняем конструкцию и программу вместе',
          position: { x: 40, y: 50 },
          size: { width: 220, height: 90 },
          fontSize: 16,
        },
      ],
      components: initial.circuit.components.map((component) =>
        component.id === 'uno'
          ? {
              ...component,
              stateProperties: {
                ...component.stateProperties,
                arduinoCodeMode: 'blocks-text',
                arduinoSource: `${component.stateProperties?.arduinoSource}\n// Сохранено автором\n`,
              },
            }
          : component,
      ),
      connections: initial.circuit.connections.slice(0, -1),
    },
    world: {
      ...initial.world,
      robot: { ...initial.world.robot, bodyLengthMeters: 0.22, sensorLateralMeters: 0.01 },
      field: {
        ...initial.world.field,
        gridMeters: 0.05,
        balls: [createRoboticsBall('saved-ball', { xMeters: 0.8, yMeters: 0.4 })],
        floorMarks: [createRoboticsFloorMark('area', 'saved-area', { xMeters: 0.4, yMeters: 1.3 })],
      },
    },
  };
}

describe('Robotics account projects through the real API and RLS role', () => {
  it('creates, saves, checkpoints and reopens all authored data after a new login', async () => {
    const account = await registerAccount();
    const id = await createProject(account.token);
    const opened = await inject(app, {
      method: 'GET',
      url: `/api/projects/${id}`,
      cookies: { asa_session: account.token },
    });
    expect(opened.statusCode, opened.body).toBe(200);
    expect(opened.json().draft).toMatchObject({
      revision: 1,
      document: createInitialRoboticsProject(),
    });
    expect(opened.json().project.preview.descriptor).toMatchObject({
      kind: 'scene',
      figure: { viewBox: { width: 180, height: 180 } },
    });
    const document = editedProject();
    const saved = await inject(app, {
      method: 'PUT',
      url: `/api/projects/${id}/draft`,
      cookies: { asa_session: account.token },
      payload: { document, baseRevision: 1, mutationId: randomUUID() },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().draft).toMatchObject({ revision: 2, document });

    // Metadata is the account name. Renaming never truncates or rewrites source.
    const title = 'Мой робот — ' + 'а'.repeat(180);
    const renamed = await inject(app, {
      method: 'PATCH',
      url: `/api/projects/${id}`,
      cookies: { asa_session: account.token },
      payload: { title },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json().project.title).toBe(title);
    const checkpoint = await inject(app, {
      method: 'POST',
      url: `/api/projects/${id}/checkpoints`,
      cookies: { asa_session: account.token },
      payload: { label: 'Поле и программа' },
    });
    expect(checkpoint.statusCode, checkpoint.body).toBe(201);
    expect(
      (
        await admin.query('SELECT document_json FROM project_versions WHERE id=$1', [
          checkpoint.json().version.id,
        ])
      ).rows[0]?.document_json,
    ).toEqual(document);

    const logout = await inject(app, {
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { asa_session: account.token },
    });
    expect(logout.statusCode, logout.body).toBe(200);
    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: account.username, password: account.password },
    });
    expect(login.statusCode, login.body).toBe(200);
    const nextToken = login.cookies.find(({ name }) => name === 'asa_session')?.value;
    if (!nextToken) throw new Error('New login did not create a session.');
    expect(nextToken).not.toBe(account.token);
    const reopened = await inject(app, {
      method: 'GET',
      url: `/api/projects/${id}`,
      cookies: { asa_session: nextToken },
    });
    expect(reopened.statusCode, reopened.body).toBe(200);
    expect(reopened.json().project.title).toBe(title);
    expect(reopened.json().draft).toMatchObject({ revision: 2, document });
    const listed = await inject(app, {
      method: 'GET',
      url: '/api/projects?scope=personal&module=robotics',
      cookies: { asa_session: nextToken },
    });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().items).toEqual([
      expect.objectContaining({
        id,
        title,
        moduleKey: 'robotics',
        preview: expect.objectContaining({
          descriptor: expect.objectContaining({ kind: 'scene', figure: expect.any(Object) }),
        }),
      }),
    ]);
  });

  it('preserves CAS, idempotency and annotation protection while allowing incomplete edits', async () => {
    const account = await registerAccount();
    const id = await createProject(account.token);
    const document = editedProject();
    const request = {
      method: 'PUT' as const,
      url: `/api/projects/${id}/draft`,
      cookies: { asa_session: account.token },
      payload: { document, baseRevision: 1, mutationId: randomUUID() },
    };
    const first = await inject(app, request);
    const repeated = await inject(app, request);
    expect(first.statusCode, first.body).toBe(200);
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json().draft.revision).toBe(2);
    const stale = await inject(app, {
      ...request,
      payload: { ...request.payload, mutationId: randomUUID() },
    });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error.code).toBe('project_revision_conflict');

    const invalid = await inject(app, {
      ...request,
      payload: {
        document: {
          ...document,
          world: { ...document.world, field: { ...document.world.field, widthMeters: 100 } },
        },
        baseRevision: 2,
        mutationId: randomUUID(),
      },
    });
    expect(invalid.statusCode, invalid.body).toBe(400);
    const downgrade = await inject(app, {
      ...request,
      payload: {
        document: createInitialRoboticsProject(),
        baseRevision: 2,
        mutationId: randomUUID(),
      },
    });
    expect(downgrade.statusCode, downgrade.body).toBe(400);
    expect(downgrade.json().error.reasonCode).toBe('electronics_annotation_version');
    const retained = await inject(app, {
      method: 'GET',
      url: `/api/projects/${id}`,
      cookies: { asa_session: account.token },
    });
    expect(retained.json().draft).toMatchObject({ revision: 2, document });

    const incomplete = {
      ...document,
      circuit: {
        ...document.circuit,
        components: document.circuit.components.filter(
          ({ id: componentId }) => componentId !== 'left-motor',
        ),
        connections: document.circuit.connections.filter(
          (wire) => wire.from.componentId !== 'left-motor' && wire.to.componentId !== 'left-motor',
        ),
      },
    };
    const savedIncomplete = await inject(app, {
      ...request,
      payload: {
        document: incomplete,
        baseRevision: 2,
        mutationId: randomUUID(),
      },
    });
    expect(savedIncomplete.statusCode, savedIncomplete.body).toBe(200);
    expect(savedIncomplete.json().draft).toMatchObject({ revision: 3, document: incomplete });
    expect(savedIncomplete.json().result).toBeNull();
  });

  it('keeps private project reads, writes and telemetry bound to their real account', async () => {
    const owner = await registerAccount();
    const stranger = await registerAccount();
    const id = await createProject(owner.token);
    for (const request of [
      { method: 'GET' as const, url: `/api/projects/${id}` },
      { method: 'PATCH' as const, url: `/api/projects/${id}`, payload: { title: 'Чужое имя' } },
      {
        method: 'PUT' as const,
        url: `/api/projects/${id}/draft`,
        payload: {
          document: createInitialRoboticsProject(),
          baseRevision: 1,
          mutationId: randomUUID(),
        },
      },
    ]) {
      const denied = await inject(app, { ...request, cookies: { asa_session: stranger.token } });
      expect(denied.statusCode, denied.body).toBe(404);
    }
    const anonymous = await inject(app, { method: 'GET', url: `/api/projects/${id}` });
    expect(anonymous.statusCode).toBe(401);
    const opened = await inject(app, {
      method: 'POST',
      url: '/api/analytics/v1/module-session/start',
      cookies: { asa_session: owner.token },
      payload: { sessionId: randomUUID(), projectId: id, moduleKey: 'robotics' },
    });
    expect(opened.statusCode, opened.body).toBe(202);
    expect(opened.json().accepted).toBe(true);
    const deniedSession = await inject(app, {
      method: 'POST',
      url: '/api/analytics/v1/module-session/start',
      cookies: { asa_session: stranger.token },
      payload: { sessionId: randomUUID(), projectId: id, moduleKey: 'robotics' },
    });
    expect(deniedSession.statusCode, deniedSession.body).toBe(202);
    expect(deniedSession.json().accepted).toBe(false);
    const sessions = await admin.query(
      'SELECT module_key FROM product_module_sessions WHERE project_id=$1',
      [id],
    );
    expect(sessions.rows).toEqual([{ module_key: 'robotics' }]);
  });
});
