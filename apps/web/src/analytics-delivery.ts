import { newClientId } from './client-id';
import {
  actorKey,
  confirmedAnalytics,
  keys,
  record,
  sendTelemetry,
  sessionStoragePort,
  uuid,
  validActor,
  validEnvelope,
  type AnalyticsEnvelope,
  type EntryRoute,
  type StoragePort,
  type TelemetryActor,
  type TelemetryModule,
} from './telemetry-contract';
import { TelemetryQuality } from './telemetry-quality';

const KEY = 'asa:analytics:v2';
const TTL = 15 * 60_000;
const MAX_SESSIONS = 32;
const MAX_VISITS = 32;
interface Session {
  id: string;
  projectId: string;
  moduleKey: TelemetryModule;
  visitId: string;
  confirmed: boolean;
  abandoned: boolean;
  start: AnalyticsEnvelope | null;
  touch: AnalyticsEnvelope | null;
  close: AnalyticsEnvelope | null;
}
interface Options {
  storage?: StoragePort | undefined;
  quality?: TelemetryQuality;
  transport?: typeof fetch;
  now?: () => number;
  id?: () => string;
  onAuthenticationUnavailable?: (() => void) | undefined;
}
/** 32 sessions × (start,touch,close) +32 visits, including the one in flight: at most128 operations. */
export class AnalyticsDelivery {
  readonly quality: TelemetryQuality;
  private sessions: Session[] = [];
  private visits: AnalyticsEnvelope[] = [];
  private inFlight: AnalyticsEnvelope | null = null;
  private stopped = false;
  private authenticationUnavailable = false;
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private waiters = new Map<string, ((accepted: boolean) => void)[]>();
  private readonly storage: StoragePort | undefined;
  private readonly transport: typeof fetch;
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly onAuthenticationUnavailable: (() => void) | undefined;
  constructor(
    readonly actor: TelemetryActor,
    options: Options = {},
  ) {
    this.storage = options.storage;
    this.transport = options.transport ?? ((...args) => fetch(...args));
    this.now = options.now ?? Date.now;
    this.id = () => (options.id ?? newClientId)().toLowerCase();
    this.onAuthenticationUnavailable = options.onAuthenticationUnavailable;
    this.quality =
      options.quality ??
      new TelemetryQuality(
        actor,
        this.storage,
        this.transport,
        this.now,
        this.id,
        this.onAuthenticationUnavailable,
      );
    this.load();
    this.persist();
  }
  private load(): void {
    try {
      const raw = this.storage?.getItem(KEY);
      if (!raw) return;
      const saved: unknown = raw.length <= 100_000 ? JSON.parse(raw) : null;
      if (
        !record(saved) ||
        !keys(saved, ['schemaVersion', 'actor', 'sessions', 'visits']) ||
        saved.schemaVersion !== 2 ||
        !validActor(saved.actor) ||
        !Array.isArray(saved.sessions) ||
        !Array.isArray(saved.visits) ||
        saved.sessions.length > MAX_SESSIONS ||
        saved.visits.length > MAX_VISITS
      ) {
        this.quality.increment('invalidStored');
        this.quality.unclean();
        return;
      }
      if (actorKey(saved.actor) !== actorKey(this.actor)) {
        this.quality.unclean();
        return;
      }
      const ids = new Set<string>();
      const sessionIds = new Set<string>();
      const valid = (value: unknown): value is AnalyticsEnvelope => {
        if (
          !validEnvelope(value) ||
          actorKey(value.actorExpectation) !== actorKey(this.actor) ||
          ids.has(value.eventId) ||
          Date.parse(value.clientOccurredAt) > this.now() + 60_000
        ) {
          this.quality.increment('invalidStored');
          return false;
        }
        ids.add(value.eventId);
        if (this.expired(value)) {
          this.quality.increment('expired');
          return false;
        }
        return true;
      };
      for (const value of saved.visits)
        if (valid(value) && value.eventType === 'visit.observed') this.visits.push(value);
      for (const value of saved.sessions) {
        if (
          !record(value) ||
          !keys(value, [
            'id',
            'projectId',
            'moduleKey',
            'visitId',
            'confirmed',
            'abandoned',
            'start',
            'touch',
            'close',
          ]) ||
          !uuid(value.id) ||
          !uuid(value.projectId) ||
          !uuid(value.visitId) ||
          sessionIds.has(value.id) ||
          !['electronics', 'three-d', 'chess', 'checkers', 'blocks'].includes(
            value.moduleKey as string,
          ) ||
          typeof value.confirmed !== 'boolean' ||
          typeof value.abandoned !== 'boolean'
        ) {
          this.quality.increment('invalidStored');
          continue;
        }
        sessionIds.add(value.id);
        let damaged = false;
        for (const operation of ['start', 'touch', 'close'] as const) {
          const envelope = value[operation];
          if (
            envelope !== null &&
            (!valid(envelope) ||
              envelope.operation !== operation ||
              envelope.sessionId !== value.id ||
              envelope.visitId !== value.visitId ||
              (operation === 'start' &&
                (envelope.projectId !== value.projectId || envelope.moduleKey !== value.moduleKey)))
          )
            damaged = true;
        }
        if (
          damaged ||
          (!value.confirmed && value.start === null) ||
          (value.confirmed && value.start !== null)
        ) {
          this.quality.unclean();
          continue;
        }
        const session = value as unknown as Session;
        // Unknown document end is not a new cleanup close. Only original recorded operations may replay.
        if (!session.close) {
          session.abandoned = true;
          this.quality.unclean();
        }
        if (session.start || session.touch || session.close) this.sessions.push(session);
      }
    } catch {
      this.quality.increment('invalidStored');
      this.quality.unclean();
    }
  }
  private operations(): AnalyticsEnvelope[] {
    return [
      ...this.visits,
      ...this.sessions.flatMap((session) =>
        [session.start, session.touch, session.close].filter(
          (v): v is AnalyticsEnvelope => v !== null,
        ),
      ),
    ];
  }
  private expired(envelope: AnalyticsEnvelope): boolean {
    return (
      this.now() - Date.parse(envelope.clientOccurredAt) >=
      (envelope.operation === 'touch' ? 90_000 : TTL)
    );
  }
  private persist(): void {
    if (this.stopped) return;
    this.quality.gauges(this.operations().length - (this.inFlight ? 1 : 0), this.inFlight ? 1 : 0);
    try {
      if (!this.storage) return;
      this.storage.setItem(
        KEY,
        JSON.stringify({
          schemaVersion: 2,
          actor: this.actor,
          sessions: this.sessions,
          visits: this.visits,
        }),
      );
    } catch {
      this.quality.increment('storageUnavailable');
      this.quality.unclean();
    }
  }
  private envelope(visitId: string, fields: Partial<AnalyticsEnvelope>): AnalyticsEnvelope {
    return {
      schemaVersion: 2,
      eventId: this.id(),
      actorExpectation: { ...this.actor },
      visitId,
      clientOccurredAt: new Date(this.now()).toISOString(),
      ...fields,
    };
  }
  private promise(eventId: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.waiters.set(eventId, [...(this.waiters.get(eventId) ?? []), resolve]);
    });
  }
  private settle(envelope: AnalyticsEnvelope, accepted: boolean): void {
    for (const resolve of this.waiters.get(envelope.eventId) ?? []) resolve(accepted);
    this.waiters.delete(envelope.eventId);
  }
  visit(visitId: string, route: EntryRoute, referrerOrigin: string | null): void {
    this.quality.increment('attempted');
    if (this.stopped || this.paused) {
      this.quality.increment('suppressed');
      return;
    }
    const envelope = this.envelope(visitId, {
      eventType: 'visit.observed',
      entryRoute: route,
      referrerOrigin,
    });
    if (!validEnvelope(envelope)) {
      this.quality.increment('invalidEnvelope');
      return;
    }
    this.prune();
    if (this.visits.length >= MAX_VISITS) {
      const index = this.visits.findIndex((event) => event !== this.inFlight);
      if (index < 0) {
        this.quality.increment('evicted');
        return;
      }
      this.visits.splice(index, 1);
      this.quality.increment('evicted');
    }
    this.visits.push(envelope);
    this.quality.increment('enqueued');
    this.persist();
    void this.flush();
  }
  open(
    sessionId: string,
    projectId: string,
    moduleKey: TelemetryModule,
    visitId: string,
  ): Promise<boolean> {
    this.quality.increment('attempted');
    if (this.stopped || this.paused) {
      this.quality.increment('suppressed');
      return Promise.resolve(false);
    }
    const existing = this.sessions.find((s) => s.id === sessionId);
    if (existing) {
      this.quality.increment('deduplicated');
      return existing.start
        ? this.promise(existing.start.eventId)
        : Promise.resolve(existing.confirmed && !existing.abandoned);
    }
    const start = this.envelope(visitId, { operation: 'start', sessionId, projectId, moduleKey });
    if (!validEnvelope(start)) {
      this.quality.increment('invalidEnvelope');
      return Promise.resolve(false);
    }
    this.prune();
    if (this.sessions.length >= MAX_SESSIONS) {
      this.quality.increment('evicted');
      return Promise.resolve(false);
    }
    this.sessions.push({
      id: sessionId,
      projectId,
      moduleKey,
      visitId,
      confirmed: false,
      abandoned: false,
      start,
      touch: null,
      close: null,
    });
    this.quality.increment('enqueued');
    const result = this.promise(start.eventId);
    this.persist();
    void this.flush();
    return result;
  }
  touch(sessionId: string, closed = false): Promise<boolean> {
    this.quality.increment('attempted');
    const session = this.sessions.find((s) => s.id === sessionId);
    if (
      this.stopped ||
      this.paused ||
      !session ||
      session.abandoned ||
      (!closed && session.close)
    ) {
      this.quality.increment('suppressed');
      return Promise.resolve(false);
    }
    const operation = closed ? 'close' : 'touch';
    const existing = session[operation];
    if (existing) {
      this.quality.increment(closed ? 'deduplicated' : 'coalesced');
      return this.promise(existing.eventId);
    }
    const envelope = this.envelope(session.visitId, { operation, sessionId });
    session[operation] = envelope;
    this.quality.increment('enqueued');
    if (closed && session.touch && session.touch !== this.inFlight) {
      this.quality.increment('coalesced');
      this.settle(session.touch, false);
      session.touch = null;
    }
    const result = this.promise(envelope.eventId);
    this.persist();
    void this.flush();
    return result;
  }
  private remove(session: Session, reason: 'expired' | 'permanentRejected'): void {
    for (const operation of [session.start, session.touch, session.close])
      if (operation) {
        this.quality.increment(reason);
        this.settle(operation, false);
      }
    this.sessions = this.sessions.filter((s) => s !== session);
  }
  private prune(): void {
    this.visits = this.visits.filter((event) => {
      if (event === this.inFlight || !this.expired(event)) return true;
      this.quality.increment('expired');
      return false;
    });
    for (const session of [...this.sessions]) {
      if (session.start && session.start !== this.inFlight && this.expired(session.start)) {
        this.remove(session, 'expired');
        continue;
      }
      for (const key of ['touch', 'close'] as const) {
        const event = session[key];
        if (event && event !== this.inFlight && this.expired(event)) {
          this.quality.increment('expired');
          this.settle(event, false);
          session[key] = null;
          if (key === 'close') {
            session.abandoned = true;
            this.quality.unclean();
          }
        }
      }
      if (session.abandoned && !session.start && !session.touch && !session.close)
        this.sessions = this.sessions.filter((s) => s !== session);
    }
  }
  pause(paused: boolean): void {
    this.paused = paused;
    if (paused) this.quality.pause();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!paused) {
      this.quality.start();
      void this.flush();
    }
  }
  retryNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    void this.flush();
  }
  private async flush(): Promise<void> {
    if (this.stopped || this.paused || this.inFlight || this.timer) return;
    this.prune();
    const envelope =
      this.visits[0] ??
      this.sessions.map((s) => s.start ?? s.touch ?? s.close).find((event) => event !== null);
    if (!envelope) {
      this.persist();
      return;
    }
    this.inFlight = envelope;
    this.persist();
    const outcome = await sendTelemetry(
      envelope.operation ? '/api/analytics/v2/module-session' : '/api/analytics/v2/events',
      envelope,
      { status: 200, confirmed: (value) => confirmedAnalytics(value, envelope) },
      this.transport,
    );
    this.inFlight = null;
    if (this.stopped) return;
    if (outcome.kind === 'retry' && !this.expired(envelope)) {
      this.quality.increment('retried');
      this.failures++;
      this.persist();
      if (!this.paused)
        this.timer = setTimeout(
          () => {
            this.timer = undefined;
            void this.flush();
          },
          Math.min(30_000, 1000 * 2 ** Math.min(5, this.failures - 1)),
        );
      return;
    }
    this.failures = 0;
    if (outcome.kind === 'rejected' && outcome.context) {
      this.authenticationUnavailable = outcome.authentication;
      this.retire();
      if (this.authenticationUnavailable) this.onAuthenticationUnavailable?.();
      return;
    }
    const accepted = outcome.kind === 'acknowledged';
    this.quality.increment(
      accepted ? 'acknowledged' : outcome.kind === 'retry' ? 'expired' : 'permanentRejected',
    );
    this.visits = this.visits.filter((event) => event !== envelope);
    const session = this.sessions.find((s) => [s.start, s.touch, s.close].includes(envelope));
    if (session) {
      const operation = envelope.operation!;
      session[operation] = null;
      if (operation === 'start') {
        const open =
          accepted &&
          record(outcome.value) &&
          record(outcome.value.result) &&
          outcome.value.result.sessionState === 'open';
        session.confirmed = !!open;
        this.settle(envelope, !!open);
        if (!open) this.remove(session, 'permanentRejected');
      } else this.settle(envelope, accepted);
      if (operation === 'close' && !accepted) this.quality.unclean();
      if (
        operation === 'close' ||
        (session.abandoned && !session.start && !session.touch && !session.close)
      )
        this.sessions = this.sessions.filter((s) => s !== session);
    }
    this.persist();
    void this.flush();
  }
  retire(): void {
    if (this.stopped) return;
    if (this.operations().length || this.sessions.length) this.quality.unclean();
    for (const event of this.operations()) {
      this.quality.increment('permanentRejected');
      this.settle(event, false);
    }
    this.sessions = [];
    this.visits = [];
    this.inFlight = null;
    this.persist();
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.quality.retire();
  }
  inspect(): { pending: number; inFlight: number; sessions: number } {
    return {
      pending: this.operations().length,
      inFlight: this.inFlight ? 1 : 0,
      sessions: this.sessions.length,
    };
  }
  canRecoverAuthentication(): boolean {
    return (
      this.authenticationUnavailable || (!this.stopped && this.quality.canRecoverAuthentication())
    );
  }
}
export const browserAnalytics = (actor: TelemetryActor, onAuthenticationUnavailable?: () => void) =>
  new AnalyticsDelivery(actor, { storage: sessionStoragePort(), onAuthenticationUnavailable });
