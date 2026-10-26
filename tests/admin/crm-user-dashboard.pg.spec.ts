import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { aiIdentity, aiClassFixture } from './ai-student-access.contract';
let admin: pg.Pool, runtime: pg.Pool;
beforeAll(() => {
  for (const key of ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'])
    if (!process.env[key] || !new URL(process.env[key]!).pathname.endsWith('_test'))
      throw new Error('Isolated _test database required');
  admin = testAdminPool();
  runtime = testAppPool();
});
afterAll(async () => {
  await runtime?.end();
  await admin?.end();
});
async function dashboard(
  actor: string,
  kind: string,
  target: string,
  classroom: string | null = null,
) {
  return (
    await runtime.query('SELECT crm_user_dashboard($1,$2,$3,$4,$5) value', [
      actor,
      kind,
      target,
      classroom,
      randomUUID(),
    ])
  ).rows[0].value;
}
it('returns dense UTC empty data and unknown tokens/rating without preparing identities or inventing rewards', async () => {
  const owner = await aiIdentity(admin),
    target = await aiIdentity(admin);
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
    [owner.account_id],
  );
  const before = (
    await admin.query('SELECT count(*)::int n FROM principals WHERE account_id=$1', [
      target.account_id,
    ])
  ).rows[0].n;
  const result = await dashboard(owner.principal_id, 'account', target.account_id);
  expect(result.totals).toMatchObject({
    projects: 0,
    publications: 0,
    events: 0,
    aiRequests: 0,
    inputTokens: null,
    outputTokens: null,
  });
  expect(result.activity).toHaveLength(30);
  expect(
    result.activity.every(
      (d: { events: number; aiRequests: number }) => d.events === 0 && d.aiRequests === 0,
    ),
  ).toBe(true);
  expect(new Set(result.activity.map((d: { date: string }) => d.date)).size).toBe(30);
  expect(result.period.timeZone).toBe('UTC');
  expect(result.rating).toMatchObject({ kind: 'not_configured', value: null, rank: null });
  expect(result.coverage.limited).toBe(true);
  expect(
    (
      await admin.query('SELECT count(*)::int n FROM principals WHERE account_id=$1', [
        target.account_id,
      ])
    ).rows[0].n,
  ).toBe(before);
  await expect(dashboard(target.principal_id, 'account', owner.account_id)).rejects.toMatchObject({
    code: '42501',
  });
});
it('uses the retained draft save time and falls back to project creation before the first save', async () => {
  const owner = await aiIdentity(admin),
    target = await aiIdentity(admin);
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
    [owner.account_id],
  );
  const project = (
    await admin.query(
      "INSERT INTO projects(tenant_id,owner_principal_id,title,module_key,project_scope,status,created_at) VALUES($1,$2,'Saved dashboard project','electronics','personal','active',now()-interval '3 days') RETURNING id,created_at",
      [target.tenant_id, target.principal_id],
    )
  ).rows[0];
  const initial = await dashboard(owner.principal_id, 'account', target.account_id);
  expect(new Date(initial.lastActionAt).toISOString()).toBe(project.created_at.toISOString());
  const saved = (
    await admin.query(
      "INSERT INTO project_drafts(project_id,tenant_id,document_json,revision,updated_by_principal_id,updated_at) VALUES($1,$2,'{}',2,$3,now()-interval '1 day') RETURNING updated_at",
      [project.id, target.tenant_id, target.principal_id],
    )
  ).rows[0];
  const result = await dashboard(owner.principal_id, 'account', target.account_id);
  expect(result.totals.projects).toBe(1);
  expect(new Date(result.lastActionAt).toISOString()).toBe(saved.updated_at.toISOString());
  expect(result.latestActions[0].eventType).toBe('project.updated');
  expect(new Date(result.latestActions[0].occurredAt).toISOString()).toBe(
    saved.updated_at.toISOString(),
  );
});
it('isolates exact Seat facts from linked Accounts and other classes, and reuses the canonical classroom rating', async () => {
  const school = await aiClassFixture(admin, runtime),
    other = await aiClassFixture(admin, runtime),
    linked = await aiIdentity(admin);
  await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2', [
    linked.account_id,
    school.seatId,
  ]);
  await admin.query(
    "INSERT INTO product_analytics_events(actor_kind,principal_id,seat_id,tenant_id,event_type,outcome,occurred_at,persisted_at) SELECT 'student',$1,$2,$3,'visit.observed','succeeded',date_trunc('day',now())-interval '2 days',now() FROM generate_series(1,2)",
    [school.principalId, school.seatId, school.context.tenant_id],
  );
  await admin.query(
    "INSERT INTO product_analytics_events(actor_kind,account_id,principal_id,workspace_id,tenant_id,event_type,outcome,occurred_at,persisted_at) VALUES('account',$1,$2,$3,$4,'visit.observed','succeeded',now(),now())",
    [linked.account_id, linked.principal_id, linked.workspace_id, linked.tenant_id],
  );
  await admin.query(
    "INSERT INTO ai_usage_journal(owner_principal_id,request_id,seat_id,admitted_at,status,error_code,input_tokens,output_tokens) VALUES($1,$2,$3,now(),'failed','ai_provider_timeout',9007199254740991,10)",
    [school.principalId, randomUUID(), school.seatId],
  );
  const result = await dashboard(
    school.teacher.principal_id,
    'student',
    school.seatId,
    school.classroomId,
  );
  expect(result.totals).toMatchObject({
    events: 2,
    aiRequests: 1,
    aiErrors: 1,
    inputTokens: '9007199254740991',
    outputTokens: '10',
  });
  expect(result.activity.filter((d: { events: number }) => d.events !== 0)).toHaveLength(1);
  expect(result.activity.reduce((n: number, d: { events: number }) => n + d.events, 0)).toBe(2);
  expect(
    result.latestActions.some((a: { eventType: string }) => a.eventType === 'ai.request'),
  ).toBe(true);
  const canonical = (
    await admin.query(
      "SELECT item FROM classroom_participant_metrics($1) WHERE item->>'seatId'=$2",
      [school.classroomId, school.seatId],
    )
  ).rows[0]?.item;
  expect(result.rating).toMatchObject({
    kind: 'classroom',
    value: canonical?.score ?? null,
    rank: canonical?.rank ?? null,
  });
  for (const [actor, kind, target, classroom] of [
    [school.teacher.principal_id, 'student', other.seatId, school.classroomId],
    [other.teacher.principal_id, 'student', school.seatId, school.classroomId],
    [school.teacher.principal_id, 'account', linked.account_id, school.classroomId],
  ])
    await expect(dashboard(actor!, kind!, target!, classroom!)).rejects.toMatchObject({
      code: '42501',
    });
  await admin.query('DELETE FROM classroom_memberships WHERE classroom_id=$1 AND account_id=$2', [
    school.classroomId,
    school.teacher.account_id,
  ]);
  await expect(
    dashboard(school.teacher.principal_id, 'student', school.seatId, school.classroomId),
  ).rejects.toMatchObject({ code: '42501' });
});
