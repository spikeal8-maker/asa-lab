import { describe, expect, it, vi } from 'vitest';
import { parseProviderText, ProviderStreamError, streamProviderText } from './ai-provider-stream';
import { workingFileTools } from './ai-working-files';

const encoding = new TextEncoder();

function fakeSse(payload: string, parts: number[] = []): Response {
  const bytes = encoding.encode(payload);
  let position = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (position >= bytes.length) return controller.close();
      const size = parts.shift() ?? bytes.length;
      controller.enqueue(bytes.slice(position, position + size));
      position += size;
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

const input = {
  provider: 'openai' as const,
  model: 'gpt-6-luna',
  apiKey: 'sk-test-only-not-a-secret',
  context: [{ role: 'user' as const, content: 'Что такое Arduino?' }],
  instructions: 'Test instruction',
};

describe('provider SSE adapter', () => {
  it.each(['deepseek', 'ollama-cloud', 'openai'] as const)(
    'decodes %s file calls without printing arguments and returns results to the model',
    async (provider) => {
      const call = { name: 'read_working_file' as const, arguments: { name: 'snake.html' } };
      const event = (data: unknown) => 'data: ' + JSON.stringify(data) + '\n\n';
      const response =
        provider === 'openai'
          ? event({
              type: 'response.output_item.done',
              output_index: 0,
              item: {
                type: 'function_call',
                name: call.name,
                arguments: JSON.stringify(call.arguments),
              },
            }) + event({ type: 'response.completed' })
          : event({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, function: { name: 'read_working_', arguments: '{"name":' } },
                    ],
                  },
                },
              ],
            }) +
            event({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, function: { name: 'file', arguments: '"snake.html"}' } },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            }) +
            'data: [DONE]\n\n';
      const fetchImpl = vi.fn<typeof fetch>(async () => fakeSse(response, [1, 9, 3]));
      const delta = vi.fn();
      const args = {
        ...input,
        provider,
        model:
          provider === 'openai'
            ? input.model
            : provider === 'deepseek'
              ? 'deepseek-flash'
              : 'gemma4:31b',
        tools: workingFileTools(),
        fetchImpl,
        signal: new AbortController().signal,
        onDelta: delta,
      };
      expect(await streamProviderText(args)).toMatchObject({
        text: '',
        stopped: false,
        toolCalls: [call],
      });
      expect(delta).not.toHaveBeenCalled();
      await streamProviderText({
        ...args,
        toolResults: [{ call, content: '{"version":1,"content":"snake"}' }],
      });
      const body = JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body));
      expect(body.parallel_tool_calls).toBe(false);
      const messages = provider === 'openai' ? body.input : body.messages;
      expect(messages.at(-1)).toMatchObject(
        provider === 'openai'
          ? { type: 'function_call_output', call_id: 'call_asa_0' }
          : { role: 'tool', tool_call_id: 'call_asa_0' },
      );
      expect(JSON.stringify(messages)).toContain('snake');
    },
  );
  it('rejects malformed function arguments as a typed stream failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      fakeSse(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read_working_file","arguments":"{"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
      ),
    );
    await expect(
      streamProviderText({
        ...input,
        provider: 'deepseek',
        model: 'deepseek-flash',
        tools: workingFileTools(),
        fetchImpl,
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'ai_tool_call_invalid', status: 503 });
  });
  it('uses only the fixed Ollama Cloud endpoint with Bearer key and records reported usage', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, options) => {
      expect(url).toBe('https://ollama.com/v1/chat/completions');
      expect(new Headers(options?.headers).get('authorization')).toBe('Bearer test-cloud-key');
      expect(options?.redirect).toBe('error');
      const body = JSON.parse(String(options?.body));
      expect(body.model).toBe('gemma4:31b');
      expect(body.thinking).toBeUndefined();
      return fakeSse(
        'data: {"model":"gemma4:31b","choices":[{"delta":{"content":"Привет"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":4}}\n\ndata: [DONE]\n\n',
        [3, 7, 1, 15],
      );
    });
    const result = await streamProviderText({
      ...input,
      provider: 'ollama-cloud',
      model: 'gemma4:31b',
      apiKey: 'test-cloud-key',
      fetchImpl,
      signal: new AbortController().signal,
      onDelta: () => undefined,
    });
    expect(result).toMatchObject({
      text: 'Привет',
      stopped: false,
      usage: { inputTokens: 12, outputTokens: 4, actualModel: 'gemma4:31b' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      parseProviderText('ollama-cloud', {
        choices: [{ message: { content: 'JSON' }, finish_reason: 'length' }],
      }),
    ).toMatchObject({ text: 'JSON', stopped: true });
    expect(() =>
      parseProviderText('ollama-cloud', { choices: [{ message: { content: 'incomplete' } }] }),
    ).toThrow('Модель не завершила ответ');
  });
  it('decodes OpenAI multi-byte text across SSE and UTF-8 boundaries', async () => {
    const text =
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Привет"}\n\n' +
      'event: response.output_text.delta\ndata: {"delta":"! ✅"}\n\n' +
      'event: response.completed\ndata: {"type":"response.completed"}\n\n';
    const chunks: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => fakeSse(text, [7, 9, 1, 19, 2, 3, 47, 1, 2]));
    const result = await streamProviderText({
      ...input,
      fetchImpl,
      signal: new AbortController().signal,
      onDelta: (piece) => chunks.push(piece),
    });
    expect(result).toEqual({ text: 'Привет! ✅', stopped: false });
    expect(chunks).toEqual(['Привет', '! ✅']);
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    const request = JSON.parse(String(options?.body)) as Record<string, unknown>;
    expect(request.stream).toBe(true);
    expect(request.store).toBe(false);
    expect(JSON.stringify(request)).not.toContain('sk-test-only-not-a-secret');
  });

  it('maps DeepSeek completion deltas and [DONE] without exposing credentials', async () => {
    const text =
      'data: {"choices":[{"delta":{"content":"Электроника"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" и Arduino"}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n';
    const calls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => fakeSse(text));
    const result = await streamProviderText({
      ...input,
      provider: 'deepseek',
      model: 'deepseek-flash',
      fetchImpl,
      signal: new AbortController().signal,
      onDelta: (text) => calls.push(text),
    });
    expect(result.text).toBe('Электроника и Arduino');
    expect(result.stopped).toBe(false);
    expect(calls).toEqual(['Электроника', ' и Arduino']);
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(JSON.parse(String(options?.body))).toMatchObject({
      stream: true,
      model: 'deepseek-flash',
    });
  });

  it('does not POST when the client has already canceled', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await streamProviderText({
      ...input,
      fetchImpl,
      signal: controller.signal,
      onDelta: () => undefined,
    });
    expect(result).toEqual({ text: '', stopped: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never retries a rejected provider or parses raw provider error text', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('private provider error', { status: 429 }),
    );
    await expect(
      streamProviderText({
        ...input,
        fetchImpl,
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    ).rejects.toMatchObject({
      code: 'ai_provider_rate_limit',
      status: 429,
    } satisfies Partial<ProviderStreamError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  for (const terminal of ['eof', 'response.failed', 'response.incomplete', 'wrong-done']) {
    it(`never labels partial ${terminal} as a completed OpenAI response`, async () => {
      const delta = 'event: response.output_text.delta\ndata: {"delta":"Часть ответа"}\n\n';
      const end =
        terminal === 'eof'
          ? ''
          : terminal === 'wrong-done'
            ? 'data: [DONE]\n\n'
            : `event: ${terminal}\ndata: ${JSON.stringify({ type: terminal })}\n\n`;
      const fetchImpl = vi.fn<typeof fetch>(async () => fakeSse(delta + end));
      await expect(
        streamProviderText({
          ...input,
          fetchImpl,
          signal: new AbortController().signal,
          onDelta: () => undefined,
        }),
      ).rejects.toMatchObject({ partialText: 'Часть ответа', status: 503 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  }

  it('preserves a DeepSeek length-truncated reply as stopped, not complete', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      fakeSse(
        'data: {"choices":[{"delta":{"content":"Часть"},"finish_reason":"length"}]}\n\n' +
          'data: [DONE]\n\n',
      ),
    );
    const result = await streamProviderText({
      ...input,
      provider: 'deepseek',
      model: 'deepseek-flash',
      fetchImpl,
      signal: new AbortController().signal,
      onDelta: () => undefined,
    });
    expect(result).toEqual({ text: 'Часть', stopped: true });
  });

  it('does not accept DeepSeek DONE without a completion reason', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      fakeSse('data: {"choices":[{"delta":{"content":"Часть"}}]}\n\ndata: [DONE]\n\n'),
    );
    await expect(
      streamProviderText({
        ...input,
        provider: 'deepseek',
        model: 'deepseek-flash',
        fetchImpl,
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'ai_response_incomplete', partialText: 'Часть' });
  });

  it('rejects a completed event whose response declares incomplete', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      fakeSse(
        'event: response.output_text.delta\ndata: {"delta":"Часть"}\n\n' +
          'event: response.completed\ndata: {"response":{"status":"incomplete"}}\n\n',
      ),
    );
    await expect(
      streamProviderText({
        ...input,
        fetchImpl,
        signal: new AbortController().signal,
        onDelta: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'ai_response_incomplete', partialText: 'Часть' });
  });
});

describe('provider JSON completion semantics', () => {
  it('reads completed OpenAI output items and completed DeepSeek text', () => {
    expect(
      parseProviderText('openai', {
        status: 'completed',
        output: [{ content: [{ type: 'output_text', text: 'Ответ' }] }],
      }),
    ).toEqual({ text: 'Ответ', stopped: false });
    expect(
      parseProviderText('deepseek', {
        choices: [{ message: { content: 'Ответ' }, finish_reason: 'stop' }],
      }),
    ).toEqual({ text: 'Ответ', stopped: false });
  });

  it.each(['incomplete', 'in_progress', 'queued', 'cancelled', undefined, null])(
    'preserves partial OpenAI text without completing status %s',
    (status) => {
      expect(() => parseProviderText('openai', { status, output_text: 'Частичный ответ' })).toThrow(
        expect.objectContaining({
          code: 'ai_response_incomplete',
          partialText: 'Частичный ответ',
          status: 503,
        }),
      );
    },
  );

  it('does not expose provider error bodies for a failed OpenAI result', () => {
    expect(() =>
      parseProviderText('openai', {
        status: 'failed',
        output_text: 'Часть',
        error: { message: 'private provider detail' },
      }),
    ).toThrow(expect.objectContaining({ code: 'ai_provider_error', partialText: 'Часть' }));
  });

  it('keeps DeepSeek length-limited JSON text as stopped', () => {
    expect(
      parseProviderText('deepseek', {
        choices: [{ finish_reason: 'length', message: { content: 'Частичный ответ' } }],
      }),
    ).toEqual({ text: 'Частичный ответ', stopped: true });
  });

  it.each([
    'tool_calls',
    'content_filter',
    'insufficient_system_resource',
    'aborted',
    null,
    undefined,
  ])('does not complete a DeepSeek response with reason %s', (finish_reason) => {
    expect(() =>
      parseProviderText('deepseek', {
        choices: [{ finish_reason, message: { content: 'Часть' } }],
      }),
    ).toThrow(expect.objectContaining({ code: 'ai_response_incomplete', partialText: 'Часть' }));
  });

  it('marks a locally bounded JSON response as stopped', () => {
    expect(
      parseProviderText('openai', { status: 'completed', output_text: 'a'.repeat(65537) }),
    ).toEqual({ text: 'a'.repeat(65536), stopped: true });
  });

  it('preserves a complete code file beyond the former 8192-character ceiling in JSON and SSE', async () => {
    const code =
      '<!doctype html>\n<script>\n' + 'const step = () => {};\n'.repeat(600) + '</script>';
    expect(code.length).toBeGreaterThan(8192);
    expect(parseProviderText('openai', { status: 'completed', output_text: code })).toEqual({
      text: code,
      stopped: false,
    });
    for (const provider of ['openai', 'deepseek', 'ollama-cloud'] as const) {
      const body =
        provider === 'openai'
          ? 'event: response.output_text.delta\ndata: ' +
            JSON.stringify({ delta: code }) +
            '\n\nevent: response.completed\ndata: {"type":"response.completed"}\n\n'
          : 'data: ' +
            JSON.stringify({ choices: [{ delta: { content: code }, finish_reason: null }] }) +
            '\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
      const fetchImpl = vi.fn<typeof fetch>(async () => fakeSse(body));
      const delta = vi.fn();
      const result = await streamProviderText({
        fetchImpl,
        provider,
        model:
          provider === 'openai'
            ? 'gpt-5-mini'
            : provider === 'deepseek'
              ? 'deepseek-flash'
              : 'gemma4:31b',
        apiKey: 'test-only',
        context: [],
        instructions: '',
        signal: new AbortController().signal,
        onDelta: delta,
      });
      expect(result).toEqual({ text: code, stopped: false });
      expect(delta.mock.calls.map(([part]) => part).join('')).toBe(code);
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it('preserves OpenAI token-limit text as incomplete instead of reporting success or discarding it', async () => {
    const response = {
      status: 'incomplete',
      output_text: 'Часть',
      incomplete_details: { reason: 'max_output_tokens' },
    };
    expect(parseProviderText('openai', response)).toEqual({ text: 'Часть', stopped: true });
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      fakeSse(
        'event: response.output_text.delta\ndata: {"delta":"Часть"}\n\nevent: response.incomplete\ndata: ' +
          JSON.stringify({ response }) +
          '\n\n',
      ),
    );
    expect(
      await streamProviderText({
        fetchImpl,
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKey: 'test',
        context: [],
        instructions: '',
        signal: new AbortController().signal,
        onDelta: vi.fn(),
      }),
    ).toEqual({ text: 'Часть', stopped: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([null, [], 'invalid'])('rejects malformed JSON payload %s', (body) => {
    expect(() => parseProviderText('openai', body)).toThrow(
      expect.objectContaining({ code: 'ai_response_invalid' }),
    );
  });

  it.each([undefined, null, {}, [null, { content: null }, { content: [null] }]])(
    'rejects malformed or empty OpenAI output without leaking a runtime TypeError',
    (output) => {
      expect(() => parseProviderText('openai', { status: 'completed', output })).toThrow(
        expect.objectContaining({ code: 'ai_response_empty' }),
      );
    },
  );
});
