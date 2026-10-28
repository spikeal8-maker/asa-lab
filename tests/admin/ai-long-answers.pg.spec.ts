import { fixtureGenerationSql, publishFixtureModels } from './ai-model-policy.fixture';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { lockAiPostgresSuite } from './ai-postgres-suite-lock';
import { aiTextFixture } from './ai-text-history.contract';

let admin: pg.Pool, runtime: pg.Pool;
let unlock: (() => Promise<void>) | undefined;
beforeAll(async () => {
  for (const name of ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL']) {
    const value = process.env[name];
    if (!value || !new URL(value).pathname.endsWith('_test'))
      throw new Error('An explicitly isolated _test database is required');
  }
  admin = testAdminPool();
  runtime = testAppPool();
  unlock = await lockAiPostgresSuite(admin);
}, 30000);
afterAll(async () => {
  await runtime?.end();
  await unlock?.();
  await admin?.end();
});

it('preserves a complete long code answer, owner isolation and idempotent replay', async () => {
  const f = await aiTextFixture(admin, runtime);
  await admin.query(
    "UPDATE ai_ollama_settings SET enabled=true,model='fixture:long-answer' WHERE singleton_key",
  );
  const revision = Number(
    (await runtime.query('SELECT * FROM ai_ollama_runtime()')).rows[0].revision,
  );
  await publishFixtureModels(f.service, f.platform.principal_id, ['ollama-local']);
  const request = randomUUID();
  const args = [f.owner.principal_id, f.thread.id, request, 'Write full code', revision];
  expect((await runtime.query(fixtureGenerationSql, args)).rows[0].admitted).toBe(true);
  const lease = await admin.query(
    "SELECT busy_until > clock_timestamp() + interval '1800 seconds' AS ok FROM ai_assistant_threads WHERE id=$1",
    [f.thread.id],
  );
  expect(lease.rows[0].ok).toBe(true);
  const answer = "function completeCode() { return 'END'; }\n".repeat(2000);
  await expect(
    runtime.query('SELECT ai_chat_finish($1,$2,$3,$4,$5)', [
      f.stranger.principal_id,
      f.thread.id,
      request,
      answer,
      'complete',
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  await runtime.query('SELECT ai_chat_finish($1,$2,$3,$4,$5)', [
    f.owner.principal_id,
    f.thread.id,
    request,
    answer,
    'complete',
  ]);
  expect((await f.service.messages(f.owner.principal_id, f.thread.id)).at(-1)?.content).toBe(
    answer,
  );
  expect((await runtime.query(fixtureGenerationSql, args)).rows[0].admitted).toBe(false);
  const next = randomUUID();
  await runtime.query(fixtureGenerationSql, [
    f.owner.principal_id,
    f.thread.id,
    next,
    'Continue the code',
    revision,
  ]);
  const context = await runtime.query('SELECT * FROM ai_text_generation_context($1,$2,$3)', [
    f.owner.principal_id,
    f.thread.id,
    next,
  ]);
  expect(context.rows.some((row) => row.content === answer)).toBe(true);
});
