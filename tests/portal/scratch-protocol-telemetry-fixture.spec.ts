import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isExpectedTelemetryRejection,
  isTelemetryRequest,
  telemetryReceipt,
} from '../../tools/blocks/browser/telemetry-fixture.mjs';
import { confirmedAnalytics, COUNTERS, validEnvelope } from '../../apps/web/src/telemetry-contract';
import { TelemetryQuality, validQuality } from '../../apps/web/src/telemetry-quality';
import { DiagnosticOutbox } from '../../apps/web/src/client-diagnostic-outbox';

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
