import { aiUsageQueryFixture } from './testing/ai-usage-query.fixture';
import { createCipheriv } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AiChatService } from './ai-chat.service';
import { AiTextHistoryStore } from './ai-text-history';

const OWNER = 'abcdefab-cdef-4abc-8abc-abcdefabcdef';
const THREAD = 'bcdefabc-defa-4bcd-9bcd-bcdefabcdefa';
const SOURCE = 'cdefabcd-efab-4cde-acde-cdefabcdefab';
const REQUEST = 'defabcde-fabc-4def-8def-defabcdefabc';
const ROOT = '7d'.repeat(32);

function fixture() {
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(ROOT, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update('sk-tests-only'), cipher.final()]);
  const config = {
    enabled: true,
    configuration_version: 4,
    provider: 'openai',
    model: 'gpt-5-mini',
    api_key_ciphertext: ciphertext.toString('base64url'),
    api_key_iv: iv.toString('base64url'),
    api_key_auth_tag: cipher.getAuthTag().toString('base64url'),
  };
  const context = [
    { role: 'user', content: 'Первый вопрос' },
    { role: 'assistant', content: 'Первый ответ' },
    { role: 'user', content: 'Именно исходный вопрос' },
  ];
  const events: string[] = [];
  let receipt: { request: string; source: string } | null = null;
  let messages: Record<string, unknown>[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const journal = aiUsageQueryFixture(sql);
    if (journal) return journal;
    events.push(sql);
    if (sql.includes('ai_text_regeneration_replay')) {
      if (receipt && (receipt.source !== params[3] || receipt.request !== params[2])) {
        throw new Error('AI_REQUEST_ID_REUSED');
      }
      return { rows: [{ replayed: !!receipt }] };
    }
    if (sql.includes('ai_runtime_config')) return { rows: [config] };
    if (sql.includes('ai_text_regenerate_begin')) {
      receipt = { request: String(params[2]), source: String(params[3]) };
      return { rows: [{ admitted: true }] };
    }
    if (sql.includes('ai_text_generation_context')) return { rows: context };
    if (sql.includes('ai_chat_generation_lease')) return { rows: [] };
    if (sql.includes('ai_text_request_messages')) return { rows: messages };
    if (sql.includes('ai_chat_finish')) {
      messages = [
        {
          id: 'answer',
          role: 'assistant',
          content: params[3],
          state: params[4],
          request_id: params[2],
          created_at: new Date(2),
          source_user_message_id: SOURCE,
          source_prompt: context.at(-1)!.content,
          regenerated: true,
        },
      ];
      return { rows: [{ ai_chat_finish: true }] };
    }
    if (sql.includes('ai_chat_abort')) return { rows: [] };
    throw new Error('Unexpected SQL: ' + sql);
  });
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    events.push('fetch');
    return new Response(
      'event: response.output_text.delta\ndata: {"delta":"Новый ответ"}\n\n' +
        'event: response.completed\ndata: {"type":"response.completed"}\n\n',
    );
  });
  const service = new AiChatService({ query } as unknown as pg.Pool, {
    encryptionKey: ROOT,
    fetchImpl,
  });
  const run = (request = REQUEST, source = SOURCE, delta: (text: string) => void = vi.fn()) =>
    service.sendStream(
      OWNER.toUpperCase(),
      THREAD.toUpperCase(),
      '',
      request,
      delta,
      new AbortController().signal,
      'gpt-5-mini',
      source,
    );
  return { config, context, query, fetchImpl, service, run, events };
}

describe('fresh answer admission and persistence', () => {
  it('uses the immutable original context after durable new admission and stores a separate variant', async () => {
    const f = fixture();
    const result = await f.run(REQUEST.toUpperCase(), SOURCE.toUpperCase());
    expect(result).toMatchObject({
      replayed: false,
      stopped: false,
      messages: [
        {
          role: 'assistant',
          content: 'Новый ответ',
          requestId: REQUEST,
          sourceUserMessageId: SOURCE,
          sourcePrompt: 'Именно исходный вопрос',
          regenerated: true,
        },
      ],
    });
    expect(f.query).toHaveBeenCalledWith(
      'SELECT ai_text_regenerate_begin($1,$2,$3,$4,$5::bigint) AS admitted',
      [OWNER, THREAD, REQUEST, SOURCE, 4],
    );
    const admission = f.events.findIndex((sql) => sql.includes('ai_text_regenerate_begin'));
    const context = f.events.findIndex((sql) => sql.includes('ai_text_generation_context'));
    expect(admission).toBeGreaterThanOrEqual(0);
    expect(context).toBeGreaterThan(admission);
    expect(f.events.indexOf('fetch')).toBeGreaterThan(context);
    const body = JSON.parse(String(f.fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.input).toEqual(f.context);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      f.query.mock.calls.some(([sql]) => /ai_text_begin_paid|ai_chat_begin_paid|INSERT/.test(sql)),
    ).toBe(false);
  });

  it('replays the exact receipt before reading disabled or changed provider settings', async () => {
    const f = fixture();
    await f.run();
    f.config.enabled = false;
    f.config.model = 'removed-provider-model';
    f.query.mockClear();
    expect(await f.run(REQUEST.toUpperCase(), SOURCE.toUpperCase())).toMatchObject({
      replayed: true,
      messages: [{ requestId: REQUEST }],
    });
    expect(f.query.mock.calls.map(([sql]) => sql)).toEqual([
      'SELECT ai_generation_policy_runtime() AS value',
      'SELECT ai_text_regeneration_replay($1,$2,$3,$4) AS replayed',
      'SELECT page.*, ai_image_history($1,$2,page.request_id) AS generated_images, ai_image_kind($1,$2,page.request_id) AS generation_kind, ai_web_search_evidence($1,$2,page.request_id,true) AS web_search FROM ai_text_request_messages($1,$2,$3) page',
    ]);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects an existing request reused for another source before any second payment or fetch', async () => {
    const f = fixture();
    await f.run();
    f.query.mockClear();
    await expect(f.run(REQUEST, OWNER)).rejects.toMatchObject({
      code: 'ai_request_id_reused',
      status: 409,
    });
    expect(f.query.mock.calls.map(([sql]) => sql)).toEqual([
      'SELECT ai_generation_policy_runtime() AS value',
      'SELECT ai_text_regeneration_replay($1,$2,$3,$4) AS replayed',
    ]);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not recharge a request after an upstream failure with no received text', async () => {
    const f = fixture();
    f.fetchImpl.mockRejectedValue(new Error('Connection lost after provider accepted request'));
    await expect(f.run()).rejects.toMatchObject({ code: 'ai_provider_unavailable' });
    expect(f.query).toHaveBeenCalledWith('SELECT ai_chat_abort($1,$2,$3)', [
      OWNER,
      THREAD,
      REQUEST,
    ]);
    expect(await f.run()).toEqual({ replayed: true, stopped: false, messages: [] });
    expect(
      f.query.mock.calls.filter(([sql]) => sql.includes('ai_text_regenerate_begin')),
    ).toHaveLength(1);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('preserves interrupted variant text as stopped and returns the same variant on replay', async () => {
    const f = fixture();
    f.fetchImpl.mockResolvedValue(
      new Response('event: response.output_text.delta\ndata: {"delta":"Часть варианта"}\n\n'),
    );
    await expect(f.run()).rejects.toMatchObject({ code: 'ai_stream_interrupted' });
    const replay = await f.run();
    expect(replay).toMatchObject({
      replayed: true,
      stopped: true,
      messages: [{ content: 'Часть варианта', state: 'stopped', regenerated: true }],
    });
    expect(f.query.mock.calls.filter(([sql]) => sql.includes('ai_chat_finish'))).toHaveLength(1);
    expect(f.query.mock.calls.some(([sql]) => sql.includes('ai_chat_abort'))).toBe(false);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses the same cross-owner and cross-thread Stop boundary for variants, including uppercase UUIDs', async () => {
    const f = fixture();
    const result = await f.run(REQUEST, SOURCE, () => {
      expect(f.service.stopStream(SOURCE, THREAD, REQUEST)).toEqual({ stopped: false });
      expect(f.service.stopStream(OWNER, SOURCE, REQUEST)).toEqual({ stopped: false });
      expect(
        f.service.stopStream(OWNER.toUpperCase(), THREAD.toUpperCase(), REQUEST.toUpperCase()),
      ).toEqual({ stopped: true });
    });
    expect(result.stopped).toBe(true);
    expect(result.messages[0]?.state).toBe('stopped');
    expect(f.service.stopStream(OWNER, THREAD, REQUEST)).toEqual({ stopped: false });
  });

  it.each([
    ['AI_THREAD_ARCHIVED', 'ai_thread_archived', 409],
    ['AI_SOURCE_DENIED', 'ai_source_not_found', 404],
    ['AI_REQUEST_ID_REUSED', 'ai_request_id_reused', 409],
    ['AI_THREAD_BUSY_OR_MISSING', 'ai_thread_busy', 409],
    ['AI_SCOPE_DENIED', 'ai_scope_denied', 403],
    ['AI_STUDENT_DENIED', 'ai_student_denied', 403],
    ['AI_PLATFORM_QUOTA_EXHAUSTED', 'ai_platform_quota_exhausted', 429],
  ])('maps %s before an upstream request', async (problem, code, status) => {
    const f = fixture();
    const implementation = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, params) => {
      if (sql.includes('ai_text_regenerate_begin')) throw new Error(String(problem));
      return implementation(sql, params);
    });
    await expect(f.run()).rejects.toMatchObject({ code, status });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('fails before paid admission if the text upgrade is missing', async () => {
    const f = fixture();
    f.query.mockRejectedValue(
      Object.assign(new Error('ai_text_regeneration_replay does not exist'), { code: '42883' }),
    );
    await expect(f.run()).rejects.toMatchObject({ code: '42883' });
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('owner history projection', () => {
  it('keeps the search, archive filter and microsecond cursor in the SQL boundary', async () => {
    const query = vi.fn(async () => ({
      rows: Array.from({ length: 51 }, (_, index) => ({
        id: String(index),
        title: 'Название',
        updated_at: new Date('2026-10-19T10:00:00.123Z'),
        archived_at: new Date(1),
        match_preview: 'Фраза найдена глубоко в сообщениях',
        cursor_at: '2026-10-19T10:00:00.123' + String(index).padStart(3, '0') + 'Z',
      })),
    }));
    const store = new AiTextHistoryStore({ query } as unknown as pg.Pool);
    const cursor = { at: '2026-10-19T10:00:00.999123Z', id: THREAD };
    const result = await store.threads(OWNER, cursor, '%_literal', true);
    expect(query.mock.calls[0]).toEqual([
      expect.stringContaining('ai_text_search_threads'),
      [OWNER, '%_literal', true, cursor.at, THREAD, 51],
    ]);
    expect(result.items).toHaveLength(50);
    expect(result.items[0]).toMatchObject({
      archivedAt: new Date(1).toISOString(),
      matchPreview: 'Фраза найдена глубоко в сообщениях',
    });
    expect(result.nextCursor).toEqual({ at: '2026-10-19T10:00:00.123049Z', id: '49' });
  });
});
