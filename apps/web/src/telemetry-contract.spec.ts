import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  confirmedAnalytics,
  record,
  isTelemetryPath,
  safeReferrer,
  sendTelemetry,
  validEnvelope,
  type AnalyticsEnvelope,
} from './telemetry-contract';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { kind: 'account' as const, accountId: id(1), workspaceId: id(2) };
const event: AnalyticsEnvelope = {
  schemaVersion: 2,
  eventId: id(3),
  actorExpectation: actor,
  visitId: id(4),
  clientOccurredAt: '2026-10-11T12:00:00.000Z',
  eventType: 'visit.observed',
  entryRoute: 'home',
  referrerOrigin: null,
};
const receipt = {
  accepted: true,
  state: 'persisted',
  schemaVersion: 2,
  eventId: id(3),
  receiptId: id(3),
  operation: 'visit.observed',
  receivedAt: event.clientOccurredAt,
  persistedAt: event.clientOccurredAt,
  recordId: 51,
};
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe('actual v2 envelopes and persistence receipts', () => {
  it('does not start a transport after its owner was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = vi.fn<typeof fetch>();
    expect(
      await sendTelemetry(
        '/api/analytics/v2/events',
        event,
        { status: 200, confirmed: () => true },
        transport,
        controller.signal,
      ),
    ).toEqual({ kind: 'retry' });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(['fetch', 'body'] as const)(
    'cancels a pending %s even if the transport ignores AbortSignal and finishes later',
    async (phase) => {
      const controller = new AbortController();
      let release!: () => void;
      const response = new Response('{}', { status: 200 });
      if (phase === 'body')
        vi.spyOn(response, 'json').mockReturnValue(
          new Promise((resolve) => {
            release = () => resolve(receipt);
          }),
        );
      const transport = vi.fn<typeof fetch>(() =>
        phase === 'fetch'
          ? new Promise<Response>((resolve) => {
              release = () => resolve(response);
            })
          : Promise.resolve(response),
      );
      const confirmed = vi.fn(() => true);
      const delivery = sendTelemetry(
        '/api/analytics/v2/events',
        event,
        { status: 200, confirmed },
        transport,
        controller.signal,
      );
      await Promise.resolve();
      await Promise.resolve();
      controller.abort();
      expect(await delivery).toEqual({ kind: 'retry' });
      expect(transport.mock.calls[0]![1]!.signal!.aborted).toBe(true);
      release();
      await Promise.resolve();
      expect(confirmed).not.toHaveBeenCalled();
    },
  );
  for (const requiredStatus of [200, 202] as const) {
    it.each([200, 201, 202, 204, 206])(
      `requires HTTP${requiredStatus} and a valid body together (received HTTP%s)`,
      async (status) => {
        for (const validBody of [true, false]) {
          const body = requiredStatus === 200 ? receipt : { accepted: true };
          const outcome = await sendTelemetry(
            requiredStatus === 200 ? '/api/analytics/v2/events' : '/api/diagnostics/client',
            event,
            {
              status: requiredStatus,
              confirmed: (value) =>
                requiredStatus === 200
                  ? confirmedAnalytics(value, event)
                  : record(value) && value.accepted === true,
            },
            vi.fn(
              async () =>
                new Response(status === 204 ? null : JSON.stringify(validBody ? body : {}), {
                  status,
                }),
            ),
          );
          expect(outcome.kind).toBe(
            status === requiredStatus && validBody ? 'acknowledged' : 'retry',
          );
        }
      },
    );
    it.each(['', '{', 'null'])(
      `keeps HTTP${requiredStatus} with empty, malformed or null body ambiguous: %j`,
      async (body) => {
        expect(
          await sendTelemetry(
            '/api/telemetry-test',
            event,
            {
              status: requiredStatus,
              confirmed: (value) => record(value) && value.accepted === true,
            },
            vi.fn(async () => new Response(body, { status: requiredStatus })),
          ),
        ).toEqual({ kind: 'retry' });
      },
    );
  }
  it.each([400, 401, 403, 409])('preserves terminal HTTP%s even without JSON', async (status) => {
    expect(
      await sendTelemetry(
        '/api/analytics/v2/events',
        event,
        { status: 200, confirmed: () => true },
        vi.fn(async () => new Response('{', { status })),
      ),
    ).toEqual({ kind: 'rejected', context: status === 401, authentication: status === 401 });
  });
  it('accepts actual visit recordId receipt without inventing a visitId echo', () => {
    expect(validEnvelope(event)).toBe(true);
    expect(confirmedAnalytics(receipt, event)).toBe(true);
  });
  it.each([1, 51, Number.MAX_SAFE_INTEGER])(
    'acknowledges a positive safe numeric visit recordId %s',
    (recordId) => {
      expect(confirmedAnalytics({ ...receipt, recordId }, event)).toBe(true);
    },
  );
  it.each([
    undefined,
    null,
    id(5),
    '51',
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    true,
    {},
    [],
  ])('rejects a non-numeric, non-positive or unsafe visit recordId %j', (recordId) => {
    expect(confirmedAnalytics({ ...receipt, recordId }, event)).toBe(false);
  });
  it.each([
    null,
    {},
    { accepted: true },
    { ...receipt, eventId: id(9) },
    { ...receipt, receiptId: id(9) },
    { ...receipt, state: 'queued' },
    { ...receipt, operation: 'module.opened' },
    { ...receipt, recordId: null },
    { ...receipt, persistedAt: '2026-10-11T12:00:00' },
  ])('rejects a missing or unrelated persistence acknowledgement %j', (value) => {
    expect(confirmedAnalytics(value, event)).toBe(false);
  });
  it('checks session result ID, actual interval and closed state', () => {
    const envelope: AnalyticsEnvelope = {
      schemaVersion: 2,
      eventId: id(3),
      actorExpectation: actor,
      visitId: id(4),
      clientOccurredAt: event.clientOccurredAt,
      sessionId: id(6),
      operation: 'touch',
    };
    const response = {
      ...receipt,
      operation: 'touch',
      sessionId: id(6),
      result: {
        creditedSeconds: 30,
        creditedFrom: '2026-10-11T12:00:00Z',
        creditedTo: '2026-10-11T12:00:30Z',
        sessionState: 'closed',
      },
    };
    expect(confirmedAnalytics(response, envelope)).toBe(true);
    expect(
      confirmedAnalytics(
        { ...response, result: { ...response.result, creditedTo: '2026-10-11T12:00:30.750Z' } },
        envelope,
      ),
    ).toBe(true);
    expect(confirmedAnalytics({ ...response, sessionId: id(7) }, envelope)).toBe(false);
    expect(
      confirmedAnalytics(
        { ...response, result: { ...response.result, creditedSeconds: 90 } },
        envelope,
      ),
    ).toBe(false);
    expect(validEnvelope({ ...envelope, projectId: id(9) })).toBe(false);
    expect(
      validEnvelope({
        ...event,
        actorExpectation: { kind: 'student', seatId: id(1), classId: id(2), workspaceId: id(2) },
      }),
    ).toBe(false);
  });
  describe('server microsecond credit intervals', () => {
    const envelope: AnalyticsEnvelope = {
      schemaVersion: 2,
      eventId: event.eventId,
      actorExpectation: actor,
      visitId: event.visitId,
      clientOccurredAt: event.clientOccurredAt,
      sessionId: id(6),
      operation: 'touch',
    };
    function response(seconds: number, from: string | null, to: string | null) {
      return {
        ...receipt,
        operation: 'touch',
        sessionId: envelope.sessionId,
        result: {
          creditedSeconds: seconds,
          creditedFrom: from,
          creditedTo: to,
          sessionState: 'open',
        },
      };
    }
    it('floors PostgreSQL microseconds before acknowledging the interval', () => {
      expect(
        confirmedAnalytics(
          response(29, '2026-10-11T12:00:00.000001Z', '2026-10-11T12:00:30.000000Z'),
          envelope,
        ),
      ).toBe(true);
    });
    it.each([
      [5, '2026-10-11T12:00:00.999999Z', '2026-10-11T12:00:06.000000Z'],
      [90, '2026-10-11T12:00:00Z', '2026-10-11T12:01:30.999999Z'],
      [29, '2026-10-11T15:00:00.000001+03:00', '2026-10-11T12:00:30Z'],
      [5, '1969-12-31T23:59:59.999999Z', '1970-01-01T00:00:05Z'],
      [30, '2026-10-11T12:00:00.1Z', '2026-10-11T12:00:30.9Z'],
      [0, null, null],
    ] as const)('accepts server credit %s for %s through %s', (seconds, from, to) => {
      expect(confirmedAnalytics(response(seconds, from, to), envelope)).toBe(true);
    });
    it.each([
      [30, '2026-10-11T12:00:00.000001Z', '2026-10-11T12:00:30Z'],
      [90, '2026-10-11T12:00:00Z', '2026-10-11T12:01:31Z'],
      [91, '2026-10-11T12:00:00Z', '2026-10-11T12:01:31Z'],
      [4, '2026-10-11T12:00:00Z', '2026-10-11T12:00:04.999999Z'],
      [5.5, '2026-10-11T12:00:00Z', '2026-10-11T12:00:05.5Z'],
      [5, '2026-10-11T12:00:05Z', '2026-10-11T12:00:00Z'],
      [5, '2026-10-11T12:00:00Z', '2026-10-11T12:00:00Z'],
      [0, '2026-10-11T12:00:00Z', '2026-10-11T12:00:04Z'],
      [0, null, '2026-10-11T12:00:00Z'],
      [0, '2026-10-11T12:00:00Z', null],
      [5, null, null],
      [5, '2026-02-30T12:00:00Z', '2026-03-02T12:00:05Z'],
      [5, '2026-10-11T12:00:00.0000001Z', '2026-10-11T12:00:05.0000001Z'],
      [5, '2026-10-11T12:00:00+03:60', '2026-10-11T12:00:05Z'],
      [5, '2026-10-11T12:00:00Z', 'malformed'],
    ] as const)('rejects contradictory credit %s for %s through %s', (seconds, from, to) => {
      expect(confirmedAnalytics(response(seconds, from, to), envelope)).toBe(false);
    });
  });
  it.each([408, 429, 500, 503])(
    'keeps HTTP%s ambiguous rather than acknowledged',
    async (status) => {
      expect(
        await sendTelemetry(
          '/api/analytics/v2/events',
          event,
          { status: 200, confirmed: (v) => confirmedAnalytics(v, event) },
          vi.fn(async () => new Response('{}', { status })),
        ),
      ).toEqual({ kind: 'retry' });
    },
  );
  it.each([
    [400, 'validation_error', false],
    [401, 'unauthorized', true],
    [403, 'context_denied', false],
    [409, 'context_mismatch', true],
    [409, 'session_conflict', true],
    [409, 'telemetry_conflict', false],
  ] as const)(
    'classifies terminal%s/%s without refreshing or changing cookies',
    async (status, code, context) => {
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () => new Response(JSON.stringify({ error: { code } }), { status }),
      );
      expect(
        await sendTelemetry(
          '/api/analytics/v2/events',
          event,
          { status: 200, confirmed: () => false },
          fetch,
        ),
      ).toEqual({
        kind: 'rejected',
        context,
        authentication: status === 401,
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0]?.[0]).toBe('/api/analytics/v2/events');
    },
  );
  it('bounds a transport which ignores cancellation and never claims server rollback', async () => {
    vi.useFakeTimers();
    const pending = sendTelemetry(
      '/api/analytics/v2/events',
      event,
      { status: 200, confirmed: () => true },
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await pending).toEqual({ kind: 'retry' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    'https://user:secret@origin.invalid/path',
    'data:text/plain,secret',
    'javascript:alert(1)',
    'not a url',
  ])('excludes unsafe referrer %s', (raw) => expect(safeReferrer(raw)).toBeNull());
  it('keeps only an origin and excludes whole approved telemetry families with route boundaries', () => {
    expect(safeReferrer('https://origin.invalid/private?secret=1#token')).toBe(
      'https://origin.invalid',
    );
    for (const path of [
      '/api/analytics/v2/events',
      '/api/analytics?x=1',
      '/api/diagnostics/quality',
      '/api/diagnostics/client',
    ])
      expect(isTelemetryPath(path)).toBe(true);
    for (const path of ['/api/analytics-other', '/api/diagnostics-other', '/api/projects'])
      expect(isTelemetryPath(path)).toBe(false);
  });
});
