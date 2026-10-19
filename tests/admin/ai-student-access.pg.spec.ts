import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AiAccessService } from '../../apps/api/src/ai-access.service';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { buildTestApp, inject } from '../portal/app';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { lockAiPostgresSuite } from './ai-postgres-suite-lock';
import { aiClassFixture, aiStudentAccessContract } from './ai-student-access.contract';

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

it('serves real Seat-only HTTP and exact teacher policy without account linkage; revoked cookie cannot fall back', async () => {
  const f = await aiClassFixture(admin, runtime);
  const token = randomUUID(),
    teacherToken = randomUUID();
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
    await admin.query(
      'UPDATE classroom_student_sessions SET revoked_at=now() WHERE token_hash=$1',
      [hashSessionToken(token)],
    );
    const revoked = await inject(app, {
      method: 'GET',
      url: '/api/ai/scopes',
      cookies: { ...cookies, asa_session: teacherToken },
      headers,
    });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json()).toMatchObject({ error: { code: 'ai_session_required' } });
  } finally {
    await app.close();
    vi.unstubAllGlobals();
    if (previous === undefined) delete process.env['ASA_SETTINGS_ENCRYPTION_KEY'];
    else process.env['ASA_SETTINGS_ENCRYPTION_KEY'] = previous;
  }
});
