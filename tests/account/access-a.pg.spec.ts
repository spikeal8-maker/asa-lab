import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { buildTestApp, inject, type NestApp } from '../portal/app';
import { testAdminPool, testAppPool } from '../portal/helpers';

let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;
beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  app = await buildTestApp(runtime);
});
afterAll(async () => {
  await app?.close();
  await admin?.end();
});

async function account() {
  const id = crypto.randomUUID().replaceAll('-', '');
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: `${id}@access-a.test`,
      username: `a${id.slice(0, 24)}`,
      displayName: 'Synthetic Access A',
      password: `Safe-${id}-Password`,
      birthDate: '1990-04-12',
      country: 'RU',
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  const session = response.json();
  const token = response.cookies.find((cookie) => cookie.name === 'asa_session')?.value;
  expect(token).toBeTruthy();
  const refresh = response.cookies.find((cookie) => cookie.name === 'asa_refresh')?.value;
  return { id: session.user.id as string, cookie: `asa_session=${token}`, refresh, session };
}
async function counts(accountId: string) {
  const result = await admin.query(
    `WITH owned AS (
    SELECT w.id, w.tenant_id, w.kind FROM workspaces w JOIN workspace_memberships m ON m.workspace_id=w.id WHERE m.account_id=$1
  ) SELECT (SELECT count(*) FROM schools WHERE tenant_id IN (SELECT tenant_id FROM owned))::integer schools,
    (SELECT count(*) FROM owned WHERE kind='organization')::integer organizations`,
    [accountId],
  );
  return result.rows[0];
}
async function teach(cookie: string) {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/capabilities/educator/self-attest',
    headers: { cookie },
    payload: {},
  });
  expect(response.statusCode, response.body).toBe(201);
}
async function classroom(cookie: string) {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/classrooms',
    headers: { cookie, 'idempotency-key': `access-${crypto.randomUUID()}` },
    payload: {
      title: 'Независимые занятия',
      ageBand: 'mixed',
      topicKeys: [],
      safeModeDefault: true,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().classroom.id as string;
}

describe('Result A: real Account and independent Classroom API', () => {
  it('requires a private Seat key; replacement revokes sessions, retries do not rotate, cookies cannot union', async () => {
    const teacher = await account();
    await teach(teacher.cookie);
    const classId = await classroom(teacher.cookie);
    const classResponse = await inject(app, {
      method: 'GET',
      url: `/api/classrooms/${classId}`,
      headers: { cookie: teacher.cookie },
    });
    const code = classResponse.json().classroom.joinCode;
    const add = async (name: string) => {
      const response = await inject(app, {
        method: 'POST',
        url: `/api/classrooms/${classId}/seats`,
        headers: { cookie: teacher.cookie },
        payload: { displayLabel: name, loginHandle: name, safeMode: true },
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json().student.id as string;
    };
    const seatId = await add('first-seat');
    const otherId = await add('second-seat');
    const issue = (id: string, requestId = crypto.randomUUID(), cookie = teacher.cookie) =>
      inject(app, {
        method: 'POST',
        url: `/api/classrooms/${classId}/seats/${id}/credential`,
        headers: { cookie },
        payload: { requestId },
      });
    const requestId = crypto.randomUUID();
    const issued = await issue(seatId, requestId);
    expect(issued.statusCode, issued.body).toBe(201);
    const credential = issued.json().credential;
    expect(credential).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const otherKey = (await issue(otherId)).json().credential;
    const signIn = (loginHandle: string, key?: string) =>
      inject(app, {
        method: 'POST',
        url: '/api/class-join/studentseat',
        payload: { code, loginHandle, ...(key ? { credential: key } : {}) },
      });
    expect((await signIn('first-seat')).statusCode).toBe(400);
    expect((await signIn('first-seat', otherKey)).statusCode).toBe(401);
    const login = await signIn('first-seat', credential);
    expect(login.statusCode, login.body).toBe(200);
    const cookie = `asa_student_session=${login.cookies.find((c) => c.name === 'asa_student_session')?.value}`;
    const me = await inject(app, { method: 'GET', url: '/api/class-join/me', headers: { cookie } });
    expect(me.json().student.seatId).toBe(seatId);
    for (const url of ['/api/auth/me', `/api/classrooms/${classId}/roster`, '/api/class-join/me']) {
      const conflict = await inject(app, {
        method: 'GET',
        url,
        headers: { cookie: `${teacher.cookie}; ${cookie}` },
      });
      expect(conflict.statusCode, conflict.body).toBe(409);
      expect(conflict.body).not.toContain(seatId);
    }
    const forbidden = await inject(app, {
      method: 'GET',
      url: `/api/classrooms/${classId}/roster`,
      headers: { cookie },
    });
    expect([401, 403]).toContain(forbidden.statusCode);
    const ordinary = await account();
    expect((await issue(otherId, crypto.randomUUID(), ordinary.cookie)).statusCode).toBe(403);
    expect((await issue(seatId, requestId)).statusCode).toBe(409);
    const replaced = await issue(seatId);
    expect(replaced.statusCode, replaced.body).toBe(201);
    expect(replaced.json().version).toBe(2);
    expect((await issue(seatId, requestId)).statusCode).toBe(409);
    expect(
      (
        await admin.query('SELECT version FROM classroom_seat_credentials WHERE seat_id=$1', [
          seatId,
        ])
      ).rows[0].version,
    ).toBe(2);
    expect((await signIn('first-seat', credential)).statusCode).toBe(401);
    const revoked = await inject(app, {
      method: 'GET',
      url: '/api/class-join/me',
      headers: { cookie },
    });
    expect(revoked.json().authenticated).toBe(false);
    await expect(
      runtime.query(
        'SELECT * FROM classroom_student_seat_sign_in($1::varchar,$2::varchar,$3::varchar,$4::integer)',
        ['x', 'first-seat', 'x', 8],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runtime.query('SELECT credential_hash FROM classroom_seat_credentials'),
    ).rejects.toMatchObject({ code: '42501' });
    const audit = await admin.query('SELECT payload_json FROM audit_events WHERE entity_id=$1', [
      seatId,
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain(credential);
    const newKey = replaced.json().credential;
    const idle = await signIn('first-seat', newKey);
    const idleCookie = `asa_student_session=${idle.cookies.find((c) => c.name === 'asa_student_session')!.value}`;
    await admin.query(
      "UPDATE classroom_student_sessions SET last_seen_at=now()-interval '61 minutes' WHERE seat_id=$1 AND revoked_at IS NULL",
      [seatId],
    );
    expect(
      (
        await inject(app, {
          method: 'GET',
          url: '/api/class-join/me',
          headers: { cookie: idleCookie },
        })
      ).json().authenticated,
    ).toBe(false);
    // Either logout endpoint must revoke both principals, not merely discard cookies.
    for (const url of ['/api/auth/logout', '/api/class-join/logout']) {
      const owner = await account();
      const entered = await signIn('first-seat', newKey);
      expect(entered.statusCode, entered.body).toBe(200);
      const seatCookie = `asa_student_session=${entered.cookies.find((c) => c.name === 'asa_student_session')!.value}`;
      const logout = await inject(app, {
        method: 'POST',
        url,
        headers: { cookie: `${owner.cookie}; ${seatCookie}; asa_refresh=${owner.refresh}` },
      });
      expect([200, 204], logout.body).toContain(logout.statusCode);
      expect(
        (
          await inject(app, {
            method: 'GET',
            url: '/api/auth/me',
            headers: { cookie: owner.cookie },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await inject(app, {
            method: 'GET',
            url: '/api/class-join/me',
            headers: { cookie: seatCookie },
          })
        ).json().authenticated,
      ).toBe(false);
      expect(
        (
          await inject(app, {
            method: 'POST',
            url: '/api/auth/refresh',
            headers: { cookie: `asa_refresh=${owner.refresh}` },
          })
        ).statusCode,
      ).toBe(401);
    }
  });

  it('previews and commits StudentSeat batches idempotently with one-time credentials', async () => {
    const teacher = await account();
    await teach(teacher.cookie);
    const classId = await classroom(teacher.cookie);
    const classroomView = await inject(app, {
      method: 'GET',
      url: `/api/classrooms/${classId}`,
      headers: { cookie: teacher.cookie },
    });
    expect(classroomView.statusCode, classroomView.body).toBe(200);
    const code = classroomView.json().classroom.joinCode as string;
    expect(code).toBeTruthy();

    const addExisting = async (displayLabel: string, loginHandle: string) => {
      const response = await inject(app, {
        method: 'POST',
        url: `/api/classrooms/${classId}/seats`,
        headers: { cookie: teacher.cookie },
        payload: { displayLabel, loginHandle, safeMode: true },
      });
      expect(response.statusCode, response.body).toBe(201);
    };
    await addExisting('Taken Person', 'taken-one');
    await addExisting('Existing Same', 'same-one');

    const students = [
      { displayLabel: 'Fresh Learner', safeMode: true },
      { displayLabel: 'Twin One', loginHandle: 'batch-dup', safeMode: true },
      { displayLabel: 'Twin Two', loginHandle: 'batch-dup', safeMode: true },
      { displayLabel: 'Different Person', loginHandle: 'taken-one', safeMode: true },
      { displayLabel: 'Existing Same', loginHandle: 'same-one', safeMode: true },
      { displayLabel: '', loginHandle: 'bad', safeMode: true },
    ];
    const preview = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classId}/seats/batch/preview`,
      headers: { cookie: teacher.cookie },
      payload: { students },
    });
    expect(preview.statusCode, preview.body).toBe(201);
    const previewRows = preview.json().results as Array<{
      status: string;
      loginHandle: string | null;
    }>;
    expect(previewRows.map((row) => row.status)).toEqual([
      'valid',
      'valid',
      'duplicate',
      'conflict',
      'duplicate',
      'invalid',
    ]);
    expect(previewRows[0]?.loginHandle).toMatch(/^seat-[0-9a-f]{12}$/);

    const requestId = crypto.randomUUID();
    const committed = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classId}/seats/batch`,
      headers: { cookie: teacher.cookie },
      payload: { students, requestId },
    });
    expect(committed.statusCode, committed.body).toBe(201);
    const result = committed.json();
    expect(result).toMatchObject({
      requestId,
      reused: false,
      created: 2,
      credentialsAvailable: true,
    });
    const created = result.results.filter((row: { status: string }) => row.status === 'created');
    expect(created).toHaveLength(2);
    for (const row of created) {
      expect(row.credential).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(row.credentialVersion).toBe(1);
      expect(row.seatId).toMatch(/^[0-9a-f-]{36}$/i);
    }

    const first = created[0];
    const signedIn = await inject(app, {
      method: 'POST',
      url: '/api/class-join/studentseat',
      payload: { code, loginHandle: first.loginHandle, credential: first.credential },
    });
    expect(signedIn.statusCode, signedIn.body).toBe(200);

    const stored = await admin.query(
      `SELECT row_to_json(row_data)::text AS payload
         FROM classroom_student_seat_batch_rows row_data
        WHERE request_id=$1 ORDER BY row_index`,
      [requestId],
    );
    const audit = await admin.query(
      `SELECT payload_json FROM audit_events
        WHERE entity_id=$1 AND action='classroom.student_seat_batch_committed'`,
      [classId],
    );
    for (const row of created) {
      expect(JSON.stringify(stored.rows)).not.toContain(row.credential);
      expect(JSON.stringify(audit.rows)).not.toContain(row.credential);
    }

    const retry = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classId}/seats/batch`,
      headers: { cookie: teacher.cookie },
      payload: { students, requestId },
    });
    expect(retry.statusCode, retry.body).toBe(201);
    expect(retry.json()).toMatchObject({
      requestId,
      reused: true,
      created: 2,
      credentialsAvailable: false,
    });
    expect(
      retry.json().results.every((row: { credential: string | null }) => row.credential === null),
    ).toBe(true);

    const conflict = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classId}/seats/batch`,
      headers: { cookie: teacher.cookie },
      payload: { students: [{ ...students[0], safeMode: false }], requestId },
    });
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.body).toContain('idempotency_conflict');

    const ordinary = await account();
    for (const url of [
      `/api/classrooms/${classId}/seats/batch/preview`,
      `/api/classrooms/${classId}/seats/batch`,
    ]) {
      const denied = await inject(app, {
        method: 'POST',
        url,
        headers: { cookie: ordinary.cookie },
        payload: url.endsWith('/preview')
          ? { students }
          : { students, requestId: crypto.randomUUID() },
      });
      expect(denied.statusCode, denied.body).toBe(403);
    }

    const tooMany = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classId}/seats/batch/preview`,
      headers: { cookie: teacher.cookie },
      payload: {
        students: Array.from({ length: 101 }, (_, index) => ({
          displayLabel: `Seat ${index}`,
          safeMode: true,
        })),
      },
    });
    expect(tooMany.statusCode, tooMany.body).toBe(400);

    await expect(
      runtime.query('SELECT * FROM classroom_student_seat_batches'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runtime.query('SELECT * FROM classroom_student_seat_batch_rows'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('author-only creates private content, not classes, rosters or foreign content; revoke is effective', async () => {
    const author = await account();
    const draft = {
      requestId: crypto.randomUUID(),
      kind: 'manual',
      title: 'Авторский материал',
      instructions: 'Соберите модель.',
      resultMode: 'ungraded',
      maxPoints: null,
      scope: 'personal',
      visibility: 'private',
      policies: {
        attemptPolicy: null,
        resultSelectionPolicy: null,
        completionPolicy: null,
        latePolicy: null,
        assessmentPolicy: null,
        feedbackReleasePolicy: null,
      },
    };
    const denied = await inject(app, {
      method: 'POST',
      url: '/api/learning/activities',
      headers: { cookie: author.cookie },
      payload: draft,
    });
    expect(denied.statusCode).toBe(403);
    const grant = await inject(app, {
      method: 'POST',
      url: '/api/capabilities/content-author/self-attest',
      headers: { cookie: author.cookie },
      payload: {},
    });
    expect(grant.statusCode, grant.body).toBe(201);
    const session = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: author.cookie },
    });
    expect(session.json().navigation).toMatchObject({
      classes: false,
      classroomManagement: false,
      contentAuthoring: true,
    });
    const created = await inject(app, {
      method: 'POST',
      url: '/api/learning/activities',
      headers: { cookie: author.cookie },
      payload: draft,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id;
    const other = await account();
    await teach(other.cookie);
    const foreign = await inject(app, {
      method: 'GET',
      url: `/api/learning/activities/${id}`,
      headers: { cookie: other.cookie },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).not.toContain(author.id);
    const classes = await inject(app, {
      method: 'POST',
      url: '/api/classrooms',
      headers: { cookie: author.cookie, 'idempotency-key': crypto.randomUUID() },
      payload: { title: 'Forbidden' },
    });
    expect(classes.statusCode).toBe(403);
    const wrongScope = await inject(app, {
      method: 'POST',
      url: '/api/learning/activities',
      headers: { cookie: author.cookie },
      payload: { ...draft, scope: 'school', visibility: 'school' },
    });
    expect(wrongScope.statusCode).toBe(403);
    await admin.query(
      `UPDATE capability_grants SET state='revoked' WHERE account_id=$1 AND capability='content_author'`,
      [author.id],
    );
    for (const method of ['GET', 'POST'] as const) {
      const result = await inject(app, {
        method,
        url: '/api/learning/activities',
        headers: { cookie: author.cookie },
        ...(method === 'POST' ? { payload: draft } : {}),
      });
      expect(result.statusCode).toBe(403);
    }
    const regrant = await inject(app, {
      method: 'POST',
      url: '/api/capabilities/content-author/self-attest',
      headers: { cookie: author.cookie },
      payload: {},
    });
    expect(regrant.statusCode).toBe(403);
  });
  it('registers personal workspace only; profile and a forged role cannot grant teaching', async () => {
    const owner = await account();
    expect(owner.session.workspaces).toHaveLength(1);
    expect(owner.session.activeWorkspace.kind).toBe('personal');
    expect(owner.session.navigation.classes).toBe(false);
    expect(owner.session.navigation.contentAuthoring).toBe(false);
    expect(await counts(owner.id)).toEqual({ schools: 0, organizations: 0 });
    const forged = await inject(app, {
      method: 'PATCH',
      url: '/api/account/profile',
      headers: { cookie: owner.cookie },
      payload: {
        username: owner.session.user.id,
        displayName: 'Forged',
        role: 'educator',
        canTeach: true,
      },
    });
    expect(forged.statusCode).toBe(400);
    const forbidden = await inject(app, {
      method: 'GET',
      url: '/api/classrooms',
      headers: { cookie: owner.cookie },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('creates independent class without inserting a school or organization', async () => {
    const owner = await account();
    const before = await counts(owner.id);
    await teach(owner.cookie);
    const id = await classroom(owner.cookie);
    expect(await counts(owner.id)).toEqual(before);
    const scope = await admin.query(
      `SELECT c.school_id, lc.kind, lc.owner_account_id,
      lc.school_id AS actual_school FROM classrooms c JOIN learning_contexts lc
      ON lc.tenant_id=c.tenant_id AND lc.id=c.school_id WHERE c.id=$1`,
      [id],
    );
    expect(scope.rows[0]).toMatchObject({
      kind: 'independent_teaching',
      owner_account_id: owner.id,
      actual_school: null,
    });
    const readable = await inject(app, {
      method: 'GET',
      url: `/api/classrooms/${id}`,
      headers: { cookie: owner.cookie },
    });
    expect(readable.statusCode, readable.body).toBe(200);
    expect(readable.json().classroom.learningContext).toMatchObject({
      kind: 'independent_teaching',
      schoolId: null,
    });
    const other = await account();
    await teach(other.cookie);
    for (const suffix of ['', '/roster']) {
      const denied = await inject(app, {
        method: 'GET',
        url: `/api/classrooms/${id}${suffix}`,
        headers: { cookie: other.cookie },
      });
      expect([403, 404], denied.body).toContain(denied.statusCode);
      expect(denied.body).not.toContain(owner.id);
    }
    await admin.query(
      `UPDATE capability_grants SET state='revoked' WHERE account_id=$1 AND capability='educator'`,
      [owner.id],
    );
    const denied = await inject(app, {
      method: 'GET',
      url: `/api/classrooms/${id}`,
      headers: { cookie: owner.cookie },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('preserves real school creation and context FK/RLS boundaries', async () => {
    const owner = await account();
    await teach(owner.cookie);
    const response = await inject(app, {
      method: 'POST',
      url: '/api/schools',
      headers: { cookie: owner.cookie },
      payload: { title: 'Реальная тестовая школа' },
    });
    expect(response.statusCode, response.body).toBe(201);
    const schoolId = response.json().school.schoolId;
    const context = await admin.query('SELECT kind, school_id FROM learning_contexts WHERE id=$1', [
      schoolId,
    ]);
    expect(context.rows[0]).toEqual({ kind: 'school', school_id: schoolId });
    await expect(
      runtime.query(
        `INSERT INTO learning_contexts (tenant_id,kind,school_id) VALUES ($1,'school',$2)`,
        [response.json().school.tenantId, schoolId],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const policies = await admin.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='learning_contexts'::regclass`,
    );
    expect(policies.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const client = await runtime.connect();
    try {
      const tenantId = (
        await admin.query('SELECT tenant_id FROM learning_contexts WHERE id=$1', [schoolId])
      ).rows[0].tenant_id;
      // Prove missing write privileges with a valid tenant, not a parse failure
      // from a pool connection whose transaction-local tenant GUC was cleared.
      for (const sql of [
        'UPDATE learning_contexts SET kind=kind',
        'DELETE FROM learning_contexts',
      ]) {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
        await expect(client.query(sql)).rejects.toMatchObject({ code: '42501' });
        await client.query('ROLLBACK');
      }
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [crypto.randomUUID()]);
      expect(
        (await client.query('SELECT id FROM learning_contexts WHERE id=$1', [schoolId])).rows,
      ).toEqual([]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('ordinary author session resolver preserves heartbeat and validity predicates', async () => {
    const actor = await account();
    const tokenHash = hashSessionToken(actor.cookie.slice('asa_session='.length));
    await admin.query(
      "UPDATE sessions_v2 SET last_seen_at='2000-01-01T00:00:00Z' WHERE token_hash=$1",
      [tokenHash],
    );
    const normal = await runtime.query('SELECT * FROM session_v2_context($1)', [tokenHash]);
    expect(normal.rows).toHaveLength(1);
    expect(
      (
        await admin.query('SELECT last_seen_at FROM sessions_v2 WHERE token_hash=$1', [tokenHash])
      ).rows[0].last_seen_at.getUTCFullYear(),
    ).toBeGreaterThan(2000);
    const client = await admin.connect();
    try {
      for (const mutation of [
        'UPDATE sessions_v2 SET revoked_at=now() WHERE token_hash=$1',
        "UPDATE sessions_v2 SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
        "UPDATE accounts SET status='suspended' WHERE id=(SELECT account_id FROM principals WHERE id=(SELECT principal_id FROM sessions_v2 WHERE token_hash=$1))",
        "UPDATE workspace_memberships SET state='revoked' WHERE workspace_id=(SELECT active_workspace_id FROM sessions_v2 WHERE token_hash=$1)",
      ]) {
        await client.query('BEGIN');
        try {
          await client.query(mutation, [tokenHash]);
          const ordinary = await client.query('SELECT * FROM session_v2_context($1)', [tokenHash]);
          expect(ordinary.rows).toEqual([]);
        } finally {
          await client.query('ROLLBACK');
        }
      }
    } finally {
      client.release();
    }
  });

  it('preview as learner returns exact saved sources with no academic or learner-session writes', async () => {
    const author = await account();
    const grant = await inject(app, {
      method: 'POST',
      url: '/api/capabilities/content-author/self-attest',
      headers: { cookie: author.cookie },
      payload: {},
    });
    expect(grant.statusCode, grant.body).toBe(201);
    const basePolicies = {
      attemptPolicy: { maxAttempts: 2 },
      resultSelectionPolicy: { mode: 'latest_accepted' },
      completionPolicy: { mode: 'accepted' },
      latePolicy: { mode: 'allow_until_close' },
      assessmentPolicy: { mode: 'manual' },
      feedbackReleasePolicy: { mode: 'immediate' },
    };
    const created = await inject(app, {
      method: 'POST',
      url: '/api/learning/activities',
      headers: { cookie: author.cookie },
      payload: {
        kind: 'project',
        title: 'Preview published V1',
        instructions: 'Published instructions',
        resultMode: 'completion',
        maxPoints: null,
        policies: basePolicies,
        moduleKey: 'electronics',
        scope: 'personal',
        visibility: 'private',
        requestId: 'preview:create:' + crypto.randomUUID(),
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const activityId = created.json().id as string;
    const published = await inject(app, {
      method: 'POST',
      url: `/api/learning/activities/${activityId}/publish`,
      headers: { cookie: author.cookie },
      payload: { expectedRevision: 1, requestId: 'preview:publish:' + crypto.randomUUID() },
    });
    expect(published.statusCode, published.body).toBe(201);
    const versionId = published.json().id as string;
    const updated = await inject(app, {
      method: 'PUT',
      url: `/api/learning/activities/${activityId}/draft`,
      headers: { cookie: author.cookie },
      payload: {
        title: 'Preview saved draft r2',
        instructions: 'Draft instructions r2',
        resultMode: 'completion',
        maxPoints: null,
        policies: basePolicies,
        moduleKey: 'three-d',
        quizVersionId: null,
        starterProjectVersionId: null,
        expectedRevision: 1,
      },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().draftRevision).toBe(2);

    const counts = async () =>
      (
        await admin.query(`SELECT
          (SELECT count(*)::int FROM accounts) AS accounts,
          (SELECT count(*)::int FROM principals) AS principals,
          (SELECT count(*)::int FROM classroom_student_seats) AS seats,
          (SELECT count(*)::int FROM course_enrollments) AS enrollments,
          (SELECT count(*)::int FROM activity_participations) AS participations,
          (SELECT count(*)::int FROM learning_attempts) AS attempts,
          (SELECT count(*)::int FROM learning_submissions) AS submissions,
          (SELECT count(*)::int FROM assessment_results) AS results,
          (SELECT count(*)::int FROM classroom_student_sessions) AS learner_sessions,
          (SELECT count(*)::int FROM gradebook_entries) AS gradebook,
          (SELECT count(*)::int FROM learning_notifications) AS notifications,
          (SELECT count(*)::int FROM audit_events) AS audit_events,
          (SELECT count(*)::int FROM learning_activities) AS activities,
          (SELECT count(*)::int FROM learning_activity_versions) AS activity_versions`)
      ).rows[0];
    const foreignAuthor = await account();
    expect(
      (
        await inject(app, {
          method: 'POST',
          url: '/api/capabilities/content-author/self-attest',
          headers: { cookie: foreignAuthor.cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(201);
    const foreignCreated = await inject(app, {
      method: 'POST',
      url: '/api/learning/activities',
      headers: { cookie: foreignAuthor.cookie },
      payload: {
        kind: 'project',
        title: 'Other author private material',
        instructions: 'Private',
        resultMode: 'completion',
        maxPoints: null,
        policies: basePolicies,
        moduleKey: 'electronics',
        scope: 'personal',
        visibility: 'private',
        requestId: 'preview:foreign:' + crypto.randomUUID(),
      },
    });
    expect(foreignCreated.statusCode, foreignCreated.body).toBe(201);
    const foreignId = foreignCreated.json().id as string;
    const foreignPublished = await inject(app, {
      method: 'POST',
      url: `/api/learning/activities/${foreignId}/publish`,
      headers: { cookie: foreignAuthor.cookie },
      payload: { expectedRevision: 1, requestId: 'preview:foreign-pub:' + crypto.randomUUID() },
    });
    expect(foreignPublished.statusCode, foreignPublished.body).toBe(201);

    const before = await counts();
    const authorHashes = [author, foreignAuthor].map((actor) =>
      hashSessionToken(actor.cookie.slice('asa_session='.length)),
    );
    await admin.query(
      "UPDATE sessions_v2 SET last_seen_at='2000-01-01T00:00:00Z' WHERE token_hash=ANY($1::text[])",
      [authorHashes],
    );
    // Reject academic/learner writes, including UPDATEs and insert/delete pairs.
    // Only the existing requesting author sessions may advance last_seen_at;
    // no credentials, expiry, scope, new session, or other session can change.
    await admin.query(`
      CREATE FUNCTION public.preview_test_no_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Preview attempted % on %', TG_OP, TG_TABLE_NAME; END $$;
      DO $$ DECLARE t record; BEGIN
        FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'sessions_v2' LOOP
          EXECUTE format('CREATE TRIGGER preview_test_no_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.preview_test_no_write()', t.tablename);
        END LOOP;
      END $$;
      CREATE TRIGGER preview_test_no_write BEFORE INSERT OR DELETE OR TRUNCATE ON public.sessions_v2
        FOR EACH STATEMENT EXECUTE FUNCTION public.preview_test_no_write();
      CREATE FUNCTION public.preview_test_author_heartbeat() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT (OLD.token_hash = ANY(TG_ARGV))
          OR (to_jsonb(NEW) - 'last_seen_at') IS DISTINCT FROM (to_jsonb(OLD) - 'last_seen_at')
          OR NEW.last_seen_at < OLD.last_seen_at THEN
          RAISE EXCEPTION 'Preview changed session beyond existing author heartbeat';
        END IF;
        RETURN NEW;
      END $$;
    `);
    // Hashes are generated by hashSessionToken (hex), not user-provided SQL.
    expect(authorHashes.every((hash) => /^[0-9a-f]+$/.test(hash))).toBe(true);
    await admin.query(`CREATE TRIGGER preview_test_author_heartbeat BEFORE UPDATE ON public.sessions_v2
      FOR EACH ROW EXECUTE FUNCTION public.preview_test_author_heartbeat('${authorHashes[0]}','${authorHashes[1]}')`);
    try {
      const draftPreview = await inject(app, {
        method: 'GET',
        url: `/api/learning/activities/${activityId}/preview?source=draft&draftRevision=2`,
        headers: { cookie: author.cookie },
      });
      expect(draftPreview.statusCode, draftPreview.body).toBe(200);
      expect(draftPreview.json()).toMatchObject({
        source: { kind: 'draft', id: null, draftRevision: 2, versionNumber: null },
        assignment: { title: 'Preview saved draft r2', brief: 'Draft instructions r2' },
        moduleKey: 'three-d',
        resultMode: 'completion',
        learnerRuntime: false,
      });

      const publishedPreview = await inject(app, {
        method: 'GET',
        url: `/api/learning/activities/${activityId}/preview?source=published&versionId=${versionId}`,
        headers: { cookie: author.cookie },
      });
      expect(publishedPreview.statusCode, publishedPreview.body).toBe(200);
      expect(publishedPreview.json()).toMatchObject({
        source: { kind: 'published', id: versionId, versionNumber: 1 },
        assignment: { title: 'Preview published V1', brief: 'Published instructions' },
        moduleKey: 'electronics',
        resultMode: 'completion',
        learnerRuntime: false,
      });

      const stale = await inject(app, {
        method: 'GET',
        url: `/api/learning/activities/${activityId}/preview?source=draft&draftRevision=1`,
        headers: { cookie: author.cookie },
      });
      expect(stale.statusCode, stale.body).toBe(409);
      const foreignVersion = await inject(app, {
        method: 'GET',
        url: `/api/learning/activities/${activityId}/preview?source=published&versionId=${crypto.randomUUID()}`,
        headers: { cookie: author.cookie },
      });
      expect(foreignVersion.statusCode, foreignVersion.body).toBe(404);
      for (const [url, cookie, status] of [
        [
          `/api/learning/activities/${activityId}/preview?source=draft&draftRevision=2`,
          foreignAuthor.cookie,
          404,
        ],
        [
          `/api/learning/activities/${foreignId}/preview?source=published&versionId=${foreignPublished.json().id}`,
          author.cookie,
          404,
        ],
        [
          `/api/learning/activities/${activityId}/preview?source=published&versionId=${foreignPublished.json().id}`,
          author.cookie,
          404,
        ],
        [`/api/learning/activities/${activityId}/preview?source=draft&draftRevision=2`, '', 401],
        [
          `/api/learning/activities/${activityId}/preview?source=draft&draftRevision=2147483648`,
          author.cookie,
          400,
        ],
        [
          `/api/learning/activities/${activityId}/preview?source=draft&draftRevision=1e0`,
          author.cookie,
          400,
        ],
        [
          `/api/learning/activities/${activityId}/preview?source=draft&draftRevision=2&versionId=${versionId}`,
          author.cookie,
          400,
        ],
      ] as const) {
        const denied = await inject(app, { method: 'GET', url, headers: { cookie } });
        expect(denied.statusCode, denied.body).toBe(status);
      }
      // Published content stays pinned after the draft edit, including its digest.
      const repeat = await inject(app, {
        method: 'GET',
        url: `/api/learning/activities/${activityId}/preview?source=published&versionId=${versionId}`,
        headers: { cookie: author.cookie },
      });
      expect(repeat.statusCode, repeat.body).toBe(200);
      expect(repeat.json()).toEqual(publishedPreview.json());
      expect(draftPreview.json().source.contentDigest).not.toBe(
        publishedPreview.json().source.contentDigest,
      );
      expect(await counts()).toEqual(before);
      expect(
        (
          await admin.query('SELECT last_seen_at FROM sessions_v2 WHERE token_hash=$1', [
            authorHashes[0],
          ])
        ).rows[0].last_seen_at.getUTCFullYear(),
      ).toBeGreaterThan(2000);
      // Demonstrate the exception is narrow: even an author expiry change and
      // an UPDATE with no affected academic rows must fail under this guard.
      await expect(
        admin.query(
          "UPDATE sessions_v2 SET expires_at=expires_at+interval '1 hour' WHERE token_hash=$1",
          [authorHashes[0]],
        ),
      ).rejects.toThrow('beyond existing author heartbeat');
      await expect(
        admin.query('UPDATE learning_attempts SET state=state WHERE false'),
      ).rejects.toThrow('Preview attempted UPDATE');
    } finally {
      await admin.query(`
        DO $$ DECLARE t record; BEGIN
          FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
            EXECUTE format('DROP TRIGGER IF EXISTS preview_test_no_write ON public.%I', t.tablename);
          END LOOP;
        END $$;
        DROP TRIGGER preview_test_author_heartbeat ON public.sessions_v2;
        DROP FUNCTION public.preview_test_author_heartbeat();
        DROP FUNCTION public.preview_test_no_write();
      `);
    }
  });
});
