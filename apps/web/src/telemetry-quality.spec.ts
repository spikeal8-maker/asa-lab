import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelemetryQuality, validQuality, type QualitySnapshot } from './telemetry-quality';
import { COUNTERS } from './telemetry-contract';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { kind: 'account' as const, accountId: id(1), workspaceId: id(2) };
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
}
function acknowledgement(body: QualitySnapshot) {
  return {
    accepted: true,
    state: body.pipeline === 'product-analytics' ? 'persisted' : 'intake_acknowledged',
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
  };
}
const ledgers: TelemetryQuality[] = [];
function fixture(
  identity: typeof actor | undefined = actor,
  disk = storage(),
  fetch = vi.fn<typeof globalThis.fetch>(async (_path, init) => {
    return new Response(JSON.stringify(acknowledgement(JSON.parse(init!.body as string))), {
      status: identity ? 200 : 202,
    });
  }),
  serial = 100,
) {
  const ledger = new TelemetryQuality(identity, disk, fetch, Date.now, () => id(serial++));
  ledgers.push(ledger);
  return { ledger, disk, fetch };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
});

describe('OBS007 quality after BFCache', () => {
  it.each(['product', 'diagnostics'] as const)(
    'clears mutable final while paused and preserves the exact pending %s body',
    async (pipeline) => {
      const identity = pipeline === 'product' ? actor : undefined;
      const transport = vi.fn<typeof fetch>(async (_path, init) => {
        const body = JSON.parse(init!.body as string) as QualitySnapshot;
        return new Response(JSON.stringify(acknowledgement(body)), {
          status: identity ? 200 : 202,
        });
      });
      transport.mockResolvedValueOnce(new Response('{}', { status: 503 }));
      // fixture's default actor is deliberately bypassed for the anonymous pipeline.
      const ledger = new TelemetryQuality(identity, storage(), transport, Date.now, () =>
        id(1000 + transport.mock.calls.length),
      );
      ledgers.push(ledger);
      await ledger.flush(true);
      const frozen = transport.mock.calls[0]![1]!.body;
      ledger.pause();
      ledger.resumeAfterPageShow();
      expect(ledger.read().coverage.final).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(transport).toHaveBeenCalledTimes(1);
      ledger.start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(transport.mock.calls[1]![1]!.body).toBe(frozen);
      await vi.advanceTimersByTimeAsync(1000);
      const next = JSON.parse(transport.mock.calls[2]![1]!.body as string);
      expect(next).toMatchObject({
        streamId: JSON.parse(frozen as string).streamId,
        sequence: 2,
        coverage: { final: false },
      });
      expect(next.eventId).not.toBe(JSON.parse(frozen as string).eventId);
    },
  );

  it.each(['product', 'diagnostics'] as const)(
    'allows a late final %s ACK followed by an honest resumed sequence',
    async (pipeline) => {
      const identity = pipeline === 'product' ? actor : undefined;
      let complete!: (response: Response) => void;
      const transport = vi.fn<typeof fetch>(
        async (_path, init) =>
          new Response(JSON.stringify(acknowledgement(JSON.parse(init!.body as string))), {
            status: identity ? 200 : 202,
          }),
      );
      transport.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      let serial = 2000;
      const ledger = new TelemetryQuality(identity, storage(), transport, Date.now, () =>
        id(serial++),
      );
      ledgers.push(ledger);
      const final = ledger.flush(true);
      const original = JSON.parse(transport.mock.calls[0]![1]!.body as string);
      ledger.resumeAfterPageShow();
      expect(ledger.read().coverage.final).toBe(false);
      expect(transport).toHaveBeenCalledTimes(1);
      complete(
        new Response(JSON.stringify(acknowledgement(original)), { status: identity ? 200 : 202 }),
      );
      await final;
      await vi.advanceTimersByTimeAsync(1000);
      expect(JSON.parse(transport.mock.calls[1]![1]!.body as string)).toMatchObject({
        streamId: original.streamId,
        sequence: 2,
        coverage: { final: false },
      });
    },
  );

  it.each(['rejected', 'retired'] as const)('never revives a %s stream', async (reason) => {
    const f = fixture();
    if (reason === 'rejected') {
      f.fetch.mockResolvedValueOnce(new Response('{}', { status: 401 }));
      await f.ledger.flush(true);
    } else f.ledger.retire();
    const original = f.ledger.read();
    const calls = f.fetch.mock.calls.length;
    f.ledger.resumeAfterPageShow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.ledger.read()).toEqual(original);
    expect(f.fetch).toHaveBeenCalledTimes(calls);
  });
});
afterEach(() => {
  ledgers.splice(0).forEach((ledger) => ledger.retire());
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe('independent truthful cumulative quality', () => {
  it('normalizes historical queue failures after reload without changing the frozen pending snapshot', async () => {
    const f = fixture(
      actor,
      storage(),
      vi.fn<typeof fetch>(async () => new Response('{}', { status: 503 })),
    );
    await f.ledger.flush();
    const original = f.fetch.mock.calls[0]![1]!.body;
    const key = 'asa:quality:v2:product';
    const saved = JSON.parse(f.disk.getItem(key)!);
    saved.snapshot.counters.storageUnavailable = 7;
    saved.snapshot.coverage.persistenceUnavailable = false;
    saved.snapshot.coverage.uncleanEnd = false;
    saved.inProgress = false;
    f.disk.setItem(key, JSON.stringify(saved));
    const resumed = fixture(actor, f.disk, undefined, 500);
    expect(resumed.ledger.read()).toMatchObject({
      counters: { storageUnavailable: 7 },
      coverage: { persistenceUnavailable: true, uncleanEnd: true },
    });
    await resumed.ledger.flush();
    expect(resumed.fetch.mock.calls[0]![1]!.body).toBe(original);
    await vi.advanceTimersByTimeAsync(1000);
    const next = JSON.parse(resumed.fetch.mock.calls[1]![1]!.body as string);
    expect(next).toMatchObject({
      sequence: 2,
      counters: { storageUnavailable: 7 },
      coverage: { persistenceUnavailable: true, uncleanEnd: true },
    });
    expect(next.eventId).not.toBe(JSON.parse(original as string).eventId);
  });
  it.each(['ledger', 'queue'] as const)(
    'reports a %s failure after freezing a pending body in the next snapshot without a reporting loop',
    async (failure) => {
      const f = fixture();
      if (failure === 'ledger')
        f.disk.setItem = () => {
          throw Error('quota');
        };
      f.fetch.mockResolvedValueOnce(new Response('{}', { status: 503 }));
      await f.ledger.flush();
      if (failure === 'queue') f.ledger.markPersistenceUnavailable();
      const original = f.fetch.mock.calls[0]![1]!.body;
      expect(JSON.parse(original as string).coverage.persistenceUnavailable).toBe(false);
      expect(f.ledger.read()).toMatchObject({
        counters: { storageUnavailable: 1 },
        coverage: { persistenceUnavailable: true, uncleanEnd: true },
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.fetch.mock.calls[1]![1]!.body).toBe(original);
      await vi.advanceTimersByTimeAsync(1000);
      expect(JSON.parse(f.fetch.mock.calls[2]![1]!.body as string)).toMatchObject({
        sequence: 2,
        counters: { storageUnavailable: 1 },
        coverage: { persistenceUnavailable: true },
      });
      await vi.advanceTimersByTimeAsync(5000);
      expect(f.fetch).toHaveBeenCalledTimes(3);
    },
  );
  it('classifies a quality read failure as unavailable and persists its evidence through a healthy write', () => {
    const disk = storage();
    disk.getItem = () => {
      throw Error('security');
    };
    const f = fixture(actor, disk);
    expect(f.ledger.read()).toMatchObject({
      counters: { storageUnavailable: 1, invalidStored: 0 },
      coverage: { persistenceUnavailable: true, uncleanEnd: true },
    });
    expect(
      JSON.parse(disk.values.get('asa:quality:v2:product')!).snapshot.coverage
        .persistenceUnavailable,
    ).toBe(true);
  });
  it('saturates the first availability transition and does not repeatedly persist its own failure', () => {
    const f = fixture();
    f.ledger.increment('storageUnavailable', Number.MAX_SAFE_INTEGER);
    const writes = vi.spyOn(f.disk, 'setItem').mockImplementation(() => {
      throw Error('quota');
    });
    f.ledger.markPersistenceUnavailable();
    f.ledger.markPersistenceUnavailable();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(f.ledger.read()).toMatchObject({
      counters: { storageUnavailable: Number.MAX_SAFE_INTEGER },
      coverage: { persistenceUnavailable: true, uncleanEnd: true, counterSaturated: true },
    });
  });
  it.each([true, false])(
    'keeps the exact quality snapshot on a wrong successful status (protected=%s)',
    async (protectedPipeline) => {
      const identity = protectedPipeline ? actor : undefined;
      const disk = storage();
      const transport = vi.fn<typeof fetch>(
        async (_path, init) =>
          new Response(JSON.stringify(acknowledgement(JSON.parse(init!.body as string))), {
            status: protectedPipeline ? 202 : 200,
          }),
      );
      let serial = 100;
      const ledger = new TelemetryQuality(identity, disk, transport, Date.now, () => id(serial++));
      ledgers.push(ledger);
      ledger.increment('attempted');
      await ledger.flush();
      const key = `asa:quality:v2:${protectedPipeline ? 'product' : 'diagnostics'}`;
      const original = transport.mock.calls[0]![1]!.body;
      expect(transport.mock.calls[0]![0]).toBe(
        protectedPipeline ? '/api/analytics/v2/quality' : '/api/diagnostics/quality',
      );
      expect(JSON.parse(disk.getItem(key)!).pending).toEqual(JSON.parse(original as string));
      ledger.increment('attempted');
      transport.mockImplementation(
        async (_path, init) =>
          new Response(JSON.stringify(acknowledgement(JSON.parse(init!.body as string))), {
            status: protectedPipeline ? 200 : 202,
          }),
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(transport.mock.calls[1]![1]!.body).toBe(original);
      expect(JSON.parse(disk.getItem(key)!).pending).toBeNull();
      await vi.advanceTimersByTimeAsync(1000);
      const next = JSON.parse(transport.mock.calls[2]![1]!.body as string);
      expect(next.sequence).toBe(2);
      expect(next.eventId).not.toBe(JSON.parse(original as string).eventId);
      expect(next.counters.attempted).toBe(2);
      expect(ledger.read().counters).toMatchObject({
        acknowledged: 0,
        retried: 0,
        permanentRejected: 0,
      });
    },
  );
  it('retries the exact snapshot while concurrent increments remain for the next sequence', async () => {
    const f = fixture();
    let first = true;
    f.fetch.mockImplementation(async (_path, init) => {
      if (first) {
        first = false;
        throw Error('lost ack after save');
      }
      return new Response(JSON.stringify(acknowledgement(JSON.parse(init!.body as string))), {
        status: 200,
      });
    });
    f.ledger.increment('attempted');
    await f.ledger.flush();
    const original = f.fetch.mock.calls[0]![1]!.body;
    f.ledger.increment('attempted', 2);
    f.ledger.increment('evicted');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.fetch.mock.calls[1]![1]!.body).toBe(original);
    await vi.advanceTimersByTimeAsync(1000);
    const next = JSON.parse(f.fetch.mock.calls[2]![1]!.body as string);
    expect(next).toMatchObject({ sequence: 2, counters: { attempted: 3, evicted: 1 } });
    expect(next.eventId).not.toBe(JSON.parse(original as string).eventId);
    expect(f.ledger.read().counters.retried).toBe(0); // Quality's own transport cannot recursively count itself.
  });
  it('validates the exact stream/sequence/stage and does not treat wrong acknowledgements as delivered', async () => {
    const f = fixture();
    f.fetch.mockImplementation(async (_path, init) => {
      const body = JSON.parse(init!.body as string);
      return new Response(
        JSON.stringify({ ...acknowledgement(body), sequence: body.sequence + 1 }),
        { status: 200 },
      );
    });
    await f.ledger.flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.fetch.mock.calls[1]![1]!.body).toBe(f.fetch.mock.calls[0]![1]!.body);
    expect(f.ledger.read().counters.acknowledged).toBe(0);
  });
  it('anonymous diagnostics quality carries no actor and acknowledges only intake', async () => {
    const disk = storage();
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_path, init) =>
        new Response(JSON.stringify(acknowledgement(JSON.parse(init!.body as string))), {
          status: 202,
        }),
    );
    const ledger = new TelemetryQuality(undefined, disk, fetch);
    ledgers.push(ledger);
    ledger.increment('acknowledged', 3);
    await ledger.flush();
    expect(fetch.mock.calls[0]![0]).toBe('/api/diagnostics/quality');
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({
      pipeline: 'client-diagnostics',
      acknowledgementStage: 'intake_acknowledged',
      counters: { acknowledged: 3 },
    });
    expect(body).not.toHaveProperty('actorExpectation');
    expect(validQuality(body)).toBe(true);
  });
  it('recovers immutable pending snapshot on reload and records unclean termination', async () => {
    const f = fixture(
      undefined,
      storage(),
      vi.fn<typeof fetch>(async () => {
        throw Error('offline');
      }),
    );
    f.ledger.increment('expired');
    await f.ledger.flush();
    const pending = f.fetch.mock.calls[0]![1]!.body;
    // This fixture uses the explicit protected actor default; recover the same binding.
    const resumed = fixture(actor, f.disk);
    await resumed.ledger.flush();
    expect(resumed.fetch.mock.calls[0]![1]!.body).toBe(pending);
    expect(resumed.ledger.read().coverage.uncleanEnd).toBe(true);
  });
  it('refuses a pending snapshot with a different actor or unknown fields', () => {
    const f = fixture();
    const key = 'asa:quality:v2:product';
    const saved = JSON.parse(f.disk.getItem(key)!);
    saved.pending = {
      ...saved.snapshot,
      actorExpectation: { ...actor, workspaceId: id(9) },
      password: 'secret',
    };
    f.disk.setItem(key, JSON.stringify(saved));
    const resumed = fixture(actor, f.disk);
    expect(resumed.ledger.read().counters.invalidStored).toBe(1);
    expect(JSON.stringify(resumed.ledger.read())).not.toContain('secret');
  });
  it('records storage unavailable once without recursive persistence; counters saturate explicitly', () => {
    const broken = {
      getItem: () => {
        throw Error('denied');
      },
      setItem: () => {
        throw Error('quota');
      },
    };
    const ledger = new TelemetryQuality(actor, broken);
    ledgers.push(ledger);
    for (const counter of COUNTERS) ledger.increment(counter);
    ledger.increment('attempted', Number.MAX_SAFE_INTEGER);
    expect(ledger.read().coverage).toMatchObject({
      persistenceUnavailable: true,
      uncleanEnd: true,
      counterSaturated: true,
    });
    expect(ledger.read().counters.storageUnavailable).toBe(2); // One availability transition plus the explicit fixture increment.
    expect(ledger.read().counters.attempted).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('quality failure neither marks event delivery nor produces recursive counters, and retired streams are bounded', async () => {
    const disk = storage();
    for (let n = 0; n < 7; n++) {
      const f = fixture(
        actor,
        disk,
        vi.fn<typeof fetch>(async () => new Response('{}', { status: 503 })),
      );
      await f.ledger.flush();
      f.ledger.retire();
    }
    const retired = JSON.parse(disk.getItem('asa:quality:v2:product:retired')!);
    expect(retired).toHaveLength(4);
    expect(
      retired.every(
        (snapshot: QualitySnapshot) =>
          snapshot.counters.retried === 0 && snapshot.coverage.uncleanEnd,
      ),
    ).toBe(true);
  });
});
