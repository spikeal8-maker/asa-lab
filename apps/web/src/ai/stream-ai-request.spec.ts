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
      const payload = frame('delta', { text: 'x'.repeat(4 * 1024 * 1024) });
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
