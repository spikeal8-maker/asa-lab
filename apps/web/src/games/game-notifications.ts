import { useEffect, useSyncExternalStore } from 'react';
import { call } from '../api-call';
import { startLivePoll } from '../chess/live-poll';

interface Invitation {
  id: string;
  expiresAt: number;
}
interface Snapshot {
  actor: string;
  incoming: Invitation[];
  pulse: number;
}
const empty: Snapshot = { actor: '', incoming: [], pulse: 0 };
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
export function claimNewInvitations(playerId: string, incoming: Invitation[]): boolean {
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
  return fresh.length > 0;
}

export function useGameInvitations(): Snapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => empty,
  );
}

/** One authenticated App owner, including editors. Navigation never restarts delivery. */
export function usePortalGameNotifications(actor: string): Snapshot {
  const value = useGameInvitations();
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
        const result = await Promise.race([
          call<{ playerId: string; incoming: Invitation[] }>('/api/games/chess/notifications', {
            method: 'POST',
            body: '{}',
            cache: 'no-store',
            signal: controller.signal,
          }),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => {
              controller.abort();
              resolve(null);
            }, 12000);
          }),
        ]);
        clearTimeout(timer);
        if (!isCurrent() || snapshot.actor !== actor) return;
        if (!result?.ok) {
          publish({ ...snapshot, incoming: [] });
          return;
        }
        const data = result.data;
        if (!data || typeof data.playerId !== 'string' || !Array.isArray(data.incoming)) return;
        const incoming = data.incoming
          .filter(
            (item) =>
              typeof item.id === 'string' &&
              Number.isFinite(item.expiresAt) &&
              item.expiresAt > Date.now(),
          )
          .slice(0, 8);
        const deliver = () => {
          if (!isCurrent() || snapshot.actor !== actor || document.visibilityState === 'hidden')
            return;
          const fresh = claimNewInvitations(data.playerId, incoming);
          publish({ actor, incoming, pulse: snapshot.pulse + (fresh ? 1 : 0) });
          if (fresh) ping();
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
  return value.actor === actor ? value : empty;
}
