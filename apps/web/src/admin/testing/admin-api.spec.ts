import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminApi, type AdminProfile } from '../admin-api';

const PROFILE: AdminProfile = {
  administrator: true,
  principalId: '10000000-0000-4000-8000-000000000001',
  accountId: '20000000-0000-4000-8000-000000000001',
  displayName: 'Администратор',
  activeWorkspaceId: '30000000-0000-4000-8000-000000000001',
  scopes: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('administrative API client', () => {
  it('checks access without caching and keeps the HttpOnly session same-origin', async () => {
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify(PROFILE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', request);

    await expect(adminApi.me()).resolves.toMatchObject({ ok: true, data: PROFILE });
    expect(request).toHaveBeenCalledWith('/api/admin/v1/me', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
  });

  it('builds a stable scoped audit cursor without client-supplied tenant data', async () => {
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ items: [], next: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', request);

    await adminApi.auditEvents({
      scope: { kind: 'organization', id: '30000000-0000-4000-8000-000000000001' },
      limit: 25,
      cursor: {
        occurredAt: '2026-08-21T17:00:00.000Z',
        id: '40000000-0000-4000-8000-000000000001',
      },
    });

    const path = request.mock.calls[0]?.[0];
    expect(typeof path).toBe('string');
    const url = new URL(String(path), 'https://asa.test');
    expect(url.pathname).toBe('/api/admin/v1/audit-events');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      scopeKind: 'organization',
      limit: '25',
      scopeId: '30000000-0000-4000-8000-000000000001',
      before: '2026-08-21T17:00:00.000Z',
      beforeId: '40000000-0000-4000-8000-000000000001',
    });
    expect(url.searchParams.has('tenantId')).toBe(false);
  });

  it('builds scoped, encoded directory queries without accepting tenant ids', async () => {
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ items: [], next: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', request);

    await adminApi.accounts({
      scope: { kind: 'organization', id: '30000000-0000-4000-8000-000000000001' },
      search: '  Иван + школа  ',
      limit: 20,
      cursor: {
        before: '2026-08-21T17:00:00.000Z',
        id: '40000000-0000-4000-8000-000000000001',
      },
    });

    const url = new URL(String(request.mock.calls[0]?.[0]), 'https://asa.test');
    expect(url.pathname).toBe('/api/admin/v1/accounts');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      scopeKind: 'organization',
      limit: '20',
      scopeId: '30000000-0000-4000-8000-000000000001',
      search: 'Иван + школа',
      before: '2026-08-21T17:00:00.000Z',
      beforeId: '40000000-0000-4000-8000-000000000001',
    });
    expect(url.searchParams.has('tenantId')).toBe(false);
  });

  it('uses separate endpoints for organizations and security sessions', async () => {
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ items: [], next: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', request);

    const scope = { kind: 'platform' as const, id: null };
    await adminApi.organizations({ scope });
    await adminApi.securitySessions({ scope });

    expect(String(request.mock.calls[0]?.[0])).toContain('/api/admin/v1/organizations?');
    expect(String(request.mock.calls[1]?.[0])).toContain('/api/admin/v1/security/sessions?');
  });

  it('loads platform operations from a fixed endpoint without client scope parameters', async () => {
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(
        JSON.stringify({ services: { api: 'responding', database: 'responding' } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', request);

    await adminApi.operationsStatus();

    expect(request.mock.calls[0]?.[0]).toBe('/api/admin/v1/operations/status');
  });

  it('builds scoped dashboard and IP activity periods without exposing tenant selectors', async () => {
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', request);
    const scope = {
      kind: 'organization' as const,
      id: '30000000-0000-4000-8000-000000000001',
    };

    await adminApi.dashboard({ scope, range: '90d' });
    await adminApi.ipActivity({ scope, range: '24h', minimumDistinct: 2 });

    const dashboard = new URL(String(request.mock.calls[0]?.[0]), 'https://asa.test');
    expect(Object.fromEntries(dashboard.searchParams)).toEqual({
      scopeKind: 'organization',
      range: '90d',
      scopeId: scope.id,
    });
    const ip = new URL(String(request.mock.calls[1]?.[0]), 'https://asa.test');
    expect(Object.fromEntries(ip.searchParams)).toEqual({
      scopeKind: 'organization',
      range: '24h',
      minimumDistinct: '2',
      limit: '100',
      scopeId: scope.id,
    });
    expect(dashboard.searchParams.has('tenantId')).toBe(false);
    expect(ip.searchParams.has('tenantId')).toBe(false);
  });

  it('sends user-management mutations as same-origin JSON without client role claims', async () => {
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ accountId: 'account', status: 'suspended' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', request);

    await adminApi.setAccountStatus('account/id', {
      status: 'suspended',
      reason: 'Запрос владельца',
    });

    expect(request).toHaveBeenCalledWith(
      '/api/admin/v1/accounts/account%2Fid/status',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ status: 'suspended', reason: 'Запрос владельца' }),
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
      }),
    );
    const body = JSON.parse(String((request.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
    expect(body).not.toHaveProperty('role');
    expect(body).not.toHaveProperty('actorId');
  });

  it('uses account-scoped CRM endpoints for detail, notes and explicit IP labels', async () => {
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ id: 'entry' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', request);

    await adminApi.accountCrm('account/id', { kind: 'organization', id: 'scope/id' });
    await adminApi.addAccountNote('account/id', 'Внутренний комментарий');
    await adminApi.setAccountIpLabel('account/id', {
      ipAddress: '203.0.113.10',
      labelKind: 'school',
      label: 'Школа № 1',
    });
    await adminApi.clearAccountIpLabel('account/id', '203.0.113.10');

    expect(request.mock.calls[0]?.[0]).toBe(
      '/api/admin/v1/accounts/account%2Fid/crm?scopeKind=organization&scopeId=scope%2Fid',
    );
    expect(request.mock.calls[1]?.[0]).toBe('/api/admin/v1/accounts/account%2Fid/notes');
    expect(request.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ note: 'Внутренний комментарий' }),
      }),
    );
    expect(request.mock.calls[2]?.[0]).toBe('/api/admin/v1/accounts/account%2Fid/ip-labels');
    expect(request.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          ipAddress: '203.0.113.10',
          labelKind: 'school',
          label: 'Школа № 1',
        }),
      }),
    );
    expect(request.mock.calls[3]?.[0]).toBe('/api/admin/v1/accounts/account%2Fid/ip-labels');
    expect(request.mock.calls[3]?.[1]).toEqual(
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ ipAddress: '203.0.113.10' }),
      }),
    );
  });

  it('reads and revokes MAX identity through account-scoped admin endpoints', async () => {
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ linked: true, verifiedAt: null, lastRevokedAt: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', request);

    await adminApi.maxIdentity('account/id');
    await adminApi.revokeMaxIdentity('account/id', { reason: 'Запрос владельца' });

    expect(request.mock.calls[0]?.[0]).toBe('/api/admin/v1/accounts/account%2Fid/max');
    expect(request.mock.calls[1]?.[0]).toBe('/api/admin/v1/accounts/account%2Fid/max/revoke');
    expect(request.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'Запрос владельца' }),
      }),
    );
  });

  it('reads and saves server-owned MAX settings without putting a token in the URL', async () => {
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ enabled: false, tokenConfigured: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', request);

    await adminApi.maxConfiguration();
    await adminApi.updateMaxConfiguration({
      enabled: true,
      botUsername: 'asa_bot',
      miniAppUrl: 'https://asa-lab.ru/max-login',
      botToken: 'new-secret',
    });

    expect(request.mock.calls[0]?.[0]).toBe('/api/admin/v1/integrations/max');
    expect(request.mock.calls[1]?.[0]).toBe('/api/admin/v1/integrations/max');
    expect(request.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('new-secret'),
      }),
    );
  });

  it('turns network and malformed server failures into stable client errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    await expect(adminApi.me()).resolves.toEqual({
      ok: false,
      status: 0,
      error: { code: 'network', message: 'Сервер администрирования недоступен.' },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not-json', { status: 502 })),
    );
    await expect(adminApi.me()).resolves.toEqual({
      ok: false,
      status: 502,
      error: {
        code: 'server_error',
        message: 'Не удалось выполнить административный запрос.',
      },
    });
  });
});
