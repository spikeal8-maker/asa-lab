// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '../../apps/web/src/api';
import {
  createLearningInboxPoller,
  type LearningInboxSnapshot,
} from '../../apps/web/src/components/learning-inbox-poller';

const success = (unread = 1): ApiResult<LearningInboxSnapshot> => ({
  ok: true,
  status: 200,
  data: { snapshot: '2026-10-08T00:00:00Z', unread, items: [] },
});
const failure: ApiResult<LearningInboxSnapshot> = {
  ok: false,
  status: 503,
  error: { code: 'unavailable', message: 'События временно недоступны' },
};
function deferred() {
  let resolve!: (result: ApiResult<LearningInboxSnapshot>) => void;
  const promise = new Promise<ApiResult<LearningInboxSnapshot>>((done) => (resolve = done));
  return { promise, resolve };
}
let visibility: DocumentVisibilityState;
let pollers: ReturnType<typeof createLearningInboxPoller>[];
const visible = (value: DocumentVisibilityState) => {
  visibility = value;
  document.dispatchEvent(new Event('visibilitychange'));
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function start(load = vi.fn().mockResolvedValue(success()), random = () => 0.5) {
  const onResult = vi.fn();
  const poller = createLearningInboxPoller({ load, onResult, random });
  pollers.push(poller);
  return { poller, load, onResult };
}
beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  pollers = [];
});
afterEach(() => {
  pollers.forEach((poller) => poller.stop());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('visible, single-flight learning inbox lifecycle', () => {
  it('does not load or schedule an initially hidden tab; visible/focus share one fresh load', async () => {
    visibility = 'hidden';
    const { load } = start();
    await vi.advanceTimersByTimeAsync(300000);
    expect(load).not.toHaveBeenCalled();
    visible('visible');
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(200);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('pauses periodic polling while hidden and resumes fresh after visibility returns', async () => {
    const { load } = start();
    await flush();
    await vi.advanceTimersByTimeAsync(14999);
    expect(load).toHaveBeenCalledTimes(1);
    visible('hidden');
    await vi.advanceTimersByTimeAsync(300000);
    window.dispatchEvent(new Event('focus'));
    expect(load).toHaveBeenCalledTimes(1);
    visible('visible');
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('coalesces nearby focus and visibility events even when the API resolves immediately', async () => {
    const { load } = start();
    await vi.advanceTimersByTimeAsync(1000);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledTimes(2);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(249);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('allows explicit open/retry immediately while rejecting concurrent refreshes', async () => {
    const first = deferred();
    const { poller, load } = start(
      vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(success()),
    );
    void poller.refresh();
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(load).toHaveBeenCalledTimes(1);
    first.resolve(success());
    await flush();
    await poller.refresh();
    expect(load).toHaveBeenCalledTimes(2);
    await poller.refresh();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it.each([
    [0, 12000],
    [1, 18000],
  ])('bounds normal jitter for random %s at %sms', async (random, delay) => {
    const { load } = start(undefined, () => random);
    await flush();
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('backs off to a bounded maximum, then resets the interval after success', async () => {
    const load = vi.fn().mockResolvedValue(failure);
    start(load);
    await flush();
    for (const delay of [30000, 60000, 120000, 120000]) {
      const calls = load.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(load).toHaveBeenCalledTimes(calls);
      await vi.advanceTimersByTimeAsync(1);
      expect(load).toHaveBeenCalledTimes(calls + 1);
    }
    load.mockResolvedValue(success());
    await vi.advanceTimersByTimeAsync(120000);
    const calls = load.mock.calls.length;
    await vi.advanceTimersByTimeAsync(14999);
    expect(load).toHaveBeenCalledTimes(calls);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(calls + 1);
  });

  it('explicit retry bypasses error backoff; thrown loads become a recoverable error', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(success());
    const { poller, onResult } = start(load);
    await flush();
    expect(onResult.mock.calls[0][0]).toMatchObject({ ok: false, error: { code: 'network' } });
    await poller.refresh();
    expect(onResult.mock.calls[1][0]).toEqual(success());
    await vi.advanceTimersByTimeAsync(15000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('cleans timers/listeners and ignores a late old-actor result', async () => {
    const old = deferred();
    const previous = start(vi.fn().mockReturnValue(old.promise));
    previous.poller.stop();
    const next = start(vi.fn().mockResolvedValue(success(7)));
    await flush();
    old.resolve(success(99));
    await flush();
    expect(previous.onResult).not.toHaveBeenCalled();
    expect(next.onResult).toHaveBeenCalledWith(success(7));
    previous.poller.stop();
    next.poller.stop();
    window.dispatchEvent(new Event('focus'));
    visible('hidden');
    visible('visible');
    await vi.advanceTimersByTimeAsync(300000);
    expect(previous.load).toHaveBeenCalledTimes(1);
    expect(next.load).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['get-first', 'read-first'])(
    'discards an old GET across a read finishing %s',
    async (order) => {
      const old = deferred();
      const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(success(0));
      const { poller, onResult } = start(load);
      const finish = poller.beginMutation();
      if (order === 'read-first') finish();
      old.resolve(success(1));
      await flush();
      if (order === 'get-first') {
        expect(onResult).not.toHaveBeenCalled();
        expect(load).toHaveBeenCalledTimes(1);
        finish();
        await flush();
      }
      expect(load).toHaveBeenCalledTimes(2);
      expect(onResult).toHaveBeenCalledTimes(1);
      expect(onResult).toHaveBeenCalledWith(success(0));
      finish();
      expect(load).toHaveBeenCalledTimes(2);
    },
  );

  it('queues a read refresh until visible; disposed mutations cannot schedule an old actor', async () => {
    const { poller, load } = start();
    await flush();
    const finish = poller.beginMutation();
    visible('hidden');
    finish();
    await vi.advanceTimersByTimeAsync(120000);
    expect(load).toHaveBeenCalledTimes(1);
    visible('visible');
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledTimes(2);
    const late = poller.beginMutation();
    poller.stop();
    late();
    await vi.advanceTimersByTimeAsync(120000);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
