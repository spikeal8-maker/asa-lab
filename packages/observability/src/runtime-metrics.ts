import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { cpus, freemem, totalmem } from 'node:os';

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
  readonly host: {
    readonly cpuUsedByApiPercent: number;
    readonly logicalCpuCount: number;
    readonly memoryTotalMb: number;
    readonly memoryUsedPercent: number;
  };
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
  requestFinished(statusCode: number | undefined, durationMs: number): void;
  snapshot(pool: PoolStats | null): RuntimeMetricsSnapshot;
  stop(): void;
}

/** Keeps memory flat: a rolling window, not every request ever served. */
const DURATION_WINDOW = 1024;

type HttpAlertCode = 'http_request_burst' | 'http_5xx_rate' | 'http_429_rate';
type HttpCounters = {
  arrivals: number;
  responses: number;
  aborted: number;
  serverErrors: number;
  rateLimited: number;
};
interface HttpAlert {
  readonly kind: 'runtime_http_alert';
  readonly code: HttpAlertCode;
  readonly phase: 'opened' | 'reminder' | 'resolved';
  readonly level: 'warn' | 'info';
  readonly counters: Readonly<HttpCounters & { baselineArrivals: number }>;
  readonly gauges: {
    readonly requestsPerSecond: number;
    readonly baselineRequestsPerSecond?: number;
    readonly serverErrorPercent?: number;
    readonly rateLimitedPercent?: number;
  };
  readonly coverage: {
    readonly bucketSeconds: 10;
    readonly windowSeconds: 60;
    readonly baselineSeconds: 300;
    readonly windowComplete: boolean;
    readonly baselineComplete: boolean;
  };
}

const HTTP_BUCKET_MS = 10_000;
const HTTP_WINDOW_BUCKETS = 6;
const HTTP_BASELINE_BUCKETS = 30;
const HTTP_BUCKET_COUNT = HTTP_WINDOW_BUCKETS + HTTP_BASELINE_BUCKETS + 1;
const HTTP_REMINDER_MS = 300_000;
const HTTP_CODES: readonly HttpAlertCode[] = [
  'http_request_burst',
  'http_5xx_rate',
  'http_429_rate',
];

function emptyHttpCounters(): HttpCounters {
  return { arrivals: 0, responses: 0, aborted: 0, serverErrors: 0, rateLimited: 0 };
}

/** Fixed-cardinality process-local evidence; no route, actor, history or request retention. */
function createHttpAlerts(onAlert: (event: HttpAlert) => void) {
  const buckets = Array.from({ length: HTTP_BUCKET_COUNT }, () => ({
    slot: -1,
    ...emptyHttpCounters(),
  }));
  const states = Object.fromEntries(
    HTTP_CODES.map((code) => [
      code,
      { active: false, opening: 0, recovering: 0, lastEmittedAt: 0 },
    ]),
  ) as Record<
    HttpAlertCode,
    { active: boolean; opening: number; recovering: number; lastEmittedAt: number }
  >;
  let origin = performance.now();
  let observedAt = origin;
  let slot = 0;
  let lastEvaluation = -1;
  let clockInvalid = !Number.isFinite(origin);
  let stopped = false;

  function resetStreaks() {
    for (const state of Object.values(states)) {
      state.opening = 0;
      state.recovering = 0;
    }
  }

  function currentBucket() {
    if (stopped) return null;
    const now = performance.now();
    if (!Number.isFinite(now)) {
      clockInvalid = true;
      resetStreaks();
      return null;
    }
    const clockReset = clockInvalid || now < observedAt;
    if (clockReset || now - observedAt >= 2 * HTTP_BUCKET_MS) {
      // A stalled observer cannot turn missing time into clean zero buckets.
      // Keep open incidents unresolved; rebuild coverage without replaying ticks.
      for (const bucket of buckets) Object.assign(bucket, emptyHttpCounters(), { slot: -1 });
      origin = now;
      lastEvaluation = -1;
      resetStreaks();
      if (clockReset) {
        // Elapsed cooldown is unknowable in a different clock epoch.
        for (const state of Object.values(states)) state.lastEmittedAt = now;
      }
      clockInvalid = false;
    }
    observedAt = now;
    slot = Math.floor((now - origin) / HTTP_BUCKET_MS);
    const bucket = buckets[slot % HTTP_BUCKET_COUNT]!;
    if (bucket.slot !== slot) Object.assign(bucket, emptyHttpCounters(), { slot });
    return bucket;
  }

  function evaluate() {
    if (!currentBucket() || slot === lastEvaluation) return;
    if (slot !== lastEvaluation + 1) resetStreaks();
    lastEvaluation = slot;
    const current = emptyHttpCounters();
    let baselineArrivals = 0;
    // Exclude the current partial bucket and keep the two windows disjoint.
    for (let offset = 1; offset < HTTP_BUCKET_COUNT; offset++) {
      const completed = slot - offset;
      if (completed < 0) continue;
      const bucket = buckets[completed % HTTP_BUCKET_COUNT]!;
      if (bucket.slot !== completed) continue;
      if (offset <= HTTP_WINDOW_BUCKETS) {
        current.arrivals += bucket.arrivals;
        current.responses += bucket.responses;
        current.aborted += bucket.aborted;
        current.serverErrors += bucket.serverErrors;
        current.rateLimited += bucket.rateLimited;
      } else {
        baselineArrivals += bucket.arrivals;
      }
    }
    const windowComplete = slot >= HTTP_WINDOW_BUCKETS;
    const baselineComplete = slot >= HTTP_WINDOW_BUCKETS + HTTP_BASELINE_BUCKETS;
    for (const code of HTTP_CODES) {
      const burst = code === 'http_request_burst';
      const errors = code === 'http_5xx_rate' ? current.serverErrors : current.rateLimited;
      const ready =
        windowComplete &&
        (burst
          ? baselineComplete && baselineArrivals >= 100 && current.arrivals >= 20
          : current.responses >= 20);
      const opening = burst
        ? current.arrivals >= 300 && current.arrivals * 5 >= baselineArrivals * 3
        : errors >= (code === 'http_5xx_rate' ? 5 : 10) && errors * 100 >= current.responses * 5;
      const recovering = burst
        ? current.arrivals * 5 < baselineArrivals * 2 || current.arrivals < 150
        : errors < (code === 'http_5xx_rate' ? 3 : 5) && errors * 1_000 < current.responses * 25;
      const state = states[code];
      if (!ready) {
        state.opening = 0;
        state.recovering = 0;
        continue;
      }
      let phase: HttpAlert['phase'] | null = null;
      if (!state.active) {
        state.opening = opening ? state.opening + 1 : 0;
        if (state.opening === 2) {
          state.active = true;
          state.opening = 0;
          phase = 'opened';
        }
      } else {
        state.recovering = recovering ? state.recovering + 1 : 0;
        if (state.recovering === 3) {
          state.active = false;
          state.recovering = 0;
          phase = 'resolved';
        } else if (observedAt - state.lastEmittedAt >= HTTP_REMINDER_MS) {
          phase = 'reminder';
        }
      }
      if (!phase || stopped) continue;
      state.lastEmittedAt = observedAt;
      try {
        onAlert({
          kind: 'runtime_http_alert',
          code,
          phase,
          level: phase === 'resolved' ? 'info' : 'warn',
          counters: { ...current, baselineArrivals },
          gauges: {
            requestsPerSecond: round(current.arrivals / 60, 3),
            ...(baselineComplete
              ? { baselineRequestsPerSecond: round(baselineArrivals / 300, 3) }
              : {}),
            ...(current.responses > 0
              ? {
                  serverErrorPercent: round((current.serverErrors * 100) / current.responses, 3),
                  rateLimitedPercent: round((current.rateLimited * 100) / current.responses, 3),
                }
              : {}),
          },
          coverage: {
            bucketSeconds: 10,
            windowSeconds: 60,
            baselineSeconds: 300,
            windowComplete,
            baselineComplete,
          },
        });
      } catch {
        // Best-effort diagnostics never fail HTTP work or recursively log failure.
      }
    }
  }

  const timer = setInterval(evaluate, HTTP_BUCKET_MS);
  timer.unref();
  return {
    requestStarted() {
      const bucket = currentBucket();
      if (bucket) bucket.arrivals++;
    },
    requestFinished(statusCode: number | undefined) {
      const bucket = currentBucket();
      if (!bucket) return;
      if (
        statusCode === undefined ||
        !Number.isInteger(statusCode) ||
        statusCode < 100 ||
        statusCode > 599
      ) {
        bucket.aborted++;
      } else {
        bucket.responses++;
        if (statusCode >= 500) bucket.serverErrors++;
        if (statusCode === 429) bucket.rateLimited++;
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] as number;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function createRuntimeMetrics(onHttpAlert?: (event: HttpAlert) => void): RuntimeMetrics {
  const loopDelay: IntervalHistogram = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();

  const durations: number[] = [];
  const byStatusClass = new Map<string, number>();
  let total = 0;
  let inFlight = 0;
  const cpuStartedAt = process.cpuUsage();
  const wallStartedAt = process.hrtime.bigint();
  const logicalCpuCount = Math.max(1, cpus().length);
  const httpAlerts = onHttpAlert ? createHttpAlerts(onHttpAlert) : null;

  return {
    requestStarted(): void {
      inFlight += 1;
      httpAlerts?.requestStarted();
    },

    requestFinished(statusCode: number | undefined, durationMs: number): void {
      inFlight = Math.max(0, inFlight - 1);
      total += 1;
      const statusClass =
        statusCode === undefined ? 'aborted' : `${Math.floor(statusCode / 100)}xx`;
      byStatusClass.set(statusClass, (byStatusClass.get(statusClass) ?? 0) + 1);
      durations.push(durationMs);
      if (durations.length > DURATION_WINDOW) durations.shift();
      httpAlerts?.requestFinished(statusCode);
    },

    snapshot(pool: PoolStats | null): RuntimeMetricsSnapshot {
      const sorted = [...durations].sort((a, b) => a - b);
      const memory = process.memoryUsage();
      const cpu = process.cpuUsage(cpuStartedAt);
      const wallMicroseconds = Math.max(1, Number(process.hrtime.bigint() - wallStartedAt) / 1_000);
      const hostMemoryTotal = totalmem();
      const hostMemoryFree = freemem();
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
        host: {
          cpuUsedByApiPercent: round(
            ((cpu.user + cpu.system) / wallMicroseconds / logicalCpuCount) * 100,
          ),
          logicalCpuCount,
          memoryTotalMb: round(hostMemoryTotal / 1024 / 1024),
          memoryUsedPercent: round(((hostMemoryTotal - hostMemoryFree) / hostMemoryTotal) * 100),
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
      httpAlerts?.stop();
      loopDelay.disable();
    },
  };
}
