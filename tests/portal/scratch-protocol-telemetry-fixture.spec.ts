import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  isExpectedTelemetryRejection,
  isTelemetryRequest,
  telemetryReceipt,
} from '../../tools/blocks/browser/telemetry-fixture.mjs';
import { confirmedAnalytics, COUNTERS, validEnvelope } from '../../apps/web/src/telemetry-contract';
import { TelemetryQuality, validQuality } from '../../apps/web/src/telemetry-quality';
import { DiagnosticOutbox } from '../../apps/web/src/client-diagnostic-outbox';
import { clientException } from '../../apps/web/src/client-error-details';
import { ClientDiagnosticsController } from '../../apps/api/src/client-diagnostics.controller';

const origin = 'http://127.0.0.1:4612';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { kind: 'account' as const, accountId: id(1), workspaceId: id(2) };
const request = (path: string, method = 'POST') => ({ method, url: `${origin}${path}` });
const visit = () => ({
  schemaVersion: 2 as const,
  eventId: id(3),
  visitId: id(4),
  actorExpectation: actor,
  eventType: 'visit.observed' as const,
  clientOccurredAt: new Date().toISOString(),
  entryRoute: 'editor.blocks' as const,
  referrerOrigin: null,
});
const session = (operation: 'start' | 'touch' | 'close') => ({
  schemaVersion: 2 as const,
  eventId: id(5),
  visitId: id(4),
  actorExpectation: actor,
  clientOccurredAt: new Date().toISOString(),
  operation,
  sessionId: id(6),
  ...(operation === 'start' ? { projectId: id(7), moduleKey: 'blocks' as const } : {}),
});
const quality = (diagnostics: boolean) => ({
  schemaVersion: 2,
  eventId: id(8),
  ...(diagnostics ? {} : { actorExpectation: actor }),
  streamId: id(9),
  sequence: 1,
  pipeline: diagnostics ? 'client-diagnostics' : 'product-analytics',
  acknowledgementStage: diagnostics ? 'intake_acknowledged' : 'persisted',
  streamStartedAt: new Date().toISOString(),
  clientObservedAt: new Date().toISOString(),
  counters: Object.fromEntries(COUNTERS.map((key) => [key, 0])),
  gauges: { pending: 0, inFlight: 0 },
  coverage: {
    persistenceUnavailable: false,
    uncleanEnd: false,
    final: false,
    counterSaturated: false,
  },
});
const diagnostic = () => ({
  eventId: id(10),
  occurredAt: Date.now(),
  code: 'editor_ready',
  module: 'scratch',
  revision: 'development',
});
// Exercise the real HTTP intake validator without opening a server or emitting logs.
function diagnosticIntakeStatus(body: unknown): number {
  const controller = new ClientDiagnosticsController();
  const input = {
    id: id(990),
    ip: '127.0.0.1',
    headers: {},
    raw: { socket: { remoteAddress: '127.0.0.1' } },
  } as unknown as FastifyRequest;
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  try {
    expect(controller.report(input, body)).toEqual({ accepted: true });
    return 202;
  } catch (error) {
    if (error instanceof HttpException) return error.getStatus();
    throw error;
  } finally {
    output.mockRestore();
  }
}
function capturedException(capture: 'window' | 'rejection' | 'app_boundary' | 'editor_boundary') {
  const error = new TypeError('PRIVATE exception message');
  error.stack =
    'TypeError: PRIVATE exception message\n    at render (https://fixture.test/assets/product-main-1234abcd.js:12:34)';
  return clientException(error, capture, 'https://fixture.test');
}
function disk() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
const ledgers: TelemetryQuality[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
});
afterEach(() => {
  ledgers.splice(0).forEach((ledger) => ledger.retire());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Scratch protocol fixture receipts are consumed by shipping CLIENT', () => {
  it('confirms visit identity without crediting module time', () => {
    const body = visit();
    const receipt = telemetryReceipt(request('/api/analytics/v2/events'), body, origin);
    expect(validEnvelope(body)).toBe(true);
    expect(receipt.status).toBe(200);
    expect(confirmedAnalytics(receipt.json, body)).toBe(true);
    expect(confirmedAnalytics(receipt.json, { ...body, eventId: id(99) })).toBe(false);
    expect(receipt.json.result).toBeUndefined();
  });
  it.each(['start', 'touch', 'close'] as const)(
    'confirms %s with zero synthetic credit and correct state',
    (operation) => {
      const body = session(operation);
      const receipt = telemetryReceipt(request('/api/analytics/v2/module-session'), body, origin);
      expect(validEnvelope(body)).toBe(true);
      expect(receipt.status).toBe(200);
      expect(confirmedAnalytics(receipt.json, body)).toBe(true);
      expect(confirmedAnalytics(receipt.json, { ...body, sessionId: id(99) })).toBe(false);
      expect(receipt.json.result).toEqual({
        creditedSeconds: 0,
        creditedFrom: null,
        creditedTo: null,
        sessionState: operation === 'close' ? 'closed' : 'open',
      });
    },
  );
  it.each([false, true])(
    'actual quality consumer confirms its complete receipt (diagnostics=%s)',
    async (diagnostics) => {
      const storage = disk();
      let sequence = 20;
      const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(validQuality(body, diagnostics ? undefined : actor)).toBe(true);
        const receipt = telemetryReceipt(request(String(url)), body, origin);
        expect(receipt.status).toBe(diagnostics ? 202 : 200);
        return new Response(JSON.stringify(receipt.json), { status: receipt.status });
      });
      const ledger = new TelemetryQuality(
        diagnostics ? undefined : actor,
        storage,
        transport as typeof fetch,
        Date.now,
        () => id(sequence++),
      );
      ledgers.push(ledger);
      await ledger.flush();
      const saved = JSON.parse(
        storage.getItem(`asa:quality:v2:${diagnostics ? 'diagnostics' : 'product'}`)!,
      );
      expect(saved.pending).toBeNull();
      expect(saved.retired).toBe(false);
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('actual diagnostics outbox counts intake ACK without claiming persistence', async () => {
    const ledger = new TelemetryQuality(undefined, disk());
    ledgers.push(ledger);
    const transport = vi.fn(async (url: string, init: RequestInit) => {
      const receipt = telemetryReceipt(request(url), JSON.parse(String(init.body)), origin);
      expect(receipt).toEqual({ status: 202, json: { accepted: true } });
      return new Response(JSON.stringify(receipt.json), { status: receipt.status });
    });
    vi.stubGlobal('fetch', transport);
    new DiagnosticOutbox(disk(), ledger).enqueue(diagnostic());
    await vi.advanceTimersByTimeAsync(0);
    expect(ledger.read().counters).toMatchObject({
      acknowledged: 1,
      retried: 0,
      permanentRejected: 0,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['/api/analytics/v2/events', visit],
    ['/api/analytics/v2/module-session', () => session('start')],
    ['/api/analytics/v2/quality', () => quality(false)],
    ['/api/diagnostics/quality', () => quality(true)],
    ['/api/diagnostics/client', diagnostic],
  ] as const)('does not manufacture success for malformed %s envelopes', (path, makeBody) => {
    for (const body of [
      null,
      [],
      {},
      'invalid',
      { ...makeBody(), eventId: 'wrong' },
      { ...makeBody(), unexpected: 'private' },
    ]) {
      expect(telemetryReceipt(request(path), body, origin)).toBeNull();
    }
  });
  it('rejects invalid session operations, actor identities and module bindings', () => {
    for (const body of [
      { ...session('start'), operation: 'unknown' },
      { ...session('start'), projectId: 'wrong' },
      { ...session('start'), moduleKey: 'unknown' },
      { ...session('touch'), actorExpectation: null },
      { ...session('close'), projectId: id(7) },
    ]) {
      expect(
        telemetryReceipt(request('/api/analytics/v2/module-session'), body, origin),
      ).toBeNull();
    }
  });
  it.each([false, true])(
    'rejects invalid quality data and crossed pipelines (diagnostics=%s)',
    (diagnostics) => {
      const body = quality(diagnostics);
      const path = diagnostics ? '/api/diagnostics/quality' : '/api/analytics/v2/quality';
      for (const invalid of [
        { ...body, sequence: 0 },
        { ...body, counters: {} },
        { ...body, gauges: { pending: 257, inFlight: 0 } },
        { ...body, pipeline: diagnostics ? 'product-analytics' : 'client-diagnostics' },
        { ...body, actorExpectation: diagnostics ? actor : undefined },
        { ...body, acknowledgementStage: 'wrong' },
        { ...body, coverage: {} },
      ]) {
        expect(telemetryReceipt(request(path), invalid, origin)).toBeNull();
      }
    },
  );
  it('rejects malformed diagnostic optional fields and unknown vocabulary', () => {
    for (const invalid of [
      { code: 'unknown' },
      { module: 'unknown' },
      { revision: 'private' },
      { occurredAt: -1 },
      { occurredAt: 8_640_000_000_000_001 },
      { httpStatus: 99 },
      { durationMs: -1 },
      { phase: 'unknown' },
      { category: 'unknown' },
      { failureCode: 'unknown' },
      { script: 'https://foreign.test/private.js' },
      { line: 0 },
      { instanceId: 'wrong' },
    ]) {
      expect(
        telemetryReceipt(
          request('/api/diagnostics/client'),
          { ...diagnostic(), ...invalid },
          origin,
        ),
      ).toBeNull();
    }
  });
  it('accepts server-valid diagnostic time after a virtual minute advance', () => {
    const body = { ...diagnostic(), occurredAt: Date.now() + 66_000 };
    expect(telemetryReceipt(request('/api/diagnostics/client'), body, origin)).toEqual({
      status: 202,
      json: { accepted: true },
    });
  });
});

describe('Scratch diagnostic fixture matches current shipping envelopes', () => {
  it('acknowledges the actual coalesced heartbeat produced by DiagnosticOutbox', async () => {
    const ledger = new TelemetryQuality(undefined, disk());
    ledgers.push(ledger);
    const sent: Array<Record<string, unknown>> = [];
    const receipts: unknown[] = [];
    const transport = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      sent.push(body);
      const receipt = telemetryReceipt(request(url), body, origin);
      receipts.push(receipt);
      return new Response(JSON.stringify(receipt?.json ?? { error: 'invalid_fixture_telemetry' }), {
        status: receipt?.status ?? 400,
      });
    });
    vi.stubGlobal('fetch', transport);
    const outbox = new DiagnosticOutbox(disk(), ledger);
    const first = Date.now();
    for (let index = 0; index < 3; index++) {
      vi.setSystemTime(first + index * 1_000);
      outbox.enqueue({ ...diagnostic(), code: 'editor_heartbeat', eventId: id(40 + index) });
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      eventId: id(40),
      code: 'editor_heartbeat',
      module: 'scratch',
      occurredAt: first,
      repetitionCount: 3,
      firstOccurredAt: first,
      lastOccurredAt: first + 2_000,
    });
    expect(diagnosticIntakeStatus(sent[0])).toBe(202);
    expect(receipts).toEqual([{ status: 202, json: { accepted: true } }]);
    expect(ledger.read().counters).toMatchObject({
      attempted: 3,
      coalesced: 2,
      acknowledged: 3,
      retried: 0,
      permanentRejected: 0,
    });
  });

  it.each([
    {
      name: 'request failure details',
      extra: () => ({
        code: 'request_failed',
        phase: 'request',
        operation: 'blocks_runtime_session',
        method: 'POST',
        failureKind: 'http',
        httpStatus: 503,
        clientAttemptId: id(50),
        relatedRequestId: id(51),
      }),
    },
    {
      name: 'read cancellation',
      extra: () => ({
        code: 'request_cancelled',
        phase: 'request',
        operation: 'project_read',
        method: 'GET',
        failureKind: 'cancelled',
        clientAttemptId: id(50),
      }),
    },
    ...['scratch-save-asset', 'scratch-save-draft', 'scratch-save-prepare'].map((failureCode) => ({
      name: failureCode,
      extra: () => ({ code: 'autosave_failed', phase: 'save', failureCode }),
    })),
    ...(['window', 'rejection', 'app_boundary', 'editor_boundary'] as const).map((capture) => ({
      name: capture,
      extra: () => ({
        code:
          capture === 'window'
            ? 'window_error'
            : capture === 'rejection'
              ? 'unhandled_rejection'
              : 'render_failed',
        exception: capturedException(capture),
        script: '/assets/product-main-1234abcd.js',
        line: 12,
        column: 34,
      }),
    })),
    {
      name: 'generated worker script',
      extra: () => ({ code: 'window_error', script: '/assets/simulation.worker-1234abcd.js' }),
    },
  ])('accepts $name through the shipping outbox and real intake', async ({ extra }) => {
    const body = { ...diagnostic(), ...extra() };
    expect(diagnosticIntakeStatus(body)).toBe(202);
    const ledger = new TelemetryQuality(undefined, disk());
    ledgers.push(ledger);
    const sent: unknown[] = [];
    const transport = vi.fn(async (url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      sent.push(payload);
      const receipt = telemetryReceipt(request(url), payload, origin);
      return new Response(JSON.stringify(receipt?.json ?? { error: 'invalid_fixture_telemetry' }), {
        status: receipt?.status ?? 400,
      });
    });
    vi.stubGlobal('fetch', transport);
    new DiagnosticOutbox(disk(), ledger).enqueue(body);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([body]);
    expect(ledger.read().counters).toMatchObject({
      acknowledged: 1,
      invalidEnvelope: 0,
      retried: 0,
      permanentRejected: 0,
    });
  });

  it('uses absolute intake time bounds for valid aggregate timestamps', () => {
    const first = Date.now() + 66_000;
    const body = {
      ...diagnostic(),
      occurredAt: first,
      repetitionCount: 2,
      firstOccurredAt: first,
      lastOccurredAt: first + 15 * 60_000,
    };
    expect(diagnosticIntakeStatus(body)).toBe(202);
    expect(telemetryReceipt(request('/api/diagnostics/client'), body, origin)).toEqual({
      status: 202,
      json: { accepted: true },
    });
  });

  it('rejects partial, unbounded or inconsistent occurrence aggregates like real intake', () => {
    const first = Date.now();
    const body = {
      ...diagnostic(),
      repetitionCount: 2,
      firstOccurredAt: first,
      lastOccurredAt: first + 1_000,
    };
    for (const invalid of [
      { repetitionCount: 0 },
      { repetitionCount: 1.5 },
      { repetitionCount: 1_000_001 },
      { repetitionCount: '2' },
      { repetitionCount: Infinity },
      { repetitionCount: undefined },
      { firstOccurredAt: undefined },
      { lastOccurredAt: undefined },
      { firstOccurredAt: first + 1 },
      { lastOccurredAt: first - 1 },
      { lastOccurredAt: first + 15 * 60_000 + 1 },
      { lastOccurredAt: 8_640_000_000_000_001 },
      { eventId: undefined },
      { occurredAt: undefined },
    ]) {
      const candidate = { ...body, ...invalid };
      expect(diagnosticIntakeStatus(candidate)).toBe(400);
      expect(telemetryReceipt(request('/api/diagnostics/client'), candidate, origin)).toBeNull();
    }
  });

  it('rejects unknown request fields and invalid cancellation/save combinations like real intake', () => {
    for (const invalid of [
      { operation: '/api/projects/PRIVATE?token=PRIVATE' },
      { method: 'PRIVATE' },
      { failureKind: 'PRIVATE' },
      { clientAttemptId: 'PRIVATE' },
      { url: 'https://private.test/' },
      { body: 'PRIVATE' },
      { code: 'request_cancelled', method: 'PUT', phase: 'request', failureKind: 'cancelled' },
      { code: 'request_cancelled', method: 'GET', phase: 'request', failureKind: 'timeout' },
      { code: 'request_cancelled', method: 'GET', phase: 'save', failureKind: 'cancelled' },
      { code: 'request_cancelled', method: 'GET', phase: 'request' },
      { failureCode: 'scratch-save-draft' },
      {
        code: 'autosave_failed',
        phase: 'save',
        module: 'portal',
        failureCode: 'scratch-save-draft',
      },
      { code: 'autosave_failed', phase: 'runtime', failureCode: 'scratch-save-prepare' },
    ]) {
      const candidate = { ...diagnostic(), ...invalid };
      expect(diagnosticIntakeStatus(candidate)).toBe(400);
      expect(telemetryReceipt(request('/api/diagnostics/client'), candidate, origin)).toBeNull();
    }
  });

  it('rejects exception privacy leaks, mismatched codes and invalid generated coordinates', () => {
    const exception = capturedException('window');
    const frame = exception.frames[0]!;
    for (const invalid of [
      null,
      [],
      { ...exception, kind: 'PRIVATE' },
      { ...exception, capture: 'PRIVATE' },
      { ...exception, handling: 'boundary_fallback' },
      { ...exception, message: 'PRIVATE' },
      { ...exception, stack: 'PRIVATE' },
      { ...exception, frames: Array.from({ length: 6 }, () => frame) },
      { ...exception, frames: [{ ...frame, message: 'PRIVATE' }] },
      { ...exception, frames: [{ ...frame, script: 'https://private.test/app.js' }] },
      { ...exception, frames: [{ ...frame, script: '/assets/product-main.js?token=PRIVATE' }] },
      { ...exception, frames: [{ ...frame, script: '/assets/product-main.js' }] },
      { ...exception, frames: [{ ...frame, line: 0 }] },
      { ...exception, frames: [{ ...frame, column: 10_000_001 }] },
    ]) {
      const body = { ...diagnostic(), code: 'window_error', exception: invalid };
      expect(diagnosticIntakeStatus(body)).toBe(400);
      expect(telemetryReceipt(request('/api/diagnostics/client'), body, origin)).toBeNull();
    }
    const crossed = { ...diagnostic(), code: 'unhandled_rejection', exception };
    expect(diagnosticIntakeStatus(crossed)).toBe(400);
    expect(telemetryReceipt(request('/api/diagnostics/client'), crossed, origin)).toBeNull();
  });
});

describe('exact telemetry classification retains all other mutation evidence', () => {
  const paths = [
    '/api/analytics/v2/events',
    '/api/analytics/v2/module-session',
    '/api/analytics/v2/quality',
    '/api/diagnostics/client',
    '/api/diagnostics/quality',
  ];
  it.each(paths)('allows only exact POST %s on the parent origin', (path) => {
    expect(isTelemetryRequest(request(path), origin)).toBe(true);
    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
      expect(isTelemetryRequest(request(path, method), origin)).toBe(false);
    for (const url of [
      `${origin}${path}?retry=1`,
      `${origin}${path}?`,
      `${origin}${path}#fragment`,
      `${origin}${path}/extra`,
      `${origin}${path}-extra`,
      `https://foreign.test${path}`,
      `http://localhost:4612${path}`,
      `${origin}/prefix${path}`,
    ]) {
      const input = { method: 'POST', url };
      expect(isTelemetryRequest(input, origin)).toBe(false);
      expect(telemetryReceipt(input, visit(), origin)).toBeNull();
    }
  });
  it.each([
    '/api/projects/id/draft',
    '/api/account/presentation',
    '/api/auth/refresh',
    '/api/analytics/unknown',
  ])('retains unknown or business mutation %s', (path) => {
    expect(isTelemetryRequest(request(path), origin)).toBe(false);
  });
});

describe('only the observed intentional telemetry 401 console error is expected', () => {
  const url = `${origin}/api/analytics/v2/module-session`;
  const detail = {
    index: 0,
    kind: 'console',
    type: 'error',
    url,
    text: 'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
  };
  const responses = [{ method: 'POST', url, status: 401 }];
  it('correlates exact console evidence without mutating either raw array', () => {
    const before = JSON.stringify({ detail, responses });
    expect(isExpectedTelemetryRejection(detail, responses, origin)).toBe(true);
    expect(JSON.stringify({ detail, responses })).toBe(before);
  });
  it.each([
    undefined,
    { ...detail, kind: 'pageerror' },
    { ...detail, type: 'warning' },
    { ...detail, url: '' },
    { ...detail, url: `${origin}/api/auth/refresh` },
    { ...detail, url: `${url}?retry=1` },
    { ...detail, url: 'https://foreign.test/api/analytics/v2/module-session' },
    { ...detail, text: `${detail.text} unexpected` },
  ])('keeps unrelated or unlocatable error %#', (value) => {
    expect(isExpectedTelemetryRejection(value, responses, origin)).toBe(false);
  });
  it.each(
    [
      [],
      [{ method: 'GET', url, status: 401 }],
      [{ method: 'POST', url, status: 403 }],
      [{ method: 'POST', url: `${origin}/api/auth/refresh`, status: 401 }],
    ].map((observed) => ({ observed })),
  )('requires exact corresponding observed response %#', ({ observed }) => {
    expect(isExpectedTelemetryRejection(detail, observed, origin)).toBe(false);
  });
});
