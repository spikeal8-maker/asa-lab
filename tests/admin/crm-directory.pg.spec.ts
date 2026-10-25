import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { aiIdentity } from './ai-student-access.contract';
import { catalogCsv, type AdminCatalogUser } from '../../apps/api/src/admin-user-catalog';
type CatalogCursor = {
  v: 1;
  fingerprint: string;
  asOf: string;
  last: { kind: 'account' | 'student'; id: string; value: string | null };
};
type CatalogPage = {
  matchedCount: number;
  analytics: {
    accounts: number;
    students: number;
    ageUnknown: number;
    aiRequests: number | null;
    sourceUnknown: number;
    daily: unknown[];
  };
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
        'SELECT admin_user_catalog_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12) AS value',
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
          JSON.stringify(options.filters ?? {}),
          options.mode ?? 'page',
        ],
      )
    ).rows[0].value;
  return { actor, other, accounts, seats, prefix, workspace, tenant, classroom, call };
}

it('filters the complete >50 set before pages and exports all filtered rows with matching aggregates', async () => {
  const f = await fixture();
  await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2', [
    f.accounts[0]!.id,
    f.seats[1]!.id,
  ]);
  const page = await f.call({
    limit: 17,
    filters: { age: 'known', ageMin: '18', email: 'present' },
  });
  expect(page.matchedCount).toBe(61);
  expect(page.items).toHaveLength(17);
  expect(page.analytics.accounts).toBe(61);
  expect(page.analytics.students).toBe(0);
  const second = await f.call({
    limit: 17,
    filters: { age: 'known', ageMin: '18', email: 'present' },
    cursor: page.next,
  });
  expect(second.items).toHaveLength(17);
  expect(second.matchedCount).toBe(61);
  const download = await f.call({
    limit: 10001,
    mode: 'export',
    filters: { age: 'known', email: 'present' },
  });
  expect(download.items).toHaveLength(61);
  const linked = await f.call({ limit: 100 });
  expect((linked.analytics as unknown as Record<string, unknown>).linkedRecords).toBe(3);
  expect(
    linked.items.find((i) => i.kind === 'account' && i.id === f.accounts[0]!.id)?.linkedRecordCount,
  ).toBe(2);
  expect(download.next).toBeNull();
  expect(catalogCsv(download.items).split('\r\n')).toHaveLength(62);
  expect(download.analytics.daily).toHaveLength(30);
  expect((await f.call({ filters: { age: 'unknown', role: 'learner' } })).matchedCount).toBe(5);
  expect((await f.call({ filters: { source: 'unknown' } })).matchedCount).toBe(66);
  expect((await f.call({ filters: { classId: f.classroom } })).matchedCount).toBe(6);
  expect((await f.call({ filters: { registeredAfter: '2099-01-01' } })).matchedCount).toBe(0);
  await expect(f.call({ cursor: page.next, filters: { age: 'unknown' } })).rejects.toMatchObject({
    code: '22023',
  });
  await expect(f.call({ cursor: page.next, actor: f.other.principal_id })).rejects.toMatchObject({
    code: '42501',
  });
});
it('requires explicit audited binding, current exact org membership, no linked Account/private AI leak; revoke acts immediately', async () => {
  const f = await fixture();
  const opts = {
    actor: f.other.principal_id,
    scope: 'organization',
    scopeId: f.workspace,
    kind: 'students',
    filters: { organizationId: f.workspace },
  };
  expect((await f.call(opts)).matchedCount).toBe(0);
  await expect(
    f.call({ ...opts, filters: { organizationId: randomUUID() } }),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    runtime.query('SELECT crm_bind_class($1,$2,$3,NULL,$4,$5)', [
      f.other.principal_id,
      f.classroom,
      f.workspace,
      'Denied',
      randomUUID(),
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  await runtime.query('SELECT crm_bind_class($1,$2,$3,NULL,$4,$5)', [
    f.actor.principal_id,
    f.classroom,
    f.workspace,
    'Approved binding',
    randomUUID(),
  ]);
  const bound = await f.call(opts);
  expect(bound.items).toHaveLength(5);
  expect(bound.studentCoverage.state).toBe('complete');
  expect(bound.analytics.aiRequests).toBe(0);
  const orgBase = await f.call({ ...opts, kind: 'all' });
  const basic = orgBase.items.find((i) => i.kind === 'account') as unknown as Record<
    string,
    unknown
  >;
  expect(basic.birthDate).toBeNull();
  expect(basic.country).toBeNull();
  expect(basic.aiRequests).toBeNull();
  await expect(runtime.query('SELECT * FROM crm_organization_classes')).rejects.toMatchObject({
    code: '42501',
  });
  const foreignClass = (
    await admin.query(
      "INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by) SELECT tenant_id,school_id,academic_period_id,'Unbound foreign class',created_by FROM classrooms WHERE id=$1 RETURNING id",
      [f.classroom],
    )
  ).rows[0].id;
  await expect(
    runtime.query('SELECT crm_card($1,$2,$3,$4,$5)', [
      f.other.principal_id,
      'student',
      f.seats[0]!.id,
      foreignClass,
      randomUUID(),
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  expect(bound.items.every((i) => i.email === null && i.account === null)).toBe(true);
  const card = (
    await runtime.query('SELECT crm_card($1,$2,$3,$4,$5) value', [
      f.other.principal_id,
      'student',
      f.seats[0]!.id,
      f.classroom,
      randomUUID(),
    ])
  ).rows[0].value;
  expect(card.linkedIdentities).toEqual([]);
  expect(card.canEdit).toBe(false);
  await expect(
    runtime.query('SELECT crm_card($1,$2,$3,NULL,$4)', [
      f.other.principal_id,
      'account',
      f.accounts[0]!.id,
      randomUUID(),
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    runtime.query('SELECT crm_bind_class($1,$2,$3,NULL,$4,$5)', [
      f.actor.principal_id,
      f.classroom,
      f.workspace,
      'Stale update',
      randomUUID(),
    ]),
  ).rejects.toMatchObject({ code: '40001' });
  await admin.query(
    "UPDATE workspace_memberships SET state='revoked' WHERE account_id=$1 AND workspace_id=$2",
    [f.other.account_id, f.workspace],
  );
  await expect(f.call(opts)).rejects.toMatchObject({ code: '42501' });
  await expect(
    runtime.query('SELECT crm_card($1,$2,$3,$4,$5)', [
      f.other.principal_id,
      'student',
      f.seats[0]!.id,
      f.classroom,
      randomUUID(),
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  await runtime.query('SELECT crm_bind_class($1,$2,NULL,$3,$4,$5)', [
    f.actor.principal_id,
    f.classroom,
    f.workspace,
    'Remove binding',
    randomUUID(),
  ]);
  await admin.query(
    "UPDATE workspace_memberships SET state='active' WHERE account_id=$1 AND workspace_id=$2",
    [f.other.account_id, f.workspace],
  );
  await expect(
    runtime.query('SELECT crm_export_prepared($1,$2,$3,1,$4,$5,$6)', [
      f.other.principal_id,
      'organization',
      f.workspace,
      '{}',
      randomUUID(),
      JSON.stringify([{ kind: 'student', id: f.seats[0]!.id }]),
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  expect(
    (
      await admin.query(
        "SELECT metadata_json FROM administrative_audit_events WHERE action='crm.organization_class.bind' AND target_id=$1",
        [f.classroom],
      )
    ).rowCount,
  ).toBe(2);
});
it('captures source and event facts without inventing historical attribution or token coverage', async () => {
  const f = await fixture();
  const id = f.accounts[0]!.id;
  await admin.query(
    "INSERT INTO product_analytics_events(actor_kind,account_id,principal_id,event_type,outcome,occurred_at,referrer_origin) VALUES('account',$1,$2,'visit.observed','succeeded',now()-interval '1 day','https://example.test')",
    [id, f.accounts[0]!.principal],
  );
  const page = await f.call({ filters: { source: 'observed' } });
  expect(page.matchedCount).toBe(1);
  expect(page.analytics.sourceUnknown).toBe(0);
  const row = page.items[0] as unknown as Record<string, unknown>;
  expect(row.firstObservedReferrer).toBe('https://example.test');
  expect(row.aiRequests).toBe(0);
  expect(row.aiInputTokens).toBeNull();
  expect(JSON.stringify(row)).not.toMatch(/password_hash|token_hash|credential/);
  await admin.query(
    "UPDATE capability_grants SET state='revoked' WHERE account_id=$1 AND capability='platform_admin'",
    [f.actor.account_id],
  );
  await expect(
    runtime.query('SELECT crm_export_prepared($1,$2,NULL,1,$3,$4,$5)', [
      f.actor.principal_id,
      'platform',
      '{}',
      randomUUID(),
      JSON.stringify([{ kind: 'account', id }]),
    ]),
  ).rejects.toMatchObject({ code: '42501' });
});

it('includes retained legacy AI admissions, deduplicates journal overlap and keeps unknown tokens unknown', async () => {
  const f = await fixture(),
    account = f.accounts[0]!,
    legacy = randomUUID(),
    both = randomUUID();
  await admin.query(
    'INSERT INTO ai_assistant_request_quota(owner_principal_id,account_id,request_id) VALUES($1,$2,$3),($1,$2,$4)',
    [account.principal, account.id, legacy, both],
  );
  await admin.query('DELETE FROM ai_usage_journal WHERE owner_principal_id=$1 AND request_id=$2', [
    account.principal,
    legacy,
  ]);
  const page = await f.call({ limit: 100 });
  const row = page.items.find(
    (i) => i.kind === 'account' && i.id === account.id,
  ) as unknown as Record<string, unknown>;
  expect(page.analytics.aiRequests).toBe(2);
  expect(row.aiRequests).toBe(2);
  expect(row.aiLegacyRequests).toBe(1);
  expect(row.aiTokenCovered).toBe(0);
  expect(row.aiInputTokens).toBeNull();
});
