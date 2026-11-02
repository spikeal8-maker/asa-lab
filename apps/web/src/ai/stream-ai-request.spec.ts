import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithSessionRefresh } from '../session-fetch';
import { streamAiRequest } from './stream-ai-request';

vi.mock('../session-fetch', () => ({ fetchWithSessionRefresh: vi.fn() }));

function frame(kind: string, data: unknown): string {
  return `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
}

function respond(chunks: readonly (string | Uint8Array)[]): void {
  vi.mocked(fetchWithSessionRefresh).mockResolvedValue(
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
          }
          controller.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    ),
  );
}

const send = (onDelta = vi.fn()) =>
  streamAiRequest('thread', 'Вопрос', 'request', onDelta, new AbortController().signal);

afterEach(() => vi.resetAllMocks());

describe('native AI SSE transport', () => {
  it('ignores connection and periodic heartbeat comments across network boundaries', async () => {
    const result = { messages: [], replayed: false, stopped: false };
    const payload =
      ': connected\n\n' +
      ': heartbeat\n\n'.repeat(5) +
      frame('delta', { text: 'Ответ' }) +
      ': heartbeat\n\n' +
      frame('done', result);
    respond(Array.from(new TextEncoder().encode(payload), (byte) => Uint8Array.of(byte)));
    const onDelta = vi.fn();
    await expect(send(onDelta)).resolves.toEqual(result);
    expect(onDelta).toHaveBeenCalledExactlyOnceWith('Ответ');
  });

  it('sends the explicit internet mode only for the new operation, without endpoint or credentials', async () => {
    respond([frame('done', { messages: [], replayed: false, stopped: false })]);
    await streamAiRequest(
      'thread',
      'Погода в Казани',
      'request',
      vi.fn(),
      new AbortController().signal,
      'ollama-local',
      { 'x-asa-ai-seat': 'seat' },
      [],
      { mode: 'weather', weatherCity: 'Казань' },
    );
    expect(JSON.parse(String(vi.mocked(fetchWithSessionRefresh).mock.calls[0]?.[1]?.body))).toEqual(
      {
        message: 'Погода в Казани',
        requestId: 'request',
        model: 'ollama-local',
        webSearchMode: 'weather',
        weatherCity: 'Казань',
      },
    );
  });
  it('carries only the selected upload IDs for this exact request and Seat', async () => {
    const result = { messages: [], replayed: false, stopped: false };
    respond([frame('done', result)]);
    await expect(
      streamAiRequest(
        'thread',
        'Прочитай файл',
        'request',
        vi.fn(),
        new AbortController().signal,
        'ollama-local',
        { 'x-asa-ai-seat': 'learner-seat' },
        ['44444444-4444-4444-8444-444444444444'],
      ),
    ).resolves.toEqual(result);
    const [url, init] = vi.mocked(fetchWithSessionRefresh).mock.calls[0]!;
    expect(url).toBe('/api/ai/threads/thread/messages/stream');
    expect((init?.headers as Record<string, string>)['x-asa-ai-seat']).toBe('learner-seat');
    expect(JSON.parse(String(init?.body))).toEqual({
      message: 'Прочитай файл',
      requestId: 'request',
      model: 'ollama-local',
      attachmentIds: ['44444444-4444-4444-8444-444444444444'],
    });
  });

  it('preserves UTF-8 characters and CRLF delimiters split across byte chunks', async () => {
    const result = { messages: [{ content: 'Ответ 🧪' }], replayed: false, stopped: false };
    const payload = (frame('delta', { text: 'Привет 🧪' }) + frame('done', result)).replace(
      /\n/g,
      '\r\n',
    );
    // Every multibyte character and every CRLF crosses a network boundary.
    respond(Array.from(new TextEncoder().encode(payload), (byte) => Uint8Array.of(byte)));
    const onDelta = vi.fn();
    await expect(send(onDelta)).resolves.toEqual(result);
    expect(onDelta).toHaveBeenCalledExactlyOnceWith('Привет 🧪');
  });

  for (const split of [false, true]) {
    it(`accepts a real last-80 completion over 128 KiB, split=${split}`, async () => {
      const result = {
        messages: Array.from({ length: 80 }, (_, id) => ({ id, content: 'Я'.repeat(8192) })),
        replayed: true,
        stopped: false,
      };
      const payload = frame('done', result);
      expect(payload.length).toBeGreaterThan(128 * 1024);
      respond(split ? [payload.slice(0, 150_000), payload.slice(150_000)] : [payload]);
      await expect(send()).resolves.toEqual(result);
    });
  }

  it('parses coalesced small frames before bounding the unfinished remainder', async () => {
    const delta = frame('delta', { text: 'x'.repeat(4096) });
    // The complete batch exceeds even the per-event cap; no individual event does.
    const batch = delta.repeat(1030);
    expect(batch.length).toBeGreaterThan(4 * 1024 * 1024);
    const done = frame('done', { messages: [], replayed: false, stopped: true });
    respond([batch + done.slice(0, 10), done.slice(10)]);
    const onDelta = vi.fn();
    await expect(send(onDelta)).resolves.toEqual({ messages: [], replayed: false, stopped: true });
    expect(onDelta).toHaveBeenCalledTimes(1030);
    expect(onDelta).toHaveBeenLastCalledWith('x'.repeat(4096));
  });

  for (const complete of [false, true]) {
    it(`rejects an oversized single event, complete=${complete}`, async () => {
      const payload = frame('delta', { text: 'x'.repeat(32 * 1024 * 1024) });
      respond(complete ? [payload] : [payload.slice(0, 100_000), payload.slice(100_000, -2)]);
      const onDelta = vi.fn();
      await expect(send(onDelta)).rejects.toMatchObject({ code: 'ai_stream_invalid' });
      expect(onDelta).not.toHaveBeenCalled();
    });
  }

  it('does not turn EOF without done into success', async () => {
    respond([frame('delta', { text: 'Часть' })]);
    await expect(send()).rejects.toMatchObject({ code: 'ai_stream_interrupted' });
  });
});
