import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticOutbox } from './client-diagnostic-outbox';
import { TelemetryQuality } from './telemetry-quality';
const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const event = (n = 1) => ({
  eventId: id(n),
  occurredAt: Date.now(),
  code: 'autosave_failed',
  module: 'electronics',
  revision: 'abcdef0',
  instanceId: id(999),
});
function storage() {
  let value = '[]';
  return {
    getItem: () => value,
    setItem: (_key: string, raw: string) => {
      value = raw;
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('bounded diagnostics delivery', () => {
  it('restores and sends robotics and 3D diagnostics without widening private payloads', async () => {
    const port = storage();
    port.setItem(
      'queue',
      JSON.stringify([
        { ...event(1), module: 'robotics', code: 'simulation_failed', phase: 'simulation' },
        { ...event(2), module: 'three-d', code: 'export_failed', phase: 'runtime' },
        { ...event(3), module: 'robotics', projectDocument: 'private' },
      ]),
    );
    const transport = vi.fn<typeof fetch>(
      async () => new Response('{"accepted":true}', { status: 202 }),
    );
    vi.stubGlobal('fetch', transport);
    new DiagnosticOutbox(port).retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      expect.objectContaining({ eventId: id(1), module: 'robotics', code: 'simulation_failed' }),
      expect.objectContaining({ eventId: id(2), module: 'three-d', code: 'export_failed' }),
    ]);
    expect(JSON.parse(port.getItem())).toEqual([]);
  });
  it('coalesces distinct attempts and freezes a sent aggregate through failure, wakeups and retry', async () => {
    vi.mocked(Math.random).mockReturnValue(0.5);
    const disk = storage();
    const quality = new TelemetryQuality(undefined, { getItem: () => null, setItem() {} });
    let finish!: (response: Response) => void;
    const transport = vi.fn<typeof fetch>(
      async () => new Response('{"accepted":true}', { status: 202 }),
    );
    transport.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('fetch', transport);
    const outbox = new DiagnosticOutbox(disk, quality);
    const report = (n: number) => ({
      ...event(n),
      code: 'request_failed',
      phase: 'request',
      operation: 'project_read',
      method: 'GET',
      httpStatus: 503,
      failureKind: 'http',
      clientAttemptId: id(n + 1000),
      relatedRequestId: id(n + 2000),
    });
    for (let n = 1; n <= 100; n++) outbox.enqueue(report(n));
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(1);
    const original = transport.mock.calls[0]![1]!.body;
    expect(JSON.parse(original as string)).toMatchObject({
      eventId: id(1),
      repetitionCount: 100,
      firstOccurredAt: 1_000_000,
      lastOccurredAt: 1_000_000,
      clientAttemptId: id(1001),
    });
    await vi.advanceTimersByTimeAsync(500);
    for (let n = 101; n <= 103; n++) outbox.enqueue(report(n));
    finish(new Response('{}', { status: 503 }));
    await vi.advanceTimersByTimeAsync(0);
    for (let n = 0; n < 100; n++) outbox.retryNow();
    await vi.advanceTimersByTimeAsync(1499);
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.mock.calls[1]![1]!.body).toBe(original);
    await vi.advanceTimersByTimeAsync(8000);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(JSON.parse(transport.mock.calls[2]![1]!.body as string)).toMatchObject({
      eventId: id(101),
      repetitionCount: 3,
      firstOccurredAt: 1_000_500,
      lastOccurredAt: 1_000_500,
    });
    expect(JSON.parse(disk.getItem())).toEqual([]);
    expect(quality.read().counters).toMatchObject({
      attempted: 103,
      enqueued: 2,
      coalesced: 101,
      acknowledged: 103,
      retried: 1,
    });
  });
  it('protects queued render/autosave reports from network eviction and counts discarded occurrences', async () => {
    const disk = storage();
    const quality = new TelemetryQuality(undefined, { getItem: () => null, setItem() {} });
    const now = Date.now();
    disk.setItem(
      '',
      JSON.stringify([
        {
          ...event(1),
          code: 'editor_heartbeat',
          repetitionCount: 7,
          firstOccurredAt: now,
          lastOccurredAt: now,
        },
        ...Array.from({ length: 49 }, (_, n) => ({ ...event(n + 2), instanceId: id(n + 500) })),
      ]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => new Promise(() => {})),
    );
    const outbox = new DiagnosticOutbox(disk, quality);
    outbox.enqueue({ ...event(100), code: 'request_failed' });
    outbox.enqueue({ ...event(101), code: 'render_failed' });
    outbox.enqueue({ ...event(102), code: 'request_slow' });
    const queued = JSON.parse(disk.getItem());
    expect(queued).toHaveLength(50);
    expect(
      queued.filter((entry: { code: string }) => entry.code === 'autosave_failed'),
    ).toHaveLength(49);
    expect(queued.some((entry: { code: string }) => entry.code === 'render_failed')).toBe(true);
    expect(quality.read().counters).toMatchObject({ evicted: 8, suppressed: 1 });
    await vi.advanceTimersByTimeAsync(0);
  });
  it('counts expired and permanently rejected aggregate occurrences, while treating malformed stored counts as unknown', async () => {
    const disk = storage();
    const quality = new TelemetryQuality(undefined, { getItem: () => null, setItem() {} });
    const now = Date.now();
    disk.setItem(
      '',
      JSON.stringify([
        {
          ...event(1),
          occurredAt: now - 900_001,
          repetitionCount: 13,
          firstOccurredAt: now - 900_001,
          lastOccurredAt: now - 900_000,
        },
        { ...event(2), repetitionCount: 1e30, firstOccurredAt: now, lastOccurredAt: now },
        { ...event(3), repetitionCount: 2, lastOccurredAt: now },
        { ...event(4), repetitionCount: 11, firstOccurredAt: now, lastOccurredAt: now },
      ]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('{}', { status: 400 })),
    );
    new DiagnosticOutbox(disk, quality).retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(disk.getItem())).toEqual([]);
    expect(quality.read().counters).toMatchObject({
      expired: 13,
      permanentRejected: 11,
      invalidStored: 2,
      acknowledged: 0,
    });
  });
  it('never changes a restored aggregate when new identical failures arrive', async () => {
    const disk = storage();
    const now = Date.now();
    const saved = { ...event(1), repetitionCount: 9, firstOccurredAt: now, lastOccurredAt: now };
    disk.setItem('', JSON.stringify([saved]));
    const transport = vi.fn<typeof fetch>(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', transport);
    const outbox = new DiagnosticOutbox(disk);
    outbox.enqueue(event(2));
    outbox.enqueue(event(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string)).toEqual(saved);
    expect(JSON.parse(disk.getItem())).toHaveLength(2);
    expect(JSON.parse(disk.getItem())[1]).toMatchObject({ eventId: id(2), repetitionCount: 2 });
  });
  it('persists only bounded request metadata and safe cancelled reads', async () => {
    const disk = storage();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const outbox = new DiagnosticOutbox(disk);
    const body = {
      ...event(),
      code: 'request_cancelled',
      phase: 'request',
      method: 'GET',
      operation: 'auth_me',
      failureKind: 'cancelled',
      clientAttemptId: id(7),
    };
    outbox.enqueue(body);
    let n = 2;
    for (const extra of [
      { operation: '/api/PRIVATE?token=secret' },
      { method: 'PRIVATE' },
      { failureKind: 'PRIVATE' },
      { clientAttemptId: 'PRIVATE' },
      { url: 'PRIVATE' },
      { method: 'PUT' },
      { failureKind: 'timeout' },
    ])
      outbox.enqueue({ ...body, eventId: id(n++), ...extra });
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(disk.getItem())).toEqual([body]);
    expect(disk.getItem()).not.toMatch(/PRIVATE|token|secret/);
  });
  it('retains a safe exception through outage and reload, and drops private nested extras', async () => {
    const disk = storage();
    const exception = {
      kind: 'TypeError',
      capture: 'window',
      handling: 'unhandled',
      frames: [{ script: '/assets/ArduinoCodePanel-1234abcd.js', line: 5, column: 10 }],
    };
    const body = { ...event(), code: 'window_error', exception };
    let status = 503;
    const transport = vi.fn<typeof fetch>(
      async () => new Response('{"accepted":true}', { status }),
    );
    vi.stubGlobal('fetch', transport);
    const first = new DiagnosticOutbox(disk);
    first.enqueue(body);
    first.enqueue({
      ...event(2),
      code: 'window_error',
      exception: { ...exception, message: 'PRIVATE' },
    });
    await vi.advanceTimersByTimeAsync(0);
    const original = transport.mock.calls[0]![1]!.body;
    expect(JSON.parse(String(original)).exception).toEqual(exception);
    expect(disk.getItem()).not.toContain('PRIVATE');
    vi.clearAllTimers();
    status = 202;
    new DiagnosticOutbox(disk).retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.mock.calls.at(-1)![1]!.body).toBe(original);
    expect(JSON.parse(disk.getItem())).toEqual([]);
  });
  it.each(['scratch-save-asset', 'scratch-save-draft', 'scratch-save-prepare'])(
    'retains %s through a failed delivery and reload with the same event identity',
    async (failureCode) => {
      const port = storage();
      let status = 503;
      const transport = vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify({ accepted: true }), { status }),
      );
      vi.stubGlobal('fetch', transport);
      const first = new DiagnosticOutbox(port);
      first.enqueue({
        ...event(),
        module: 'scratch',
        phase: 'save',
        failureCode,
        httpStatus: 400,
        durationMs: 1,
        relatedRequestId: id(8),
      });
      await vi.advanceTimersByTimeAsync(0);
      const original = transport.mock.calls[0]![1]!.body;
      vi.clearAllTimers(); // Browser reload destroys the old retry timer.
      status = 202;
      const restored = new DiagnosticOutbox(port);
      restored.retryNow();
      await vi.advanceTimersByTimeAsync(0);
      expect(transport.mock.calls.at(-1)![1]!.body).toBe(original);
      expect(JSON.parse(port.getItem())).toEqual([]);
    },
  );

  it('rejects restored Scratch save reports with foreign contexts or private extra fields', async () => {
    const port = storage();
    port.setItem(
      'queue',
      JSON.stringify([
        { ...event(), module: 'portal', phase: 'save', failureCode: 'scratch-save-asset' },
        { ...event(2), module: 'scratch', phase: 'runtime', failureCode: 'scratch-save-draft' },
        {
          ...event(3),
          module: 'scratch',
          phase: 'save',
          failureCode: 'scratch-save-draft',
          token: 'secret',
        },
      ]),
    );
    const transport = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', transport);
    new DiagnosticOutbox(port).retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).not.toHaveBeenCalled();
    expect(JSON.parse(port.getItem())).toEqual([]);
  });
  it.each(['read', 'write', 'absent'] as const)(
    'reports %s queue storage failure through healthy anonymous quality and keeps bounded retryable memory',
    async (failure) => {
      const values = new Map<string, string>();
      const port = {
        getItem: (key: string) => {
          if (key === 'asa:diagnostics:v1' && failure === 'read') throw Error('security');
          return values.get(key) ?? null;
        },
        setItem: (key: string, value: string) => {
          if (key === 'asa:diagnostics:v1' && failure === 'write') throw Error('quota');
          values.set(key, value);
        },
      };
      let status = 200;
      const transport = vi.fn<typeof fetch>(async (path, init) => {
        const body = JSON.parse(init!.body as string);
        return new Response(
          JSON.stringify(
            String(path).endsWith('/quality')
              ? {
                  accepted: true,
                  state: 'intake_acknowledged',
                  schemaVersion: 2,
                  eventId: body.eventId,
                  streamId: body.streamId,
                  sequence: body.sequence,
                  pipeline: body.pipeline,
                  acknowledgementStage: body.acknowledgementStage,
                }
              : { accepted: true },
          ),
          { status: String(path).endsWith('/quality') ? 202 : status },
        );
      });
      vi.stubGlobal('fetch', transport);
      const quality = new TelemetryQuality(undefined, port, transport);
      const outbox = new DiagnosticOutbox(failure === 'absent' ? undefined : port, quality);
      outbox.enqueue(event());
      await vi.advanceTimersByTimeAsync(0);
      expect(quality.read()).toMatchObject({
        counters: { storageUnavailable: 1, invalidStored: 0, acknowledged: 0, retried: 1 },
        coverage: { persistenceUnavailable: true, uncleanEnd: true },
      });
      expect(
        JSON.parse(values.get('asa:quality:v2:diagnostics')!).snapshot.coverage
          .persistenceUnavailable,
      ).toBe(true);
      await quality.flush();
      const qualityCall = transport.mock.calls.find(([path]) => String(path).endsWith('/quality'))!;
      expect(qualityCall[0]).toBe('/api/diagnostics/quality');
      const body = JSON.parse(qualityCall[1]!.body as string);
      expect(body).toMatchObject({
        pipeline: 'client-diagnostics',
        acknowledgementStage: 'intake_acknowledged',
        counters: { storageUnavailable: 1, invalidStored: 0 },
        coverage: { persistenceUnavailable: true, uncleanEnd: true },
      });
      expect(body).not.toHaveProperty('actorExpectation');
      const original = transport.mock.calls[0]![1]!.body;
      status = 202;
      await vi.advanceTimersByTimeAsync(1000);
      expect(
        transport.mock.calls.filter(([path]) => String(path).endsWith('/client'))[1]![1]!.body,
      ).toBe(original);
      expect(quality.read().counters.acknowledged).toBe(1);
      status = 503;
      for (let n = 2; n <= 62; n++) outbox.enqueue({ ...event(n), instanceId: id(n + 1000) });
      await vi.advanceTimersByTimeAsync(0);
      expect(quality.read().gauges).toEqual({ pending: 50, inFlight: 0 });
      expect(quality.read().counters).toMatchObject({ storageUnavailable: 1, evicted: 11 });
      quality.retire();
    },
  );
  it.each(['', '{', JSON.stringify([{ ...event(), password: 'secret' }])])(
    'classifies readable corrupt diagnostics as invalidStored without unavailable coverage',
    (raw) => {
      const disk = storage();
      disk.setItem('', raw);
      const values = new Map<string, string>();
      const quality = new TelemetryQuality(undefined, {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value);
        },
      });
      new DiagnosticOutbox(disk, quality);
      expect(quality.read().counters.invalidStored).toBeGreaterThan(0);
      expect(quality.read().counters.storageUnavailable).toBe(0);
      expect(quality.read().coverage.persistenceUnavailable).toBe(false);
      quality.retire();
    },
  );
  it('retains diagnostics after HTTP200 accepted=true and acknowledges only HTTP202 intake', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200 }))
      .mockImplementation(
        async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }),
      );
    vi.stubGlobal('fetch', transport);
    const disk = storage();
    const values = new Map<string, string>();
    const quality = new TelemetryQuality(undefined, {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    });
    const outbox = new DiagnosticOutbox(disk, quality);
    const original = event();
    outbox.enqueue(original);
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(disk.getItem())).toEqual([original]);
    expect(quality.read().counters).toMatchObject({
      acknowledged: 0,
      retried: 1,
      permanentRejected: 0,
    });
    expect(quality.read().gauges).toEqual({ pending: 1, inFlight: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.mock.calls[1]![0]).toBe('/api/diagnostics/client');
    expect(transport.mock.calls[1]![1]!.body).toBe(transport.mock.calls[0]![1]!.body);
    expect(JSON.parse(disk.getItem())).toEqual([]);
    expect(quality.read().counters).toMatchObject({
      acknowledged: 1,
      retried: 1,
      permanentRejected: 0,
    });
    quality.retire();
  });
  it('retains the original event across lost acknowledgements and reload, then removes it on acceptance', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', transport);
    const disk = storage();
    const outbox = new DiagnosticOutbox(disk);
    const original = event();
    outbox.enqueue(original);
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(disk.getItem())).toEqual([original]);
    transport.mockImplementation(
      async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }),
    );
    new DiagnosticOutbox(disk).retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(transport.mock.calls[1]![1].body)).toEqual(original);
    expect(JSON.parse(disk.getItem())).toEqual([]);
  });
  it.each([408, 429, 500, 503])(
    'retries temporary HTTP %i with the same identity',
    async (status) => {
      const transport = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status }))
        .mockImplementation(
          async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }),
        );
      vi.stubGlobal('fetch', transport);
      new DiagnosticOutbox().enqueue(event());
      await vi.advanceTimersByTimeAsync(999);
      expect(transport).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(transport).toHaveBeenCalledTimes(2);
      expect(transport.mock.calls[1]![1].body).toBe(transport.mock.calls[0]![1].body);
    },
  );
  it('drops permanently rejected reports and never retries private storage content', async () => {
    const transport = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    vi.stubGlobal('fetch', transport);
    const disk = storage();
    disk.setItem(
      '',
      JSON.stringify([
        { ...event(), message: 'password=secret' },
        { ...event(2), script: '/assets/test.js?secret=private' },
        event(3),
      ]),
    );
    new DiagnosticOutbox(disk).retryNow();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![1].body).not.toContain('secret');
    expect(JSON.parse(disk.getItem())).toEqual([]);
  });
  it('bounds a long outage and expires reports instead of growing without limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const disk = storage();
    const outbox = new DiagnosticOutbox(disk);
    outbox.enqueue({ ...event(), code: 'editor_heartbeat' });
    await vi.advanceTimersByTimeAsync(0); // The failed flight settled; the queued health report can be evicted.
    for (let n = 2; n <= 51; n++) outbox.enqueue({ ...event(n), instanceId: id(n + 1000) });
    expect(JSON.parse(disk.getItem())).toHaveLength(50);
    expect(disk.getItem()).not.toContain('editor_heartbeat');
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(JSON.parse(disk.getItem())).toEqual([]);
  });
  it('times out a stalled transport and survives blocked session storage', async () => {
    const transport = vi
      .fn()
      .mockImplementation(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      );
    vi.stubGlobal('fetch', transport);
    const outbox = new DiagnosticOutbox({
      getItem: () => {
        throw Error('denied');
      },
      setItem: () => {
        throw Error('denied');
      },
    });
    expect(() => outbox.enqueue(event())).not.toThrow();
    await vi.advanceTimersByTimeAsync(13_000);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
