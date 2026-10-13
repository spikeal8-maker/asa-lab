import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type pg from 'pg';
import type { ActiveContext } from '@asa-lab/identity';
import type { SeatContext } from './seat-context.js';
import type { ClientNetworkKind } from './client-address.js';
import { AnalyticsDeliveryQueue, AnalyticsDeliveryError } from './analytics-delivery-queue.js';
import { clientEnvironment } from './client-environment.js';

export type AnalyticsEventType =
  | 'auth.login'
  | 'auth.register'
  | 'auth.max'
  | 'auth.class_join'
  | 'session.observed'
  | 'module.opened';
export type AnalyticsOutcome = 'succeeded' | 'failed' | 'blocked';
export type AnalyticsAuthMethod = 'password' | 'organization' | 'max' | 'class_code';
export type AnalyticsModuleKey = 'electronics' | 'three-d' | 'chess' | 'checkers' | 'blocks';
export type AnalyticsActor =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'account'; readonly context: ActiveContext }
  | { readonly kind: 'student'; readonly context: SeatContext };
export interface ConnectionObservation {
  readonly address?: string | null;
  readonly networkKind?: ClientNetworkKind | null;
  /** Normalized summary supplied by legacy API callers, never raw headers. */
  readonly userAgentSummary?: string | null;
  readonly userAgent?: string | undefined;
}
export type ProductAnalyticsEvent = ConnectionObservation & {
  readonly actor: AnalyticsActor;
  readonly eventType: AnalyticsEventType;
  readonly outcome: AnalyticsOutcome;
  readonly authMethod?: AnalyticsAuthMethod | null;
  readonly moduleKey?: AnalyticsModuleKey | null;
  readonly flowId?: string | null;
  readonly receivedAt?: string;
};
export type AnalyticsReceipt = {
  accepted: true;
  state: 'persisted';
  schemaVersion: 2;
  eventId: string;
  operation: string;
  receiptId: string;
  receivedAt: string;
  persistedAt: string;
  [key: string]: unknown;
};
function confirmedReceipt(value: unknown, eventId: string, operation: string): AnalyticsReceipt {
  const receipt = value as AnalyticsReceipt | undefined;
  if (
    receipt?.accepted !== true ||
    receipt.state !== 'persisted' ||
    receipt.schemaVersion !== 2 ||
    receipt.eventId !== eventId ||
    receipt.operation !== operation ||
    receipt.receiptId !== eventId ||
    typeof receipt.receivedAt !== 'string' ||
    !Number.isFinite(Date.parse(receipt.receivedAt)) ||
    typeof receipt.persistedAt !== 'string' ||
    !Number.isFinite(Date.parse(receipt.persistedAt))
  )
    throw new AnalyticsDeliveryError('telemetry_unavailable');
  return receipt;
}
function actorValues(actor: AnalyticsActor) {
  const account = actor.kind === 'account' ? actor.context : null;
  const student = actor.kind === 'student' ? actor.context : null;
  return [
    actor.kind,
    account?.accountId ?? null,
    account?.principalId ?? student?.principalId ?? null,
    student?.seatId ?? null,
    account?.workspaceId ?? null,
    student?.classroomId ?? null,
  ];
}
function address(value: string | null | undefined) {
  return value && isIP(value) !== 0 ? value : null;
}
export function observationMetadata(input: ConnectionObservation) {
  const environment = clientEnvironment(input.userAgent);
  return {
    address: address(input.address),
    networkKind: input.networkKind ?? 'unknown',
    browser: environment.browser,
    major: environment.major,
    os: environment.os,
    device: environment.device,
  };
}

/** Product decisions never wait for background observation writes. */
export class ProductAnalyticsService {
  readonly queue: AnalyticsDeliveryQueue;
  constructor(
    private readonly pool: pg.Pool | null,
    queue?: AnalyticsDeliveryQueue,
  ) {
    this.queue = queue ?? new AnalyticsDeliveryQueue(pool !== null);
  }
  shutdown() {
    return this.queue.shutdown();
  }
  onModuleDestroy() {
    return this.shutdown();
  }

  private async confirmedLegacy(run: () => Promise<boolean>): Promise<boolean> {
    try {
      return await this.queue.submit(run);
    } catch {
      return false;
    }
  }
  async record(event: ProductAnalyticsEvent): Promise<boolean> {
    return this.confirmedLegacy(async () => {
      const values = actorValues(event.actor).slice(0, 5);
      const result = await this.pool!.query(
        'SELECT analytics_record_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::inet,$12,$13)',
        [
          ...values,
          event.eventType,
          event.outcome,
          event.authMethod ?? null,
          event.moduleKey ?? null,
          event.flowId ?? null,
          address(event.address),
          event.userAgentSummary?.trim().slice(0, 128) || null,
          event.networkKind ?? 'unknown',
        ],
      );
      const id: unknown = result.rows[0]?.analytics_record_event;
      if (!(
        (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ||
        (typeof id === 'string' && /^[1-9][0-9]*$/.test(id))
      ))
        throw new AnalyticsDeliveryError('telemetry_unavailable');
      return true;
    });
  }
  async startModuleSession(
    input: ConnectionObservation & {
      sessionId: string;
      projectId: string;
      actor: AnalyticsActor;
      moduleKey: AnalyticsModuleKey;
    },
  ): Promise<boolean> {
    if (input.actor.kind === 'anonymous') return false;
    return this.confirmedLegacy(async () => {
      const result = await this.pool!.query(
        'SELECT analytics_start_module_session($1,$2,$3,$4,$5,$6,$7,$8,$9::inet,$10,$11)',
        [
          input.sessionId,
          ...actorValues(input.actor).slice(0, 5),
          input.moduleKey,
          input.projectId,
          address(input.address),
          input.networkKind ?? 'unknown',
          input.userAgentSummary?.trim().slice(0, 128) || null,
        ],
      );
      const persistedId: unknown = result.rows[0]?.analytics_start_module_session;
      if (
        typeof persistedId !== 'string' ||
        persistedId.toLowerCase() !== input.sessionId.toLowerCase()
      )
        throw new AnalyticsDeliveryError('telemetry_unavailable');
      return true;
    });
  }
  async touchModuleSession(input: {
    sessionId: string;
    actor: AnalyticsActor;
    closed: boolean;
  }): Promise<boolean> {
    if (input.actor.kind === 'anonymous') return false;
    return this.confirmedLegacy(async () => {
      const values = actorValues(input.actor);
      const result = await this.pool!.query(
        'SELECT analytics_touch_module_session($1,$2,$3,$4,$5)',
        [input.sessionId, values[0], values[1], values[2], input.closed],
      );
      if (!Number.isInteger(result.rows[0]?.analytics_touch_module_session))
        throw new AnalyticsDeliveryError('telemetry_unavailable');
      return true;
    });
  }

  private async writeReceipt(
    eventId: string,
    actor: readonly unknown[],
    operation: string,
    semantic: object,
    metadata: object,
    receivedAt: string,
  ): Promise<AnalyticsReceipt> {
    const result = await this.pool!.query(
      'SELECT analytics_ingest_v2($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::timestamptz) AS receipt',
      [
        eventId,
        ...actor,
        operation,
        JSON.stringify(semantic),
        JSON.stringify(metadata),
        receivedAt,
      ],
    );
    return confirmedReceipt(result.rows[0]?.receipt, eventId, operation);
  }

  persistOperation(
    eventId: string,
    actor: AnalyticsActor,
    operation: string,
    semantic: object,
    metadata: object,
    receivedAt: string,
  ): Promise<AnalyticsReceipt> {
    const frozen = structuredClone({ actor: actorValues(actor), semantic, metadata });
    return this.queue.submit(() =>
      this.writeReceipt(
        eventId,
        frozen.actor,
        operation,
        frozen.semantic,
        frozen.metadata,
        receivedAt,
      ),
    );
  }
  enqueueEvent(event: ProductAnalyticsEvent): { state: 'queued' | 'unavailable' } {
    const eventId = randomUUID();
    const receivedAt = event.receivedAt ?? new Date().toISOString();
    const actor = actorValues(event.actor);
    const operation = event.eventType;
    const semantic = {
      outcome: event.outcome,
      authMethod: event.authMethod ?? null,
      moduleKey: event.moduleKey ?? null,
      flowId: event.flowId ?? null,
    };
    const metadata = observationMetadata(event);
    return this.queue.enqueue(() =>
      this.writeReceipt(eventId, actor, operation, semantic, metadata, receivedAt),
    );
  }
  enqueueSeatActivity(
    input: ConnectionObservation & {
      seatId: string;
      classId: string;
      signedIn: boolean;
      receivedAt: string;
    },
  ): { state: 'queued' | 'unavailable' } {
    const operationId = randomUUID();
    const authEventId = randomUUID();
    const frozen = {
      seatId: input.seatId,
      classId: input.classId,
      signedIn: input.signedIn,
      receivedAt: input.receivedAt,
    };
    const metadata = observationMetadata(input);
    return this.queue.enqueue(async () => {
      const result = await this.pool!.query(
        'SELECT analytics_record_admission_v2($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz) AS receipt',
        [
          operationId,
          authEventId,
          frozen.seatId,
          frozen.classId,
          frozen.signedIn,
          JSON.stringify(metadata),
          frozen.receivedAt,
        ],
      );
      return confirmedReceipt(
        result.rows[0]?.receipt,
        operationId,
        frozen.signedIn ? 'academic.signed_in' : 'academic.signed_out',
      );
    });
  }
}
