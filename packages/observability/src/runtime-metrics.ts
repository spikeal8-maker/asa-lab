import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

/**
 * Runtime counters for the one failure mode this service actually has: work
 * that monopolises the process. Event-loop delay and pool saturation are the
 * two numbers that move first when that happens, and neither was observable —
 * the API had no metrics at all, so an overloaded instance looked identical to
 * a healthy one from outside.
 *
 * Only counters and timings live here. Project content, learner data and
 * credentials must never reach telemetry (ALLOWED_TELEMETRY_ATTRIBUTES), and a
 * metrics surface is telemetry.
 */
export interface PoolStats {
  readonly total: number;
  readonly idle: number;
  readonly waiting: number;
}

export interface RuntimeMetricsSnapshot {
  readonly uptimeSeconds: number;
  readonly eventLoopDelayMs: { p50: number; p99: number; max: number };
  readonly memory: { rssMb: number; heapUsedMb: number };
  readonly requests: {
    readonly total: number;
    readonly inFlight: number;
    readonly byStatusClass: Record<string, number>;
    readonly durationMs: { p50: number; p95: number; p99: number };
  };
  readonly database: PoolStats | null;
}

export interface RuntimeMetrics {
  requestStarted(): void;
  requestFinished(statusCode: number, durationMs: number): void;
  snapshot(pool: PoolStats | null): RuntimeMetricsSnapshot;
  stop(): void;
}

/** Keeps memory flat: a rolling window, not every request ever served. */
const DURATION_WINDOW = 1024;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] as number;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function createRuntimeMetrics(): RuntimeMetrics {
  const loopDelay: IntervalHistogram = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();

  const durations: number[] = [];
  const byStatusClass = new Map<string, number>();
  let total = 0;
  let inFlight = 0;

  return {
    requestStarted(): void {
      inFlight += 1;
    },

    requestFinished(statusCode: number, durationMs: number): void {
      inFlight = Math.max(0, inFlight - 1);
      total += 1;
      const statusClass = `${Math.floor(statusCode / 100)}xx`;
      byStatusClass.set(statusClass, (byStatusClass.get(statusClass) ?? 0) + 1);
      durations.push(durationMs);
      if (durations.length > DURATION_WINDOW) durations.shift();
    },

    snapshot(pool: PoolStats | null): RuntimeMetricsSnapshot {
      const sorted = [...durations].sort((a, b) => a - b);
      const memory = process.memoryUsage();
      return {
        uptimeSeconds: Math.round(process.uptime()),
        eventLoopDelayMs: {
          p50: round(loopDelay.percentile(50) / 1e6),
          p99: round(loopDelay.percentile(99) / 1e6),
          max: round(loopDelay.max / 1e6),
        },
        memory: {
          rssMb: round(memory.rss / 1024 / 1024),
          heapUsedMb: round(memory.heapUsed / 1024 / 1024),
        },
        requests: {
          total,
          inFlight,
          byStatusClass: Object.fromEntries(byStatusClass),
          durationMs: {
            p50: round(percentile(sorted, 50)),
            p95: round(percentile(sorted, 95)),
            p99: round(percentile(sorted, 99)),
          },
        },
        database: pool,
      };
    },

    stop(): void {
      loopDelay.disable();
    },
  };
}
