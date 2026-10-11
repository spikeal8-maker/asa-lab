// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trackBlocksActivity, BLOCKS_ACTIVITY_POLL_MS } from '../module-activity';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const trackers: ReturnType<typeof trackBlocksActivity>[] = [];
function fixture() {
  const api = {
    start: vi.fn<(id: string, project: string) => Promise<boolean>>(async () => true),
    touch: vi.fn<(id: string, closed: boolean) => Promise<boolean>>(async () => true),
  };
  const tracker = trackBlocksActivity(PROJECT, api);
  trackers.push(tracker);
  return { tracker, api };
}
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  trackers.splice(0).forEach((tracker) => tracker.dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Scratch ProductAnalytics activity lifecycle', () => {
  it.each([null, {}, { accepted: true, sessionId: 'foreign' }, { accepted: false }])(
    'rejects malformed/null start response %j',
    async (body: unknown) => {
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () => new Response(JSON.stringify(body), { status: 202 }),
      );
      vi.stubGlobal('fetch', fetch);
      const tracker = trackBlocksActivity(PROJECT);
      trackers.push(tracker);
      tracker.setReady(true);
      tracker.input();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('requires readiness and input; opening and liveness alone never create a session', async () => {
    const { tracker, api } = fixture();
    tracker.input();
    tracker.setReady(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.start).not.toHaveBeenCalled();
    tracker.input();
    await flush();
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(api.start.mock.calls[0]?.[1]).toBe(PROJECT);
  });
  it('polls at most once per 30 seconds during input; idle closes and fresh input reopens', async () => {
    const { tracker, api } = fixture();
    tracker.setReady(true);
    tracker.input();
    await flush();
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      tracker.input();
      await flush();
    }
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(api.touch.mock.calls.map((call: [string, boolean]) => call[1])).toEqual([false, false]);
    await vi.advanceTimersByTimeAsync(BLOCKS_ACTIVITY_POLL_MS);
    expect(api.touch.mock.calls.at(-1)?.[1]).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.touch).toHaveBeenCalledTimes(3);
    tracker.input();
    await flush();
    expect(api.start).toHaveBeenCalledTimes(2);
    expect(api.start.mock.calls[1]?.[0]).not.toBe(api.start.mock.calls[0]?.[0]);
  });
  it('hidden tabs close; showing alone does not reopen, input does', async () => {
    const { tracker, api } = fixture();
    tracker.setReady(true);
    tracker.input();
    await flush();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    tracker.input();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.touch).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.start).toHaveBeenCalledTimes(1);
    tracker.input();
    await flush();
    expect(api.start).toHaveBeenCalledTimes(2);
  });
  it('failed starts retry on later input at a bounded rate; unaccepted sessions are never touched', async () => {
    const { tracker, api } = fixture();
    api.start.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('offline'));
    tracker.setReady(true);
    tracker.input();
    await flush();
    for (let i = 0; i < 29; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      tracker.input();
    }
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(api.touch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(api.start).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    tracker.input();
    await flush();
    expect(api.start).toHaveBeenCalledTimes(3);
    expect(api.touch).not.toHaveBeenCalled();
  });
  it.each(['dispose', 'hidden', 'restart'] as const)(
    'closes late successful starts after %s',
    async (reason: 'dispose' | 'hidden' | 'restart') => {
      const { tracker, api } = fixture();
      let resolve!: (ok: boolean) => void;
      api.start.mockImplementationOnce(
        () =>
          new Promise<boolean>((done) => {
            resolve = done;
          }),
      );
      tracker.setReady(true);
      tracker.input();
      if (reason === 'dispose') tracker.dispose();
      else if (reason === 'restart') tracker.setReady(false);
      else {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      }
      resolve(true);
      await flush();
      expect(api.touch).toHaveBeenCalledExactlyOnceWith(api.start.mock.calls[0]?.[0], true);
    },
  );
  it('disposes listeners/timers once and isolates project/principal/frame replacements', async () => {
    const { tracker, api } = fixture();
    tracker.setReady(true);
    tracker.input();
    await flush();
    tracker.dispose();
    tracker.dispose();
    tracker.input();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.touch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    const replacement = trackBlocksActivity('22222222-2222-4222-8222-222222222222', api);
    trackers.push(replacement);
    replacement.setReady(true);
    replacement.input();
    await flush();
    expect(api.start.mock.calls[1]?.[1]).toBe('22222222-2222-4222-8222-222222222222');
    expect(api.start.mock.calls[1]?.[0]).not.toBe(api.start.mock.calls[0]?.[0]);
  });
  it('prevents overlapping polls and survives touch rejection', async () => {
    const { tracker, api } = fixture();
    tracker.setReady(true);
    tracker.input();
    await flush();
    let resolve!: (ok: boolean) => void;
    api.touch.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      tracker.input();
    }
    expect(api.touch).toHaveBeenCalledTimes(1);
    resolve(false);
    await flush();
    expect(api.touch.mock.calls.at(-1)?.[1]).toBe(true);
    tracker.input();
    await flush();
    expect(api.start).toHaveBeenCalledTimes(2);
  });
  it.each([401, 409, 503])(
    'telemetry %s never refreshes/logs out or sends capabilities',
    async (status: number) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}', { status }));
      vi.stubGlobal('fetch', fetch);
      const logout = vi.fn();
      window.addEventListener('asa-session-logout', logout);
      const tracker = trackBlocksActivity(PROJECT);
      trackers.push(tracker);
      tracker.setReady(true);
      tracker.input();
      await flush();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[0]).toBe('/api/analytics/v1/module-session/start');
      const request = fetch.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(request.body as string)).toEqual({
        sessionId: expect.any(String),
        projectId: PROJECT,
        moduleKey: 'blocks',
      });
      expect(request.headers).toEqual({ 'content-type': 'application/json' });
      expect(logout).not.toHaveBeenCalled();
      window.removeEventListener('asa-session-logout', logout);
    },
  );
});
