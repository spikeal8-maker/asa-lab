import { lockAiPostgresSuite } from './ai-postgres-suite-lock';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
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

/** Current SQL boundaries for the older PG race fixtures; no synthetic receipts. */
export const fixtureChatSql = `SELECT ai_generation_begin($1,$2,$3,jsonb_build_object('text',$4::text,'model',NULL,'source',NULL,'uploads','[]'::jsonb,'webSearchMode',NULL,'weatherCity',NULL),(ai_generation_policy_runtime()->>'defaultModel')::varchar,(ai_generation_policy_runtime()->>'revision')::bigint,(SELECT configuration_version FROM ai_runtime_config())) AS admitted`;
export const fixtureAttachmentSql = `SELECT ai_generation_begin($1,$2,$3,jsonb_build_object('text',$4::text,'model',NULL,'source',NULL,'uploads',to_jsonb($6::uuid[]),'webSearchMode',NULL,'weatherCity',NULL),(ai_generation_policy_runtime()->>'defaultModel')::varchar,(ai_generation_policy_runtime()->>'revision')::bigint,$5::bigint) AS admitted`;
export const fixtureRegenerationSql = `SELECT ai_generation_begin($1,$2,$3,jsonb_build_object('text','','model','gpt-5-mini','source',$4::text,'uploads','[]'::jsonb,'webSearchMode',NULL,'weatherCity',NULL),'gpt-5-mini',(ai_generation_policy_runtime()->>'revision')::bigint,$5::bigint) AS admitted`;

/** History probes need retained pre-journal shapes, but must admit with today's real guards.
 * All temporary global settings and these test rows roll back together after the assertions.
 * The ordinary AI suite lock prevents another fixture from racing the temporary configuration.
 */
export async function withLocalFixtureAdmissions<T>(
  admin: pg.Pool,
  actor: string,
  owner: string,
  requests: string[],
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const unlock = await lockAiPostgresSuite(admin);
  let client: pg.PoolClient | undefined;
  try {
    client = await admin.connect();
    await client.query('BEGIN');
    const pool = { query: client.query.bind(client) } as unknown as pg.Pool;
    const service = new AiChatService(pool, {
      fetchImpl: async () => {
        throw new Error('History fixtures never call providers');
      },
    });
    const local = await service.ollamaSettings(actor);
    await service.saveOllamaSettings(
      actor,
      {
        enabled: true,
        model: 'fixture:history',
        baseUrl: 'http://127.0.0.1:11434',
        revision: local.revision,
      },
      randomUUID(),
    );
    await publishFixtureModels(service, actor, ['ollama-local']);
    const revision = Number(
      (await client.query('SELECT * FROM ai_ollama_runtime()')).rows[0].revision,
    );
    const thread = await service.createThread(owner);
    for (const request of requests) {
      await client.query(fixtureGenerationSql, [
        owner,
        thread.id,
        request,
        'Retained historical request',
        revision,
      ]);
      await client.query('SELECT ai_chat_abort($1,$2,$3)', [owner, thread.id, request]);
    }
    return await run(client);
  } finally {
    try {
      if (client) await client.query('ROLLBACK');
    } finally {
      client?.release();
      await unlock();
    }
  }
}
