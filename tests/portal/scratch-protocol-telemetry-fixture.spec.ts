import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { ClientDiagnosticsController } from '../../apps/api/src/client-diagnostics.controller';
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

describe('Scratch diagnostic aggregates match shipping HTTP intake', () => {
  const reportRequest = () =>
    ({
      ip: '172.21.0.4',
      id: id(100),
      raw: { socket: { remoteAddress: '172.21.0.4' } },
      headers: { 'x-forwarded-for': '203.0.113.1' },
    }) as unknown as FastifyRequest;
  const aggregate = () => ({
    ...diagnostic(),
    occurredAt: 1_000_000,
    repetitionCount: 4,
    firstOccurredAt: 1_000_000,
    lastOccurredAt: 1_045_000,
  });
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ASA_APPLICATION_LOG_STORE', '');
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    { name: 'legacy envelope without aggregate fields', fields: {} },
    {
      name: 'single occurrence at the absolute lower timestamp bound',
      fields: { occurredAt: 0, repetitionCount: 1, firstOccurredAt: 0, lastOccurredAt: 0 },
    },
    {
      name: 'maximum count and complete fifteen-minute interval',
      fields: {
        occurredAt: 1_000_000,
        repetitionCount: 1_000_000,
        firstOccurredAt: 1_000_000,
        lastOccurredAt: 1_900_000,
      },
    },
    {
      name: 'absolute upper timestamp bound independent of the Node clock',
      fields: {
        occurredAt: 8_639_999_999_100_000,
        repetitionCount: 2,
        firstOccurredAt: 8_639_999_999_100_000,
        lastOccurredAt: 8_640_000_000_000_000,
      },
    },
  ])('accepts $name without discarding the occurrence data', ({ fields }) => {
    const body = { ...diagnostic(), ...fields };
    expect(telemetryReceipt(request('/api/diagnostics/client'), body, origin)).toEqual({
      status: 202,
      json: { accepted: true },
    });
    expect(new ClientDiagnosticsController().report(reportRequest(), body)).toEqual({
      accepted: true,
    });
    expect(process.stdout.write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(vi.mocked(process.stdout.write).mock.calls[0]![0]))).toMatchObject(
      body,
    );
  });

  it.each([
    ['missing count', { repetitionCount: undefined }],
    ['missing first timestamp', { firstOccurredAt: undefined }],
    ['missing last timestamp', { lastOccurredAt: undefined }],
    ['count alone', { firstOccurredAt: undefined, lastOccurredAt: undefined }],
    ['first timestamp alone', { repetitionCount: undefined, lastOccurredAt: undefined }],
    ['last timestamp alone', { repetitionCount: undefined, firstOccurredAt: undefined }],
    ['zero count', { repetitionCount: 0 }],
    ['negative count', { repetitionCount: -1 }],
    ['fractional count', { repetitionCount: 1.5 }],
    ['string count', { repetitionCount: '4' }],
    ['null count', { repetitionCount: null }],
    ['count above limit', { repetitionCount: 1_000_001 }],
    ['NaN count', { repetitionCount: NaN }],
    ['infinite count', { repetitionCount: Infinity }],
    ['unsafe integer count', { repetitionCount: Number.MAX_SAFE_INTEGER + 1 }],
    ['mismatched first timestamp', { firstOccurredAt: 999_999 }],
    ['fractional first timestamp', { firstOccurredAt: 1_000_000.5 }],
    ['string first timestamp', { firstOccurredAt: '1000000' }],
    ['null first timestamp', { firstOccurredAt: null }],
    ['last timestamp before first', { lastOccurredAt: 999_999 }],
    ['fractional last timestamp', { lastOccurredAt: 1_045_000.5 }],
    ['string last timestamp', { lastOccurredAt: '1045000' }],
    ['null last timestamp', { lastOccurredAt: null }],
    ['NaN last timestamp', { lastOccurredAt: NaN }],
    ['infinite last timestamp', { lastOccurredAt: Infinity }],
    ['timestamp above absolute limit', { lastOccurredAt: 8_640_000_000_000_001 }],
    ['interval above fifteen minutes', { lastOccurredAt: 1_900_001 }],
    ['missing delivery ID', { eventId: undefined }],
    ['missing occurrence timestamp', { occurredAt: undefined }],
    ['unknown private field', { token: 'PRIVATE' }],
  ] as const)('rejects %s in both fixture and shipping intake', (_name, fields) => {
    const body = { ...aggregate(), ...fields };
    expect(telemetryReceipt(request('/api/diagnostics/client'), body, origin)).toBeNull();
    expect(() => new ClientDiagnosticsController().report(reportRequest(), body)).toThrowError(
      expect.objectContaining({ status: 400, response: { error: { code: 'validation_error' } } }),
    );
    expect(process.stdout.write).not.toHaveBeenCalled();
  });

  it('acknowledges all real Scratch heartbeats coalesced across four virtual minutes', async () => {
    vi.resetModules();
    const startedAt = Date.now();
    vi.stubGlobal('window', { sessionStorage: disk() });
    let sequence = 200;
    vi.stubGlobal('crypto', { randomUUID: () => id(sequence++) });
    const sent: Array<{ at: number; status: number; body: Record<string, unknown> }> = [];
    const transport = vi.fn<typeof fetch>(async (path, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const receipt = telemetryReceipt(
        { method: init?.method, url: `${origin}${String(path)}` },
        body,
        origin,
      );
      if (path === '/api/diagnostics/client')
        sent.push({ at: Date.now() - startedAt, status: receipt?.status ?? 400, body });
      return Response.json(receipt?.json ?? { error: { code: 'invalid_fixture_telemetry' } }, {
        status: receipt?.status ?? 400,
      });
    });
    vi.stubGlobal('fetch', transport);
    const { beginDiagnosticContext, reportClientDiagnostic } =
      await import('../../apps/web/src/client-diagnostics');
    const { diagnosticQuality } = await import('../../apps/web/src/telemetry-quality');
    const ledger = diagnosticQuality();
    ledgers.push(ledger);
    const endContext = beginDiagnosticContext('scratch', id(500));
    reportClientDiagnostic('editor_ready', 'scratch', { phase: 'startup' });
    const heartbeat = setInterval(() => {
      reportClientDiagnostic('editor_heartbeat', 'scratch', { phase: 'runtime' });
    }, 15_000);
    try {
      await vi.advanceTimersByTimeAsync(260_000);
      expect(sent.map(({ at }) => at)).toEqual([0, 15_000, 75_000, 135_000, 195_000, 255_000]);
      expect(sent.map(({ status }) => status)).toEqual([202, 202, 202, 202, 202, 202]);
      expect(sent.map(({ body }) => body.repetitionCount ?? 1)).toEqual([1, 1, 4, 4, 4, 4]);
      expect(sent[0]!.body).toMatchObject({ code: 'editor_ready', phase: 'startup' });
      expect(sent[1]!.body).toMatchObject({ code: 'editor_heartbeat', phase: 'runtime' });
      for (const [index, { body }] of sent.slice(2).entries())
        expect(body).toMatchObject({
          code: 'editor_heartbeat',
          module: 'scratch',
          phase: 'runtime',
          occurredAt: startedAt + 30_000 + index * 60_000,
          repetitionCount: 4,
          firstOccurredAt: startedAt + 30_000 + index * 60_000,
          lastOccurredAt: startedAt + 75_000 + index * 60_000,
        });
      const controller = new ClientDiagnosticsController();
      for (const { body } of sent)
        expect(controller.report(reportRequest(), body)).toEqual({ accepted: true });
      expect(ledger.read().counters).toMatchObject({
        attempted: 18,
        enqueued: 6,
        acknowledged: 18,
        permanentRejected: 0,
        retried: 0,
      });
    } finally {
      clearInterval(heartbeat);
      endContext();
    }
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
