export type TelemetryActor =
  | { kind: 'account'; accountId: string; workspaceId: string }
  | { kind: 'student'; seatId: string; classId: string };
export type TelemetryModule = 'electronics' | 'three-d' | 'chess' | 'checkers' | 'blocks';
export const COUNTERS = [
  'attempted',
  'enqueued',
  'acknowledged',
  'retried',
  'expired',
  'evicted',
  'permanentRejected',
  'invalidStored',
  'invalidEnvelope',
  'deduplicated',
  'suppressed',
  'coalesced',
  'storageUnavailable',
] as const;
export type Counter = (typeof COUNTERS)[number];
export type Counters = Record<Counter, number>;
export type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ROUTES = [
  'home',
  'projects',
  'editor.electronics',
  'editor.three-d',
  'editor.chess',
  'editor.checkers',
  'editor.blocks',
  'games',
  'classes',
  'learning',
  'account',
  'admin',
  'public',
  'unknown',
] as const;
export type EntryRoute = (typeof ROUTES)[number];
export const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const keys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
export const uuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);
export const time = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 40 &&
  /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(value) &&
  Number.isFinite(Date.parse(value));
export function validActor(value: unknown): value is TelemetryActor {
  return (
    record(value) &&
    (value.kind === 'account'
      ? keys(value, ['kind', 'accountId', 'workspaceId']) &&
        uuid(value.accountId) &&
        uuid(value.workspaceId)
      : value.kind === 'student' &&
        keys(value, ['kind', 'seatId', 'classId']) &&
        uuid(value.seatId) &&
        uuid(value.classId))
  );
}
export function actorKey(actor: TelemetryActor | null): string {
  return actor
    ? (actor.kind === 'account'
        ? `account:${actor.accountId}:${actor.workspaceId}`
        : `student:${actor.seatId}:${actor.classId}`
      ).toLowerCase()
    : '';
}
export function safeReferrer(raw: string): string | null {
  try {
    const value = new URL(raw);
    return ['http:', 'https:'].includes(value.protocol) &&
      !value.username &&
      !value.password &&
      value.origin.length <= 512
      ? value.origin
      : null;
  } catch {
    return null;
  }
}
export function isTelemetryPath(path: string): boolean {
  return /^\/api\/(?:analytics|diagnostics)(?:\/|\?|$)/.test(path);
}
export interface AnalyticsEnvelope {
  schemaVersion: 2;
  eventId: string;
  actorExpectation: TelemetryActor;
  visitId: string;
  clientOccurredAt: string;
  operation?: 'start' | 'touch' | 'close';
  sessionId?: string;
  projectId?: string;
  moduleKey?: TelemetryModule;
  eventType?: 'visit.observed';
  entryRoute?: EntryRoute;
  referrerOrigin?: string | null;
}
export function validEnvelope(value: unknown): value is AnalyticsEnvelope {
  if (
    !record(value) ||
    value.schemaVersion !== 2 ||
    !uuid(value.eventId) ||
    !validActor(value.actorExpectation) ||
    !uuid(value.visitId) ||
    !time(value.clientOccurredAt)
  )
    return false;
  const common = ['schemaVersion', 'eventId', 'actorExpectation', 'visitId', 'clientOccurredAt'];
  if (value.eventType === 'visit.observed')
    return (
      keys(value, [...common, 'eventType', 'entryRoute', 'referrerOrigin']) &&
      ROUTES.includes(value.entryRoute as EntryRoute) &&
      (value.referrerOrigin === null ||
        (typeof value.referrerOrigin === 'string' &&
          safeReferrer(value.referrerOrigin) === value.referrerOrigin))
    );
  if (!uuid(value.sessionId) || !['start', 'touch', 'close'].includes(value.operation as string))
    return false;
  if (value.operation !== 'start') return keys(value, [...common, 'operation', 'sessionId']);
  return (
    keys(value, [...common, 'operation', 'sessionId', 'projectId', 'moduleKey']) &&
    uuid(value.projectId) &&
    ['electronics', 'three-d', 'chess', 'checkers', 'blocks'].includes(value.moduleKey as string)
  );
}
export function confirmedAnalytics(value: unknown, envelope: AnalyticsEnvelope): boolean {
  if (
    !record(value) ||
    value.accepted !== true ||
    value.state !== 'persisted' ||
    value.schemaVersion !== 2 ||
    value.eventId !== envelope.eventId ||
    value.receiptId !== envelope.eventId ||
    value.operation !== (envelope.operation ?? envelope.eventType) ||
    !time(value.receivedAt) ||
    !time(value.persistedAt)
  )
    return false;
  if (!envelope.operation) return uuid(value.recordId);
  if (value.sessionId !== envelope.sessionId || !record(value.result)) return false;
  const r = value.result;
  return (
    Number.isInteger(r.creditedSeconds) &&
    (r.creditedSeconds as number) >= 0 &&
    (r.creditedSeconds as number) <= 90 &&
    ['open', 'closed'].includes(r.sessionState as string) &&
    (r.creditedSeconds === 0
      ? r.creditedFrom === null && r.creditedTo === null
      : time(r.creditedFrom) &&
        time(r.creditedTo) &&
        Math.floor((Date.parse(r.creditedTo) - Date.parse(r.creditedFrom)) / 1000) ===
          r.creditedSeconds)
  );
}
export type Delivery =
  | { kind: 'acknowledged'; value: unknown }
  | { kind: 'retry' }
  | { kind: 'rejected'; context: boolean; authentication: boolean };
export interface TelemetryAcknowledgement {
  status: 200 | 202;
  confirmed: (value: unknown) => boolean;
}
/** Only the endpoint's exact HTTP status and validated body acknowledge delivery. */
export async function sendTelemetry(
  path: string,
  body: unknown,
  acknowledgement: TelemetryAcknowledgement,
  transport: typeof fetch = fetch,
): Promise<Delivery> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    // A deadline also bounds injected transports which ignore AbortSignal. Cancellation is not rollback.
    const response = await Promise.race([
      transport(path, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive: true,
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      new Promise<null>((resolve) =>
        controller.signal.addEventListener('abort', () => resolve(null), { once: true }),
      ),
    ]);
    if (!response || [408, 429].includes(response.status) || response.status >= 500)
      return { kind: 'retry' };
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      return response.ok
        ? { kind: 'retry' }
        : {
            kind: 'rejected',
            context: response.status === 401,
            authentication: response.status === 401,
          };
    }
    if (response.ok)
      return response.status === acknowledgement.status && acknowledgement.confirmed(value)
        ? { kind: 'acknowledged', value }
        : { kind: 'retry' };
    const code = record(value) && record(value.error) ? value.error.code : '';
    return {
      kind: 'rejected',
      authentication: response.status === 401,
      context:
        response.status === 401 ||
        (response.status === 409 &&
          ['context_mismatch', 'session_conflict'].includes(code as string)),
    };
  } catch {
    return { kind: 'retry' };
  } finally {
    clearTimeout(timeout);
  }
}
export function sessionStoragePort(): StoragePort | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}
