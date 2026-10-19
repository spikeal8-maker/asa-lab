import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AiAccessService } from '../../apps/api/src/ai-access.service';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
import type { SeatContextUseCase } from '../../apps/api/src/seat-context';
import { TOKENS } from '../../apps/api/src/tokens';
import { call } from '../../apps/web/src/api-call';
import { classroomCodeFor, classroomCodeHash } from '../../contexts/classroom/dist/index.js';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { buildTestApp, inject } from '../portal/app';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { lockAiPostgresSuite } from './ai-postgres-suite-lock';
import {
  aiClassFixture,
  aiClassroomFixture,
  aiStudentAccessContract,
} from './ai-student-access.contract';

let admin: pg.Pool, runtime: pg.Pool;
let unlock: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const urls = ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'].map((key) => {
    const value = process.env[key];
    if (!value) throw new Error(`${key} must explicitly target an isolated _test database`);
    const url = new URL(value);
    if (!decodeURIComponent(url.pathname).endsWith('_test'))
      throw new Error(`${key} must target an isolated _test database`);
    return url;
  });
  if (urls[0]!.host !== urls[1]!.host || urls[0]!.pathname !== urls[1]!.pathname)
    throw new Error('Both roles must use the same isolated test database');
  admin = testAdminPool();
  runtime = testAppPool();
  unlock = await lockAiPostgresSuite(admin);
}, 30000);
afterAll(async () => {
  try {
    await runtime?.end();
  } finally {
    await unlock?.();
    await admin?.end();
  }
});
aiStudentAccessContract(() => ({ admin, runtime }));

it('creates canonical Seat ownership at insertion and serves its first AI chat after real credential sign-in without preparatory reads', async () => {
  const f = await aiClassroomFixture(admin);
  const studentCode = randomUUID().slice(0, 8);
  const code = classroomCodeFor(f.classroomId, 1, 'ai-new-seat-journey-fixture');
  await runtime.query('SELECT classroom_management_rotate_join_code($1,$2,$3,1)', [
    f.teacher.account_id,
    f.classroomId,
    classroomCodeHash(code),
  ]);
  const seatId = (
    await runtime.query<{ id: string }>(
      `SELECT id FROM classroom_management_add_seat($1,$2,'Новый ученик',$3,true)`,
      [f.teacher.account_id, f.classroomId, studentCode],
    )
  ).rows[0]!.id;
  const ownerRows = async () =>
    (
      await admin.query(
        `SELECT p.id,p.kind,p.account_id,s.tenant_id FROM principals p
         JOIN classroom_student_seats s ON s.id=p.seat_id WHERE p.seat_id=$1`,
        [seatId],
      )
    ).rows;
  // Assert before credentials, sign-in, analytics or any other HTTP request.
  // This fixture never seeds a Seat principal or invokes an identity initializer.
  const atInsertion = await ownerRows();
  expect(atInsertion).toEqual([
    {
      id: expect.any(String),
      kind: 'student_seat',
      account_id: null,
      tenant_id: f.context.tenant_id,
    },
  ]);
  const principalId = atInsertion[0]!.id as string;
  expect(
    (
      await runtime.query('SELECT * FROM classroom_seat_credential_issue($1,$2,$3,$4,$5)', [
        f.teacher.account_id,
        f.classroomId,
        seatId,
        hashSessionToken(studentCode),
        randomUUID(),
      ])
    ).rows[0],
  ).toMatchObject({ result_code: 'issued', credential_version: 1 });
  await admin.query(
    `INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by)
     VALUES($1,'platform_admin','verified','test','admin')`,
    [f.teacher.account_id],
  );
  const secret = '3a'.repeat(32);
  await new AiChatService(runtime, { encryptionKey: secret }).saveAdminConfig(
    f.teacher.principal_id,
    {
      enabled: true,
      provider: 'openai',
      model: 'gpt-5-mini',
      apiKey: 'sk-new-seat-fixture-0000000000',
      paidOperationsPerHour: 1000,
    },
    randomUUID(),
  );
  await new AiAccessService(runtime).saveClassroom(f.teacher.principal_id, f.classroomId, {
    kind: 'classroom',
    mode: 'allow',
    minimumRating: 50,
    expectedRevision: 0,
    requestId: randomUUID(),
  });
  expect(await ownerRows()).toEqual(atInsertion);
  const previous = process.env['ASA_SETTINGS_ENCRYPTION_KEY'];
  process.env['ASA_SETTINGS_ENCRYPTION_KEY'] = secret;
  const upstream = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ content: [{ type: 'output_text', text: 'Первый ответ новому ученику' }] }],
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal('fetch', upstream);
  const app = await buildTestApp(testAppPool());
  const legacyResolve = vi.spyOn(app.get<SeatContextUseCase>(TOKENS.seatContextUseCase), 'resolve');
  const headers = { host: '127.0.0.1:4610', 'content-type': 'application/json' };
  try {
    const signed = await inject(app, {
      method: 'POST',
      url: '/api/class-join/studentseat',
      headers,
      payload: { code, studentCode },
    });
    expect(signed.statusCode, signed.body).toBe(200);
    expect(signed.json()).toMatchObject({ authenticated: true, student: { seatId } });
    const studentCookie = signed.cookies.find((cookie) => cookie.name === 'asa_student_session');
    expect(studentCookie).toMatchObject({ httpOnly: true, value: expect.any(String) });
    const cookies = { asa_student_session: studentCookie!.value };
    const scopes = await inject(app, { method: 'GET', url: '/api/ai/scopes', cookies, headers });
    expect(scopes.statusCode, scopes.body).toBe(200);
    expect(scopes.json()).toMatchObject({
      personal: false,
      items: [{ seatId, canGenerate: true }],
    });
    const created = await inject(app, {
      method: 'POST',
      url: '/api/ai/threads',
      cookies,
      headers,
      payload: {},
    });
    expect(created.statusCode, created.body).toBe(201);
    const threadId = (created.json() as { id: string }).id;
    const sent = await inject(app, {
      method: 'POST',
      url: `/api/ai/threads/${threadId}/messages`,
      cookies,
      headers,
      payload: { message: 'Мой первый школьный вопрос', requestId: randomUUID() },
    });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.body).toContain('Первый ответ новому ученику');
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(
      (
        await admin.query(
          'SELECT owner_principal_id,account_id FROM ai_assistant_threads WHERE id=$1',
          [threadId],
        )
      ).rows,
    ).toEqual([{ owner_principal_id: principalId, account_id: null }]);
    const messages = await inject(app, {
      method: 'GET',
      url: `/api/ai/threads/${threadId}/messages`,
      cookies,
      headers,
    });
    expect(messages.statusCode, messages.body).toBe(200);
    expect(messages.json().items).toHaveLength(2);
    expect(await ownerRows()).toEqual(atInsertion);
    expect(legacyResolve).not.toHaveBeenCalled();
  } finally {
    legacyResolve.mockRestore();
    await app.close();
    vi.unstubAllGlobals();
    if (previous === undefined) delete process.env['ASA_SETTINGS_ENCRYPTION_KEY'];
    else process.env['ASA_SETTINGS_ENCRYPTION_KEY'] = previous;
  }
});

it('keeps historical missing Seat ownership at 403 through the real client and HTTP stack without refresh or identity writes', async () => {
  const f = await aiClassFixture(admin, runtime);
  const token = randomUUID();
  await runtime.query('SELECT * FROM classroom_seat_credential_issue($1,$2,$3,$4,$5)', [
    f.teacher.account_id,
    f.classroomId,
    f.seatId,
    hashSessionToken(randomUUID()),
    randomUUID(),
  ]);
  await admin.query(
    "INSERT INTO classroom_student_sessions(seat_id,token_hash,expires_at,credential_version) VALUES($1,$2,now()+interval '1 hour',1)",
    [f.seatId, hashSessionToken(token)],
  );
  await new AiAccessService(runtime).saveClassroom(f.teacher.principal_id, f.classroomId, {
    kind: 'classroom',
    mode: 'allow',
    minimumRating: 50,
    expectedRevision: 0,
    requestId: randomUUID(),
  });
  // This deliberately represents a historical missing projection, not the
  // separate canonical new-Seat constructor acceptance journey.
  await admin.query('DELETE FROM principals WHERE id=$1', [f.principalId]);
  expect(
    (
      await runtime.query('SELECT * FROM classroom_student_session_context($1)', [
        hashSessionToken(token),
      ])
    ).rows,
  ).toHaveLength(1);
  const principalRows = async () =>
    (await admin.query('SELECT id FROM principals WHERE seat_id=$1', [f.seatId])).rows;
  expect(await principalRows()).toEqual([]);
  const app = await buildTestApp(testAppPool());
  const legacyResolve = vi.spyOn(app.get<SeatContextUseCase>(TOKENS.seatContextUseCase), 'resolve');
  const paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const path =
        typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (!path.startsWith('/api/')) throw new Error('Unexpected external request');
      paths.push(path);
      // Only the browser's network transport is adapted to Fastify.inject.
      // call/fetchWithSessionRefresh, all HTTP handlers and SQL remain real.
      const response = await inject(app, {
        method: init?.method === 'POST' ? 'POST' : 'GET',
        url: path,
        cookies: { asa_student_session: token },
        headers: { host: '127.0.0.1:4610', accept: 'application/json' },
      });
      return new Response(response.body, {
        status: response.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  try {
    const reads = ['/api/ai/scopes', '/api/ai/status', '/api/ai/scopes'];
    for (const path of reads) {
      const result = await call(path);
      expect(result).toMatchObject({ ok: false, status: 403, error: { code: 'ai_scope_denied' } });
      expect(await principalRows()).toEqual([]);
    }
    expect(paths).toEqual(reads);
    expect(paths).not.toContain('/api/auth/refresh');
    expect(legacyResolve).not.toHaveBeenCalled();
    expect(
      (await runtime.query('SELECT * FROM ai_student_principal_existing($1)', [f.seatId])).rows,
    ).toEqual([]);
  } finally {
    legacyResolve.mockRestore();
    vi.unstubAllGlobals();
    await app.close();
  }
});

it('rechecks a teacher revoke committed while generation waits for the class lock', async () => {
  const f = await aiClassFixture(admin, runtime),
    access = new AiAccessService(runtime);
  await access.saveClassroom(f.teacher.principal_id, f.classroomId, {
    kind: 'classroom',
    mode: 'allow',
    minimumRating: 50,
    expectedRevision: 0,
    requestId: randomUUID(),
  });
  const thread = (
    await runtime.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [f.principalId])
  ).rows[0]!.id;
  const teacher = await runtime.connect(),
    student = await runtime.connect();
  let pending: Promise<{ message?: string }> | undefined;
  try {
    await teacher.query('BEGIN');
    await teacher.query('SELECT ai_classroom_access_set($1,$2,$3::jsonb)', [
      f.teacher.principal_id,
      f.classroomId,
      JSON.stringify({
        kind: 'classroom',
        mode: 'deny',
        minimumRating: 50,
        expectedRevision: 1,
        requestId: randomUUID(),
      }),
    ]);
    const pid = (await student.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
      .pid;
    pending = student
      .query("SELECT ai_chat_begin($1,$2,$3,'После отзыва')", [f.principalId, thread, randomUUID()])
      .then(
        () => ({}),
        (problem: Error) => ({ message: problem.message }),
      );
    let blocked = false;
    for (let n = 0; n < 200 && !blocked; n += 1) {
      blocked = (
        await admin.query<{ blocked: boolean }>(
          'SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',
          [pid],
        )
      ).rows[0]!.blocked;
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    await teacher.query('COMMIT');
    expect(await pending).toEqual({ message: 'AI_STUDENT_DENIED' });
    expect(
      (
        await admin.query(
          'SELECT request_id FROM ai_assistant_request_quota WHERE owner_principal_id=$1',
          [f.principalId],
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await teacher.query('ROLLBACK');
    await pending;
    teacher.release();
    student.release();
  }
});

it('serves real Seat-only HTTP and distinguishes invalid sessions, foreign scope and mixed-cookie conflict without fallback', async () => {
  const f = await aiClassFixture(admin, runtime);
  const token = randomUUID(),
    expiredToken = randomUUID(),
    teacherToken = randomUUID();
  await runtime.query('SELECT * FROM classroom_seat_credential_issue($1,$2,$3,$4,$5)', [
    f.teacher.account_id,
    f.classroomId,
    f.seatId,
    hashSessionToken(randomUUID()),
    randomUUID(),
  ]);
  await admin.query(
    `INSERT INTO classroom_student_sessions(seat_id,token_hash,expires_at,credential_version)
     VALUES($1,$2,now()+interval '1 hour',1),($1,$3,now()-interval '1 hour',1)`,
    [f.seatId, hashSessionToken(token), hashSessionToken(expiredToken)],
  );
  await admin.query(
    "INSERT INTO sessions_v2(principal_id,active_workspace_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [f.teacher.principal_id, f.teacher.workspace_id, hashSessionToken(teacherToken)],
  );
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
    [f.teacher.account_id],
  );
  const secret = '3a'.repeat(32);
  await new AiChatService(runtime, { encryptionKey: secret }).saveAdminConfig(
    f.teacher.principal_id,
    {
      enabled: true,
      provider: 'openai',
      model: 'gpt-5-mini',
      apiKey: 'sk-access-http-fixture-0000000',
      paidOperationsPerHour: 1000,
    },
    randomUUID(),
  );
  const previous = process.env['ASA_SETTINGS_ENCRYPTION_KEY'];
  process.env['ASA_SETTINGS_ENCRYPTION_KEY'] = secret;
  const upstream = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ content: [{ type: 'output_text', text: 'Ответ по школьному входу' }] }],
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal('fetch', upstream);
  const apiPool = testAppPool(),
    app = await buildTestApp(apiPool);
  const headers = { host: '127.0.0.1:4610', 'content-type': 'application/json' };
  try {
    const cookies = { asa_student_session: token };
    const scopes = await inject(app, { method: 'GET', url: '/api/ai/scopes', cookies, headers });
    expect(scopes.statusCode).toBe(200);
    expect(scopes.json()).toMatchObject({
      personal: false,
      items: [{ seatId: f.seatId, canGenerate: false }],
    });
    const denied = await inject(app, {
      method: 'POST',
      url: '/api/ai/threads',
      cookies,
      headers,
      payload: {},
    });
    expect(denied.statusCode).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
    const policy = await inject(app, {
      method: 'PUT',
      url: `/api/ai/classrooms/${f.classroomId}/access`,
      cookies: { asa_session: teacherToken },
      headers,
      payload: {
        kind: 'classroom',
        mode: 'allow',
        minimumRating: 50,
        expectedRevision: 0,
        requestId: randomUUID(),
      },
    });
    expect(policy.statusCode).toBe(200);
    const created = await inject(app, {
      method: 'POST',
      url: '/api/ai/threads',
      cookies,
      headers,
      payload: {},
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    const sent = await inject(app, {
      method: 'POST',
      url: `/api/ai/threads/${id}/messages`,
      cookies,
      headers,
      payload: { message: 'Школьный запрос', requestId: randomUUID() },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.body).toContain('Ответ по школьному входу');
    expect(upstream).toHaveBeenCalledTimes(1);
    const teacherRead = await inject(app, {
      method: 'GET',
      url: `/api/ai/threads/${id}/messages`,
      cookies: { asa_session: teacherToken },
      headers,
    });
    expect(teacherRead.json()).toMatchObject({ items: [] });

    // Prove the retained Account has a current canonical link. Its legitimate
    // school access must not turn an invalid Seat cookie into Account fallback.
    await admin.query('UPDATE classroom_student_seats SET account_id=$2 WHERE id=$1', [
      f.seatId,
      f.teacher.account_id,
    ]);
    await admin.query('SELECT learning_audience_ensure_seat_identity($1)', [f.seatId]);
    const linkedAccount = await inject(app, {
      method: 'GET',
      url: '/api/ai/status',
      cookies: { asa_session: teacherToken },
      headers: { ...headers, 'x-asa-ai-seat': f.seatId },
    });
    expect(linkedAccount.statusCode, linkedAccount.body).toBe(200);
    expect(linkedAccount.json()).toMatchObject({ enabled: true, canGenerate: true });

    async function admissionSnapshot() {
      return (
        await admin.query(
          `SELECT
           (SELECT count(*)::integer FROM ai_assistant_threads WHERE owner_principal_id=ANY($1::uuid[])) AS threads,
           (SELECT count(*)::integer FROM ai_assistant_messages WHERE owner_principal_id=ANY($1::uuid[])) AS messages,
           (SELECT count(*)::integer FROM ai_assistant_request_quota WHERE owner_principal_id=ANY($1::uuid[])) AS requests,
           (SELECT count(*)::integer FROM ai_paid_operation_quota) AS paid`,
          [[f.principalId, f.teacher.principal_id]],
        )
      ).rows;
    }
    const beforeDenied = await admissionSnapshot();
    expect(beforeDenied).toEqual([
      { threads: 1, messages: 2, requests: 1, paid: expect.any(Number) },
    ]);
    const attempts = [
      { method: 'GET', url: '/api/ai/scopes' },
      { method: 'GET', url: '/api/ai/status' },
      { method: 'GET', url: '/api/ai/threads' },
      { method: 'GET', url: `/api/ai/threads/${id}/messages` },
      { method: 'POST', url: '/api/ai/threads', payload: {} },
      {
        method: 'POST',
        url: `/api/ai/threads/${id}/messages`,
        payload: { message: 'Запрос без действительного входа', requestId: randomUUID() },
      },
      {
        method: 'POST',
        url: `/api/ai/threads/${id}/messages/stream`,
        payload: { message: 'Поток без действительного входа', requestId: randomUUID() },
      },
      {
        method: 'POST',
        url: `/api/ai/threads/${id}/requests/${randomUUID()}/stop`,
        payload: {},
      },
    ] as const;
    async function rejected(
      label: string,
      rejectedCookies: Record<string, string>,
      status: number,
      code: string,
    ) {
      for (const attempt of attempts) {
        const response = await inject(app, {
          ...attempt,
          cookies: rejectedCookies,
          headers,
        });
        expect(response.statusCode, `${label}: ${attempt.url}: ${response.body}`).toBe(status);
        expect(response.json()).toMatchObject({ error: { code } });
        expect(response.json()).not.toHaveProperty('items');
      }
    }

    await rejected(
      'two active sessions',
      { ...cookies, asa_session: teacherToken },
      409,
      'session_conflict',
    );
    const other = await f.addSeat();
    for (const attempt of attempts.filter((item) => item.url !== '/api/ai/scopes')) {
      const response = await inject(app, {
        ...attempt,
        cookies,
        headers: { ...headers, 'x-asa-ai-seat': other.seatId },
      });
      expect(response.statusCode, `${attempt.url}: ${response.body}`).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'ai_scope_denied' } });
    }
    await admin.query(
      'UPDATE classroom_student_sessions SET revoked_at=now() WHERE token_hash=$1',
      [hashSessionToken(token)],
    );
    for (const [label, studentToken] of [
      ['revoked', token],
      ['expired', expiredToken],
      ['unknown', randomUUID()],
      ['empty', ''],
    ] as const) {
      const invalid = { asa_student_session: studentToken };
      await rejected(label, invalid, 401, 'ai_session_required');
      // Non-empty mixed cookies are rejected by the canonical global hook
      // before AI handlers. An empty Seat cookie reaches AI and still denies.
      await rejected(
        `${label} with linked Account`,
        { ...invalid, asa_session: teacherToken },
        studentToken ? 409 : 401,
        studentToken ? 'session_conflict' : 'ai_session_required',
      );
    }
    await rejected('no session cookies', {}, 401, 'ai_session_required');
    expect(await admissionSnapshot()).toEqual(beforeDenied);
    expect(upstream).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
    vi.unstubAllGlobals();
    if (previous === undefined) delete process.env['ASA_SETTINGS_ENCRYPTION_KEY'];
    else process.env['ASA_SETTINGS_ENCRYPTION_KEY'] = previous;
  }
});
