import { it, expect, vi } from 'vitest';
import type pg from 'pg';
import { parseCatalogQuery } from './admin-user-catalog';
import { AdminControlPlaneService, type ResolvedAdminAccess } from './admin-control-plane.service';
import type { AccountDirectoryPort } from '@asa-lab/identity';
it('accepts only closed enums, bounded limits, canonical bounded opaque cursors, no repeated-key arrays', () => {
  expect(parseCatalogQuery({})).toMatchObject({
    kind: 'all',
    status: 'all',
    sort: 'last_activity',
    direction: 'desc',
    limit: 50,
    cursor: null,
  });
  for (const field of [
    'kind',
    'status',
    'sort',
    'direction',
    'limit',
    'cursor',
    'search',
    'scopeKind',
    'scopeId',
  ])
    expect(() => parseCatalogQuery({ [field]: ['50'] } as never)).toThrow(
      'ADMIN_CATALOG_QUERY_INVALID',
    );
  for (const bad of [
    { limit: '0' },
    { limit: '101' },
    { limit: '1.5' },
    { kind: 'teacher' },
    { status: 'online' },
    { sort: 'name;DROP TABLE accounts' },
    { direction: 'DESC' },
    { cursor: 'a==' },
    { cursor: 'x'.repeat(4097) },
    { cursor: Buffer.from('[]').toString('base64url') },
  ])
    expect(() => parseCatalogQuery(bad)).toThrow();
  const precise = {
    v: 1,
    asOf: '2026-10-25T12:00:00.123456Z',
    last: { value: '2026-10-25T12:00:00.000002' },
  };
  expect(
    parseCatalogQuery({ cursor: Buffer.from(JSON.stringify(precise)).toString('base64url') })
      .cursor,
  ).toEqual(precise);
});
it('rechecks permission, audits read, bounds the real SELECT in a read-only transaction and preserves cursor precision', async () => {
  const value = {
    items: [],
    asOf: '2026-10-25T12:00:00.123456Z',
    studentCoverage: { state: 'complete' },
    next: { last: { value: '2026-10-25T12:00:00.000002' } },
  };
  const query = vi.fn(async (sql: string) => ({
      rows: sql.startsWith('SELECT admin_user_catalog') ? [{ value }] : [],
    })),
    release = vi.fn(),
    audit = vi.fn(async () => ({ rows: [] }));
  const service = new AdminControlPlaneService(
    {} as AccountDirectoryPort,
    { query: audit, connect: vi.fn(async () => ({ query, release })) } as unknown as pg.Pool,
  );
  const allow = vi.spyOn(service, 'authorize').mockReturnValue(true);
  const access = {
    subject: { principalId: 'actor' },
    scopes: [],
  } as unknown as ResolvedAdminAccess;
  const input = {
    ...parseCatalogQuery({}),
    scope: { kind: 'platform' as const, id: null },
    search: null,
    requestId: 'catalog-request',
  };
  const result = await service.listUsers(access, input);
  expect(query.mock.calls.map(([sql]) => sql).slice(0, 2)).toEqual([
    'BEGIN READ ONLY',
    "SET LOCAL statement_timeout = '8s'",
  ]);
  expect(query.mock.calls.at(-1)![0]).toBe('COMMIT');
  expect(release).toHaveBeenCalledOnce();
  expect(audit).toHaveBeenCalledOnce();
  expect(JSON.parse(Buffer.from(result.next!, 'base64url').toString()).last.value).toMatch(
    /000002$/,
  );
  allow.mockReturnValue(false);
  await expect(service.listUsers(access, input)).rejects.toThrow('ADMIN_SCOPE_DENIED');
  expect(audit).toHaveBeenCalledOnce();
});

it('destroys only its owned client if rollback fails and preserves the primary query error', async () => {
  const primary = new Error('catalog-query-failed');
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT admin_user_catalog')) throw primary;
    if (sql === 'ROLLBACK') throw new Error('rollback-failed');
    return { rows: [] };
  });
  const release = vi.fn();
  const service = new AdminControlPlaneService(
    {} as AccountDirectoryPort,
    {
      query: vi.fn(async () => ({ rows: [] })),
      connect: vi.fn(async () => ({ query, release })),
    } as unknown as pg.Pool,
  );
  vi.spyOn(service, 'authorize').mockReturnValue(true);
  await expect(
    service.listUsers(
      { subject: { principalId: 'actor' }, scopes: [] } as unknown as ResolvedAdminAccess,
      {
        ...parseCatalogQuery({}),
        scope: { kind: 'platform', id: null },
        search: null,
        requestId: 'catalog-read',
      },
    ),
  ).rejects.toBe(primary);
  expect(release).toHaveBeenCalledExactlyOnceWith(true);
});
