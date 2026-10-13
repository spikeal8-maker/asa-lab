// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actor = {
  kind: 'account' as const,
  accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};
const project = '11111111-1111-4111-8111-111111111111';
const events = '/api/analytics/v2/events';
const sessions = '/api/analytics/v2/module-session';
const quality = '/api/analytics/v2/quality';
let context: typeof import('./telemetry-context');
let runtime: typeof import('./analytics-runtime');
let sessionFetch: typeof import('./session-fetch');
let lifecycle: typeof import('./activity-lifecycle');
let transport: ReturnType<typeof vi.fn<typeof fetch>>;
let denied: Map<string, number>;
let refreshStatus: number;
let retryStatus: number;
let proof: () => Promise<Response>;
let refresh: () => Promise<Response>;
const trackers: ReturnType<typeof import('./activity-lifecycle').trackInputActivity>[] = [];

function me(identity = actor): Response {
  return Response.json({
    authenticated: true,
    account: { id: identity.accountId },
    activeWorkspace: { workspaceId: identity.workspaceId },
  });
}
function ack(body: Record<string, unknown>): Response {
  return Response.json({
    accepted: true,
    state: 'persisted',
    schemaVersion: 2,
    eventId: body.eventId,
    receiptId: body.eventId,
    operation: body.operation ?? body.eventType ?? 'quality',
    receivedAt: new Date().toISOString(),
    persistedAt: new Date().toISOString(),
    ...(body.operation
      ? {
          sessionId: body.sessionId,
          result: {
            creditedSeconds: 0,
            creditedFrom: null,
            creditedTo: null,
            sessionState: body.operation === 'close' ? 'closed' : 'open',
          },
        }
      : body.pipeline
        ? {
            streamId: body.streamId,
            sequence: body.sequence,
            pipeline: body.pipeline,
            acknowledgementStage: body.acknowledgementStage,
          }
        : { recordId: project }),
  });
}
const count = (path: string) => transport.mock.calls.filter(([url]) => url === path).length;
const bodies = (path: string) =>
  transport.mock.calls
    .filter(([url]) => url === path)
    .map(([, init]) => JSON.parse(init!.body as string));
const drain = () => vi.advanceTimersByTimeAsync(0);
function activity() {
  const tracker = lifecycle.trackInputActivity(
    project,
    runtime.analyticsSessionTransport(actor, 'electronics'),
  );
  tracker.setReady(true);
  trackers.push(tracker);
  return tracker;
}
async function stopAtVisit(status = 401) {
  denied.set(events, status);
  context.setTelemetryContext(actor, true, 'editor.electronics');
  await drain();
  denied.delete(events);
}
async function product(path = '/api/projects') {
  const result = await sessionFetch.fetchWithSessionRefresh(path);
  await drain();
  return result;
}
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  sessionStorage.clear();
  denied = new Map();
  refreshStatus = 200;
  retryStatus = 200;
  proof = async () => me();
  refresh = async () => new Response(null, { status: refreshStatus });
  const products = new Map<string, number>();
  transport = vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url);
    if (path === '/api/auth/refresh') return refresh();
    if (path === '/api/auth/me') return proof();
    if (path.startsWith('/api/projects')) {
      const attempt = products.get(path) ?? 0;
      products.set(path, attempt + 1);
      return new Response(null, { status: attempt === 0 ? 401 : retryStatus });
    }
    if (denied.has(path))
      return Response.json({ error: { code: 'context_mismatch' } }, { status: denied.get(path)! });
    return ack(JSON.parse(init!.body as string));
  });
  vi.stubGlobal('fetch', transport);
  context = await import('./telemetry-context');
  runtime = await import('./analytics-runtime');
  sessionFetch = await import('./session-fetch');
  lifecycle = await import('./activity-lifecycle');
});
afterEach(() => {
  trackers.splice(0).forEach((tracker) => tracker.dispose());
  context.setTelemetryContext(null, true, 'public');
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('OBS-002 independently confirmed product auth recovery', () => {
  it.each([events, quality])(
    'rejects an expired product observation before deferred timers run: %s',
    async (path) => {
      const send = transport.getMockImplementation()!;
      let finish!: (response: Response) => void;
      transport.mockImplementation((url, init) =>
        String(url) === path && count(path) === 1
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : send(url, init),
      );
      context.setTelemetryContext(actor, true, 'editor.electronics');
      await vi.advanceTimersByTimeAsync(path === quality ? 1000 : 0);
      await product();
      const generation = context.telemetryContext().generation;
      vi.setSystemTime(Date.now() + 12_001);
      finish(new Response(null, { status: 401 }));
      await drain();
      expect(count('/api/auth/me')).toBe(0);
      expect(context.telemetryContext().generation).toBe(generation);
    },
  );

  it('rejects expired proof completion before deferred timers run', async () => {
    await stopAtVisit();
    let finish!: (response: Response) => void;
    proof = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    expect((await product()).status).toBe(200);
    const generation = context.telemetryContext().generation;
    vi.setSystemTime(Date.now() + 12_001);
    finish(me());
    await drain();
    expect(context.telemetryContext().generation).toBe(generation);
    expect(
      (transport.mock.calls.find(([url]) => url === '/api/auth/me')?.[1]?.signal as AbortSignal)
        .aborted,
    ).toBe(true);
  });

  it('rejects continued proof body after its deadline before deferred timers run', async () => {
    await stopAtVisit();
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    proof = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            body = controller;
          },
          cancel,
        }),
      );
    expect((await product()).status).toBe(200);
    const generation = context.telemetryContext().generation;
    vi.setSystemTime(Date.now() + 12_001);
    body.enqueue(
      new TextEncoder().encode(
        JSON.stringify({
          authenticated: true,
          account: { id: actor.accountId },
          activeWorkspace: { workspaceId: actor.workspaceId },
        }),
      ),
    );
    await drain();
    expect(context.telemetryContext().generation).toBe(generation);
    expect(cancel).toHaveBeenCalledOnce();
    expect(
      (transport.mock.calls.find(([url]) => url === '/api/auth/me')?.[1]?.signal as AbortSignal)
        .aborted,
    ).toBe(true);
  });
  it.each([events, quality])(
    'recovers late old-cookie401 from %s after product refresh already succeeded',
    async (path) => {
      const send = transport.getMockImplementation()!;
      let finish!: (response: Response) => void;
      transport.mockImplementation((url, init) =>
        String(url) === path && count(path) === 1
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : send(url, init),
      );
      context.setTelemetryContext(actor, true, 'editor.electronics');
      await vi.advanceTimersByTimeAsync(path === quality ? 1000 : 0);
      const generation = context.telemetryContext().generation;
      expect((await product()).status).toBe(200);
      expect(count('/api/auth/me')).toBe(0);
      finish(new Response(null, { status: 401 }));
      await drain();
      expect(count('/api/auth/me')).toBe(1);
      expect(context.telemetryContext().generation).toBe(generation + 1);
      const tracker = activity();
      tracker.input();
      await drain();
      expect(bodies(sessions).map((body) => body.operation)).toEqual(['start']);
      expect(count(events)).toBe(1);
    },
  );
  it('recovers a retired visit delivery for future real input with fresh IDs and no fabricated visit', async () => {
    await stopAtVisit();
    const tracker = activity();
    tracker.input();
    await drain();
    const generation = context.telemetryContext().generation;
    expect(count('/api/auth/refresh')).toBe(0);
    expect(count('/api/auth/me')).toBe(0);
    expect((await product()).status).toBe(200);
    expect(context.telemetryContext().generation).toBe(generation + 1);
    expect(count(sessions)).toBe(0);
    tracker.input();
    await drain();
    expect(bodies(sessions).map((body) => body.operation)).toEqual(['start']);
    expect(bodies(sessions)[0].visitId).toBe(bodies(events)[0].visitId);
    expect(count(events)).toBe(1);
    expect(count('/api/auth/me')).toBe(1);
    expect(transport.mock.calls.find(([url]) => url === '/api/auth/me')?.[1]).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
    });
  });

  it('detaches an accepted active period after quality-only401 and creates a new quality stream', async () => {
    context.setTelemetryContext(actor, true, 'editor.electronics');
    await drain();
    const tracker = activity();
    tracker.input();
    await drain();
    const original = bodies(sessions)[0];
    denied.set(quality, 401);
    await vi.advanceTimersByTimeAsync(1000);
    const rejected = bodies(quality)[0];
    denied.delete(quality);
    const generation = context.telemetryContext().generation;
    await product();
    expect(context.telemetryContext().generation).toBe(generation + 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(bodies(sessions)).toHaveLength(1);
    tracker.input();
    await drain();
    const next = bodies(sessions)[1];
    expect(next).toMatchObject({
      operation: 'start',
      visitId: original.visitId,
      actorExpectation: actor,
    });
    expect(next.sessionId).not.toBe(original.sessionId);
    expect(next.eventId).not.toBe(original.eventId);
    expect(bodies(quality).at(-1).streamId).not.toBe(rejected.streamId);
    expect(bodies(quality).at(-1).eventId).not.toBe(rejected.eventId);
    expect(count(events)).toBe(1);
    tracker.dispose();
    await drain();
    expect(bodies(sessions).map((body) => [body.operation, body.sessionId])).toEqual([
      ['start', original.sessionId],
      ['start', next.sessionId],
      ['close', next.sessionId],
    ]);
  });

  it('never forwards old accepted session touch/close to its successor', async () => {
    context.setTelemetryContext(actor, true, 'editor.electronics');
    await drain();
    const api = runtime.analyticsSessionTransport(actor, 'electronics');
    expect(await api.start(project, project)).toBe(true);
    denied.set(sessions, 401);
    expect(await api.touch(project, false)).toBe(false);
    const terminal = bodies(sessions)[1];
    denied.delete(sessions);
    await product();
    expect(await api.touch(project, false)).toBe(false);
    api.closeIntent(project);
    await drain();
    expect(bodies(sessions)).toHaveLength(2);
    const fresh = '22222222-2222-4222-8222-222222222222';
    expect(await api.start(fresh, project)).toBe(true);
    expect(bodies(sessions).at(-1).eventId).not.toBe(terminal.eventId);
  });

  it('requires input after recovery even when the old accepted tracker was still active', async () => {
    context.setTelemetryContext(actor, true, 'editor.electronics');
    await drain();
    const tracker = lifecycle.trackInputActivity(
      project,
      runtime.analyticsSessionTransport(actor, 'electronics'),
      120_000,
    );
    trackers.push(tracker);
    tracker.setReady(true);
    tracker.input();
    await drain();
    const original = bodies(sessions)[0];
    denied.set(quality, 401);
    await vi.advanceTimersByTimeAsync(1000);
    denied.delete(quality);
    await product();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(bodies(sessions)).toHaveLength(1);
    tracker.input();
    await drain();
    expect(bodies(sessions).map((body) => body.operation)).toEqual(['start', 'start']);
    expect(bodies(sessions)[1].sessionId).not.toBe(original.sessionId);
  });

  it('fences old pending start responses and never closes their period in the successor', async () => {
    context.setTelemetryContext(actor, true, 'editor.electronics');
    await drain();
    const send = transport.getMockImplementation()!;
    let finish!: (response: Response) => void;
    transport.mockImplementation((url, init) =>
      String(url) === sessions && count(sessions) === 1
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : send(url, init),
    );
    const tracker = activity();
    tracker.input();
    await drain();
    const original = bodies(sessions)[0];
    denied.set(quality, 401);
    await vi.advanceTimersByTimeAsync(1000);
    denied.delete(quality);
    await product();
    tracker.input();
    await drain();
    finish(ack(original));
    await drain();
    expect(bodies(sessions).map((body) => body.operation)).toEqual(['start', 'start']);
    tracker.dispose();
    await drain();
    expect(bodies(sessions).at(-1).sessionId).not.toBe(original.sessionId);
  });

  it('releases ownership over repeated renewals instead of filling the 32-session owner bound', async () => {
    context.setTelemetryContext(actor, true, 'editor.electronics');
    await drain();
    const api = runtime.analyticsSessionTransport(actor, 'electronics');
    for (let i = 0; i < 34; i++) {
      const id = `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`;
      expect(await api.start(id, project)).toBe(true);
      denied.set(sessions, 401);
      expect(await api.touch(id, false)).toBe(false);
      denied.delete(sessions);
      await product(`/api/projects/renew-${i}`);
      expect(await api.touch(id, true)).toBe(false);
    }
    expect(await api.start(project, project)).toBe(true);
    expect(count(events)).toBe(1);
    expect(count('/api/auth/me')).toBe(34);
  });

  it.each([400, 403, 409])(
    'does not revive non-auth terminal quality rejection %s',
    async (status) => {
      context.setTelemetryContext(actor, true, 'home');
      denied.set(quality, status);
      await vi.advanceTimersByTimeAsync(1000);
      const generation = context.telemetryContext().generation;
      await product();
      expect(context.telemetryContext().generation).toBe(generation);
      expect(count('/api/auth/me')).toBe(0);
      expect(count(quality)).toBe(1);
    },
  );
  it('does not revive a context-conflicted delivery', async () => {
    await stopAtVisit(409);
    const generation = context.telemetryContext().generation;
    await product();
    activity().input();
    await drain();
    expect(context.telemetryContext().generation).toBe(generation);
    expect(count('/api/auth/me')).toBe(0);
    expect(count(sessions)).toBe(0);
  });
  it.each(['anonymous', 'unready', 'seat'] as const)(
    'does not prove or recover a %s binding from an Account product refresh',
    async (kind) => {
      await stopAtVisit();
      if (kind === 'anonymous') context.setTelemetryContext(null, true, 'public');
      else if (kind === 'unready') context.setTelemetryContext(actor, false, 'home');
      else {
        denied.set(events, 401);
        context.setTelemetryContext(
          { kind: 'student', seatId: actor.accountId, classId: actor.workspaceId },
          true,
          'classes',
        );
        await drain();
      }
      const generation = context.telemetryContext().generation;
      expect((await product()).status).toBe(200);
      expect(count('/api/auth/me')).toBe(0);
      expect(context.telemetryContext().generation).toBe(generation);
    },
  );
  it('leaves healthy delivery, visit and stream unchanged without an extra identity request', async () => {
    context.setTelemetryContext(actor, true, 'home');
    await vi.advanceTimersByTimeAsync(1000);
    const generation = context.telemetryContext().generation;
    const stream = bodies(quality)[0].streamId;
    await product();
    expect(context.telemetryContext().generation).toBe(generation);
    expect(count('/api/auth/me')).toBe(0);
    expect(count(events)).toBe(1);
    expect(bodies(quality).every((body) => body.streamId === stream)).toBe(true);
  });
  it('expires a saved healthy product observation before a later unrelated401', async () => {
    context.setTelemetryContext(actor, true, 'editor.electronics');
    await drain();
    const api = runtime.analyticsSessionTransport(actor, 'electronics');
    expect(await api.start(project, project)).toBe(true);
    await product();
    const generation = context.telemetryContext().generation;
    await vi.advanceTimersByTimeAsync(12_001);
    denied.set(sessions, 401);
    expect(await api.touch(project, false)).toBe(false);
    await drain();
    expect(count('/api/auth/me')).toBe(0);
    expect(context.telemetryContext().generation).toBe(generation);
  });
  it.each(['refresh', 'retry'] as const)(
    'does not prove or recover after failed %s',
    async (phase) => {
      await stopAtVisit();
      if (phase === 'refresh') refreshStatus = 503;
      else retryStatus = 403;
      const generation = context.telemetryContext().generation;
      expect((await product()).ok).toBe(false);
      expect(context.telemetryContext().generation).toBe(generation);
      expect(count('/api/auth/me')).toBe(0);
    },
  );
  it.each(['person', 'workspace', 'anonymous', 'denied', 'malformed', 'oversized'] as const)(
    'keeps product success but rejects fresh identity proof: %s',
    async (kind) => {
      await stopAtVisit();
      proof = async () =>
        kind === 'person'
          ? me({ ...actor, accountId: project })
          : kind === 'workspace'
            ? me({ ...actor, workspaceId: project })
            : kind === 'anonymous'
              ? Response.json({ authenticated: false })
              : kind === 'denied'
                ? new Response(null, { status: 401 })
                : kind === 'oversized'
                  ? new Response(' '.repeat(70_000))
                  : Response.json({ authenticated: true, account: { id: 42 } });
      const generation = context.telemetryContext().generation;
      expect((await product()).status).toBe(200);
      expect(count('/api/auth/me')).toBe(1);
      expect(context.telemetryContext().generation).toBe(generation);
      expect(count('/api/auth/refresh')).toBe(1);
      activity().input();
      await drain();
      expect(count(sessions)).toBe(0);
    },
  );
  it.each(['unready', 'logout', 'scope', 'person'] as const)(
    'ignores a late matching proof after %s',
    async (change) => {
      await stopAtVisit();
      let finish!: (response: Response) => void;
      proof = () =>
        new Promise((resolve) => {
          finish = resolve;
        });
      expect((await product()).status).toBe(200);
      if (change === 'logout') sessionFetch.notifySessionLoggedOut();
      else if (change === 'unready') context.setTelemetryContext(actor, false, 'home');
      else
        context.setTelemetryContext(
          { ...actor, [change === 'scope' ? 'workspaceId' : 'accountId']: project },
          true,
          'home',
        );
      const generation = context.telemetryContext().generation;
      finish(me());
      await drain();
      expect(context.telemetryContext().generation).toBe(generation);
      expect(count(events)).toBe(change === 'scope' || change === 'person' ? 2 : 1);
    },
  );
  it('rejects late product success after unready then the same actor becomes ready again', async () => {
    await stopAtVisit();
    const tracker = activity();
    const send = transport.getMockImplementation()!;
    let finish!: (response: Response) => void;
    transport.mockImplementation((url, init) =>
      String(url) === '/api/projects' && count('/api/projects') === 2
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : send(url, init),
    );
    const pending = sessionFetch.fetchWithSessionRefresh('/api/projects');
    await drain();
    context.setTelemetryContext(actor, false, 'home');
    context.setTelemetryContext(actor, true, 'home');
    const generation = context.telemetryContext().generation;
    finish(new Response(null, { status: 200 }));
    expect((await pending).status).toBe(200);
    await drain();
    expect(count('/api/auth/me')).toBe(0);
    expect(context.telemetryContext().generation).toBe(generation);
    tracker.input();
    await drain();
    expect(count(sessions)).toBe(0);
  });
  it('bounds a stalled proof body and releases its reader on timeout', async () => {
    await stopAtVisit();
    const cancel = vi.fn();
    proof = async () => new Response(new ReadableStream({ cancel }));
    expect((await product()).status).toBe(200);
    const generation = context.telemetryContext().generation;
    await vi.advanceTimersByTimeAsync(12_001);
    expect(cancel).toHaveBeenCalledOnce();
    expect(context.telemetryContext().generation).toBe(generation);
    proof = async () => me();
    await product('/api/projects/later');
    expect(context.telemetryContext().generation).toBe(generation + 1);
  });
  it('bounds a stalled identity proof and ignores its late response while returning product success', async () => {
    await stopAtVisit();
    let finish!: (response: Response) => void;
    proof = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    expect((await product()).status).toBe(200);
    const generation = context.telemetryContext().generation;
    await vi.advanceTimersByTimeAsync(12_001);
    finish(me());
    await drain();
    expect(context.telemetryContext().generation).toBe(generation);
    expect(
      (transport.mock.calls.find(([url]) => url === '/api/auth/me')?.[1]?.signal as AbortSignal)
        .aborted,
    ).toBe(true);
  });
  it('coalesces concurrent product refresh and pending proof into exactly one renewal', async () => {
    await stopAtVisit();
    let finishRefresh!: (response: Response) => void;
    refresh = () =>
      new Promise((resolve) => {
        finishRefresh = resolve;
      });
    let finishProof!: (response: Response) => void;
    proof = () =>
      new Promise((resolve) => {
        finishProof = resolve;
      });
    const generation = context.telemetryContext().generation;
    const one = sessionFetch.fetchWithSessionRefresh('/api/projects/one');
    const two = sessionFetch.fetchWithSessionRefresh('/api/projects/two');
    await drain();
    expect(count('/api/auth/refresh')).toBe(1);
    finishRefresh(new Response(null, { status: 200 }));
    expect((await one).status).toBe(200);
    expect((await two).status).toBe(200);
    await drain();
    expect(count('/api/auth/me')).toBe(1);
    finishProof(me());
    await drain();
    expect(context.telemetryContext().generation).toBe(generation + 1);
    expect(count(events)).toBe(1);
  });
});
