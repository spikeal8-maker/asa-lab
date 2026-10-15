import type { Request } from '@playwright/test';
import { record, validActor, validEnvelope } from '../../apps/web/src/telemetry-contract';
import { validQuality } from '../../apps/web/src/telemetry-quality';

/** Synthetic API receipts, separate from the business mutations under test. */
export function telemetryReceipt(request: Pick<Request, 'url' | 'method' | 'postDataJSON'>) {
  const path = new URL(request.url()).pathname;
  if (
    request.method() !== 'POST' ||
    !['/api/analytics/v2/events', '/api/analytics/v2/quality', '/api/diagnostics/quality'].includes(
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
        recordId: body.eventId,
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
