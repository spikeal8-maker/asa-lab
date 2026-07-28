import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';
import { buildTestApp, inject, type NestApp } from './app';

/**
 * TST-ACCOUNT-VERTICAL-001 — the whole scenario, through the real API.
 *
 * An adult creates an account and is signed in by the same call; the server
 * gives them exactly one Personal Workspace with no school and no teacher user
 * in it; they make a personal Electronics project; they sign out; they sign
 * back in with the username and then with the email, and the project is still
 * theirs both times.
 *
 * Alongside that, the teacher who was here before accounts existed keeps their
 * classes and projects, and a plain creator is refused the classroom API.
 */

let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;

function unique(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function adult(label: string) {
  const id = unique(label);
  return {
    email: `${id}@test.local`,
    password: 'sufficiently-long-password',
    username: `pseudo${id}`
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, 40),
    displayName: '',
    birthDate: '1990-05-17',
    country: 'RU',
  };
}

function cookieOf(response: { cookies: { name: string; value: string }[] }): string {
  const cookie = response.cookies.find((entry) => entry.name === 'asa_session');
  if (!cookie) throw new Error('the response carried no session cookie');
  return cookie.value;
}

async function register(payload: Record<string, unknown>) {
  return inject(app, { method: 'POST', url: '/api/auth/register', payload });
}

async function signIn(identifier: string, password: string) {
  return inject(app, {
    method: 'POST',
    url: '/api/auth/login',
    payload: { identifier, password },
  });
}

async function createProject(token: string, title: string) {
  return inject(app, {
    method: 'POST',
    url: '/api/projects',
    cookies: { asa_session: token },
    headers: { 'idempotency-key': unique('key') },
    payload: { scope: 'personal', classroomId: null, module: 'electronics', title },
  });
}

async function listPersonalProjects(token: string) {
  return inject(app, {
    method: 'GET',
    url: '/api/projects?scope=personal',
    cookies: { asa_session: token },
  });
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

describe('an adult account owns its own work', () => {
  it('registers, is signed in, creates a project, signs out and back in by username and email', async () => {
    const payload = adult('vertical');

    // 1–3. Registration creates the identity and the session together.
    const registered = await register(payload);
    expect(registered.statusCode).toBe(201);
    const firstToken = cookieOf(registered);
    expect(registered.json().activeWorkspace.kind).toBe('personal');
    expect(
      registered.json().capabilities.map((entry: { capability: string }) => entry.capability),
    ).toEqual(['creator']);

    const accountId = registered.json().user.id as string;

    // 2. Exactly one Personal Workspace, and it is not a school.
    const workspaces = await admin.query(
      `SELECT w.kind, w.tenant_id, m.role FROM workspace_memberships m
         JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.account_id = $1`,
      [accountId],
    );
    expect(workspaces.rows).toEqual([
      { kind: 'personal', tenant_id: workspaces.rows[0].tenant_id, role: 'owner' },
    ]);
    const personalTenant = workspaces.rows[0].tenant_id as string;
    const inside = await admin.query(
      `SELECT (SELECT count(*)::int FROM schools WHERE tenant_id = $1) AS schools,
              (SELECT count(*)::int FROM academic_periods WHERE tenant_id = $1) AS periods,
              (SELECT count(*)::int FROM users WHERE tenant_id = $1) AS users`,
      [personalTenant],
    );
    expect(inside.rows[0]).toEqual({ schools: 0, periods: 0, users: 0 });

    // The session is bound to the principal, not to a tenant-scoped user.
    const session = await admin.query(
      `SELECT s.principal_id, p.account_id, w.kind
         FROM sessions_v2 s
         JOIN principals p ON p.id = s.principal_id
         JOIN workspaces w ON w.id = s.active_workspace_id
        WHERE p.account_id = $1 AND s.revoked_at IS NULL`,
      [accountId],
    );
    expect(session.rows).toHaveLength(1);
    expect(session.rows[0].kind).toBe('personal');

    // 4–6. The project hub answers, and a project is created and stored.
    const empty = await listPersonalProjects(firstToken);
    expect(empty.statusCode).toBe(200);
    expect(empty.json().items).toEqual([]);

    const created = await createProject(firstToken, 'Моя схема');
    expect(created.statusCode).toBe(201);
    const projectId = created.json().project.id as string;

    const owned = await admin.query(
      `SELECT p.owner_principal_id, p.created_by, p.project_scope, p.tenant_id
         FROM projects p WHERE p.id = $1`,
      [projectId],
    );
    // Owned by the principal; there is no tenant-scoped author to fall back on.
    expect(owned.rows[0].created_by).toBeNull();
    expect(owned.rows[0].owner_principal_id).toBe(session.rows[0].principal_id);
    expect(owned.rows[0].project_scope).toBe('personal');
    expect(owned.rows[0].tenant_id).toBe(personalTenant);

    // 7. Signing out revokes the session immediately.
    const loggedOut = await inject(app, {
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { asa_session: firstToken },
    });
    expect(loggedOut.statusCode).toBe(200);
    const afterLogout = await listPersonalProjects(firstToken);
    expect(afterLogout.statusCode).toBe(401);

    // 8–9. Sign in by username, then by email: the project is there both times.
    for (const identifier of [payload.username, payload.email, payload.username.toUpperCase()]) {
      const back = await signIn(identifier, payload.password);
      expect(back.statusCode, identifier).toBe(200);
      const token = cookieOf(back);
      const projects = await listPersonalProjects(token);
      expect(projects.statusCode).toBe(200);
      expect(projects.json().items.map((item: { id: string }) => item.id)).toEqual([projectId]);

      // The project opens with its draft, which is what "saved" means here.
      const opened = await inject(app, {
        method: 'GET',
        url: `/api/projects/${projectId}`,
        cookies: { asa_session: token },
      });
      expect(opened.statusCode).toBe(200);
      expect(opened.json().draft.projectId).toBe(projectId);
    }
  });

  it('refuses a wrong password and an unknown identifier the same way', async () => {
    const payload = adult('vertical-deny');
    expect((await register(payload)).statusCode).toBe(201);

    const wrongPassword = await signIn(payload.username, 'not-the-password');
    const unknownName = await signIn('nobody-here-at-all', payload.password);
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownName.statusCode).toBe(401);
    expect(unknownName.json()).toEqual(wrongPassword.json());
  });

  it('keeps one account per email and one per username', async () => {
    const payload = adult('vertical-dup');
    expect((await register(payload)).statusCode).toBe(201);
    expect((await register({ ...payload, username: `${payload.username}x` })).statusCode).toBe(409);
    expect((await register({ ...payload, email: `x-${payload.email}` })).statusCode).toBe(409);
  });

  it('routes a minor instead of refusing into nothing, and writes no account', async () => {
    const tooYoung = new Date();
    tooYoung.setUTCFullYear(tooYoung.getUTCFullYear() - 15);
    const payload = { ...adult('vertical-minor'), birthDate: tooYoung.toISOString().slice(0, 10) };

    const response = await register(payload);
    expect(response.statusCode).toBe(422);
    expect(response.json().error.routes).toEqual(['class_code', 'student_account_next_stage']);
    expect(response.cookies).toHaveLength(0);

    const stored = await admin.query(`SELECT id FROM accounts WHERE lower(email) = $1`, [
      payload.email.toLowerCase(),
    ]);
    expect(stored.rows).toHaveLength(0);
  });

  it('rolls a failed registration back completely', async () => {
    const first = adult('vertical-rollback');
    expect((await register(first)).statusCode).toBe(201);

    const before = await admin.query(
      `SELECT count(*)::int AS personal_tenants FROM tenants WHERE workspace_slug LIKE 'personal-%'`,
    );

    // The username is taken, so this registration must leave nothing at all —
    // no account, and no personal tenant or workspace stranded behind it.
    const second = { ...adult('vertical-rollback-2'), username: first.username };
    const response = await register(second);
    expect(response.statusCode).toBe(409);
    expect(response.cookies).toHaveLength(0);

    const after = await admin.query(
      `SELECT (SELECT count(*)::int FROM accounts WHERE lower(email) = $1) AS accounts,
              (SELECT count(*)::int FROM tenants WHERE workspace_slug LIKE 'personal-%')
                AS personal_tenants,
              (SELECT count(*)::int FROM workspaces w
                WHERE w.kind = 'personal'
                  AND NOT EXISTS (SELECT 1 FROM workspace_memberships m
                                   WHERE m.workspace_id = w.id)) AS orphan_workspaces`,
      [second.email.toLowerCase()],
    );
    expect(after.rows[0]).toEqual({
      accounts: 0,
      personal_tenants: before.rows[0].personal_tenants,
      orphan_workspaces: 0,
    });
  });
});

describe('the account never sees more than it may', () => {
  it('does not reach the classroom API without the educator capability', async () => {
    const payload = adult('vertical-creator');
    const token = cookieOf(await register(payload));

    const list = await inject(app, {
      method: 'GET',
      url: '/api/classrooms',
      cookies: { asa_session: token },
    });
    expect(list.statusCode).toBe(403);
    expect(list.json().error.code).toBe('educator_required');

    const create = await inject(app, {
      method: 'POST',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      headers: { 'idempotency-key': unique('key') },
      payload: { title: 'Класс от создателя' },
    });
    expect(create.statusCode).toBe(403);

    // The session answer says the same thing, so the interface can be honest.
    const me = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      cookies: { asa_session: token },
    });
    expect(
      me.json().capabilities.map((entry: { capability: string }) => entry.capability),
    ).not.toContain('educator');
  });

  it('never lets one account see another account personal work', async () => {
    const mine = adult('vertical-mine');
    const theirs = adult('vertical-theirs');
    const myToken = cookieOf(await register(mine));
    const theirToken = cookieOf(await register(theirs));

    const created = await createProject(myToken, 'Только моё');
    const projectId = created.json().project.id as string;

    const theirList = await listPersonalProjects(theirToken);
    expect(theirList.json().items.map((item: { id: string }) => item.id)).not.toContain(projectId);

    const theirOpen = await inject(app, {
      method: 'GET',
      url: `/api/projects/${projectId}`,
      cookies: { asa_session: theirToken },
    });
    expect(theirOpen.statusCode).toBe(404);
  });
});

describe('the teacher who was here before accounts existed', () => {
  it('signs in through the organization form and still has classes and projects', async () => {
    const teacher = await seedTeacher(admin, 'vertical-legacy');
    const classroom = await admin.query(
      `INSERT INTO classrooms (tenant_id, school_id, academic_period_id, title, created_by)
       VALUES ($1, $2, $3, 'Класс до аккаунтов', $4) RETURNING id`,
      [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
    );
    await admin.query(
      `INSERT INTO classroom_memberships (tenant_id, classroom_id, user_id, member_role)
       VALUES ($1, $2, $3, 'owner')`,
      [teacher.tenantId, classroom.rows[0].id, teacher.teacherId],
    );
    const project = await admin.query(
      `INSERT INTO projects (tenant_id, project_scope, classroom_id, module_key, title, created_by)
       VALUES ($1, 'personal', NULL, 'electronics', 'Проект до аккаунтов', $2) RETURNING id`,
      [teacher.tenantId, teacher.teacherId],
    );
    await admin.query(
      `INSERT INTO project_drafts (project_id, tenant_id, document_json, updated_by)
       VALUES ($1, $2, '{"schemaVersion":1,"components":[],"connections":[]}'::jsonb, $3)`,
      [project.rows[0].id, teacher.tenantId, teacher.teacherId],
    );

    // The seeded teacher already carries the identity the migration backfill
    // gives every existing teacher: account, principal, capabilities and the
    // bridge to the tenant-scoped user.

    const signedIn = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { workspace: teacher.workspace, email: teacher.email, password: teacher.password },
    });
    expect(signedIn.statusCode).toBe(200);
    const token = cookieOf(signedIn);

    const classes = await inject(app, {
      method: 'GET',
      url: '/api/classrooms',
      cookies: { asa_session: token },
    });
    expect(classes.statusCode).toBe(200);
    expect(classes.json().items.map((item: { title: string }) => item.title)).toContain(
      'Класс до аккаунтов',
    );

    const projects = await listPersonalProjects(token);
    expect(projects.json().items.map((item: { title: string }) => item.title)).toContain(
      'Проект до аккаунтов',
    );
  });
});
