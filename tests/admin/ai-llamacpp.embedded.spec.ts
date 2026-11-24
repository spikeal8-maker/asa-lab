import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { aiIdentity, type AiIdentity } from './ai-student-access.contract';

let db: PGlite;
let platform: AiIdentity;
let owner: AiIdentity;
let stranger: AiIdentity;
let service: AiChatService;
let queue: Promise<unknown> = Promise.resolve();
const admin = {
  query: (sql: string, params: unknown[] = []) => db.query(sql, params),
} as unknown as pg.Pool;
const runtimeQuery = (sql: string, params: unknown[] = []) => {
  const result = queue.then(async () => {
    await db.exec('SET ROLE asalab_app');
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec('RESET ROLE');
    }
  });
  queue = result.catch(() => undefined);
  return result;
};
// Embedded PostgreSQL provides a real session advisory lock. Cross-session
// contention is asserted separately in ai-llamacpp.pg.spec.ts, never simulated here.
const pool = {
  query: runtimeQuery,
  connect: async () =>
    Object.assign(new EventEmitter(), { query: runtimeQuery, release: () => undefined }),
} as unknown as pg.Pool;
const KEY = 'llamacpp-fixture-secret-never-log';
const MODEL = 'fixture:qwen';
let expectedKey: string | null = KEY;
let responseText = 'Ответ локальной модели.';
let mode: 'normal' | 'auth' | 'tools' | 'cancel' | 'network' = 'normal';
let modelList = [MODEL];
const packet = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n';
const sends = vi.fn<typeof fetch>(async (raw, options) => {
  const url = new URL(String(raw));
  if (mode === 'network') throw new TypeError('fixture network failure');
  if (mode === 'auth') return new Response('private upstream diagnostic', { status: 401 });
  if (url.pathname === '/v1/models')
    return Response.json({
      data: modelList.map((id) => ({ id, meta: { n_ctx: 212992, n_ctx_train: 262144 } })),
    });
  if (url.pathname === '/props')
    return Response.json({ default_generation_settings: { n_ctx: 212992 }, total_slots: 1 });
  expect(url.pathname).toBe('/v1/chat/completions');
  const body = JSON.parse(String(options?.body));
  expect(body.model).toBe(MODEL);
  expect(new Headers(options?.headers).get('authorization')).toBe(
    expectedKey ? 'Bearer ' + expectedKey : null,
  );
  if (!body.stream) {
    return Response.json({
      model: MODEL,
      choices: [
        {
          finish_reason: body.tools ? 'tool_calls' : 'stop',
          message: body.tools
            ? {
                content: null,
                tool_calls: [
                  {
                    id: 'probe-1',
                    type: 'function',
                    function: {
                      name: 'web_search',
                      arguments: JSON.stringify({ query: 'asa_llamacpp_probe' }),
                    },
                  },
                ],
              }
            : { content: 'OK' },
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 3 },
    });
  }
  const usage = packet({
    model: MODEL,
    choices: [],
    usage: { prompt_tokens: 19, completion_tokens: 7 },
  });
  if (mode === 'cancel') {
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              packet({ choices: [{ delta: { content: 'Начало ответа' }, finish_reason: null }] }),
            ),
          );
        },
      }),
    );
  }
  if (
    mode === 'tools' &&
    !body.messages.some((message: { role: string }) => message.role === 'tool')
  ) {
    expect(
      body.tools.some(
        (tool: { function: { name: string } }) => tool.function.name === 'create_working_file',
      ),
    ).toBe(true);
    return new Response(
      packet({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'file-call',
                  type: 'function',
                  function: {
                    name: 'create_working_file',
                    arguments: JSON.stringify({
                      name: 'demo.txt',
                      content: 'Файл создан локальной моделью.',
                    }),
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }) +
        usage +
        'data: [DONE]\n\n',
    );
  }
  return new Response(
    packet({
      choices: [{ delta: { content: responseText }, finish_reason: 'stop' }],
    }) +
      usage +
      'data: [DONE]\n\n',
  );
});

async function draft() {
  const current = await service.llamaCppConfig(platform.principal_id);
  return {
    ...current,
    baseUrl: 'http://127.0.0.1:8080',
    enabled: true,
    model: MODEL,
    contextTokens: 212992,
    temperature: 0.5,
    topP: 0.9,
    maxOutputTokens: 8192,
  };
}

beforeAll(async () => {
  db = new PGlite();
  await applyPlan(
    {
      query: async (sql: string, params?: unknown[]) =>
        params?.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] },
    },
    planMigrations('migrations'),
  );
  platform = await aiIdentity(admin);
  owner = await aiIdentity(admin);
  stranger = await aiIdentity(admin);
  await db.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
    [platform.account_id],
  );
  service = new AiChatService(pool, { encryptionKey: '4d'.repeat(32), fetchImpl: sends });
}, 60000);
afterAll(async () => {
  await db?.close();
});

it('applies the whole migration chain and keeps keys behind the admin and runtime boundaries', async () => {
  await expect(pool.query('SELECT * FROM public.ai_llamacpp_settings')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(service.llamaCppConfig(owner.principal_id)).rejects.toMatchObject({ status: 403 });
  expect(await service.llamaCppConfig(platform.principal_id)).toMatchObject({
    enabled: false,
    apiKeyConfigured: false,
    confirmedContextTokens: null,
  });
});

it('discovers multiple models then verifies and saves an encrypted independent provider', async () => {
  const input = { ...(await draft()), apiKey: KEY, apiKeyEndpoint: 'http://127.0.0.1:8080' };
  modelList = [MODEL, 'fixture:other'];
  expect(
    (await service.llamaCppModels(platform.principal_id, input)).models.map((model) => model.id),
  ).toEqual(modelList);
  modelList = [MODEL];
  const ollamaBefore = await service.ollamaSettings(platform.principal_id);
  const result = await service.applyLlamaCppSettings(platform.principal_id, input, randomUUID());
  expect(result).toMatchObject({
    verified: true,
    config: {
      model: MODEL,
      contextTokens: 212992,
      confirmedContextTokens: 212992,
      contextSource: 'metadata',
      toolsVerified: true,
      apiKeyConfigured: true,
    },
  });
  expect(JSON.stringify(result)).not.toContain(KEY);
  const stored = (
    await db.query<{ api_key_ciphertext: string }>(
      'SELECT api_key_ciphertext FROM ai_llamacpp_settings',
    )
  ).rows[0]!;
  expect(stored.api_key_ciphertext).toBeTruthy();
  expect(stored.api_key_ciphertext).not.toContain(KEY);
  expect(await service.ollamaSettings(platform.principal_id)).toEqual(ollamaBefore);
  expect(
    await new AiChatService(pool, { encryptionKey: '4d'.repeat(32) }).llamaCppConfig(
      platform.principal_id,
    ),
  ).toEqual(result.config);
  const policy = await service.generationPolicy(platform.principal_id);
  await service.saveGenerationPolicy(platform.principal_id, {
    configurationVersion: policy.configurationVersion,
    systemPrompt: 'Ответь на вопрос. {{tools}}',
    defaultModel: 'llamacpp-local',
    allowedModels: ['llamacpp-local'],
    requestId: randomUUID(),
  });
  expect((await service.status()).availableModels).toEqual(['llamacpp-local']);
});

it('replays checked apply without repeating either generation probe and rejects changed payload', async () => {
  const input = await draft();
  const request = randomUUID();
  const result = await service.applyLlamaCppSettings(platform.principal_id, input, request);
  const calls = sends.mock.calls.length;
  expect(await service.applyLlamaCppSettings(platform.principal_id, input, request)).toEqual(
    result,
  );
  expect(sends.mock.calls).toHaveLength(calls);
  await expect(
    service.applyLlamaCppSettings(platform.principal_id, { ...input, temperature: 0.7 }, request),
  ).rejects.toMatchObject({ code: 'ai_llamacpp_replay_conflict' });
  expect(sends.mock.calls).toHaveLength(calls);
});

it.each(['auth', 'network'] as const)(
  'keeps the last working configuration after %s and does not repeat a failed probe',
  async (failure) => {
    const input = await draft();
    const before = await service.llamaCppConfig(platform.principal_id);
    const request = randomUUID();
    mode = failure;
    try {
      await expect(
        service.applyLlamaCppSettings(platform.principal_id, input, request),
      ).rejects.toMatchObject({
        code: failure === 'auth' ? 'ai_llamacpp_auth' : 'ai_llamacpp_unreachable',
      });
      const calls = sends.mock.calls.length;
      await expect(
        service.applyLlamaCppSettings(platform.principal_id, input, request),
      ).rejects.toBeInstanceOf(Error);
      expect(sends.mock.calls).toHaveLength(calls);
      expect(await service.llamaCppConfig(platform.principal_id)).toEqual(before);
    } finally {
      mode = 'normal';
    }
  },
);

it('generates through the JSON chat path, persists history and settles truthful usage without paid quota', async () => {
  const thread = await service.createThread(owner.principal_id);
  const request = randomUUID();
  const before = (
    await db.query<{ n: number }>('SELECT count(*)::int n FROM ai_paid_operation_quota')
  ).rows[0]!.n;
  const result = await service.send(owner.principal_id, thread.id, 'Обычный ответ', request);
  expect(result.replayed).toBe(false);
  expect(result.messages.at(-1)?.content).toBe('Ответ локальной модели.');
  const usage = (
    await db.query(
      'SELECT provider,input_tokens,output_tokens,status FROM ai_usage_journal WHERE owner_principal_id=$1 AND request_id=$2',
      [owner.principal_id, request],
    )
  ).rows[0];
  expect(usage).toMatchObject({
    provider: 'llamacpp-local',
    input_tokens: 19,
    output_tokens: 7,
    status: 'succeeded',
  });
  expect(
    (await db.query<{ n: number }>('SELECT count(*)::int n FROM ai_paid_operation_quota')).rows[0]!
      .n,
  ).toBe(before);
  const calls = sends.mock.calls.length;
  expect(
    (await service.send(owner.principal_id, thread.id, 'Обычный ответ', request)).replayed,
  ).toBe(true);
  expect(sends.mock.calls).toHaveLength(calls);
  await expect(
    service.send(stranger.principal_id, thread.id, 'Чужой диалог', randomUUID()),
  ).rejects.toBeInstanceOf(Error);
  expect(sends.mock.calls).toHaveLength(calls);
});

it('runs native tools through the existing owner-bound executor, then streams the continuation', async () => {
  mode = 'tools';
  try {
    const thread = await service.createThread(owner.principal_id);
    const deltas: string[] = [];
    const result = await service.sendStream(
      owner.principal_id,
      thread.id,
      'Создай файл demo.txt',
      randomUUID(),
      (text) => deltas.push(text),
      new AbortController().signal,
      'llamacpp-local',
    );
    expect(result.stopped).toBe(false);
    expect(deltas.join('')).toBe('Ответ локальной модели.');
    expect(
      (await service.workingFiles.read(owner.principal_id, thread.id, 'demo.txt')).content,
    ).toBe('Файл создан локальной моделью.');
    await expect(
      service.workingFiles.read(stranger.principal_id, thread.id, 'demo.txt'),
    ).rejects.toBeInstanceOf(Error);
    expect(
      sends.mock.calls.some(([, opts]) => {
        const body = opts?.body ? JSON.parse(String(opts.body)) : {};
        return body.messages?.some((message: { role: string }) => message.role === 'tool');
      }),
    ).toBe(true);
  } finally {
    mode = 'normal';
  }
});

it('cancels only the exact owner request, stores the partial answer and releases the slot', async () => {
  const thread = await service.createThread(owner.principal_id);
  const request = randomUUID();
  mode = 'cancel';
  try {
    const result = await service.sendStream(
      owner.principal_id,
      thread.id,
      'Начни ответ',
      request,
      () => {
        expect(service.stopStream(stranger.principal_id, thread.id, request)).toEqual({
          stopped: false,
        });
        expect(service.stopStream(owner.principal_id, thread.id, request)).toEqual({
          stopped: true,
        });
      },
      new AbortController().signal,
      'llamacpp-local',
    );
    expect(result.stopped).toBe(true);
    expect(result.messages.at(-1)).toMatchObject({ content: 'Начало ответа', state: 'stopped' });
    expect((await db.query('SELECT * FROM ai_llamacpp_slot')).rows).toHaveLength(0);
  } finally {
    mode = 'normal';
  }
});

it('preserves immutable replay before checking the GPU slot, even while another request owns it', async () => {
  const thread = await service.createThread(owner.principal_id);
  const request = randomUUID();
  await service.sendStream(
    owner.principal_id,
    thread.id,
    'Повтори сохранённое',
    request,
    () => undefined,
    new AbortController().signal,
    'llamacpp-local',
  );
  const other = randomUUID();
  await pool.query('SELECT ai_llamacpp_slot_acquire($1,NULL,$2)', [platform.principal_id, other]);
  try {
    const calls = sends.mock.calls.length;
    expect(
      (
        await service.sendStream(
          owner.principal_id,
          thread.id,
          'Повтори сохранённое',
          request,
          () => undefined,
          new AbortController().signal,
          'llamacpp-local',
        )
      ).replayed,
    ).toBe(true);
    expect(sends.mock.calls).toHaveLength(calls);
  } finally {
    await pool.query('SELECT ai_llamacpp_slot_release($1,NULL,$2)', [platform.principal_id, other]);
  }
});

it('uses bounded32 llama.cpp history for16 pairs while retaining legacy8 and regeneration source guards', async () => {
  const thread = await service.createThread(owner.principal_id);
  const needle = 'EARLIER_HISTORY_NEEDLE_7391';
  const future = 'FUTURE_ONLY_HISTORY_3728';
  const seeds: string[] = [];
  try {
    for (let index = 0; index < 16; index++) {
      const request = randomUUID();
      seeds.push(request);
      responseText = 'a'.repeat(8750) + (index === 0 ? needle : index === 15 ? future : '');
      await service.send(owner.principal_id, thread.id, 'Фрагмент ' + index, request);
    }
  } finally {
    responseText = 'Ответ локальной модели.';
  }
  const before = sends.mock.calls.length;
  await service.send(owner.principal_id, thread.id, 'Вопрос с длинной историей', randomUUID());
  const streamRequest = randomUUID();
  await service.sendStream(
    owner.principal_id,
    thread.id,
    'Ещё один вопрос',
    streamRequest,
    () => undefined,
    new AbortController().signal,
    'llamacpp-local',
  );
  const requests = sends.mock.calls
    .slice(before)
    .map(([, options]) => JSON.parse(String(options?.body)));
  expect(requests).toHaveLength(2);
  for (const body of requests) {
    expect(JSON.stringify(body).includes(needle)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(140000);
    expect(body.max_tokens).toBe(8192);
    expect(body).not.toHaveProperty('num_ctx');
  }
  const legacy = (
    await pool.query('SELECT * FROM ai_text_generation_context($1,$2,$3)', [
      owner.principal_id,
      thread.id,
      streamRequest,
    ])
  ).rows;
  expect(legacy.filter((row) => row.role === 'user')).toHaveLength(8);
  expect(JSON.stringify(legacy).includes(needle)).toBe(false);
  await expect(
    pool.query('SELECT * FROM ai_text_generation_context_llamacpp($1,$2,$3)', [
      stranger.principal_id,
      thread.id,
      streamRequest,
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  const source = (await service.messages(owner.principal_id, thread.id)).find(
    (message) => message.role === 'user' && message.requestId === seeds[8],
  )!;
  await service.sendStream(
    owner.principal_id,
    thread.id,
    '',
    randomUUID(),
    () => undefined,
    new AbortController().signal,
    'llamacpp-local',
    source.id,
  );
  const regenerated = JSON.parse(String(sends.mock.calls.at(-1)?.[1]?.body));
  expect(JSON.stringify(regenerated).includes(needle)).toBe(true);
  expect(JSON.stringify(regenerated).includes(future)).toBe(false);
});

it('disables offline and connects a keyless server without requiring backend secret encryption', async () => {
  const current = await draft();
  const before = sends.mock.calls.length;
  mode = 'network';
  try {
    const disabled = await service.applyLlamaCppSettings(
      platform.principal_id,
      { ...current, enabled: false },
      randomUUID(),
    );
    expect(disabled.verified).toBe(false);
    expect(disabled.config.enabled).toBe(false);
    expect(sends.mock.calls).toHaveLength(before);
  } finally {
    mode = 'normal';
  }
  expectedKey = null;
  const keyless = new AiChatService(pool, { fetchImpl: sends });
  const saved = await keyless.applyLlamaCppSettings(
    platform.principal_id,
    { ...(await draft()), clearApiKey: true },
    randomUUID(),
  );
  expect(saved.config.apiKeyConfigured).toBe(false);
  const thread = await keyless.createThread(owner.principal_id);
  expect(
    (await keyless.send(owner.principal_id, thread.id, 'Без ключа', randomUUID())).messages.at(-1)
      ?.content,
  ).toBe('Ответ локальной модели.');
});
