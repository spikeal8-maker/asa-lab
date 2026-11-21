import { fixtureGenerationSql } from './ai-model-policy.fixture';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { lockAiPostgresSuite } from './ai-postgres-suite-lock';
import { aiTextFixture } from './ai-text-history.contract';
import { aiClassFixture } from './ai-student-access.contract';
import { AiAccessService } from '../../apps/api/src/ai-access.service';

let admin: pg.Pool, runtime: pg.Pool;
let unlock: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const urls = ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'].map((name) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} must explicitly name an isolated _test database`);
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
}, 30000);
afterAll(async () => {
  try {
    await runtime?.end();
  } finally {
    await unlock?.();
    await admin?.end();
  }
});

const records = async (owner: string, request: string) =>
  (
    await admin.query(
      'SELECT to_jsonb(j) AS value FROM ai_usage_journal j WHERE owner_principal_id=$1 AND request_id=$2',
      [owner, request],
    )
  ).rows.map((row) => row.value);
const begin = (owner: string, thread: string, request: string) =>
  runtime.query('SELECT ai_usage_begin($1,$2,$3,$4,$5,$6,$7) AS started', [
    owner,
    thread,
    request,
    'chat',
    'json',
    'openai',
    'gpt-5-mini',
  ]);
const finish = (
  owner: string,
  request: string,
  status = 'succeeded',
  input: number | null = null,
) =>
  runtime.query('SELECT ai_usage_finish($1,$2,$3,NULL,$4,NULL,NULL) AS recorded', [
    owner,
    request,
    status,
    input,
  ]);

it('durably records owner/provider/request facts with NULL unknowns; replay and conversation deletion never erase or duplicate usage', async () => {
  const f = await aiTextFixture(admin, runtime),
    request = randomUUID();
  await f.service.send(
    f.owner.principal_id,
    f.thread.id,
    'private-content-not-in-journal',
    request,
  );
  const [row] = await records(f.owner.principal_id, request);
  expect(row).toMatchObject({
    owner_principal_id: f.owner.principal_id,
    account_id: f.owner.account_id,
    seat_id: null,
    request_id: request,
    thread_id: f.thread.id,
    status: 'succeeded',
    operation: 'chat',
    transport: 'json',
    provider: 'openai',
    input_tokens: null,
    output_tokens: null,
    actual_model: null,
  });
  expect(row.started_at).toBeTruthy();
  expect(row.finished_at).toBeTruthy();
  expect(Number(row.duration_ms)).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(row)).not.toContain('private-content');
  expect(
    (
      await f.service.send(
        f.owner.principal_id,
        f.thread.id,
        'private-content-not-in-journal',
        request,
      )
    ).replayed,
  ).toBe(true);
  expect(f.upstream).toHaveBeenCalledOnce();
  expect(await records(f.owner.principal_id, request)).toEqual([row]);
  await f.service.deleteThread(f.owner.principal_id, f.thread.id);
  expect(await records(f.owner.principal_id, request)).toEqual([row]);
});

it('keeps crashes before/after provider begin visibly pending; exact terminal retries are immutable and conflicting NULL/status/count retries fail', async () => {
  const f = await aiTextFixture(admin, runtime),
    request = randomUUID();
  await runtime.query(fixtureGenerationSql, [
    f.owner.principal_id,
    f.thread.id,
    request,
    'pending request',
    await f.version(),
  ]);
  expect((await records(f.owner.principal_id, request))[0]).toMatchObject({
    status: 'admitted',
    started_at: null,
    input_tokens: null,
    provider: null,
    requested_model: null,
  });
  expect((await begin(f.owner.principal_id, f.thread.id, request)).rows[0].started).toBe(true);
  expect((await begin(f.owner.principal_id, f.thread.id, request)).rows[0].started).toBe(false);
  const [running] = await records(f.owner.principal_id, request);
  expect(running).toMatchObject({ status: 'running', finished_at: null, input_tokens: null });
  await expect(begin(f.stranger.principal_id, f.thread.id, request)).rejects.toMatchObject({
    code: '42501',
  });
  await expect(finish(f.stranger.principal_id, request)).rejects.toMatchObject({ code: '42501' });
  await finish(f.owner.principal_id, request);
  const first = await records(f.owner.principal_id, request);
  await finish(f.owner.principal_id, request);
  expect(await records(f.owner.principal_id, request)).toEqual(first);
  await expect(finish(f.owner.principal_id, request, 'succeeded', 0)).rejects.toThrow(
    'AI_USAGE_CONFLICT',
  );
  await expect(finish(f.owner.principal_id, request, 'cancelled')).rejects.toThrow(
    'AI_USAGE_CONFLICT',
  );
  expect(await records(f.owner.principal_id, request)).toEqual(first);
  await runtime.query('SELECT ai_chat_abort($1,$2,$3)', [
    f.owner.principal_id,
    f.thread.id,
    request,
  ]);
});

it('rolls back admission and paid quota if its atomic journal insert fails; no upstream call occurs', async () => {
  const f = await aiTextFixture(admin, runtime),
    request = randomUUID(),
    before = await f.ledgers();
  await admin.query(`CREATE FUNCTION ai_usage_fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${request}'::uuid THEN RAISE EXCEPTION 'AI_USAGE_FIXTURE'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER ai_usage_fixture_fail BEFORE INSERT ON ai_usage_journal FOR EACH ROW EXECUTE FUNCTION ai_usage_fixture_fail()`);
  try {
    await expect(
      f.service.send(f.owner.principal_id, f.thread.id, 'atomic request', request),
    ).rejects.toThrow('AI_USAGE_FIXTURE');
    expect(await records(f.owner.principal_id, request)).toEqual([]);
    expect(await f.ledgers()).toEqual(before);
    expect(f.upstream).not.toHaveBeenCalled();
  } finally {
    await admin.query(
      'DROP TRIGGER ai_usage_fixture_fail ON ai_usage_journal; DROP FUNCTION ai_usage_fixture_fail()',
    );
  }
});

it('records regeneration terminal usage and failed partial response without prompts or raw provider errors', async () => {
  const f = await aiTextFixture(admin, runtime),
    question = await f.seedQuestion('private-source'),
    request = randomUUID();
  f.upstream.mockImplementationOnce(
    async () =>
      new Response(
        'event: response.output_text.delta\ndata: {"delta":"partial-answer"}\n\nevent: response.failed\ndata: {"response":{"model":"gpt-5-mini","usage":{"input_tokens":15,"output_tokens":4}},"error":"private-secret-body"}\n\n',
      ),
  );
  await expect(f.regenerate(question.sourceId, request)).rejects.toMatchObject({
    code: 'ai_provider_error',
  });
  const [row] = await records(f.owner.principal_id, request);
  expect(row).toMatchObject({
    operation: 'regeneration',
    transport: 'sse',
    status: 'failed',
    error_code: 'ai_provider_error',
    input_tokens: 15,
    output_tokens: 4,
    actual_model: 'gpt-5-mini',
  });
  expect(JSON.stringify(row)).not.toMatch(/private-source|partial-answer|private-secret-body/);
  expect(await f.service.requestMessages(f.owner.principal_id, f.thread.id, request)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ content: 'partial-answer', state: 'stopped' }),
    ]),
  );
});

it('keeps Account and Seat journals separate for the same request UUID and denies runtime direct table access', async () => {
  const f = await aiTextFixture(admin, runtime),
    school = await aiClassFixture(admin, runtime),
    request = randomUUID();
  const access = new AiAccessService(runtime),
    current = await access.classroom(school.teacher.principal_id, school.classroomId);
  await access.saveClassroom(school.teacher.principal_id, school.classroomId, {
    kind: 'classroom',
    mode: 'allow',
    minimumRating: 50,
    expectedRevision: current.revision,
    requestId: randomUUID(),
  });
  const seatThread = await f.service.createThread(school.principalId);
  await f.service.send(school.principalId, seatThread.id, 'seat request', request);
  await f.service.send(f.owner.principal_id, f.thread.id, 'account request', request);
  expect((await records(school.principalId, request))[0]).toMatchObject({
    owner_principal_id: school.principalId,
    seat_id: school.seatId,
    account_id: null,
  });
  expect((await records(f.owner.principal_id, request))[0]).toMatchObject({
    owner_principal_id: f.owner.principal_id,
    account_id: f.owner.account_id,
    seat_id: null,
  });
  await expect(runtime.query('SELECT * FROM ai_usage_journal')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(runtime.query('DELETE FROM ai_usage_journal')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(begin(f.owner.principal_id, seatThread.id, randomUUID())).rejects.toMatchObject({
    code: '42501',
  });
  const security = await admin.query(
    `SELECT p.prosecdef,p.proconfig,has_table_privilege('asalab_app','public.ai_usage_journal','INSERT') AS can_insert FROM pg_proc p WHERE p.oid='public.ai_usage_begin(uuid,uuid,uuid,varchar,varchar,varchar,varchar)'::regprocedure`,
  );
  expect(security.rows[0]).toMatchObject({ prosecdef: true, can_insert: false });
  expect(security.rows[0].proconfig.join(',')).toContain('search_path=pg_catalog, pg_temp');
});
