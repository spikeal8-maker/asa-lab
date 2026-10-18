// @vitest-environment jsdom
import { StrictMode, act, createElement, useEffect, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryActor } from './telemetry-contract';
import type { ActivityTransport } from './activity-lifecycle';
const actor = {
  kind: 'account' as const,
  accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};
const projectId = '11111111-1111-4111-8111-111111111111';
let root: Root | undefined;
let container: HTMLDivElement;
let context: typeof import('./telemetry-context');
let transport: ReturnType<typeof vi.fn<typeof fetch>>;
let runtimePagehide: EventListener;
let listeners: { type: string; listener: EventListenerOrEventListenerObject; capture: boolean }[];
function response(body: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
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
          : { recordId: 1 }),
    }),
    { status: 200 },
  );
}
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
  sessionStorage.clear();
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  listeners = [];
  const addListener = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    listeners.push({
      type,
      listener,
      capture: typeof options === 'boolean' ? options : !!options?.capture,
    });
    addListener(type, listener, options);
  });
  transport = vi.fn<typeof fetch>(async (_path, init) =>
    response(JSON.parse(init!.body as string)),
  );
  vi.stubGlobal('fetch', transport);
  context = await import('./telemetry-context');
  await import('./analytics-runtime');
  runtimePagehide = listeners.find(({ type }) => type === 'pagehide')!.listener as EventListener;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  try {
    await act(async () => root?.unmount());
  } finally {
    root = undefined;
    container.remove();
    context.setTelemetryContext(null, true, 'public');
    // resetModules does not remove the previous runtime's import-installed browser listeners.
    for (const { type, listener, capture } of listeners)
      window.removeEventListener(type, listener, capture);
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
const operations = () =>
  transport.mock.calls
    .filter(([path]) => path === '/api/analytics/v2/module-session')
    .map(([, init]) => JSON.parse(init!.body as string));
const qualityCalls = () =>
  transport.mock.calls.filter(([path]) => path === '/api/analytics/v2/quality');
const qualityBodies = () => qualityCalls().map(([, init]) => JSON.parse(init!.body as string));
const savedQuality = () => JSON.parse(sessionStorage.getItem('asa:quality:v2:product')!);
const savedQueue = () => JSON.parse(sessionStorage.getItem('asa:analytics:v2')!);

describe('OBS007 mounted runtime BFCache restoration', () => {
  const hide = () => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  const show = (persisted = true) =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted }));

  it('retries the original pending start and close on return without reopening old activity', async () => {
    let failed = false;
    transport.mockImplementation(async (path, init) => {
      const body = JSON.parse(init!.body as string);
      if (path === '/api/analytics/v2/module-session' && body.operation === 'start' && !failed) {
        failed = true;
        return new Response('{}', { status: 503 });
      }
      return response(body);
    });
    context.setTelemetryContext(actor, true, 'editor.electronics');
    await mountTrackers();
    await vi.advanceTimersByTimeAsync(0);
    const original = transport.mock.calls.find(
      ([path]) => path === '/api/analytics/v2/module-session',
    )![1]!.body;
    hide();
    await vi.advanceTimersByTimeAsync(0);
    const queuedClose = savedQueue().sessions[0].close;
    const calls = transport.mock.calls.length;
    show(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(calls);
    show();
    await vi.advanceTimersByTimeAsync(0);
    const sessions = transport.mock.calls.filter(
      ([path]) => path === '/api/analytics/v2/module-session',
    );
    expect(sessions.map(([, init]) => JSON.parse(init!.body as string).operation)).toEqual([
      'start',
      'start',
      'close',
    ]);
    expect(sessions[1]![1]!.body).toBe(original);
    expect(JSON.parse(sessions[2]![1]!.body as string)).toEqual(queuedClose);
    expect(savedQueue().sessions).toEqual([]);
    expect(
      transport.mock.calls.filter(([path]) => path === '/api/analytics/v2/events'),
    ).toHaveLength(1);
  });

  it('restores the same mounted editor and quality stream without a synthetic visit or activity', async () => {
    context.setTelemetryContext(actor, true, 'editor.electronics');
    const [tracker] = await mountTrackers();
    await vi.advanceTimersByTimeAsync(0);
    const original = operations()[0];
    hide();
    await vi.advanceTimersByTimeAsync(0);
    expect(savedQuality().snapshot.coverage.final).toBe(true);
    const streamId = savedQuality().snapshot.streamId;
    await vi.advanceTimersByTimeAsync(120_000);
    show();
    await vi.advanceTimersByTimeAsync(0);
    expect(savedQuality().snapshot).toMatchObject({ streamId, coverage: { final: false } });
    expect(operations().map((body) => body.operation)).toEqual(['start', 'close']);
    expect(operations()[1]).toMatchObject({
      sessionId: original.sessionId,
      visitId: original.visitId,
    });
    expect(
      transport.mock.calls.filter(([path]) => path === '/api/analytics/v2/events'),
    ).toHaveLength(1);
    const calls = transport.mock.calls.length;
    show();
    show(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(calls);
    tracker!.input();
    await vi.advanceTimersByTimeAsync(0);
    expect(operations().map((body) => body.operation)).toEqual(['start', 'close', 'start']);
    expect(operations()[2]).toMatchObject({ visitId: original.visitId, actorExpectation: actor });
    expect(operations()[2].sessionId).not.toBe(original.sessionId);
    expect(transport.mock.calls.some(([path]) => path === '/api/auth/me')).toBe(false);
  });

  it('records the return while context is paused without unpausing or making requests', async () => {
    context.setTelemetryContext(actor, true, 'home');
    await vi.advanceTimersByTimeAsync(0);
    hide();
    await vi.advanceTimersByTimeAsync(0);
    context.setTelemetryContext(actor, false, 'home');
    const calls = transport.mock.calls.length;
    show();
    expect(savedQuality().snapshot.coverage.final).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport).toHaveBeenCalledTimes(calls);
    context.setTelemetryContext(actor, true, 'home');
    await vi.advanceTimersByTimeAsync(1000);
    expect(savedQuality().snapshot.coverage.final).toBe(false);
    expect(transport.mock.calls.length).toBeGreaterThan(calls);
  });

  it('does not resume or retry a successor actor created while suspended', async () => {
    context.setTelemetryContext(actor, true, 'home');
    await vi.advanceTimersByTimeAsync(1000);
    hide();
    await vi.advanceTimersByTimeAsync(0);
    context.setTelemetryContext({ ...actor, workspaceId: projectId }, true, 'home');
    await vi.advanceTimersByTimeAsync(1000);
    const saved = sessionStorage.getItem('asa:quality:v2:product');
    const calls = transport.mock.calls.length;
    show();
    show();
    await vi.advanceTimersByTimeAsync(0);
    expect(sessionStorage.getItem('asa:quality:v2:product')).toBe(saved);
    expect(transport).toHaveBeenCalledTimes(calls);
  });
});

async function mountTrackers(apis?: ActivityTransport[], input = true) {
  const { trackInputActivity } = await import('./activity-lifecycle');
  const { analyticsSessionTransport } = await import('./analytics-runtime');
  const trackers: ReturnType<typeof trackInputActivity>[] = [];
  function Probe() {
    useEffect(() => {
      for (const api of apis ?? [analyticsSessionTransport(actor, 'electronics')]) {
        const tracker = trackInputActivity(projectId, api);
        trackers.push(tracker);
        tracker.setReady(true);
        if (input) tracker.input();
      }
      return () => trackers.forEach((tracker) => tracker.dispose());
    }, []);
    return null;
  }
  await act(async () => root!.render(createElement(Probe)));
  return trackers;
}
describe('OBS007 repair actual ModuleEditorHost startup observation', () => {
  async function mountHost(strict = false) {
    vi.doMock('./chess/load-chess-editor', () => ({
      loadChessEditor: async () => ({ default: () => null }),
    }));
    vi.doMock('./blocks/BlocksEditor', () => ({ BlocksEditor: () => null }));
    vi.doMock('./components/AssignmentBrief', () => ({ AssignmentBrief: () => null }));
    const { ModuleEditorHost } = await import('./modules/ModuleEditorHost');
    context.setTelemetryContext(actor, true, 'editor.chess');
    const host = createElement(ModuleEditorHost, {
      projectId,
      moduleKey: 'chess',
      returnTo: { kind: 'games' },
      user: { id: actor.accountId, displayName: 'Editor user', email: 'editor@example.invalid' },
      telemetryActor: actor,
      onBack: () => undefined,
    });
    await act(async () => root!.render(strict ? createElement(StrictMode, null, host) : host));
  }

  afterEach(() => {
    vi.doUnmock('./chess/load-chess-editor');
    vi.doUnmock('./blocks/BlocksEditor');
    vi.doUnmock('./components/AssignmentBrief');
  });

  it('cancels a pre-hide startup callback and accepts only fresh pointer or keyboard input after return', async () => {
    await mountHost();
    // The real host has mounted, but its initial setTimeout(input,0) has not fired.
    expect(operations()).toEqual([]);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(operations()).toEqual([]);
    window.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(0);
    expect(operations().map((body) => body.operation)).toEqual(['start']);
    const original = operations()[0];
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await vi.advanceTimersByTimeAsync(30_001);
    expect(operations().map((body) => body.operation)).toEqual(['start', 'close']);
    window.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(0);
    expect(operations().map((body) => body.operation)).toEqual(['start', 'close', 'start']);
    expect(operations()[2]).toMatchObject({ visitId: original.visitId, moduleKey: 'chess' });
    expect(operations()[2].sessionId).not.toBe(original.sessionId);
    expect(
      transport.mock.calls.filter(([path]) => path === '/api/analytics/v2/events'),
    ).toHaveLength(1);
  });

  it.each([false, true])(
    'preserves ordinary initial observation and cleanup (StrictMode=%s)',
    async (strict) => {
      await mountHost(strict);
      await vi.advanceTimersByTimeAsync(0);
      expect(operations().map((body) => body.operation)).toEqual(['start']);
      const original = operations()[0];
      const remove = vi.spyOn(window, 'removeEventListener');
      await act(async () => root!.unmount());
      root = undefined;
      await vi.advanceTimersByTimeAsync(0);
      expect(operations().map((body) => body.operation)).toEqual(['start', 'close']);
      expect(operations()[1].sessionId).toBe(original.sessionId);
      expect(remove.mock.calls.map(([type]) => type)).toEqual(
        expect.arrayContaining(['pagehide', 'pointerdown', 'keydown']),
      );
      window.dispatchEvent(new Event('pointerdown'));
      window.dispatchEvent(new Event('keydown'));
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(operations().map((body) => body.operation)).toEqual(['start', 'close']);
    },
  );

  it('cancels the pending initial observation when the actual host unmounts', async () => {
    await mountHost();
    await act(async () => root!.unmount());
    root = undefined;
    await vi.advanceTimersByTimeAsync(0);
    expect(operations()).toEqual([]);
  });
});

describe('actual runtime identity and React ownership', () => {
  it('does not replay acknowledged visits when the same Account switches workspace', async () => {
    const visits = () =>
      transport.mock.calls
        .filter(([path]) => path === '/api/analytics/v2/events')
        .map(([, init]) => JSON.parse(init!.body as string));
    context.setTelemetryContext(actor, true, 'home');
    await vi.advanceTimersByTimeAsync(0);
    expect(visits()).toHaveLength(1);
    const original = visits()[0];
    expect(savedQueue().visits).toEqual([]);
    expect(savedQuality().snapshot.counters).toMatchObject({ acknowledged: 1, retried: 0 });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(visits()).toEqual([original]);
    const successor = { ...actor, workspaceId: projectId };
    context.setTelemetryContext(successor, true, 'learning');
    await vi.advanceTimersByTimeAsync(0);
    expect(visits()).toHaveLength(2);
    const next = visits()[1];
    expect(next.actorExpectation).toEqual(successor);
    expect(next.eventId).not.toBe(original.eventId);
    expect(next.visitId).not.toBe(original.visitId);
    expect(savedQueue()).toEqual({
      schemaVersion: 2,
      actor: successor,
      sessions: [],
      visits: [],
    });
    context.setTelemetryContext({ ...successor }, true, 'projects');
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(visits()).toEqual([original, next]);
    expect(savedQuality().snapshot.counters).toMatchObject({ acknowledged: 1, retried: 0 });
  });
  it('StrictMode probe creates one visit and one start; disposal records the exact original close', async () => {
    const { trackInputActivity } = await import('./activity-lifecycle');
    const { analyticsSessionTransport } = await import('./analytics-runtime');
    function Probe() {
      useLayoutEffect(() => context.setTelemetryContext(actor, true, 'editor.electronics'), []);
      useEffect(() => {
        const activity = trackInputActivity(
          projectId,
          analyticsSessionTransport(actor, 'electronics'),
        );
        activity.setReady(true);
        const firstObservation = setTimeout(() => activity.input(), 0);
        return () => {
          clearTimeout(firstObservation);
          activity.dispose();
        };
      }, []);
      return null;
    }
    await act(async () => {
      root!.render(createElement(StrictMode, null, createElement(Probe)));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      transport.mock.calls.filter(([path]) => path === '/api/analytics/v2/events'),
    ).toHaveLength(1);
    expect(operations().map((body) => body.operation)).toEqual(['start']);
    const original = operations()[0];
    await act(async () => root?.unmount());
    root = undefined;
    await vi.advanceTimersByTimeAsync(0);
    expect(operations().map((body) => body.operation)).toEqual(['start', 'close']);
    expect(operations()[1]).toMatchObject({
      sessionId: original.sessionId,
      visitId: original.visitId,
      actorExpectation: actor,
    });
  });
  it('does not count SPA route/identity rerender as new visits but separates logout and StudentSeat', async () => {
    context.setTelemetryContext(actor, true, 'home');
    await vi.advanceTimersByTimeAsync(0);
    context.setTelemetryContext({ ...actor }, true, 'projects');
    await vi.advanceTimersByTimeAsync(0);
    expect(
      transport.mock.calls.filter(([path]) => path === '/api/analytics/v2/events'),
    ).toHaveLength(1);
    context.setTelemetryContext(null, true, 'public');
    const seat: TelemetryActor = {
      kind: 'student',
      seatId: actor.accountId,
      classId: actor.workspaceId,
    };
    context.setTelemetryContext(seat, true, 'classes');
    await vi.advanceTimersByTimeAsync(0);
    const visits = transport.mock.calls
      .filter(([path]) => path === '/api/analytics/v2/events')
      .map(([, init]) => JSON.parse(init!.body as string));
    expect(visits).toHaveLength(2);
    expect(visits[1].visitId).not.toBe(visits[0].visitId);
    expect(visits[1].actorExpectation).toEqual(seat);
    const { analyticsSessionTransport } = await import('./analytics-runtime');
    expect(await analyticsSessionTransport(actor, 'blocks').start(projectId, projectId)).toBe(
      false,
    );
    expect(operations()).toHaveLength(0);
  });
});

describe('pagehide closes mounted activity before final quality', () => {
  it.each(['confirmed', 'pending'] as const)(
    'includes the original close synchronously with a %s start and never duplicates it',
    async (state) => {
      let completeStart: (() => void) | undefined;
      transport.mockImplementation(async (_path, init) => {
        const body = JSON.parse(init!.body as string);
        if (body.operation === 'start' && state === 'pending')
          await new Promise<void>((resolve) => (completeStart = resolve));
        if (body.operation === 'close') await new Promise<void>(() => undefined);
        return response(body);
      });
      context.setTelemetryContext(actor, true, 'editor.electronics');
      await vi.advanceTimersByTimeAsync(0);
      const [tracker] = await mountTrackers();
      await vi.advanceTimersByTimeAsync(0);
      const original = operations()[0];
      expect(original.operation).toBe('start');
      expect(qualityCalls()).toHaveLength(0);

      // Invoke only the first runtime listener: later native tracker listeners have not run.
      // This also rules out relying on microtask checkpoints between browser listeners.
      runtimePagehide.call(window, new Event('pagehide'));
      const gauges = { pending: state === 'pending' ? 1 : 0, inFlight: 1 };
      expect(qualityBodies()[0]).toMatchObject({
        actorExpectation: actor,
        coverage: { final: true },
        counters: { attempted: 3, enqueued: 3, acknowledged: state === 'pending' ? 1 : 2 },
        gauges,
      });
      const close = savedQueue().sessions[0].close;
      expect(close).toMatchObject({
        operation: 'close',
        sessionId: original.sessionId,
        visitId: original.visitId,
        actorExpectation: original.actorExpectation,
      });
      expect(savedQuality().snapshot.gauges).toEqual(gauges);
      window.dispatchEvent(new Event('pagehide'));
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      tracker!.dispose();
      completeStart?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(operations().filter((body) => body.operation === 'close')).toEqual([close]);
      expect(savedQuality().snapshot.counters).toMatchObject({
        attempted: 3,
        enqueued: 3,
        deduplicated: 0,
      });
    },
  );

  it('preserves a frozen retry and sends close counters in the next final sequence', async () => {
    let qualityAttempt = 0;
    transport.mockImplementation(async (path, init) => {
      const body = JSON.parse(init!.body as string);
      if (body.operation === 'close') await new Promise<void>(() => undefined);
      if (path === '/api/analytics/v2/quality' && ++qualityAttempt === 1)
        return new Response('{}', { status: 503 });
      return response(body);
    });
    context.setTelemetryContext(actor, true, 'editor.electronics');
    await vi.advanceTimersByTimeAsync(0);
    await mountTrackers();
    await vi.advanceTimersByTimeAsync(1000);
    const frozenBody = qualityCalls()[0]![1]!.body;
    const frozen = JSON.parse(frozenBody as string);
    expect(frozen).toMatchObject({
      sequence: 1,
      counters: { attempted: 2 },
      coverage: { final: false },
    });
    runtimePagehide.call(window, new Event('pagehide'));
    expect(qualityCalls()[1]![1]!.body).toBe(frozenBody);
    expect(savedQuality().pending).toEqual(frozen);
    await vi.advanceTimersByTimeAsync(0);
    expect(savedQuality().snapshot).toMatchObject({
      counters: { attempted: 3, enqueued: 3 },
      coverage: { final: true },
      gauges: { pending: 0, inFlight: 1 },
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(qualityBodies()[2]).toMatchObject({
      sequence: 2,
      streamId: frozen.streamId,
      counters: { attempted: 3, enqueued: 3 },
      coverage: { final: true },
      gauges: { pending: 0, inFlight: 1 },
    });
    expect(qualityBodies()[2].eventId).not.toBe(frozen.eventId);
    expect(qualityCalls()[0]![1]!.body).toBe(frozenBody);
  });

  it.each(['empty', 'disposed'] as const)(
    'does not invent a close for an %s tracker',
    async (state) => {
      context.setTelemetryContext(actor, true, 'editor.electronics');
      await vi.advanceTimersByTimeAsync(0);
      const closeIntent = vi.fn();
      const bindingVersion = vi.fn(() => 'binding');
      const [tracker] = await mountTrackers(
        [{ start: async () => true, touch: async () => true, closeIntent, bindingVersion }],
        false,
      );
      if (state === 'disposed') {
        tracker!.dispose();
        bindingVersion.mockClear();
      }
      runtimePagehide.call(window, new Event('pagehide'));
      window.dispatchEvent(new Event('pagehide'));
      expect(closeIntent).not.toHaveBeenCalled();
      if (state === 'disposed') expect(bindingVersion).not.toHaveBeenCalled();
      expect(operations()).toEqual([]);
      expect(qualityBodies()[0]).toMatchObject({
        coverage: { final: true },
        counters: { attempted: 1, enqueued: 1 },
        gauges: { pending: 0, inFlight: 0 },
      });
    },
  );

  it('keeps an earlier visibility close single when pagehide and disposal follow', async () => {
    transport.mockImplementation(async (_path, init) => {
      const body = JSON.parse(init!.body as string);
      if (body.operation === 'close') await new Promise<void>(() => undefined);
      return response(body);
    });
    context.setTelemetryContext(actor, true, 'editor.electronics');
    await vi.advanceTimersByTimeAsync(0);
    const [tracker] = await mountTrackers();
    await vi.advanceTimersByTimeAsync(0);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    runtimePagehide.call(window, new Event('pagehide'));
    window.dispatchEvent(new Event('pagehide'));
    tracker!.dispose();
    expect(operations().filter((body) => body.operation === 'close')).toHaveLength(1);
    expect(qualityBodies()[0]).toMatchObject({
      counters: { attempted: 3, enqueued: 3, deduplicated: 0 },
      gauges: { pending: 0, inFlight: 1 },
      coverage: { final: true },
    });
  });

  it('includes close replacement of a queued touch without sending that discarded touch', async () => {
    let completeStart!: () => void;
    transport.mockImplementation(async (_path, init) => {
      const body = JSON.parse(init!.body as string);
      if (body.operation === 'start')
        await new Promise<void>((resolve) => (completeStart = resolve));
      if (body.operation === 'close') await new Promise<void>(() => undefined);
      return response(body);
    });
    context.setTelemetryContext(actor, true, 'editor.electronics');
    await vi.advanceTimersByTimeAsync(0);
    const { analyticsSessionTransport } = await import('./analytics-runtime');
    const api = analyticsSessionTransport(actor, 'electronics');
    await mountTrackers([api]);
    const original = operations()[0];
    const touch = api.touch(original.sessionId, false);
    runtimePagehide.call(window, new Event('pagehide'));
    expect(qualityBodies()[0]).toMatchObject({
      counters: { attempted: 4, enqueued: 4, coalesced: 1 },
      gauges: { pending: 1, inFlight: 1 },
      coverage: { final: true },
    });
    expect(savedQueue().sessions[0].touch).toBeNull();
    expect(await touch).toBe(false);
    completeStart();
    await vi.advanceTimersByTimeAsync(0);
    expect(operations().map((body) => body.operation)).toEqual(['start', 'close']);
  });

  it('finalizes all mounted trackers before taking the shared snapshot', async () => {
    transport.mockImplementation(async (_path, init) => {
      const body = JSON.parse(init!.body as string);
      if (body.operation === 'close') await new Promise<void>(() => undefined);
      return response(body);
    });
    context.setTelemetryContext(actor, true, 'editor.electronics');
    await vi.advanceTimersByTimeAsync(0);
    const { analyticsSessionTransport } = await import('./analytics-runtime');
    await mountTrackers([
      analyticsSessionTransport(actor, 'electronics'),
      analyticsSessionTransport(actor, 'blocks'),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    const starts = operations();
    runtimePagehide.call(window, new Event('pagehide'));
    expect(qualityBodies()[0]).toMatchObject({
      counters: { attempted: 5, enqueued: 5 },
      gauges: { pending: 1, inFlight: 1 },
      coverage: { final: true },
    });
    expect(savedQueue().sessions.map((session: { close: unknown }) => session.close)).toEqual(
      starts.map((start) =>
        expect.objectContaining({
          operation: 'close',
          sessionId: start.sessionId,
          visitId: start.visitId,
          actorExpectation: actor,
        }),
      ),
    );
  });

  it.each(['native', 'fallback', 'reporter-failure'] as const)(
    'isolates a throwing finalizer with %s error reporting so the next tracker and quality still complete',
    async (reporting) => {
      context.setTelemetryContext(actor, true, 'editor.electronics');
      await vi.advanceTimersByTimeAsync(0);
      const { analyticsSessionTransport } = await import('./analytics-runtime');
      const failure = Error('failed transport finalizer');
      const reported: ErrorEvent[] = [];
      const reportError = vi.fn(() => {
        if (reporting === 'reporter-failure') throw Error('failed reporter');
      });
      vi.stubGlobal('reportError', reporting === 'fallback' ? undefined : reportError);
      window.addEventListener('error', (event) => {
        event.preventDefault();
        reported.push(event);
      });
      const failing = vi.fn(() => {
        throw failure;
      });
      await mountTrackers([
        { start: async () => true, touch: async () => true, closeIntent: failing },
        analyticsSessionTransport(actor, 'electronics'),
      ]);
      await vi.advanceTimersByTimeAsync(0);
      expect(() => runtimePagehide.call(window, new Event('pagehide'))).not.toThrow();
      expect(failing).toHaveBeenCalledTimes(1);
      expect(qualityBodies()[0]).toMatchObject({
        counters: { attempted: 3, enqueued: 3 },
        coverage: { final: true },
      });
      window.dispatchEvent(new Event('pagehide'));
      expect(failing).toHaveBeenCalledTimes(1);
      if (reporting === 'fallback') {
        expect(reported).toHaveLength(1);
        expect(reported[0]!.error).toBe(failure);
        expect(reported[0]!.message).toBe(failure.message);
      } else {
        expect(reportError).toHaveBeenCalledExactlyOnceWith(failure);
        expect(reported).toEqual([]);
      }
    },
  );

  it('does not finalize the successor actor when a tracker changes identity during close', async () => {
    context.setTelemetryContext(actor, true, 'editor.electronics');
    await vi.advanceTimersByTimeAsync(0);
    const successor = { ...actor, workspaceId: projectId };
    const changed = vi.fn(() => context.setTelemetryContext(successor, true, 'editor.electronics'));
    await mountTrackers([
      { start: async () => true, touch: async () => true, closeIntent: changed },
    ]);
    runtimePagehide.call(window, new Event('pagehide'));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(qualityCalls()).toHaveLength(0);
    expect(savedQuality().snapshot).toMatchObject({
      actorExpectation: successor,
      coverage: { final: false },
    });
  });
});
