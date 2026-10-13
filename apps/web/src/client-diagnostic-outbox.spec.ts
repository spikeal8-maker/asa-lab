import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticOutbox } from './client-diagnostic-outbox';
const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const event = (n = 1) => ({
  eventId: id(n),
  occurredAt: Date.now(),
  code: 'autosave_failed',
  module: 'electronics',
  revision: 'abcdef0',
  instanceId: id(999),
});
function storage() {
  let value = '';
  return {
    getItem: () => value,
    setItem: (_key: string, raw: string) => {
      value = raw;
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('bounded diagnostics delivery', () => {
  it('retains the original event across lost acknowledgements and reload, then removes it on acceptance', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', transport);
    const disk = storage();
    const outbox = new DiagnosticOutbox(disk);
    const original = event();
    outbox.enqueue(original);
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(disk.getItem())).toEqual([original]);
    transport.mockResolvedValue(new Response(null, { status: 202 }));
    new DiagnosticOutbox(disk).retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(transport.mock.calls[1]![1].body)).toEqual(original);
    expect(JSON.parse(disk.getItem())).toEqual([]);
  });
  it.each([408, 429, 500, 503])(
    'retries temporary HTTP %i with the same identity',
    async (status) => {
      const transport = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status }))
        .mockResolvedValue(new Response(null, { status: 202 }));
      vi.stubGlobal('fetch', transport);
      new DiagnosticOutbox().enqueue(event());
      await vi.advanceTimersByTimeAsync(999);
      expect(transport).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(transport).toHaveBeenCalledTimes(2);
      expect(transport.mock.calls[1]![1].body).toBe(transport.mock.calls[0]![1].body);
    },
  );
  it('drops permanently rejected reports and never retries private storage content', async () => {
    const transport = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    vi.stubGlobal('fetch', transport);
    const disk = storage();
    disk.setItem(
      '',
      JSON.stringify([
        { ...event(), message: 'password=secret' },
        { ...event(2), script: '/assets/test.js?secret=private' },
        event(3),
      ]),
    );
    new DiagnosticOutbox(disk).retryNow();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![1].body).not.toContain('secret');
    expect(JSON.parse(disk.getItem())).toEqual([]);
  });
  it('bounds a long outage and expires reports instead of growing without limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const disk = storage();
    const outbox = new DiagnosticOutbox(disk);
    outbox.enqueue({ ...event(), code: 'editor_heartbeat' });
    for (let n = 2; n <= 51; n++) outbox.enqueue(event(n));
    expect(JSON.parse(disk.getItem())).toHaveLength(50);
    expect(disk.getItem()).not.toContain('editor_heartbeat');
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(JSON.parse(disk.getItem())).toEqual([]);
  });
  it('times out a stalled transport and survives blocked session storage', async () => {
    const transport = vi
      .fn()
      .mockImplementation(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      );
    vi.stubGlobal('fetch', transport);
    const outbox = new DiagnosticOutbox({
      getItem: () => {
        throw Error('denied');
      },
      setItem: () => {
        throw Error('denied');
      },
    });
    expect(() => outbox.enqueue(event())).not.toThrow();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
