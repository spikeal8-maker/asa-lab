// @vitest-environment jsdom
import { StrictMode, act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimNewInvitations,
  useGameInvitations,
  usePortalGameNotifications,
} from './game-notifications';
import type { GameNotificationResult } from './game-notification-coordinator';

const { request } = vi.hoisted(() => ({
  request: vi.fn<(path: string, init: RequestInit) => Promise<GameNotificationResult>>(),
}));
vi.mock('../api-call', () => ({ call: request }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  localStorage.clear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  request.mockReset();
  request.mockResolvedValue({
    ok: true,
    status: 200,
    data: { playerId: 'player-a', incoming: [] },
  });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function Portal({ actor }: { actor: string }) {
  usePortalGameNotifications(actor);
  const state = useGameInvitations();
  return createElement('output', null, JSON.stringify(state));
}

async function renderPortal(actor: string) {
  if (!root) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root!.render(createElement(Portal, { actor })));
}

async function advance(milliseconds: number) {
  await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
}

function pendingResult() {
  let resolve!: (result: GameNotificationResult) => void;
  const promise = new Promise<GameNotificationResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('game invitation delivery', () => {
  it('deduplicates polling, reloads and different tabs through persistent player-specific delivery ids', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    });
    const invite = { id: 'first', expiresAt: Date.now() + 60000 };
    expect(claimNewInvitations('one', [invite])).toBe(true);
    expect(claimNewInvitations('one', [invite])).toBe(false);
    // A response no longer containing the invitation does not make it new again.
    expect(claimNewInvitations('one', [])).toBe(false);
    expect(claimNewInvitations('one', [invite])).toBe(false);
    expect(claimNewInvitations('two', [invite])).toBe(true);
    data.set(
      'asa:game-alerts:v1:one',
      JSON.stringify([invite, { id: 'from-other-tab', expiresAt: invite.expiresAt }]),
    );
    expect(
      claimNewInvitations('one', [{ id: 'from-other-tab', expiresAt: invite.expiresAt }]),
    ).toBe(false);
    expect(claimNewInvitations('one', [{ id: 'next', expiresAt: invite.expiresAt }])).toBe(true);
  });
  it('keeps delivery ids when storage reads work but writes exceed quota', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    const invite = { id: 'quota-invite', expiresAt: Date.now() + 60000 };
    expect(claimNewInvitations('quota', [invite])).toBe(true);
    expect(claimNewInvitations('quota', [invite])).toBe(false);
  });
  it('keeps delivery deduplication when browser storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const invite = { id: 'private-first', expiresAt: Date.now() + 60000 };
    expect(claimNewInvitations('private', [invite])).toBe(true);
    expect(claimNewInvitations('private', [invite])).toBe(false);
  });
  it('keeps chess and checkers delivery separate even when invitation ids match', () => {
    const invite = { id: 'same-id', expiresAt: Date.now() + 60_000 };
    expect(claimNewInvitations('both-games', [{ ...invite, game: 'chess' }])).toBe(true);
    expect(claimNewInvitations('both-games', [{ ...invite, game: 'checkers' }])).toBe(true);
    expect(claimNewInvitations('both-games', [{ ...invite, game: 'checkers' }])).toBe(false);
  });
});

describe('notification hook lifecycle', () => {
  it('uses low-priority cancellable requests and keeps navigation on the same 5s cadence', async () => {
    await renderPortal('account:a');
    await advance(0);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/api/games/chess/notifications',
      '/api/games/checkers/notifications',
    ]);
    for (const [, init] of request.mock.calls)
      expect(init).toEqual({
        method: 'GET',
        headers: { 'x-game-presence': '1' },
        cache: 'no-store',
        priority: 'low',
        signal: expect.any(AbortSignal),
      });
    await advance(1000);
    await renderPortal('account:a');
    await advance(3999);
    expect(request).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('shares one owner across duplicate consumers and React StrictMode remounts', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(
        createElement(
          StrictMode,
          null,
          createElement(Portal, { actor: 'account:strict' }),
          createElement(Portal, { actor: 'account:strict' }),
        ),
      ),
    );
    await advance(0);
    expect(request).toHaveBeenCalledTimes(2);
    await advance(5000);
    expect(request).toHaveBeenCalledTimes(4);
    await act(async () => root!.unmount());
    root = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts requests and clears deadlines/listeners on unmount despite late transport completion', async () => {
    const pending = pendingResult();
    request.mockImplementation(() => pending.promise);
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    await renderPortal('account:leaves');
    await advance(0);
    const signals = request.mock.calls.map(([, init]) => init.signal!);
    expect(signals).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(2);
    await act(async () => root!.unmount());
    root = undefined;
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    for (const [event, listener] of added.mock.calls.filter(([event]) =>
      [
        'focus',
        'blur',
        'online',
        'offline',
        'pagehide',
        'pageshow',
        'pointerdown',
        'keydown',
      ].includes(event),
    ))
      expect(
        removed.mock.calls.some(
          ([removedEvent, removedListener]) =>
            removedEvent === event && removedListener === listener,
        ),
      ).toBe(true);
    pending.resolve({
      ok: true,
      status: 200,
      data: {
        playerId: 'old',
        incoming: [{ id: 'late-after-unmount', expiresAt: Date.now() + 60_000 }],
      },
    });
    await advance(120_000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fences old actor responses during account or seat changes without forwarding inboxes', async () => {
    const old = pendingResult();
    const broadcast = vi.fn();
    vi.stubGlobal('BroadcastChannel', broadcast);
    request.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => old.promise);
    await renderPortal('account:old');
    await advance(0);
    const oldSignals = request.mock.calls.map(([, init]) => init.signal!);
    request.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        playerId: 'new-seat-player',
        incoming: [{ id: 'seat-only', expiresAt: Date.now() + 60_000 }],
      },
    });
    await renderPortal('seat:new');
    await advance(0);
    expect(oldSignals.every((signal) => signal.aborted)).toBe(true);
    old.resolve({
      ok: true,
      status: 200,
      data: {
        playerId: 'old-account-player',
        incoming: [{ id: 'old-only', expiresAt: Date.now() + 60_000 }],
      },
    });
    await advance(0);
    const snapshot = JSON.parse(container!.textContent!);
    expect(snapshot.actor).toBe('seat:new');
    expect(snapshot.incoming.every((item: { id: string }) => item.id === 'seat-only')).toBe(true);
    expect(container!.textContent).not.toContain('old-only');
    expect(broadcast).not.toHaveBeenCalled();
    await renderPortal('');
    await advance(60_000);
    expect(JSON.parse(container!.textContent!)).toMatchObject({ actor: '', incoming: [] });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('pauses network work on visibility/offline events and catches up once on return', async () => {
    await renderPortal('account:activity');
    await advance(0);
    vi.mocked(document.hasFocus).mockReturnValue(false);
    await act(async () => window.dispatchEvent(new Event('blur')));
    await advance(10_000);
    expect(request).toHaveBeenCalledTimes(2);
    vi.mocked(document.hasFocus).mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event('focus')));
    await advance(0);
    expect(request).toHaveBeenCalledTimes(4);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await advance(60_000);
    expect(request).toHaveBeenCalledTimes(4);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await advance(60_000);
    expect(request).toHaveBeenCalledTimes(4);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event('online')));
    await advance(0);
    expect(request).toHaveBeenCalledTimes(6);
  });
});
