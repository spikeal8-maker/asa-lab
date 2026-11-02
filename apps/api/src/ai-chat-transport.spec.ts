import { EventEmitter } from 'node:events';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiAccessService } from './ai-access.service';
import { AiChatController } from './ai-chat.controller';
import { AiServiceError, type AiChatService } from './ai-chat.service';
import type { SeatContextUseCase } from './seat-context';

const OWNER = '11111111-1111-4111-8111-111111111111';
const THREAD = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const RESULT = { messages: [], replayed: false, stopped: false };

function fixture() {
  let complete!: (result: typeof RESULT) => void;
  let fail!: (problem: Error) => void;
  const pending = new Promise<typeof RESULT>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  const raw = Object.assign(new EventEmitter(), {
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    writableEnded: false,
    destroyed: false,
  });
  const sendStream = vi.fn<AiChatService['sendStream']>(() => {
    // The proxy must already have headers and bytes before provider admission/wait.
    expect(raw.flushHeaders).toHaveBeenCalledExactlyOnceWith();
    expect(raw.write).toHaveBeenCalledExactlyOnceWith(': connected\n\n');
    return pending;
  });
  const controller = new AiChatController(
    {
      resolve: vi.fn(async () => ({ principalId: OWNER, accountId: OWNER })),
    } as unknown as ActiveContextUseCase,
    { sendStream } as unknown as AiChatService,
    {} as SeatContextUseCase,
    { owner: vi.fn(async () => OWNER) } as unknown as AiAccessService,
  );
  const run = () =>
    controller.sendStream(
      {
        cookies: {},
        headers: {
          origin: 'https://asa.test',
          host: 'asa.test',
          'content-type': 'application/json',
        },
      } as unknown as FastifyRequest,
      { hijack: vi.fn(), raw } as unknown as FastifyReply,
      THREAD,
      { message: 'Вопрос', requestId: REQUEST },
    );
  const signal = () => sendStream.mock.calls[0]![5];
  const delta = (text: string) => sendStream.mock.calls[0]![4](text);
  const expectClean = () => {
    expect(raw.listenerCount('close')).toBe(0);
    expect(raw.listenerCount('error')).toBe(0);
  };
  return { raw, sendStream, run, complete, fail, signal, delta, expectClean };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  const timers = vi.getTimerCount();
  vi.useRealTimers();
  expect(timers).toBe(0);
});

describe('AI SSE lifetime while a provider is queued', () => {
  it('does not admit provider work when the response has already disconnected', async () => {
    const f = fixture();
    f.raw.destroyed = true;
    await f.run();
    expect(f.sendStream).not.toHaveBeenCalled();
    expect(f.raw.write).not.toHaveBeenCalled();
    expect(f.raw.end).not.toHaveBeenCalled();
    f.expectClean();
  });

  it('does not start a heartbeat or provider after a disconnect during the initial write', async () => {
    const f = fixture();
    f.raw.write.mockImplementationOnce(() => {
      f.raw.emit('close');
    });
    await f.run();
    expect(f.sendStream).not.toHaveBeenCalled();
    expect(f.raw.end).not.toHaveBeenCalled();
    f.expectClean();
  });

  it('flushes immediately and keeps a provider wait beyond 60 seconds alive without duplicating work', async () => {
    const f = fixture();
    const finished = f.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.raw.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Accel-Buffering': 'no',
      }),
    );
    expect(f.sendStream).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(75_000);
    expect(f.raw.write.mock.calls.map(([frame]) => frame)).toEqual([
      ': connected\n\n',
      ...Array.from({ length: 5 }, () => ': heartbeat\n\n'),
    ]);
    expect(f.raw.end).not.toHaveBeenCalled();
    expect(f.signal().aborted).toBe(false);
    f.delta('Ответ');
    f.complete(RESULT);
    await finished;
    expect(f.raw.write).toHaveBeenNthCalledWith(7, 'event: delta\ndata: {"text":"Ответ"}\n\n');
    expect(f.raw.write).toHaveBeenLastCalledWith(
      'event: done\ndata: ' + JSON.stringify(RESULT) + '\n\n',
    );
    expect(f.raw.end).toHaveBeenCalledExactlyOnceWith();
    f.expectClean();
    f.raw.emit('close');
    expect(f.signal().aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.raw.write).toHaveBeenCalledTimes(8);
    expect(f.sendStream).toHaveBeenCalledTimes(1);
  });

  it('sends exactly one safe provider error and clears the heartbeat', async () => {
    const f = fixture();
    const finished = f.run();
    await vi.advanceTimersByTimeAsync(15_000);
    f.fail(new Error('private provider endpoint and credentials'));
    await finished;
    const frames = f.raw.write.mock.calls.map(([frame]) => frame).join('');
    expect(frames.match(/event: error/g)).toHaveLength(1);
    expect(frames).toContain('"code":"ai_provider_unavailable"');
    expect(frames).not.toContain('private');
    expect(frames).not.toContain('event: done');
    expect(f.raw.end).toHaveBeenCalledExactlyOnceWith();
    expect(f.signal().aborted).toBe(false);
    f.expectClean();
  });

  for (const reason of ['close', 'error', 'write failure'] as const) {
    it(`cleans up immediately on ${reason} and cancels only its own provider wait`, async () => {
      const f = fixture();
      const other = fixture();
      const finished = f.run();
      const otherFinished = other.run();
      await vi.advanceTimersByTimeAsync(0);
      if (reason === 'write failure') {
        f.raw.write.mockImplementationOnce(() => {
          throw new Error('socket closed');
        });
        await vi.advanceTimersByTimeAsync(15_000);
      } else {
        f.raw.emit(reason, new Error('socket closed'));
      }
      expect(f.signal().aborted).toBe(true);
      expect(other.signal().aborted).toBe(false);
      f.expectClean();
      expect(vi.getTimerCount()).toBe(1);
      const writes = f.raw.write.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      f.delta('late private answer');
      if (reason === 'error') f.fail(new AiServiceError('ai_provider_unavailable', 503, 'Ошибка'));
      else f.complete(RESULT);
      other.complete(RESULT);
      await Promise.all([finished, otherFinished]);
      expect(f.raw.write).toHaveBeenCalledTimes(writes);
      expect(f.raw.end).not.toHaveBeenCalled();
      expect(other.raw.end).toHaveBeenCalledExactlyOnceWith();
      other.expectClean();
    });
  }
});
