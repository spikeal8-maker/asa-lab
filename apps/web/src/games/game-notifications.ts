import type { GameKey } from './game-catalog';
import { useEffect, useSyncExternalStore } from 'react';
import { call } from '../api-call';
import { startLivePoll } from '../chess/live-poll';

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
      old.filter((item) => item.expiresAt > Date.now()).map((item) => [item.id, item]),
    ).values(),
  ];
  const seen = new Set(active.map((item) => item.id));
  const fresh = incoming.filter((item) => !seen.has(item.id));
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

/** One authenticated App owner, including editors. Navigation never restarts delivery. */
export function usePortalGameNotifications(actor: string): void {
  useEffect(() => {
    if (snapshot.actor !== actor) publish({ ...empty, actor });
    if (!actor) return;
    let pending: AbortController | undefined;
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    const stop = startLivePoll(
      async (isCurrent) => {
        if (document.visibilityState === 'hidden' || navigator.onLine === false) return;
        const controller = new AbortController();
        pending = controller;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const games = ['chess', 'checkers'] as const;
        const results = await Promise.race([
          Promise.all(
            games.map(async (game) => ({
              game,
              result: await call<{ playerId: string; incoming: Invitation[] }>(
                `/api/games/${game}/notifications`,
                {
                  method: 'GET',
                  headers: { 'x-game-presence': '1' },
                  cache: 'no-store',
                  signal: controller.signal,
                },
              ),
            })),
          ),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => {
              controller.abort();
              resolve(null);
            }, 12000);
          }),
        ]);
        clearTimeout(timer);
        if (!isCurrent() || snapshot.actor !== actor) return;
        const valid =
          results?.flatMap(({ game, result }) =>
            result.ok &&
            result.data &&
            typeof result.data.playerId === 'string' &&
            Array.isArray(result.data.incoming)
              ? [{ game, data: result.data }]
              : [],
          ) ?? [];
        const data = valid[0]?.data;
        if (!data) {
          publish({ ...snapshot, incoming: [] });
          return;
        }
        const incoming = valid
          .filter((item) => item.data.playerId === data.playerId)
          .flatMap(({ game, data }) =>
            data.incoming
              .filter(
                (item) =>
                  !!item &&
                  typeof item.id === 'string' &&
                  Number.isFinite(item.expiresAt) &&
                  item.expiresAt > Date.now(),
              )
              .slice(0, 8)
              .map((item) => ({ ...item, game })),
          );
        const deliver = () => {
          if (!isCurrent() || snapshot.actor !== actor || document.visibilityState === 'hidden')
            return;
          const fresh = claimBatch(data.playerId, incoming);
          publish({
            actor,
            incoming,
            pulse: snapshot.pulse + (fresh.length ? 1 : 0),
            pulses: {
              chess:
                snapshot.pulses.chess +
                (fresh.some((item) => (item.game ?? 'chess') === 'chess') ? 1 : 0),
              checkers:
                snapshot.pulses.checkers + (fresh.some((item) => item.game === 'checkers') ? 1 : 0),
            },
          });
          if (fresh.length) ping();
        };
        if (navigator.locks)
          await navigator.locks.request(`asa-game-alerts:${data.playerId}`, deliver);
        else deliver();
      },
      5000,
      () => {
        if (snapshot.actor === actor) publish({ ...snapshot, incoming: [] });
      },
    );
    return () => {
      stop();
      pending?.abort();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      if (snapshot.actor === actor) publish(empty);
    };
  }, [actor]);
}
