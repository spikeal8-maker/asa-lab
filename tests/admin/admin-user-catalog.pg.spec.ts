import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { aiIdentity } from './ai-student-access.contract';
import type { AdminCatalogUser } from '../../apps/api/src/admin-user-catalog';
type CatalogCursor = {
  v: 1;
  fingerprint: string;
  asOf: string;
  last: { kind: 'account' | 'student'; id: string; value: string | null };
};
type CatalogPage = {
  items: AdminCatalogUser[];
  next: CatalogCursor | null;
  asOf: string;
  studentCoverage: { state: 'complete' | 'unavailable'; reason?: string };
};
let admin: pg.Pool, runtime: pg.Pool;
beforeAll(() => {
  for (const name of ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL']) {
    const value = process.env[name];
    if (!value || !decodeURIComponent(new URL(value).pathname).endsWith('_test'))
      throw new Error('Isolated _test database required');
  }
  admin = testAdminPool();
  runtime = testAppPool();
});
afterAll(async () => {
  await runtime?.end();
  await admin?.end();
});
async function fixture() {
  const actor = await aiIdentity(admin),
    other = await aiIdentity(admin),
    prefix = 'catalog-' + randomUUID().slice(0, 8);
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
    [actor.account_id],
  );
  const accounts = Array.from({ length: 61 }, (_, i) => ({
    id: randomUUID(),
    principal: randomUUID(),
    name: `${prefix} ${String(i % 7).padStart(2, '0')}`,
    email: `${prefix}-${i}@example.test`,
    username: `cat${randomUUID().replaceAll('-', '')}`,
    status: i % 5 === 0 ? 'suspended' : 'active',
    created:
      i === 0
        ? '2026-10-24T12:00:00.000001Z'
        : i === 1
          ? '2026-10-24T12:00:00.000002Z'
          : '2026-10-24T12:00:00.000000Z',
  }));
  await admin.query(
    `WITH data AS(SELECT * FROM jsonb_to_recordset($1::jsonb) AS d(id uuid,principal uuid,name text,email text,username text,status varchar,created timestamptz)),a AS(
    INSERT INTO accounts(id,email,password_hash,birth_date,country,status,created_at) SELECT id,email,'fixture',DATE '1990-01-01','RU',status,created FROM data RETURNING id),f AS(
    INSERT INTO profiles(account_id,display_name,username) SELECT d.id,d.name,d.username FROM data d JOIN a ON a.id=d.id RETURNING account_id)
    INSERT INTO principals(id,kind,account_id) SELECT d.principal,'account',d.id FROM data d JOIN f ON f.account_id=d.id`,
    [JSON.stringify(accounts)],
  );
  const tenant = (
    await admin.query(
      "INSERT INTO tenants(title,workspace_slug) VALUES('Catalog organization',$1) RETURNING id",
      [randomUUID()],
    )
  ).rows[0].id;
  const workspace = (
    await admin.query(
      "INSERT INTO workspaces(tenant_id,kind,title) VALUES($1,'organization','Catalog school') RETURNING id",
      [tenant],
    )
  ).rows[0].id;
  await admin.query(
    "INSERT INTO workspace_memberships(account_id,workspace_id,role,state) VALUES($1,$2,'school_admin','active'),($3,$2,'member','active')",
    [other.account_id, workspace, accounts[0]!.id],
  );
  const school = (
    await admin.query('INSERT INTO schools(tenant_id,title) VALUES($1,$2) RETURNING id', [
      tenant,
      prefix,
    ])
  ).rows[0].id;
  const period = (
    await admin.query(
      "INSERT INTO academic_periods(tenant_id,school_id,title,starts_on,ends_on) VALUES($1,$2,'Fixture',DATE '2026-01-01',DATE '2026-12-31') RETURNING id",
      [tenant, school],
    )
  ).rows[0].id;
  const teacher = (
    await admin.query(
      "INSERT INTO users(tenant_id,school_id,role,email,display_name,password_hash) VALUES($1,$2,'teacher',$3,'Fixture','fixture') RETURNING id",
      [tenant, school, `${prefix}@teacher.test`],
    )
  ).rows[0].id;
  const classroom = (
    await admin.query(
      'INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [tenant, school, period, `${prefix} class`, teacher],
    )
  ).rows[0].id;
  const seats = [];
  for (let i = 0; i < 5; i++) {
    const credential = randomUUID().replaceAll('-', '');
    const id = i === 0 ? accounts[0]!.id : randomUUID(),
      principal = i === 4 ? null : randomUUID();
    await admin.query(
      'INSERT INTO classroom_student_seats(id,tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,status,created_by,account_id) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8)',
      [
        id,
        tenant,
        classroom,
        `${prefix} ${String(i % 7).padStart(2, '0')}`,
        credential,
        i === 0 ? 'issued' : i === 1 ? 'suspended' : 'active',
        teacher,
        i === 0 ? accounts[0]!.id : null,
      ],
    );
    if (principal)
      await admin.query("INSERT INTO principals(id,kind,seat_id) VALUES($1,'student_seat',$2)", [
        principal,
        id,
      ]);
    seats.push({ id, principal, credential });
  }
  const call = async (options: Record<string, unknown> = {}) =>
    (
      await runtime.query<{ value: CatalogPage }>(
        'SELECT admin_user_catalog($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) AS value',
        [
          options.actor ?? actor.principal_id,
          options.scope ?? 'platform',
          options.scopeId ?? null,
          options.search ?? prefix,
          options.kind ?? 'all',
          options.status ?? 'all',
          options.sort ?? 'last_activity',
          options.direction ?? 'desc',
          options.limit ?? 17,
          options.cursor ? JSON.stringify(options.cursor) : null,
        ],
      )
    ).rows[0].value;
  return { actor, other, accounts, seats, prefix, workspace, tenant, classroom, call };
}
async function allPages(
  call: (options: Record<string, unknown>) => Promise<CatalogPage>,
  options: Record<string, unknown> = {},
) {
  const items: AdminCatalogUser[] = [];
  let cursor: unknown = options.cursor ?? null;
  let pages = 0;
  do {
    const page = await call({ ...options, cursor });
    items.push(...page.items);
    cursor = page.next;
    pages++;
    if (pages > 10) throw new Error('Unbounded catalog paging');
  } while (cursor);
  return items;
}
it('sorts the full >50 actor set on the server with deterministic ties/nulls and distinct typed UUID collisions', async () => {
  const f = await fixture();
  for (const sort of ['name', 'last_activity', 'activity', 'created'])
    for (const direction of ['asc', 'desc']) {
      const rows = await allPages(f.call, { sort, direction });
      expect(rows).toHaveLength(66);
      expect(new Set(rows.map((row) => row.actorKey)).size).toBe(66);
      const expected = (await f.call({ sort, direction, limit: 100 })).items;
      expect(rows.map((row) => row.actorKey)).toEqual(expected.map((row) => row.actorKey));
    }
  const collision = (await allPages(f.call)).filter((row) => row.id === f.accounts[0]!.id);
  expect(collision.map((row) => row.kind).sort()).toEqual(['account', 'student']);
  expect(collision.find((row) => row.kind === 'student')).toMatchObject({
    account: null,
    email: null,
    status: 'issued',
    normalizedStatus: 'active',
  });
  expect((await allPages(f.call)).find((row) => row.id === f.seats[4]!.id)).toMatchObject({
    kind: 'student',
    principalId: null,
  });
});
it('applies combined type/status/literal search filters before pagination and treats issued as a valid Seat record', async () => {
  const f = await fixture();
  const students = await allPages(f.call, { kind: 'students', status: 'active' });
  expect(students).toHaveLength(4);
  expect(students.some((row) => row.status === 'issued')).toBe(true);
  expect(
    (await allPages(f.call, { kind: 'accounts', status: 'inactive' })).every(
      (row) => row.kind === 'account' && row.status === 'suspended',
    ),
  ).toBe(true);
  expect(
    (await f.call({ kind: 'students', search: `${f.prefix} class`, limit: 100 })).items,
  ).toHaveLength(5);
  expect((await f.call({ search: "%' OR 1=1 --", limit: 100 })).items).toEqual([]);
});
it('keeps organization students explicitly unavailable even for classes in that exact tenant; no foreign account/IP leaks', async () => {
  const f = await fixture();
  const page = await f.call({
    actor: f.other.principal_id,
    scope: 'organization',
    scopeId: f.workspace,
    limit: 100,
  });
  expect(page.studentCoverage).toEqual({
    state: 'unavailable',
    reason: 'organization_class_mapping_unavailable',
  });
  expect(page.items).toHaveLength(1);
  expect(page.items[0].actorKey).toBe(`account:${f.accounts[0]!.id}`);
  const unavailable = await f.call({
    actor: f.other.principal_id,
    scope: 'organization',
    scopeId: f.workspace,
    kind: 'students',
  });
  expect(unavailable.items).toEqual([]);
  expect(unavailable.studentCoverage.state).toBe('unavailable');
  await expect(f.call({ actor: f.accounts[1]!.principal })).rejects.toMatchObject({
    code: '42501',
  });
  await expect(
    f.call({ actor: f.other.principal_id, scope: 'organization', scopeId: randomUUID() }),
  ).rejects.toMatchObject({ code: '42501' });
});
it('preserves raw microsecond order and rejects filter/scope/sort mismatches, invalid tuples and expired/future cursors', async () => {
  const f = await fixture();
  const first = await f.call({ sort: 'created', direction: 'desc', kind: 'accounts', limit: 1 });
  expect(first.items[0].id).toBe(f.accounts[1]!.id);
  expect(first.next.last.value).toMatch(/000002$/);
  const second = await f.call({
    sort: 'created',
    direction: 'desc',
    kind: 'accounts',
    limit: 1,
    cursor: first.next,
  });
  expect(second.items[0].id).toBe(f.accounts[0]!.id);
  expect(second.next.last.value).toMatch(/000001$/);
  for (const changed of [
    { sort: 'name' },
    { direction: 'asc' },
    { status: 'active' },
    { kind: 'students' },
    { search: 'different' },
    { actor: f.other.principal_id, scope: 'organization', scopeId: f.workspace },
  ])
    await expect(
      f.call({ sort: 'created', kind: 'accounts', limit: 1, cursor: first.next, ...changed }),
    ).rejects.toMatchObject({ code: '22023' });
  for (const change of [
    { v: 2 },
    { asOf: '2999-01-01T00:00:00Z' },
    { asOf: '2000-01-01T00:00:00Z' },
    { last: { kind: 'account', value: 'x' } },
    { last: { ...first.next.last, id: 'not-uuid' } },
    { injection: 'ignored?' },
  ])
    await expect(
      f.call({ sort: 'created', kind: 'accounts', limit: 1, cursor: { ...first.next, ...change } }),
    ).rejects.toMatchObject({ code: '22023' });
  await expect(f.call({ limit: 101 })).rejects.toMatchObject({ code: '22023' });
});
it('does not move actors across the cursor when mutable heartbeat last_seen_at changes between pages', async () => {
  const f = await fixture();
  for (const account of f.accounts.slice(1, 4)) {
    await admin.query(
      "INSERT INTO workspace_memberships(account_id,workspace_id,role,state) VALUES($1,$2,'member','active') ON CONFLICT(account_id,workspace_id) DO NOTHING",
      [account.id, f.workspace],
    );
    await admin.query(
      "INSERT INTO sessions_v2(principal_id,active_workspace_id,token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,$3,'2026-10-24T10:00:00Z','2026-10-24T11:00:00Z',now()+interval '1 hour')",
      [account.principal, f.workspace, randomUUID().replaceAll('-', '').padEnd(64, '0')],
    );
  }
  await admin.query(
    "INSERT INTO classroom_student_sessions(seat_id,token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,'2026-10-24T10:00:00Z','2026-10-24T11:00:00Z',now()+interval '1 hour')",
    [f.seats[0]!.id, randomUUID().replaceAll('-', '').padEnd(64, '0')],
  );
  const expected = (await f.call({ limit: 100 })).items.map((row) => row.actorKey),
    first = await f.call({ limit: 1 });
  await admin.query(
    'UPDATE sessions_v2 SET last_seen_at=clock_timestamp() WHERE principal_id=ANY($1::uuid[])',
    [f.accounts.slice(1, 4).map((row) => row.principal)],
  );
  await admin.query(
    'UPDATE classroom_student_sessions SET last_seen_at=clock_timestamp() WHERE seat_id=$1',
    [f.seats[0]!.id],
  );
  const rest = await allPages(f.call, { cursor: first.next, limit: 17 });
  expect([first.items[0].actorKey, ...rest.map((row) => row.actorKey)]).toEqual(expected);
});
it('uses persisted cutoff for 30-day counts, excludes late facts, and never leaks another workspace activity', async () => {
  const f = await fixture();
  const event = async (
    kind: 'account' | 'student',
    id: string,
    principal: string,
    n: number,
    workspace: string | null = f.workspace,
  ) =>
    admin.query(
      "INSERT INTO product_analytics_events(actor_kind,account_id,principal_id,seat_id,workspace_id,tenant_id,event_type,outcome,occurred_at,persisted_at,ip_address,network_kind,browser_family,operating_system,device_category) SELECT $1,$2,$3,$4,$5,$6,'visit.observed','succeeded',clock_timestamp()-interval '1 day',clock_timestamp(),'203.0.113.44','public','Chrome','Windows','desktop' FROM generate_series(1,$7::int)",
      [
        kind,
        kind === 'account' ? id : null,
        principal,
        kind === 'student' ? id : null,
        workspace,
        f.tenant,
        n,
      ],
    );
  await event('student', f.seats[0]!.id, f.seats[0]!.principal!, 6);
  await event('account', f.accounts[0]!.id, f.accounts[0]!.principal, 5, null);
  const first = await f.call({ sort: 'activity', limit: 1 });
  expect(first.items[0]).toMatchObject({
    kind: 'student',
    recentActivityCount: 6,
    browser: 'Chrome',
    lastIpAddress: '203.0.113.44',
  });
  await event('account', f.accounts[1]!.id, f.accounts[1]!.principal, 20);
  const next = await f.call({ sort: 'activity', limit: 1, cursor: first.next });
  expect(next.items[0]).toMatchObject({
    kind: 'account',
    id: f.accounts[0]!.id,
    recentActivityCount: 5,
  });
  const organization = await f.call({
    actor: f.other.principal_id,
    scope: 'organization',
    scopeId: f.workspace,
    limit: 100,
  });
  expect(organization.items[0]).toMatchObject({
    recentActivityCount: 0,
    lastIpAddress: null,
    browser: null,
  });
});
it('includes a canonical external-only Account with NULL email in name/login search without inventing contact data', async () => {
  const f = await fixture();
  const login = `maxcat${randomUUID().replaceAll('-', '')}`;
  const external = (
    await admin.query(
      "SELECT * FROM auth_account_bootstrap_internal(NULL,NULL,$1,$2,DATE '1990-01-01','RU','test',$3,1)",
      [`${f.prefix} MAX-only`, login, randomUUID().replaceAll('-', '').padEnd(64, '0')],
    )
  ).rows[0];
  for (const search of [`${f.prefix} MAX-only`, login]) {
    const page = await f.call({ kind: 'accounts', search, limit: 100 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      kind: 'account',
      id: external.account_id,
      principalId: external.principal_id,
      email: null,
      account: { email: null },
    });
  }
  expect((await f.call({ limit: 100 })).items.some((row) => row.id === external.account_id)).toBe(
    true,
  );
});

it('never exports StudentCode or uses it as a search oracle under accounts.read', async () => {
  const f = await fixture();
  const page = await f.call({ kind: 'students', limit: 100 });
  expect(page.items.every((row) => row.login === null)).toBe(true);
  for (const seat of f.seats) {
    expect(JSON.stringify(page).includes(seat.credential)).toBe(false);
    const searched = await f.call({ kind: 'students', search: seat.credential, limit: 100 });
    expect(searched.items.length === 0).toBe(true);
  }
});

it('has a closed SECURITY DEFINER boundary with fixed search_path and no PUBLIC execution', async () => {
  const row = (
    await admin.query(
      "SELECT p.prosecdef,p.proconfig,EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p WHERE p.oid='admin_user_catalog(uuid,varchar,uuid,varchar,varchar,varchar,varchar,varchar,integer,jsonb)'::regprocedure",
    )
  ).rows[0];
  expect(row.prosecdef).toBe(true);
  expect(row.public_execute).toBe(false);
  expect(row.proconfig.join(',')).toContain('search_path=pg_catalog, pg_temp');
  await expect(runtime.query('SELECT * FROM product_analytics_events')).rejects.toMatchObject({
    code: '42501',
  });
});
