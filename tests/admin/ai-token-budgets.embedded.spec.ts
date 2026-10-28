import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { budgetFixture } from './ai-token-budgets.fixture';
import { aiClassFixture } from './ai-student-access.contract';
import { AiAccessService } from '../../apps/api/src/ai-access.service';
let db: PGlite;
const admin = {
  query: async (sql: string, params: unknown[] = []) =>
    params.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] },
} as unknown as pg.Pool;
const runtime = {
  query: async (sql: string, params: unknown[] = []) => {
    await db.exec('SET ROLE asalab_app');
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec('RESET ROLE');
    }
  },
} as unknown as pg.Pool;
const upstream = vi.fn<typeof fetch>(async (_url, options) => {
  expect(JSON.parse(String(options?.body)).options.num_predict).toBe(-1);
  return new Response(
    JSON.stringify({
      message: { content: 'A complete answer beyond the tiny admission hold' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 7,
      eval_count: 5,
    }) + '\n',
  );
});
beforeAll(async () => {
  db = new PGlite();
  await applyPlan(admin, planMigrations('migrations'));
}, 30000);
afterAll(async () => db?.close());
it('finishes admitted overage fully; new starts fail before dispatch and roll back all admission side effects, replay remains free', async () => {
  const f = await budgetFixture(admin, runtime, upstream);
  await f.limits('1', '1');
  const thread = await f.service.createThread(f.owner),
    request = randomUUID();
  const reply = await f.service.send(f.owner, thread.id, 'question', request);
  expect(JSON.stringify(reply)).toContain('A complete answer beyond');
  const own = await f.store.own(f.owner);
  expect(own.models[0]).toMatchObject({
    used: '12',
    held: '0',
    remaining: '0',
    reason: 'ai_budget_exhausted',
  });
  expect(JSON.stringify(own)).not.toContain('globalLimit');
  const before = (
    await admin.query(
      'SELECT (SELECT count(*) FROM ai_assistant_request_quota) quota,(SELECT count(*) FROM ai_generation_receipts) receipts,(SELECT count(*) FROM ai_assistant_messages) messages',
    )
  ).rows;
  const denied = randomUUID();
  await expect(f.service.send(f.owner, thread.id, 'new', denied)).rejects.toMatchObject({
    code: 'ai_budget_exhausted',
  });
  expect(
    (
      await admin.query(
        'SELECT (SELECT count(*) FROM ai_assistant_request_quota) quota,(SELECT count(*) FROM ai_generation_receipts) receipts,(SELECT count(*) FROM ai_assistant_messages) messages',
      )
    ).rows,
  ).toEqual(before);
  expect((await f.service.send(f.owner, thread.id, 'question', request)).replayed).toBe(true);
  const local = await f.service.ollamaSettings(f.actor);
  await f.service.saveOllamaSettings(
    f.actor,
    { enabled: false, baseUrl: local.baseUrl, model: local.model, revision: local.revision },
    randomUUID(),
  );
  expect((await f.service.send(f.owner, thread.id, 'question', request)).replayed).toBe(true);
  expect(upstream).toHaveBeenCalledOnce();
  await expect(f.service.send(f.owner, thread.id, 'spoof', request)).rejects.toBeTruthy();
  await f.service.deleteThread(f.owner, thread.id);
  expect((await f.store.own(f.owner)).models[0]).toMatchObject({
    used: '12',
    held: '0',
    reason: 'ai_budget_exhausted',
  });
});
it('counts known usage on first enabling caps, supports zero/null, CAS, idempotent writes and administrator-only totals', async () => {
  const f = await budgetFixture(admin, runtime, upstream);
  const thread = await f.service.createThread(f.owner);
  const historical = randomUUID();
  await f.service.send(f.owner, thread.id, 'unlimited', historical);
  // Known pre-budget history keeps its real journal and receipt; enabling a
  // cap must count it even when no reservation existed in that old schema.
  await admin.query('DELETE FROM ai_token_budget_reservations WHERE request_id=$1', [historical]);
  await f.limits(null, '0');
  expect((await f.store.own(f.owner)).models[0]).toMatchObject({
    used: '12',
    reason: 'ai_budget_exhausted',
  });
  const old = await f.store.admin(f.actor),
    requestId = randomUUID();
  const input = {
    configurationVersion: old.configurationVersion,
    requestId,
    models: [{ model: 'ollama-local', globalLimit: null, userLimit: '13' }],
  };
  await f.store.save(f.actor, input);
  await f.store.save(f.actor, input);
  await expect(f.store.save(f.actor, { ...input, requestId: randomUUID() })).rejects.toMatchObject({
    code: 'ai_budget_changed',
  });
  await expect(f.store.admin(f.owner)).rejects.toMatchObject({ code: '42501' });
  expect((await f.store.own(f.other)).models[0]).toMatchObject({
    used: '0',
    remaining: '13',
    available: true,
  });
  await f.limits(null, null);
});
it('keeps unknown usage pending without expiry; lowering caps never cancels admitted answers; exact settle cannot refund twice', async () => {
  const f = await budgetFixture(admin, runtime, upstream);
  await f.limits(null, '10');
  const thread = await f.service.createThread(f.owner),
    request = randomUUID();
  await f.begin(f.owner, thread.id, request);
  await f.running(f.owner, thread.id, request);
  await f.limits(null, '0');
  await f.finish(f.owner, thread.id, request, null, 3);
  const state = (
    await admin.query('SELECT state,amount FROM ai_token_budget_reservations WHERE request_id=$1', [
      request,
    ])
  ).rows[0];
  expect(state).toMatchObject({ state: 'pending_unknown', amount: 10 });
  await runtime.query("SELECT ai_usage_finish($1,$2,'succeeded',NULL,NULL,3,'qwen3:4b')", [
    f.owner,
    request,
  ]);
  await expect(
    runtime.query("SELECT ai_usage_finish($1,$2,'succeeded',NULL,0,3,'qwen3:4b')", [
      f.owner,
      request,
    ]),
  ).rejects.toThrow('AI_USAGE_CONFLICT');
  await f.limits(null, '10');
  expect((await f.store.own(f.owner)).models[0]).toMatchObject({
    held: '10',
    pendingUnknown: true,
    reason: 'ai_budget_pending',
  });
  expect((await f.store.own(f.other)).models[0]?.available).toBe(true);
  await f.service.deleteThread(f.owner, thread.id);
  expect((await f.store.own(f.owner)).models[0]).toMatchObject({
    held: '10',
    pendingUnknown: true,
  });
  await f.limits(null, null);
});
it('freezes customized admission, rejects old workers, and budgets a hidden model before publication without granting visibility', async () => {
  const f = await budgetFixture(admin, runtime, upstream),
    thread = await f.service.createThread(f.owner);
  expect(
    (await runtime.query('SELECT ai_generation_policy_runtime() AS value')).rows[0].value
      .customized,
  ).toBe(true);
  await expect(
    runtime.query(
      "SELECT ai_text_begin_local($1,$2,$3,'legacy',(SELECT revision FROM ai_ollama_runtime()))",
      [f.owner, thread.id, randomUUID()],
    ),
  ).rejects.toThrow('AI_POLICY_WORKER_REQUIRED');
  const p = await f.service.generationPolicy(f.actor);
  await f.service.saveGenerationPolicy(f.actor, {
    configurationVersion: p.configurationVersion,
    systemPrompt: p.systemPrompt,
    allowedModels: [],
    defaultModel: null,
    requestId: randomUUID(),
  });
  await f.limits(null, '0');
  expect((await f.store.own(f.owner)).models).toEqual([]);
  expect(
    (await f.store.admin(f.actor)).models.find((m) => m.model === 'deepseek-flash'),
  ).toBeTruthy();
  const hidden = await f.service.generationPolicy(f.actor);
  expect(hidden.allowedModels).toEqual([]);
  await f.service.saveGenerationPolicy(f.actor, {
    configurationVersion: hidden.configurationVersion,
    systemPrompt: hidden.systemPrompt,
    allowedModels: ['ollama-local'],
    defaultModel: 'ollama-local',
    requestId: randomUUID(),
  });
  await expect(
    f.service.send(f.owner, thread.id, 'first published request', randomUUID()),
  ).rejects.toMatchObject({ code: 'ai_budget_exhausted' });
  await f.limits(null, null);
});
it('separates Account and Seat budgets and retains teacher denial independently', async () => {
  const f = await budgetFixture(admin, runtime, upstream),
    school = await aiClassFixture(admin, runtime),
    access = new AiAccessService(runtime);
  await access.saveClassroom(school.teacher.principal_id, school.classroomId, {
    kind: 'classroom',
    mode: 'allow',
    minimumRating: 50,
    expectedRevision: 0,
    requestId: randomUUID(),
  });
  await f.limits(null, '1');
  const thread = await f.service.createThread(school.principalId);
  await f.service.send(school.principalId, thread.id, 'seat answer', randomUUID());
  expect((await f.store.own(school.principalId)).models[0]).toMatchObject({
    used: '12',
    available: false,
  });
  expect((await f.store.own(school.teacher.principal_id)).models[0]).toMatchObject({
    used: '0',
    available: true,
  });
  await access.saveClassroom(school.teacher.principal_id, school.classroomId, {
    kind: 'classroom',
    mode: 'deny',
    minimumRating: 50,
    expectedRevision: 1,
    requestId: randomUUID(),
  });
  await f.limits(null, null);
  await expect(f.begin(school.principalId, thread.id, randomUUID())).rejects.toBeTruthy();
});
it('shares one budget hold across native rounds, settles the total once and finishes even after caps are lowered during dispatch', async () => {
  let rounds = 0;
  let f: Awaited<ReturnType<typeof budgetFixture>>;
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/api/show'))
      return new Response(JSON.stringify({ capabilities: ['completion', 'tools'] }));
    if (String(url).includes('/search?'))
      return new Response(
        JSON.stringify({
          results: [{ title: 'Source', url: 'https://example.org/source', content: 'fact' }],
        }),
      );
    expect(String(url)).toBe('http://127.0.0.1:11434/api/chat');
    expect(JSON.parse(String(options?.body)).options.num_predict).toBe(-1);
    rounds++;
    if (rounds === 1) {
      await f.limits(null, '0');
      return new Response(
        JSON.stringify({
          message: {
            tool_calls: [{ function: { name: 'web_search', arguments: { query: 'facts' } } }],
          },
          done: true,
          prompt_eval_count: 10,
          eval_count: 2,
        }) + '\n',
      );
    }
    return new Response(
      JSON.stringify({
        message: { content: 'Complete final tool answer' },
        done: true,
        prompt_eval_count: 20,
        eval_count: 5,
      }) + '\n',
    );
  });
  f = await budgetFixture(admin, runtime, fetcher);
  await admin.query('UPDATE ai_web_search_settings SET enabled=true WHERE singleton_key');
  await f.limits(null, '1');
  const thread = await f.service.createThread(f.owner),
    request = randomUUID();
  const answer = await f.service.sendStream(
    f.owner,
    thread.id,
    'Find facts',
    request,
    () => undefined,
    new AbortController().signal,
    'ollama-local',
    undefined,
    [],
    'auto',
  );
  expect(JSON.stringify(answer)).toContain('Complete final tool answer');
  expect(rounds).toBe(2);
  expect((await f.store.own(f.owner)).models[0]).toMatchObject({ used: '37', held: '0' });
  expect(
    (
      await admin.query(
        'SELECT count(*)::text n FROM ai_token_budget_reservations WHERE request_id=$1',
        [request],
      )
    ).rows[0].n,
  ).toBe('1');
  await f.limits(null, null);
});
it('pins late settlement to the admission month and treats unmapped historical unknown honestly', async () => {
  const f = await budgetFixture(admin, runtime, upstream),
    thread = await f.service.createThread(f.owner),
    request = randomUUID();
  await f.begin(f.owner, thread.id, request);
  await f.running(f.owner, thread.id, request);
  await admin.query(
    "UPDATE ai_token_budget_reservations SET month_start=date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'-interval '1 month' WHERE request_id=$1",
    [request],
  );
  await f.finish(f.owner, thread.id, request, 9, 8);
  expect((await f.store.own(f.owner)).models[0]).toMatchObject({ used: '0', held: '0' });
  const historic = await f.service.createThread(f.other),
    unknown = randomUUID();
  await f.begin(f.other, historic.id, unknown);
  // Upgrade fixture: preserve its real admission/quota row, remove only the
  // new migration's metadata to reproduce a pre-budget, pre-dispatch crash.
  await admin.query('DELETE FROM ai_token_budget_reservations WHERE request_id=$1', [unknown]);
  await admin.query('DELETE FROM ai_generation_receipts WHERE request_id=$1', [unknown]);
  await f.limits('100000', null);
  expect((await f.store.own(f.owner)).models[0]).toMatchObject({ reason: 'ai_budget_pending' });
  await expect(f.begin(f.owner, thread.id, randomUUID())).rejects.toThrow('AI_BUDGET_PENDING');
});
