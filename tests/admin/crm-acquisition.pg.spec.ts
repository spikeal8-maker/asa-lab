import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { aiClassFixture, aiIdentity, type AiIdentity } from './ai-student-access.contract';
import {
  catalogCsv,
  type AdminCatalogUser,
  type CatalogAnalytics,
} from '../../apps/api/src/admin-user-catalog';
let admin: pg.Pool, runtime: pg.Pool;
beforeAll(() => {
  for (const key of ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL']) {
    const value = process.env[key];
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
const claim = { source: 'school', medium: 'email', campaign: 'autumn-2026' };
type Actor = {
  kind: 'account' | 'student';
  account: string | null;
  principal: string;
  seat: string | null;
  workspace: string | null;
  classroom: string | null;
};
const account = (a: AiIdentity, workspace = a.workspace_id): Actor => ({
  kind: 'account',
  account: a.account_id,
  principal: a.principal_id,
  seat: null,
  workspace,
  classroom: null,
});
async function ingest(actor: Actor, event = randomUUID(), observation: object = claim) {
  return (
    await runtime.query(
      'SELECT analytics_acquisition_ingest($1,$2,$3,$4,$5,$6,$7,$8::jsonb,clock_timestamp()) receipt',
      [
        event,
        actor.kind,
        actor.account,
        actor.principal,
        actor.seat,
        actor.workspace,
        actor.classroom,
        JSON.stringify(observation),
      ],
    )
  ).rows[0].receipt;
}
async function catalog(
  actor: string,
  scope = 'platform',
  workspace: string | null = null,
  filters: object = {},
  search: string | null = null,
  cursor: object | null = null,
  limit = 100,
) {
  return (
    await runtime.query<{
      value: {
        items: AdminCatalogUser[];
        analytics: CatalogAnalytics;
        next: object | null;
        asOf: string;
      };
    }>(
      "SELECT admin_user_catalog_v2($1,$2,$3,$4,'all','all','name','asc',$5,$6::jsonb,$7::jsonb,'page') value",
      [
        actor,
        scope,
        workspace,
        search,
        limit,
        cursor ? JSON.stringify(cursor) : null,
        JSON.stringify(filters),
      ],
    )
  ).rows[0]!.value;
}
async function platform() {
  const actor = await aiIdentity(admin);
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
    [actor.account_id],
  );
  return actor;
}
it('binds idempotent receipts to subject, context and exact sanitized semantics; rejects direct reads', async () => {
  const a = await aiIdentity(admin),
    b = await aiIdentity(admin),
    event = randomUUID();
  const first = await ingest(account(a), event);
  expect(await ingest(account(a), event)).toEqual(first);
  expect(first).toMatchObject({
    accepted: true,
    state: 'persisted',
    eventId: event,
    operation: 'acquisition.observed',
  });
  await expect(ingest(account(b), event)).rejects.toMatchObject({ code: '23505' });
  await expect(
    ingest(account(a), event, { ...claim, campaign: 'different' }),
  ).rejects.toMatchObject({ code: '23505' });
  await expect(ingest({ ...account(a), principal: b.principal_id })).rejects.toMatchObject({
    code: '42501',
  });
  await expect(ingest({ ...account(a), workspace: b.workspace_id })).rejects.toMatchObject({
    code: '42501',
  });
  await expect(
    runtime.query('SELECT * FROM analytics_acquisition_observations'),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(runtime.query('SELECT * FROM analytics_acquisition_receipts')).rejects.toMatchObject(
    { code: '42501' },
  );
  expect(
    (
      await admin.query(
        'SELECT count(*)::int n FROM analytics_acquisition_observations WHERE event_id=$1',
        [event],
      )
    ).rows[0].n,
  ).toBe(1);
  await admin.query(
    "UPDATE workspace_memberships SET state='revoked' WHERE account_id=$1 AND workspace_id=$2",
    [a.account_id, a.workspace_id],
  );
  await expect(ingest(account(a), event)).rejects.toMatchObject({ code: '42501' });
});
it('rejects raw URLs, arbitrary fields, malformed or empty claims at the SQL boundary and caps daily writes', async () => {
  const a = account(await aiIdentity(admin));
  for (const observation of [
    { ...claim, url: 'https://private.test?token=secret' },
    { ...claim, source: 'mail@example.test' },
    { ...claim, campaign: 'x'.repeat(65) },
    { source: null, medium: null, campaign: null },
    { source: 'school' },
    { ...claim, medium: 42 },
  ])
    await expect(ingest(a, randomUUID(), observation)).rejects.toMatchObject({ code: '22023' });
  for (let i = 0; i < 32; i++) await ingest(a);
  await expect(ingest(a)).rejects.toMatchObject({ code: '22023' });
});
it('projects independent Account/Seat observations only within exact organization/class lineage and includes scalar CSV facts', async () => {
  const f = await aiClassFixture(admin, runtime),
    target = await aiIdentity(admin),
    manager = await aiIdentity(admin),
    owner = await platform();
  const workspace = (
    await admin.query(
      "INSERT INTO workspaces(tenant_id,kind,title) VALUES($1,'organization','Acquisition school') RETURNING id",
      [f.context.tenant_id],
    )
  ).rows[0].id;
  await admin.query(
    "INSERT INTO workspace_memberships(account_id,workspace_id,role,state) VALUES($1,$3,'school_admin','active'),($2,$3,'member','active')",
    [manager.account_id, target.account_id, workspace],
  );
  await admin.query(
    'INSERT INTO crm_organization_classes(classroom_id,workspace_id,assigned_by) VALUES($1,$2,$3)',
    [f.classroomId, workspace, owner.principal_id],
  );
  await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2', [
    target.account_id,
    f.seatId,
  ]);
  await ingest(account(target), randomUUID(), { ...claim, source: 'private-account' });
  await ingest(account(target, workspace), randomUUID(), { ...claim, source: 'organization' });
  const student: Actor = {
    kind: 'student',
    account: null,
    principal: f.principalId,
    seat: f.seatId,
    workspace: null,
    classroom: f.classroomId,
  };
  await ingest(student, randomUUID(), { ...claim, source: 'class-seat' });
  const page = await catalog(manager.principal_id, 'organization', workspace);
  expect(
    page.items.find((i) => i.kind === 'account' && i.id === target.account_id)?.acquisitionLatest
      ?.source,
  ).toBe('organization');
  expect(
    page.items.find((i) => i.kind === 'student' && i.id === f.seatId)?.acquisitionLatest?.source,
  ).toBe('class-seat');
  expect(page.analytics.acquisition?.sources).toMatchObject({ organization: 1, 'class-seat': 1 });
  expect(page.analytics.acquisition?.sources['private-account']).toBeUndefined();
  const seats = await catalog(manager.principal_id, 'organization', workspace, {
    classId: f.classroomId,
  });
  expect(seats.analytics.acquisition?.sources).toEqual({ 'class-seat': 1 });
  const all = await catalog(owner.principal_id);
  expect(all.analytics.acquisition?.sources['private-account']).toBeGreaterThanOrEqual(1);
  const row = page.items.find((i) => i.kind === 'account' && i.id === target.account_id)!;
  expect(catalogCsv([row])).toContain('organization');
  expect(catalogCsv([row])).toContain(
    'Р Р…Р Вµ Р С‘РЎРѓРЎвЂљР С•РЎвЂЎР Р…Р С‘Р С” РЎР‚Р ВµР С–Р С‘РЎРѓРЎвЂљРЎР‚Р В°РЎвЂ Р С‘Р С‘',
  );
  expect(page.analytics.registrationSource).toBe('not_stored');
  await expect(catalog(f.teacher.principal_id)).rejects.toMatchObject({ code: '42501' });
  await expect(ingest({ ...student, classroom: randomUUID() })).rejects.toMatchObject({
    code: '42501',
  });
  await admin.query("UPDATE classrooms SET status='archived' WHERE id=$1", [f.classroomId]);
  await expect(ingest(student)).rejects.toMatchObject({ code: '42501' });
});
it('honors period/90-day cutoff without historic backfill and performs bounded indexed cleanup with separate receipts', async () => {
  const owner = await platform(),
    target = await aiIdentity(admin),
    a = account(target),
    event = randomUUID();
  await ingest(a, event);
  await admin.query(
    "UPDATE analytics_acquisition_observations SET observed_at=clock_timestamp()-interval '91 days' WHERE event_id=$1",
    [event],
  );
  const email = (await admin.query('SELECT email FROM accounts WHERE id=$1', [target.account_id]))
    .rows[0].email;
  const before = await catalog(owner.principal_id, 'platform', null, {}, email);
  expect(before.items.find((i) => i.id === target.account_id)?.acquisitionLatest).toBeNull();
  expect(before.analytics.acquisition?.unknownRecords).toBeGreaterThanOrEqual(1);
  await ingest(a);
  expect(
    (
      await admin.query(
        'SELECT count(*)::int n FROM analytics_acquisition_observations WHERE event_id=$1',
        [event],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await admin.query(
        'SELECT count(*)::int n FROM analytics_acquisition_receipts WHERE event_id=$1',
        [event],
      )
    ).rows[0].n,
  ).toBe(1);
  await ingest(a, event); // digest-only receipt replay must not recreate expired observations.
  expect(
    (
      await admin.query(
        'SELECT count(*)::int n FROM analytics_acquisition_observations WHERE event_id=$1',
        [event],
      )
    ).rows[0].n,
  ).toBe(0);
  const fresh = randomUUID();
  await ingest(a, fresh);
  await admin.query(
    "UPDATE analytics_acquisition_observations SET observed_at=clock_timestamp()-interval '20 days' WHERE event_id=$1",
    [fresh],
  );
  const page7 = await catalog(owner.principal_id, 'platform', null, { days: '7' }, email);
  const page30 = await catalog(owner.principal_id, 'platform', null, { days: '30' }, email);
  expect(page7.analytics.daily).toHaveLength(7);
  expect(page30.analytics.daily).toHaveLength(30);
  expect(page30.analytics.acquisition!.observations).toBe(
    page7.analytics.acquisition!.observations + 1,
  );
  // A new claimed observation does not create an auth.register or visit event.
  expect(
    (
      await admin.query(
        'SELECT count(*)::int n FROM product_analytics_events WHERE account_id=$1',
        [target.account_id],
      )
    ).rows[0].n,
  ).toBe(0);
});

it('bounds cleanup to 100 observations and receipts per intake and honors 97-day receipt retention', async () => {
  const a = account(await aiIdentity(admin));
  await admin.query(
    `WITH old AS (
    INSERT INTO analytics_acquisition_receipts(event_id,actor_kind,account_id,principal_id,seat_id,workspace_id,class_id,binding_digest,received_at,persisted_at)
    SELECT gen_random_uuid(),'account',$1,$2,NULL,$3,NULL,'fixture',clock_timestamp()-interval '98 days',clock_timestamp()-interval '98 days' FROM generate_series(1,105) RETURNING event_id
  ) INSERT INTO analytics_acquisition_observations(event_id,actor_kind,account_id,principal_id,seat_id,workspace_id,class_id,tenant_id,source,observed_at)
    SELECT old.event_id,'account',$1,$2,NULL,$3,NULL,w.tenant_id,'cleanup-expired',clock_timestamp()-interval '98 days' FROM old CROSS JOIN workspaces w WHERE w.id=$3`,
    [a.account, a.principal, a.workspace],
  );
  await ingest(a);
  const left = (
    await admin.query(
      "SELECT count(*)::int n FROM analytics_acquisition_observations WHERE principal_id=$1 AND source='cleanup-expired'",
      [a.principal],
    )
  ).rows[0].n;
  expect(left).toBeGreaterThanOrEqual(5);
  expect(left).toBeLessThan(105);
  const receipts = (
    await admin.query(
      "SELECT count(*)::int n FROM analytics_acquisition_receipts WHERE principal_id=$1 AND binding_digest='fixture'",
      [a.principal],
    )
  ).rows[0].n;
  expect(receipts).toBeGreaterThanOrEqual(5);
  expect(receipts).toBeLessThan(105);
  await ingest(a);
  expect(
    (
      await admin.query(
        "SELECT count(*)::int n FROM analytics_acquisition_observations WHERE principal_id=$1 AND source='cleanup-expired'",
        [a.principal],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await admin.query(
        "SELECT count(*)::int n FROM analytics_acquisition_receipts WHERE principal_id=$1 AND binding_digest='fixture'",
        [a.principal],
      )
    ).rows[0].n,
  ).toBe(0);
});
