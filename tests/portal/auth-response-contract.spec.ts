import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type pg from 'pg';
import { buildTestApp, inject, type NestApp } from './app';
import { testAdminPool, testAppPool } from './helpers';

interface OpenApiDocument {
  paths: Record<
    string,
    Record<
      string,
      {
        responses: Record<
          string,
          { content: { 'application/json': { schema: Record<string, unknown> } } }
        >;
      }
    >
  >;
}

let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;
let openApi: OpenApiDocument;
let sequence = 0;

function unique(label: string): string {
  sequence += 1;
  return `${label}-${Date.now()}-${sequence}-${Math.floor(Math.random() * 1e6)}`.toLowerCase();
}

function responseValidator(path: string, method: 'get' | 'post', status: number): ValidateFunction {
  const schema =
    openApi.paths[path]?.[method]?.responses[String(status)]?.content['application/json']?.schema;
  if (!schema) throw new Error(`OpenAPI response schema missing: ${method} ${path} ${status}`);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

function expectContract(validate: ValidateFunction, body: unknown, label: string): void {
  expect(validate(body), `${label}: ${JSON.stringify(validate.errors)}`).toBe(true);
}

function sessionCookie(response: {
  cookies: { name: string; value: string }[];
  statusCode: number;
  body: string;
}): string {
  const cookie = response.cookies.find((entry) => entry.name === 'asa_session');
  if (!cookie) throw new Error(`session cookie missing: ${response.statusCode} ${response.body}`);
  return cookie.value;
}

beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  app = await buildTestApp(runtime);
  openApi = (await SwaggerParser.dereference('schemas/openapi.yaml')) as OpenApiDocument;
});

afterAll(async () => {
  await app.close();
  await admin.end();
});

describe('OpenAPI session response contract', () => {
  it('matches register, me, context switch and login runtime responses', async () => {
    const suffix = unique('session-contract');
    const username = suffix.replaceAll('-', '_').slice(0, 36);
    const password = `Safe-${suffix}-Password`;
    const registered = await inject(app, {
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `${suffix}@contract.test`,
        password,
        username,
        displayName: 'Contract Owner',
        birthDate: '1990-04-12',
        country: 'RU',
      },
    });
    expect(registered.statusCode).toBe(201);
    const registeredBody = registered.json();
    expectContract(
      responseValidator('/api/auth/register', 'post', 201),
      registeredBody,
      'register',
    );
    expect(registeredBody.account).toEqual(registeredBody.user);
    const token = sessionCookie(registered);

    const me = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      cookies: { asa_session: token },
    });
    expect(me.statusCode).toBe(200);
    expectContract(responseValidator('/api/auth/me', 'get', 200), me.json(), 'me');

    const tenant = await admin.query(
      `INSERT INTO tenants (title, workspace_slug)
       VALUES ('Contract organization', $1)
       RETURNING id`,
      [`contract-${suffix}`.slice(0, 60)],
    );
    const workspace = await admin.query(
      `INSERT INTO workspaces (tenant_id, kind, title)
       VALUES ($1, 'organization', 'Contract Workspace')
       RETURNING id`,
      [tenant.rows[0].id],
    );
    await admin.query(
      `INSERT INTO workspace_memberships (account_id, workspace_id, role)
       VALUES ($1, $2, 'owner')`,
      [registeredBody.account.id, workspace.rows[0].id],
    );

    const switched = await inject(app, {
      method: 'POST',
      url: '/api/session/context',
      cookies: { asa_session: token },
      payload: { workspaceId: workspace.rows[0].id },
    });
    expect(switched.statusCode).toBe(201);
    expectContract(
      responseValidator('/api/session/context', 'post', 201),
      switched.json(),
      'context switch',
    );

    const logout = await inject(app, {
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { asa_session: token },
    });
    expect(logout.statusCode).toBe(200);

    const loggedIn = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: username, password },
    });
    expect(loggedIn.statusCode).toBe(200);
    expectContract(responseValidator('/api/auth/login', 'post', 200), loggedIn.json(), 'login');

    const anonymous = await inject(app, { method: 'GET', url: '/api/auth/me' });
    expect(anonymous.statusCode).toBe(200);
    expectContract(responseValidator('/api/auth/me', 'get', 200), anonymous.json(), 'anonymous me');
  });
});
