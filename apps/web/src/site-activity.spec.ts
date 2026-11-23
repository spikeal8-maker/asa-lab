// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { enableSiteActivityMeasurement } from './site-activity';
import { renewTelemetryContext, setTelemetryContext, telemetryContext } from './telemetry-context';

const account = {
  kind: 'account',
  accountId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
} as const;
const seat = {
  kind: 'student',
  seatId: '33333333-3333-4333-8333-333333333333',
  classId: '44444444-4444-4444-8444-444444444444',
} as const;
const start = Date.parse('2026-11-23T15:00:00.000Z');
const interval = (from: number, to: number, sentAt: number) => ({
  fromAgoMs: (sentAt - from) * 1000,
  toAgoMs: (sentAt - to) * 1000,
});
const advance = (seconds: number) => vi.advanceTimersByTimeAsync(seconds * 1000);
let onInput: EventListener | undefined;
let stop: (() => void) | undefined;
let focus: boolean;
let visible: DocumentVisibilityState;
let transport: ReturnType<typeof vi.fn<typeof fetch>>;

function trustedInput() {
  // Exercise the installed handler without overriding Event.isTrusted on DOM events.
  onInput?.({ isTrusted: true } as Event);
}

function sent(index = 0) {
  return JSON.parse(String(transport.mock.calls[index]?.[1]?.body));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  vi.setSystemTime(start);
  vi.spyOn(Math, 'random').mockReturnValue(0);
  focus = true;
  visible = 'visible';
  onInput = undefined;
  stop = undefined;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focus);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
  const nativeAdd = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    if (type === 'pointerdown') onInput = listener as EventListener;
    nativeAdd(type, listener, options);
  });
  transport = vi.fn<typeof fetch>(async (_path, options) => {
    const { eventId } = JSON.parse(String(options?.body));
    return new Response(
      JSON.stringify({
        accepted: true,
        schemaVersion: 2,
        state: 'persisted',
        eventId,
        receiptId: eventId,
        operation: 'site.activity',
        receivedAt: new Date().toISOString(),
        persistedAt: new Date().toISOString(),
      }),
    );
  });
  vi.stubGlobal('fetch', transport);
  setTelemetryContext(account, true, 'home');
});

afterEach(() => {
  stop?.();
  setTelemetryContext(null, true, 'public');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('requires explicit activation and trusted focused input, then throttles and clips idle time', async () => {
  expect(onInput).toBeUndefined();
  await advance(2);
  expect(transport).not.toHaveBeenCalled();
  stop = enableSiteActivityMeasurement();
  expect(enableSiteActivityMeasurement()).toBe(stop);
  document.dispatchEvent(new Event('pointerdown'));
  focus = false;
  trustedInput();
  await advance(61);
  expect(transport).not.toHaveBeenCalled();
  focus = true;
  trustedInput();
  await advance(59);
  expect(transport).not.toHaveBeenCalled();
  await advance(1);
  expect(transport).toHaveBeenCalledOnce();
  expect(transport.mock.calls[0]).toEqual([
    '/api/analytics/v2/site-activity',
    expect.objectContaining({ keepalive: false, priority: 'low', credentials: 'same-origin' }),
  ]);
  expect(sent()).toEqual({
    schemaVersion: 2,
    actorExpectation: account,
    eventId: expect.any(String),
    intervals: [interval(63, 93, 123)],
  });
  await advance(61);
  expect(transport).toHaveBeenCalledOnce();
});

it('ends intervals at blur and visibility changes while keeping route navigation in the same binding', async () => {
  stop = enableSiteActivityMeasurement();
  trustedInput();
  await advance(5);
  setTelemetryContext(account, true, 'classes');
  await advance(3);
  visible = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  await advance(4);
  trustedInput();
  await advance(4);
  visible = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  await advance(4);
  trustedInput();
  await advance(9);
  focus = false;
  window.dispatchEvent(new Event('blur'));
  await advance(31);
  expect(sent().intervals).toEqual([interval(0, 8, 60), interval(20, 29, 60)]);
});

it('bounds a batch of short foreground intervals and splits continuous use into separate sends', async () => {
  stop = enableSiteActivityMeasurement();
  for (let i = 0; i < 18; i += 1) {
    trustedInput();
    await advance(1);
    window.dispatchEvent(new Event('blur'));
    await advance(1);
  }
  trustedInput();
  await advance(24);
  expect(transport).toHaveBeenCalledOnce();
  expect(sent().intervals).toHaveLength(16);
  expect(sent().intervals[0]).toEqual(interval(6, 7, 60));
  expect(sent().intervals[15]).toEqual(interval(36, 60, 60));
  await advance(60);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(sent(1).intervals).toEqual([interval(60, 66, 120)]);
});

it('drops old observations at workspace pauses and attributes only a fresh StudentSeat binding', async () => {
  stop = enableSiteActivityMeasurement();
  trustedInput();
  await advance(20);
  setTelemetryContext(account, false, 'home');
  trustedInput();
  await advance(20);
  setTelemetryContext(seat, true, 'learning');
  trustedInput();
  await advance(59);
  expect(transport).not.toHaveBeenCalled();
  await advance(1);
  expect(sent()).toMatchObject({ actorExpectation: seat, intervals: [interval(40, 70, 100)] });
});

it('aborts a pending send on pagehide and requires new input after a cached page returns', async () => {
  stop = enableSiteActivityMeasurement();
  transport.mockImplementationOnce(() => new Promise<Response>(() => undefined));
  trustedInput();
  await advance(60);
  const signal = transport.mock.calls[0]?.[1]?.signal;
  expect(signal?.aborted).toBe(false);
  window.dispatchEvent(new Event('pagehide'));
  expect(signal?.aborted).toBe(true);
  trustedInput();
  await advance(60);
  expect(transport).toHaveBeenCalledOnce();
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  await advance(60);
  expect(transport).toHaveBeenCalledOnce();
  trustedInput();
  await advance(60);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(sent(1).intervals).toEqual([interval(180, 210, 240)]);
});

it('stops on an auth rejection without refresh and never replays a skipped batch', async () => {
  stop = enableSiteActivityMeasurement();
  transport.mockResolvedValueOnce(
    new Response('{"error":{"code":"unauthorized"}}', { status: 401 }),
  );
  trustedInput();
  await advance(60);
  trustedInput();
  await advance(120);
  expect(transport).toHaveBeenCalledOnce();
  renewTelemetryContext(telemetryContext());
  transport.mockImplementationOnce(async (_path, options) =>
    Response.json({
      schemaVersion: 2,
      accepted: false,
      state: 'skipped',
      operation: 'site.activity',
      eventId: JSON.parse(String(options?.body)).eventId,
      reason: 'capacity',
    }),
  );
  trustedInput();
  await advance(60);
  await advance(60);
  expect(transport).toHaveBeenCalledTimes(2);
  trustedInput();
  await advance(60);
  expect(transport.mock.calls.map(([url]) => url)).toEqual(
    Array(3).fill('/api/analytics/v2/site-activity'),
  );
  expect(sent(2).intervals).toEqual([interval(300, 330, 360)]);
});

it('sends monotonic interval ages despite an arbitrary wall-clock change', async () => {
  stop = enableSiteActivityMeasurement();
  trustedInput();
  await advance(10);
  vi.setSystemTime(start + 12 * 60 * 60_000);
  await advance(50);
  expect(sent().intervals).toEqual([interval(0, 30, 60)]);
});
