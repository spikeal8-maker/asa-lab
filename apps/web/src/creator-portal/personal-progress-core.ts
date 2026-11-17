import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { api, type AccountAvatar, type ApiResult } from '../api';
import { abortable, lifecycleCancellation } from '../auth-request';
import { subscribeTelemetry, telemetryContext, type TelemetryContext } from '../telemetry-context';
import { actorKey } from '../telemetry-contract';
import { portalSessionEpoch, subscribePortalSession } from '../portal-requests';
import { PROFILE_AVATAR_CHANGED_EVENT } from './default-avatars';

/** Own UI presentation, never an authentication payload or an access decision. */
export type OwnProgressActor =
  | { readonly kind: 'account'; readonly accountId: string; readonly displayName: string }
  | {
      readonly kind: 'seat';
      readonly seatId: string;
      readonly classroomId: string;
      readonly displayName: string;
      readonly avatarKey: string | null;
    };

function lifetimeKey(
  actor: OwnProgressActor | null,
  context: TelemetryContext,
  sessionEpoch: number,
): string | null {
  const active = context.actor;
  if (!actor || !context.ready || !active) return null;
  const matches =
    actor.kind === 'account'
      ? active.kind === 'account' && active.accountId === actor.accountId.toLowerCase()
      : active.kind === 'student' &&
        active.seatId === actor.seatId.toLowerCase() &&
        active.classId === actor.classroomId.toLowerCase();
  return matches
    ? `${actorKey(active)}:${context.generation}:${context.continuity}:${sessionEpoch}`
    : null;
}

export interface ProgressLifetime {
  readonly key: string | null;
  readonly current: () => string | null;
}

export function useProgressLifetime(actor: OwnProgressActor | null): ProgressLifetime {
  const context = useSyncExternalStore(subscribeTelemetry, telemetryContext, telemetryContext);
  const sessionEpoch = useSyncExternalStore(
    subscribePortalSession,
    portalSessionEpoch,
    portalSessionEpoch,
  );
  const kind = actor?.kind;
  const id = actor?.kind === 'account' ? actor.accountId : actor?.seatId;
  const classroom = actor?.kind === 'seat' ? actor.classroomId : undefined;
  // Names and avatar choices do not change the ownership of a response.
  const current = useCallback(
    () => lifetimeKey(actor, telemetryContext(), portalSessionEpoch()),
    [kind, id, classroom],
  );
  const key = lifetimeKey(actor, context, sessionEpoch);
  return useMemo(() => ({ key, current }), [key, current]);
}

type SharedResource = 'summary' | 'avatar';
interface SharedSnapshot<T> {
  readonly data: T | null;
  readonly error: { readonly status: number; readonly message: string } | null;
  readonly settled: boolean;
}
interface SharedRead {
  readonly lifetime: ProgressLifetime;
  readonly listeners: Set<() => void>;
  readonly read: (signal: AbortSignal) => Promise<ApiResult<unknown>>;
  snapshot: SharedSnapshot<unknown>;
  controller: AbortController | null;
  version: number;
  dispose: () => void;
}
const sharedReads = new Map<string, SharedRead>();
const pendingSnapshot: SharedSnapshot<never> = { data: null, error: null, settled: false };
const inactiveSnapshot: SharedSnapshot<never> = { ...pendingSnapshot, settled: true };
// Entries are created only for a non-null lifetime; retirement never changes that key.
const isCurrentRead = (entry: SharedRead): boolean =>
  entry.lifetime.current() === entry.lifetime.key;

function publishRead(entry: SharedRead, snapshot: SharedSnapshot<unknown>): void {
  entry.snapshot = snapshot;
  for (const listener of entry.listeners) listener();
}

function retireTransport(entry: SharedRead): void {
  entry.version += 1;
  entry.controller?.abort(lifecycleCancellation());
  entry.controller = null;
}

function startSharedRead(entry: SharedRead, invalidate = false): void {
  if (!isCurrentRead(entry) || entry.listeners.size === 0) return;
  // Repeated user retries join the current attempt. A real mutation supersedes it.
  if (entry.controller && !invalidate) return;
  retireTransport(entry);
  const version = entry.version;
  const controller = new AbortController();
  entry.controller = controller;
  publishRead(entry, pendingSnapshot);
  const current = () =>
    !controller.signal.aborted && entry.version === version && isCurrentRead(entry);
  void abortable(() => entry.read(controller.signal), controller.signal)
    .then((result) => {
      if (!current()) return;
      publishRead(entry, {
        settled: true,
        data: result.ok ? result.data : null,
        error: result.ok ? null : { status: result.status, message: result.error.message },
      });
    })
    .catch(() => {
      if (current())
        publishRead(entry, {
          data: null,
          settled: true,
          error: { status: 0, message: 'Не удалось получить данные.' },
        });
    })
    .finally(() => {
      if (entry.controller === controller) entry.controller = null;
    });
}

function replaceSharedRead(entry: SharedRead, data: unknown): void {
  if (!isCurrentRead(entry)) return;
  retireTransport(entry);
  publishRead(entry, { data, error: null, settled: true });
}

/** Only the two own-profile resources share settled state, while consumers exist.
 * The key includes the proven actor, trusted workspace/class and session lifetime.
 * Generic section reads and cursor pages retain their independent read contract. */
export function useSharedPersonalRead<T>(
  lifetime: ProgressLifetime,
  resource: SharedResource,
  read: (signal: AbortSignal) => Promise<ApiResult<T>>,
  observeChanges?: (invalidate: () => void) => () => void,
) {
  const key = lifetime.key ? `${lifetime.key}:${resource}` : null;
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!key || lifetime.current() !== lifetime.key) return () => undefined;
      let entry = sharedReads.get(key);
      if (!entry) {
        const created: SharedRead = {
          lifetime,
          listeners: new Set(),
          read,
          snapshot: pendingSnapshot,
          controller: null,
          version: 0,
          dispose: () => undefined,
        };
        sharedReads.set(key, created);
        let route = telemetryContext().route;
        const retireContext = () => {
          if (isCurrentRead(created)) return false;
          created.dispose();
          publishRead(created, pendingSnapshot);
          return true;
        };
        const stopContext = subscribeTelemetry((context) => {
          if (!retireContext() && context.route !== route) {
            route = context.route;
            if (route === 'home' || route === 'learning') startSharedRead(created, true);
          }
        });
        const stopMutation = observeChanges?.(() => startSharedRead(created, true));
        const stopSession = subscribePortalSession(retireContext);
        const avatarChanged = (event: Event) => {
          replaceSharedRead(created, {
            avatarDataUrl: (event as CustomEvent<string | null>).detail,
          });
        };
        if (resource === 'avatar')
          window.addEventListener(PROFILE_AVATAR_CHANGED_EVENT, avatarChanged);
        created.dispose = () => {
          retireTransport(created);
          stopContext();
          stopMutation?.();
          stopSession();
          if (resource === 'avatar')
            window.removeEventListener(PROFILE_AVATAR_CHANGED_EVENT, avatarChanged);
          if (sharedReads.get(key) === created) sharedReads.delete(key);
        };
        entry = created;
      }
      const shared = entry;
      shared.listeners.add(listener);
      if (!shared.snapshot.settled && !shared.controller) startSharedRead(shared);
      return () => {
        shared.listeners.delete(listener);
        if (shared.listeners.size === 0) shared.dispose();
      };
    },
    [key, lifetime, resource, read, observeChanges],
  );
  const getSnapshot = useCallback(
    () =>
      key && lifetime.current() === lifetime.key
        ? (sharedReads.get(key)?.snapshot ?? pendingSnapshot)
        : inactiveSnapshot,
    [key, lifetime],
  );
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot) as SharedSnapshot<T>;
  const reload = useCallback(() => {
    const entry = key ? sharedReads.get(key) : null;
    if (entry) startSharedRead(entry);
  }, [key]);
  const replace = useCallback(
    (data: T) => {
      const entry = key ? sharedReads.get(key) : null;
      if (entry) replaceSharedRead(entry, data);
    },
    [key],
  );
  return { ...value, loading: !value.settled, reload, replace };
}

const readAccountAvatar = (signal: AbortSignal) => api.accountAvatar(signal);
export function useAccountAvatar(lifetime: ProgressLifetime) {
  return useSharedPersonalRead<AccountAvatar>(lifetime, 'avatar', readAccountAvatar);
}
