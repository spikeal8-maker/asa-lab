import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLifecycleCancellation } from '../auth-request';
import {
  startGameNotificationCoordinator,
  type GameNotificationResult,
  type GameNotificationSnapshot,
} from './game-notification-coordinator';
import type { GameKey } from './game-catalog';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const ok = (
  incoming: { id: string; expiresAt: number }[] = [],
  playerId = 'player-a',
): GameNotificationResult => ({ ok: true, status: 200, data: { playerId, incoming } });
const failure = (status: number, retryAfterMs?: number): GameNotificationResult => ({
  ok: false,
  status,
  error: {
    code: status === 0 ? 'network' : 'unavailable',
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('production notification coordinator', () => {
  it('finds a new invitation on the next 5s poll after both shared-player inboxes were empty', async () => {
    let incoming: { id: string; expiresAt: number }[] = [];
    const snapshots: GameNotificationSnapshot[] = [];
    const coordinator = startGameNotificationCoordinator({
      request: async (game) => ok(game === 'chess' ? incoming : [], 'fixture-player'),
      publish: (snapshot) => snapshots.push(snapshot),
      activity: 'active',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshots.at(-1)).toEqual({ playerId: 'fixture-player', incoming: [] });
    incoming = [{ id: 'new-real-invitation', expiresAt: 60_000 }];
    await vi.advanceTimersByTimeAsync(4999);
    expect(snapshots.at(-1)?.incoming).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshots.at(-1)).toEqual({
      playerId: 'fixture-player',
      incoming: [{ game: 'chess', id: 'new-real-invitation', expiresAt: 60_000 }],
    });
    coordinator.stop();
  });

  it('delivers a fast channel immediately while the slow channel stays single-flight', async () => {
    const slow = deferred<GameNotificationResult>();
    const snapshots: GameNotificationSnapshot[] = [];
    const request = vi.fn((game: GameKey) =>
      game === 'chess'
        ? slow.promise
        : Promise.resolve(ok([{ id: 'checkers-now', expiresAt: 60_000 }])),
    );
    const coordinator = startGameNotificationCoordinator({
      request,
      publish: (snapshot) => snapshots.push(snapshot),
      activity: 'active',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshots.at(-1)?.incoming).toEqual([
      { game: 'checkers', id: 'checkers-now', expiresAt: 60_000 },
    ]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(request.mock.calls.filter(([game]) => game === 'chess')).toHaveLength(1);
    expect(request.mock.calls.filter(([game]) => game === 'checkers')).toHaveLength(3);
    slow.resolve(ok([{ id: 'chess-later', expiresAt: 60_000 }]));
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshots.at(-1)?.incoming.map((item) => item.id)).toEqual([
      'chess-later',
      'checkers-now',
    ]);
    await vi.advanceTimersByTimeAsync(4999);
    expect(request.mock.calls.filter(([game]) => game === 'chess')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(request.mock.calls.filter(([game]) => game === 'chess')).toHaveLength(2);
    coordinator.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 429, 503])(
    'backs off resolved !ok status %s per channel and restores the healthy 5s cadence',
    async (status) => {
      const chessAttempts: number[] = [];
      const checkersAttempts: number[] = [];
      const coordinator = startGameNotificationCoordinator({
        request: async (game) => {
          if (game === 'checkers') {
            checkersAttempts.push(Date.now());
            return ok();
          }
          chessAttempts.push(Date.now());
          return chessAttempts.length <= 2 ? failure(status) : ok();
        },
        publish: () => undefined,
        activity: 'active',
        random: () => 0,
      });
      await vi.advanceTimersByTimeAsync(7499);
      expect(chessAttempts).toEqual([0]);
      expect(checkersAttempts).toEqual([0, 5000]);
      await vi.advanceTimersByTimeAsync(1);
      expect(chessAttempts).toEqual([0, 7500]);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(chessAttempts).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(chessAttempts).toEqual([0, 7500, 22_500]);
      await vi.advanceTimersByTimeAsync(5000);
      expect(chessAttempts).toEqual([0, 7500, 22_500, 27_500]);
      coordinator.stop();
    },
  );

  it('handles a thrown network failure without a hot retry loop', async () => {
    const request = vi.fn(async () => {
      throw new TypeError('offline');
    });
    const coordinator = startGameNotificationCoordinator({
      request,
      publish: () => undefined,
      activity: 'active',
      random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(7499);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(4);
    coordinator.stop();
  });

  it('keeps Retry-After and failure history across focus and online event storms', async () => {
    const attempts: number[] = [];
    const coordinator = startGameNotificationCoordinator({
      request: async (game) => {
        if (game === 'chess') attempts.push(Date.now());
        return failure(429, 45_000);
      },
      publish: () => undefined,
      activity: 'active',
      random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(5000);
    for (let index = 0; index < 50; index += 1) {
      coordinator.setActivity('background');
      coordinator.setActivity('active');
      coordinator.setActivity('paused');
      coordinator.setActivity('active');
    }
    await vi.advanceTimersByTimeAsync(39_999);
    expect(attempts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([0, 45_000]);
    await vi.advanceTimersByTimeAsync(44_999);
    expect(attempts).toHaveLength(2);
    coordinator.stop();
  });

  it('spreads failed clients with bounded jitter rather than synchronized retries', async () => {
    const attempts: number[][] = [[], []];
    const coordinators = [0, 1].map((random, index) =>
      startGameNotificationCoordinator({
        request: async (game) => {
          if (game === 'chess') attempts[index]!.push(Date.now());
          return failure(503);
        },
        publish: () => undefined,
        activity: 'active',
        random: () => random,
      }),
    );
    await vi.advanceTimersByTimeAsync(190_000);
    expect(attempts[0]!.slice(0, 5)).toEqual([0, 7500, 22_500, 52_500, 97_500]);
    expect(attempts[1]!.slice(0, 5)).toEqual([0, 10_000, 30_000, 70_000, 130_000]);
    for (const client of attempts)
      for (let index = 1; index < client.length; index += 1)
        expect(client[index]! - client[index - 1]!).toBeLessThanOrEqual(60_000);
    coordinators.forEach((coordinator) => coordinator.stop());
  });

  it('adds positive jitter after a shared Retry-After instead of synchronizing every client', async () => {
    const attempts: number[][] = [[], []];
    const coordinators = [0, 1].map((random, index) =>
      startGameNotificationCoordinator({
        request: async (game) => {
          if (game === 'chess') attempts[index]!.push(Date.now());
          return failure(429, 45_000);
        },
        publish: () => undefined,
        activity: 'active',
        random: () => random,
      }),
    );
    await vi.advanceTimersByTimeAsync(44_999);
    expect(attempts).toEqual([[0], [0]]);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([[0, 45_000], [0]]);
    await vi.advanceTimersByTimeAsync(4500);
    expect(attempts).toEqual([
      [0, 45_000],
      [0, 49_500],
    ]);
    coordinators.forEach((coordinator) => coordinator.stop());
  });

  it('aborts a timed-out channel without opening new flights when transport ignores abort', async () => {
    const stalled = deferred<GameNotificationResult>();
    const snapshots: GameNotificationSnapshot[] = [];
    const request = vi.fn<(game: GameKey, signal: AbortSignal) => Promise<GameNotificationResult>>(
      (game) => (game === 'chess' ? stalled.promise : Promise.resolve(ok())),
    );
    const coordinator = startGameNotificationCoordinator({
      request,
      publish: (snapshot) => snapshots.push(snapshot),
      activity: 'active',
      random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(12_000);
    const stalledSignal = request.mock.calls.find(([game]) => game === 'chess')![1];
    expect(stalledSignal.aborted).toBe(true);
    expect(stalledSignal.reason).toBeInstanceOf(DOMException);
    expect(stalledSignal.reason.name).toBe('TimeoutError');
    expect(isLifecycleCancellation(stalledSignal.reason)).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(request.mock.calls.filter(([game]) => game === 'chess')).toHaveLength(1);
    expect(request.mock.calls.filter(([game]) => game === 'checkers').length).toBeGreaterThan(20);
    coordinator.stop();
    const published = snapshots.length;
    expect(vi.getTimerCount()).toBe(0);
    stalled.resolve(ok([{ id: 'late', expiresAt: 300_000 }]));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(snapshots).toHaveLength(published);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans deadlines on pause and waits for cancelled transports before resuming', async () => {
    const pending = [deferred<GameNotificationResult>(), deferred<GameNotificationResult>()];
    const published = vi.fn();
    let attempts = 0;
    const request = vi.fn<(game: GameKey, signal: AbortSignal) => Promise<GameNotificationResult>>(
      () => pending[attempts++]?.promise ?? Promise.resolve(ok()),
    );
    const coordinator = startGameNotificationCoordinator({
      request,
      publish: published,
      activity: 'active',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(2);
    coordinator.setActivity('paused');
    expect(request.mock.calls.every(([, signal]) => signal.aborted)).toBe(true);
    expect(request.mock.calls.every(([, signal]) => isLifecycleCancellation(signal.reason))).toBe(
      true,
    );
    expect(vi.getTimerCount()).toBe(0);
    coordinator.setActivity('active');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(2);
    pending.forEach((flight) => flight.resolve(ok([{ id: 'cancelled', expiresAt: 120_000 }])));
    await vi.advanceTimersByTimeAsync(0);
    expect(published.mock.calls.every(([value]) => value.incoming.length === 0)).toBe(true);
    expect(request).toHaveBeenCalledTimes(4);
    coordinator.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reduces inactive-window traffic to 30s and catches up stale data on focus', async () => {
    const attempts: number[] = [];
    const coordinator = startGameNotificationCoordinator({
      request: async (game) => {
        if (game === 'chess') attempts.push(Date.now());
        return ok([{ id: 'thirty-minute-invite', expiresAt: 1_800_000 }]);
      },
      publish: () => undefined,
      activity: 'background',
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempts).toEqual([0]);
    coordinator.setActivity('active');
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toEqual([0, 10_000]);
    for (let index = 0; index < 10; index += 1) {
      coordinator.setActivity('background');
      coordinator.setActivity('active');
    }
    await vi.advanceTimersByTimeAsync(4999);
    expect(attempts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([0, 10_000, 15_000]);
    coordinator.setActivity('background');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(attempts).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([0, 10_000, 15_000, 45_000]);
    coordinator.stop();
  });

  it('retains valid invitations on transient failure and expires them while offline', async () => {
    const snapshots: GameNotificationSnapshot[] = [];
    const coordinator = startGameNotificationCoordinator({
      request: async (game) =>
        game === 'chess' && Date.now() === 0
          ? ok([{ id: 'expires-offline', expiresAt: 14_000 }])
          : game === 'chess'
            ? failure(503)
            : ok(),
      publish: (snapshot) => snapshots.push(snapshot),
      activity: 'active',
      random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(snapshots.at(-1)?.incoming).toHaveLength(1);
    coordinator.setActivity('paused');
    await vi.advanceTimersByTimeAsync(9000);
    expect(snapshots.at(-1)?.incoming).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    coordinator.stop();
  });

  it('never combines server identities when a cookie changes before the App actor', async () => {
    const snapshots: GameNotificationSnapshot[] = [];
    const request = vi.fn(async (game: GameKey) =>
      ok(
        [{ id: `${game}-private`, expiresAt: 60_000 }],
        game === 'chess' ? 'old-player' : 'new-player',
      ),
    );
    startGameNotificationCoordinator({
      request,
      publish: (snapshot) => snapshots.push(snapshot),
      activity: 'active',
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(snapshots.every((snapshot) => snapshot.incoming.length <= 1)).toBe(true);
    expect(snapshots.at(-1)).toEqual({ playerId: '', incoming: [] });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears a cancelled session scope and resumes fresh reads after it settles', async () => {
    const attempts: number[] = [];
    const request = vi.fn(async (game: GameKey): Promise<GameNotificationResult> => {
      if (game === 'chess') {
        attempts.push(Date.now());
        if (attempts.length === 1)
          return { ok: false, status: 0, error: { code: 'request_cancelled' } };
      }
      return ok();
    });
    const publish = vi.fn();
    const coordinator = startGameNotificationCoordinator({ request, publish, activity: 'active' });
    await vi.advanceTimersByTimeAsync(4999);
    expect(attempts).toEqual([0]);
    expect(publish).toHaveBeenLastCalledWith({ playerId: '', incoming: [] });
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([0, 5000]);
    expect(publish).toHaveBeenLastCalledWith({ playerId: 'player-a', incoming: [] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(attempts).toEqual([0, 5000, 10_000]);
    coordinator.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a failed channel Retry-After when another channel loses its session epoch', async () => {
    const attempts: number[] = [];
    let checkersAttempts = 0;
    const coordinator = startGameNotificationCoordinator({
      request: async (game) => {
        if (game === 'chess') {
          attempts.push(Date.now());
          return failure(429, 45_000);
        }
        checkersAttempts += 1;
        return checkersAttempts === 2
          ? { ok: false, status: 0, error: { code: 'request_cancelled' } }
          : ok();
      },
      publish: () => undefined,
      activity: 'active',
      random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(44_999);
    expect(attempts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([0, 45_000]);
    coordinator.stop();
  });

  it('clears unauthorized badges and checks denied channels slowly', async () => {
    const times: number[] = [];
    const publish = vi.fn();
    const coordinator = startGameNotificationCoordinator({
      request: async (game) => {
        if (game === 'checkers') return ok();
        times.push(Date.now());
        return times.length === 1 ? ok([{ id: 'revoked', expiresAt: 60_000 }]) : failure(403);
      },
      publish,
      activity: 'active',
      random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(publish.mock.calls.at(-1)?.[0].incoming).toEqual([]);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(times).toEqual([0, 5000]);
    await vi.advanceTimersByTimeAsync(1);
    expect(times).toEqual([0, 5000, 35_000]);
    coordinator.stop();
  });
});
