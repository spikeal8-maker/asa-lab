import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticOutbox } from './client-diagnostic-outbox';
import { TelemetryQuality } from './telemetry-quality';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const event = (n: number) => ({
  eventId: id(n),
  occurredAt: Date.now(),
  code: 'autosave_failed',
  module: 'electronics',
  revision: 'abcdef0',
});
function disk() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}
const ledgers: TelemetryQuality[] = [];
function ledger(storage = disk()) {
  const quality = new TelemetryQuality(undefined, storage);
  ledgers.push(quality);
  return quality;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  ledgers.splice(0).forEach((quality) => quality.retire());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('diagnostic losses are observable separately from intake', () => {
  it.each([400, 401, 403])(
    'counts permanent HTTP%s rejection without claiming acknowledgement',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status })),
      );
      const quality = ledger();
      new DiagnosticOutbox(disk(), quality).enqueue(event(1));
      await vi.advanceTimersByTimeAsync(0);
      expect(quality.read().counters).toMatchObject({
        attempted: 1,
        enqueued: 1,
        permanentRejected: 1,
        acknowledged: 0,
      });
    },
  );
  it('bare202 is not intake acknowledgement, while accepted202 explicitly is', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockImplementation(
        async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }),
      );
    vi.stubGlobal('fetch', fetch);
    const quality = ledger();
    new DiagnosticOutbox(disk(), quality).enqueue(event(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(quality.read().counters).toMatchObject({ retried: 1, acknowledged: 1 });
    expect(fetch.mock.calls[0]![1].body).toBe(fetch.mock.calls[1]![1].body);
  });
  it('counts invalid, duplicate and expired stored/new envelopes and never sends forbidden fields', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }),
    );
    vi.stubGlobal('fetch', fetch);
    const storage = disk();
    const quality = ledger(storage);
    storage.setItem(
      'asa:diagnostics:v1',
      JSON.stringify([
        event(1),
        event(1),
        { ...event(2), secret: 'private' },
        { ...event(3), occurredAt: Date.now() - 900_001 },
      ]),
    );
    const outbox = new DiagnosticOutbox(storage, quality);
    outbox.enqueue({ ...event(4), secret: 'private' });
    outbox.enqueue({ ...event(5), occurredAt: Date.now() - 900_001 });
    outbox.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(quality.read().counters).toMatchObject({
      invalidStored: 2,
      invalidEnvelope: 1,
      expired: 2,
      acknowledged: 1,
    });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('private');
  });
  it('includes in-flight work in capacity and never evicts the unresolved payload to admit another', async () => {
    let release!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const storage = disk();
    const quality = ledger(storage);
    const outbox = new DiagnosticOutbox(storage, quality);
    outbox.enqueue({ ...event(1), code: 'editor_heartbeat' });
    for (let n = 2; n <= 51; n++) outbox.enqueue(event(n));
    const queue = JSON.parse(storage.getItem('asa:diagnostics:v1')!);
    expect(queue).toHaveLength(50);
    expect(queue[0].eventId).toBe(id(1));
    expect(quality.read().gauges).toEqual({ pending: 49, inFlight: 1 });
    expect(quality.read().counters.evicted).toBe(1);
    release(new Response('{}', { status: 400 }));
    await vi.advanceTimersByTimeAsync(0);
  });
  it('attempted includes report-level deduplication/suppression before enqueue', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 202 })),
    );
    const { reportClientDiagnostic, beginDiagnosticContext } = await import('./client-diagnostics');
    const { diagnosticQuality } = await import('./telemetry-quality');
    const quality = diagnosticQuality();
    ledgers.push(quality);
    reportClientDiagnostic('window_error', 'portal');
    reportClientDiagnostic('window_error', 'portal');
    for (let n = 0; n < 20; n++) {
      beginDiagnosticContext('portal');
      reportClientDiagnostic('window_error', 'portal');
    }
    expect(quality.read().counters).toMatchObject({
      attempted: 22,
      deduplicated: 1,
      suppressed: 9,
      enqueued: 12,
    });
  });
});
