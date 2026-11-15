import type { GameKey } from './game-catalog';
import { useEffect, useSyncExternalStore } from 'react';
import { call } from '../api-call';
import {
  startGameNotificationCoordinator,
  type GameNotificationActivity,
  type GameNotificationInbox,
  type GameNotificationSnapshot,
} from './game-notification-coordinator';
import { observeGameNotificationActivity } from './game-notification-tabs';

interface Invitation {
  game?: GameKey;
  id: string;
  expiresAt: number;
}
interface Snapshot {
  actor: string;
  incoming: Invitation[];
  pulse: number;
  pulses: Record<GameKey, number>;
}
const empty: Snapshot = { actor: '', incoming: [], pulse: 0, pulses: { chess: 0, checkers: 0 } };
let snapshot = empty;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const publish = (value: Snapshot) => {
  snapshot = value;
  listeners.forEach((listener) => listener());
};
const memory = new Map<string, Invitation[]>();
let audio: AudioContext | undefined;
interface NotificationOwner {
  actor: string;
  subscribers: number;
  stop(): void;
}
let owner: NotificationOwner | undefined;

/** Only created/resumed by an actual gesture; autoplay restrictions remain intact. */
function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume().catch(() => undefined);
  } catch {
    /* Visual notification is always available. */
  }
}
function ping(): void {
  if (!audio || audio.state !== 'running') return;
  try {
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    const now = audio.currentTime;
    tone.type = 'sine';
    tone.frequency.setValueAtTime(784, now);
    tone.frequency.exponentialRampToValueAtTime(659, now + 0.13);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.045, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    tone.connect(gain);
    gain.connect(audio.destination);
    tone.onended = () => {
      tone.disconnect();
      gain.disconnect();
    };
    tone.start(now);
    tone.stop(now + 0.19);
  } catch {
    /* No retries or delayed sounds. */
  }
}

/** Persist delivery, not read-state: opening a page must never hide a pending invitation. */
function claimBatch(playerId: string, incoming: Invitation[]): Invitation[] {
  const key = `asa:game-alerts:v1:${playerId}`;
  const invitationKey = (item: Invitation) => `${item.game ?? 'chess'}:${item.id}`;
  let old = memory.get(key) ?? [];
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (Array.isArray(saved))
      old = [
        ...old,
        ...saved.filter(
          (item): item is Invitation =>
            !!item && typeof item.id === 'string' && typeof item.expiresAt === 'number',
        ),
      ];
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  const active = [
    ...new Map(
      old.filter((item) => item.expiresAt > Date.now()).map((item) => [invitationKey(item), item]),
    ).values(),
  ];
  const seen = new Set(active.map(invitationKey));
  const fresh = incoming.filter((item) => !seen.has(invitationKey(item)));
  const next = [...active, ...fresh].slice(-256);
  memory.set(key, next);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* Keep in-memory dedup. */
  }
  return fresh;
}
export function claimNewInvitations(playerId: string, incoming: Invitation[]): boolean {
  return claimBatch(playerId, incoming).length > 0;
}

export function useGameInvitations(): Snapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => empty,
  );
}

function createOwner(actor: string): NotificationOwner {
  const lifetime = new AbortController();
  let activity: GameNotificationActivity = 'paused';
  let deliveryVersion = 0;
  const current = (): boolean => owner === entry && !lifetime.signal.aborted;
  const deliver = ({ playerId, incoming }: GameNotificationSnapshot) => {
    if (!current()) return;
    const version = ++deliveryVersion;
    // Each tab uses its own HTTP response. Only the existing sound-delivery
    // receipts are shared, keyed by the server playerId rather than App actor.
    publish({ ...snapshot, actor, incoming });
    if (!playerId || !incoming.length) return;
    const alert = () => {
      if (!current() || version !== deliveryVersion || activity === 'paused') return;
      const fresh = claimBatch(playerId, incoming);
      if (!fresh.length) return;
      publish({
        ...snapshot,
        pulse: snapshot.pulse + 1,
        pulses: {
          chess: snapshot.pulses.chess + (fresh.some((item) => item.game === 'chess') ? 1 : 0),
          checkers:
            snapshot.pulses.checkers + (fresh.some((item) => item.game === 'checkers') ? 1 : 0),
        },
      });
      ping();
    };
    if (navigator.locks) {
      void navigator.locks
        .request(`asa-game-alerts:${playerId}`, { signal: lifetime.signal }, alert)
        .catch(() => alert());
    } else alert();
  };
  const coordinator = startGameNotificationCoordinator({
    request: (game, signal) =>
      call<GameNotificationInbox>(`/api/games/${game}/notifications`, {
        method: 'GET',
        headers: { 'x-game-presence': '1' },
        cache: 'no-store',
        priority: 'low',
        signal,
      }),
    publish: deliver,
  });
  const unobserve = observeGameNotificationActivity((next) => {
    activity = next;
    coordinator.setActivity(next);
  });
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
  const entry: NotificationOwner = {
    actor,
    subscribers: 0,
    stop() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      coordinator.stop();
      unobserve();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      if (owner === entry) {
        owner = undefined;
        publish(empty);
      }
    },
  };
  return entry;
}

/** One authenticated App owner, including editors. Navigation never restarts delivery. */
export function usePortalGameNotifications(actor: string): void {
  useEffect(() => {
    if (!actor) {
      owner?.stop();
      if (snapshot.actor) publish(empty);
      return;
    }
    if (owner?.actor !== actor) {
      owner?.stop();
      publish({ ...empty, actor });
      owner = createOwner(actor);
    }
    const retained = owner;
    retained.subscribers += 1;
    return () => {
      retained.subscribers -= 1;
      if (!retained.subscribers) retained.stop();
    };
  }, [actor]);
}
