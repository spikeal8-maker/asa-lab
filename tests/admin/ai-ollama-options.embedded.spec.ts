import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { publishFixtureModels } from './ai-model-policy.fixture';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
let db: PGlite;
const client = () => ({
  query: async (sql: string, params?: unknown[]) =>
    params?.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] },
});
const pool = {
  query: async (sql: string, params: unknown[] = []) => {
    await db.exec('SET ROLE asalab_app');
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec('RESET ROLE');
    }
  },
} as unknown as pg.Pool;
async function identity(admin = false) {
  const account = (
    await db.query<{ id: string }>(
      "INSERT INTO accounts(email,password_hash,birth_date,country) VALUES($1,'test','1990-01-01','RU') RETURNING id",
      [randomUUID() + '@example.test'],
    )
  ).rows[0]!.id;
  const owner = (
    await db.query<{ id: string }>(
      "INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id",
      [account],
    )
  ).rows[0]!.id;
  if (admin)
    await db.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','admin-stage-a-2026-08','admin')",
      [account],
    );
  return owner;
}
beforeAll(async () => {
  db = new PGlite();
  const plan = planMigrations('migrations');
  await applyPlan(
    client(),
    plan.filter((m: { version: string }) => m.version < '0282'),
  );
  const actor = await identity(true);
  await db.query(
    "SELECT ai_ollama_admin_set($1,true,'http://127.0.0.1:11434','qwen3.8:27b',1,'legacy-qwen')",
    [actor],
  );
  const before = (await db.query('SELECT enabled,base_url,model,revision FROM ai_ollama_settings'))
    .rows;
  const ledger = (await db.query('SELECT version,checksum FROM schema_migrations ORDER BY version'))
    .rows;
  await applyPlan(
    client(),
    plan.filter((m: { version: string }) => m.version >= '0282'),
  );
  expect(
    (await db.query('SELECT enabled,base_url,model,revision FROM ai_ollama_settings')).rows,
  ).toEqual(before);
  expect(
    (await db.query('SELECT thinking,context_tokens FROM ai_ollama_settings')).rows[0],
  ).toEqual({ thinking: null, context_tokens: null });
  expect(
    (await db.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows.slice(
      0,
      ledger.length,
    ),
  ).toEqual(ledger);
}, 30000);
afterAll(async () => db?.close());

it('persists options with the same revision, denies non-admin and rejects stale or invalid writes', async () => {
  const admin = await identity(true),
    stranger = await identity();
  const service = new AiChatService(pool, {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          capabilities: ['completion', 'thinking'],
          thinking: { values: [false, 'low', 'medium', 'xhigh'], default: 'medium' },
          model_info: { 'qwen35.context_length': 262144 },
        }),
      ),
  });
  const initial = await service.ollamaSettings(admin);
  expect(initial).toMatchObject({ thinking: 'xhigh', contextTokens: 120000 });
  const input = { ...initial, thinking: 'xhigh', contextTokens: 120000 };
  await expect(service.saveOllamaSettings(stranger, input, 'denied')).rejects.toMatchObject({
    code: 'ai_admin_denied',
  });
  const saved = await service.saveOllamaSettings(admin, input, 'save-options');
  expect(saved).toMatchObject({
    thinking: 'xhigh',
    contextTokens: 120000,
    revision: initial.revision + 1,
  });
  await expect(service.saveOllamaSettings(admin, input, 'stale')).rejects.toMatchObject({
    code: 'ai_ollama_config_changed',
  });
  await expect(
    service.saveOllamaSettings(admin, { ...saved, contextTokens: 0 }, 'invalid'),
  ).rejects.toMatchObject({ code: 'ai_ollama_config_invalid' });
  expect((await pool.query('SELECT * FROM ai_ollama_runtime_v2()')).rows[0]).toMatchObject({
    thinking: 'xhigh',
    context_tokens: 120000,
  });
  const offline = new AiChatService(pool, {
    fetchImpl: async () => {
      throw new Error('Offline model must not be contacted');
    },
  });
  const disabled = await offline.saveOllamaSettings(
    admin,
    {
      enabled: false,
      baseUrl: saved.baseUrl,
      model: saved.model,
      revision: saved.revision,
    },
    'old-client-disable',
  );
  expect(disabled).toMatchObject({ enabled: false, thinking: 'xhigh', contextTokens: 120000 });
  await expect(pool.query('SELECT * FROM ai_ollama_settings')).rejects.toMatchObject({
    code: '42501',
  });
});

it('applies saved controls to real JSON and native streaming service paths without changing paid admission', async () => {
  const actor = await identity(true),
    owner = await identity();
  const requests: Record<string, unknown>[] = [];
  const service = new AiChatService(pool, {
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/api/show'))
        return new Response(
          JSON.stringify({
            capabilities: ['completion', 'vision', 'tools', 'thinking'],
            thinking: { values: [false, 'low', 'medium', 'xhigh'], default: 'medium' },
            model_info: { 'qwen35.context_length': 262144 },
          }),
        );
      if (!String(url).endsWith('/api/chat')) throw new Error('Unexpected external request');
      requests.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          message: { content: 'saved controls applied' },
          prompt_eval_count: 3,
          eval_count: 4,
          done: true,
        }) + '\n',
      );
    },
  });
  const current = await service.ollamaSettings(actor);
  await service.saveOllamaSettings(
    actor,
    { ...current, enabled: true, thinking: 'low', contextTokens: 65536 },
    'runtime-controls',
  );
  await publishFixtureModels(service, actor, ['ollama-local']);
  const web = await service.webSearchAdmin(actor);
  await service.saveWebSearch(
    actor,
    {
      enabled: true,
      weatherEnabled: true,
      operationsPerHour: web.operationsPerHour,
      configurationVersion: web.configurationVersion,
    },
    'native-weather',
  );
  const paid = (await db.query('SELECT count(*)::int n FROM ai_paid_operation_quota')).rows;
  const thread = await service.createThread(owner);
  await service.send(owner, thread.id, 'JSON settings', randomUUID());
  const deltas: string[] = [];
  await service.sendStream(
    owner,
    thread.id,
    'SSE settings',
    randomUUID(),
    (delta) => deltas.push(delta),
    new AbortController().signal,
    'ollama-local',
    undefined,
    [],
    'auto',
  );
  expect(deltas.join('')).toBe('saved controls applied');
  expect(requests).toHaveLength(2);
  for (const request of requests)
    expect(request).toMatchObject({ think: 'low', options: { num_ctx: 65536, num_predict: -1 } });
  expect(Array.isArray(requests[1]!.tools)).toBe(true);
  expect((await db.query('SELECT count(*)::int n FROM ai_paid_operation_quota')).rows).toEqual(
    paid,
  );
});
