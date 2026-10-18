import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsDelivery } from './analytics-delivery';
import { TelemetryQuality } from './telemetry-quality';
import type { AnalyticsEnvelope, TelemetryActor } from './telemetry-contract';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor: TelemetryActor = { kind: 'account', accountId: id(1), workspaceId: id(2) };
function disk() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
}
function receipt(e: AnalyticsEnvelope, state = 'open') {
  return {
    accepted: true,
    state: 'persisted',
    schemaVersion: 2,
    eventId: e.eventId,
    receiptId: e.eventId,
    operation: e.operation ?? e.eventType,
    receivedAt: new Date().toISOString(),
    persistedAt: new Date().toISOString(),
    ...(e.operation
      ? {
          sessionId: e.sessionId,
          result: {
            creditedSeconds: 0,
            creditedFrom: null,
            creditedTo: null,
            sessionState: e.operation === 'close' ? 'closed' : state,
          },
        }
      : { recordId: 999 }),
  };
}
const workers: AnalyticsDelivery[] = [];
function fixture(
  transport = vi.fn<typeof fetch>(async (_path, init) => {
    const body = JSON.parse(init!.body as string) as AnalyticsEnvelope;
    return new Response(JSON.stringify(receipt(body)), { status: 200 });
  }),
  storage = disk(),
  identity = actor,
) {
  let serial = 100;
  const next = () => id(serial++);
  const quality = new TelemetryQuality(identity, storage, transport, Date.now, next);
  const worker = new AnalyticsDelivery(identity, { storage, quality, transport, id: next });
  workers.push(worker);
  return { worker, quality, transport, storage };
}
const pump = () => vi.advanceTimersByTimeAsync(0);
const pendingWaiters = (worker: AnalyticsDelivery): number => Reflect.get(worker, 'waiters').size;
function deferNext(transport: ReturnType<typeof fixture>['transport']) {
  let release!: (status?: number) => void;
  transport.mockImplementationOnce(
    (_path, init) =>
      new Promise<Response>((resolve) => {
        release = (status = 200) =>
          resolve(
            new Response(JSON.stringify(receipt(JSON.parse(init!.body as string))), { status }),
          );
      }),
  );
  return (status?: number) => release(status);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
});
afterEach(() => {
  workers.splice(0).forEach((worker) => worker.retire());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('immutable actor-scoped browser delivery', () => {
  it('removes an acknowledged numeric visit from memory and storage without retry or reload replay', async () => {
    const f = fixture();
    f.worker.visit(id(12), 'home', null);
    expect(f.worker.inspect()).toEqual({ pending: 1, inFlight: 1, sessions: 0 });
    expect(JSON.parse(f.storage.getItem('asa:analytics:v2')!).visits).toHaveLength(1);
    await pump();
    expect(f.transport).toHaveBeenCalledOnce();
    expect(f.transport.mock.calls[0]![0]).toBe('/api/analytics/v2/events');
    expect(f.worker.inspect()).toEqual({ pending: 0, inFlight: 0, sessions: 0 });
    expect(JSON.parse(f.storage.getItem('asa:analytics:v2')!)).toEqual({
      schemaVersion: 2,
      actor,
      sessions: [],
      visits: [],
    });
    expect(f.quality.read().counters).toMatchObject({ acknowledged: 1, retried: 0 });
    f.worker.retryNow();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(f.transport).toHaveBeenCalledOnce();
    f.worker.retire();
    const restored = fixture(f.transport, f.storage);
    restored.worker.retryNow();
    await pump();
    expect(restored.worker.inspect()).toEqual({ pending: 0, inFlight: 0, sessions: 0 });
    expect(f.transport).toHaveBeenCalledOnce();
  });
  it.each(['touch', 'close'] as const)(
    'acknowledges a server microsecond %s receipt and releases its queued operation',
    async (operation) => {
      const f = fixture();
      await f.worker.open(id(10), id(11), 'blocks', id(12));
      f.transport.mockImplementationOnce(async (_path, init) => {
        const body = JSON.parse(init!.body as string) as AnalyticsEnvelope;
        return Response.json({
          ...receipt(body),
          result: {
            creditedSeconds: 29,
            creditedFrom: '2026-10-11T12:00:00.000001Z',
            creditedTo: '2026-10-11T12:00:30Z',
            sessionState: operation === 'close' ? 'closed' : 'open',
          },
        });
      });
      const result = f.worker.touch(id(10), operation === 'close');
      await pump();
      expect(await result).toBe(true);
      expect(f.worker.inspect()).toEqual({
        pending: 0,
        inFlight: 0,
        sessions: operation === 'close' ? 0 : 1,
      });
      expect(pendingWaiters(f.worker)).toBe(0);
      expect(f.quality.read().counters).toMatchObject({ acknowledged: 2, retried: 0 });
    },
  );
  it.each([
    ['touch', 200, 30],
    ['close', 200, 30],
    ['touch', 202, 29],
    ['close', 202, 29],
  ] as const)(
    'retries %s after HTTP%s/credit%s with identical event, actor and body',
    async (operation, status, seconds) => {
      const f = fixture();
      await f.worker.open(id(10), id(11), 'blocks', id(12));
      let retry = false;
      f.transport.mockImplementation(async (_path, init) => {
        const body = JSON.parse(init!.body as string) as AnalyticsEnvelope;
        return Response.json(
          {
            ...receipt(body),
            result: {
              creditedSeconds: retry ? 29 : seconds,
              creditedFrom: '2026-10-11T12:00:00.000001Z',
              creditedTo: '2026-10-11T12:00:30Z',
              sessionState: operation === 'close' ? 'closed' : 'open',
            },
          },
          { status: retry ? 200 : status },
        );
      });
      let settled = false;
      const result = f.worker.touch(id(10), operation === 'close');
      void result.then(() => {
        settled = true;
      });
      await pump();
      const original = f.transport.mock.calls.at(-1)![1]!.body;
      expect(JSON.parse(original as string)).toMatchObject({
        eventId: expect.any(String),
        actorExpectation: actor,
        sessionId: id(10),
        operation,
      });
      expect(settled).toBe(false);
      expect(f.worker.inspect().pending).toBe(1);
      expect(f.quality.read().counters).toMatchObject({ acknowledged: 1, retried: 1 });
      retry = true;
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.transport.mock.calls.at(-1)![1]!.body).toBe(original);
      expect(await result).toBe(true);
      expect(f.worker.inspect().pending).toBe(0);
      expect(pendingWaiters(f.worker)).toBe(0);
      expect(f.quality.read().counters.acknowledged).toBe(2);
    },
  );
  it.each(['start', 'touch', 'close'] as const)(
    'shares one pending %s promise throughout a duplicate storm and releases it on acknowledgement',
    async (operation) => {
      const f = fixture();
      if (operation !== 'start') await f.worker.open(id(10), id(11), 'blocks', id(12));
      const release = deferNext(f.transport);
      const call = () =>
        operation === 'start'
          ? f.worker.open(id(10), id(11), 'blocks', id(12))
          : f.worker.touch(id(10), operation === 'close');
      const result = call();
      for (let n = 0; n < 2000; n++) expect(call()).toBe(result);
      expect(pendingWaiters(f.worker)).toBe(1);
      expect(f.worker.inspect().pending).toBe(1);
      expect(f.quality.read().counters).toMatchObject({
        attempted: operation === 'start' ? 2001 : 2002,
        enqueued: operation === 'start' ? 1 : 2,
        deduplicated: operation === 'touch' ? 0 : 2000,
        coalesced: operation === 'touch' ? 2000 : 0,
      });
      release();
      await pump();
      expect(await result).toBe(true);
      expect(pendingWaiters(f.worker)).toBe(0);
    },
  );
  it('shares pending promises across retries and creates a fresh touch from a result handler', async () => {
    const f = fixture();
    await f.worker.open(id(10), id(11), 'blocks', id(12));
    const fail = deferNext(f.transport);
    const first = f.worker.touch(id(10));
    const original = f.transport.mock.calls.at(-1)![1]!.body;
    fail(503);
    await pump();
    expect(f.worker.touch(id(10))).toBe(first);
    expect(pendingWaiters(f.worker)).toBe(1);
    const release = deferNext(f.transport);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.transport.mock.calls.at(-1)![1]!.body).toBe(original);
    expect(f.worker.touch(id(10))).toBe(first);
    const nextRelease = deferNext(f.transport);
    let next!: Promise<boolean>;
    void first.then((accepted) => {
      expect(accepted).toBe(true);
      expect(pendingWaiters(f.worker)).toBe(0);
      next = f.worker.touch(id(10));
      expect(next).not.toBe(first);
      expect(f.worker.touch(id(10))).toBe(next);
    });
    release();
    await pump();
    expect(await first).toBe(true);
    expect(pendingWaiters(f.worker)).toBe(1);
    expect(JSON.parse(f.transport.mock.calls.at(-1)![1]!.body as string).eventId).not.toBe(
      JSON.parse(original as string).eventId,
    );
    nextRelease();
    await pump();
    expect(await next).toBe(true);
    expect(pendingWaiters(f.worker)).toBe(0);
  });
  it.each([400, 401, 403, 409])(
    'releases shared start and dependent close promises on terminal HTTP%s',
    async (status) => {
      const f = fixture();
      const release = deferNext(f.transport);
      const start = f.worker.open(id(10), id(11), 'blocks', id(12));
      const close = f.worker.touch(id(10), true);
      for (let n = 0; n < 2000; n++) {
        expect(f.worker.open(id(10), id(11), 'blocks', id(12))).toBe(start);
        expect(f.worker.touch(id(10), true)).toBe(close);
      }
      expect(pendingWaiters(f.worker)).toBe(2);
      release(status);
      await pump();
      expect(await start).toBe(false);
      expect(await close).toBe(false);
      expect(pendingWaiters(f.worker)).toBe(0);
      expect(f.worker.inspect().pending).toBe(0);
      expect(f.transport).toHaveBeenCalledOnce();
    },
  );
  it('settles a shared unsent touch on supersession and keeps pending state bounded until retirement', async () => {
    const f = fixture();
    const release = deferNext(f.transport);
    const results: Promise<boolean>[] = [];
    for (let n = 0; n < 32; n++) {
      const session = id(1000 + n);
      const start = f.worker.open(session, id(2000 + n), 'blocks', id(12));
      const touch = f.worker.touch(session);
      for (let repeat = 0; repeat < 100; repeat++) {
        expect(f.worker.open(session, id(2000 + n), 'blocks', id(12))).toBe(start);
        expect(f.worker.touch(session)).toBe(touch);
      }
      const close = f.worker.touch(session, true);
      expect(await touch).toBe(false);
      for (let repeat = 0; repeat < 100; repeat++)
        expect(f.worker.touch(session, true)).toBe(close);
      results.push(start, close);
    }
    for (let n = 0; n < 40; n++) f.worker.visit(id(3000 + n), 'home', null);
    expect(await f.worker.open(id(9999), id(9998), 'blocks', id(12))).toBe(false);
    expect(pendingWaiters(f.worker)).toBe(64);
    expect(f.worker.inspect()).toEqual({ pending: 96, inFlight: 1, sessions: 32 });
    f.worker.retire();
    expect(await Promise.all(results)).toEqual(Array(64).fill(false));
    expect(pendingWaiters(f.worker)).toBe(0);
    const successor = fixture();
    const successorRelease = deferNext(successor.transport);
    const fresh = successor.worker.open(id(10), id(11), 'blocks', id(12));
    release();
    await pump();
    expect(pendingWaiters(successor.worker)).toBe(1);
    expect(successor.quality.read().counters.acknowledged).toBe(0);
    expect(f.quality.read().counters.acknowledged).toBe(0);
    expect(await Promise.all(results)).toEqual(Array(64).fill(false));
    successorRelease();
    await pump();
    expect(await fresh).toBe(true);
    expect(pendingWaiters(successor.worker)).toBe(0);
  });
  it('releases shared queued start and close on TTL and an expired in-flight retry', async () => {
    const f = fixture();
    const release = deferNext(f.transport);
    const inFlight = f.worker.open(id(10), id(11), 'blocks', id(12));
    const queued = f.worker.open(id(20), id(21), 'blocks', id(22));
    const close = f.worker.touch(id(20), true);
    expect(f.worker.open(id(20), id(21), 'blocks', id(22))).toBe(queued);
    expect(f.worker.touch(id(20), true)).toBe(close);
    vi.setSystemTime(Date.now() + 15 * 60_000);
    f.worker.visit(id(30), 'home', null);
    expect(await queued).toBe(false);
    expect(await close).toBe(false);
    expect(pendingWaiters(f.worker)).toBe(1);
    release(503);
    await pump();
    expect(await inFlight).toBe(false);
    expect(pendingWaiters(f.worker)).toBe(0);
    expect(f.quality.read().counters.expired).toBe(3);
  });
  it.each(['touch', 'close'] as const)(
    'releases a shared queued %s at its original TTL',
    async (operation) => {
      const f = fixture();
      await f.worker.open(id(10), id(11), 'blocks', id(12));
      const release = deferNext(f.transport);
      f.worker.visit(id(20), 'home', null);
      const result = f.worker.touch(id(10), operation === 'close');
      expect(f.worker.touch(id(10), operation === 'close')).toBe(result);
      vi.setSystemTime(Date.now() + (operation === 'touch' ? 90_000 : 15 * 60_000));
      f.worker.visit(id(21), 'home', null);
      expect(await result).toBe(false);
      expect(pendingWaiters(f.worker)).toBe(0);
      expect(f.quality.read().counters.expired).toBe(1);
      release();
      await pump();
      expect(pendingWaiters(f.worker)).toBe(0);
    },
  );
  it.each(['read', 'write', 'absent'] as const)(
    'reports %s queue storage failure through healthy quality storage and retains bounded retryable memory',
    async (failure) => {
      const storage = disk();
      const port = {
        ...storage,
        getItem: (key: string) => {
          if (key === 'asa:analytics:v2' && failure === 'read') throw Error('security');
          return storage.getItem(key);
        },
        setItem: (key: string, value: string) => {
          if (key === 'asa:analytics:v2' && failure === 'write') throw Error('quota');
          storage.setItem(key, value);
        },
      };
      let status = 202;
      const transport = vi.fn<typeof fetch>(async (path, init) => {
        const body = JSON.parse(init!.body as string);
        return new Response(
          JSON.stringify(
            String(path).endsWith('/quality')
              ? {
                  accepted: true,
                  state: 'persisted',
                  schemaVersion: 2,
                  eventId: body.eventId,
                  receiptId: body.eventId,
                  operation: 'quality',
                  streamId: body.streamId,
                  sequence: body.sequence,
                  pipeline: body.pipeline,
                  acknowledgementStage: body.acknowledgementStage,
                  receivedAt: new Date().toISOString(),
                  persistedAt: new Date().toISOString(),
                }
              : receipt(body),
          ),
          { status: String(path).endsWith('/quality') ? 200 : status },
        );
      });
      vi.stubGlobal('window', { sessionStorage: port });
      let serial = 100;
      const worker = new AnalyticsDelivery(actor, {
        storage: failure === 'absent' ? undefined : port,
        transport,
        id: () => id(serial++),
      });
      workers.push(worker);
      worker.visit(id(12), 'home', null);
      await pump();
      expect(worker.quality.read()).toMatchObject({
        counters: { storageUnavailable: 1, invalidStored: 0, acknowledged: 0, retried: 1 },
        coverage: { persistenceUnavailable: true, uncleanEnd: true },
      });
      const key = 'asa:quality:v2:product';
      expect(JSON.parse(storage.getItem(key)!).snapshot.coverage.persistenceUnavailable).toBe(true);
      await worker.quality.flush();
      const qualityCall = transport.mock.calls.find(([path]) => String(path).endsWith('/quality'))!;
      expect(qualityCall[0]).toBe('/api/analytics/v2/quality');
      expect(JSON.parse(qualityCall[1]!.body as string)).toMatchObject({
        actorExpectation: actor,
        pipeline: 'product-analytics',
        coverage: { persistenceUnavailable: true, uncleanEnd: true },
        counters: { storageUnavailable: 1, invalidStored: 0 },
      });
      const original = transport.mock.calls[0]![1]!.body;
      status = 200;
      await vi.advanceTimersByTimeAsync(1000);
      expect(
        transport.mock.calls.filter(([path]) => String(path).endsWith('/events'))[1]![1]!.body,
      ).toBe(original);
      expect(worker.quality.read().counters.acknowledged).toBe(1);
      status = 503;
      for (let n = 0; n < 41; n++) worker.visit(id(200 + n), 'home', null);
      await pump();
      expect(worker.inspect().pending).toBe(32);
      expect(worker.quality.read().counters.storageUnavailable).toBe(1);
      expect(worker.quality.read().counters.evicted).toBe(9);
    },
  );
  it.each(['', '{', JSON.stringify({ schemaVersion: 2, actor, visits: [{}], sessions: [] })])(
    'classifies readable corrupt queue data as invalidStored without unavailable coverage',
    (raw) => {
      const storage = disk();
      storage.setItem('asa:analytics:v2', raw);
      const f = fixture(undefined, storage);
      expect(f.quality.read().counters.invalidStored).toBeGreaterThan(0);
      expect(f.quality.read().counters.storageUnavailable).toBe(0);
      expect(f.quality.read().coverage.persistenceUnavailable).toBe(false);
    },
  );
  it.each(['visit', 'start', 'touch', 'close'] as const)(
    'keeps %s pending after a valid receipt with HTTP202, then accepts only HTTP200',
    async (operation) => {
      const f = fixture();
      if (operation === 'touch' || operation === 'close')
        await f.worker.open(id(10), id(11), 'blocks', id(12));
      const previousAcknowledged = f.quality.read().counters.acknowledged;
      f.transport.mockImplementationOnce(
        async (_path, init) =>
          new Response(JSON.stringify(receipt(JSON.parse(init!.body as string))), { status: 202 }),
      );
      let result: Promise<boolean> | undefined;
      if (operation === 'visit') f.worker.visit(id(12), 'home', null);
      else if (operation === 'start') result = f.worker.open(id(10), id(11), 'blocks', id(12));
      else result = f.worker.touch(id(10), operation === 'close');
      await pump();
      const original = f.transport.mock.calls.at(-1)!;
      expect(original[0]).toBe(
        operation === 'visit' ? '/api/analytics/v2/events' : '/api/analytics/v2/module-session',
      );
      expect(f.worker.inspect().pending).toBe(1);
      expect(f.quality.read().counters).toMatchObject({
        acknowledged: previousAcknowledged,
        retried: 1,
        permanentRejected: 0,
      });
      expect(f.quality.read().gauges).toEqual({ pending: 1, inFlight: 0 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.transport.mock.calls.at(-1)![1]!.body).toBe(original[1]!.body);
      if (result) expect(await result).toBe(true);
      expect(f.worker.inspect().pending).toBe(0);
      expect(f.quality.read().counters.acknowledged).toBe(previousAcknowledged + 1);
    },
  );
  it('retries commit-then-lost start and closes its original session after unmount intent', async () => {
    const committed = new Map<string, unknown>();
    let lost = true;
    const transport = vi.fn<typeof fetch>(async (_path, init) => {
      const body = JSON.parse(init!.body as string) as AnalyticsEnvelope;
      if (!committed.has(body.eventId)) committed.set(body.eventId, receipt(body));
      if (lost) {
        lost = false;
        throw Error('lost response');
      }
      return new Response(JSON.stringify(committed.get(body.eventId)), { status: 200 });
    });
    const { worker, quality } = fixture(transport);
    const start = worker.open(id(10), id(11), 'blocks', id(12));
    const close = worker.touch(id(10), true);
    await pump();
    expect(transport).toHaveBeenCalledTimes(1);
    const original = transport.mock.calls[0]![1]!.body;
    await vi.advanceTimersByTimeAsync(1000);
    expect(await start).toBe(true);
    expect(await close).toBe(true);
    expect(transport.mock.calls[1]![1]!.body).toBe(original);
    expect(
      transport.mock.calls.map((call) => JSON.parse(call[1]!.body as string).operation),
    ).toEqual(['start', 'start', 'close']);
    expect(committed.size).toBe(2);
    expect(worker.inspect()).toEqual({ pending: 0, inFlight: 0, sessions: 0 });
    expect(quality.read().counters).toMatchObject({
      attempted: 2,
      enqueued: 2,
      acknowledged: 2,
      retried: 1,
    });
  });
  it('serializes unresolved touch before close; coalesces only a new unsent observation', async () => {
    let release!: (response: Response) => void;
    const base = fixture();
    await base.worker.open(id(10), id(11), 'electronics', id(12));
    base.transport.mockImplementationOnce(
      (_path, init) =>
        new Promise<Response>((resolve) => {
          release = () =>
            resolve(
              new Response(JSON.stringify(receipt(JSON.parse(init!.body as string))), {
                status: 200,
              }),
            );
        }),
    );
    const touch = base.worker.touch(id(10));
    const sameTouch = base.worker.touch(id(10));
    const close = base.worker.touch(id(10), true);
    expect(base.transport).toHaveBeenCalledTimes(2);
    release(new Response());
    await pump();
    expect(await touch).toBe(true);
    expect(await sameTouch).toBe(true);
    expect(await close).toBe(true);
    expect(
      base.transport.mock.calls.map((call) => JSON.parse(call[1]!.body as string).operation),
    ).toEqual(['start', 'touch', 'close']);
    expect(base.quality.read().counters.coalesced).toBe(1);
  });
  it('ordinary reload with explicit close intent replays original IDs and bodies', async () => {
    const storage = disk();
    const first = fixture(
      vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined)),
      storage,
    );
    void first.worker.open(id(10), id(11), 'blocks', id(12));
    void first.worker.touch(id(10), true);
    const saved = JSON.parse(storage.getItem('asa:analytics:v2')!);
    // Simulate process loss without a graceful retire that would intentionally invalidate the binding.
    const second = fixture(undefined, disk());
    second.storage.setItem('asa:analytics:v2', JSON.stringify(saved));
    const resumed = fixture(undefined, second.storage);
    resumed.worker.retryNow();
    await pump();
    expect(resumed.transport.mock.calls.map((call) => JSON.parse(call[1]!.body as string))).toEqual(
      [saved.sessions[0].start, saved.sessions[0].close],
    );
    expect(resumed.quality.read().coverage.uncleanEnd).toBe(true);
  });
  it('unclean reload within90s without close intent never invents a cleanup close or end time', async () => {
    const first = fixture();
    await first.worker.open(id(10), id(11), 'blocks', id(12));
    const persisted = first.storage.getItem('asa:analytics:v2')!;
    await vi.advanceTimersByTimeAsync(10_000);
    const storage = disk();
    storage.setItem('asa:analytics:v2', persisted);
    const resumed = fixture(undefined, storage);
    resumed.worker.retryNow();
    await pump();
    expect(resumed.transport).not.toHaveBeenCalled();
    expect(resumed.worker.inspect().sessions).toBe(0);
    expect(resumed.quality.read().coverage.uncleanEnd).toBe(true);
  });
  it.each(['electronics', 'three-d', 'chess', 'checkers', 'blocks'] as const)(
    'uses session start as the sole new %s launch writer',
    async (moduleKey) => {
      const f = fixture();
      await f.worker.open(id(10), id(11), moduleKey, id(12));
      await f.worker.touch(id(10), true);
      expect(
        f.transport.mock.calls.map((call) => JSON.parse(call[1]!.body as string).operation),
      ).toEqual(['start', 'close']);
      expect(f.transport.mock.calls[0]![0]).toBe('/api/analytics/v2/module-session');
      expect(JSON.stringify(f.transport.mock.calls)).not.toContain('module.opened');
    },
  );
  it.each([null, {}, { accepted: true }, { accepted: true, state: 'queued' }])(
    'never treats malformed start %j as persisted',
    async (response) => {
      const f = fixture(
        vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response), { status: 200 })),
      );
      void f.worker.open(id(10), id(11), 'blocks', id(12));
      await pump();
      expect(f.quality.read().counters.acknowledged).toBe(0);
      expect(f.worker.inspect().pending).toBe(1);
    },
  );
  it.each([400, 401, 403, 409])(
    'terminal HTTP%s never retries or sends dependent touches/close',
    async (status) => {
      const f = fixture(
        vi.fn<typeof fetch>(
          async () =>
            new Response(
              JSON.stringify({
                error: { code: status === 409 ? 'telemetry_conflict' : 'unauthorized' },
              }),
              { status },
            ),
        ),
      );
      const start = f.worker.open(id(10), id(11), 'blocks', id(12));
      const close = f.worker.touch(id(10), true);
      await pump();
      expect(await start).toBe(false);
      expect(await close).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(f.transport).toHaveBeenCalledOnce();
    },
  );
  it('capacity includes in-flight work and repeated observations do not create unbounded touches', async () => {
    const f = fixture(vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined)));
    for (let n = 0; n < 32; n++) {
      void f.worker.open(id(1000 + n), id(2000 + n), 'blocks', id(12));
      void f.worker.touch(id(1000 + n));
      void f.worker.touch(id(1000 + n), true);
    }
    for (let n = 0; n < 40; n++) f.worker.visit(id(3000 + n), 'home', null);
    expect(f.worker.inspect().pending).toBeLessThanOrEqual(128);
    expect(f.worker.inspect().inFlight).toBe(1);
    expect(await f.worker.open(id(9999), id(9998), 'blocks', id(12))).toBe(false);
    expect(f.quality.read().counters.evicted).toBe(9);
    expect(f.storage.getItem('asa:analytics:v2')!.length).toBeLessThan(100_000);
  });
  it('does not retag or acknowledge an old in-flight response after actor retirement', async () => {
    let release!: (response: Response) => void;
    let body!: AnalyticsEnvelope;
    const f = fixture(
      vi.fn<typeof fetch>(async (_path, init) => {
        body = JSON.parse(init!.body as string);
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }),
    );
    const start = f.worker.open(id(10), id(11), 'blocks', id(12));
    f.worker.retire();
    expect(await start).toBe(false);
    const successor = fixture(undefined, f.storage, {
      kind: 'student',
      seatId: id(1),
      classId: id(2),
    });
    await successor.worker.open(id(20), id(21), 'blocks', id(22));
    release(new Response(JSON.stringify(receipt(body)), { status: 200 }));
    await pump();
    expect(successor.quality.read().counters.acknowledged).toBe(1);
    expect(JSON.parse(successor.storage.getItem('asa:analytics:v2')!).actor).toEqual({
      kind: 'student',
      seatId: id(1),
      classId: id(2),
    });
    expect(f.quality.read().counters.acknowledged).toBe(0);
  });
  it('expires an old immutable touch instead of refreshing its client time', async () => {
    const f = fixture();
    await f.worker.open(id(10), id(11), 'blocks', id(12));
    f.transport.mockImplementation(async () => new Response('{}', { status: 503 }));
    const touch = f.worker.touch(id(10));
    await pump();
    const first = f.transport.mock.calls[1]![1]!.body;
    await vi.advanceTimersByTimeAsync(91_000);
    expect(await touch).toBe(false);
    for (const call of f.transport.mock.calls.slice(1)) expect(call[1]!.body).toBe(first);
    expect(f.quality.read().counters.expired).toBe(1);
  });
  it.each([
    '{',
    'x'.repeat(100_001),
    JSON.stringify({ schemaVersion: 2, actor, visits: [{ password: 'secret' }], sessions: [] }),
  ])(
    'rejects corrupt/unbounded/untrusted stored input without replaying secrets',
    async (saved) => {
      const storage = disk();
      storage.setItem('asa:analytics:v2', saved);
      const f = fixture(undefined, storage);
      f.worker.retryNow();
      await pump();
      expect(f.transport).not.toHaveBeenCalled();
      expect(f.quality.read().counters.invalidStored).toBeGreaterThan(0);
      expect(storage.getItem('asa:analytics:v2')).not.toContain('secret');
    },
  );
});
