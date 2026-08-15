import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { hashPassword, hashSessionToken } from '../../contexts/identity/dist/index.js';
import { buildTestApp, inject, type NestApp } from '../portal/app';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;
let sequence = 0;

interface RegisteredAccount {
  token: string;
  password: string;
  accountId: string;
  username: string;
  workspaceId: string;
}

function unique(label: string): string {
  sequence += 1;
  return `${label}-${Date.now()}-${sequence}-${Math.floor(Math.random() * 1e6)}`.toLowerCase();
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

async function register(label: string): Promise<RegisteredAccount> {
  const suffix = unique(label);
  const username = suffix.replaceAll('-', '_').slice(0, 36);
  const password = `Safe-${suffix}-Password`;
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: `${suffix}@account.test`,
      password,
      username,
      displayName: `Account ${label}`,
      birthDate: '1990-04-12',
      country: 'RU',
    },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json();
  return {
    token: sessionCookie(response),
    password,
    accountId: body.user.id as string,
    username,
    workspaceId: body.activeWorkspace.workspaceId as string,
  };
}

async function login(
  identifier: string,
  password: string,
  userAgent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/136.0',
): Promise<string> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'user-agent': userAgent },
    payload: { identifier, password },
  });
  expect(response.statusCode).toBe(200);
  return sessionCookie(response);
}

async function legacyLogin(teacher: SeededTeacher): Promise<string> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/login',
    payload: {
      workspace: teacher.workspace,
      email: teacher.email,
      password: teacher.password,
    },
  });
  expect(response.statusCode).toBe(200);
  return sessionCookie(response);
}

async function seedUnderageSession(): Promise<{
  accountId: string;
  token: string;
}> {
  const suffix = unique('underage');
  const passwordHash = hashPassword(`Safe-${suffix}-Password`);
  const accountResult = await admin.query(
    `INSERT INTO accounts (email, password_hash, birth_date, country)
     VALUES ($1, $2, current_date - interval '17 years', 'RU')
     RETURNING id`,
    [`${suffix}@account.test`, passwordHash],
  );
  const accountId = accountResult.rows[0].id as string;
  await admin.query(
    `INSERT INTO profiles (account_id, username, display_name)
     VALUES ($1, $2, 'Юный владелец')`,
    [accountId, suffix.replaceAll('-', '_').slice(0, 36)],
  );
  const principalResult = await admin.query(
    `INSERT INTO principals (kind, account_id) VALUES ('account', $1) RETURNING id`,
    [accountId],
  );
  const tenantResult = await admin.query(
    `INSERT INTO tenants (title, workspace_slug) VALUES ('Underage test', $1) RETURNING id`,
    [`ws-${suffix}`.slice(0, 60)],
  );
  const workspaceResult = await admin.query(
    `INSERT INTO workspaces (tenant_id, kind, title)
     VALUES ($1, 'personal', 'Личное пространство') RETURNING id`,
    [tenantResult.rows[0].id],
  );
  await admin.query(
    `INSERT INTO workspace_memberships (account_id, workspace_id, role)
     VALUES ($1, $2, 'owner')`,
    [accountId, workspaceResult.rows[0].id],
  );
  const token = `underage-token-${suffix}`;
  await admin.query(
    `INSERT INTO sessions_v2
       (principal_id, active_workspace_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '1 hour')`,
    [principalResult.rows[0].id, workspaceResult.rows[0].id, hashSessionToken(token)],
  );
  return { accountId, token };
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

describe('Account C1 educator capability', () => {
  it('accepts an adult once, stays idempotent and writes one audit event', async () => {
    const account = await register('adult-attestation');
    const forged = await inject(app, {
      method: 'POST',
      url: '/api/capabilities/educator/self-attest',
      cookies: { asa_session: account.token },
      payload: { capability: 'platform_admin', state: 'verified' },
    });
    expect(forged.statusCode).toBe(400);

    const first = await inject(app, {
      method: 'POST',
      url: '/api/capabilities/educator/self-attest',
      cookies: { asa_session: account.token },
      payload: {},
    });
    const second = await inject(app, {
      method: 'POST',
      url: '/api/capabilities/educator/self-attest',
      cookies: { asa_session: account.token },
      payload: {},
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      capability: 'educator',
      state: 'provisional',
      created: true,
    });
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ created: false });

    const grants = await admin.query(
      `SELECT capability, state, granted_by
         FROM capability_grants
        WHERE account_id = $1
        ORDER BY capability`,
      [account.accountId],
    );
    expect(grants.rows).toContainEqual({
      capability: 'educator',
      state: 'provisional',
      granted_by: 'self_attestation',
    });
    expect(grants.rows.some((row) => row.capability === 'platform_admin')).toBe(false);
    const audit = await admin.query(
      `SELECT count(*)::int AS count
         FROM audit_events
        WHERE entity_id = $1
          AND action = 'capability.educator_attested'`,
      [account.accountId],
    );
    expect(audit.rows[0].count).toBe(1);
  });

  it('rejects an underage account using the server-stored birth date', async () => {
    const account = await seedUnderageSession();
    const response = await inject(app, {
      method: 'POST',
      url: '/api/capabilities/educator/self-attest',
      cookies: { asa_session: account.token },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('underage');
    const grant = await admin.query(
      `SELECT 1 FROM capability_grants
        WHERE account_id = $1 AND capability = 'educator'`,
      [account.accountId],
    );
    expect(grant.rowCount).toBe(0);
  });

  it('supports the complete educator, school admin and classroom journey without email verification', async () => {
    const account = await register('self-service-school');

    const role = await inject(app, {
      method: 'PUT',
      url: '/api/account/role',
      cookies: { asa_session: account.token },
      payload: { role: 'educator' },
    });
    expect(role.statusCode).toBe(200);
    expect(role.json()).toMatchObject({ role: 'educator', state: 'provisional' });

    const created = await inject(app, {
      method: 'POST',
      url: '/api/schools',
      cookies: { asa_session: account.token },
      payload: { title: 'Школа самостоятельного педагога' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().school).toMatchObject({
      title: 'Школа самостоятельного педагога',
      role: 'school_admin',
    });
    const schoolWorkspaceId = created.json().school.workspaceId as string;

    const switched = await inject(app, {
      method: 'POST',
      url: '/api/session/context',
      cookies: { asa_session: account.token },
      payload: { workspaceId: schoolWorkspaceId },
    });
    expect(switched.statusCode).toBe(201);

    const context = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      cookies: { asa_session: account.token },
    });
    expect(context.statusCode).toBe(200);
    expect(context.json()).toMatchObject({
      authenticated: true,
      activeWorkspace: { workspaceId: schoolWorkspaceId, kind: 'organization' },
      navigation: { classes: true, classroomManagement: true },
    });

    const classroom = await inject(app, {
      method: 'POST',
      url: '/api/classrooms',
      headers: { 'idempotency-key': `self-service-class-${crypto.randomUUID()}` },
      cookies: { asa_session: account.token },
      payload: { title: 'Первый класс' },
    });
    expect(classroom.statusCode).toBe(201);
    expect(classroom.json()).toMatchObject({
      created: true,
      classroom: { title: 'Первый класс' },
    });

    const accountRow = await admin.query(
      `SELECT email_verification_state FROM accounts WHERE id = $1`,
      [account.accountId],
    );
    expect(accountRow.rows[0].email_verification_state).toBe('unverified');
  });
});

describe('Account C1 workspace context', () => {
  it('lists memberships and rejects foreign, suspended and forged context changes', async () => {
    const account = await register('workspace-owner');
    const other = await register('workspace-foreign');
    const tenant = await admin.query(
      `INSERT INTO tenants (title, workspace_slug)
       VALUES ('Account organization', $1) RETURNING id`,
      [`org-${unique('workspace')}`.slice(0, 60)],
    );
    const organization = await admin.query(
      `INSERT INTO workspaces (tenant_id, kind, title)
       VALUES ($1, 'organization', 'Учебная организация') RETURNING id`,
      [tenant.rows[0].id],
    );
    const organizationId = organization.rows[0].id as string;
    await admin.query(
      `INSERT INTO workspace_memberships (account_id, workspace_id, role)
       VALUES ($1, $2, 'educator')`,
      [account.accountId, organizationId],
    );

    const listed = await inject(app, {
      method: 'GET',
      url: '/api/workspaces',
      cookies: { asa_session: account.token },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.map((item: { workspaceId: string }) => item.workspaceId)).toEqual(
      expect.arrayContaining([account.workspaceId, organizationId]),
    );

    const switched = await inject(app, {
      method: 'POST',
      url: '/api/session/context',
      cookies: { asa_session: account.token },
      payload: { workspaceId: organizationId },
    });
    expect(switched.statusCode).toBe(201);
    expect(switched.json().activeWorkspace.workspaceId).toBe(organizationId);
    const switchedBack = await inject(app, {
      method: 'POST',
      url: '/api/session/context',
      cookies: { asa_session: account.token },
      payload: { workspaceId: account.workspaceId },
    });
    expect(switchedBack.statusCode).toBe(201);

    const foreign = await inject(app, {
      method: 'POST',
      url: '/api/session/context',
      cookies: { asa_session: account.token },
      payload: { workspaceId: other.workspaceId },
    });
    expect(foreign.statusCode).toBe(403);

    await admin.query(`UPDATE workspaces SET status = 'suspended' WHERE id = $1`, [organizationId]);
    const suspended = await inject(app, {
      method: 'POST',
      url: '/api/session/context',
      cookies: { asa_session: account.token },
      payload: { workspaceId: organizationId },
    });
    expect(suspended.statusCode).toBe(403);

    await admin.query(`UPDATE workspaces SET status = 'active' WHERE id = $1`, [organizationId]);
    await admin.query(
      `UPDATE workspace_memberships SET state = 'suspended'
        WHERE account_id = $1 AND workspace_id = $2`,
      [account.accountId, organizationId],
    );
    const suspendedMembership = await inject(app, {
      method: 'POST',
      url: '/api/session/context',
      cookies: { asa_session: account.token },
      payload: { workspaceId: organizationId },
    });
    expect(suspendedMembership.statusCode).toBe(403);

    const forged = await inject(app, {
      method: 'POST',
      url: '/api/session/context',
      cookies: { asa_session: account.token },
      payload: { workspaceId: account.workspaceId, tenantId: tenant.rows[0].id },
    });
    expect(forged.statusCode).toBe(400);
  });
});

describe('Account C1 profile and sessions', () => {
  it('updates profile fields, keeps email server-owned and detects conflicts', async () => {
    const account = await register('profile-owner');
    const other = await register('profile-conflict');
    const profile = await inject(app, {
      method: 'GET',
      url: '/api/account/profile',
      cookies: { asa_session: account.token },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).not.toHaveProperty('passwordHash');
    expect(profile.json()).not.toHaveProperty('tokenHash');

    const update = await inject(app, {
      method: 'PATCH',
      url: '/api/account/profile',
      cookies: { asa_session: account.token },
      payload: { username: `${account.username}_new`, displayName: 'Новое имя' },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      username: `${account.username}_new`,
      displayName: 'Новое имя',
    });

    const conflict = await inject(app, {
      method: 'PATCH',
      url: '/api/account/profile',
      cookies: { asa_session: account.token },
      payload: { username: other.username.toUpperCase(), displayName: 'Конфликт' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('username_taken');

    const forgedEmail = await inject(app, {
      method: 'PATCH',
      url: '/api/account/profile',
      cookies: { asa_session: account.token },
      payload: {
        username: `${account.username}_new`,
        displayName: 'Новое имя',
        email: 'forged@example.test',
      },
    });
    expect(forgedEmail.statusCode).toBe(400);
  });

  it('stores a safe raster avatar, returns it and supports the initials fallback', async () => {
    const account = await register('avatar-owner');
    const avatarDataUrl = 'data:image/png;base64,aGVsbG8=';
    const update = await inject(app, {
      method: 'PATCH',
      url: '/api/account/avatar',
      cookies: { asa_session: account.token },
      payload: { avatarDataUrl },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ avatarDataUrl });

    const read = await inject(app, {
      method: 'GET',
      url: '/api/account/avatar',
      cookies: { asa_session: account.token },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ avatarDataUrl });

    const unsafe = await inject(app, {
      method: 'PATCH',
      url: '/api/account/avatar',
      cookies: { asa_session: account.token },
      payload: { avatarDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
    });
    expect(unsafe.statusCode).toBe(400);

    const remove = await inject(app, {
      method: 'PATCH',
      url: '/api/account/avatar',
      cookies: { asa_session: account.token },
      payload: { avatarDataUrl: null },
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json()).toEqual({ avatarDataUrl: null });
  });

  it('lists safe metadata and revokes one, all others and no cross-account session', async () => {
    const account = await register('session-owner');
    const other = await register('session-foreign');
    const second = await login(account.username, account.password);
    const third = await login(
      account.username,
      account.password,
      'Mozilla/5.0 (X11; Linux x86_64) Firefox/138.0',
    );

    const list = await inject(app, {
      method: 'GET',
      url: '/api/account/sessions',
      cookies: { asa_session: account.token },
    });
    expect(list.statusCode).toBe(200);
    const serialized = JSON.stringify(list.json());
    expect(serialized).not.toContain('token_hash');
    expect(serialized).not.toContain('tokenHash');
    const accountSessions = list.json().items as Array<{
      id: string;
      current: boolean;
      userAgentSummary: string | null;
    }>;
    expect(accountSessions).toHaveLength(3);
    expect(accountSessions.some((entry) => entry.userAgentSummary === 'Firefox · Linux')).toBe(
      true,
    );
    await expect(runtime.query(`SELECT token_hash FROM sessions_v2`)).rejects.toThrow(
      /permission denied/,
    );

    const otherList = await inject(app, {
      method: 'GET',
      url: '/api/account/sessions',
      cookies: { asa_session: other.token },
    });
    const otherSessionId = otherList.json().items[0].id as string;
    const crossAccount = await inject(app, {
      method: 'DELETE',
      url: `/api/account/sessions/${otherSessionId}`,
      cookies: { asa_session: account.token },
    });
    expect(crossAccount.statusCode).toBe(404);

    const secondContext = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      cookies: { asa_session: second },
    });
    expect(secondContext.statusCode).toBe(200);
    const currentSession = accountSessions.find((entry) => entry.current);
    expect(currentSession).toBeDefined();
    const rejectCurrent = await inject(app, {
      method: 'DELETE',
      url: `/api/account/sessions/${currentSession?.id ?? ''}`,
      cookies: { asa_session: account.token },
    });
    expect(rejectCurrent.statusCode).toBe(409);

    const secondHash = hashSessionToken(second);
    const secondIdResult = await admin.query(`SELECT id FROM sessions_v2 WHERE token_hash = $1`, [
      secondHash,
    ]);
    const revokeSecond = await inject(app, {
      method: 'DELETE',
      url: `/api/account/sessions/${secondIdResult.rows[0].id}`,
      cookies: { asa_session: account.token },
    });
    expect(revokeSecond.statusCode).toBe(200);
    const revokedSecond = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      cookies: { asa_session: second },
    });
    expect(revokedSecond.statusCode).toBe(401);

    await admin.query(
      `UPDATE sessions_v2 SET expires_at = now() - interval '1 second'
        WHERE token_hash = $1`,
      [hashSessionToken(third)],
    );
    const expiredThird = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      cookies: { asa_session: third },
    });
    expect(expiredThird.statusCode).toBe(401);
    const fourth = await login(
      account.username,
      account.password,
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
    );

    const revokeOthers = await inject(app, {
      method: 'POST',
      url: '/api/account/sessions/revoke-all',
      cookies: { asa_session: account.token },
      payload: {},
    });
    expect(revokeOthers.statusCode).toBe(201);
    expect(revokeOthers.json().revoked).toBeGreaterThanOrEqual(1);
    const revokedFourth = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      cookies: { asa_session: fourth },
    });
    expect(revokedFourth.statusCode).toBe(401);
    const currentAlive = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      cookies: { asa_session: account.token },
    });
    expect(currentAlive.statusCode).toBe(200);
  });
});

describe('Account C1 compatibility', () => {
  it('preserves personal projects and the migrated legacy teacher bridge', async () => {
    const account = await register('project-preserved');
    const created = await inject(app, {
      method: 'POST',
      url: '/api/projects',
      cookies: { asa_session: account.token },
      headers: { 'idempotency-key': `account-project-${crypto.randomUUID()}` },
      payload: {
        scope: 'personal',
        classroomId: null,
        module: 'electronics',
        title: 'Сохранённый проект',
      },
    });
    expect(created.statusCode).toBe(201);
    const projectId = created.json().project.id as string;

    const updated = await inject(app, {
      method: 'PATCH',
      url: '/api/account/profile',
      cookies: { asa_session: account.token },
      payload: { username: account.username, displayName: 'После Account C1' },
    });
    expect(updated.statusCode).toBe(200);
    const projects = await inject(app, {
      method: 'GET',
      url: '/api/projects?scope=personal',
      cookies: { asa_session: account.token },
    });
    expect(projects.statusCode).toBe(200);
    expect(projects.json().items.map((item: { id: string }) => item.id)).toContain(projectId);

    const teacher = await seedTeacher(admin, 'account-c1-bridge');
    const teacherToken = await legacyLogin(teacher);
    const teacherProfile = await inject(app, {
      method: 'GET',
      url: '/api/account/profile',
      cookies: { asa_session: teacherToken },
    });
    const teacherProjects = await inject(app, {
      method: 'GET',
      url: '/api/projects',
      cookies: { asa_session: teacherToken },
    });
    expect(teacherProfile.statusCode).toBe(200);
    expect(teacherProjects.statusCode).toBe(200);
  });
});
