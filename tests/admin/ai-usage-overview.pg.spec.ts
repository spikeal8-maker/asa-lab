import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { AiUsageOverview } from '@asa-lab/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { AiUsageJournal } from '../../apps/api/src/ai-usage-journal';
import { buildTestApp, inject } from '../portal/app';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { lockAiPostgresSuite } from './ai-postgres-suite-lock';
import { aiClassFixture, aiIdentity, type AiIdentity } from './ai-student-access.contract';
import { aiTextFixture } from './ai-text-history.contract';

let admin: pg.Pool, runtime: pg.Pool, platform: AiIdentity;
let unlock: (() => Promise<void>) | undefined;
const fixtureOwners: string[] = [];

beforeAll(async () => {
  const urls = ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'].map((key) => {
    const value = process.env[key];
    if (!value) throw new Error(`${key} must explicitly target an isolated _test database`);
    const url = new URL(value);
    if (!decodeURIComponent(url.pathname).endsWith('_test'))
      throw new Error('Only isolated _test database allowed');
    return url;
  });
  if (urls[0]!.host !== urls[1]!.host || urls[0]!.pathname !== urls[1]!.pathname)
    throw new Error('Both roles must use the same isolated database');
  admin = testAdminPool();
  runtime = testAppPool();
  unlock = await lockAiPostgresSuite(admin);
  platform = await aiIdentity(admin);
  await admin.query(
    `INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by)
     VALUES($1,'platform_admin','verified','test','admin')`,
    [platform.account_id],
  );
}, 30000);

afterAll(async () => {
  try {
    if (fixtureOwners.length)
      await admin.query('DELETE FROM ai_usage_journal WHERE owner_principal_id=ANY($1::uuid[])', [
        fixtureOwners,
      ]);
    await runtime?.end();
  } finally {
    await unlock?.();
    await admin?.end();
  }
});

async function owner() {
  const value = await aiIdentity(admin);
  fixtureOwners.push(value.principal_id);
  return value;
}

async function record(
  identity: AiIdentity,
  at: string,
  input: string | null,
  output: string | null,
  options: { request?: string; status?: string; operation?: string } = {},
) {
  const request = options.request ?? randomUUID();
  await admin.query(
    `INSERT INTO ai_usage_journal(owner_principal_id,request_id,account_id,admitted_at,
       input_tokens,output_tokens,status,operation,requested_model)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'private-model-label')`,
    [
      identity.principal_id,
      request,
      identity.account_id,
      at,
      input,
      output,
      options.status ?? 'succeeded',
      options.operation ?? 'chat',
    ],
  );
  return request;
}

async function overview(at: string, actor = platform.principal_id): Promise<AiUsageOverview> {
  return (
    await runtime.query<{ overview: AiUsageOverview }>(
      'SELECT ai_usage_overview($1,$2::timestamptz) AS overview',
      [actor, at],
    )
  ).rows[0]!.overview;
}

async function session(identity: AiIdentity) {
  const token = randomUUID();
  await admin.query(
    `INSERT INTO sessions_v2(principal_id,active_workspace_id,token_hash,expires_at)
     VALUES($1,$2,$3,now()+interval '1 hour')`,
    [identity.principal_id, identity.workspace_id, hashSessionToken(token)],
  );
  return { asa_session: token };
}

it('agrees on all three metrics and seven UTC days, with inclusive start/exclusive cutoff and composite request identity', async () => {
  const a = await owner();
  const b = await owner();
  const request = randomUUID();
  await record(a, '2040-03-05T23:59:59.999999Z', '999', '999');
  await record(a, '2040-03-06T00:00:00Z', '10', '1');
  await record(a, '2040-03-07T23:59:59.999999Z', '20', '2');
  await record(a, '2040-03-08T00:30:00+03:00', '30', '3');
  await record(a, '2040-03-08T00:00:00Z', '40', '4', { request });
  await record(b, '2040-03-08T20:00:00Z', '50', '5', { request, operation: 'regeneration' });
  await record(a, '2040-03-10T20:00:00Z', null, null, { status: 'admitted' });
  await record(a, '2040-03-11T20:00:00Z', '0', '0');
  await record(a, '2040-03-12T12:34:56.123455Z', null, '7', { status: 'failed' });
  await record(a, '2040-03-12T12:34:56.123456Z', '999', '999');
  await record(a, '2040-03-12T12:34:56.123457Z', '999', '999');
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL timezone='America/New_York'");
    const value = (
      await client.query<{ overview: AiUsageOverview }>(
        'SELECT ai_usage_overview($1,$2) AS overview',
        [platform.principal_id, '2040-03-12T12:34:56.123456Z'],
      )
    ).rows[0]!.overview;
    expect(value).toEqual({
      schemaVersion: 1,
      period: {
        from: '2040-03-06T00:00:00.000000Z',
        to: '2040-03-12T12:34:56.123456Z',
        timeZone: 'UTC',
        days: 7,
      },
      generatedAt: '2040-03-12T12:34:56.123456Z',
      requests: 8,
      inputTokens: { known: '150', knownOperations: 6, unknownOperations: 2 },
      outputTokens: { known: '22', knownOperations: 7, unknownOperations: 1 },
      daily: [
        { date: '2040-03-06', requests: 1 },
        { date: '2040-03-07', requests: 2 },
        { date: '2040-03-08', requests: 2 },
        { date: '2040-03-09', requests: 0 },
        { date: '2040-03-10', requests: 1 },
        { date: '2040-03-11', requests: 1 },
        { date: '2040-03-12', requests: 1 },
      ],
      state: 'partial',
    });
    expect(JSON.stringify(value)).not.toMatch(
      new RegExp(
        [a.principal_id, a.account_id, b.principal_id, request, 'private-model'].join('|'),
      ),
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

it('distinguishes an empty period, unknown token usage, known zero and exact totals above Number.MAX_SAFE_INTEGER', async () => {
  const empty = await overview('2035-01-07T12:00:00Z');
  expect(empty).toMatchObject({
    state: 'empty',
    requests: 0,
    inputTokens: { known: '0', knownOperations: 0, unknownOperations: 0 },
    outputTokens: { known: '0', knownOperations: 0, unknownOperations: 0 },
  });
  expect(empty.daily).toHaveLength(7);
  expect(empty.daily.map((day) => day.requests)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  const a = await owner();
  await record(a, '2041-01-07T01:00:00Z', null, null, { status: 'running' });
  expect(await overview('2041-01-07T12:00:00Z')).toMatchObject({
    state: 'partial',
    requests: 1,
    inputTokens: { known: null, knownOperations: 0, unknownOperations: 1 },
    outputTokens: { known: null, knownOperations: 0, unknownOperations: 1 },
  });
  await record(a, '2042-01-07T01:00:00Z', '0', '0');
  expect(await overview('2042-01-07T12:00:00Z')).toMatchObject({
    state: 'complete',
    requests: 1,
    inputTokens: { known: '0', knownOperations: 1, unknownOperations: 0 },
    outputTokens: { known: '0', knownOperations: 1, unknownOperations: 0 },
  });
  await record(a, '2043-01-07T01:00:00Z', '9007199254740991', '9007199254740991');
  await record(a, '2043-01-07T02:00:00Z', '9007199254740991', '9007199254740991');
  expect(await overview('2043-01-07T12:00:00Z')).toMatchObject({
    state: 'complete',
    requests: 2,
    inputTokens: { known: '18014398509481982', knownOperations: 2, unknownOperations: 0 },
    outputTokens: { known: '18014398509481982', knownOperations: 2, unknownOperations: 0 },
  });
});

it('never counts a replay or reread of a saved response as a second request', async () => {
  const f = await aiTextFixture(admin, runtime);
  fixtureOwners.push(f.owner.principal_id);
  const journal = new AiUsageJournal(runtime);
  const request = randomUUID();
  const before = await journal.overview(platform.principal_id);
  await f.service.send(f.owner.principal_id, f.thread.id, 'Private fixture question', request);
  const after = await journal.overview(platform.principal_id);
  expect(after.requests).toBe(before.requests + 1);
  expect(
    (await f.service.send(f.owner.principal_id, f.thread.id, 'Private fixture question', request))
      .replayed,
  ).toBe(true);
  await f.service.requestMessages(f.owner.principal_id, f.thread.id, request);
  await f.service.messages(f.owner.principal_id, f.thread.id);
  const replayed = await journal.overview(platform.principal_id);
  expect(replayed.requests).toBe(after.requests);
  expect(replayed.inputTokens).toEqual(after.inputTokens);
  expect(replayed.outputTokens).toEqual(after.outputTokens);
  expect(replayed.daily).toEqual(after.daily);
  expect(f.upstream).toHaveBeenCalledOnce();
});

it('checks SQL grants and denies ordinary Accounts, StudentSeats and revoked administrators without granting journal access', async () => {
  const ordinary = await owner();
  const school = await aiClassFixture(admin, runtime);
  await expect(overview('2040-03-12T12:34:56Z', ordinary.principal_id)).rejects.toMatchObject({
    code: '42501',
  });
  await expect(overview('2040-03-12T12:34:56Z', school.principalId)).rejects.toMatchObject({
    code: '42501',
  });
  await expect(runtime.query('SELECT * FROM ai_usage_journal')).rejects.toMatchObject({
    code: '42501',
  });
  const security = (
    await admin.query(`SELECT p.prosecdef,p.proconfig,
      has_table_privilege('asalab_app','public.ai_usage_journal','SELECT') AS can_read
      FROM pg_proc p WHERE p.oid='public.ai_usage_overview(uuid,timestamptz)'::regprocedure`)
  ).rows[0];
  expect(security).toMatchObject({ prosecdef: true, can_read: false });
  expect(security.proconfig).toContain('search_path=pg_catalog, pg_temp');
  const revoke = await owner();
  await admin.query(
    `INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by)
     VALUES($1,'platform_admin','verified','test','admin')`,
    [revoke.account_id],
  );
  expect(await overview('2040-03-12T12:34:56Z', revoke.principal_id)).toMatchObject({
    schemaVersion: 1,
    period: { timeZone: 'UTC', days: 7 },
  });
  await admin.query("UPDATE capability_grants SET state='revoked' WHERE account_id=$1", [
    revoke.account_id,
  ]);
  await expect(overview('2040-03-12T12:34:56Z', revoke.principal_id)).rejects.toMatchObject({
    code: '42501',
  });
});

it('serves only a real administrative HTTP session and reports PostgreSQL read failure as 503 instead of empty success', async () => {
  const ordinary = await owner();
  const school = await aiClassFixture(admin, runtime);
  const studentToken = randomUUID();
  await runtime.query('SELECT * FROM classroom_seat_credential_issue($1,$2,$3,$4,$5)', [
    school.teacher.account_id,
    school.classroomId,
    school.seatId,
    hashSessionToken(randomUUID()),
    randomUUID(),
  ]);
  await admin.query(
    `INSERT INTO classroom_student_sessions(seat_id,token_hash,expires_at,credential_version)
     VALUES($1,$2,now()+interval '1 hour',1)`,
    [school.seatId, hashSessionToken(studentToken)],
  );
  const adminCookies = await session(platform);
  const ordinaryCookies = await session(ordinary);
  const app = await buildTestApp(testAppPool());
  const url = '/api/admin/v1/ai/usage-overview';
  const headers = { host: '127.0.0.1:4610' };
  try {
    expect((await inject(app, { method: 'GET', url, headers })).statusCode).toBe(401);
    const denied = await inject(app, { method: 'GET', url, headers, cookies: ordinaryCookies });
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'ai_admin_denied' } });
    const seat = await inject(app, {
      method: 'GET',
      url,
      headers,
      cookies: { asa_student_session: studentToken },
    });
    expect(seat.statusCode, seat.body).toBe(401);
    expect(seat.json()).toMatchObject({ error: { code: 'unauthorized' } });
    expect(seat.body).not.toContain('inputTokens');
    const success = await inject(app, { method: 'GET', url, headers, cookies: adminCookies });
    expect(success.statusCode, success.body).toBe(200);
    expect(success.headers['cache-control']).toBe('private, no-store');
    const value = success.json<AiUsageOverview>();
    expect(value.daily).toHaveLength(7);
    expect(value.daily.reduce((sum, day) => sum + day.requests, 0)).toBe(value.requests);
    expect(value.period.timeZone).toBe('UTC');
    expect(value.generatedAt).toBe(value.period.to);
    // This fault is confined to the explicitly isolated, suite-locked database.
    // A genuine undefined-function failure exercises the real API pool and SQL
    // boundary, while the original function and privileges are restored below.
    await admin.query(
      'ALTER FUNCTION ai_usage_overview(uuid,timestamptz) RENAME TO ai_usage_overview_fixture_unavailable',
    );
    try {
      const failed = await inject(app, { method: 'GET', url, headers, cookies: adminCookies });
      expect(failed.statusCode, failed.body).toBe(503);
      expect(failed.json()).toEqual({
        error: {
          code: 'ai_usage_unavailable',
          message: 'Не удалось загрузить данные использования ИИ.',
        },
      });
      expect(failed.body).not.toMatch(/SELECT|postgres|fixture_unavailable|inputTokens/);
    } finally {
      await admin.query(
        'ALTER FUNCTION ai_usage_overview_fixture_unavailable(uuid,timestamptz) RENAME TO ai_usage_overview',
      );
    }
    expect(
      (await inject(app, { method: 'GET', url, headers, cookies: adminCookies })).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
  }
});
