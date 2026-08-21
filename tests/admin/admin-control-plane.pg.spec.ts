import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { buildTestApp, inject, type NestApp } from '../portal/app';
import { testAdminPool, testAppPool } from '../portal/helpers';

interface SeededPrincipal {
  readonly accountId: string;
  readonly principalId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly token: string;
}

let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;
let schoolAdmin: SeededPrincipal;
let otherSchoolAdmin: SeededPrincipal;
let ordinaryAccount: SeededPrincipal;
let platformAdmin: SeededPrincipal;

async function seedPrincipal(input: {
  readonly label: string;
  readonly workspaceKind: 'personal' | 'organization';
  readonly role: 'owner' | 'educator' | 'school_admin';
  readonly platformAdmin?: boolean;
}): Promise<SeededPrincipal> {
  const unique = `${input.label}-${randomUUID()}`;
  const tenant = await admin.query<{ id: string }>(
    `INSERT INTO tenants (title, workspace_slug)
     VALUES ($1, $2) RETURNING id`,
    [`Admin test ${input.label}`, unique.slice(0, 60)],
  );
  const tenantId = tenant.rows[0]!.id;
  const workspace = await admin.query<{ id: string }>(
    `INSERT INTO workspaces (tenant_id, kind, title)
     VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, input.workspaceKind, `Пространство ${input.label}`],
  );
  const workspaceId = workspace.rows[0]!.id;
  const account = await admin.query<{ id: string }>(
    `INSERT INTO accounts (email, password_hash, birth_date, country)
     VALUES ($1, 'integration-test-only', DATE '1990-01-01', 'RU') RETURNING id`,
    [`${unique}@admin.test`],
  );
  const accountId = account.rows[0]!.id;
  await admin.query(
    `INSERT INTO profiles (account_id, username, display_name)
     VALUES ($1, $2, $3)`,
    [accountId, `adm_${randomUUID().replaceAll('-', '')}`.slice(0, 40), input.label],
  );
  const principal = await admin.query<{ id: string }>(
    `INSERT INTO principals (kind, account_id) VALUES ('account', $1) RETURNING id`,
    [accountId],
  );
  const principalId = principal.rows[0]!.id;
  await admin.query(
    `INSERT INTO workspace_memberships (account_id, workspace_id, role)
     VALUES ($1, $2, $3)`,
    [accountId, workspaceId, input.role],
  );
  if (input.platformAdmin) {
    await admin.query(
      `INSERT INTO capability_grants
         (account_id, capability, state, policy_version, granted_by)
       VALUES ($1, 'platform_admin', 'verified', 'admin-stage-a-2026-08', 'admin')`,
      [accountId],
    );
  }
  const token = `admin-stage-a-${randomUUID()}`;
  const session = await admin.query<{ id: string }>(
    `INSERT INTO sessions_v2
       (principal_id, active_workspace_id, token_hash, expires_at, client_metadata)
     VALUES ($1, $2, $3, now() + interval '1 hour', $4::jsonb)
     RETURNING id`,
    [
      principalId,
      workspaceId,
      hashSessionToken(token),
      JSON.stringify({ userAgentSummary: `Test browser ${input.label}` }),
    ],
  );
  return { accountId, principalId, tenantId, workspaceId, sessionId: session.rows[0]!.id, token };
}

async function appendAudit(
  actor: SeededPrincipal,
  scopeKind: 'platform' | 'organization',
  scopeId: string | null,
  requestId: string,
  idempotencyKey: string | null = null,
): Promise<string> {
  const result = await runtime.query<{ id: string }>(
    `SELECT admin_append_audit_event(
       $1, $2, $3, 'administration.test', 'workspace', NULL,
       'integration_test', NULL, NULL, $4, $5, 'succeeded', NULL, NULL
     ) AS id`,
    [actor.principalId, scopeKind, scopeId, requestId, idempotencyKey],
  );
  return result.rows[0]!.id;
}

beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  app = await buildTestApp(runtime);
  schoolAdmin = await seedPrincipal({
    label: 'school-admin-a',
    workspaceKind: 'organization',
    role: 'school_admin',
  });
  otherSchoolAdmin = await seedPrincipal({
    label: 'school-admin-b',
    workspaceKind: 'organization',
    role: 'school_admin',
  });
  ordinaryAccount = await seedPrincipal({
    label: 'ordinary-owner',
    workspaceKind: 'personal',
    role: 'owner',
  });
  platformAdmin = await seedPrincipal({
    label: 'platform-admin',
    workspaceKind: 'personal',
    role: 'owner',
    platformAdmin: true,
  });
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('Administrative Control Plane PostgreSQL isolation', () => {
  it('exposes only server-owned administrator scopes through the API', async () => {
    const granted = await inject(app, {
      method: 'GET',
      url: '/api/admin/v1/me',
      cookies: { asa_session: schoolAdmin.token },
    });
    expect(granted.statusCode).toBe(200);
    expect(granted.json()).toMatchObject({
      administrator: true,
      scopes: [
        {
          kind: 'organization',
          id: schoolAdmin.workspaceId,
          role: 'school_admin',
        },
      ],
    });

    const denied = await inject(app, {
      method: 'GET',
      url: '/api/admin/v1/me',
      cookies: { asa_session: ordinaryAccount.token },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'admin_forbidden' } });
  });

  it('confines an organization administrator to their exact workspace in both layers', async () => {
    await expect(
      appendAudit(
        schoolAdmin,
        'organization',
        otherSchoolAdmin.workspaceId,
        `foreign-${randomUUID()}`,
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      runtime.query(
        `SELECT * FROM admin_list_audit_events($1, 'organization', $2, 50, NULL, NULL)`,
        [schoolAdmin.principalId, otherSchoolAdmin.workspaceId],
      ),
    ).rejects.toMatchObject({ code: '42501' });

    const response = await inject(app, {
      method: 'GET',
      url: `/api/admin/v1/audit-events?scopeKind=organization&scopeId=${otherSchoolAdmin.workspaceId}`,
      cookies: { asa_session: schoolAdmin.token },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'admin_scope_forbidden' } });
  });

  it('writes and reads an append-only organization audit trail with idempotency', async () => {
    const idempotencyKey = `same-${randomUUID()}`;
    const first = await appendAudit(
      schoolAdmin,
      'organization',
      schoolAdmin.workspaceId,
      `write-${randomUUID()}`,
      idempotencyKey,
    );
    const second = await appendAudit(
      schoolAdmin,
      'organization',
      schoolAdmin.workspaceId,
      `retry-${randomUUID()}`,
      idempotencyKey,
    );
    expect(second).toBe(first);

    const count = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM administrative_audit_events
        WHERE actor_principal_id = $1 AND idempotency_key = $2`,
      [schoolAdmin.principalId, idempotencyKey],
    );
    expect(count.rows[0]!.count).toBe('1');

    const response = await inject(app, {
      method: 'GET',
      url: `/api/admin/v1/audit-events?scopeKind=organization&scopeId=${schoolAdmin.workspaceId}&limit=50`,
      cookies: { asa_session: schoolAdmin.token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: first,
          scopeKind: 'organization',
          scopeId: schoolAdmin.workspaceId,
        }),
        expect.objectContaining({ action: 'administration.audit.read' }),
      ]),
    });
  });

  it('allows a verified platform administrator to read across organization scopes', async () => {
    const platformEvent = await appendAudit(
      platformAdmin,
      'platform',
      null,
      `platform-${randomUUID()}`,
    );
    const result = await runtime.query<{ id: string }>(
      `SELECT id FROM admin_list_audit_events($1, 'platform', NULL, 200, NULL, NULL)`,
      [platformAdmin.principalId],
    );
    expect(result.rows.map((row) => row.id)).toContain(platformEvent);
    expect(result.rows.length).toBeGreaterThan(1);
  });

  it('returns only the selected organization account directory and no secrets', async () => {
    const own = await inject(app, {
      method: 'GET',
      url: `/api/admin/v1/accounts?scopeKind=organization&scopeId=${schoolAdmin.workspaceId}&limit=50`,
      cookies: { asa_session: schoolAdmin.token },
    });
    expect(own.statusCode).toBe(200);
    const body = own.json() as { items: Array<Record<string, unknown>> };
    expect(body.items.map((item) => item['accountId'])).toContain(schoolAdmin.accountId);
    expect(body.items.map((item) => item['accountId'])).not.toContain(otherSchoolAdmin.accountId);
    expect(body.items[0]).not.toHaveProperty('passwordHash');
    expect(body.items[0]).not.toHaveProperty('birthDate');
    expect(body.items[0]).not.toHaveProperty('tokenHash');

    const foreignSearch = await inject(app, {
      method: 'GET',
      url: `/api/admin/v1/accounts?scopeKind=organization&scopeId=${schoolAdmin.workspaceId}&search=school-admin-b`,
      cookies: { asa_session: schoolAdmin.token },
    });
    expect(foreignSearch.statusCode).toBe(200);
    expect(foreignSearch.json()).toMatchObject({ items: [] });
  });

  it('returns only the selected organization and its real aggregate counts', async () => {
    const response = await inject(app, {
      method: 'GET',
      url: `/api/admin/v1/organizations?scopeKind=organization&scopeId=${schoolAdmin.workspaceId}`,
      cookies: { asa_session: schoolAdmin.token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          workspaceId: schoolAdmin.workspaceId,
          memberCount: 1,
          administratorCount: 1,
          activeSessionCount: 1,
        },
      ],
    });
  });

  it('returns scoped session metadata without token hashes or invented IP addresses', async () => {
    const response = await inject(app, {
      method: 'GET',
      url: `/api/admin/v1/security/sessions?scopeKind=organization&scopeId=${schoolAdmin.workspaceId}`,
      cookies: { asa_session: schoolAdmin.token },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      accountId: schoolAdmin.accountId,
      workspaceId: schoolAdmin.workspaceId,
      status: 'active',
      userAgentSummary: 'Test browser school-admin-a',
    });
    expect(body.items[0]).not.toHaveProperty('tokenHash');
    expect(body.items[0]).not.toHaveProperty('ipAddress');
    expect(body.items[0]).not.toHaveProperty('clientMetadata');
  });

  it('allows platform directory reads across organizations', async () => {
    const accounts = await inject(app, {
      method: 'GET',
      url: '/api/admin/v1/accounts?scopeKind=platform&limit=200',
      cookies: { asa_session: platformAdmin.token },
    });
    expect(accounts.statusCode).toBe(200);
    const accountIds = (accounts.json() as { items: Array<{ accountId: string }> }).items.map(
      (item) => item.accountId,
    );
    expect(accountIds).toEqual(
      expect.arrayContaining([schoolAdmin.accountId, otherSchoolAdmin.accountId]),
    );

    const organizations = await inject(app, {
      method: 'GET',
      url: '/api/admin/v1/organizations?scopeKind=platform&limit=200',
      cookies: { asa_session: platformAdmin.token },
    });
    expect(organizations.statusCode).toBe(200);
    const workspaceIds = (
      organizations.json() as { items: Array<{ workspaceId: string }> }
    ).items.map((item) => item.workspaceId);
    expect(workspaceIds).toEqual(
      expect.arrayContaining([schoolAdmin.workspaceId, otherSchoolAdmin.workspaceId]),
    );

    const sessions = await inject(app, {
      method: 'GET',
      url: '/api/admin/v1/security/sessions?scopeKind=platform&limit=200',
      cookies: { asa_session: platformAdmin.token },
    });
    expect(sessions.statusCode).toBe(200);
    const sessionAccounts = (sessions.json() as { items: Array<{ accountId: string }> }).items.map(
      (item) => item.accountId,
    );
    expect(sessionAccounts).toEqual(
      expect.arrayContaining([schoolAdmin.accountId, otherSchoolAdmin.accountId]),
    );
  });

  it('returns real platform operations aggregates without infrastructure secrets', async () => {
    const response = await inject(app, {
      method: 'GET',
      url: '/api/admin/v1/operations/status',
      cookies: { asa_session: platformAdmin.token },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      services: { api: 'responding', database: 'responding' },
      migration: { version: expect.any(String), name: expect.any(String) },
      counts: {
        accounts: expect.any(Number),
        activeAccounts: expect.any(Number),
        suspendedAccounts: expect.any(Number),
        organizations: expect.any(Number),
        activeSessions: expect.any(Number),
        auditEvents24h: expect.any(Number),
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/password|token|databaseUrl|ipAddress/i);
    const audit = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM administrative_audit_events
        WHERE actor_principal_id = $1
          AND action = 'administration.operations.read'`,
      [platformAdmin.principalId],
    );
    expect(Number.parseInt(audit.rows[0]!.count, 10)).toBeGreaterThan(0);

    const schoolResponse = await inject(app, {
      method: 'GET',
      url: '/api/admin/v1/operations/status',
      cookies: { asa_session: schoolAdmin.token },
    });
    expect(schoolResponse.statusCode).toBe(403);
    await expect(
      runtime.query(`SELECT * FROM admin_get_operations_status($1)`, [schoolAdmin.principalId]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('manages access, administrator roles and sessions with audit and self-protection', async () => {
    const suspend = await inject(app, {
      method: 'POST',
      url: `/api/admin/v1/accounts/${ordinaryAccount.accountId}/status`,
      cookies: { asa_session: platformAdmin.token },
      payload: { status: 'suspended', reason: 'Проверка блокировки доступа' },
    });
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json()).toEqual({ accountId: ordinaryAccount.accountId, status: 'suspended' });
    const suspended = await admin.query<{ status: string; active_sessions: string }>(
      `SELECT a.status,
              (SELECT count(*)::text
                 FROM sessions_v2 s
                 JOIN principals p ON p.id = s.principal_id
                WHERE p.account_id = a.id AND s.revoked_at IS NULL) AS active_sessions
         FROM accounts a WHERE a.id = $1`,
      [ordinaryAccount.accountId],
    );
    expect(suspended.rows[0]).toEqual({ status: 'suspended', active_sessions: '0' });

    const restore = await inject(app, {
      method: 'POST',
      url: `/api/admin/v1/accounts/${ordinaryAccount.accountId}/status`,
      cookies: { asa_session: platformAdmin.token },
      payload: { status: 'active', reason: 'Проверка восстановления доступа' },
    });
    expect(restore.statusCode).toBe(200);

    const grant = await inject(app, {
      method: 'POST',
      url: `/api/admin/v1/accounts/${otherSchoolAdmin.accountId}/platform-admin`,
      cookies: { asa_session: platformAdmin.token },
      payload: { enabled: true, reason: 'Назначение второго администратора' },
    });
    expect(grant.statusCode).toBe(200);
    expect(grant.json()).toMatchObject({ platformAdmin: true });
    const revokeRole = await inject(app, {
      method: 'POST',
      url: `/api/admin/v1/accounts/${otherSchoolAdmin.accountId}/platform-admin`,
      cookies: { asa_session: platformAdmin.token },
      payload: { enabled: false, reason: 'Завершение проверки назначения' },
    });
    expect(revokeRole.statusCode).toBe(200);
    expect(revokeRole.json()).toMatchObject({ platformAdmin: false });

    const revokeSession = await inject(app, {
      method: 'POST',
      url: `/api/admin/v1/security/sessions/${otherSchoolAdmin.sessionId}/revoke`,
      cookies: { asa_session: platformAdmin.token },
      payload: { reason: 'Подозрительная сессия в проверке' },
    });
    expect(revokeSession.statusCode).toBe(200);
    expect(revokeSession.json()).toEqual({ sessionId: otherSchoolAdmin.sessionId, revoked: true });

    const selfSuspend = await inject(app, {
      method: 'POST',
      url: `/api/admin/v1/accounts/${platformAdmin.accountId}/status`,
      cookies: { asa_session: platformAdmin.token },
      payload: { status: 'suspended', reason: 'Не должно выполниться' },
    });
    expect(selfSuspend.statusCode).toBe(409);
    const selfRevoke = await inject(app, {
      method: 'POST',
      url: `/api/admin/v1/accounts/${platformAdmin.accountId}/platform-admin`,
      cookies: { asa_session: platformAdmin.token },
      payload: { enabled: false, reason: 'Не должно выполниться' },
    });
    expect(selfRevoke.statusCode).toBe(409);

    const actions = await admin.query<{ action: string }>(
      `SELECT action FROM administrative_audit_events
        WHERE actor_principal_id = $1
          AND action IN (
            'administration.account.suspend',
            'administration.account.restore',
            'administration.platform_admin.grant',
            'administration.platform_admin.revoke',
            'administration.session.revoke'
          )`,
      [platformAdmin.principalId],
    );
    expect(actions.rows.map((row) => row.action).sort()).toEqual([
      'administration.account.restore',
      'administration.account.suspend',
      'administration.platform_admin.grant',
      'administration.platform_admin.revoke',
      'administration.session.revoke',
    ]);

    await expect(
      runtime.query(`SELECT admin_set_account_status($1, $2, 'suspended', 'forged', 'forged')`, [
        schoolAdmin.principalId,
        ordinaryAccount.accountId,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('enforces directory scope again inside PostgreSQL', async () => {
    const calls = [
      `SELECT * FROM admin_list_accounts($1, 'organization', $2, NULL, 50, NULL, NULL)`,
      `SELECT * FROM admin_list_organizations($1, 'organization', $2, NULL, 50, NULL, NULL)`,
      `SELECT * FROM admin_list_security_sessions($1, 'organization', $2, NULL, 50, NULL, NULL)`,
    ];
    for (const sql of calls) {
      await expect(
        runtime.query(sql, [schoolAdmin.principalId, otherSchoolAdmin.workspaceId]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runtime.query(sql, [ordinaryAccount.principalId, schoolAdmin.workspaceId]),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('records every privileged directory read in the append-only audit trail', async () => {
    const result = await admin.query<{ action: string }>(
      `SELECT DISTINCT action
         FROM administrative_audit_events
        WHERE actor_principal_id = $1
          AND action IN (
              'administration.accounts.read',
              'administration.organizations.read',
              'administration.security.read'
          )`,
      [schoolAdmin.principalId],
    );
    expect(result.rows.map((row) => row.action).sort()).toEqual([
      'administration.accounts.read',
      'administration.organizations.read',
      'administration.security.read',
    ]);
  });

  it('denies ordinary accounts and direct runtime-table access', async () => {
    await expect(
      runtime.query(
        `SELECT * FROM admin_list_audit_events($1, 'organization', $2, 50, NULL, NULL)`,
        [ordinaryAccount.principalId, schoolAdmin.workspaceId],
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      runtime.query(`SELECT id FROM administrative_audit_events LIMIT 1`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(runtime.query(`SELECT id FROM accounts LIMIT 1`)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(runtime.query(`SELECT token_hash FROM sessions_v2 LIMIT 1`)).rejects.toMatchObject(
      {
        code: '42501',
      },
    );
    await expect(
      runtime.query(`SELECT admin_authorized_role($1, 'organization', $2)`, [
        schoolAdmin.principalId,
        schoolAdmin.workspaceId,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runtime.query(
        `INSERT INTO administrative_audit_events
           (actor_principal_id, actor_account_id, actor_role, scope_kind, scope_id,
            action, request_id, result)
         VALUES ($1, $2, 'forged', 'organization', $3, 'forged.write', $4, 'succeeded')`,
        [
          ordinaryAccount.principalId,
          ordinaryAccount.accountId,
          schoolAdmin.workspaceId,
          `forged-${randomUUID()}`,
        ],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('prevents even the migration owner from rewriting or deleting audit history', async () => {
    const eventId = await appendAudit(
      schoolAdmin,
      'organization',
      schoolAdmin.workspaceId,
      `immutable-${randomUUID()}`,
    );
    await expect(
      admin.query(`UPDATE administrative_audit_events SET action = 'tampered' WHERE id = $1`, [
        eventId,
      ]),
    ).rejects.toThrow('administrative audit events are append-only');
    await expect(
      admin.query(`DELETE FROM administrative_audit_events WHERE id = $1`, [eventId]),
    ).rejects.toThrow('administrative audit events are append-only');
  });
});
