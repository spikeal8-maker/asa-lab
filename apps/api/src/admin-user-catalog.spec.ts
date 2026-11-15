import { it, expect, vi } from 'vitest';
import type pg from 'pg';
import { parseCatalogQuery, parseCatalogFilters, catalogCsv } from './admin-user-catalog';
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

it('validates advanced filters and leaves unknown age distinct from zero', () => {
  expect(parseCatalogFilters({ ageMin: '0', ageMax: '18', days: '90' })).toEqual({
    ageMin: '0',
    ageMax: '18',
    days: '90',
  });
  for (const bad of [
    { age: 'unknown', ageMin: '0' },
    { ageMin: '18', ageMax: '5' },
    { registeredAfter: '2026-02-30' },
    { registeredAfter: '2026-10-25', registeredBefore: '2026-10-24' },
    { role: ['educator'] },
    { days: '10000' },
    { classId: 'oops' },
    { email: 'password_hash' },
  ])
    expect(() => parseCatalogFilters(bad)).toThrow('ADMIN_CATALOG_QUERY_INVALID');
});
it('exports every supplied record, quotes delimiters/newlines, neutralizes formulas and excludes secrets', () => {
  const items = Array.from({ length: 61 }, (_, i) => ({
    kind: 'student',
    id: String(i),
    displayName:
      i === 0 ? ' \t=HYPERLINK("bad");\nnext' : i === 1 ? '@SUM(1)' : i === 2 ? '---' : 'safe',
    age: i === 3 ? 0 : null,
    recentActivityCount: 0,
    password_hash: 'NEVER',
    token_hash: 'NEVER',
  }));
  const csv = catalogCsv(items as never);
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv.split('\r\n')[0]).toContain('Время наблюдения UTM (не источник регистрации)');
  expect(csv).toContain('"\' \t=HYPERLINK(""bad"");\nnext"');
  expect(csv).toContain('"\'@SUM(1)"');
  expect(csv).toContain('"\'---"');
  expect(csv).toContain('"60"');
  expect(csv).toContain('"Неизвестно"');
  expect(csv).toContain('"0"');
  expect(csv).not.toContain('NEVER');
  for (const displayName of ['\u0085=cmd', '\u200b@SUM(1)', '\r\n+1', '\t-2'])
    expect(catalogCsv([{ kind: 'student', id: 'test', displayName }] as never)).toContain(
      "'" + displayName,
    );
});
it('bounds export concurrency/size, releases read client before final audit and denies fresh revocation', async () => {
  const access = {
    subject: { principalId: 'actor' },
    scopes: [],
  } as unknown as ResolvedAdminAccess;
  const final = vi.fn(async () => ({ rows: [{ allowed: false }] }));
  const service = new AdminControlPlaneService(
    {} as AccountDirectoryPort,
    { connect: async () => ({ query: final, release: vi.fn() }) } as unknown as pg.Pool,
  );
  vi.spyOn(service, 'authorize').mockReturnValue(true);
  const read = vi.spyOn(service, 'listUsers').mockResolvedValue({
    items: [],
    next: null,
    asOf: 'now',
    studentCoverage: { state: 'complete' },
  });
  const input = {
    ...parseCatalogQuery({}),
    scope: { kind: 'platform' as const, id: null },
    search: null,
    requestId: 'request',
  };
  await expect(service.exportUsers(access, input)).rejects.toThrow('ADMIN_SCOPE_DENIED');
  expect(final.mock.calls.some((call) => String(call[0]).includes('crm_export_prepared'))).toBe(
    true,
  );
  read.mockResolvedValue({
    items: [],
    next: 'not-complete',
    asOf: 'now',
    studentCoverage: { state: 'complete' },
  });
  await expect(service.exportUsers(access, input)).rejects.toThrow('CRM_EXPORT_TOO_LARGE');
  expect(
    final.mock.calls.filter((call) => String(call[0]).includes('crm_export_prepared')),
  ).toHaveLength(1);
});

it('rejects duplicate actor exports while the first buffered operation is in progress', async () => {
  const access = {
    subject: { principalId: 'actor' },
    scopes: [],
  } as unknown as ResolvedAdminAccess;
  const query = vi.fn(async () => ({ rows: [{ allowed: true }] }));
  const service = new AdminControlPlaneService(
    {} as AccountDirectoryPort,
    { connect: async () => ({ query, release: vi.fn() }) } as unknown as pg.Pool,
  );
  vi.spyOn(service, 'authorize').mockReturnValue(true);
  let finish!: (page: Awaited<ReturnType<typeof service.listUsers>>) => void;
  vi.spyOn(service, 'listUsers').mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  const input = {
    ...parseCatalogQuery({}),
    scope: { kind: 'platform' as const, id: null },
    search: null,
    requestId: 'request',
  };
  const first = service.exportUsers(access, input);
  await expect(service.exportUsers(access, input)).rejects.toThrow('CRM_EXPORT_BUSY');
  finish({ items: [], next: null, asOf: 'now', studentCoverage: { state: 'complete' } });
  await expect(first).resolves.toMatchObject({ count: 0 });
});
