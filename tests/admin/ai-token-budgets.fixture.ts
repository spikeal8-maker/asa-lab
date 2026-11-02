import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type pg from 'pg';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
import { AiTokenBudgetStore } from '../../apps/api/src/ai-token-budgets';

export async function budgetIdentity(db: pg.Pool, elevated = false) {
  const account = (
    await db.query<{ id: string }>(
      "INSERT INTO accounts(email,password_hash,birth_date,country) VALUES($1,'budget-fixture','1990-01-01','RU') RETURNING id",
      [randomUUID() + '@example.test'],
    )
  ).rows[0]!.id;
  const id = (
    await db.query<{ id: string }>(
      "INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id",
      [account],
    )
  ).rows[0]!.id;
  if (elevated)
    await db.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
      [account],
    );
  return id;
}
export async function budgetFixture(admin: pg.Pool, runtime: pg.Pool, fetchImpl: typeof fetch) {
  const actor = await budgetIdentity(admin, true),
    owner = await budgetIdentity(admin),
    other = await budgetIdentity(admin);
  const service = new AiChatService(runtime, { fetchImpl });
  const store = new AiTokenBudgetStore(runtime);
  const local = await service.ollamaSettings(actor);
  await service.saveOllamaSettings(
    actor,
    {
      enabled: true,
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen3:4b',
      revision: local.revision,
    },
    randomUUID(),
  );
  const policy = await service.generationPolicy(actor);
  await service.saveGenerationPolicy(actor, {
    configurationVersion: policy.configurationVersion,
    systemPrompt: 'Budget fixture',
    allowedModels: ['ollama-local'],
    defaultModel: 'ollama-local',
    requestId: randomUUID(),
  });
  async function limits(globalLimit: string | null, userLimit: string | null) {
    const current = await store.admin(actor);
    return store.save(actor, {
      configurationVersion: current.configurationVersion,
      requestId: randomUUID(),
      models: [{ model: 'ollama-local', globalLimit, userLimit }],
    });
  }
  const admissionSql = `SELECT ai_generation_begin($1,$2,$3,jsonb_build_object('text',$4::text,'model',NULL,'source',NULL,'uploads','[]'::jsonb,'webSearchMode',NULL,'weatherCity',NULL),'ollama-local',(ai_generation_policy_runtime()->>'revision')::bigint,(SELECT revision FROM ai_ollama_runtime())) AS admitted`;
  // Read local revision using the same supported runtime accessor as the service.
  async function begin(who: string, thread: string, request: string, text = 'question') {
    return runtime.query(admissionSql, [who, thread, request, text]);
  }
  async function running(who: string, thread: string, request: string) {
    return runtime.query("SELECT ai_usage_begin($1,$2,$3,'chat','sse','ollama','qwen3:4b')", [
      who,
      thread,
      request,
    ]);
  }
  async function finish(
    who: string,
    thread: string,
    request: string,
    input: number | null,
    output: number | null,
  ) {
    await runtime.query("SELECT ai_chat_finish($1,$2,$3,'complete answer','complete')", [
      who,
      thread,
      request,
    ]);
    return runtime.query("SELECT ai_usage_finish($1,$2,'succeeded',NULL,$3,$4,'qwen3:4b')", [
      who,
      request,
      input,
      output,
    ]);
  }
  await limits(null, null);
  return { actor, owner, other, service, store, limits, begin, running, finish, admissionSql };
}

// Shared embedded/real-PostgreSQL proof: configure a newly selected connection
// before adding it to the user-facing generation policy. No upstream is called.
export async function unpublishedPolzaBudgetFixture(
  admin: pg.Pool,
  runtime: pg.Pool,
  actor: string,
  owner: string,
) {
  const store = new AiTokenBudgetStore(runtime);
  const before = await store.admin(actor);
  const policyBefore = (await admin.query('SELECT allowed_models FROM ai_generation_policy')).rows;
  await admin.query(
    `UPDATE ai_polza_settings SET enabled=true,api_key_ciphertext='isolated-budget-key',api_key_iv='iv',api_key_auth_tag='tag',key_fingerprint='budget-fixture' WHERE singleton_key`,
  );
  const revision = (await admin.query('SELECT revision FROM ai_polza_settings')).rows[0].revision;
  const model = 'polza/budget/unpublished';
  await runtime.query('SELECT ai_polza_catalog_apply($1,$2,$3::jsonb)', [
    actor,
    revision,
    JSON.stringify([
      {
        id: model,
        upstream: 'budget/unpublished',
        label: 'Unpublished budget fixture',
        kind: 'chat',
        vision: false,
        tools: true,
        maxOutputTokens: 1024,
      },
      {
        id: 'polza/budget/unselected',
        upstream: 'budget/unselected',
        label: 'Unselected',
        kind: 'chat',
        vision: false,
        tools: false,
        maxOutputTokens: 1024,
      },
      {
        id: 'polza/budget/stt',
        upstream: 'budget/stt',
        label: 'Speech',
        kind: 'stt',
        vision: false,
        tools: false,
        maxOutputTokens: 1024,
      },
    ]),
  ]);
  const version = (await admin.query('SELECT revision FROM ai_polza_catalog_state')).rows[0]
    .revision;
  await runtime.query('SELECT ai_polza_models_select($1,$2,$3::jsonb)', [
    actor,
    version,
    JSON.stringify([model]),
  ]);
  const current = await store.admin(actor);
  expect(current.models.filter((row) => row.model !== model)).toEqual(before.models);
  expect(current.models.find((row) => row.model === model)).toMatchObject({
    globalLimit: null,
    userLimit: null,
    used: '0',
    held: '0',
  });
  expect(
    current.models.some((row) =>
      ['polza/budget/unselected', 'polza/budget/stt'].includes(row.model),
    ),
  ).toBe(false);
  await expect(runtime.query('SELECT ai_token_budgets_admin($1)', [owner])).rejects.toMatchObject({
    code: '42501',
  });
  await admin.query(
    "UPDATE ai_polza_catalog_state SET credential_fingerprint='stale' WHERE singleton_key",
  );
  expect((await store.admin(actor)).models.some((row) => row.model === model)).toBe(false);
  await admin.query(
    "UPDATE ai_polza_catalog_state SET credential_fingerprint='budget-fixture' WHERE singleton_key",
  );
  const saved = await store.save(actor, {
    configurationVersion: current.configurationVersion,
    requestId: randomUUID(),
    models: [
      ...current.models
        .filter((row) => row.model !== model)
        .map(({ model, globalLimit, userLimit }) => ({ model, globalLimit, userLimit })),
      { model, globalLimit: '123', userLimit: '45' },
    ],
  });
  expect(saved.models.find((row) => row.model === model)).toMatchObject({
    globalLimit: '123',
    userLimit: '45',
  });
  expect((await admin.query('SELECT allowed_models FROM ai_generation_policy')).rows).toEqual(
    policyBefore,
  );
  await store.save(actor, {
    configurationVersion: saved.configurationVersion,
    requestId: randomUUID(),
    models: before.models.map(({ model, globalLimit, userLimit }) => ({
      model,
      globalLimit,
      userLimit,
    })),
  });
}
