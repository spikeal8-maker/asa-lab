import { describe, expect, it, vi } from 'vitest';
import { createArduinoAcknowledgedWake, type ArduinoWakeLease } from '../arduino-acknowledged-wake';

function harness() {
  let now = 0;
  let nextTimeoutId = 0;
  let lease: ArduinoWakeLease = {
    active: true,
    source: { generation: 1 },
    startedAtMs: 0,
    hostOffsetMicroseconds: 0,
  };
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const dispatch = vi.fn();
  const scheduler = createArduinoAcknowledgedWake(
    {
      now: () => now,
      setTimeout: (callback, delay) => {
        const id = ++nextTimeoutId;
        timers.set(id, {
          callback: () => {
            timers.delete(id);
            callback();
          },
          delay,
        });
        return id;
      },
      clearTimeout: (id) => {
        timers.delete(id);
      },
    },
    () => lease,
    dispatch,
  );
  return {
    scheduler,
    dispatch,
    timers,
    setNow: (value: number) => {
      now = value;
    },
    setLease: (update: Partial<ArduinoWakeLease>) => {
      lease = { ...lease, ...update };
    },
  };
}

describe('accepted Arduino wall deadline', () => {
  it('holds the same genuine instruction through a late ACK and dispatches current demand once', () => {
    const h = harness();
    h.scheduler.schedule(30_004);
    expect(h.timers.size).toBe(1);
    const [id, pending] = [...h.timers][0]!;
    expect(pending.delay).toBe(31);
    h.setNow(28);
    h.scheduler.schedule(30_004);
    expect([...h.timers.keys()]).toEqual([id]);
    h.setNow(31);
    pending.callback();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.timers.size).toBe(0);
    // A completed timer cannot be cancelled or executed a second time.
    h.scheduler.cancel();
    expect(h.timers.size).toBe(0);
  });

  it('ignores an obsolete source lease and a cancelled Stop timer', () => {
    const h = harness();
    h.scheduler.schedule(1_000_000);
    const stale = [...h.timers.values()][0]!.callback;
    h.setLease({ source: { generation: 2 } });
    stale();
    expect(h.dispatch).not.toHaveBeenCalled();
    h.scheduler.schedule(1_000_000);
    expect(h.timers.size).toBe(1);
    h.setLease({ active: false });
    h.scheduler.schedule(null);
    expect(h.timers.size).toBe(0);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('never creates speculative busy-loop, stale-host, or out-of-range timers', () => {
    const h = harness();
    h.scheduler.schedule(3_000);
    expect(h.timers.size).toBe(0);
    h.scheduler.schedule(25_000_001);
    expect(h.timers.size).toBe(0);
    h.scheduler.schedule(Number.NaN);
    expect(h.timers.size).toBe(0);
    h.setLease({ startedAtMs: null });
    h.scheduler.schedule(30_000);
    expect(h.timers.size).toBe(0);
    h.setLease({ startedAtMs: 0 });
    h.scheduler.schedule(30_000);
    expect(h.timers.size).toBe(1);
    h.setNow(100);
    h.scheduler.schedule(40_000);
    expect(h.timers.size).toBe(0);
  });
});
