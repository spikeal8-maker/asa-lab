import { describe, expect, it, vi } from 'vitest';
import { parseProviderText, ProviderStreamError, streamProviderText } from './ai-provider-stream';

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
  model: 'gpt-5-mini',
  apiKey: 'sk-test-only-not-a-secret',
  context: [{ role: 'user' as const, content: 'Что такое Arduino?' }],
  instructions: 'Test instruction',
};

describe('provider SSE adapter', () => {
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
      model: 'deepseek-chat',
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
      model: 'deepseek-chat',
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
      parseProviderText('openai', { status: 'completed', output_text: 'a'.repeat(9000) }),
    ).toEqual({ text: 'a'.repeat(8192), stopped: true });
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
