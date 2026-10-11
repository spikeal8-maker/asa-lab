import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';
import { buildTestApp, inject, type NestApp } from './app';

// Real authentication/API/draft persistence and PostgreSQL evidence. Clock
// fixtures only replace waiting for activity intervals; this is not VM E2E.
let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;
beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  app = await buildTestApp(runtime);
}, 30_000);
afterAll(async () => {
  await app?.close();
  await Promise.all([admin?.end(), runtime?.end()]);
});
type Metric = {
  seatId: string;
  score: number | null;
  sources: { time: number; days: number };
  factors: { time: number };
};

async function fixture() {
  const teacher = await seedTeacher(admin, `scratch-time-${randomUUID().slice(0, 8)}`);
  const identity = (
    await admin.query(
      'SELECT account_id,principal_id FROM legacy_user_account_links WHERE user_id=$1',
      [teacher.teacherId],
    )
  ).rows[0];
  const login = await inject(app, {
    method: 'POST',
    url: '/api/auth/login',
    payload: { workspace: teacher.workspace, email: teacher.email, password: teacher.password },
  });
  expect(login.statusCode, login.body).toBe(200);
  const cookie = `asa_session=${login.cookies.find((c) => c.name === 'asa_session')!.value}`;
  const created = await inject(app, {
    method: 'POST',
    url: '/api/classrooms',
    headers: { cookie, 'idempotency-key': randomUUID() },
    payload: { title: 'Scratch time' },
  });
  expect(created.statusCode, created.body).toBe(201);
  const classId = created.json().classroom.id as string;
  const classInfo = await inject(app, {
    method: 'GET',
    url: `/api/classrooms/${classId}`,
    headers: { cookie },
  });
  const code = classInfo.json().classroom.joinCode as string;
  async function seat(label: string, accountId: string | null = null) {
    const response = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classId}/seats`,
      headers: { cookie },
      payload: { displayLabel: label, safeMode: true },
    });
    expect(response.statusCode, response.body).toBe(201);
    const student = response.json().student as { id: string; studentCode: string };
    // Seed the canonical Account link before identity materialization, as in
    // the existing participant PG fixture. No name/old ownership inference.
    if (accountId) {
      await admin.query(
        "UPDATE classroom_student_seats SET status='active',account_id=$2 WHERE id=$1",
        [student.id, accountId],
      );
      await runtime.query('SELECT classroom_participant_prepare($1,$2::uuid[])', [
        identity.principal_id,
        [classId],
      ]);
      return { id: student.id, cookie };
    }
    const signed = await inject(app, {
      method: 'POST',
      url: '/api/class-join/studentseat',
      payload: { code, studentCode: student.studentCode },
    });
    expect(signed.statusCode, signed.body).toBe(200);
    await runtime.query('SELECT classroom_participant_prepare($1,$2::uuid[])', [
      identity.principal_id,
      [classId],
    ]);
    return {
      id: student.id,
      cookie: `asa_student_session=${signed.cookies.find((c) => c.name === 'asa_student_session')!.value}`,
    };
  }
  async function project(asCookie: string) {
    const result = await inject(app, {
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: asCookie, 'idempotency-key': randomUUID() },
      payload: { module: 'blocks', scope: 'personal', title: 'Scratch' },
    });
    expect(result.statusCode, result.body).toBe(201);
    return result.json().project.id as string;
  }
  async function post(path: string, payload: unknown, asCookie = cookie) {
    return inject(app, { method: 'POST', url: path, headers: { cookie: asCookie }, payload });
  }
  async function start(
    projectId: string,
    asCookie: string,
    moduleKey = 'blocks',
    sessionId = randomUUID(),
  ) {
    const result = await post(
      '/api/analytics/v1/module-session/start',
      { projectId, moduleKey, sessionId },
      asCookie,
    );
    expect(result.statusCode, result.body).toBe(202);
    return { sessionId, accepted: result.json().accepted as boolean };
  }
  async function roster() {
    return (
      await runtime.query('SELECT classroom_participant_roster($1,$2) data', [
        identity.principal_id,
        classId,
      ])
    ).rows[0].data as { items: Metric[]; settings: { revision: number } };
  }
  async function settings(enabled: string[]) {
    const current = await roster();
    const result = await runtime.query(
      'SELECT classroom_participant_write($1,$2,$3,$4::jsonb) data',
      [
        identity.principal_id,
        classId,
        'settings',
        JSON.stringify({
          requestId: randomUUID(),
          expectedRevision: current.settings.revision,
          periodDays: 30,
          factors: Object.fromEntries(
            ['projects', 'logins', 'days', 'time', 'grades'].map((k) => [k, enabled.includes(k)]),
          ),
        }),
      ],
    );
    expect(result.rows[0].data).not.toBeNull();
  }
  return { teacher, identity, cookie, classId, seat, project, post, start, roster, settings };
}

describe('Scratch classroom time over real ProductAnalytics API and PostgreSQL', () => {
  it('records Account and Seat sessions; real draft edits qualify slices and enabled time drives score', async () => {
    const f = await fixture();
    const accountSeat = await f.seat('Account learner', f.identity.account_id);
    const seat = await f.seat('Seat learner');
    await f.settings(['time']);
    for (const learner of [{ ...accountSeat, cookie: f.cookie }, seat]) {
      const project = await f.project(learner.cookie);
      const first = await f.start(project, learner.cookie);
      const second = await f.start(project, learner.cookie);
      expect(first.accepted).toBe(true);
      expect(second.accepted).toBe(true);
      expect((await f.start(project, learner.cookie, 'blocks', first.sessionId)).accepted).toBe(
        true,
      );
      expect(
        Number(
          (
            await admin.query(
              "SELECT count(*) n FROM product_analytics_events WHERE flow_id=$1 AND event_type='module.opened'",
              [first.sessionId],
            )
          ).rows[0].n,
        ),
      ).toBe(1);
      // Use real server timestamps with deterministic elapsed intervals, not
      // client-supplied time or a sleep-only assertion.
      await admin.query(
        "UPDATE product_module_sessions SET started_at=clock_timestamp()-interval '30 seconds',last_seen_at=clock_timestamp()-interval '30 seconds' WHERE id=ANY($1::uuid[])",
        [[first.sessionId, second.sessionId]],
      );
      for (const sessionId of [first.sessionId, second.sessionId]) {
        const touch = await f.post(
          '/api/analytics/v1/module-session/touch',
          { sessionId },
          learner.cookie,
        );
        expect(touch.json().accepted).toBe(true);
      }
      const duplicateTouches = await Promise.all(
        [1, 2].map(() =>
          f.post(
            '/api/analytics/v1/module-session/touch',
            { sessionId: first.sessionId },
            learner.cookie,
          ),
        ),
      );
      expect(duplicateTouches.every((r) => r.json().accepted === true)).toBe(true);
      expect(
        (
          await admin.query(
            'SELECT active_seconds FROM product_module_activity_slices WHERE session_id=$1',
            [first.sessionId],
          )
        ).rows,
      ).toHaveLength(1);
      let metric = (await f.roster()).items.find((m) => m.seatId === learner.id)!;
      expect(metric.sources.time).toBe(0);
      expect(metric.score).toBe(0);
      const base = (
        await admin.query('SELECT revision FROM project_drafts WHERE project_id=$1', [project])
      ).rows[0].revision as number;
      const document = {
        schemaVersion: 1,
        format: 'scratch-3',
        projectJson: {
          targets: [],
          monitors: [],
          extensions: [],
          meta: { semver: '3.0.0', agent: 'Scratch PG draft fixture' },
        },
        assets: [],
      };
      const saved = await f.post(
        `/api/projects/${project}/draft`,
        { baseRevision: base, mutationId: randomUUID(), document },
        learner.cookie,
      );
      expect(saved.statusCode, saved.body).toBe(200);
      metric = (await f.roster()).items.find((m) => m.seatId === learner.id)!;
      expect(metric.sources.time).toBeGreaterThanOrEqual(29);
      expect(metric.sources.time).toBeLessThan(33);
      expect(metric.sources.days).toBe(1);
      expect(metric.score).toBeGreaterThan(0);
      expect(metric.score).toBeCloseTo(metric.factors.time, 2);
      // A real minute-scale checkpoint may arrive 65 seconds after the last
      // input slice. The existing ±90 second draft evidence window still
      // qualifies it; no extra dirty-event writes or fast full saves are needed.
      await admin.query(
        "UPDATE product_module_activity_slices SET started_at=started_at-interval '65 seconds',ended_at=ended_at-interval '65 seconds' WHERE session_id=ANY($1::uuid[])",
        [[first.sessionId, second.sessionId]],
      );
      const delayed = (await f.roster()).items.find((m) => m.seatId === learner.id)!;
      expect(delayed.sources.time).toBeGreaterThanOrEqual(29);
      expect(delayed.sources.time).toBeLessThan(33);
      const edits = async () =>
        Number(
          (
            await admin.query(
              'SELECT count(*) n FROM classroom_participant_project_edits WHERE project_id=$1',
              [project],
            )
          ).rows[0].n,
        );
      const count = await edits();
      const revision = (
        await admin.query('SELECT revision FROM project_drafts WHERE project_id=$1', [project])
      ).rows[0].revision as number;
      const unchanged = await f.post(
        `/api/projects/${project}/draft`,
        { baseRevision: revision, mutationId: randomUUID(), document },
        learner.cookie,
      );
      expect(unchanged.statusCode, unchanged.body).toBe(200);
      expect(await edits()).toBe(count);
      await f.post(
        '/api/analytics/v1/module-session/touch',
        { sessionId: first.sessionId, closed: true },
        learner.cookie,
      );
      const before = Number(
        (
          await admin.query(
            'SELECT count(*) n FROM product_module_activity_slices WHERE session_id=$1',
            [first.sessionId],
          )
        ).rows[0].n,
      );
      await f.post(
        '/api/analytics/v1/module-session/touch',
        { sessionId: first.sessionId, closed: true },
        learner.cookie,
      );
      expect(
        Number(
          (
            await admin.query(
              'SELECT count(*) n FROM product_module_activity_slices WHERE session_id=$1',
              [first.sessionId],
            )
          ).rows[0].n,
        ),
      ).toBe(before);
      expect((await f.start(project, learner.cookie, 'blocks', first.sessionId)).accepted).toBe(
        false,
      );
    }
    await f.settings([]);
    expect((await f.roster()).items.every((m) => m.score === null)).toBe(true);
    await f.settings(['logins']);
    const metric = (await f.roster()).items.find((m) => m.seatId === seat.id)!;
    expect(metric.score).not.toBe(metric.factors.time);
    await f.settings(['time']);
    expect((await f.roster()).items.find((m) => m.seatId === seat.id)!.score).toBeGreaterThan(0);
  }, 60_000);

  it('rejects module mismatch, foreign project/session, mixed cookies, replay and revoked access', async () => {
    const f = await fixture();
    const one = await f.seat('One');
    const two = await f.seat('Two');
    const project = await f.project(one.cookie);
    expect((await f.start(project, one.cookie, 'three-d')).accepted).toBe(false);
    expect((await f.start(project, two.cookie)).accepted).toBe(false);
    const session = await f.start(project, one.cookie);
    expect(session.accepted).toBe(true);
    const foreign = await f.post(
      '/api/analytics/v1/module-session/touch',
      { sessionId: session.sessionId, closed: true },
      two.cookie,
    );
    expect(foreign.json().accepted).toBe(false);
    expect((await f.start(project, two.cookie, 'blocks', session.sessionId)).accepted).toBe(false);
    const conflict = await f.post(
      '/api/analytics/v1/module-session/start',
      { projectId: project, moduleKey: 'blocks', sessionId: randomUUID() },
      `${f.cookie}; ${one.cookie}`,
    );
    expect(conflict.statusCode).toBe(409);
    await admin.query(
      "UPDATE product_module_sessions SET last_seen_at=clock_timestamp()-interval '120 seconds' WHERE id=$1",
      [session.sessionId],
    );
    const expired = await f.post(
      '/api/analytics/v1/module-session/touch',
      { sessionId: session.sessionId },
      one.cookie,
    );
    expect(expired.json().accepted).toBe(true);
    expect(
      (
        await admin.query('SELECT * FROM product_module_activity_slices WHERE session_id=$1', [
          session.sessionId,
        ])
      ).rows,
    ).toHaveLength(0);
    await admin.query("UPDATE projects SET status='trashed' WHERE id=$1", [project]);
    expect(
      (
        await f.post(
          '/api/analytics/v1/module-session/touch',
          { sessionId: session.sessionId },
          one.cookie,
        )
      ).json().accepted,
    ).toBe(false);
  }, 60_000);
});
