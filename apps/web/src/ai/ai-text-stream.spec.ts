import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithSessionRefresh } from '../session-fetch';
import { streamAiRegeneration } from './stream-ai-request';

vi.mock('../session-fetch', () => ({ fetchWithSessionRefresh: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const answer = { id: 'answer', content: 'Другой вариант', requestId: 'new-request' };
function response(body: string) {
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

describe('fresh answer transport', () => {
  it('sends a persisted source and new request ID with the same proven Seat scope; never resubmits prompt text', async () => {
    vi.mocked(fetchWithSessionRefresh).mockResolvedValue(
      response(
        'event: done\ndata: ' +
          JSON.stringify({ messages: [answer], replayed: false, stopped: false }) +
          '\n\n',
      ),
    );
    const signal = new AbortController().signal;
    expect(
      await streamAiRegeneration(
        'thread',
        'original-question',
        'new-request',
        vi.fn(),
        signal,
        'gpt-5-mini',
        { 'x-asa-ai-seat': 'seat' },
      ),
    ).toEqual({ messages: [answer], replayed: false, stopped: false });
    expect(fetchWithSessionRefresh).toHaveBeenCalledExactlyOnceWith(
      '/api/ai/threads/thread/regenerations/stream',
      {
        method: 'POST',
        headers: {
          'x-asa-ai-seat': 'seat',
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({
          sourceUserMessageId: 'original-question',
          requestId: 'new-request',
          model: 'gpt-5-mini',
        }),
        signal,
      },
    );
  });

  it('leaves a lost result uncertain without retrying any paid endpoint', async () => {
    vi.mocked(fetchWithSessionRefresh).mockResolvedValue(
      response('event: delta\ndata: {"text":"Часть"}\n\n'),
    );
    const delta = vi.fn();
    await expect(
      streamAiRegeneration('thread', 'source', 'same-request', delta, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ai_stream_interrupted' });
    expect(delta).toHaveBeenCalledExactlyOnceWith('Часть');
    expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(1);
  });

  it('preserves a stopped stored answer and a free replay acknowledgement', async () => {
    const result = { messages: [{ ...answer, state: 'stopped' }], replayed: true, stopped: true };
    vi.mocked(fetchWithSessionRefresh).mockResolvedValue(
      response('event: done\ndata: ' + JSON.stringify(result) + '\n\n'),
    );
    await expect(
      streamAiRegeneration(
        'thread',
        'source',
        'same-request',
        vi.fn(),
        new AbortController().signal,
      ),
    ).resolves.toEqual(result);
    expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(1);
  });
});
