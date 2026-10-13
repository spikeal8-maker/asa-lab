import { newClientId } from './client-id';
import {
  actorKey,
  COUNTERS,
  keys,
  record,
  sendTelemetry,
  sessionStoragePort,
  time,
  uuid,
  validActor,
  type Counter,
  type Counters,
  type StoragePort,
  type TelemetryActor,
} from './telemetry-contract';

export interface QualitySnapshot {
  schemaVersion: 2;
  eventId: string;
  actorExpectation?: TelemetryActor;
  pipeline: 'product-analytics' | 'client-diagnostics';
  streamId: string;
  sequence: number;
  streamStartedAt: string;
  clientObservedAt: string;
  acknowledgementStage: 'persisted' | 'intake_acknowledged';
  counters: Counters;
  gauges: { pending: number; inFlight: number };
  coverage: {
    persistenceUnavailable: boolean;
    uncleanEnd: boolean;
    final: boolean;
    counterSaturated: boolean;
  };
}
const emptyCounters = (): Counters =>
  Object.fromEntries(COUNTERS.map((key) => [key, 0])) as Counters;
export function validQuality(value: unknown, actor?: TelemetryActor): value is QualitySnapshot {
  if (
    !record(value) ||
    !keys(value, [
      'schemaVersion',
      'eventId',
      'actorExpectation',
      'pipeline',
      'streamId',
      'sequence',
      'streamStartedAt',
      'clientObservedAt',
      'acknowledgementStage',
      'counters',
      'gauges',
      'coverage',
    ]) ||
    value.schemaVersion !== 2 ||
    !uuid(value.eventId) ||
    !uuid(value.streamId) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    !time(value.streamStartedAt) ||
    !time(value.clientObservedAt) ||
    !record(value.counters) ||
    !record(value.gauges) ||
    !record(value.coverage)
  )
    return false;
  if (
    actor
      ? value.pipeline !== 'product-analytics' ||
        !validActor(value.actorExpectation) ||
        actorKey(value.actorExpectation) !== actorKey(actor)
      : value.pipeline !== 'client-diagnostics' || value.actorExpectation !== undefined
  )
    return false;
  return (
    value.acknowledgementStage === (actor ? 'persisted' : 'intake_acknowledged') &&
    keys(value.counters, COUNTERS) &&
    COUNTERS.every(
      (key) =>
        Number.isSafeInteger((value.counters as Counters)[key]) &&
        (value.counters as Counters)[key] >= 0,
    ) &&
    keys(value.gauges, ['pending', 'inFlight']) &&
    ['pending', 'inFlight'].every(
      (key) =>
        Number.isInteger((value.gauges as Record<string, unknown>)[key]) &&
        ((value.gauges as Record<string, number>)[key] ?? -1) >= 0 &&
        ((value.gauges as Record<string, number>)[key] ?? 257) <= 256,
    ) &&
    keys(value.coverage, ['persistenceUnavailable', 'uncleanEnd', 'final', 'counterSaturated']) &&
    ['persistenceUnavailable', 'uncleanEnd', 'final', 'counterSaturated'].every(
      (key) => typeof (value.coverage as Record<string, unknown>)[key] === 'boolean',
    )
  );
}
/** Cumulative delivery evidence lives separately from the evictable event queue. */
export class TelemetryQuality {
  private snapshot: QualitySnapshot;
  private pending: QualitySnapshot | null = null;
  private sequence = 0;
  private active = false;
  private stopped = false;
  private authenticationUnavailable = false;
  private retired = false;
  private paused = false;
  private dirty = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private readonly key: string;
  constructor(
    private readonly actor?: TelemetryActor,
    private readonly storage: StoragePort | undefined = sessionStoragePort(),
    private readonly transport: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
    private readonly id: () => string = newClientId,
    private readonly onAuthenticationUnavailable?: () => void,
  ) {
    this.key = `asa:quality:v2:${actor ? 'product' : 'diagnostics'}`;
    this.snapshot = {
      schemaVersion: 2,
      eventId: this.id(),
      ...(actor ? { actorExpectation: actor } : {}),
      pipeline: actor ? 'product-analytics' : 'client-diagnostics',
      streamId: this.id(),
      sequence: 1,
      streamStartedAt: new Date(this.now()).toISOString(),
      clientObservedAt: new Date(this.now()).toISOString(),
      acknowledgementStage: actor ? 'persisted' : 'intake_acknowledged',
      counters: emptyCounters(),
      gauges: { pending: 0, inFlight: 0 },
      coverage: {
        persistenceUnavailable: false,
        uncleanEnd: false,
        final: false,
        counterSaturated: false,
      },
    };
    let raw: string | null | undefined;
    try {
      raw = this.storage?.getItem(this.key);
    } catch {
      this.unavailable();
    }
    try {
      if (raw) {
        const saved: unknown = raw.length <= 30_000 ? JSON.parse(raw) : null;
        if (
          record(saved) &&
          keys(saved, ['snapshot', 'pending', 'sequence', 'inProgress', 'retired']) &&
          saved.retired !== true &&
          validQuality(saved.snapshot, actor) &&
          Number.isSafeInteger(saved.sequence) &&
          (saved.sequence as number) >= 0 &&
          typeof saved.inProgress === 'boolean' &&
          (saved.pending === null || validQuality(saved.pending, actor)) &&
          Date.parse(saved.snapshot.streamStartedAt) <= this.now() + 60_000 &&
          (saved.pending === null ||
            (saved.pending.streamId === saved.snapshot.streamId &&
              saved.pending.sequence === saved.sequence))
        ) {
          this.snapshot = saved.snapshot;
          this.pending = saved.pending;
          this.sequence = saved.sequence as number;
          this.snapshot.coverage.uncleanEnd ||= saved.inProgress;
          this.snapshot.coverage.final = false;
        } else if (!(record(saved) && saved.retired === true))
          this.snapshot.counters.invalidStored++;
      }
    } catch {
      this.snapshot.counters.invalidStored++;
      this.snapshot.coverage.uncleanEnd = true;
    }
    if (!storage) this.unavailable();
    this.persist();
  }
  increment(key: Counter, amount = 1): void {
    if (this.retired || !Number.isSafeInteger(amount) || amount < 1) return;
    const next = this.snapshot.counters[key] + amount;
    this.snapshot.counters[key] = Math.min(Number.MAX_SAFE_INTEGER, next);
    if (!Number.isSafeInteger(next)) this.snapshot.coverage.counterSaturated = true;
    this.dirty = true;
    this.persist();
  }
  gauges(pending: number, inFlight: number): void {
    if (this.retired) return;
    this.snapshot.gauges = {
      pending: Math.min(256, Math.max(0, pending)),
      inFlight: Math.min(256, Math.max(0, inFlight)),
    };
    this.dirty = true;
    this.persist();
  }
  unclean(): void {
    this.snapshot.coverage.uncleanEnd = true;
    this.dirty = true;
    this.persist();
  }
  private unavailable(): void {
    if (!this.snapshot.coverage.persistenceUnavailable) this.snapshot.counters.storageUnavailable++;
    this.snapshot.coverage.persistenceUnavailable = true;
    this.snapshot.coverage.uncleanEnd = true;
  }
  private persist(retired = false): void {
    try {
      if (!this.storage) {
        this.unavailable();
        return;
      }
      this.storage.setItem(
        this.key,
        JSON.stringify({
          snapshot: this.snapshot,
          pending: this.pending,
          sequence: this.sequence,
          inProgress: !retired,
          retired,
        }),
      );
    } catch {
      this.unavailable();
    }
  }
  read(): QualitySnapshot {
    return structuredClone(this.snapshot);
  }
  start(): void {
    this.paused = false;
    if (!this.stopped && !this.timer) this.schedule(1000);
  }
  pause(): void {
    this.paused = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private schedule(delay: number): void {
    if (this.stopped || this.paused) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delay);
  }
  async flush(final = false): Promise<void> {
    if (this.stopped || this.paused) return;
    if (final) {
      this.snapshot.coverage.final = true;
      this.dirty = true;
    }
    if (this.active) {
      this.persist();
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending && this.dirty) {
      if (this.sequence >= Number.MAX_SAFE_INTEGER) {
        this.snapshot.coverage.counterSaturated = true;
        this.persist();
        return;
      }
      this.pending = {
        ...structuredClone(this.snapshot),
        eventId: this.id(),
        sequence: ++this.sequence,
        clientObservedAt: new Date(this.now()).toISOString(),
      };
      this.dirty = false;
      this.persist();
    }
    if (!this.pending) {
      this.schedule(60_000);
      return;
    }
    const sent = this.pending;
    this.active = true;
    const outcome = await sendTelemetry(
      this.actor ? '/api/analytics/v2/quality' : '/api/diagnostics/quality',
      sent,
      {
        status: this.actor ? 200 : 202,
        confirmed: (value) =>
          record(value) &&
          value.accepted === true &&
          value.schemaVersion === 2 &&
          value.eventId === sent.eventId &&
          value.streamId === sent.streamId &&
          value.sequence === sent.sequence &&
          value.pipeline === sent.pipeline &&
          value.acknowledgementStage === sent.acknowledgementStage &&
          (this.actor
            ? value.state === 'persisted' &&
              value.receiptId === sent.eventId &&
              value.operation === 'quality' &&
              time(value.receivedAt) &&
              time(value.persistedAt)
            : value.state === 'intake_acknowledged'),
      },
      this.transport,
    );
    this.active = false;
    if (this.stopped) return;
    if (outcome.kind === 'acknowledged') {
      this.pending = null;
      this.failures = 0;
      this.persist();
      this.schedule(this.dirty ? 1000 : 60_000);
    } else if (outcome.kind === 'rejected') {
      // A rejected quality stream is a coverage failure, never an acknowledgement or recursively reported event.
      this.unclean();
      this.authenticationUnavailable = outcome.authentication;
      this.stopped = true;
      this.persist(true);
      if (this.authenticationUnavailable) this.onAuthenticationUnavailable?.();
    } else {
      this.failures++;
      this.schedule(Math.min(30_000, 1000 * 2 ** Math.min(5, this.failures - 1)));
    }
  }
  retire(): void {
    if (this.retired) return;
    this.retired = true;
    this.snapshot.coverage.final = true;
    if (this.pending || this.snapshot.gauges.pending || this.snapshot.gauges.inFlight)
      this.snapshot.coverage.uncleanEnd = true;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    // Preserve bounded original stream evidence locally, never send it under a successor cookie.
    try {
      const raw = this.storage?.getItem(`${this.key}:retired`);
      const old: unknown = raw && raw.length <= 100_000 ? JSON.parse(raw) : [];
      const retired = Array.isArray(old)
        ? old
            .filter(
              (v) =>
                record(v) &&
                validQuality(v, validActor(v.actorExpectation) ? v.actorExpectation : undefined),
            )
            .slice(-3)
        : [];
      this.storage?.setItem(`${this.key}:retired`, JSON.stringify([...retired, this.snapshot]));
    } catch {
      this.unavailable();
    }
    this.persist(true);
  }
  canRecoverAuthentication(): boolean {
    return this.authenticationUnavailable;
  }
}
let diagnostics: TelemetryQuality | undefined;
export function diagnosticQuality(): TelemetryQuality {
  return (diagnostics ??= new TelemetryQuality());
}
