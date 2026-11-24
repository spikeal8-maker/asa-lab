import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { nativeTools } from './ai-native-tools.js';
import { workingFileTools } from './ai-working-files.js';
import {
  createLlamaCppFetch,
  discoverLlamaCpp,
  generateLlamaCppText,
  llamaCppPrivateAddress,
  LlamaCppError,
  LlamaCppQueue,
  normalizeLlamaCppBaseUrl,
  parseLlamaCppText,
  streamLlamaCppText,
  type LlamaCppStreamArgs,
} from './ai-llamacpp.js';

const base = 'http://127.0.0.1:8080';
const frame = (payload: unknown) => 'data: ' + JSON.stringify(payload) + '\n\n';
const delta = (value: unknown) =>
  frame({ choices: [{ index: 0, delta: value, finish_reason: null }] });
const finish = (reason = 'stop') =>
  frame({ choices: [{ index: 0, delta: {}, finish_reason: reason }] });
const usage = frame({
  choices: [],
  model: 'fixture:27b',
  usage: { prompt_tokens: 200002, completion_tokens: 5 },
});
function args(
  fetchImpl: typeof fetch,
  extra: Partial<LlamaCppStreamArgs> = {},
): LlamaCppStreamArgs {
  return {
    baseUrl: base,
    model: 'fixture:27b',
    instructions: 'Be helpful.',
    context: [{ role: 'user', content: 'Hi' }],
    signal: new AbortController().signal,
    onDelta: () => undefined,
    fetchImpl,
    ...extra,
  };
}
const completed = (content = 'OK') => ({
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
  model: 'fixture:27b',
  usage: { prompt_tokens: 4, completion_tokens: 1 },
});

describe('llama.cpp endpoint and DNS boundary', () => {
  it('cancels a stalled DNS lookup without opening a socket', async () => {
    const abort = new AbortController();
    const resolve = vi.fn(
      () => new Promise<Array<{ address: string; family: number }>>(() => undefined),
    );
    const pending = createLlamaCppFetch({ resolve })('http://fixture.internal:8080/v1/models', {
      signal: abort.signal,
    });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(resolve).toHaveBeenCalledOnce();
  });
  it.each([
    ['127.0.0.1', base],
    ['machine-name', 'http://machine-name:8080'],
    ['host.lan:8090', 'http://host.lan:8090'],
    ['https://host.lan/v1/', 'https://host.lan:8080'],
    ['http://127.0.0.1:80/v1', 'http://127.0.0.1:80'],
    ['https://host.lan:443', 'https://host.lan:443'],
    ['http://[::1]/v1', 'http://[::1]:8080'],
    ['[fd12::7]:8085', 'http://[fd12::7]:8085'],
  ])('normalizes %s without changing explicit ports', (input, expected) => {
    expect(normalizeLlamaCppBaseUrl(input)).toBe(expected);
    expect(normalizeLlamaCppBaseUrl(expected)).toBe(expected);
  });
  it.each([
    'http://169.254.169.254',
    'http://100.100.100.200',
    'http://8.8.8.8',
    'http://0.0.0.0',
    'http://[fe80::1]',
    'http://[::ffff:169.254.169.254]',
    'http://[::ffff:127.0.0.1]',
    'http://user:secret@127.0.0.1',
    'http://127.0.0.1/other',
    'http://127.0.0.1?x=1',
    'http://127.0.0.1#x',
    'file:///etc/passwd',
    'http://127.0.0.1\n',
  ])('denies %s', (input) => {
    expect(() => normalizeLlamaCppBaseUrl(input)).toThrow(LlamaCppError);
  });
  it('does not let the optional host allowlist authorize public or metadata addresses', async () => {
    const fetchImpl = createLlamaCppFetch({
      allowedHosts: ['fixture.internal'],
      resolve: async () => [{ address: '169.254.169.254', family: 4 }],
    });
    await expect(fetchImpl('http://fixture.internal:8080/v1/models')).rejects.toMatchObject({
      code: 'ai_llamacpp_url_denied',
    });
    expect(llamaCppPrivateAddress('100.64.0.2')).toBe(true);
    expect(llamaCppPrivateAddress('fd00::2')).toBe(true);
  });
  it('fails closed for mixed private/public DNS answers before any socket', async () => {
    const resolve = vi.fn(async () => [
      { address: '127.0.0.1', family: 4 },
      { address: '8.8.8.8', family: 4 },
    ]);
    await expect(
      createLlamaCppFetch({ resolve })('http://fixture.internal:8080/v1/models'),
    ).rejects.toMatchObject({ code: 'ai_llamacpp_url_denied' });
    expect(resolve).toHaveBeenCalledOnce();
  });
  it('pins hostname resolution on the native socket, removes ambient headers, and rejects redirects', async () => {
    const received: Array<{
      host: string | undefined;
      key: string | undefined;
      persistent: string | string[] | undefined;
      cookie: string | undefined;
    }> = [];
    const server = createServer((req, res) => {
      received.push({
        host: req.headers.host,
        key: req.headers.authorization,
        persistent: req.headers['x-conversation-id'],
        cookie: req.headers.cookie,
      });
      if (req.url === '/props') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest' });
        res.end();
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.end('{"data":[]}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const resolve = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]);
      const fetchImpl = createLlamaCppFetch({ resolve });
      expect(
        await (
          await fetchImpl(`http://fixture.internal:${port}/v1/models`, {
            headers: {
              authorization: 'Bearer fixture-key',
              cookie: 'private=yes',
              'x-conversation-id': 'bad-persistent-id',
            },
          })
        ).json(),
      ).toEqual({ data: [] });
      expect(received[0]).toEqual({
        host: `fixture.internal:${port}`,
        key: 'Bearer fixture-key',
        persistent: undefined,
        cookie: undefined,
      });
      expect(resolve).toHaveBeenCalledOnce();
      await expect(fetchImpl(`http://fixture.internal:${port}/props`)).rejects.toMatchObject({
        code: 'ai_llamacpp_url_denied',
      });
      expect(received).toHaveLength(2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

describe('llama.cpp real-format discovery', () => {
  it('uses each model runtime context, never training context, and suppresses router autoload', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/v1/models')
        return Response.json({
          data: [
            { id: 'loaded:27b', meta: { n_ctx: 212992, n_ctx_train: 262144 } },
            { id: 'unloaded:8b', meta: { n_ctx_train: 131072 } },
            { id: 'other/model', meta: null },
          ],
        });
      expect(parsed.searchParams.get('autoload')).toBe('false');
      if (parsed.searchParams.get('model') === 'loaded:27b')
        return Response.json({ default_generation_settings: { n_ctx: 212992 } });
      if (parsed.searchParams.get('model') === 'other/model')
        return Response.json({ default_generation_settings: { n_ctx: 8192 } });
      return new Response('', { status: 503 });
    });
    expect(await discoverLlamaCpp({ baseUrl: base, apiKey: 'fixture-key', fetchImpl })).toEqual({
      baseUrl: base,
      models: [
        { id: 'loaded:27b', contextTokens: 212992, tools: false },
        { id: 'unloaded:8b', contextTokens: null, tools: false },
        { id: 'other/model', contextTokens: 8192, tools: false },
      ],
    });
    for (const [, init] of fetchImpl.mock.calls)
      expect(init).toMatchObject({
        redirect: 'error',
        headers: { authorization: 'Bearer fixture-key' },
      });
  });
  it('supports an unauthenticated empty catalog without fabricating a model', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ data: [] }));
    expect((await discoverLlamaCpp({ baseUrl: base, fetchImpl })).models).toEqual([]);
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has('authorization')).toBe(false);
  });
  it.each([401, 403])(
    'redacts %s authentication failures without returning ASA session 401',
    async (status) => {
      await expect(
        discoverLlamaCpp({
          baseUrl: base,
          apiKey: 'secret-fixture',
          fetchImpl: async () => new Response('secret-fixture private-host body', { status }),
        }),
      ).rejects.toMatchObject({ code: 'ai_llamacpp_auth', status: 502 });
    },
  );
  it.each([{ data: [{ id: 'dup' }, { id: 'dup' }] }, { data: 'bad' }, { data: [{ id: '' }] }])(
    'rejects malformed catalogs',
    async (payload) => {
      await expect(
        discoverLlamaCpp({ baseUrl: base, fetchImpl: async () => Response.json(payload) }),
      ).rejects.toMatchObject({ code: 'ai_llamacpp_invalid' });
    },
  );
});

describe('llama.cpp completions, SSE, tools and usage', () => {
  it('supports a validated working-file call and its subsequent model round', async () => {
    const toolArgs = { name: 'fixture.html', content: '<main>Готово</main>' };
    const tools = workingFileTools();
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.parallel_tool_calls).toBe(false);
      if (body.messages.at(-1).role === 'tool') {
        expect(body.messages.at(-1).tool_call_id).toBe('working-file-call');
        expect(body.messages.at(-2).tool_calls[0].function.arguments).toBe(
          JSON.stringify(toolArgs),
        );
        return new Response(delta({ content: 'Файл создан.' }) + finish() + 'data: [DONE]\n\n');
      }
      return new Response(
        delta({
          tool_calls: [
            {
              index: 0,
              id: 'working-file-call',
              type: 'function',
              function: { name: 'create_working_file', arguments: JSON.stringify(toolArgs) },
            },
          ],
        }) +
          finish('tool_calls') +
          'data: [DONE]\n\n',
      );
    });
    const first = await streamLlamaCppText(args(fetchImpl, { tools }));
    expect(first.toolCalls).toEqual([{ name: 'create_working_file', arguments: toolArgs }]);
    const second = await streamLlamaCppText(
      args(fetchImpl, {
        tools,
        toolResults: [{ call: first.toolCalls![0]!, content: '{"version":1,"status":"created"}' }],
      }),
    );
    expect(second.text).toBe('Файл создан.');
  });
  it('budgets all tool results and adapts the default output to a small confirmed context', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(completed()));
    await generateLlamaCppText(args(fetchImpl, { contextTokens: 8192 }));
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).max_tokens).toBe(2048);
    fetchImpl.mockClear();
    await expect(
      generateLlamaCppText(
        args(fetchImpl, {
          contextTokens: 8192,
          toolResults: [
            {
              call: { name: 'web_search', arguments: { query: 'fixture' } },
              content: 'x'.repeat(8192),
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'ai_llamacpp_context_exceeded' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('uses JSON Chat Completions without Ollama or MTP parameters', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(completed()));
    const result = await generateLlamaCppText(
      args(fetchImpl, {
        contextTokens: 212992,
        maxOutputTokens: 2048,
        temperature: 0.5,
        topP: 0.9,
      }),
    );
    expect(result).toEqual({
      text: 'OK',
      stopped: false,
      usage: { inputTokens: 4, outputTokens: 1, actualModel: 'fixture:27b' },
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(base + '/v1/chat/completions');
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ stream: false, max_tokens: 2048, temperature: 0.5, top_p: 0.9 });
    expect(body).not.toHaveProperty('options');
    expect(body).not.toHaveProperty('mtp');
  });
  it('reads usage after finish and handles split UTF-8, CRLF, comments and reasoning', async () => {
    const bytes = new TextEncoder().encode(
      ': ping\r\n\r\n' +
        delta({ role: 'assistant', content: null }) +
        delta({ reasoning_content: 'думать' }) +
        delta({ content: 'Привет' }) +
        finish() +
        usage +
        'data: [DONE]\r\n\r\n',
    );
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
              controller.close();
            },
          }),
        ),
    );
    const onDelta = vi.fn();
    const onReasoningDelta = vi.fn();
    expect(await streamLlamaCppText(args(fetchImpl, { onDelta, onReasoningDelta }))).toEqual({
      text: 'Привет',
      stopped: false,
      usage: { inputTokens: 200002, outputTokens: 5, actualModel: 'fixture:27b' },
    });
    expect(onDelta).toHaveBeenCalledWith('Привет');
    expect(onReasoningDelta).toHaveBeenCalledWith('думать');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toHaveProperty(
      'stream_options.include_usage',
      true,
    );
  });
  it('assembles tool fragments, preserves call ID in continuation and does not execute the call', async () => {
    const tools = nativeTools({ search: true, weather: false });
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          delta({
            tool_calls: [
              { index: 0, id: 'call_fixture', function: { name: 'web_', arguments: '{"query":' } },
            ],
          }) +
            delta({
              tool_calls: [{ index: 0, function: { name: 'search', arguments: '"fixture"}' } }],
            }) +
            finish('tool_calls') +
            usage +
            'data: [DONE]\n\n',
        ),
    );
    const result = await streamLlamaCppText(args(fetchImpl, { tools }));
    expect(result.toolCalls).toEqual([{ name: 'web_search', arguments: { query: 'fixture' } }]);
    const continuation = vi.fn<typeof fetch>(async () => Response.json(completed('Tool read.')));
    await generateLlamaCppText(
      args(continuation, {
        tools,
        toolResults: [{ call: result.toolCalls![0]!, content: 'fixture result' }],
      }),
    );
    const messages = JSON.parse(String(continuation.mock.calls[0]?.[1]?.body)).messages;
    expect(messages.at(-2).tool_calls[0].id).toBe('call_fixture');
    expect(messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call_fixture',
      content: 'fixture result',
    });
  });
  it('does not execute an incomplete tool call at the output limit', async () => {
    const result = await streamLlamaCppText(
      args(
        async () =>
          new Response(
            delta({
              tool_calls: [{ index: 0, function: { name: 'web_search', arguments: '{"query":' } }],
            }) +
              finish('length') +
              'data: [DONE]\n\n',
          ),
        { tools: nativeTools({ search: true, weather: false }) },
      ),
    );
    expect(result.stopped).toBe(true);
    expect(result.toolCalls).toBeUndefined();
  });
  it('preserves partial text but rejects premature EOF, embedded errors and malformed tools', async () => {
    await expect(
      streamLlamaCppText(args(async () => new Response(delta({ content: 'partial' }) + finish()))),
    ).rejects.toMatchObject({ code: 'ai_llamacpp_interrupted', partialText: 'partial' });
    await expect(
      streamLlamaCppText(
        args(
          async () =>
            new Response(
              delta({ content: 'partial' }) + frame({ error: { message: 'do not expose secret' } }),
            ),
        ),
      ),
    ).rejects.toMatchObject({ code: 'ai_llamacpp_upstream_error', partialText: 'partial' });
    await expect(
      streamLlamaCppText(
        args(
          async () =>
            new Response(
              delta({
                tool_calls: [{ index: 0, function: { name: 'web_search', arguments: '{}' } }],
              }) +
                finish('tool_calls') +
                'data: [DONE]\n\n',
            ),
          { tools: nativeTools({ search: true, weather: false }) },
        ),
      ),
    ).rejects.toMatchObject({ code: 'ai_tool_call_invalid' });
  });
  it('returns provider context overflow without raw response details', async () => {
    await expect(
      generateLlamaCppText(
        args(async () =>
          Response.json(
            { error: { type: 'exceed_context_size_error', message: 'private prompt secret' } },
            { status: 400 },
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: 'ai_llamacpp_context_exceeded', status: 400 });
  });
  it('preserves a long prompt and never fabricates zero usage', async () => {
    const content = 'context '.repeat(20000);
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'done' } }] }),
    );
    const result = await generateLlamaCppText(
      args(fetchImpl, { context: [{ role: 'user', content }], contextTokens: 212992 }),
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).messages[1].content).toBe(
      content,
    );
    expect(result.usage).toBeUndefined();
    expect(
      parseLlamaCppText({
        choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
        usage: { prompt_tokens: -1, completion_tokens: '3' },
      }).usage,
    ).toBeUndefined();
  });
  it('propagates cancellation to the native stream and releases its slot', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    let requestSignal: AbortSignal | null | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      requestSignal = init?.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(new TextEncoder().encode(delta({ content: 'one' })));
          },
          cancel,
        }),
      );
    };
    const result = await streamLlamaCppText(
      args(fetchImpl, { signal: controller.signal, onDelta: () => controller.abort() }),
    );
    expect(result).toEqual({ text: 'one', stopped: true });
    expect(requestSignal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect((await generateLlamaCppText(args(async () => Response.json(completed())))).text).toBe(
      'OK',
    );
  });
  it('rejects oversized frames rather than buffering an unbounded response', async () => {
    await expect(
      streamLlamaCppText(args(async () => new Response('data: ' + 'x'.repeat(1024 * 1024 + 1)))),
    ).rejects.toMatchObject({ code: 'ai_llamacpp_invalid' });
  });
});

describe('llama.cpp bounded slot queue', () => {
  it('bounds waiters, removes cancelled work, and grants the next request once', async () => {
    const queue = new LlamaCppQueue(1, 1000);
    const signal = new AbortController().signal;
    const release = await queue.acquire(signal);
    const abort = new AbortController();
    const waiting = queue.acquire(abort.signal);
    await expect(queue.acquire(signal)).rejects.toMatchObject({ code: 'ai_llamacpp_busy' });
    abort.abort();
    await expect(waiting).rejects.toBeDefined();
    const next = queue.acquire(signal);
    release();
    release();
    const end = await next;
    expect(queue.idle).toBe(false);
    end();
    expect(queue.idle).toBe(true);
  });
  it('times out queued work without releasing another active request', async () => {
    const queue = new LlamaCppQueue(1, 5);
    const signal = new AbortController().signal;
    const end = await queue.acquire(signal);
    await expect(queue.acquire(signal)).rejects.toMatchObject({ code: 'ai_llamacpp_busy' });
    expect(queue.idle).toBe(false);
    end();
    expect(queue.idle).toBe(true);
  });
});
