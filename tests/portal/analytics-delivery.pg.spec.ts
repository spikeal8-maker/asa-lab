import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp, analyticsPoolSettings } from '../../apps/api/dist/app.factory.js';
import { inject, type NestApp } from './app';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';

type Actor = {
  kind: 'account' | 'student';
  accountId: string | null;
  principalId: string;
  seatId: string | null;
  workspaceId: string | null;
  classId: string | null;
};
let admin: pg.Pool;
let runtime: pg.Pool;
let analyticsPool: pg.Pool;
let app: NestApp;
let owner: Actor;
let foreign: Actor;
let cookie: string;
let foreignCookie: string;
let classId: string;
let code: string;
const metadata = {
  address: '203.0.113.10',
  networkKind: 'public',
  browser: 'Firefox',
  major: 130,
  os: 'Linux',
  device: 'desktop',
};
const at = (seconds: number) => new Date(Date.now() - 120_000 + seconds * 1000).toISOString();
const visit = (time: string) => ({
  outcome: 'succeeded',
  visitId: randomUUID(),
  clientOccurredAt: time,
  entryRoute: 'home',
  referrerOrigin: 'https://school.test',
});
const quality = (streamId: string, sequence: number, attempted: number) => ({
  pipeline: 'product-analytics',
  streamId,
  sequence,
  streamStartedAt: '2026-10-09T10:00:00Z',
  clientObservedAt: at(sequence),
  acknowledgementStage: 'persisted',
  counters: {
    attempted,
    enqueued: 0,
    acknowledged: 0,
    retried: 0,
    expired: 0,
    evicted: 0,
    permanentRejected: 0,
    invalidStored: 0,
    invalidEnvelope: 0,
    deduplicated: 0,
    suppressed: 0,
    coalesced: 0,
    storageUnavailable: 0,
  },
  gauges: { pending: 0, inFlight: 0 },
  coverage: {
    persistenceUnavailable: false,
    uncleanEnd: false,
    final: false,
    counterSaturated: false,
  },
});
async function ingest(
  actor: Actor,
  eventId: string,
  operation: string,
  semantic: object,
  receivedAt = at(0),
  observed = metadata,
) {
  const result = await runtime.query(
    'SELECT analytics_ingest_v2($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::timestamptz) AS receipt',
    [
      eventId,
      actor.kind,
      actor.accountId,
      actor.principalId,
      actor.seatId,
      actor.workspaceId,
      actor.classId,
      operation,
      JSON.stringify(semantic),
      JSON.stringify(observed),
      receivedAt,
    ],
  );
  return result.rows[0].receipt;
}
async function teacher(label: string) {
  const seeded = await seedTeacher(admin, `analytics-${label}-${randomUUID().slice(0, 8)}`);
  const identity = (
    await admin.query(
      'SELECT l.account_id,l.principal_id,w.id workspace_id FROM legacy_user_account_links l JOIN workspaces w ON w.tenant_id=l.tenant_id WHERE l.user_id=$1',
      [seeded.teacherId],
    )
  ).rows[0];
  const signed = await inject(app, {
    method: 'POST',
    url: '/api/auth/login',
    payload: { workspace: seeded.workspace, email: seeded.email, password: seeded.password },
  });
  expect(signed.statusCode, signed.body).toBe(200);
  return {
    actor: {
      kind: 'account',
      accountId: identity.account_id,
      principalId: identity.principal_id,
      workspaceId: identity.workspace_id,
      seatId: null,
      classId: null,
    } as Actor,
    cookie: `asa_session=${signed.cookies.find((c) => c.name === 'asa_session')!.value}`,
  };
}
async function makeSeat(materialize: boolean, targetClass = classId) {
  const result = await inject(app, {
    method: 'POST',
    url: `/api/classrooms/${targetClass}/seats`,
    headers: { cookie },
    payload: { displayLabel: 'Receipt fixture', safeMode: true },
  });
  expect(result.statusCode, result.body).toBe(201);
  const seatId = result.json().student.id as string;
  const principal = materialize
    ? ((await runtime.query('SELECT principal_id FROM student_seat_principal($1)', [seatId]))
        .rows[0].principal_id as string)
    : null;
  return { seatId, principal, studentCode: result.json().student.studentCode as string };
}
async function project(asCookie = cookie) {
  const result = await inject(app, {
    method: 'POST',
    url: '/api/projects',
    headers: { cookie: asCookie, 'idempotency-key': randomUUID() },
    payload: { module: 'blocks', scope: 'personal', title: 'Receipt fixture' },
  });
  expect(result.statusCode, result.body).toBe(201);
  return result.json().project.id as string;
}
beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  // The helper validates both URL names and their database identity before use.
  analyticsPool = new pg.Pool({
    connectionString: process.env['APP_TEST_DATABASE_URL'],
    ...analyticsPoolSettings(),
  });
  app = await createApiApp({ pool: runtime, analyticsPool, webDist: null });
  ({ actor: owner, cookie } = await teacher('owner'));
  ({ actor: foreign, cookie: foreignCookie } = await teacher('foreign'));
  const created = await inject(app, {
    method: 'POST',
    url: '/api/classrooms',
    headers: { cookie, 'idempotency-key': randomUUID() },
    payload: { title: 'Delivery fixtures' },
  });
  expect(created.statusCode, created.body).toBe(201);
  classId = created.json().classroom.id;
  const info = await inject(app, {
    method: 'GET',
    url: `/api/classrooms/${classId}`,
    headers: { cookie },
  });
  code = info.json().classroom.joinCode;
}, 30_000);
afterAll(async () => {
  if (app) await app.close();
  else {
    await analyticsPool?.end();
    await runtime?.end();
  }
  await admin?.end();
});

describe('real PostgreSQL observability delivery receipts', () => {
  it('stores one global receipt under concurrent lost-ACK retries and preserves first provenance', async () => {
    const eventId = randomUUID();
    const received = at(0);
    const semantic = visit(received);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ingest(owner, eventId, 'visit.observed', semantic, received)),
    );
    expect(results.every((r) => JSON.stringify(r) === JSON.stringify(results[0]))).toBe(true);
    const retry = await ingest(owner, eventId, 'visit.observed', semantic, at(60), {
      ...metadata,
      address: '203.0.113.99',
      browser: 'Chrome',
    });
    expect(retry).toEqual(results[0]);
    const saved = (
      await admin.query(
        'SELECT ip_address::text,user_agent_summary,receipt_event_id,received_at,client_occurred_at,browser_family FROM product_analytics_events WHERE receipt_event_id=$1',
        [eventId],
      )
    ).rows;
    expect(saved).toHaveLength(1);
    expect(saved[0].ip_address).toBe('203.0.113.10/32');
    expect(saved[0].user_agent_summary).toBeNull();
    expect(saved[0].browser_family).toBe('Firefox');
    expect(saved[0].received_at.toISOString()).toBe(new Date(received).toISOString());
    await expect(
      ingest(owner, eventId, 'visit.observed', { ...semantic, entryRoute: 'projects' }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(ingest(foreign, eventId, 'visit.observed', semantic)).rejects.toMatchObject({
      code: '23505',
    });
    await expect(
      ingest(owner, eventId, 'quality', quality(randomUUID(), 1, 1)),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rolls back receipt and domain together and serializes independent PostgreSQL clients', async () => {
    const left = await runtime.connect();
    const right = await runtime.connect();
    const eventId = randomUUID();
    const received = at(0);
    const semantic = visit(received);
    const sql =
      'SELECT analytics_ingest_v2($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::timestamptz) receipt';
    const args = [
      eventId,
      owner.kind,
      owner.accountId,
      owner.principalId,
      null,
      owner.workspaceId,
      null,
      'visit.observed',
      JSON.stringify(semantic),
      JSON.stringify(metadata),
      received,
    ];
    try {
      await left.query('BEGIN');
      await left.query(sql, args);
      await left.query('ROLLBACK');
      expect(
        (
          await admin.query('SELECT event_id FROM analytics_operation_receipts WHERE event_id=$1', [
            eventId,
          ])
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await admin.query('SELECT id FROM product_analytics_events WHERE receipt_event_id=$1', [
            eventId,
          ])
        ).rows,
      ).toHaveLength(0);
      await left.query('BEGIN');
      const first = (await left.query(sql, args)).rows[0].receipt;
      const leftPid = (await left.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      const rightPid = (await right.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      const competing = right.query(sql, args);
      let blocked = false;
      for (let i = 0; i < 30; i += 1) {
        if (
          (
            await admin.query('SELECT $2::int=ANY(pg_blocking_pids($1)) blocked', [
              rightPid,
              leftPid,
            ])
          ).rows[0].blocked
        ) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await left.query('COMMIT');
      expect((await competing).rows[0].receipt).toEqual(first);
      expect(
        (
          await admin.query('SELECT id FROM product_analytics_events WHERE receipt_event_id=$1', [
            eventId,
          ])
        ).rows,
      ).toHaveLength(1);
    } finally {
      await left.query('ROLLBACK');
      left.release();
      right.release();
    }
  });

  it('has one canonical module open per session and replays touches/starts after close without revival', async () => {
    const projectId = await project();
    const sessionId = randomUUID();
    const visitId = randomUUID();
    const startId = randomUUID();
    const startAt = at(0);
    const start = { sessionId, visitId, clientOccurredAt: startAt, projectId, moduleKey: 'blocks' };
    const first = await ingest(owner, startId, 'start', start, startAt);
    await Promise.all([
      ingest(owner, randomUUID(), 'start', start, at(2)),
      ingest(owner, randomUUID(), 'start', start, at(3)),
    ]);
    const touchId = randomUUID();
    const touch = { sessionId, visitId, clientOccurredAt: at(30) };
    const credited = await ingest(owner, touchId, 'touch', touch, touch.clientOccurredAt);
    expect(credited.result.creditedSeconds).toBeGreaterThanOrEqual(29);
    const close = { sessionId, visitId, clientOccurredAt: at(40) };
    await ingest(owner, randomUUID(), 'close', close, close.clientOccurredAt);
    expect(
      await ingest(owner, touchId, 'touch', touch, at(50), {
        ...metadata,
        address: '203.0.113.99',
      }),
    ).toEqual(credited);
    expect(await ingest(owner, startId, 'start', start, at(60))).toEqual(first);
    const row = (
      await admin.query(
        "SELECT ended_at,(SELECT count(*) FROM product_analytics_events e WHERE e.flow_id=s.id AND e.event_type='module.opened') opens,(SELECT sum(active_seconds) FROM product_module_activity_slices x WHERE x.session_id=s.id) seconds FROM product_module_sessions s WHERE id=$1",
        [sessionId],
      )
    ).rows[0];
    expect(row.ended_at).not.toBeNull();
    expect(Number(row.opens)).toBe(1);
    expect(Number(row.seconds)).toBeLessThanOrEqual(41);
    await expect(
      ingest(foreign, randomUUID(), 'start', { ...start, sessionId: randomUUID() }),
    ).rejects.toMatchObject({ code: '42501' });
    await admin.query("UPDATE projects SET status='trashed' WHERE id=$1", [projectId]);
    await expect(ingest(owner, startId, 'start', start)).rejects.toMatchObject({ code: '42501' });
  });

  it('does not credit stale offline heartbeats or future client clocks as fresh activity', async () => {
    const projectId = await project();
    const sessionId = randomUUID();
    const visitId = randomUUID();
    await ingest(
      owner,
      randomUUID(),
      'start',
      { sessionId, visitId, projectId, moduleKey: 'blocks', clientOccurredAt: at(0) },
      at(0),
    );
    const stale = await ingest(
      owner,
      randomUUID(),
      'touch',
      { sessionId, visitId, clientOccurredAt: '2020-01-01T00:00:00Z' },
      at(60),
    );
    expect(stale.result).toMatchObject({
      creditedSeconds: 0,
      creditedFrom: null,
      creditedTo: null,
    });
    const future = visit('2099-01-01T00:00:00Z');
    const eventId = randomUUID();
    await ingest(owner, eventId, 'visit.observed', future);
    expect(
      (
        await admin.query(
          'SELECT client_occurred_at FROM product_analytics_events WHERE receipt_event_id=$1',
          [eventId],
        )
      ).rows[0].client_occurred_at,
    ).toBeNull();
  });

  it('partitions the same Account observations by actual workspace and denies same-tenant foreign Seat projects', async () => {
    const tenantId = (
      await admin.query('SELECT tenant_id FROM workspaces WHERE id=$1', [owner.workspaceId])
    ).rows[0].tenant_id;
    const secondWorkspace = (
      await admin.query(
        "INSERT INTO workspaces(tenant_id,kind,title) VALUES($1,'organization','Second actual workspace') RETURNING id",
        [tenantId],
      )
    ).rows[0].id;
    await admin.query(
      "INSERT INTO workspace_memberships(account_id,workspace_id,role) VALUES($1,$2,'educator')",
      [owner.accountId, secondWorkspace],
    );
    const otherScope = { ...owner, workspaceId: secondWorkspace };
    const time = at(0);
    const observed = { outcome: 'succeeded' };
    const firstId = randomUUID();
    const first = await ingest(owner, firstId, 'session.observed', observed, time);
    const again = await ingest(owner, randomUUID(), 'session.observed', observed, at(5));
    const second = await ingest(otherScope, randomUUID(), 'session.observed', observed, time);
    expect(again.recordId).toBe(first.recordId);
    expect(second.recordId).not.toBe(first.recordId);
    await expect(
      ingest(otherScope, firstId, 'session.observed', observed, time),
    ).rejects.toMatchObject({ code: '23505' });
    const newClass = await inject(app, {
      method: 'POST',
      url: '/api/classrooms',
      headers: { cookie, 'idempotency-key': randomUUID() },
      payload: { title: 'Same tenant other class' },
    });
    expect(newClass.statusCode, newClass.body).toBe(201);
    const secondClass = newClass.json().classroom.id as string;
    const left = await makeSeat(true);
    const right = await makeSeat(true, secondClass);
    const actorA: Actor = {
      kind: 'student',
      accountId: null,
      principalId: left.principal!,
      seatId: left.seatId,
      workspaceId: null,
      classId,
    };
    const actorB: Actor = {
      kind: 'student',
      accountId: null,
      principalId: right.principal!,
      seatId: right.seatId,
      workspaceId: null,
      classId: secondClass,
    };
    const projectId = (
      await admin.query(
        "INSERT INTO projects(tenant_id,project_scope,module_key,title,owner_principal_id) VALUES($1,'personal','blocks','Seat A',$2) RETURNING id",
        [tenantId, left.principal],
      )
    ).rows[0].id;
    const semantic = {
      sessionId: randomUUID(),
      visitId: randomUUID(),
      projectId,
      moduleKey: 'blocks',
      clientOccurredAt: time,
    };
    const eventId = randomUUID();
    await ingest(actorA, eventId, 'start', semantic, time);
    await expect(
      ingest(actorB, randomUUID(), 'start', { ...semantic, sessionId: randomUUID() }, time),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(ingest(actorB, eventId, 'start', semantic, time)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      ingest(
        { ...actorA, classId: secondClass },
        randomUUID(),
        'quality',
        quality(randomUUID(), 1, 0),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('binds quality stream sequence to its original UUID and replays an older exact snapshot after a newer one', async () => {
    const stream = randomUUID();
    const id1 = randomUUID();
    const q1 = quality(stream, 1, 10);
    const first = await ingest(owner, id1, 'quality', q1);
    await ingest(owner, randomUUID(), 'quality', quality(stream, 2, 12));
    expect(await ingest(owner, id1, 'quality', q1, at(60))).toEqual(first);
    await expect(ingest(owner, randomUUID(), 'quality', q1)).rejects.toMatchObject({
      code: '23505',
    });
    await expect(
      ingest(owner, randomUUID(), 'quality', quality(stream, 3, 11)),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      ingest(foreign, randomUUID(), 'quality', quality(stream, 3, 13)),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      ingest(owner, randomUUID(), 'quality', {
        ...quality(randomUUID(), 1, 0),
        streamStartedAt: null,
      }),
    ).rejects.toMatchObject({ code: '22023' });
    expect(
      Number(
        (
          await admin.query('SELECT count(*) FROM analytics_quality_snapshots WHERE stream_id=$1', [
            stream,
          ])
        ).rows[0].count,
      ),
    ).toBe(2);
  });

  it('retains first/last event-time chronology and counts one admission UUID despite reverse persistence and suspension', async () => {
    const seat = await makeSeat(true);
    await admin.query("UPDATE classroom_student_seats SET status='suspended' WHERE id=$1", [
      seat.seatId,
    ]);
    // Moscow midnight separates these deterministic ten-minute buckets.
    const early = '2026-10-09T20:59:30Z';
    const late = '2026-10-09T21:00:30Z';
    const later = '2026-10-09T21:04:00Z';
    const admit = async (id: string, authId: string, time: string) =>
      (
        await runtime.query(
          'SELECT analytics_record_admission_v2($1,$2,$3,$4,true,$5::jsonb,$6::timestamptz) receipt',
          [id, authId, seat.seatId, classId, JSON.stringify(metadata), time],
        )
      ).rows[0].receipt;
    const eventId = randomUUID();
    const authId = randomUUID();
    const first = await admit(eventId, authId, later);
    await admit(randomUUID(), randomUUID(), late);
    await admit(randomUUID(), randomUUID(), early);
    expect(await admit(eventId, authId, later)).toEqual(first);
    await expect(admit(eventId, randomUUID(), later)).rejects.toMatchObject({ code: '23505' });
    const rows = (
      await admin.query(
        'SELECT occurrence_count,first_occurred_at,occurred_at FROM classroom_activity_events WHERE seat_id=$1 AND async_admission_bucket_at IS NOT NULL ORDER BY occurred_at',
        [seat.seatId],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.occurrence_count)).toEqual([1, 2]);
    expect(rows[1].first_occurred_at.toISOString()).toBe(new Date(late).toISOString());
    expect(rows[1].occurred_at.toISOString()).toBe(new Date(later).toISOString());
    const noPrincipal = await makeSeat(false);
    await admin.query("UPDATE classroom_student_seats SET status='suspended' WHERE id=$1", [
      noPrincipal.seatId,
    ]);
    await expect(
      runtime.query(
        'SELECT analytics_record_admission_v2($1,$2,$3,$4,true,$5::jsonb,$6::timestamptz)',
        [randomUUID(), randomUUID(), noPrincipal.seatId, classId, JSON.stringify(metadata), late],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      (await admin.query('SELECT id FROM principals WHERE seat_id=$1', [noPrincipal.seatId])).rows,
    ).toHaveLength(0);
  });

  it('keeps protected tables unreadable and preserves additive legacy signatures', async () => {
    for (const table of [
      'analytics_operation_receipts',
      'analytics_quality_streams',
      'analytics_quality_snapshots',
    ]) {
      await expect(runtime.query(`SELECT * FROM ${table}`)).rejects.toMatchObject({
        code: '42501',
      });
      const flags = (
        await admin.query(
          'SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',
          [`public.${table}`],
        )
      ).rows[0];
      expect(flags).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    }
    const signatures = (
      await admin.query(
        "SELECT to_regprocedure('public.analytics_record_event(character varying,uuid,uuid,uuid,uuid,character varying,character varying,character varying,character varying,uuid,inet,character varying)') old_event,to_regprocedure('public.classroom_activity_record(uuid,uuid,uuid,uuid,character varying,uuid,character varying,interval)') old_academic",
      )
    ).rows[0];
    expect(signatures.old_event).not.toBeNull();
    expect(signatures.old_academic).not.toBeNull();
    const legacy = await runtime.query(
      'SELECT analytics_record_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::inet,$12)',
      [
        'account',
        owner.accountId,
        owner.principalId,
        null,
        owner.workspaceId,
        'auth.login',
        'succeeded',
        'password',
        null,
        randomUUID(),
        '203.0.113.10',
        'legacy normalized',
      ],
    );
    expect(Number(legacy.rows[0].analytics_record_event)).toBeGreaterThan(0);
  });

  it('cancels a real telemetry row lock while auth and product reads remain responsive', async () => {
    const projectId = await project();
    const sessionId = randomUUID();
    const visitId = randomUUID();
    await ingest(
      owner,
      randomUUID(),
      'start',
      { sessionId, visitId, projectId, moduleKey: 'blocks', clientOccurredAt: at(0) },
      at(0),
    );
    const freshSeat = await makeSeat(false);
    const blocker = await admin.connect();
    const pid = (await analyticsPool.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    const eventId = randomUUID();
    const clientOccurredAt = at(30);
    const payload = {
      schemaVersion: 2,
      eventId,
      actorExpectation: {
        kind: 'account',
        accountId: owner.accountId,
        workspaceId: owner.workspaceId,
      },
      operation: 'touch',
      sessionId,
      visitId,
      clientOccurredAt,
    };
    const send = () =>
      inject(app, {
        method: 'POST',
        url: '/api/analytics/v2/module-session',
        headers: { cookie },
        payload,
      });
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM product_module_sessions WHERE id=$1 FOR UPDATE', [
        sessionId,
      ]);
      const blocked = send();
      let observed = false;
      for (let i = 0; i < 30; i += 1) {
        const state = (await admin.query('SELECT cardinality(pg_blocking_pids($1)) n', [pid]))
          .rows[0];
        if (Number(state.n) > 0) {
          observed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(observed).toBe(true);
      const started = performance.now();
      const me = await inject(app, { method: 'GET', url: '/api/auth/me', headers: { cookie } });
      const read = await inject(app, {
        method: 'GET',
        url: `/api/projects/${projectId}`,
        headers: { cookie },
      });
      const signed = await inject(app, {
        method: 'POST',
        url: '/api/class-join/studentseat',
        payload: { code, studentCode: freshSeat.studentCode },
      });
      expect(signed.statusCode, signed.body).toBe(200);
      expect(me.statusCode, me.body).toBe(200);
      expect(read.statusCode, read.body).toBe(200);
      expect(performance.now() - started).toBeLessThan(900);
      const timeout = await blocked;
      expect(timeout.statusCode, timeout.body).toBe(503);
      expect(analyticsPool.waitingCount).toBe(0);
      expect(
        (
          await admin.query('SELECT event_id FROM analytics_operation_receipts WHERE event_id=$1', [
            eventId,
          ])
        ).rows,
      ).toHaveLength(0);
      await blocker.query('ROLLBACK');
      const retry = await send();
      expect(retry.statusCode, retry.body).toBe(200);
      expect(
        (
          await admin.query('SELECT event_id FROM analytics_operation_receipts WHERE event_id=$1', [
            eventId,
          ])
        ).rows,
      ).toHaveLength(1);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
  }, 15_000);

  it('fresh browser cookies reject revoked auth and foreign project retries before receipt lookup', async () => {
    const time = new Date().toISOString();
    const eventId = randomUUID();
    const observed = visit(time);
    const fields = {
      visitId: observed.visitId,
      clientOccurredAt: observed.clientOccurredAt,
      entryRoute: observed.entryRoute,
      referrerOrigin: observed.referrerOrigin,
    };
    const body = {
      schemaVersion: 2,
      eventId,
      eventType: 'visit.observed',
      actorExpectation: {
        kind: 'account',
        accountId: owner.accountId,
        workspaceId: owner.workspaceId,
      },
      ...fields,
    };
    const send = (asCookie: string) =>
      inject(app, {
        method: 'POST',
        url: '/api/analytics/v2/events',
        headers: { cookie: asCookie },
        payload: body,
      });
    const first = await send(cookie);
    expect(first.statusCode, first.body).toBe(200);
    expect((await send(foreignCookie)).statusCode).toBe(409);
    expect((await send('asa_session=revoked-or-missing')).statusCode).toBe(401);
    const bad = await inject(app, {
      method: 'POST',
      url: '/api/analytics/v2/events',
      headers: { cookie },
      payload: { ...body, eventType: 'module.opened', moduleKey: 'blocks' },
    });
    expect(bad.statusCode).toBe(400);
    expect(code).toMatch(/\S/);
  });
});
