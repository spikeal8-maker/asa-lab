import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApiApplication } from '../../apps/api/dist/app.factory.js';
import { seedTeacher, testAdminPool } from './helpers';

let app: Awaited<ReturnType<typeof buildApiApplication>>;
let admin: ReturnType<typeof testAdminPool>;
let cookie: string;
let projectId: string;

const origin = 'http://127.0.0.1:4610';

beforeAll(async () => {
  admin = testAdminPool();
  const teacher = await seedTeacher(admin, 'projects-malformed-body');
  app = await buildApiApplication();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const login = await app.getHttpAdapter().getInstance().inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: {
      workspace: teacher.workspace,
      email: teacher.email,
      password: teacher.password,
    },
  });
  expect(login.statusCode).toBe(200);
  cookie = login.headers['set-cookie']!.split(';', 1)[0];

  const created = await app.getHttpAdapter().getInstance().inject({
    method: 'POST',
    url: '/api/projects',
    headers: {
      cookie,
      origin,
      'idempotency-key': randomUUID(),
    },
    payload: {
      title: 'Malformed body target',
      moduleKey: 'electronics',
      scope: 'personal',
    },
  });
  expect(created.statusCode).toBe(201);
  projectId = created.json().project.id as string;
});

afterAll(async () => {
  await app.close();
  await admin.end();
});

function expectValidation(response: { statusCode: number; json(): unknown }) {
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ code: 'validation_error' });
}

async function mutate(
  method: 'POST' | 'PATCH' | 'PUT',
  url: string,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return app.getHttpAdapter().getInstance().inject({
    method,
    url,
    headers: { cookie, origin, ...headers },
    payload,
  });
}

describe('project malformed body and over-posting protection', () => {
  it.each([
    ['null', null],
    ['array', []],
    ['string', 'project'],
    ['number', 7],
    ['boolean', true],
  ])('rejects %s create body', async (_name, payload) => {
    expectValidation(
      await mutate('POST', '/api/projects', payload, {
        'idempotency-key': randomUUID(),
      }),
    );
  });

  it('rejects create-body over-posting of tenant and owner fields', async () => {
    for (const extra of [
      { tenantId: randomUUID() },
      { tenant_id: randomUUID() },
      { teacherId: randomUUID() },
      { createdBy: randomUUID() },
      { status: 'archived' },
      { id: randomUUID() },
    ]) {
      const response = await mutate(
        'POST',
        '/api/projects',
        {
          title: 'Over-post attempt',
          moduleKey: 'electronics',
          scope: 'personal',
          ...extra,
        },
        { 'idempotency-key': randomUUID() },
      );
      expectValidation(response);
    }
  });

  it.each([
    ['null', null],
    ['array', []],
    ['string', 'rename'],
    ['number', 9],
  ])('rejects %s rename body', async (_name, payload) => {
    expectValidation(await mutate('PATCH', `/api/projects/${projectId}`, payload));
  });

  it('rejects rename over-posting of identity and scope fields', async () => {
    for (const extra of [
      { tenantId: randomUUID() },
      { createdBy: randomUUID() },
      { classroomId: randomUUID() },
      { projectScope: 'classroom' },
      { moduleKey: 'electronics' },
    ]) {
      expectValidation(
        await mutate('PATCH', `/api/projects/${projectId}`, {
          title: 'Over-post rename',
          ...extra,
        }),
      );
    }
  });

  it.each([
    ['null', null],
    ['array', []],
    ['string', 'draft'],
    ['number', 11],
  ])('rejects %s draft body', async (_name, payload) => {
    expectValidation(await mutate('PUT', `/api/projects/${projectId}/draft`, payload));
  });

  it('rejects draft over-posting of revision and identity fields', async () => {
    for (const extra of [
      { revision: 99 },
      { tenantId: randomUUID() },
      { projectId: randomUUID() },
      { updatedBy: randomUUID() },
    ]) {
      expectValidation(
        await mutate('PUT', `/api/projects/${projectId}/draft`, {
          document: { schemaVersion: 1, components: [], wires: [] },
          ...extra,
        }),
      );
    }
  });

  it.each([
    ['array', []],
    ['string', 'checkpoint'],
    ['number', 12],
  ])('rejects %s checkpoint body', async (_name, payload) => {
    expectValidation(await mutate('POST', `/api/projects/${projectId}/checkpoints`, payload));
  });

  it('rejects checkpoint over-posting of version and author fields', async () => {
    for (const extra of [
      { versionNo: 100 },
      { createdBy: randomUUID() },
      { tenantId: randomUUID() },
      { document: {} },
    ]) {
      expectValidation(
        await mutate('POST', `/api/projects/${projectId}/checkpoints`, {
          label: 'Checkpoint',
          ...extra,
        }),
      );
    }
  });
});
