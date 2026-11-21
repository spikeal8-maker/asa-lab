import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeMetrics, type RuntimeMetrics } from './runtime-metrics.js';

type Alert = Parameters<NonNullable<Parameters<typeof createRuntimeMetrics>[0]>>[0];
const metricsToStop: RuntimeMetrics[] = [];

afterEach(() => {
  for (const metrics of metricsToStop.splice(0)) metrics.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fixture(onAlert?: (event: Alert) => void) {
  vi.useFakeTimers({
    toFake: ['setInterval', 'clearInterval', 'performance', 'Date'],
    now: new Date('2026-11-06T00:00:00.000Z'),
  });
  const events: Alert[] = [];
  const metrics = createRuntimeMetrics((event) => {
    events.push(structuredClone(event));
    onAlert?.(event);
  });
  metricsToStop.push(metrics);
  return {
    metrics,
    events,
    advance: (ms: number) => vi.advanceTimersByTime(ms),
    requests(count: number, status: number | undefined = 200, duration = 1) {
      for (let i = 0; i < count; i++) {
        metrics.requestStarted();
        metrics.requestFinished(status, duration);
      }
    },
    arrivals(count: number) {
      for (let i = 0; i < count; i++) metrics.requestStarted();
    },
  };
}

describe('bounded HTTP runtime alerts', () => {
  it('opens 5xx only after a full window and two consecutive evaluations', () => {
    const f = fixture();
    f.advance(10_000);
    f.requests(5, 503);
    f.requests(15);
    f.advance(49_999);
    expect(f.events).toEqual([]);
    f.advance(1);
    expect(f.events).toEqual([]);
    f.advance(10_000);
    expect(f.events).toEqual([
      expect.objectContaining({
        kind: 'runtime_http_alert',
        code: 'http_5xx_rate',
        phase: 'opened',
        level: 'warn',
        counters: expect.objectContaining({ arrivals: 20, responses: 20, serverErrors: 5 }),
        gauges: expect.objectContaining({ serverErrorPercent: 25 }),
        coverage: expect.objectContaining({ windowComplete: true, baselineComplete: false }),
      }),
    ]);
  });

  it('detects a burst from incoming work even while no new responses complete', () => {
    const f = fixture();
    for (let bucket = 0; bucket < 30; bucket++) {
      f.requests(10);
      f.advance(10_000);
    }
    for (let bucket = 0; bucket < 6; bucket++) {
      f.arrivals(50);
      f.advance(10_000);
    }
    expect(f.events).toEqual([]);
    f.arrivals(50);
    f.advance(10_000);
    expect(f.events).toEqual([
      expect.objectContaining({
        code: 'http_request_burst',
        phase: 'opened',
        counters: expect.objectContaining({ arrivals: 300, responses: 0, baselineArrivals: 340 }),
        gauges: expect.objectContaining({ requestsPerSecond: 5 }),
        coverage: expect.objectContaining({ windowComplete: true, baselineComplete: true }),
      }),
    ]);
    expect(f.metrics.snapshot(null).requests.inFlight).toBe(350);
  });

  it.each([
    { status: 503, code: 'http_5xx_rate', responses: 19, errors: 5, opens: false },
    { status: 503, code: 'http_5xx_rate', responses: 20, errors: 4, opens: false },
    { status: 503, code: 'http_5xx_rate', responses: 101, errors: 5, opens: false },
    { status: 599, code: 'http_5xx_rate', responses: 100, errors: 5, opens: true },
    { status: 429, code: 'http_429_rate', responses: 19, errors: 10, opens: false },
    { status: 429, code: 'http_429_rate', responses: 20, errors: 9, opens: false },
    { status: 429, code: 'http_429_rate', responses: 201, errors: 10, opens: false },
    { status: 429, code: 'http_429_rate', responses: 200, errors: 10, opens: true },
    { status: 400, code: 'http_429_rate', responses: 200, errors: 200, opens: false },
  ])('requires both sample and absolute/relative thresholds: $status/$responses/$errors', (c) => {
    const f = fixture();
    f.advance(10_000);
    f.requests(c.errors, c.status);
    f.requests(c.responses - c.errors);
    f.advance(60_000);
    expect(f.events.map((event) => [event.code, event.phase])).toEqual(
      c.opens ? [[c.code, 'opened']] : [],
    );
  });

  it.each([
    { baseline: 0, current: 300, opens: false },
    { baseline: 99, current: 300, opens: false },
    { baseline: 100, current: 299, opens: false },
    { baseline: 100, current: 300, opens: true },
    { baseline: 500, current: 300, opens: true },
    { baseline: 501, current: 300, opens: false },
  ])('requires an observed burst baseline and exact rate/count floors: $baseline/$current', (c) => {
    const f = fixture();
    const firstCurrent = c.current - 250;
    const firstBaseline = Math.min(c.baseline, firstCurrent);
    for (let bucket = 0; bucket < 30; bucket++) {
      f.arrivals(bucket === 0 ? firstBaseline : bucket === 1 ? c.baseline - firstBaseline : 0);
      f.advance(10_000);
    }
    for (let bucket = 0; bucket < 6; bucket++) {
      f.arrivals(bucket === 0 ? firstCurrent : 50);
      f.advance(10_000);
    }
    expect(f.events).toEqual([]);
    f.arrivals(firstCurrent);
    f.advance(10_000);
    expect(f.events.map((event) => [event.code, event.phase])).toEqual(
      c.opens ? [['http_request_burst', 'opened']] : [],
    );
  });

  it('does not divide errors by arrivals, pending work, cancellations, or invalid statuses', () => {
    const f = fixture();
    f.advance(10_000);
    f.requests(5, 500);
    f.requests(15);
    for (const status of [undefined, NaN, 0, 600, 200.5]) {
      for (let i = 0; i < 100; i++) {
        f.metrics.requestStarted();
        f.metrics.requestFinished(status, 1);
      }
    }
    f.arrivals(1_000);
    f.advance(60_000);
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({
      code: 'http_5xx_rate',
      counters: { arrivals: 1_520, responses: 20, aborted: 500, serverErrors: 5 },
      gauges: { serverErrorPercent: 25 },
    });
  });

  it('restarts the opening streak after an insufficient observation', () => {
    const f = fixture();
    f.requests(5, 503);
    f.requests(15);
    f.advance(60_000);
    expect(f.events).toEqual([]);
    f.advance(10_000); // The only bad bucket has left the completed minute.
    f.requests(5, 503);
    f.requests(15);
    f.advance(10_000);
    expect(f.events).toEqual([]);
    f.advance(10_000);
    expect(f.events.map((event) => event.phase)).toEqual(['opened']);
  });

  it.each([
    { status: 503, errors: 3, responses: 200, resolves: false },
    { status: 503, errors: 2, responses: 80, resolves: false },
    { status: 503, errors: 2, responses: 81, resolves: true },
    { status: 429, errors: 5, responses: 300, resolves: false },
    { status: 429, errors: 4, responses: 160, resolves: false },
    { status: 429, errors: 4, responses: 161, resolves: true },
  ])(
    'recovers only below both hysteresis thresholds for three evaluations: $status/$errors/$responses',
    (c) => {
      const f = fixture();
      f.advance(10_000);
      f.requests(10, c.status);
      f.requests(10);
      f.advance(70_000);
      expect(f.events.map((event) => event.phase)).toEqual(['opened']);
      f.requests(c.errors, c.status);
      f.requests(c.responses - c.errors);
      f.advance(20_000);
      expect(f.events).toHaveLength(1);
      f.advance(10_000);
      expect(f.events.map((event) => event.phase)).toEqual(
        c.resolves ? ['opened', 'resolved'] : ['opened'],
      );
      if (c.resolves) expect(f.events[1]?.level).toBe('info');
    },
  );

  it('keeps idle incidents unresolved and emits recovery/reopening without reminder cooldown', () => {
    const f = fixture();
    f.advance(10_000);
    f.requests(5, 503);
    f.requests(15);
    f.advance(60_000);
    f.advance(300_000);
    expect(f.events.map((event) => event.phase)).toEqual(['opened']);
    f.requests(20);
    f.advance(20_000);
    expect(f.events.map((event) => event.phase)).toEqual(['opened', 'reminder']);
    f.advance(10_000);
    expect(f.events.map((event) => event.phase)).toEqual(['opened', 'reminder', 'resolved']);
    f.requests(5, 503);
    f.advance(20_000);
    expect(f.events.map((event) => event.phase)).toEqual([
      'opened',
      'reminder',
      'resolved',
      'opened',
    ]);
  });

  it('requires at least 20 current arrivals and a valid baseline for burst recovery', () => {
    const f = fixture();
    for (let bucket = 0; bucket < 30; bucket++) {
      f.arrivals(10);
      f.advance(10_000);
    }
    f.advance(50_000);
    f.arrivals(300);
    f.advance(20_000);
    expect(f.events.map((event) => event.phase)).toEqual(['opened']);
    f.advance(60_000);
    f.arrivals(19);
    f.advance(30_000);
    expect(f.events).toHaveLength(1);
    f.arrivals(1);
    f.advance(20_000);
    expect(f.events).toHaveLength(1);
    f.advance(10_000);
    expect(f.events[1]).toMatchObject({
      code: 'http_request_burst',
      phase: 'resolved',
      counters: { arrivals: 20 },
      coverage: { baselineComplete: true },
    });
  });

  it('limits reminders per code and isolates throwing callbacks across simultaneous incidents', () => {
    const observed: Array<{ at: number; code: string; phase: string }> = [];
    const f = fixture((event) => {
      observed.push({ at: performance.now(), code: event.code, phase: event.phase });
      throw new Error('unavailable warning sink');
    });
    for (let bucket = 0; bucket < 67; bucket++) {
      f.requests(5, 503);
      f.requests(10, 429);
      f.requests(5);
      expect(() => f.advance(10_000)).not.toThrow();
    }
    for (const code of ['http_5xx_rate', 'http_429_rate']) {
      expect(observed.filter((event) => event.code === code)).toEqual([
        { at: 70_000, code, phase: 'opened' },
        { at: 370_000, code, phase: 'reminder' },
        { at: 670_000, code, phase: 'reminder' },
      ]);
    }
    expect(f.metrics.snapshot(null).requests).toMatchObject({ total: 1_340, inFlight: 0 });
  });

  it('matches a separate event-time oracle across ring wraps, with no old or partial-bucket counts', () => {
    const history: Array<{
      at: number;
      arrivals: number;
      responses: number;
      aborted: number;
      serverErrors: number;
      rateLimited: number;
    }> = [];
    const emitted: Array<{ at: number; event: Alert }> = [];
    const f = fixture((event) => emitted.push({ at: performance.now(), event }));
    for (let bucket = 0; bucket < 200; bucket++) {
      const good = 6 + (bucket % 7);
      const aborted = bucket % 3;
      const pending = bucket % 11;
      f.requests(4, 503);
      f.requests(10, 429);
      f.requests(good);
      for (let i = 0; i < aborted; i++) {
        f.metrics.requestStarted();
        f.metrics.requestFinished(undefined, 1);
      }
      f.arrivals(pending);
      history.push({
        at: performance.now(),
        arrivals: 14 + good + aborted + pending,
        responses: 14 + good,
        aborted,
        serverErrors: 4,
        rateLimited: 10,
      });
      f.advance(10_000);
    }
    expect(emitted.length).toBeGreaterThan(10);
    for (const { at, event } of emitted) {
      const completeBefore = Math.floor(at / 10_000) * 10_000;
      const current = history.filter(
        (row) => row.at >= completeBefore - 60_000 && row.at < completeBefore,
      );
      const baseline = history.filter(
        (row) => row.at >= completeBefore - 360_000 && row.at < completeBefore - 60_000,
      );
      const sum = (key: keyof Omit<(typeof history)[number], 'at'>) =>
        current.reduce((total, row) => total + row[key], 0);
      expect(event.counters).toEqual({
        arrivals: sum('arrivals'),
        responses: sum('responses'),
        aborted: sum('aborted'),
        serverErrors: sum('serverErrors'),
        rateLimited: sum('rateLimited'),
        baselineArrivals: baseline.reduce((total, row) => total + row.arrivals, 0),
      });
      expect(Object.keys(event).sort()).toEqual([
        'code',
        'counters',
        'coverage',
        'gauges',
        'kind',
        'level',
        'phase',
      ]);
      expect(
        Buffer.byteLength(
          JSON.stringify({ time: '2026-11-06T00:00:00.000Z', revision: 'a'.repeat(40), ...event }),
        ),
      ).toBeLessThan(2_048);
    }
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not resolve an open incident or replay missed evaluations after a long clock gap', () => {
    const f = fixture();
    f.advance(10_000);
    f.requests(5, 503);
    f.requests(15);
    f.advance(60_000);
    const clock = performance.now.bind(performance);
    vi.spyOn(performance, 'now').mockImplementation(() => clock() + 3_600_000);
    f.advance(10_000);
    expect(f.events.map((event) => event.phase)).toEqual(['opened']);
    f.requests(20);
    f.advance(50_000);
    expect(f.events).toHaveLength(1);
    // The post-gap sample in the first bucket expires before three valid
    // evaluations; keep fresh evidence rather than declaring idle healthy.
    f.requests(20);
    f.advance(20_000);
    expect(f.events.map((event) => event.phase)).not.toContain('resolved');
    f.advance(10_000);
    expect(f.events.at(-1)).toMatchObject({
      phase: 'resolved',
      coverage: { windowComplete: true },
    });
  });

  it('ignores wall-clock corrections and refuses non-finite monotonic samples', () => {
    const f = fixture();
    f.advance(10_000);
    f.requests(5, 503);
    f.requests(15);
    vi.setSystemTime(new Date('2040-01-01T00:00:00.000Z'));
    f.advance(60_000);
    expect(f.events.map((event) => event.phase)).toEqual(['opened']);
    const clock = vi.spyOn(performance, 'now').mockReturnValue(NaN);
    expect(() => {
      f.requests(20);
      f.advance(600_000);
    }).not.toThrow();
    expect(f.events).toHaveLength(1);
    clock.mockRestore();
    f.requests(20);
    f.advance(50_000);
    expect(f.events).toHaveLength(1);
  });

  it('starts a bounded reminder epoch after a backward monotonic correction', () => {
    const f = fixture();
    f.advance(10_000);
    f.requests(20, 503);
    f.advance(60_000);
    const clock = performance.now.bind(performance);
    vi.spyOn(performance, 'now').mockImplementation(() => clock() - 80_000);
    f.advance(10_000);
    for (let bucket = 0; bucket < 29; bucket++) {
      f.requests(20, 503);
      f.advance(10_000);
    }
    expect(f.events.map((event) => event.phase)).toEqual(['opened']);
    f.requests(20, 503);
    f.advance(10_000);
    expect(f.events.map((event) => event.phase)).toEqual(['opened', 'reminder']);
  });

  it('rebuilds the complete burst baseline after a gap before permitting recovery', () => {
    const f = fixture();
    for (let bucket = 0; bucket < 30; bucket++) {
      f.arrivals(10);
      f.advance(10_000);
    }
    for (let bucket = 0; bucket < 7; bucket++) {
      f.arrivals(50);
      f.advance(10_000);
    }
    const clock = performance.now.bind(performance);
    vi.spyOn(performance, 'now').mockImplementation(() => clock() + 3_600_000);
    f.advance(10_000);
    for (let bucket = 0; bucket < 37; bucket++) {
      f.arrivals(20);
      f.advance(10_000);
      expect(f.events.map((event) => event.phase)).not.toContain('resolved');
    }
    f.arrivals(20);
    f.advance(10_000);
    expect(f.events.at(-1)).toMatchObject({
      code: 'http_request_burst',
      phase: 'resolved',
      counters: { arrivals: 120, baselineArrivals: 600 },
      coverage: { windowComplete: true, baselineComplete: true },
    });
  });

  it('excludes requests in a nonempty partial bucket when the timer is late', () => {
    const f = fixture();
    f.advance(50_000);
    let now = 61_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    f.requests(20, 503);
    f.advance(10_000);
    expect(f.events).toEqual([]);
    now = 71_000;
    f.advance(10_000);
    expect(f.events).toEqual([]);
    now = 81_000;
    f.advance(10_000);
    expect(f.events[0]).toMatchObject({
      phase: 'opened',
      counters: { responses: 20, serverErrors: 20 },
    });
  });

  it.each([
    { current: 150, baseline: 375, resolves: false },
    { current: 150, baseline: 376, resolves: true },
    { current: 149, baseline: 300, resolves: true },
  ])('uses strict burst recovery boundaries at 2x and 150 arrivals: $current/$baseline', (c) => {
    const f = fixture();
    for (let bucket = 0; bucket < 30; bucket++) {
      f.arrivals(10);
      f.advance(10_000);
    }
    for (let bucket = 0; bucket < 7; bucket++) {
      f.arrivals(50);
      f.advance(10_000);
    }
    const clock = performance.now.bind(performance);
    vi.spyOn(performance, 'now').mockImplementation(() => clock() + 3_600_000);
    f.advance(10_000);
    const firstCurrent = c.current - 125;
    for (let bucket = 0; bucket < 30; bucket++) {
      f.arrivals(
        bucket === 0
          ? firstCurrent
          : bucket < 3
            ? 25
            : bucket === 3
              ? c.baseline - firstCurrent - 50
              : 0,
      );
      f.advance(10_000);
    }
    for (let bucket = 0; bucket < 8; bucket++) {
      f.arrivals(bucket % 6 === 0 ? firstCurrent : 25);
      f.advance(10_000);
    }
    const resolved = f.events.filter((event) => event.phase === 'resolved');
    expect(resolved).toHaveLength(c.resolves ? 1 : 0);
    if (c.resolves)
      expect(resolved[0]?.counters).toMatchObject({
        arrivals: c.current,
        baselineArrivals: c.baseline,
      });
  });

  it('stops idempotently and emits nothing after cleanup', () => {
    const f = fixture();
    f.advance(10_000);
    f.requests(20, 503);
    f.advance(50_000);
    expect(vi.getTimerCount()).toBe(1);
    f.metrics.stop();
    f.metrics.stop();
    expect(vi.getTimerCount()).toBe(0);
    f.advance(600_000);
    expect(f.events).toEqual([]);
  });

  it('unrefs its single native timer and creates no alert timer without a callback', () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    const plain = createRuntimeMetrics();
    metricsToStop.push(plain);
    expect(interval).not.toHaveBeenCalled();
    const observed = createRuntimeMetrics(() => undefined);
    metricsToStop.push(observed);
    expect(interval).toHaveBeenCalledOnce();
    expect((interval.mock.results[0]?.value as NodeJS.Timeout).hasRef()).toBe(false);
  });

  it('preserves public counters, pool projection and the last 1024 duration samples', () => {
    const f = fixture();
    const durations: number[] = [];
    for (let i = 0; i < 3_000; i++) {
      const duration = (i * 29) % 997;
      durations.push(duration);
      f.requests(1, i % 2 === 0 ? 201 : 503, duration);
    }
    f.metrics.requestStarted();
    f.metrics.requestFinished(undefined, 12);
    durations.push(12);
    f.arrivals(7);
    const sorted = durations.slice(-1_024).sort((a, b) => a - b);
    const pool = { total: 12, idle: 8, waiting: 2 };
    const snapshot = f.metrics.snapshot(pool);
    expect(snapshot.requests).toEqual({
      total: 3_001,
      inFlight: 7,
      byStatusClass: { '2xx': 1_500, '5xx': 1_500, aborted: 1 },
      durationMs: { p50: sorted[512], p95: sorted[972], p99: sorted[1_013] },
    });
    expect(snapshot.database).toBe(pool);
    expect(Object.keys(snapshot).sort()).toEqual([
      'database',
      'eventLoopDelayMs',
      'host',
      'memory',
      'requests',
      'uptimeSeconds',
    ]);
  });
});
