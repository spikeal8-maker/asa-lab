import { HttpException } from '@nestjs/common';

export const ANALYTICS_MODULES = ['electronics', 'three-d', 'chess', 'checkers', 'blocks'] as const;
export const QUALITY_COUNTERS = [
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
const ROUTES = [
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
];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ActorExpectation =
  | { kind: 'account'; accountId: string; workspaceId: string }
  | { kind: 'student'; seatId: string; classId: string };
export function invalid(): never {
  throw new HttpException(
    { error: { code: 'validation_error', message: 'invalid telemetry envelope' } },
    400,
  );
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
export function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid();
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid();
  return value.toLowerCase();
}
export function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    invalid();
  return new Date(value).toISOString();
}
export function expectation(value: unknown): ActorExpectation {
  const v = object(value);
  if (v['kind'] === 'account') {
    exact(v, ['kind', 'accountId', 'workspaceId']);
    return {
      kind: 'account',
      accountId: uuid(v['accountId']),
      workspaceId: uuid(v['workspaceId']),
    };
  }
  if (v['kind'] === 'student') {
    exact(v, ['kind', 'seatId', 'classId']);
    return { kind: 'student', seatId: uuid(v['seatId']), classId: uuid(v['classId']) };
  }
  return invalid();
}
export function referrerOrigin(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 512) invalid();
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) invalid();
    return url.origin;
  } catch {
    return invalid();
  }
}
export function qualitySemantic(v: Record<string, unknown>) {
  if (
    !['product-analytics', 'client-diagnostics'].includes(v['pipeline'] as string) ||
    !Number.isSafeInteger(v['sequence']) ||
    (v['sequence'] as number) < 1 ||
    v['acknowledgementStage'] !==
      (v['pipeline'] === 'product-analytics' ? 'persisted' : 'intake_acknowledged')
  )
    invalid();
  const counters = object(v['counters']);
  const gauges = object(v['gauges']);
  const coverage = object(v['coverage']);
  exact(counters, QUALITY_COUNTERS);
  exact(gauges, ['pending', 'inFlight']);
  const coverageKeys = ['persistenceUnavailable', 'uncleanEnd', 'final', 'counterSaturated'];
  exact(coverage, coverageKeys);
  if (
    QUALITY_COUNTERS.some(
      (key) => !Number.isSafeInteger(counters[key]) || (counters[key] as number) < 0,
    ) ||
    ['pending', 'inFlight'].some(
      (key) =>
        !Number.isInteger(gauges[key]) ||
        (gauges[key] as number) < 0 ||
        (gauges[key] as number) > 256,
    ) ||
    coverageKeys.some((key) => typeof coverage[key] !== 'boolean')
  )
    invalid();
  return {
    pipeline: v['pipeline'],
    streamId: uuid(v['streamId']),
    sequence: v['sequence'],
    streamStartedAt: timestamp(v['streamStartedAt']),
    clientObservedAt: timestamp(v['clientObservedAt']),
    acknowledgementStage: v['acknowledgementStage'],
    counters,
    gauges,
    coverage,
  };
}
export function parseAnalyticsEnvelope(
  raw: unknown,
  route: 'events' | 'module-session' | 'quality',
) {
  const v = object(raw);
  if (v['schemaVersion'] !== 2) invalid();
  const eventId = uuid(v['eventId']);
  const actorExpectation = expectation(v['actorExpectation']);
  const common = ['schemaVersion', 'eventId', 'actorExpectation'];
  let operation: string;
  let semantic: Record<string, unknown>;
  if (route === 'events') {
    // Canonical session start is the sole new-client module-open counter.
    exact(v, [
      ...common,
      'eventType',
      'visitId',
      'clientOccurredAt',
      'entryRoute',
      'referrerOrigin',
    ]);
    if (v['eventType'] !== 'visit.observed' || !ROUTES.includes(v['entryRoute'] as string))
      invalid();
    operation = 'visit.observed';
    semantic = {
      outcome: 'succeeded',
      visitId: uuid(v['visitId']),
      clientOccurredAt: timestamp(v['clientOccurredAt']),
      entryRoute: v['entryRoute'],
      referrerOrigin: referrerOrigin(v['referrerOrigin']),
    };
  } else if (route === 'module-session') {
    operation = String(v['operation']);
    if (!['start', 'touch', 'close'].includes(operation)) invalid();
    exact(v, [
      ...common,
      'operation',
      'sessionId',
      'visitId',
      'clientOccurredAt',
      ...(operation === 'start' ? ['projectId', 'moduleKey'] : []),
    ]);
    semantic = {
      sessionId: uuid(v['sessionId']),
      visitId: uuid(v['visitId']),
      clientOccurredAt: timestamp(v['clientOccurredAt']),
    };
    if (operation === 'start') {
      if (!(ANALYTICS_MODULES as readonly unknown[]).includes(v['moduleKey'])) invalid();
      semantic = { ...semantic, projectId: uuid(v['projectId']), moduleKey: v['moduleKey'] };
    }
  } else {
    exact(v, [
      ...common,
      'pipeline',
      'streamId',
      'sequence',
      'streamStartedAt',
      'clientObservedAt',
      'acknowledgementStage',
      'counters',
      'gauges',
      'coverage',
    ]);
    operation = 'quality';
    semantic = qualitySemantic(v);
  }
  return { eventId, actorExpectation, operation, semantic };
}
