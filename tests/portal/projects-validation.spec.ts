import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApiApplication } from '../../apps/api/dist/app.factory.js';
import { seedTeacher, testAdminPool } from './helpers';

let app: Awaited<ReturnType<typeof buildApiApplication>>;
let admin: ReturnType<typeof testAdminPool>;
let cookie: string;

const origin = 'http://127.0.0.1:4610';

beforeAll(async () => {
  admin = testAdminPool();
  const teacher = await seedTeacher(admin, 'projects-validation');
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
});

afterAll(async () => {
  await app.close();
  await admin.end();
});

async function createProject(overrides: Record<string, unknown> = {}) {
  return app.getHttpAdapter().getInstance().inject({
    method: 'POST',
    url: '/api/projects',
    headers: {
      cookie,
      origin,
      'idempotency-key': randomUUID(),
    },
    payload: {
      title: 'Validation project',
      moduleKey: 'electronics',
      scope: 'personal',
      ...overrides,
    },
  });
}

function expectValidationError(response: { statusCode: number; json(): unknown }) {
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ code: 'validation_error' });
}

describe('project request value validation', () => {
  it.each([
    ['non-string title', { title: 123 }],
    ['blank title', { title: '   ' }],
    ['oversized title', { title: 'x'.repeat(161) }],
    ['non-string module key', { moduleKey: ['electronics'] }],
    ['unsupported module key', { moduleKey: 'unknown-module' }],
    ['missing scope', { scope: undefined }],
    ['invalid scope', { scope: 'organization' }],
    ['non-string scope', { scope: 42 }],
  ])('rejects %s before repository access', async (_name, overrides) => {
    expectValidationError(await createProject(overrides));
  });

  it('trims valid project titles before persistence', async () => {
    const created = await createProject({ title: '  Trimmed project  ' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ project: { title: 'Trimmed project' } });
  });

  it('rejects invalid list scope values', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/projects?scope=organization',
      headers: { cookie },
    });
    expectValidationError(response);
  });

  it('rejects missing draft documents before module validation', async () => {
    const created = await createProject();
    expect(created.statusCode).toBe(201);
    const projectId = created.json().project.id as string;

    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/draft`,
      headers: { cookie, origin },
      payload: {},
    });
    expectValidationError(response);
  });

  it.each([
    ['non-string rename title', { title: { value: 'name' } }],
    ['blank rename title', { title: '\t' }],
    ['oversized rename title', { title: 'x'.repeat(161) }],
  ])('rejects %s', async (_name, payload) => {
    const created = await createProject();
    expect(created.statusCode).toBe(201);
    const projectId = created.json().project.id as string;

    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      headers: { cookie, origin },
      payload,
    });
    expectValidationError(response);
  });

  it.each([
    ['blank checkpoint label', { label: '   ' }],
    ['non-string checkpoint label', { label: 1 }],
    ['oversized checkpoint label', { label: 'x'.repeat(161) }],
  ])('rejects %s', async (_name, payload) => {
    const created = await createProject();
    expect(created.statusCode).toBe(201);
    const projectId = created.json().project.id as string;

    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: `/api/projects/${projectId}/checkpoints`,
      headers: { cookie, origin },
      payload,
    });
    expectValidationError(response);
  });
});
