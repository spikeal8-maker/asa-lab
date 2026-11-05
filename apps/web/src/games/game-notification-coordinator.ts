import type { GameKey } from './game-catalog';

export const GAME_NOTIFICATION_INTERVAL_MS = 5000;
// Invitations live for 30 minutes; successful 30s polls also keep the server's
// 45s presence lease alive in a visible window that is not being used.
export const GAME_NOTIFICATION_BACKGROUND_MS = 30_000;
export const GAME_NOTIFICATION_TIMEOUT_MS = 12_000;
export const GAME_NOTIFICATION_BACKOFF_MAX_MS = 60_000;

export type GameNotificationActivity = 'active' | 'background' | 'paused';

export interface GameInvitation {
  game: GameKey;
  id: string;
  expiresAt: number;
}

export interface GameNotificationInbox {
  playerId: string;
  incoming: { id: string; expiresAt: number }[];
}

export type GameNotificationResult =
  | { ok: true; status: number; data: GameNotificationInbox }
  | { ok: false; status: number; error: { code: string; retryAfterMs?: number } };

export interface GameNotificationSnapshot {
  playerId: string;
  incoming: GameInvitation[];
}

type Timer = ReturnType<typeof setTimeout>;
interface Clock {
  now(): number;
  setTimeout(callback: () => void, delay: number): Timer;
  clearTimeout(timer: Timer | undefined): void;
}

export interface GameNotificationCoordinatorOptions {
  request(game: GameKey, signal: AbortSignal): Promise<GameNotificationResult>;
  publish(snapshot: GameNotificationSnapshot): void;
  activity?: GameNotificationActivity;
  random?: () => number;
  clock?: Clock;
}

interface Flight {
  controller: AbortController;
  deadline: Timer | undefined;
  cancelled: boolean;
  timedOut: boolean;
}

interface Channel {
  game: GameKey;
  incoming: GameInvitation[];
  failures: number;
  retryAt: number;
  settledAt?: number;
  timer: Timer | undefined;
  flight: Flight | undefined;
}

/**
 * Two independent, single-flight channels. The same production implementation
 * can run in a browser or a deterministic load harness without importing React.
 * A cancelled transport retains its slot until it settles, even if it ignores
 * AbortSignal. Its result can never publish or create another timer after stop.
 */
export function startGameNotificationCoordinator(options: GameNotificationCoordinatorOptions): {
  setActivity(activity: GameNotificationActivity): void;
  stop(): void;
} {
  const clock: Clock = options.clock ?? {
    now: () => Date.now(),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (timer) => clearTimeout(timer),
  };
  const random = options.random ?? Math.random;
  const channels: Channel[] = (['chess', 'checkers'] as const).map((game) => ({
    game,
    incoming: [],
    failures: 0,
    retryAt: 0,
    timer: undefined,
    flight: undefined,
  }));
  let activity = options.activity ?? 'paused';
  let stopped = false;
  let playerId: string | undefined;
  let expiryTimer: Timer | undefined;

  function publish(): void {
    clock.clearTimeout(expiryTimer);
    expiryTimer = undefined;
    const now = clock.now();
    for (const channel of channels)
      channel.incoming = channel.incoming.filter((item) => item.expiresAt > now);
    const incoming = channels.flatMap((channel) => channel.incoming);
    options.publish({ playerId: playerId ?? '', incoming });
    if (!stopped && incoming.length) {
      const expiresAt = Math.min(...incoming.map((item) => item.expiresAt));
      expiryTimer = clock.setTimeout(publish, Math.min(expiresAt - now, 2_147_483_647));
    }
  }

  function cancel(channel: Channel): void {
    clock.clearTimeout(channel.timer);
    channel.timer = undefined;
    const flight = channel.flight;
    if (flight) {
      flight.cancelled = true;
      clock.clearTimeout(flight.deadline);
      flight.deadline = undefined;
      flight.controller.abort();
    }
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    channels.forEach(cancel);
    clock.clearTimeout(expiryTimer);
    expiryTimer = undefined;
  }

  function rejectIdentity(): void {
    // A cookie may change before the App's actor catches up. Never combine two
    // server player identities or keep polling with a known stale actor binding.
    stop();
    playerId = undefined;
    for (const channel of channels) channel.incoming = [];
    publish();
  }

  function cancelledScope(): void {
    // A queued request can lose its session epoch while the same account's
    // workspace or capabilities are changing. Drop that epoch's data, retain
    // the player fence/backoff, and allow a fresh read once the scope settles.
    const retryAt = clock.now() + GAME_NOTIFICATION_INTERVAL_MS;
    for (const channel of channels) {
      cancel(channel);
      channel.incoming = [];
      channel.retryAt = Math.max(channel.retryAt, retryAt);
    }
    publish();
    channels.forEach(schedule);
  }

  function failed(channel: Channel, status: number, retryAfterMs = 0): void {
    channel.failures = Math.min(channel.failures + 1, 4);
    channel.settledAt = clock.now();
    const exponential = Math.min(
      GAME_NOTIFICATION_BACKOFF_MAX_MS,
      GAME_NOTIFICATION_INTERVAL_MS * 2 ** channel.failures,
    );
    const randomFraction = Math.max(0, Math.min(1, random()));
    const jitter = 0.75 + randomFraction * 0.25;
    const serverDelay = Number.isFinite(retryAfterMs)
      ? Math.max(0, Math.min(GAME_NOTIFICATION_BACKOFF_MAX_MS, retryAfterMs))
      : 0;
    const deniedDelay = status === 401 || status === 403 || status === 404 ? 30_000 : 0;
    const minimumDelay = Math.max(serverDelay, deniedDelay);
    // A shared Retry-After must not synchronize the whole class at its expiry.
    // Never retry before it; spread the next attempt by at most 5s afterwards.
    const advisedDelay = minimumDelay + Math.min(5000, minimumDelay * 0.1) * randomFraction;
    channel.retryAt = channel.settledAt + Math.max(exponential * jitter, advisedDelay);
    if (status === 401 || status === 403 || status === 404) channel.incoming = [];
    // Transient errors retain still-valid invitations. Their own expiry timer
    // removes stale badges even while the network is unavailable.
    publish();
  }

  function succeeded(channel: Channel, data: GameNotificationInbox): void {
    if (
      !data ||
      typeof data.playerId !== 'string' ||
      !data.playerId ||
      !Array.isArray(data.incoming)
    ) {
      failed(channel, 0);
      return;
    }
    if (playerId !== undefined && playerId !== data.playerId) {
      rejectIdentity();
      return;
    }
    playerId = data.playerId;
    channel.failures = 0;
    channel.retryAt = 0;
    channel.settledAt = clock.now();
    channel.incoming = data.incoming
      .filter(
        (item) =>
          !!item &&
          typeof item.id === 'string' &&
          item.id.length > 0 &&
          Number.isFinite(item.expiresAt) &&
          item.expiresAt > clock.now(),
      )
      .slice(0, 8)
      .map((item) => ({ game: channel.game, id: item.id, expiresAt: item.expiresAt }));
    publish();
  }

  function schedule(channel: Channel): void {
    clock.clearTimeout(channel.timer);
    channel.timer = undefined;
    if (stopped || activity === 'paused' || channel.flight) return;
    const interval =
      activity === 'active' ? GAME_NOTIFICATION_INTERVAL_MS : GAME_NOTIFICATION_BACKGROUND_MS;
    const dueAt = Math.max(
      channel.retryAt,
      channel.settledAt === undefined ? clock.now() : channel.settledAt + interval,
    );
    channel.timer = clock.setTimeout(
      () => {
        channel.timer = undefined;
        void run(channel);
      },
      Math.max(0, dueAt - clock.now()),
    );
  }

  async function run(channel: Channel): Promise<void> {
    if (stopped || activity === 'paused' || channel.flight) return;
    const flight: Flight = {
      controller: new AbortController(),
      deadline: undefined,
      cancelled: false,
      timedOut: false,
    };
    channel.flight = flight;
    flight.deadline = clock.setTimeout(() => {
      flight.deadline = undefined;
      if (stopped || flight.cancelled) return;
      flight.timedOut = true;
      failed(channel, 0);
      flight.controller.abort();
    }, GAME_NOTIFICATION_TIMEOUT_MS);
    try {
      const result = await options.request(channel.game, flight.controller.signal);
      if (stopped || flight.cancelled || flight.timedOut) return;
      if (result.ok) succeeded(channel, result.data);
      else if (result.error.code === 'request_cancelled' || result.error.code === 'auth_cancelled')
        cancelledScope();
      else failed(channel, result.status, result.error.retryAfterMs);
    } catch {
      if (!stopped && !flight.cancelled && !flight.timedOut) failed(channel, 0);
    } finally {
      clock.clearTimeout(flight.deadline);
      channel.flight = undefined;
      schedule(channel);
    }
  }

  channels.forEach(schedule);
  return {
    setActivity(nextActivity) {
      if (stopped || nextActivity === activity) return;
      activity = nextActivity;
      if (activity === 'paused') channels.forEach(cancel);
      else channels.forEach(schedule);
      // Normal freshness is recalculated, but retryAt and failure history stay
      // intact. Focus/online events cannot bypass backoff or Retry-After.
    },
    stop,
  };
}
