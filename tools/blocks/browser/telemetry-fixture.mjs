// Node browser harness cannot import shipping TypeScript validators. Keep this
// synthetic contract strict and verify its receipts through shipping consumers.
import { URL } from 'node:url';
const paths = [
  '/api/analytics/v2/events',
  '/api/analytics/v2/module-session',
  '/api/analytics/v2/quality',
  '/api/diagnostics/client',
  '/api/diagnostics/quality',
];
const record = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => Object.keys(v).every((key) => allowed.includes(key));
const uuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const time = (v) =>
  typeof v === 'string' &&
  v.length <= 40 &&
  /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(v) &&
  Number.isFinite(Date.parse(v));
const actor = (v) =>
  record(v) &&
  (v.kind === 'account'
    ? keys(v, ['kind', 'accountId', 'workspaceId']) && uuid(v.accountId) && uuid(v.workspaceId)
    : v.kind === 'student' &&
      keys(v, ['kind', 'seatId', 'classId']) &&
      uuid(v.seatId) &&
      uuid(v.classId));
const counters = [
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
];

export function isTelemetryRequest(request, origin) {
  return request.method === 'POST' && paths.some((path) => request.url === `${origin}${path}`);
}

function validAnalytics(body, visit) {
  if (
    !record(body) ||
    body.schemaVersion !== 2 ||
    !uuid(body.eventId) ||
    !uuid(body.visitId) ||
    !actor(body.actorExpectation) ||
    !time(body.clientOccurredAt)
  )
    return false;
  const common = ['schemaVersion', 'eventId', 'visitId', 'actorExpectation', 'clientOccurredAt'];
  if (visit) {
    if (
      !keys(body, [...common, 'eventType', 'entryRoute', 'referrerOrigin']) ||
      body.eventType !== 'visit.observed' ||
      ![
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
      ].includes(body.entryRoute)
    )
      return false;
    if (body.referrerOrigin === null) return true;
    try {
      const referrer = new URL(body.referrerOrigin);
      return (
        typeof body.referrerOrigin === 'string' &&
        ['http:', 'https:'].includes(referrer.protocol) &&
        !referrer.username &&
        !referrer.password &&
        referrer.origin.length <= 512 &&
        referrer.origin === body.referrerOrigin
      );
    } catch {
      return false;
    }
  }
  if (!uuid(body.sessionId) || !['start', 'touch', 'close'].includes(body.operation)) return false;
  return body.operation === 'start'
    ? keys(body, [...common, 'operation', 'sessionId', 'projectId', 'moduleKey']) &&
        uuid(body.projectId) &&
        ['electronics', 'three-d', 'chess', 'checkers', 'blocks'].includes(body.moduleKey)
    : keys(body, [...common, 'operation', 'sessionId']);
}

function validQuality(body, diagnostics) {
  return (
    record(body) &&
    keys(body, [
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
    ]) &&
    body.schemaVersion === 2 &&
    uuid(body.eventId) &&
    uuid(body.streamId) &&
    Number.isSafeInteger(body.sequence) &&
    body.sequence >= 1 &&
    time(body.streamStartedAt) &&
    time(body.clientObservedAt) &&
    (diagnostics ? body.actorExpectation === undefined : actor(body.actorExpectation)) &&
    body.pipeline === (diagnostics ? 'client-diagnostics' : 'product-analytics') &&
    body.acknowledgementStage === (diagnostics ? 'intake_acknowledged' : 'persisted') &&
    record(body.counters) &&
    keys(body.counters, counters) &&
    counters.every((key) => Number.isSafeInteger(body.counters[key]) && body.counters[key] >= 0) &&
    record(body.gauges) &&
    keys(body.gauges, ['pending', 'inFlight']) &&
    ['pending', 'inFlight'].every(
      (key) =>
        Number.isInteger(body.gauges[key]) && body.gauges[key] >= 0 && body.gauges[key] <= 256,
    ) &&
    record(body.coverage) &&
    keys(body.coverage, ['persistenceUnavailable', 'uncleanEnd', 'final', 'counterSaturated']) &&
    ['persistenceUnavailable', 'uncleanEnd', 'final', 'counterSaturated'].every(
      (key) => typeof body.coverage[key] === 'boolean',
    )
  );
}

function validDiagnostic(body) {
  return (
    record(body) &&
    keys(body, [
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
    ]) &&
    uuid(body.eventId) &&
    Number.isSafeInteger(body.occurredAt) &&
    // HTTP intake uses absolute timestamp bounds. Browser clock is virtual in
    // minute-save cases and must not be compared with this Node server clock.
    body.occurredAt >= 0 &&
    body.occurredAt <= 8_640_000_000_000_000 &&
    [
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
    ].includes(body.code) &&
    ['portal', 'scratch', 'electronics', 'auth'].includes(body.module) &&
    typeof body.revision === 'string' &&
    /^(?:[a-f0-9]{7,64}|unknown|development)$/.test(body.revision) &&
    ['instanceId', 'relatedRequestId'].every((key) => body[key] === undefined || uuid(body[key])) &&
    (body.httpStatus === undefined ||
      (Number.isInteger(body.httpStatus) && body.httpStatus >= 100 && body.httpStatus <= 599)) &&
    (body.durationMs === undefined ||
      (Number.isInteger(body.durationMs) && body.durationMs >= 0 && body.durationMs <= 600_000)) &&
    (body.phase === undefined ||
      ['startup', 'runtime', 'request', 'refresh', 'save', 'simulation'].includes(body.phase)) &&
    (body.category === undefined ||
      ['unsupported', 'nonconvergent', 'electrical', 'physical', 'runtime', 'technical'].includes(
        body.category,
      )) &&
    (body.failureCode === undefined ||
      [
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
      ].includes(body.failureCode)) &&
    (body.script === undefined ||
      (typeof body.script === 'string' &&
        /^\/assets\/[A-Za-z0-9_-]{1,160}\.js$/.test(body.script))) &&
    ['line', 'column'].every(
      (key) =>
        body[key] === undefined ||
        (Number.isInteger(body[key]) && body[key] > 0 && body[key] <= 10_000_000),
    )
  );
}

export function telemetryReceipt(request, body, origin) {
  if (!isTelemetryRequest(request, origin)) return null;
  const path = request.url.slice(origin.length);
  const quality = path.endsWith('/quality');
  const diagnostics = path.startsWith('/api/diagnostics/');
  if (
    !(quality
      ? validQuality(body, diagnostics)
      : diagnostics
        ? validDiagnostic(body)
        : validAnalytics(body, path.endsWith('/events')))
  )
    return null;
  if (path === '/api/diagnostics/client') return { status: 202, json: { accepted: true } };
  const timestamp = new Date().toISOString();
  return {
    status: diagnostics ? 202 : 200,
    json: {
      accepted: true,
      state: diagnostics ? 'intake_acknowledged' : 'persisted',
      schemaVersion: 2,
      eventId: body.eventId,
      ...(diagnostics
        ? {}
        : {
            receiptId: body.eventId,
            operation: quality ? 'quality' : (body.operation ?? body.eventType),
            receivedAt: timestamp,
            persistedAt: timestamp,
          }),
      ...(quality
        ? {
            streamId: body.streamId,
            sequence: body.sequence,
            pipeline: body.pipeline,
            acknowledgementStage: body.acknowledgementStage,
          }
        : body.operation
          ? {
              sessionId: body.sessionId,
              result: {
                creditedSeconds: 0,
                creditedFrom: null,
                creditedTo: null,
                sessionState: body.operation === 'close' ? 'closed' : 'open',
              },
            }
          : { recordId: body.eventId }),
    },
  };
}

export function isExpectedTelemetryRejection(detail, rejectedResponses, origin) {
  const url = `${origin}/api/analytics/v2/module-session`;
  return (
    detail?.kind === 'console' &&
    detail.type === 'error' &&
    detail.url === url &&
    detail.text ===
      'Failed to load resource: the server responded with a status of 401 (Unauthorized)' &&
    rejectedResponses.some(
      (response) => response.url === url && response.method === 'POST' && response.status === 401,
    )
  );
}
