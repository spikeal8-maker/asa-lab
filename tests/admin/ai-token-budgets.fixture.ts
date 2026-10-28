import { randomUUID } from 'node:crypto';
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
