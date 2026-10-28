import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { AiChatService } from '../../apps/api/src/ai-chat.service';
export async function publishFixtureModels(
  service: AiChatService,
  actor: string,
  models: string[],
) {
  const policy = await service.generationPolicy(actor);
  return service.saveGenerationPolicy(actor, {
    configurationVersion: policy.configurationVersion,
    systemPrompt: policy.systemPrompt,
    allowedModels: models,
    defaultModel: models[0] ?? null,
    requestId: randomUUID(),
  });
}
/** Supported SQL admission, not an invented receipt. Runs normal owner/class/quota checks. */
export const fixtureGenerationSql = `SELECT ai_generation_begin($1,$2,$3,jsonb_build_object('text',$4::text,'model',NULL,'source',NULL,'uploads','[]'::jsonb,'webSearchMode',NULL,'weatherCity',NULL),(ai_generation_policy_runtime()->>'defaultModel')::varchar,(ai_generation_policy_runtime()->>'revision')::bigint,$5::bigint) AS admitted`;
export async function publishFixturePolicy(runtime: pg.Pool, actor: string, model: string) {
  const row = (
    await runtime.query<{ value: { revision: number } }>(
      'SELECT ai_generation_policy_runtime() AS value',
    )
  ).rows[0]!.value;
  await runtime.query('SELECT ai_generation_policy_set($1,$2::jsonb,$3::uuid)', [
    actor,
    JSON.stringify({
      configurationVersion: Number(row.revision),
      systemPrompt: 'Тестовый помощник',
      allowedModels: [model],
      defaultModel: model,
    }),
    randomUUID(),
  ]);
}
