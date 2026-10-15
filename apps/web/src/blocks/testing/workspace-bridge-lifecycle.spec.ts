// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryActor } from '../../telemetry-contract';

const activity = vi.hoisted(() => ({
  start: vi.fn<(sessionId: string, projectId: string) => Promise<boolean>>(),
  touch: vi.fn<(sessionId: string, closed: boolean) => Promise<boolean>>(),
  bindings: [] as unknown[],
}));
// OBS-001 exercises the real bridge and input lifecycle; delivery/diagnostics
// transport failures are separate numbered repairs and cannot mask this oracle.
vi.mock('../module-activity', async () => {
  const { trackInputActivity } = await import('../../activity-lifecycle');
  return {
    trackBlocksActivity: (projectId: string, _transport: unknown, actor: unknown) => {
      activity.bindings.push(actor);
      return trackInputActivity(projectId, { start: activity.start, touch: activity.touch });
    },
  };
});
vi.mock('../../client-diagnostics', () => ({
  beginDiagnosticContext: () => () => undefined,
  reportClientDiagnostic: vi.fn(),
}));
import { BlocksEditor } from '../BlocksEditor';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const PRINCIPAL = '33333333-3333-4333-8333-333333333333';
const SCOPE_A = '55555555-5555-4555-8555-555555555555';
const SCOPE_B = '66666666-6666-4666-8666-666666666666';
const ACCOUNT_A: TelemetryActor = { kind: 'account', accountId: PRINCIPAL, workspaceId: SCOPE_A };
const ACCOUNT_B: TelemetryActor = { kind: 'account', accountId: PRINCIPAL, workspaceId: SCOPE_B };
const SEAT_A: TelemetryActor = { kind: 'student', seatId: PRINCIPAL, classId: SCOPE_A };
const SEAT_B: TelemetryActor = { kind: 'student', seatId: PRINCIPAL, classId: SCOPE_B };
const REACT = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let root: Root;
let container: HTMLDivElement;
let transport: ReturnType<typeof vi.fn<typeof fetch>>;
const props: Omit<ComponentProps<typeof BlocksEditor>, 'telemetryActor'> = {
  projectId: PROJECT,
  recoveryPrincipalKey: PRINCIPAL,
  onBack: () => undefined,
  onHomeClick: () => undefined,
  onAccountClick: () => undefined,
  accountLabel: 'Scope lifecycle fixture',
  accountInitials: 'SL',
};
function capability(token: string): Response {
  return new Response(
    JSON.stringify({
      runtimeOrigin: window.location.origin,
      runtimeToken: token,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      draftRevision: 17,
      projectJson: { targets: [], monitors: [], extensions: [] },
      assets: [],
    }),
    { status: 200, headers: { date: new Date().toUTCString() } },
  );
}
async function settle(): Promise<void> {
  for (let i = 0; i < 16; i++) await Promise.resolve();
}
async function render(actor: TelemetryActor): Promise<HTMLIFrameElement> {
  await act(async () => {
    root.render(createElement(BlocksEditor, { ...props, telemetryActor: actor }));
    await settle();
  });
  const frame = container.querySelector('iframe');
  if (!frame) throw Error('Shipping Scratch iframe missing');
  return frame;
}
function inspect(frame: HTMLIFrameElement) {
  const source = frame.contentWindow;
  if (!source) throw Error('Scratch window missing');
  const post = vi.spyOn(source, 'postMessage').mockImplementation(() => undefined);
  const messages = (type: string) =>
    post.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .filter((message) => message['messageType'] === type);
  return { frame, source, post, messages };
}
type Frame = ReturnType<typeof inspect>;
async function load(frame: HTMLIFrameElement): Promise<void> {
  await act(async () => {
    frame.dispatchEvent(new Event('load'));
    await settle();
  });
}
async function child(
  frame: Frame,
  init: Record<string, unknown>,
  extra: Record<string, unknown>,
  source: unknown = frame.source,
  origin = window.location.origin,
): Promise<void> {
  await act(async () => {
    const event = new MessageEvent('message', {
      origin,
      data: {
        protocolVersion: init['protocolVersion'],
        projectId: init['projectId'],
        sessionNonce: init['sessionNonce'],
        ...extra,
      },
    });
    Object.defineProperty(event, 'source', { value: source });
    window.dispatchEvent(event);
    await settle();
  });
}
beforeEach(() => {
  REACT.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
  activity.start.mockReset().mockResolvedValue(true);
  activity.touch.mockReset().mockResolvedValue(true);
  activity.bindings.length = 0;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  let sequence = 0;
  transport = vi.fn<typeof fetch>(async () =>
    capability(`capability${++sequence}.fixture.signature`),
  );
  vi.stubGlobal('fetch', transport);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    await settle();
  });
  container.remove();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  REACT.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('OBS-001 Scratch workspace bridge ownership', () => {
  it.each([
    ['Account/workspace', ACCOUNT_A, ACCOUNT_B],
    ['StudentSeat/class', SEAT_A, SEAT_B],
  ] as const)(
    'replaces and reconnects the iframe on %s change, rejecting old source/nonce until new readiness',
    async (_name, before, after) => {
      const first = inspect(await render(before));
      await load(first.frame);
      const firstInit = first.messages('ASA_BLOCKS_INIT')[0]!;
      await child(first, firstInit, { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
      await child(first, firstInit, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
      expect(activity.start).toHaveBeenCalledTimes(1);

      const replacement = await render(after);
      expect(replacement).not.toBe(first.frame); // The defect: an effect alone cannot generate another browser load.
      expect(first.messages('ASA_BLOCKS_STOP')).toHaveLength(1);
      expect(activity.touch).toHaveBeenCalledExactlyOnceWith(
        activity.start.mock.calls[0]![0],
        true,
      );
      const next = inspect(replacement);
      await load(next.frame);
      expect(transport).toHaveBeenCalledTimes(2);
      for (const [url, request] of transport.mock.calls) {
        expect(url).toBe(`/api/projects/${PROJECT}/blocks/runtime-session`);
        expect(request).toMatchObject({
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          body: '{}',
        });
      }
      const nextInit = next.messages('ASA_BLOCKS_INIT')[0]!;
      expect(nextInit['runtimeToken']).toBe('capability2.fixture.signature');
      expect(nextInit['sessionNonce']).not.toBe(firstInit['sessionNonce']);
      expect(activity.bindings).toEqual([before, after]);
      await child(next, nextInit, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
      expect(activity.start).toHaveBeenCalledTimes(1); // New capability/INIT does not itself prove readiness/input.
      await child(
        next,
        nextInit,
        { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' },
        first.source,
      );
      await child(next, firstInit, { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
      await child(
        next,
        nextInit,
        { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' },
        next.source,
        'https://untrusted.invalid',
      );
      await child(next, nextInit, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
      expect(activity.start).toHaveBeenCalledTimes(1);
      expect(
        container.querySelector('[data-asa-blocks-loading-overlay]')?.getAttribute('data-state'),
      ).toBe('loading');
      await child(next, nextInit, { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
      await child(next, nextInit, {
        messageType: 'ASA_BLOCKS_STATUS',
        status: 'runtime-heartbeat',
      });
      expect(activity.start).toHaveBeenCalledTimes(1);
      await child(next, nextInit, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' }, first.source);
      await child(next, firstInit, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
      expect(activity.start).toHaveBeenCalledTimes(1);
      await child(next, nextInit, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
      expect(activity.start).toHaveBeenCalledTimes(2);
      expect(activity.start.mock.calls[1]![1]).toBe(PROJECT);
      expect(activity.start.mock.calls[1]![0]).not.toBe(activity.start.mock.calls[0]![0]);
      expect(
        container.querySelector('[data-asa-blocks-loading-overlay]')?.getAttribute('data-state'),
      ).toBe('ready');
    },
  );
  it('does not remount/rebootstrap on an equivalent context rerender', async () => {
    const first = inspect(await render(ACCOUNT_A));
    await load(first.frame);
    const init = first.messages('ASA_BLOCKS_INIT')[0]!;
    expect(await render({ ...ACCOUNT_A })).toBe(first.frame);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(first.messages('ASA_BLOCKS_STOP')).toHaveLength(0);
    await child(first, init, { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
    await child(first, init, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
    expect(activity.start).toHaveBeenCalledTimes(1);
    expect(activity.bindings).toHaveLength(1);
  });
  it('ignores an old bootstrap response which completes after the new workspace bootstrap', async () => {
    let resolveOld!: (response: Response) => void;
    transport.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const first = inspect(await render(ACCOUNT_A));
    await load(first.frame);
    const oldSignal = transport.mock.calls[0]![1]!.signal!;
    const replacement = await render(ACCOUNT_B);
    expect(replacement).not.toBe(first.frame);
    expect(oldSignal.aborted).toBe(true);
    const next = inspect(replacement);
    await load(next.frame);
    const init = next.messages('ASA_BLOCKS_INIT')[0]!;
    expect(init['runtimeToken']).toBe('capability1.fixture.signature');
    await act(async () => {
      resolveOld(capability('stale.bootstrap.signature'));
      await settle();
    });
    expect(first.messages('ASA_BLOCKS_INIT')).toHaveLength(0);
    expect(next.messages('ASA_BLOCKS_INIT')).toHaveLength(1);
    expect(next.messages('ASA_BLOCKS_TOKEN_UPDATE')).toHaveLength(0);
    expect(activity.start).not.toHaveBeenCalled();
    await child(next, init, { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
    await child(next, init, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
    expect(activity.start).toHaveBeenCalledTimes(1);
  });
  it('ignores an old capability refresh response after a workspace replacement', async () => {
    const first = inspect(await render(ACCOUNT_A));
    await load(first.frame);
    const oldInit = first.messages('ASA_BLOCKS_INIT')[0]!;
    let resolveRefresh!: (response: Response) => void;
    transport.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    await child(first, oldInit, { messageType: 'ASA_BLOCKS_TOKEN_REFRESH_REQUIRED' });
    const oldSignal = transport.mock.calls[1]![1]!.signal!;
    const replacement = await render(ACCOUNT_B);
    expect(replacement).not.toBe(first.frame);
    expect(oldSignal.aborted).toBe(true);
    const next = inspect(replacement);
    await load(next.frame);
    const init = next.messages('ASA_BLOCKS_INIT')[0]!;
    expect(init['runtimeToken']).toBe('capability2.fixture.signature');
    await act(async () => {
      resolveRefresh(capability('stale.refresh.signature'));
      await settle();
    });
    expect(first.messages('ASA_BLOCKS_TOKEN_UPDATE')).toHaveLength(0);
    expect(next.messages('ASA_BLOCKS_TOKEN_UPDATE')).toHaveLength(0);
    expect(next.messages('ASA_BLOCKS_INIT')).toHaveLength(1);
    expect(activity.start).not.toHaveBeenCalled();
    await child(next, oldInit, { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
    await child(next, init, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
    expect(activity.start).not.toHaveBeenCalled();
    await child(next, init, { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
    await child(next, init, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
    expect(activity.start).toHaveBeenCalledTimes(1);
  });
});
