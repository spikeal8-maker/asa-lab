import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
import { AiWebSearchService } from '../../apps/api/src/ai-web-search';
import { aiAttachmentImageFixture } from '../../apps/api/src/ai-attachments/validation.fixture';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
const ROOT_KEY = '4c'.repeat(32);
let db: PGlite, admin: string;
const plan = planMigrations('migrations');
function client() {
  return {
    query: async (sql: string, params?: unknown[]) =>
      params?.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] },
  };
}
async function runtime<T>(sql: string, params: unknown[] = []) {
  await db.exec('SET ROLE asalab_app');
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec('RESET ROLE');
  }
}
const pool = {
  query: (sql: string, params?: unknown[]) => runtime(sql, params),
} as unknown as pg.Pool;
async function identity(elevated = false) {
  const account = (
    await db.query<{ id: string }>(
      "INSERT INTO accounts(email,password_hash,birth_date,country) VALUES($1,'test',DATE '1990-01-01','RU') RETURNING id",
      ['search-' + randomUUID() + '@example.test'],
    )
  ).rows[0]!.id;
  const principal = (
    await db.query<{ id: string }>(
      "INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id",
      [account],
    )
  ).rows[0]!.id;
  if (elevated)
    await db.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','admin-stage-a-2026-08','admin')",
      [account],
    );
  return principal;
}
function upstream() {
  return vi.fn<typeof fetch>(async (url, options) => {
    const u = new URL(String(url));
    if (u.hostname === 'search')
      return new Response(
        JSON.stringify({
          results: [
            {
              title: 'Источник',
              url: 'https://example.org/fact',
              content: 'Подтверждённый факт.',
              thumbnail_src: 'https://tse1.mm.bing.net/th?id=image',
            },
          ],
        }),
      );
    if (u.hostname === 'tse1.mm.bing.net')
      return new Response(new Uint8Array(aiAttachmentImageFixture('png')), {
        headers: { 'content-type': 'image/png' },
      });
    if (u.hostname !== 'api.deepseek.com') throw new Error('Unexpected external endpoint');
    const body = JSON.parse(String(options?.body));
    const content = 'Ответ [1](https://example.org/fact)';
    return body.stream
      ? new Response(
          'data: ' +
            JSON.stringify({
              choices: [{ delta: { content }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 12, completion_tokens: 3 },
            }) +
            '\n\ndata: [DONE]\n\n',
        )
      : new Response(
          JSON.stringify({
            choices: [{ message: { content }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 12, completion_tokens: 3 },
          }),
        );
  });
}
beforeAll(async () => {
  db = new PGlite();
  await applyPlan(client(), plan);
  admin = await identity(true);
  const chat = new AiChatService(pool, { encryptionKey: ROOT_KEY, fetchImpl: upstream() });
  await chat.saveAdminConfig(
    admin,
    {
      enabled: true,
      provider: 'deepseek',
      model: 'deepseek-flash',
      apiKey: 'test-llm-only-key',
      paidOperationsPerHour: 100,
    },
    randomUUID(),
  );
  await new AiWebSearchService(pool).save(
    admin,
    { enabled: true, weatherEnabled: true, operationsPerHour: 100, configurationVersion: 1 },
    randomUUID(),
  );
}, 30000);
afterAll(async () => db?.close());
it('persists exact owner sources for JSON, refresh/replay and variants without another search', async () => {
  const owner = await identity(),
    stranger = await identity(),
    fetchImpl = upstream();
  const chat = new AiChatService(pool, { encryptionKey: ROOT_KEY, fetchImpl });
  const thread = await chat.createThread(owner),
    request = randomUUID();
  const answer = await chat.send(owner, thread.id, 'Найди факт', request, 'web');
  expect(answer.messages.find((m) => m.role === 'assistant')?.webSearch?.sources[0]?.url).toBe(
    'https://example.org/fact',
  );
  expect(fetchImpl.mock.calls.map((c) => new URL(String(c[0])).hostname)).toEqual([
    'search',
    'api.deepseek.com',
  ]);
  expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body)).messages.at(-1).content).toContain(
    'Подтверждённый факт.',
  );
  const web = new AiWebSearchService(pool, fetchImpl);
  expect(await web.evidence(stranger, thread.id, request)).toBeNull();
  const calls = fetchImpl.mock.calls.length;
  expect((await chat.send(owner, thread.id, 'Найди факт', request, 'web')).replayed).toBe(true);
  expect(fetchImpl).toHaveBeenCalledTimes(calls);
  await expect(chat.send(owner, thread.id, 'Найди факт', request, 'images')).rejects.toMatchObject({
    code: 'ai_request_id_reused',
    status: 409,
  });
  await expect(
    chat.send(owner, thread.id, 'Найди факт', request, 'web', 'Казань'),
  ).rejects.toMatchObject({ code: 'ai_request_id_reused', status: 409 });
  expect(fetchImpl).toHaveBeenCalledTimes(calls);
  const source = answer.messages.find((m) => m.role === 'user')!;
  const variant = await chat.sendStream(
    owner,
    thread.id,
    '',
    randomUUID(),
    () => undefined,
    new AbortController().signal,
    undefined,
    source.id,
  );
  expect(variant.messages.find((m) => m.role === 'assistant')?.webSearch?.sources[0]?.url).toBe(
    'https://example.org/fact',
  );
  expect(
    fetchImpl.mock.calls.filter((c) => new URL(String(c[0])).hostname === 'search'),
  ).toHaveLength(1);
});
it('keeps image original URLs private and authenticates the same-origin raster proxy', async () => {
  const owner = await identity(),
    stranger = await identity(),
    fetchImpl = upstream();
  const chat = new AiChatService(pool, { encryptionKey: ROOT_KEY, fetchImpl });
  const thread = await chat.createThread(owner),
    request = randomUUID();
  const result = await chat.sendStream(
    owner,
    thread.id,
    'Найди фото',
    request,
    () => undefined,
    new AbortController().signal,
    undefined,
    undefined,
    [],
    'images',
  );
  const evidence = result.messages.find((m) => m.role === 'assistant')?.webSearch;
  expect(evidence?.images[0]?.thumbnailUrl).toBe(
    `/api/ai/threads/${thread.id}/web-search/${request}/images/1`,
  );
  expect(JSON.stringify(evidence)).not.toContain('tse1.mm.bing.net');
  const web = new AiWebSearchService(pool, fetchImpl);
  await expect(web.image(stranger, thread.id, request, 1)).rejects.toMatchObject({
    code: 'ai_web_image_missing',
  });
  const image = await web.image(owner, thread.id, request, 1);
  expect(image.mediaType).toBe('image/png');
  expect(image.bytes).toEqual(aiAttachmentImageFixture('png'));
  const bytesCalls = fetchImpl.mock.calls.filter(
    (c) => new URL(String(c[0])).hostname === 'tse1.mm.bing.net',
  );
  expect(bytesCalls).toHaveLength(1);
  expect(bytesCalls[0]![1]?.redirect).toBe('error');
});
it('erases deleted source content while preserving the non-refundable search budget tombstone', async () => {
  const owner = await identity(),
    fetchImpl = upstream(),
    chat = new AiChatService(pool, { encryptionKey: ROOT_KEY, fetchImpl });
  const thread = await chat.createThread(owner),
    request = randomUUID();
  await chat.send(owner, thread.id, 'Найди частный запрос', request, 'web');
  await chat.deleteThread(owner, thread.id);
  const row = (
    await db.query(
      'SELECT query,evidence,forgotten,reserved_units FROM ai_web_search_receipts WHERE owner_principal_id=$1 AND request_id=$2',
      [owner, request],
    )
  ).rows[0]!;
  expect(row).toEqual({ query: null, evidence: null, forgotten: true, reserved_units: 1 });
  expect(await new AiWebSearchService(pool).evidence(owner, thread.id, request)).toBeNull();
});
it('enforces shared geocoder rate/cache boundaries and table privileges', async () => {
  const first = (
    await runtime<{ value: { state: string; lease?: string } }>(
      "SELECT ai_web_cache_claim('geocode','казань') AS value",
    )
  ).rows[0]!.value;
  expect(first.state).toBe('fetch');
  expect(
    (
      await runtime<{ value: { state: string; lease?: string } }>(
        "SELECT ai_web_cache_claim('geocode','москва') AS value",
      )
    ).rows[0]!.value.state,
  ).toBe('limited');
  await runtime(
    "SELECT ai_web_cache_save('geocode','казань','[]'::jsonb,clock_timestamp()+INTERVAL '1 hour',NULL,$1::uuid)",
    [first.lease],
  );
  expect(
    (
      await runtime<{ value: { state: string; lease?: string } }>(
        "SELECT ai_web_cache_claim('geocode','казань') AS value",
      )
    ).rows[0]!.value.state,
  ).toBe('fresh');
  await expect(runtime('SELECT * FROM ai_web_search_receipts')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(runtime('SELECT * FROM ai_web_public_cache')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(
    runtime('SELECT * FROM ai_web_search_admin_get($1)', [await identity()]),
  ).rejects.toMatchObject({ code: '42501' });
});
it('reapplies without changing existing encrypted keys, history or quota', async () => {
  const before = (await db.query('SELECT * FROM ai_provider_settings ORDER BY provider')).rows;
  expect(await applyPlan(client(), plan)).toBe(0);
  expect((await db.query('SELECT * FROM ai_provider_settings ORDER BY provider')).rows).toEqual(
    before,
  );
});

it('neutralizes search directives and never sends previous private history to SearxNG', async () => {
  const owner = await identity(),
    fetchImpl = upstream(),
    chat = new AiChatService(pool, { encryptionKey: ROOT_KEY, fetchImpl });
  const thread = await chat.createThread(owner);
  await chat.send(owner, thread.id, 'Мой приватный пароль не для поисковика', randomUUID());
  fetchImpl.mockClear();
  await chat.send(owner, thread.id, '!google :fr Найди солнечные батареи', randomUUID(), 'web');
  const search = fetchImpl.mock.calls.find((c) => new URL(String(c[0])).hostname === 'search')!;
  const url = new URL(String(search[0]));
  expect(url.searchParams.get('q')).not.toMatch(/!|пароль|:fr/);
  expect(url.searchParams.get('safesearch')).toBe('2');
  expect(url.searchParams.get('engines')).toBe('bing,duckduckgo,wikipedia');
});
it('does not invoke the search provider for foreign threads or exhausted search budget', async () => {
  const owner = await identity(),
    stranger = await identity(),
    fetchImpl = upstream(),
    chat = new AiChatService(pool, { encryptionKey: ROOT_KEY, fetchImpl });
  const thread = await chat.createThread(owner);
  await expect(
    chat.send(stranger, thread.id, 'Найди факт', randomUUID(), 'web'),
  ).rejects.toMatchObject({ code: 'ai_thread_busy', status: 409 });
  expect(fetchImpl).not.toHaveBeenCalled();
  await chat.send(owner, thread.id, 'Найди исходный факт', randomUUID(), 'web');
  fetchImpl.mockClear();
  await db.query('UPDATE ai_web_search_settings SET operations_per_hour=1');
  const limitedRequest = randomUUID();
  const answer = await chat.send(owner, thread.id, 'Найди факт', limitedRequest, 'web');
  await db.query('UPDATE ai_web_search_settings SET operations_per_hour=100');
  expect(
    answer.messages.find((m) => m.requestId === limitedRequest && m.role === 'assistant')
      ?.webSearch,
  ).toMatchObject({
    status: 'limited',
    reason: 'rate_limit',
  });
  expect(
    fetchImpl.mock.calls.filter((c) => new URL(String(c[0])).hostname === 'search'),
  ).toHaveLength(0);
  await db.query('UPDATE ai_web_search_settings SET operations_per_hour=100');
});
it('Stop during search aborts upstream and never starts a model request', async () => {
  const owner = await identity(),
    stop = new AbortController();
  const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
    stop.abort();
    throw options?.signal?.reason ?? new Error('aborted');
  });
  const chat = new AiChatService(pool, { encryptionKey: ROOT_KEY, fetchImpl }),
    thread = await chat.createThread(owner);
  const result = await chat.sendStream(
    owner,
    thread.id,
    'Найди свежие данные',
    randomUUID(),
    () => undefined,
    stop.signal,
    undefined,
    undefined,
    [],
    'web',
  );
  expect(result.stopped).toBe(true);
  expect(fetchImpl).toHaveBeenCalledOnce();
  expect(String(fetchImpl.mock.calls[0]![0])).toContain('http://search:8080/search');
});

it('does not upgrade a legacy UUID into a search and returns the frozen snapshot for a legacy replay', async () => {
  const owner = await identity(),
    fetchImpl = upstream(),
    chat = new AiChatService(pool, { encryptionKey: ROOT_KEY, fetchImpl });
  const thread = await chat.createThread(owner),
    legacyId = randomUUID();
  await chat.send(owner, thread.id, 'Исходный вопрос', legacyId);
  const initialCalls = fetchImpl.mock.calls.length;
  await expect(
    chat.send(owner, thread.id, 'Исходный вопрос', legacyId, 'web'),
  ).rejects.toMatchObject({ code: 'ai_request_id_reused', status: 409 });
  expect(fetchImpl).toHaveBeenCalledTimes(initialCalls);
  const explicitId = randomUUID();
  await chat.send(owner, thread.id, 'Найди другой факт', explicitId, 'web');
  const savedCalls = fetchImpl.mock.calls.length;
  const replay = await chat.send(owner, thread.id, 'Найди другой факт', explicitId);
  expect(replay.replayed).toBe(true);
  expect(
    replay.messages.find((m) => m.requestId === explicitId && m.role === 'assistant')?.webSearch
      ?.sources,
  ).toHaveLength(1);
  expect(fetchImpl).toHaveBeenCalledTimes(savedCalls);
});

it('bounds global image buffers and releases permits after upstream failure', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetcher = vi.fn(async () => {
    await gate;
    throw new Error('aborted upstream');
  });
  const services = Array.from({ length: 9 }, () => new AiWebSearchService(pool, fetcher));
  for (const service of services)
    vi.spyOn(service, 'evidence').mockResolvedValue({
      images: [{ id: 1, thumbnailUrl: 'https://tse1.mm.bing.net/th?id=fixture' }],
    } as never);
  const pending = services
    .slice(0, 8)
    .map((service, i) =>
      service.image('owner-' + i, 'thread', 'request', 1).catch((e: unknown) => e),
    );
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(8));
  await expect(services[8]!.image('owner-9', 'thread', 'request', 1)).rejects.toMatchObject({
    status: 503,
  });
  release();
  await Promise.all(pending);
  await expect(services[8]!.image('owner-9', 'thread', 'request', 1)).rejects.toMatchObject({
    status: 502,
  });
  expect(fetcher).toHaveBeenCalledTimes(9);
});
