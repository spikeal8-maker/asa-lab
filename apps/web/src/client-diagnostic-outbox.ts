import { diagnosticQuality, type TelemetryQuality } from './telemetry-quality';
import { record, sendTelemetry, telemetryRetryDelay } from './telemetry-contract';
import { validClientException, exceptionMatchesCode } from './client-error-details';
import { validRequestDetails } from './request-diagnostic-details';
// Only this fixed vocabulary may cross the browser diagnostics boundary.
export const DIAGNOSTIC_CODES = [
  'render_failed',
  'window_error',
  'unhandled_rejection',
  'editor_start_failed',
  'editor_start_timeout',
  'editor_runtime_error',
  'simulation_failed',
  'autosave_failed',
  'session_refresh_failed',
  'request_failed',
  'request_cancelled',
  'request_slow',
  'editor_ready',
  'editor_heartbeat',
  'editor_unresponsive',
  'editor_recovered',
] as const;
export const FAILURE_CATEGORIES = [
  'unsupported',
  'nonconvergent',
  'electrical',
  'physical',
  'runtime',
  'technical',
] as const;
export const FAILURE_CODES = [
  'scratch-save-asset',
  'scratch-save-draft',
  'scratch-save-prepare',
  'worker-start',
  'worker-runtime',
  'worker-message',
  'worker-post',
  'worker-timeout',
  'invalid-response',
  'stale-response',
  'cancelled',
  'worker-failure',
  'physical_advance_failed',
  'electrical_sample_failed',
  'electrical_quality_failed',
  'clocked_profile_unsupported',
  'arduino_execution_failed',
  'timed_advance_failed',
] as const;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const ASSET_SCRIPT = /^\/assets\/[A-Za-z0-9_.-]{1,160}\.js$/;
const KEY = 'asa:diagnostics:v1';
const TTL = 15 * 60_000;
const MAX = 50;
const MAX_REPETITIONS = 1_000_000;
type Envelope = Record<string, unknown> & {
  eventId: string;
  occurredAt: number;
  code: string;
  repetitionCount?: number;
  firstOccurredAt?: number;
  lastOccurredAt?: number;
};
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
export const criticalDiagnostic = (code: string): boolean =>
  code === 'render_failed' || code === 'autosave_failed';
const healthDiagnostic = (code: string): boolean =>
  ['editor_ready', 'editor_heartbeat', 'editor_recovered', 'request_cancelled'].includes(code);
const priority = (event: Envelope): number =>
  criticalDiagnostic(event.code)
    ? 0
    : healthDiagnostic(event.code)
      ? 3
      : ['request_failed', 'request_slow'].includes(event.code)
        ? 2
        : 1;
const repetitions = (event: Envelope): number => event.repetitionCount ?? 1;
// Attempt/request IDs and durations describe the representative occurrence, not a new failure kind.
const fingerprint = (event: Envelope): string =>
  JSON.stringify([
    event.instanceId,
    event.module,
    event.revision,
    event.code,
    event.phase,
    event.operation,
    event.method,
    event.failureKind,
    event.httpStatus,
    event.category,
    event.failureCode,
    event.exception,
    event.script,
    event.line,
    event.column,
  ]);

// sessionStorage is untrusted input, including after a deployment or a reload.
function valid(value: unknown, now: number): value is Envelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).every((k) =>
      [
        'eventId',
        'occurredAt',
        'code',
        'module',
        'revision',
        'instanceId',
        'relatedRequestId',
        'httpStatus',
        'durationMs',
        'phase',
        'category',
        'failureCode',
        'script',
        'line',
        'column',
        'exception',
        'operation',
        'method',
        'failureKind',
        'clientAttemptId',
        'repetitionCount',
        'firstOccurredAt',
        'lastOccurredAt',
      ].includes(k),
    ) &&
    typeof v.eventId === 'string' &&
    UUID.test(v.eventId) &&
    Number.isSafeInteger(v.occurredAt) &&
    (v.occurredAt as number) >= 0 &&
    (v.occurredAt as number) <= now + 60_000 &&
    (['repetitionCount', 'firstOccurredAt', 'lastOccurredAt'].every(
      (key) => v[key] === undefined,
    ) ||
      (Number.isSafeInteger(v.repetitionCount) &&
        (v.repetitionCount as number) >= 1 &&
        (v.repetitionCount as number) <= MAX_REPETITIONS &&
        v.firstOccurredAt === v.occurredAt &&
        Number.isSafeInteger(v.lastOccurredAt) &&
        (v.lastOccurredAt as number) >= (v.firstOccurredAt as number) &&
        (v.lastOccurredAt as number) <= now + 60_000 &&
        (v.lastOccurredAt as number) - (v.firstOccurredAt as number) <= TTL)) &&
    DIAGNOSTIC_CODES.includes(v.code as (typeof DIAGNOSTIC_CODES)[number]) &&
    ['portal', 'scratch', 'electronics', 'auth'].includes(v.module as string) &&
    typeof v.revision === 'string' &&
    /^(?:[a-f0-9]{7,64}|unknown|development)$/.test(v.revision) &&
    validRequestDetails(v) &&
    ['instanceId', 'relatedRequestId', 'clientAttemptId'].every(
      (k) => v[k] === undefined || (typeof v[k] === 'string' && UUID.test(v[k] as string)),
    ) &&
    (v.httpStatus === undefined ||
      (Number.isInteger(v.httpStatus) &&
        (v.httpStatus as number) >= 100 &&
        (v.httpStatus as number) <= 599)) &&
    (v.durationMs === undefined ||
      (Number.isInteger(v.durationMs) &&
        (v.durationMs as number) >= 0 &&
        (v.durationMs as number) <= 600_000)) &&
    (v.phase === undefined ||
      ['startup', 'runtime', 'request', 'refresh', 'save', 'simulation'].includes(
        v.phase as string,
      )) &&
    (v.category === undefined ||
      FAILURE_CATEGORIES.includes(v.category as (typeof FAILURE_CATEGORIES)[number])) &&
    (v.failureCode === undefined ||
      FAILURE_CODES.includes(v.failureCode as (typeof FAILURE_CODES)[number])) &&
    (!['scratch-save-asset', 'scratch-save-draft', 'scratch-save-prepare'].includes(
      v.failureCode as string,
    ) ||
      (v.code === 'autosave_failed' && v.module === 'scratch' && v.phase === 'save')) &&
    (v.script === undefined || (typeof v.script === 'string' && ASSET_SCRIPT.test(v.script))) &&
    (v.exception === undefined ||
      (validClientException(v.exception) && exceptionMatchesCode(v.exception, v.code))) &&
    ['line', 'column'].every(
      (k) =>
        v[k] === undefined ||
        (Number.isInteger(v[k]) && (v[k] as number) > 0 && (v[k] as number) <= 10_000_000),
    )
  );
}

export class DiagnosticOutbox {
  private queue: Envelope[] = [];
  private active = false;
  private current: Envelope | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private scheduled: ReturnType<typeof setTimeout> | undefined;
  private wakeQueued = false;
  private readonly sealed = new WeakSet<Envelope>();
  private readonly lastSent = new Map<string, number>();
  private failures = 0;

  constructor(
    private readonly storage?: StoragePort,
    private readonly quality: TelemetryQuality = diagnosticQuality(),
  ) {
    this.load();
    this.persist();
  }

  private load(): void {
    if (!this.storage) {
      this.quality.markPersistenceUnavailable();
      return;
    }
    let raw: string | null;
    try {
      raw = this.storage.getItem(KEY);
    } catch {
      this.quality.markPersistenceUnavailable();
      return;
    }
    if (raw === null) return;
    try {
      const values: unknown = raw.length <= 100_000 ? JSON.parse(raw) : null;
      if (!Array.isArray(values)) {
        this.quality.increment('invalidStored');
        this.quality.unclean();
      } else {
        const ids = new Set<string>();
        for (const value of values) {
          if (!valid(value, Date.now()) || ids.has(value.eventId))
            this.quality.increment('invalidStored');
          else if (value.occurredAt <= Date.now() - TTL)
            this.quality.increment('expired', repetitions(value));
          else {
            ids.add(value.eventId);
            this.queue.push(value);
            // A restored event may have reached intake before the browser lost its ACK.
            this.sealed.add(value);
          }
        }
        while (this.queue.length > MAX) {
          const index = this.evictionIndex();
          this.quality.increment('evicted', repetitions(this.queue[index]!));
          this.queue.splice(index, 1);
        }
      }
    } catch {
      this.quality.increment('invalidStored');
      this.quality.unclean();
    }
  }

  /** Returns true only for a new envelope; coalesced occurrences do not spend another admission. */
  enqueue(value: unknown, countAttempt = true, admitNew = true): boolean {
    if (countAttempt) this.quality.increment('attempted');
    if (!valid(value, Date.now())) {
      this.quality.increment('invalidEnvelope');
      return false;
    }
    if (value.occurredAt <= Date.now() - TTL) {
      this.quality.increment('expired', repetitions(value));
      return false;
    }
    this.queue = this.queue.filter((e) => {
      if (e === this.current || e.occurredAt > Date.now() - TTL) return true;
      this.quality.increment('expired', repetitions(e));
      return false;
    });
    if (this.queue.some((e) => e.eventId === value.eventId)) {
      this.quality.increment('deduplicated');
      return false;
    }
    const key = fingerprint(value);
    const aggregate = this.queue.find(
      (event) =>
        !this.sealed.has(event) &&
        fingerprint(event) === key &&
        Math.max(
          event.lastOccurredAt ?? event.occurredAt,
          value.lastOccurredAt ?? value.occurredAt,
        ) -
          Math.min(event.occurredAt, value.occurredAt) <=
          TTL,
    );
    if (aggregate) {
      const added = Math.min(MAX_REPETITIONS - repetitions(aggregate), repetitions(value));
      aggregate.repetitionCount = repetitions(aggregate) + added;
      aggregate.lastOccurredAt = Math.max(
        aggregate.lastOccurredAt ?? aggregate.occurredAt,
        value.lastOccurredAt ?? value.occurredAt,
      );
      aggregate.occurredAt = Math.min(aggregate.occurredAt, value.occurredAt);
      aggregate.firstOccurredAt = aggregate.occurredAt;
      this.quality.increment('coalesced', added);
      this.quality.increment('suppressed', repetitions(value) - added);
      this.persist();
      return false;
    }
    if (!admitNew) {
      this.quality.increment('suppressed', repetitions(value));
      return false;
    }
    if (this.queue.length >= MAX) {
      const index = this.evictionIndex(priority(value));
      if (index < 0) {
        this.quality.increment('suppressed', repetitions(value));
        return false;
      }
      this.quality.increment('evicted', repetitions(this.queue[index]!));
      this.queue.splice(index, 1);
    }
    this.queue.push(structuredClone(value));
    this.quality.increment('enqueued');
    this.persist();
    // Collect synchronous duplicates before freezing the representative envelope for transport.
    if (!this.wakeQueued) {
      this.wakeQueued = true;
      queueMicrotask(() => {
        this.wakeQueued = false;
        void this.flush();
      });
    }
    return true;
  }

  private evictionIndex(minPriority = 0): number {
    let index = -1;
    for (let n = 0; n < this.queue.length; n++) {
      const event = this.queue[n]!;
      if (event === this.current || priority(event) < minPriority) continue;
      if (index < 0 || priority(event) > priority(this.queue[index]!)) index = n;
    }
    return index;
  }

  retryNow(): void {
    void this.flush();
  }

  private readyAt(event: Envelope): number {
    if (this.sealed.has(event)) return 0;
    return (
      (this.lastSent.get(fingerprint(event)) ?? -Infinity) +
      (healthDiagnostic(event.code) ? 60_000 : 10_000)
    );
  }

  private persist(): void {
    this.quality.gauges(this.queue.filter((e) => e !== this.current).length, this.current ? 1 : 0);
    try {
      if (!this.storage) {
        this.quality.markPersistenceUnavailable();
        return;
      }
      this.storage.setItem(KEY, JSON.stringify(this.queue));
    } catch {
      this.quality.markPersistenceUnavailable();
    }
  }

  private async flush(): Promise<void> {
    if (this.active || this.retry) return;
    if (this.scheduled) clearTimeout(this.scheduled);
    this.scheduled = undefined;
    this.active = true;
    try {
      while (this.queue.length) {
        const now = Date.now();
        this.queue = this.queue.filter((event) => {
          if (event.occurredAt > now - TTL) return true;
          this.quality.increment('expired', repetitions(event));
          return false;
        });
        if (!this.queue.length) break;
        const event = this.queue
          .filter((entry) => this.readyAt(entry) <= now)
          .sort((a, b) => priority(a) - priority(b))[0];
        if (!event) {
          this.scheduled = setTimeout(
            () => {
              this.scheduled = undefined;
              void this.flush();
            },
            Math.min(...this.queue.map((entry) => this.readyAt(entry))) - now,
          );
          return;
        }
        if (!this.sealed.has(event)) {
          this.sealed.add(event);
          for (const [key, at] of this.lastSent) if (now - at >= 60_000) this.lastSent.delete(key);
          // Admission is bounded by the reporter, including across editor context changes.
          if (this.lastSent.size >= 200) this.lastSent.delete(this.lastSent.keys().next().value!);
          this.lastSent.set(fingerprint(event), now);
        }
        this.current = event;
        this.persist();
        const outcome = await sendTelemetry('/api/diagnostics/client', event, {
          status: 202,
          confirmed: (value) => record(value) && value.accepted === true,
        });
        this.current = undefined;
        if (outcome.kind === 'retry') {
          this.quality.increment('retried');
          this.failures += 1;
          this.retry = setTimeout(
            () => {
              this.retry = undefined;
              void this.flush();
            },
            telemetryRetryDelay(this.failures, outcome.retryAfterMs),
          );
          return;
        }
        this.quality.increment(
          outcome.kind === 'acknowledged' ? 'acknowledged' : 'permanentRejected',
          repetitions(event),
        );
        this.failures = 0;
        // Remove the acknowledged identity, leaving its next aggregate intact.
        this.queue = this.queue.filter((e) => e.eventId !== event.eventId);
        this.persist();
      }
    } finally {
      this.active = false;
      this.current = undefined;
      this.persist();
    }
  }
}
