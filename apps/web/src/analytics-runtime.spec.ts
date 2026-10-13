// @vitest-environment jsdom
import { StrictMode, act, createElement, useEffect, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryActor } from './telemetry-contract';
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
          : { recordId: projectId }),
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
  transport = vi.fn<typeof fetch>(async (_path, init) =>
    response(JSON.parse(init!.body as string)),
  );
  vi.stubGlobal('fetch', transport);
  context = await import('./telemetry-context');
  await import('./analytics-runtime');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  context.setTelemetryContext(null, true, 'public');
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const operations = () =>
  transport.mock.calls
    .filter(([path]) => path === '/api/analytics/v2/module-session')
    .map(([, init]) => JSON.parse(init!.body as string));
describe('actual runtime identity and React ownership', () => {
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
