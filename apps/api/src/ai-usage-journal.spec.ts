import { createCipheriv } from 'node:crypto';
import type pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiChatService } from './ai-chat.service';
import { streamOllamaText } from './ai-ollama';
import { parseProviderText, streamProviderText } from './ai-provider-stream';
import { providerTokenCount, providerUsage } from './ai-provider-usage';
import { AiUsageJournal, AiUsageUnavailable } from './ai-usage-journal';

const OWNER = '11111111-1111-4111-8111-111111111111';
const THREAD = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const ROOT = '5c'.repeat(32);
const context = [{ role: 'user' as const, content: 'private-prompt-never-log' }];
const input = {
  provider: 'openai' as const,
  model: 'gpt-5-mini',
  apiKey: 'private-key',
  context,
  instructions: 'private-instruction',
  signal: new AbortController().signal,
  onDelta: vi.fn(),
};
afterEach(() => vi.restoreAllMocks());

function fixture(
  response: () => Promise<Response>,
  options: {
    replay?: boolean;
    beginFailure?: boolean;
    finishFailure?: boolean;
    historyFailure?: boolean;
    local?: boolean;
  } = {},
) {
  const iv = Buffer.alloc(12, 4);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(ROOT, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update('private-api-key'), cipher.final()]);
  const order: string[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    order.push(sql);
    if (sql.includes('ai_runtime_config'))
      return {
        rows: [
          {
            enabled: !options.local,
            provider: 'openai',
            model: 'gpt-5-mini',
            configuration_version: 3,
            api_key_ciphertext: ciphertext.toString('base64url'),
            api_key_iv: iv.toString('base64url'),
            api_key_auth_tag: cipher.getAuthTag().toString('base64url'),
          },
        ],
      };
    if (sql.includes('ai_ollama_runtime'))
      return {
        rows: [
          { enabled: true, base_url: 'http://127.0.0.1:11434', model: 'fixture:8b', revision: 1 },
        ],
      };
    if (sql.includes('ai_text_regeneration_replay'))
      return { rows: [{ replayed: options.replay === true }] };
    if (sql.includes('ai_text_begin') || sql.includes('ai_text_regenerate_begin'))
      return { rows: [{ admitted: !options.replay }] };
    if (sql.includes('ai_usage_begin')) {
      if (options.beginFailure) throw new Error('private-db-error');
      return { rows: [{ started: true }] };
    }
    if (sql.includes('ai_usage_finish')) {
      if (options.finishFailure) throw new Error('private-db-error');
      return { rows: [{ recorded: true }] };
    }
    if (sql.includes('ai_chat_finish') && options.historyFailure)
      throw new Error('private-history-save-error');
    if (sql.includes('ai_text_generation_context')) return { rows: context };
    if (sql.includes('ai_text_messages_page') || sql.includes('ai_text_request_messages'))
      return { rows: [] };
    return { rows: [{ result: params[0] }] };
  });
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    order.push('provider');
    return response();
  });
  const service = new AiChatService({ query } as unknown as pg.Pool, {
    encryptionKey: ROOT,
    fetchImpl,
  });
  const finishes = () =>
    query.mock.calls.filter(([sql]) => sql.includes('ai_usage_finish')).map(([, args]) => args!);
  return { service, query, fetchImpl, order, finishes };
}

describe('provider usage is never estimated from content', () => {
  it('accepts only provider safe nonnegative integer counts, including reported zero', () => {
    for (const value of [
      undefined,
      null,
      -1,
      1.5,
      '12',
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(providerTokenCount(value)).toBeNull();
    expect(providerTokenCount(0)).toBe(0);
    expect(
      providerUsage('openai', {
        model: 'https://private.invalid/key',
        usage: { input_tokens: -1 },
      }),
    ).toBeUndefined();
    expect(
      parseProviderText('openai', { status: 'completed', output_text: 'long visible text' }).usage,
    ).toBeUndefined();
    expect(
      parseProviderText('deepseek', {
        choices: [{ finish_reason: 'stop', message: { content: 'yes' } }],
        model: 'deepseek-flash',
        usage: { prompt_tokens: 12, completion_tokens: 0 },
      }).usage,
    ).toEqual({ inputTokens: 12, outputTokens: 0, actualModel: 'deepseek-flash' });
  });

  it.each([false, true])(
    'retains DeepSeek usage on terminal content or compatible usage-only chunk: %s',
    async (usageOnly) => {
      const usage = { prompt_tokens: 11, completion_tokens: 7 };
      const text =
        'data: ' +
        JSON.stringify({ model: 'deepseek-flash', choices: [{ delta: { content: 'OK' } }] }) +
        '\n\n' +
        'data: ' +
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'stop' }],
          ...(usageOnly ? {} : { usage }),
        }) +
        '\n\n' +
        (usageOnly ? 'data: ' + JSON.stringify({ choices: [], usage }) + '\n\n' : '') +
        'data: [DONE]\n\n';
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(text));
      const result = await streamProviderText({
        ...input,
        provider: 'deepseek',
        model: 'deepseek-flash',
        fetchImpl,
      });
      expect(result.usage).toEqual({
        inputTokens: 11,
        outputTokens: 7,
        actualModel: 'deepseek-flash',
      });
      expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)).stream_options).toEqual({
        include_usage: true,
      });
    },
  );

  it('retains OpenAI terminal usage and incomplete-error usage without changing partial text', async () => {
    for (const state of ['completed', 'incomplete']) {
      const fetchImpl = vi.fn<typeof fetch>(
        async () =>
          new Response(
            'event: response.output_text.delta\ndata: {"delta":"partial"}\n\n' +
              `event: response.${state}\ndata: ` +
              JSON.stringify({
                type: `response.${state}`,
                response: {
                  status: state,
                  model: 'gpt-5-mini-2026',
                  usage: { input_tokens: 9, output_tokens: 21 },
                },
              }) +
              '\n\n',
          ),
      );
      const promise = streamProviderText({ ...input, fetchImpl });
      const usage = { inputTokens: 9, outputTokens: 21, actualModel: 'gpt-5-mini-2026' };
      if (state === 'completed') expect((await promise).usage).toEqual(usage);
      else await expect(promise).rejects.toMatchObject({ partialText: 'partial', usage });
    }
  });

  it('reads Ollama terminal counters and preserves known usage on upstream error', async () => {
    for (const error of [false, true]) {
      const promise = streamOllamaText({
        ...input,
        baseUrl: 'http://127.0.0.1:11434',
        model: 'fixture:8b',
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              model: 'fixture:8b',
              message: { content: 'OK' },
              done: true,
              prompt_eval_count: 17,
              eval_count: 4,
              ...(error ? { error: 'private-upstream-message' } : {}),
            }) + '\n',
          ),
      });
      const usage = { inputTokens: 17, outputTokens: 4, actualModel: 'fixture:8b' };
      if (error)
        await expect(promise).rejects.toMatchObject({ usage, code: 'ai_ollama_upstream_error' });
      else expect((await promise).usage).toEqual(usage);
    }
  });

  it('retains known provider usage when the caller cancels after a delta', async () => {
    const abort = new AbortController();
    const result = await streamProviderText({
      ...input,
      provider: 'deepseek',
      model: 'deepseek-flash',
      signal: abort.signal,
      onDelta: () => abort.abort(),
      fetchImpl: async () =>
        new Response(
          'data: {"model":"deepseek-flash","usage":{"prompt_tokens":5,"completion_tokens":2},"choices":[{"delta":{"content":"partial"}}]}\n\n',
        ),
    });
    expect(result).toMatchObject({
      text: 'partial',
      stopped: true,
      usage: { inputTokens: 5, outputTokens: 2, actualModel: 'deepseek-flash' },
    });
  });
});

describe('durable usage surrounds each accepted generation', () => {
  it.each(['json', 'sse', 'regeneration', 'ollama'] as const)(
    'records %s once after durable begin and before history completion',
    async (transport) => {
      const local = transport === 'ollama';
      const f = fixture(
        async () =>
          new Response(
            local
              ? '{"model":"fixture:8b","done":true,"message":{"content":"OK"},"prompt_eval_count":8,"eval_count":3}\n'
              : transport === 'json'
                ? '{"status":"completed","model":"gpt-5-mini","output_text":"OK","usage":{"input_tokens":8,"output_tokens":3}}'
                : 'event: response.output_text.delta\ndata: {"delta":"OK"}\n\nevent: response.completed\ndata: {"response":{"model":"gpt-5-mini","usage":{"input_tokens":8,"output_tokens":3}}}\n\n',
          ),
        { local },
      );
      if (transport === 'json') await f.service.send(OWNER, THREAD, context[0]!.content, REQUEST);
      else
        await f.service.sendStream(
          OWNER,
          THREAD,
          context[0]!.content,
          REQUEST,
          vi.fn(),
          input.signal,
          local ? 'ollama-local' : 'gpt-5-mini',
          transport === 'regeneration' ? OWNER : undefined,
        );
      expect(f.order.findIndex((sql) => sql.includes('ai_usage_begin'))).toBeLessThan(
        f.order.indexOf('provider'),
      );
      expect(f.finishes()).toEqual([
        [OWNER, REQUEST, 'succeeded', null, 8, 3, local ? 'fixture:8b' : 'gpt-5-mini'],
      ]);
      expect(f.query.mock.calls.find(([sql]) => sql.includes('ai_usage_begin'))?.[1]?.[3]).toBe(
        transport === 'regeneration' ? 'regeneration' : 'chat',
      );
      expect(f.fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it('replay creates no journal write or provider request', async () => {
    const f = fixture(async () => new Response(''), { replay: true });
    await f.service.send(OWNER, THREAD, 'question', REQUEST);
    await f.service.sendStream(
      OWNER,
      THREAD,
      'question',
      REQUEST,
      vi.fn(),
      input.signal,
      'gpt-5-mini',
      OWNER,
    );
    expect(f.query.mock.calls.some(([sql]) => sql.includes('ai_usage_'))).toBe(false);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('begin failure prevents provider; finalize failure preserves paid answer and primary error with safe visible diagnostics', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const blocked = fixture(async () => new Response(''), { beginFailure: true });
    await expect(blocked.service.send(OWNER, THREAD, 'question', REQUEST)).rejects.toMatchObject({
      code: 'ai_usage_unavailable',
    });
    expect(blocked.fetchImpl).not.toHaveBeenCalled();
    const paid = fixture(
      async () => new Response('{"status":"completed","output_text":"paid-answer"}'),
      { finishFailure: true },
    );
    await expect(paid.service.send(OWNER, THREAD, 'question', REQUEST)).resolves.toMatchObject({
      replayed: false,
    });
    expect(paid.query.mock.calls.find(([sql]) => sql.includes('ai_chat_finish'))?.[1]?.[3]).toBe(
      'paid-answer',
    );
    const failed = fixture(async () => new Response('private-provider-message', { status: 429 }), {
      finishFailure: true,
    });
    await expect(failed.service.send(OWNER, THREAD, 'question', REQUEST)).rejects.toMatchObject({
      code: 'ai_provider_rate_limit',
    });
    expect(failed.finishes()[0]).toEqual([
      OWNER,
      REQUEST,
      'failed',
      'ai_provider_rate_limit',
      null,
      null,
      null,
    ]);
    expect(
      log.mock.calls.filter(([message]) => JSON.parse(String(message)).kind === 'ai_usage_quality'),
    ).toHaveLength(3);
    expect(
      log.mock.calls.filter(([message]) => JSON.parse(String(message)).kind === 'ai_usage'),
    ).toHaveLength(2);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-|paid-answer|127\.0\.0\.1/);
  });

  it('history save failure records failed with the known provider counts; operational projection excludes owner/content/token-key names', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = fixture(
      async () =>
        new Response(
          '{"status":"completed","model":"gpt-5-mini","output_text":"private-answer","usage":{"input_tokens":20,"output_tokens":6}}',
        ),
      { historyFailure: true },
    );
    await expect(f.service.send(OWNER, THREAD, 'private-question', REQUEST)).rejects.toMatchObject({
      code: 'ai_provider_unavailable',
    });
    expect(f.finishes()).toEqual([
      [OWNER, REQUEST, 'failed', 'ai_generation_failed', 20, 6, 'gpt-5-mini'],
    ]);
    const event = JSON.parse(String(log.mock.calls[0]![0]));
    expect(event).toMatchObject({
      kind: 'ai_usage',
      operationRequestId: REQUEST,
      status: 'failed',
      provider: 'openai',
      usage: { input: 20, output: 6 },
      journalState: 'recorded',
    });
    expect(JSON.stringify(event)).not.toMatch(
      /private-|inputTokens|outputTokens|input_tokens|output_tokens/,
    );
    expect(JSON.stringify(event)).not.toContain(OWNER);
    expect(JSON.stringify(event)).not.toContain(THREAD);
  });

  it('cancellation records nullable unknown counts and differs from provider length stop', async () => {
    const client = new AbortController();
    const cancelled = fixture(async () => {
      client.abort();
      return new Response('');
    });
    await cancelled.service.sendStream(OWNER, THREAD, 'question', REQUEST, vi.fn(), client.signal);
    expect(cancelled.finishes()[0]).toEqual([OWNER, REQUEST, 'cancelled', null, null, null, null]);
    const stopped = fixture(
      async () =>
        new Response(
          '{"status":"completed","output_text":' + JSON.stringify('x'.repeat(65537)) + '}',
        ),
    );
    await stopped.service.send(OWNER, THREAD, 'question', REQUEST);
    expect(stopped.finishes()[0]?.[2]).toBe('stopped');
  });

  it('rejects missing single-use begin acknowledgement rather than calling upstream', async () => {
    const journal = new AiUsageJournal({
      query: vi.fn(async () => ({ rows: [{ started: false }] })),
    } as unknown as pg.Pool);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      journal.begin(OWNER, THREAD, REQUEST, 'chat', 'json', 'openai', 'gpt-5-mini'),
    ).rejects.toBeInstanceOf(AiUsageUnavailable);
  });

  it('a failed diagnostic emitter never destroys a finalized result', async () => {
    const journal = new AiUsageJournal({
      query: vi.fn(async () => ({ rows: [{ recorded: true }] })),
    } as unknown as pg.Pool);
    vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('unavailable-output');
    });
    await expect(journal.finish(OWNER, REQUEST, 'succeeded', null)).resolves.toBeUndefined();
  });
});
