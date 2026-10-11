import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsDeliveryQueue } from './analytics-delivery-queue.js';

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
afterEach(() => vi.useRealTimers());

describe('bounded analytics delivery', () => {
  it('does not fail product admission or recurse when the quality sink throws', async () => {
    const emit = vi.fn(() => {
      throw new Error('sink unavailable');
    });
    const queue = new AnalyticsDeliveryQueue(true, Date.now, emit);
    expect(queue.enqueue(async () => 1)).toEqual({ state: 'queued' });
    await queue.shutdown();
    expect(queue.counters.persisted).toBe(1);
    expect(queue.counters.qualityWriteFailures).toBeGreaterThan(0);
    expect(emit.mock.calls.length).toBeLessThan(5);
  });
  it('counts the executing job against capacity and never runs two SQL operations', async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new AnalyticsDeliveryQueue(true, Date.now, () => undefined);
    const run = vi.fn(async () => {
      await first;
      return 1;
    });
    const admitted = Array.from({ length: 256 }, () => queue.submit(run));
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.inFlight).toBe(1);
    expect(queue.pending).toBe(255);
    await expect(queue.submit(run)).rejects.toMatchObject({ code: 'telemetry_capacity' });
    release();
    expect(await Promise.all(admitted)).toHaveLength(256);
    expect(queue.counters).toMatchObject({ enqueued: 256, persisted: 256, queueFull: 1 });
    expect(queue.enqueue(async () => 1)).toEqual({ state: 'queued' });
    await queue.shutdown();
    expect(queue.counters.persisted).toBe(257);
  });

  it('acknowledges only admission until the database resolves, then recovers from transient failure', async () => {
    vi.useFakeTimers();
    const snapshots: object[] = [];
    const queue = new AnalyticsDeliveryQueue(true, Date.now, (value) => snapshots.push(value));
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('secret database URL'), { code: '08006' }))
      .mockResolvedValueOnce(42);
    expect(queue.enqueue(run)).toEqual({ state: 'queued' });
    expect(queue.counters.persisted).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(queue.counters).toMatchObject({ retried: 1, persisted: 1 });
    expect(JSON.stringify(snapshots)).not.toContain('secret');
    await queue.shutdown();
  });

  it('expires queued foreground work without running it and preserves background TTL accounting', async () => {
    let time = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new AnalyticsDeliveryQueue(
      true,
      () => time,
      () => undefined,
    );
    const first = queue.submit(() => blocked);
    const expired = queue.submit(async () => {
      throw new Error('must not execute');
    });
    const rejection = expect(expired).rejects.toMatchObject({ code: 'telemetry_unavailable' });
    await tick();
    time = 5_001;
    release();
    await first;
    await rejection;
    expect(queue.counters.expired).toBe(1);
    const permanent = vi.fn(async () => {
      throw Object.assign(new Error('denied'), { code: '42501' });
    });
    queue.enqueue(permanent);
    await tick();
    expect(permanent).toHaveBeenCalledTimes(1);
    expect(queue.counters.retried).toBe(0);
    expect(queue.counters.unrecordable).toBe(1);
    await queue.shutdown();
  });

  it('bounds shutdown even if a connection never settles and reports an unknown tail', async () => {
    vi.useFakeTimers();
    const snapshots: object[] = [];
    const queue = new AnalyticsDeliveryQueue(true, Date.now, (value) => snapshots.push(value));
    queue.enqueue(() => new Promise(() => undefined));
    queue.enqueue(async () => 1);
    await tick();
    const closing = queue.shutdown();
    const rejected = expect(closing).rejects.toMatchObject({ code: 'telemetry_unavailable' });
    await vi.advanceTimersByTimeAsync(5_010);
    await rejected;
    expect(queue.counters.abandoned).toBe(1);
    expect(snapshots.at(-1)).toMatchObject({
      final: false,
      durableQueue: false,
      abruptTerminationTail: 'unknown',
    });
    expect(queue.enqueue(async () => 1)).toEqual({ state: 'unavailable' });
  });
  it('expires a repeatedly failing background job at five minutes and emits cumulative loss evidence', async () => {
    vi.useFakeTimers();
    const snapshots: object[] = [];
    const queue = new AnalyticsDeliveryQueue(true, Date.now, (value) => snapshots.push(value));
    queue.enqueue(async () => {
      throw Object.assign(new Error('temporary network failure'), { code: '08006' });
    });
    await vi.advanceTimersByTimeAsync(300_001);
    expect(queue.counters.expired).toBe(1);
    expect(queue.pending).toBe(0);
    await queue.shutdown();
    expect(snapshots.at(-1)).toMatchObject({ expired: 1, persisted: 0, final: true });
  });
  it('wakes an armed thirty-second background retry for a new foreground request', async () => {
    vi.useFakeTimers();
    const queue = new AnalyticsDeliveryQueue(true, Date.now, () => undefined);
    queue.enqueue(async () => {
      throw Object.assign(new Error('retry'), { code: '08006' });
    });
    await vi.advanceTimersByTimeAsync(31_001);
    expect(queue.counters.retried).toBe(6);
    const foreground = vi.fn(async () => 42);
    const result = queue.submit(foreground);
    await vi.advanceTimersByTimeAsync(1);
    expect(foreground).toHaveBeenCalledOnce();
    await expect(result).resolves.toBe(42);
    await queue.shutdown();
  });
  it('gives a foreground caller a bounded ambiguous response if an injected connection never settles', async () => {
    vi.useFakeTimers();
    const queue = new AnalyticsDeliveryQueue(true, Date.now, () => undefined);
    const result = expect(queue.submit(() => new Promise(() => undefined))).rejects.toMatchObject({
      code: 'telemetry_unavailable',
    });
    await vi.advanceTimersByTimeAsync(10_001);
    await result;
    expect(queue.inFlight).toBe(1);
    expect(queue.counters.persisted).toBe(0);
    expect(queue.counters.responseTimedOut).toBe(1);
    const closing = expect(queue.shutdown()).rejects.toMatchObject({
      code: 'telemetry_unavailable',
    });
    await vi.advanceTimersByTimeAsync(5_010);
    await closing;
  });
});
