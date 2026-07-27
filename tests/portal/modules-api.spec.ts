import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { testAdminPool, testAppPool, seedTeacher } from './helpers';
import { buildTestApp, inject, type NestApp } from './app';

/**
 * Module registry and project hub contract.
 *
 * This suite exists because a stale API process once served the portal: the
 * code registered `/api/modules`, the built dist contained it, but the running
 * binary predated it and answered 404 while every health probe stayed green.
 * Asserting the registry over the real HTTP surface makes that class of failure
 * visible instead of leaving it to a manual click.
 */

let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;

beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  app = await buildTestApp(runtime);
});

afterAll(async () => {
  await app.close();
  await admin.end();
});

describe('GET /api/modules', () => {
  it('answers 200 and is reachable without a session', async () => {
    const response = await inject(app, { method: 'GET', url: '/api/modules' });
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().items)).toBe(true);
  });

  it('offers Electronics as the only creatable environment', async () => {
    const response = await inject(app, { method: 'GET', url: '/api/modules' });
    const items = response.json().items as Array<{
      moduleKey: string;
      displayName: string;
      status?: string;
      creatable?: boolean;
    }>;
    const electronics = items.find((item) => item.moduleKey === 'electronics');
    expect(electronics, 'electronics must be present').toBeDefined();
    expect(electronics?.displayName).toBe('Электроника');
    // Whatever the flag is named in the payload, electronics must be active.
    const active = electronics?.creatable ?? electronics?.status === 'active';
    expect(active, 'electronics must be creatable/active').toBe(true);
  });

  it('lists the future environments without pretending they work', async () => {
    const response = await inject(app, { method: 'GET', url: '/api/modules' });
    const items = response.json().items as Array<{
      moduleKey: string;
      creatable?: boolean;
      status?: string;
    }>;
    const keys = items.map((item) => item.moduleKey);
    for (const expected of ['three-d', 'blocks', 'robotics', 'drawing', 'checkers']) {
      expect(keys, `future module ${expected} must stay visible`).toContain(expected);
    }
    for (const item of items.filter((entry) => entry.moduleKey !== 'electronics')) {
      const active = item.creatable ?? item.status === 'active';
      expect(active, `${item.moduleKey} must not be creatable yet`).not.toBe(true);
    }
  });
});

describe('project hub listing', () => {
  it('returns the personal scope for a signed-in teacher', async () => {
    const teacher = await seedTeacher(admin, 'modules-hub');
    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { workspace: teacher.workspace, email: teacher.email, password: teacher.password },
    });
    const cookie = login.cookies.find((entry) => entry.name === 'asa_session');
    expect(login.statusCode).toBe(200);

    for (const url of ['/api/projects?scope=personal', '/api/projects']) {
      const response = await inject(app, {
        method: 'GET',
        url,
        cookies: { asa_session: cookie?.value ?? '' },
      });
      expect(response.statusCode, url).toBe(200);
      expect(Array.isArray(response.json().items), url).toBe(true);
    }
  });

  it('still requires a session', async () => {
    const response = await inject(app, { method: 'GET', url: '/api/projects?scope=personal' });
    expect(response.statusCode).toBe(401);
  });
});
