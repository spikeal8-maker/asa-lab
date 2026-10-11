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
      ].includes(k),
    ) &&
    typeof v.eventId === 'string' &&
    UUID.test(v.eventId) &&
    Number.isSafeInteger(v.occurredAt) &&
    (v.occurredAt as number) > now - TTL &&
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
    (v.script === undefined || (typeof v.script === 'string' && ASSET_SCRIPT.test(v.script))) &&
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
  private retry: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;

  constructor(private readonly storage?: StoragePort) {
    try {
      const raw = storage?.getItem(KEY);
      const values: unknown = raw && raw.length <= 100_000 ? JSON.parse(raw) : [];
      if (Array.isArray(values))
        this.queue = values.filter((v) => valid(v, Date.now())).slice(-MAX);
    } catch {
      /* Private mode or damaged storage: use the bounded memory queue. */
    }
    this.persist();
  }

  enqueue(value: unknown): void {
    if (!valid(value, Date.now())) return;
    this.queue = this.queue.filter((e) => e.occurredAt > Date.now() - TTL);
    if (this.queue.length >= MAX) {
      const heartbeat = this.queue.findIndex((e) =>
        ['editor_ready', 'editor_heartbeat', 'editor_recovered'].includes(e.code),
      );
      this.queue.splice(heartbeat >= 0 ? heartbeat : 0, 1);
    }
    this.queue.push(value);
    this.persist();
    void this.flush();
  }

  retryNow(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    void this.flush();
  }

  private persist(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.queue));
    } catch {
      /* Memory fallback. */
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
          this.persist();
          continue;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        let retry = false;
        try {
          const response = await fetch('/api/diagnostics/client', {
            method: 'POST',
            credentials: 'same-origin',
            keepalive: true,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(event),
            signal: controller.signal,
          });
          retry = response.status === 408 || response.status === 429 || response.status >= 500;
        } catch {
          retry = true;
        } finally {
          clearTimeout(timeout);
        }
        if (retry) {
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
        this.failures = 0;
        // A full queue may have evicted the in-flight event. Remove by identity.
        this.queue = this.queue.filter((e) => e.eventId !== event.eventId);
        this.persist();
      }
    } finally {
      this.active = false;
    }
  }
}
