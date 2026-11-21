import { afterEach, describe, expect, it, vi } from 'vitest';
import { newestLiveSnapshot, startLivePoll } from '../live-poll';

afterEach(() => vi.useRealTimers());

describe('online Chess synchronization', () => {
  it('waits after each response and never overlaps slow requests', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const request = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = startLivePoll(request, 800, vi.fn());
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(request).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(799);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(2);
    stop();
    finish();
  });

  it('invalidates late replies and schedules no work after leaving a session', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const publish = vi.fn();
    const stop = startLivePoll(
      async (isCurrent) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (isCurrent()) publish();
      },
      800,
      vi.fn(),
    );
    stop();
    finish();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(publish).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers after a failed request without a rapid retry loop', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const failed = vi.fn();
    const stop = startLivePoll(request, 800, failed);
    await vi.advanceTimersByTimeAsync(0);
    expect(failed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(799);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(2);
    stop();
  });

  it('preserves a committed move and newer clocks when an older poll arrives', () => {
    const current = { gameId: 'game', version: 4, sequence: 8, serverNowMs: 100 };
    expect(newestLiveSnapshot(current, { ...current, version: 3, sequence: 7 })).toBe(current);
    expect(newestLiveSnapshot(current, { ...current, serverNowMs: 99 })).toBe(current);
    const next = { ...current, version: 5, sequence: 9, serverNowMs: 101 };
    expect(newestLiveSnapshot(current, next)).toBe(next);
    expect(newestLiveSnapshot(current, null)).toBeNull();
  });
});
