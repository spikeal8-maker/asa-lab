import type { Request } from '@playwright/test';
import { record, validActor, validEnvelope } from '../../apps/web/src/telemetry-contract';
import { validQuality } from '../../apps/web/src/telemetry-quality';

/** Synthetic API receipts, separate from the business mutations under test. */
const DIAGNOSTIC_PATH = '/api/diagnostics/client';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Only acknowledge a correctly shaped, read-only cancellation report.
 * Unexpected diagnostics remain visible as mutations to the caller's fixture. */
function expectedReadCancellation(value: unknown): boolean {
  if (!record(value)) return false;
  const allowed = new Set([
    'code',
    'module',
    'revision',
    'instanceId',
    'eventId',
    'occurredAt',
    'clientAttemptId',
    'method',
    'operation',
    'failureKind',
    'phase',
    'durationMs',
  ]);
  return (
    Object.keys(value).every((key) => allowed.has(key)) &&
    value.code === 'request_cancelled' &&
    value.module === 'portal' &&
    value.operation === 'other_api' &&
    value.method === 'GET' &&
    value.failureKind === 'cancelled' &&
    value.phase === 'request' &&
    typeof value.revision === 'string' &&
    /^(?:[a-f0-9]{7,64}|unknown|development)$/.test(value.revision) &&
    typeof value.instanceId === 'string' &&
    UUID.test(value.instanceId) &&
    typeof value.eventId === 'string' &&
    UUID.test(value.eventId) &&
    typeof value.clientAttemptId === 'string' &&
    UUID.test(value.clientAttemptId) &&
    Number.isSafeInteger(value.occurredAt) &&
    (value.occurredAt as number) >= Date.now() - 15 * 60_000 &&
    (value.occurredAt as number) <= Date.now() + 60_000 &&
    Number.isInteger(value.durationMs) &&
    (value.durationMs as number) >= 0 &&
    (value.durationMs as number) <= 600_000
  );
}

export function telemetryReceipt(request: Pick<Request, 'url' | 'method' | 'postDataJSON'>) {
  const path = new URL(request.url()).pathname;
  if (
    request.method() !== 'POST' ||
    ![
      '/api/analytics/v2/events',
      '/api/analytics/v2/quality',
      '/api/diagnostics/quality',
      DIAGNOSTIC_PATH,
    ].includes(
      path,
    )
  )
    return null;
  let body: unknown;
  try {
    body = request.postDataJSON();
  } catch {
    return null;
  }
  if (path === DIAGNOSTIC_PATH) {
    if (!expectedReadCancellation(body)) return null;
    return { status: 202, json: { accepted: true } };
  }
  const timestamp = new Date().toISOString();
  if (path === '/api/analytics/v2/events') {
    if (!validEnvelope(body) || body.eventType !== 'visit.observed') return null;
    return {
      status: 200,
      json: {
        accepted: true,
        state: 'persisted',
        schemaVersion: 2,
        eventId: body.eventId,
        receiptId: body.eventId,
        operation: body.eventType,
        recordId: 1,
        receivedAt: timestamp,
        persistedAt: timestamp,
      },
    };
  }
  const diagnostics = path === '/api/diagnostics/quality';
  const actor =
    !diagnostics && record(body) && validActor(body.actorExpectation)
      ? body.actorExpectation
      : undefined;
  if ((!diagnostics && !actor) || !validQuality(body, actor)) return null;
  return {
    status: diagnostics ? 202 : 200,
    json: {
      accepted: true,
      state: diagnostics ? 'intake_acknowledged' : 'persisted',
      schemaVersion: 2,
      eventId: body.eventId,
      streamId: body.streamId,
      sequence: body.sequence,
      pipeline: body.pipeline,
      acknowledgementStage: body.acknowledgementStage,
      ...(diagnostics
        ? {}
        : {
            receiptId: body.eventId,
            operation: 'quality',
            receivedAt: timestamp,
            persistedAt: timestamp,
          }),
    },
  };
}