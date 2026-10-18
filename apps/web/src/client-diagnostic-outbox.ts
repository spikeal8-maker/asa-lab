import { diagnosticQuality, type TelemetryQuality } from './telemetry-quality';
import { record, sendTelemetry } from './telemetry-contract';
import { validClientException, exceptionMatchesCode } from './client-error-details';
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
export const ASSET_SCRIPT = /^\/assets\/[A-Za-z0-9_-]{1,160}\.js$/;
const KEY = 'asa:diagnostics:v1';
const TTL = 15 * 60_000;
const MAX = 50;
type Envelope = Record<string, unknown> & { eventId: string; occurredAt: number; code: string };
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;

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
      ].includes(k),
    ) &&
    typeof v.eventId === 'string' &&
    UUID.test(v.eventId) &&
    Number.isSafeInteger(v.occurredAt) &&
    (v.occurredAt as number) <= now + 60_000 &&
    DIAGNOSTIC_CODES.includes(v.code as (typeof DIAGNOSTIC_CODES)[number]) &&
    ['portal', 'scratch', 'electronics', 'auth'].includes(v.module as string) &&
    typeof v.revision === 'string' &&
    /^(?:[a-f0-9]{7,64}|unknown|development)$/.test(v.revision) &&
    ['instanceId', 'relatedRequestId'].every(
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
          else if (value.occurredAt <= Date.now() - TTL) this.quality.increment('expired');
          else {
            ids.add(value.eventId);
            this.queue.push(value);
          }
        }
        if (this.queue.length > MAX) {
          this.quality.increment('evicted', this.queue.length - MAX);
          this.queue = this.queue.slice(-MAX);
        }
      }
    } catch {
      this.quality.increment('invalidStored');
      this.quality.unclean();
    }
  }

  enqueue(value: unknown, countAttempt = true): void {
    if (countAttempt) this.quality.increment('attempted');
    if (!valid(value, Date.now())) {
      this.quality.increment('invalidEnvelope');
      return;
    }
    if (value.occurredAt <= Date.now() - TTL) {
      this.quality.increment('expired');
      return;
    }
    this.queue = this.queue.filter((e) => {
      if (e === this.current || e.occurredAt > Date.now() - TTL) return true;
      this.quality.increment('expired');
      return false;
    });
    if (this.queue.some((e) => e.eventId === value.eventId)) {
      this.quality.increment('deduplicated');
      return;
    }
    if (this.queue.length >= MAX) {
      const heartbeat = this.queue.findIndex(
        (e) =>
          e !== this.current &&
          ['editor_ready', 'editor_heartbeat', 'editor_recovered'].includes(e.code),
      );
      const index = heartbeat >= 0 ? heartbeat : this.queue.findIndex((e) => e !== this.current);
      this.queue.splice(index, 1);
      this.quality.increment('evicted');
    }
    this.queue.push(value);
    this.quality.increment('enqueued');
    this.persist();
    void this.flush();
  }

  retryNow(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    void this.flush();
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
    this.active = true;
    try {
      while (this.queue.length) {
        const event = this.queue[0]!;
        if (event.occurredAt <= Date.now() - TTL) {
          this.queue.shift();
          this.quality.increment('expired');
          this.persist();
          continue;
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
            Math.min(30_000, 1000 * 2 ** Math.min(5, this.failures - 1)),
          );
          return;
        }
        this.quality.increment(
          outcome.kind === 'acknowledged' ? 'acknowledged' : 'permanentRejected',
        );
        this.failures = 0;
        // A full queue may have evicted the in-flight event. Remove by identity.
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
