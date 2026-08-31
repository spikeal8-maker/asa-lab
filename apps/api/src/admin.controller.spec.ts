import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import { AdminController } from './admin.controller.js';
import type {
  AdminControlPlaneService,
  ResolvedAdminAccess,
} from './admin-control-plane.service.js';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';

const CONTEXT: ActiveContext = {
  principalId: '20000000-0000-4000-8000-000000000001',
  accountId: '30000000-0000-4000-8000-000000000001',
  workspaceId: ORGANIZATION_ID,
  workspaceKind: 'organization',
  tenantId: '40000000-0000-4000-8000-000000000001',
  userId: null,
  email: 'admin@example.test',
  displayName: 'Администратор',
  schoolId: null,
};

function request(cookies: Record<string, string> = {}): FastifyRequest {
  return { cookies, id: 'admin-request-1' } as unknown as FastifyRequest;
}

function access(scopes: ResolvedAdminAccess['scopes'] = []): ResolvedAdminAccess {
  return {
    subject: {
      principalId: CONTEXT.principalId,
      accountId: CONTEXT.accountId,
      capabilities: [],
      workspaces: [],
    },
    scopes,
  };
}

function controller(options: {
  readonly context?: ActiveContext | null;
  readonly access?: ResolvedAdminAccess;
  readonly auditFailure?: Error & { code?: string };
  readonly directoryFailure?: Error & { code?: string };
}) {
  const activeContext = {
    resolve: vi.fn(async () => options.context ?? null),
  } as unknown as ActiveContextUseCase;
  const controlPlane = {
    resolveAccess: vi.fn(async () => options.access ?? access()),
    listAuditEvents: vi.fn(async () => {
      if (options.auditFailure) throw options.auditFailure;
      return { items: [], next: null };
    }),
    listAccounts: vi.fn(async () => {
      if (options.directoryFailure) throw options.directoryFailure;
      return { items: [], next: null };
    }),
    listOrganizations: vi.fn(async () => {
      if (options.directoryFailure) throw options.directoryFailure;
      return { items: [], next: null };
    }),
    listSecuritySessions: vi.fn(async () => {
      if (options.directoryFailure) throw options.directoryFailure;
      return { items: [], next: null };
    }),
    operationsStatus: vi.fn(async () => {
      if (options.directoryFailure) throw options.directoryFailure;
      return { services: { api: 'responding', database: 'responding' } };
    }),
    productDashboard: vi.fn(async (_access, input) => ({
      range: input.range,
      summary: {},
    })),
    listIpActivity: vi.fn(async () => ({ items: [] })),
    setAccountStatus: vi.fn(async (_access, input) => ({
      accountId: input.targetAccountId,
      status: input.status,
    })),
    setPlatformAdmin: vi.fn(async (_access, input) => ({
      accountId: input.targetAccountId,
      platformAdmin: input.enabled,
    })),
    revokeSession: vi.fn(async (_access, input) => ({
      sessionId: input.sessionId,
      revoked: true as const,
    })),
  } as unknown as AdminControlPlaneService;
  return {
    value: new AdminController(activeContext, controlPlane),
    activeContext,
    controlPlane,
  };
}

const SCHOOL_ADMIN_SCOPE: ResolvedAdminAccess['scopes'][number] = {
  kind: 'organization',
  id: ORGANIZATION_ID,
  title: 'Школа № 1',
  role: 'school_admin',
  permissions: [
    'administration.open',
    'administration.scopes.read',
    'administration.audit.read',
    'administration.accounts.read',
    'administration.organizations.read',
    'administration.security.read',
  ],
};

describe('administrative control-plane transport', () => {
  it('rejects an anonymous request before resolving any grants', async () => {
    const target = controller({ context: null });

    await expect(target.value.me(request())).rejects.toMatchObject({ status: 401 });
    expect(target.controlPlane.resolveAccess).not.toHaveBeenCalled();
  });

  it('does not expose the admin shell to an authenticated non-admin', async () => {
    const target = controller({ context: CONTEXT, access: access() });

    await expect(target.value.me(request({ asa_session: 'session' }))).rejects.toMatchObject({
      status: 403,
    });
  });

  it('returns only the server-resolved scopes for an administrator', async () => {
    const target = controller({
      context: CONTEXT,
      access: access([SCHOOL_ADMIN_SCOPE]),
    });

    await expect(target.value.me(request({ asa_session: 'session' }))).resolves.toMatchObject({
      administrator: true,
      principalId: CONTEXT.principalId,
      scopes: [SCHOOL_ADMIN_SCOPE],
    });
  });

  it('validates audit scope and cursor before asking the database', async () => {
    const target = controller({
      context: CONTEXT,
      access: access([SCHOOL_ADMIN_SCOPE]),
    });

    await expect(
      target.value.auditEvents(
        request({ asa_session: 'session' }),
        'organization',
        'not-a-uuid',
        '201',
        undefined,
        undefined,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(target.controlPlane.listAuditEvents).not.toHaveBeenCalled();
  });

  it('maps both policy and database scope denials to a stable 403 response', async () => {
    const denied = Object.assign(new Error('administrative scope denied'), { code: '42501' });
    const target = controller({
      context: CONTEXT,
      access: access([SCHOOL_ADMIN_SCOPE]),
      auditFailure: denied,
    });

    await expect(
      target.value.auditEvents(
        request({ asa_session: 'session' }),
        'organization',
        ORGANIZATION_ID,
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('passes only validated scope, search and cursor values to account reads', async () => {
    const target = controller({ context: CONTEXT, access: access([SCHOOL_ADMIN_SCOPE]) });

    await expect(
      target.value.accounts(
        request({ asa_session: 'session' }),
        'organization',
        ORGANIZATION_ID,
        '  ученик  ',
        '25',
        '2026-08-21T17:00:00.000Z',
        '50000000-0000-4000-8000-000000000001',
      ),
    ).resolves.toEqual({ items: [], next: null });
    expect(target.controlPlane.listAccounts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope: { kind: 'organization', id: ORGANIZATION_ID },
        search: 'ученик',
        limit: 25,
        cursor: {
          before: '2026-08-21T17:00:00.000Z',
          id: '50000000-0000-4000-8000-000000000001',
        },
      }),
    );
  });

  it('rejects oversized search before any directory query', async () => {
    const target = controller({ context: CONTEXT, access: access([SCHOOL_ADMIN_SCOPE]) });

    await expect(
      target.value.organizations(
        request({ asa_session: 'session' }),
        'organization',
        ORGANIZATION_ID,
        'x'.repeat(101),
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(target.controlPlane.listOrganizations).not.toHaveBeenCalled();
  });

  it('maps PostgreSQL security scope denial to a stable 403 response', async () => {
    const denied = Object.assign(new Error('administrative security scope denied'), {
      code: '42501',
    });
    const target = controller({
      context: CONTEXT,
      access: access([SCHOOL_ADMIN_SCOPE]),
      directoryFailure: denied,
    });

    await expect(
      target.value.securitySessions(
        request({ asa_session: 'session' }),
        'organization',
        ORGANIZATION_ID,
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('requests platform operations without accepting a client-selected scope', async () => {
    const platformScope: ResolvedAdminAccess['scopes'][number] = {
      kind: 'platform',
      id: null,
      title: 'ASA Lab',
      role: 'platform_admin',
      permissions: ['administration.open', 'administration.operations.read'],
    };
    const target = controller({ context: CONTEXT, access: access([platformScope]) });

    await expect(
      target.value.operationsStatus(request({ asa_session: 'session' })),
    ).resolves.toMatchObject({ services: { api: 'responding', database: 'responding' } });
    expect(target.controlPlane.operationsStatus).toHaveBeenCalledWith(expect.anything(), {
      requestId: 'admin-request-1',
    });
  });

  it('validates dashboard ranges and forwards the server-owned scope', async () => {
    const target = controller({ context: CONTEXT, access: access([SCHOOL_ADMIN_SCOPE]) });

    await expect(
      target.value.dashboard(
        request({ asa_session: 'session' }),
        'organization',
        ORGANIZATION_ID,
        '90d',
      ),
    ).resolves.toMatchObject({ range: '90d' });
    expect(target.controlPlane.productDashboard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope: { kind: 'organization', id: ORGANIZATION_ID },
        range: '90d',
      }),
    );

    await expect(
      target.value.dashboard(
        request({ asa_session: 'session' }),
        'organization',
        ORGANIZATION_ID,
        'forever',
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('requires a valid threshold for concrete IP activity', async () => {
    const target = controller({ context: CONTEXT, access: access([SCHOOL_ADMIN_SCOPE]) });

    await expect(
      target.value.ipActivity(
        request({ asa_session: 'session' }),
        'organization',
        ORGANIZATION_ID,
        '24h',
        '2',
        '25',
      ),
    ).resolves.toEqual({ items: [] });
    expect(target.controlPlane.listIpActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ minimumDistinct: 2, limit: 25 }),
    );

    await expect(
      target.value.ipActivity(
        request({ asa_session: 'session' }),
        'organization',
        ORGANIZATION_ID,
        '24h',
        '0',
        '25',
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('validates and forwards account management with a required audit reason', async () => {
    const platformScope: ResolvedAdminAccess['scopes'][number] = {
      kind: 'platform',
      id: null,
      title: 'ASA Lab',
      role: 'platform_admin',
      permissions: ['administration.open', 'administration.accounts.manage'],
    };
    const target = controller({ context: CONTEXT, access: access([platformScope]) });
    const accountId = '50000000-0000-4000-8000-000000000001';

    await expect(
      target.value.setAccountStatus(request({ asa_session: 'session' }), accountId, {
        status: 'suspended',
        reason: '  обращение владельца  ',
      }),
    ).resolves.toEqual({ accountId, status: 'suspended' });
    expect(target.controlPlane.setAccountStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        targetAccountId: accountId,
        status: 'suspended',
        reason: 'обращение владельца',
      }),
    );

    await expect(
      target.value.setPlatformAdmin(request({ asa_session: 'session' }), accountId, {
        enabled: true,
        reason: 'x',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(target.controlPlane.setPlatformAdmin).not.toHaveBeenCalled();
  });
});
