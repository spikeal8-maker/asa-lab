import { describe, expect, it, vi } from 'vitest';
import { telemetryReceipt } from '../../e2e/fixtures/telemetry-receipts';
import { confirmedAnalytics, COUNTERS } from '../../apps/web/src/telemetry-contract';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { kind: 'account' as const, accountId: id(1), workspaceId: id(2) };
const visit = () => ({
  schemaVersion: 2 as const,
  eventId: id(3),
  visitId: id(4),
  actorExpectation: actor,
  eventType: 'visit.observed' as const,
  clientOccurredAt: '2026-10-14T09:00:00.000Z',
  entryRoute: 'account' as const,
  referrerOrigin: null,
});
const quality = (diagnostics = false) => ({
  schemaVersion: 2,
  eventId: id(5),
  ...(diagnostics ? {} : { actorExpectation: actor }),
  streamId: id(6),
  sequence: 7,
  pipeline: diagnostics ? 'client-diagnostics' : 'product-analytics',
  acknowledgementStage: diagnostics ? 'intake_acknowledged' : 'persisted',
  streamStartedAt: '2026-10-14T09:00:00.000Z',
  clientObservedAt: '2026-10-14T09:01:00.000Z',
  counters: Object.fromEntries(COUNTERS.map((key) => [key, 0])),
  gauges: { pending: 0, inFlight: 0 },
  coverage: {
    persistenceUnavailable: false,
    uncleanEnd: false,
    final: false,
    counterSaturated: false,
  },
});
function request(path: string, body: unknown, method = 'POST') {
  return {
    url: () => `http://127.0.0.1:4612${path}`,
    method: () => method,
    postDataJSON: vi.fn(() => body),
  };
}

describe('synthetic UI telemetry receipts preserve business mutation checks', () => {
  it('confirms the exact visit with its own persisted record', () => {
    const body = visit();
    const receipt = telemetryReceipt(request('/api/analytics/v2/events', body));
    expect(receipt).toEqual({
      status: 200,
      json: {
        accepted: true,
        state: 'persisted',
        schemaVersion: 2,
        eventId: body.eventId,
        receiptId: body.eventId,
        operation: 'visit.observed',
        recordId: 1,
        receivedAt: expect.any(String),
        persistedAt: expect.any(String),
      },
    });
    expect(confirmedAnalytics(receipt?.json, body)).toBe(true);
    expect(confirmedAnalytics(receipt?.json, { ...body, eventId: id(99) })).toBe(false);
  });

  it.each([false, true])('echoes all quality identity fields (anonymous=%s)', (diagnostics) => {
    const body = quality(diagnostics);
    const path = diagnostics ? '/api/diagnostics/quality' : '/api/analytics/v2/quality';
    const receipt = telemetryReceipt(request(path, body));
    expect(receipt).toEqual({
      status: diagnostics ? 202 : 200,
      json: {
        accepted: true,
        state: diagnostics ? 'intake_acknowledged' : 'persisted',
        schemaVersion: body.schemaVersion,
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
              receivedAt: expect.any(String),
              persistedAt: expect.any(String),
            }),
      },
    });
  });

  it.each(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    'ignores %s before parsing',
    (method) => {
      for (const path of [
        '/api/analytics/v2/events',
        '/api/analytics/v2/quality',
        '/api/diagnostics/quality',
      ]) {
        const input = request(path, quality(), method);
        expect(telemetryReceipt(input)).toBeNull();
        expect(input.postDataJSON).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    '/api/account/presentation',
    '/api/classrooms/class-1/students',
    '/api/diagnostics/client',
    '/api/analytics/v2/module-session',
    '/api/analytics/v2/events/unknown',
    '/api/analytics/v2/events-extra',
    '/api/diagnostics/quality/unknown',
  ])('leaves %s in the existing handler', (path) => {
    const input = request(path, visit());
    expect(telemetryReceipt(input)).toBeNull();
    expect(input.postDataJSON).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    {},
    'invalid',
    { ...visit(), eventId: 'invalid' },
    { ...visit(), eventType: 'unknown' },
    { ...visit(), actorExpectation: null },
    { ...visit(), unexpected: true },
  ])('does not invent a receipt for malformed visits %#', (body) => {
    expect(telemetryReceipt(request('/api/analytics/v2/events', body))).toBeNull();
  });

  it.each([false, true])(
    'rejects malformed quality and wrong actor scope (anonymous=%s)',
    (diagnostics) => {
      const body = quality(diagnostics);
      const path = diagnostics ? '/api/diagnostics/quality' : '/api/analytics/v2/quality';
      for (const invalid of [
        null,
        [],
        {},
        { ...body, eventId: 'invalid' },
        { ...body, streamId: 'invalid' },
        { ...body, sequence: 0 },
        { ...body, sequence: 1.5 },
        { ...body, schemaVersion: 1 },
        { ...body, counters: {} },
        { ...body, gauges: { pending: 257, inFlight: 0 } },
        { ...body, coverage: {} },
        { ...body, acknowledgementStage: diagnostics ? 'persisted' : 'intake_acknowledged' },
        { ...body, pipeline: diagnostics ? 'product-analytics' : 'client-diagnostics' },
        { ...body, actorExpectation: diagnostics ? actor : undefined },
        { ...body, unexpected: true },
      ])
        expect(telemetryReceipt(request(path, invalid))).toBeNull();
    },
  );

  it.each(['/api/analytics/v2/events', '/api/analytics/v2/quality', '/api/diagnostics/quality'])(
    'does not acknowledge invalid JSON on %s',
    (path) => {
      const input = request(path, null);
      input.postDataJSON.mockImplementation(() => {
        throw new SyntaxError('invalid JSON');
      });
      expect(telemetryReceipt(input)).toBeNull();
    },
  );
});
