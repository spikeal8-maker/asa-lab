import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type {
  PersonalProgressSummaryV1,
  OwnProgressGroupV1,
  GroupRatingPageV1,
  GroupRatingAvatarBatchV1,
  GroupRatingPeerV1,
} from '@asa-lab/contracts';
import { api, type ApiResult, type LearnerQuiz, type SeatAssignment } from '../api';
import { call } from '../api-call';
import { abortable, lifecycleCancellation } from '../auth-request';
import { subscribeTelemetry, telemetryContext, type TelemetryContext } from '../telemetry-context';
import {
  defaultAvatarForAccount,
  PROFILE_AVATAR_CHANGED_EVENT,
  seatAvatar,
} from './default-avatars';

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

function lifetimeKey(actor: OwnProgressActor | null, context: TelemetryContext): string | null {
  const active = context.actor;
  if (!actor || !context.ready || !active) return null;
  const identity =
    actor.kind === 'account'
      ? active.kind === 'account' && active.accountId === actor.accountId.toLowerCase()
        ? `account:${active.accountId}:${active.workspaceId}`
        : null
      : active.kind === 'student' &&
          active.seatId === actor.seatId.toLowerCase() &&
          active.classId === actor.classroomId.toLowerCase()
        ? `seat:${active.seatId}:${active.classId}`
        : null;
  return identity ? `${identity}:${context.generation}:${context.continuity}` : null;
}

export interface ProgressLifetime {
  readonly key: string | null;
  readonly current: () => string | null;
}

export function useProgressLifetime(actor: OwnProgressActor | null): ProgressLifetime {
  const context = useSyncExternalStore(subscribeTelemetry, telemetryContext, telemetryContext);
  const kind = actor?.kind;
  const id = actor?.kind === 'account' ? actor.accountId : actor?.seatId;
  const classroom = actor?.kind === 'seat' ? actor.classroomId : undefined;
  // Names and avatar choices do not change the ownership of a response.
  const current = useCallback(() => lifetimeKey(actor, telemetryContext()), [kind, id, classroom]);
  const key = lifetimeKey(actor, context);
  return useMemo(() => ({ key, current }), [key, current]);
}

type ReadFailure = { readonly status: number; readonly message: string };
type ReadValue<T> = {
  readonly key: string | null;
  readonly revision: number;
  readonly data: T | null;
  readonly error: ReadFailure | null;
  readonly settled: boolean;
};

/** Each section settles independently; ownership is checked before rendering and committing. */
export function usePersonalRead<T>(
  lifetime: ProgressLifetime,
  read: (signal: AbortSignal) => Promise<ApiResult<T>>,
  revision = 0,
) {
  const [retry, setRetry] = useState(0);
  const [value, setValue] = useState<ReadValue<T> | null>(null);
  const sequence = useRef(0);
  const reload = useCallback(() => setRetry((previous) => previous + 1), []);
  useEffect(() => {
    const key = lifetime.key;
    const generation = ++sequence.current;
    const controller = new AbortController();
    const unsubscribe = subscribeTelemetry(() => {
      if (lifetime.current() !== key) controller.abort(lifecycleCancellation());
    });
    if (key) {
      setValue({ key, revision, data: null, error: null, settled: false });
      void abortable(() => read(controller.signal), controller.signal)
        .then((result) => {
          if (
            controller.signal.aborted ||
            generation !== sequence.current ||
            lifetime.current() !== key
          )
            return;
          setValue({
            key,
            revision,
            settled: true,
            data: result.ok ? result.data : null,
            error: result.ok ? null : { status: result.status, message: result.error.message },
          });
        })
        .catch(() => {
          if (
            controller.signal.aborted ||
            generation !== sequence.current ||
            lifetime.current() !== key
          )
            return;
          setValue({
            key,
            revision,
            data: null,
            settled: true,
            error: { status: 0, message: 'Не удалось получить данные.' },
          });
        });
    }
    return () => {
      sequence.current += 1;
      unsubscribe();
      controller.abort(lifecycleCancellation());
    };
  }, [lifetime, read, revision, retry]);
  // Passive-effect cleanup alone would expose the previous person's data for one render.
  const visible =
    lifetime.key !== null &&
    lifetime.current() === lifetime.key &&
    value?.key === lifetime.key &&
    value.revision === revision
      ? value
      : null;
  return {
    data: visible?.data ?? null,
    error: visible?.error ?? null,
    settled: lifetime.key === null || visible?.settled === true,
    loading: lifetime.key !== null && visible?.settled !== true,
    reload,
  };
}

export async function readPersonalProgress(
  actor: OwnProgressActor,
  signal: AbortSignal,
  cursor?: string,
): Promise<ApiResult<PersonalProgressSummaryV1>> {
  const path =
    actor.kind === 'account' ? '/api/progress/summary' : '/api/class-join/progress/summary';
  const result = await call<PersonalProgressSummaryV1>(
    `${path}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    { signal },
  );
  if (result.ok) {
    const scope = result.data.scope;
    const matching =
      actor.kind === 'account'
        ? scope.kind === 'account' && scope.accountId === actor.accountId.toLowerCase()
        : scope.kind === 'seat' &&
          scope.seatId === actor.seatId.toLowerCase() &&
          scope.classroomId === actor.classroomId.toLowerCase();
    if (!matching)
      return {
        ok: false,
        status: 0,
        error: { code: 'progress_scope_mismatch', message: 'Контекст прогресса изменился.' },
      };
  }
  return result;
}

interface GroupPage {
  readonly key: string;
  readonly source: PersonalProgressSummaryV1;
  readonly items: readonly OwnProgressGroupV1[];
  readonly cursor: string | null;
  readonly busy: boolean;
  readonly error: boolean;
}

export function usePersonalProgress(actor: OwnProgressActor) {
  const lifetime = useProgressLifetime(actor);
  const kind = actor.kind;
  const id = actor.kind === 'account' ? actor.accountId : actor.seatId;
  const classroom = actor.kind === 'seat' ? actor.classroomId : undefined;
  const read = useCallback(
    (signal: AbortSignal) => readPersonalProgress(actor, signal),
    [kind, id, classroom],
  );
  const summary = usePersonalRead(lifetime, read);
  const [page, setPage] = useState<GroupPage | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const retire = () => {
      pending.current?.abort(lifecycleCancellation());
      pending.current = null;
    };
    const unsubscribe = subscribeTelemetry(() => {
      if (lifetime.current() !== lifetime.key) retire();
    });
    return () => {
      unsubscribe();
      retire();
    };
  }, [lifetime, summary.data]);
  const visible = page?.key === lifetime.key && page?.source === summary.data ? page : null;
  const groups = visible?.items ?? summary.data?.groups.items ?? [];
  const cursor = visible ? visible.cursor : (summary.data?.groups.nextCursor ?? null);
  const loadMore = async () => {
    const source = summary.data;
    const key = lifetime.key;
    if (!source || !key || !cursor || pending.current || lifetime.current() !== key) return;
    const controller = new AbortController();
    pending.current = controller;
    setPage({ key, source, items: groups, cursor, busy: true, error: false });
    try {
      const result = await readPersonalProgress(actor, controller.signal, cursor);
      if (controller.signal.aborted || pending.current !== controller || lifetime.current() !== key)
        return;
      if (!result.ok || !result.data.groups.items || result.data.groups.nextCursor === cursor) {
        setPage({ key, source, items: groups, cursor, busy: false, error: true });
      } else {
        const seen = new Set(groups.map((group) => group.groupId));
        setPage({
          key,
          source,
          items: [
            ...groups,
            ...result.data.groups.items.filter((group) => !seen.has(group.groupId)),
          ],
          cursor: result.data.groups.nextCursor,
          busy: false,
          error: false,
        });
      }
    } catch {
      if (
        !controller.signal.aborted &&
        pending.current === controller &&
        lifetime.current() === key
      )
        setPage({ key, source, items: groups, cursor, busy: false, error: true });
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  };
  return {
    lifetime,
    summary,
    groups,
    hasMore: cursor !== null,
    loadingMore: visible?.busy === true,
    moreError: visible?.error === true,
    loadMore,
  };
}

const GROUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** At most two group reads run concurrently, even with 20 visible groups.
 * Queued work is removed immediately if the owner/session cancels. */
let activeGroupReads = 0;
const queuedGroupReads: Array<() => void> = [];
export function limitedGroupRead<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let started = false;
    let finished = false;
    let released = false;
    // A cancelled network operation must release its client-side slot immediately.
    // The underlying fetch may never settle, even after its owner logs out.
    const release = () => {
      if (!started || released) return;
      released = true;
      activeGroupReads -= 1;
      queuedGroupReads.shift()?.();
    };
    const onAbort = () => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', onAbort);
      if (started) release();
      else {
        const index = queuedGroupReads.indexOf(start);
        if (index >= 0) queuedGroupReads.splice(index, 1);
      }
      reject(lifecycleCancellation());
    };
    const finish = (settle: () => void) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', onAbort);
      settle();
      release();
    };
    const start = () => {
      if (finished || signal.aborted) {
        if (!finished) onAbort();
        // A cancelled entry must not strand the rest of the queue.
        queuedGroupReads.shift()?.();
        return;
      }
      started = true;
      activeGroupReads += 1;
      try {
        void Promise.resolve(read()).then(
          (result) => finish(() => resolve(result)),
          (error: unknown) => finish(() => reject(error)),
        );
      } catch (error) {
        finish(() => reject(error));
      }
    };
    if (signal.aborted) {
      reject(lifecycleCancellation());
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    if (activeGroupReads < 2) start();
    else queuedGroupReads.push(start);
  });
}

export function groupRatingPreviewLimit(width: number): number {
  if (width <= 380) return 2;
  if (width <= 520) return 3;
  return 5;
}

function groupRatingPath(actor: OwnProgressActor, groupId: string): string {
  const base =
    actor.kind === 'account' ? '/api/progress/groups' : '/api/class-join/progress/groups';
  return base + '/' + encodeURIComponent(groupId);
}

/** Only *pending* preview requests may be shared, never cached results.
 * All request keys include ProgressLifetime's generation/continuity: a logout,
 * account change or same-account re-login cannot reuse another session's data.
 * Browser abort stops an obsolete consumer immediately; its in-flight server
 * SQL remains reusable for a same-scope remount rather than starting another
 * expensive calculation that competes with the first one. A hard upper bound
 * prevents indefinite transport retention if the network itself hangs. */
const pendingGroupPreviews = new Map<string, Promise<ApiResult<GroupRatingPageV1>>>();
function sharedGroupPreview(ownerKey: string, url: string): Promise<ApiResult<GroupRatingPageV1>> {
  const key = ownerKey + '::' + url;
  const existing = pendingGroupPreviews.get(key);
  if (existing) return existing;
  const transport = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Promise<ApiResult<GroupRatingPageV1>>((resolve, reject) => {
    timer = setTimeout(() => {
      transport.abort(lifecycleCancellation());
      reject(new Error('group rating transport timed out'));
    }, 12000);
    void call<GroupRatingPageV1>(url, { signal: transport.signal }).then(resolve, reject);
  }).finally(() => {
    if (timer !== null) clearTimeout(timer);
    if (pendingGroupPreviews.get(key) === pending) pendingGroupPreviews.delete(key);
  });
  pendingGroupPreviews.set(key, pending);
  return pending;
}

export function readGroupRating(
  actor: OwnProgressActor,
  groupId: string,
  signal: AbortSignal,
  view: 'preview' | 'all',
  options: { readonly limit?: number; readonly cursor?: string } = {},
  ownerKey: string | null = null,
): Promise<ApiResult<GroupRatingPageV1>> {
  const params = new URLSearchParams({ view });
  if (view === 'preview') params.set('limit', String(options.limit ?? 5));
  if (view === 'all' && options.cursor) params.set('cursor', options.cursor);
  const url = groupRatingPath(actor, groupId) + '/rating?' + params.toString();
  return limitedGroupRead(signal, async () => {
    const result =
      view === 'preview' && ownerKey
        ? await abortable(() => sharedGroupPreview(ownerKey, url), signal)
        : await call<GroupRatingPageV1>(url, { signal });
    if (
      result.ok &&
      (result.data.groupId.toLowerCase() !== groupId.toLowerCase() ||
        !Array.isArray(result.data.peers) ||
        result.data.peers.some((peer) => peer.isSelf !== false) ||
        !['7', '30', '90'].includes(String(result.data.periodDays)))
    )
      return {
        ok: false,
        status: 0,
        error: { code: 'progress_scope_mismatch', message: 'Контекст рейтинга изменился.' },
      };
    return result;
  });
}

export function readGroupRatingAvatars(
  actor: OwnProgressActor,
  groupId: string,
  signal: AbortSignal,
  tickets: readonly string[],
): Promise<ApiResult<GroupRatingAvatarBatchV1>> {
  if (tickets.length === 0) return Promise.resolve({ ok: true, status: 200, data: { items: [] } });
  const url = groupRatingPath(actor, groupId) + '/avatars';
  return limitedGroupRead(signal, () =>
    call<GroupRatingAvatarBatchV1>(url, {
      signal,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tickets }),
    }),
  );
}

export function useGroupRatingPreview(
  actor: OwnProgressActor,
  lifetime: ProgressLifetime,
  groupId: string,
  limit: number,
) {
  const valid = GROUP_ID.test(groupId);
  const key = lifetime.key && valid ? lifetime.key + ':group:' + groupId : null;
  const current = useCallback(() => {
    const now = lifetime.current();
    return now && valid ? now + ':group:' + groupId : null;
  }, [lifetime.current, groupId, valid]);
  const ratingLifetime = useMemo(() => ({ key, current }), [key, current]);
  const kind = actor.kind;
  const accountId = actor.kind === 'account' ? actor.accountId : undefined;
  const seatId = actor.kind === 'seat' ? actor.seatId : undefined;
  const read = useCallback(
    (signal: AbortSignal) => readGroupRating(actor, groupId, signal, 'preview', { limit }, key),
    [kind, accountId, seatId, groupId, limit, key],
  );
  const rating = usePersonalRead(ratingLifetime, read, limit);
  const version = rating.data?.version;
  const tickets =
    rating.data?.peers.flatMap((peer) => (peer.avatarTicket ? [peer.avatarTicket] : [])) ?? [];
  const ticketsKey = tickets.join('|');
  const avatarKey =
    key && version && tickets.length > 0 ? key + ':avatars:' + version + ':' + ticketsKey : null;
  const avatarCurrent = useCallback(() => {
    const now = current();
    return now && version && tickets.length > 0
      ? now + ':avatars:' + version + ':' + ticketsKey
      : null;
  }, [current, version, ticketsKey, tickets.length]);
  const avatarLifetime = useMemo(
    () => ({ key: avatarKey, current: avatarCurrent }),
    [avatarKey, avatarCurrent],
  );
  const readAvatars = useCallback(
    (signal: AbortSignal) => readGroupRatingAvatars(actor, groupId, signal, tickets),
    [kind, accountId, seatId, groupId, ticketsKey],
  );
  const avatars = usePersonalRead(avatarLifetime, readAvatars);
  const imageMap = useMemo(
    () =>
      new Map(
        avatars.data?.items
          .filter(
            (item) =>
              tickets.includes(item.ticket) &&
              /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.dataUrl),
          )
          .map((item) => [item.ticket, item.dataUrl] as const) ?? [],
      ),
    [avatars.data, ticketsKey],
  );
  return { rating, avatars, imageMap };
}

interface GroupRatingFullState {
  readonly key: string;
  readonly groupId: string;
  readonly page: GroupRatingPageV1 | null;
  readonly peers: readonly GroupRatingPeerV1[];
  readonly images: Readonly<Record<string, string>>;
  readonly nextCursor: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly restarted: boolean;
}

export function useGroupRatingFull(
  actor: OwnProgressActor,
  lifetime: ProgressLifetime,
  groupId: string,
) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [state, setState] = useState<GroupRatingFullState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const kind = actor.kind;
  const accountId = actor.kind === 'account' ? actor.accountId : undefined;
  const seatId = actor.kind === 'seat' ? actor.seatId : undefined;
  const active = Boolean(
    openKey && openKey === lifetime.key && lifetime.current() === openKey && GROUP_ID.test(groupId),
  );
  const visible = active && state?.key === openKey && state.groupId === groupId ? state : null;
  const readPage = useCallback(
    async (cursor: string | null, fresh: boolean, ownerKey: string) => {
      if (pending.current || lifetime.current() !== ownerKey) return;
      const controller = new AbortController();
      pending.current = controller;
      setState((old) => ({
        key: ownerKey,
        groupId,
        page: fresh ? null : (old?.page ?? null),
        peers: fresh ? [] : (old?.peers ?? []),
        images: fresh ? {} : (old?.images ?? {}),
        nextCursor: fresh ? null : (old?.nextCursor ?? null),
        loading: true,
        error: null,
        restarted: fresh && cursor !== null,
      }));
      try {
        let result = await readGroupRating(actor, groupId, controller.signal, 'all', {
          ...(cursor ? { cursor } : {}),
        });
        if (cursor && !result.ok && result.status === 409) {
          fresh = true;
          setState({
            key: ownerKey,
            groupId,
            page: null,
            peers: [],
            images: {},
            nextCursor: null,
            loading: true,
            error: null,
            restarted: true,
          });
          result = await readGroupRating(actor, groupId, controller.signal, 'all');
        }
        if (controller.signal.aborted || lifetime.current() !== ownerKey) return;
        if (!result.ok) {
          setState((old) =>
            old?.key === ownerKey
              ? { ...old, loading: false, error: 'Не удалось загрузить рейтинг группы.' }
              : old,
          );
          return;
        }
        const next = result.data;
        const tickets = next.peers.flatMap((peer) =>
          peer.avatarTicket ? [peer.avatarTicket] : [],
        );
        const avatarResult = await readGroupRatingAvatars(
          actor,
          groupId,
          controller.signal,
          tickets,
        );
        if (controller.signal.aborted || lifetime.current() !== ownerKey) return;
        const images = avatarResult.ok
          ? Object.fromEntries(
              avatarResult.data.items
                .filter(
                  (item) =>
                    tickets.includes(item.ticket) &&
                    /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.dataUrl),
                )
                .map((item) => [item.ticket, item.dataUrl]),
            )
          : {};
        setState((old) => {
          if (old?.key !== ownerKey || old.groupId !== groupId) return old;
          if (!fresh && old.page?.version !== next.version)
            return { ...old, loading: false, error: 'Рейтинг обновился. Повторите загрузку.' };
          const prior = fresh ? [] : old.peers;
          const used = new Set(prior.map((peer) => peer.peerKey));
          if (next.peers.some((peer) => used.has(peer.peerKey)))
            return { ...old, loading: false, error: 'Рейтинг изменился. Начните заново.' };
          return {
            key: ownerKey,
            groupId,
            page: next,
            peers: [...prior, ...next.peers],
            images: { ...(fresh ? {} : old.images), ...images },
            nextCursor: next.nextCursor,
            loading: false,
            error: avatarResult.ok ? null : 'Некоторые аватары недоступны.',
            restarted: fresh && cursor !== null,
          };
        });
      } catch {
        if (!controller.signal.aborted && lifetime.current() === ownerKey)
          setState((old) =>
            old?.key === ownerKey
              ? { ...old, loading: false, error: 'Не удалось загрузить рейтинг группы.' }
              : old,
          );
      } finally {
        if (pending.current === controller) pending.current = null;
      }
    },
    [kind, accountId, seatId, groupId, lifetime.current],
  );

  useEffect(() => {
    if (!active || !openKey) return;
    void readPage(null, true, openKey);
    return () => {
      pending.current?.abort(lifecycleCancellation());
      pending.current = null;
    };
  }, [active, openKey, attempt, readPage]);

  const open = () => {
    const now = lifetime.key;
    if (now && lifetime.current() === now && GROUP_ID.test(groupId)) {
      setState(null);
      setOpenKey(now);
      setAttempt((n) => n + 1);
    }
  };
  const close = () => {
    pending.current?.abort(lifecycleCancellation());
    pending.current = null;
    setOpenKey(null);
    setState(null);
  };
  const loadMore = () => {
    if (visible && !visible.loading && visible.nextCursor && openKey)
      void readPage(visible.nextCursor, false, openKey);
  };
  const retry = () => {
    if (active) {
      pending.current?.abort(lifecycleCancellation());
      pending.current = null;
      setAttempt((n) => n + 1);
    }
  };
  return { opened: active, state: visible, open, close, loadMore, retry };
}

export function useOwnAvatar(actor: OwnProgressActor, lifetime: ProgressLifetime) {
  const accountLifetime = useMemo(
    () => (actor.kind === 'account' ? lifetime : { ...lifetime, key: null }),
    [actor.kind, lifetime],
  );
  const read = useCallback(() => api.accountAvatar(), []);
  const avatar = usePersonalRead(accountLifetime, read);
  const [changed, setChanged] = useState<{ key: string; src: string | null } | null>(null);
  useEffect(() => {
    if (actor.kind !== 'account' || !lifetime.key) return;
    const key = lifetime.key;
    const update = (event: Event) => {
      if (lifetime.current() === key)
        setChanged({ key, src: (event as CustomEvent<string | null>).detail });
    };
    window.addEventListener(PROFILE_AVATAR_CHANGED_EVENT, update);
    return () => window.removeEventListener(PROFILE_AVATAR_CHANGED_EVENT, update);
  }, [actor.kind, lifetime]);
  const fallback =
    actor.kind === 'seat'
      ? seatAvatar(actor.seatId, actor.avatarKey).src
      : defaultAvatarForAccount(actor.accountId).src;
  const own = changed?.key === lifetime.key ? changed.src : avatar.data?.avatarDataUrl;
  return { src: actor.kind === 'seat' ? fallback : own || fallback, fallback };
}

export interface NextLearningAction {
  readonly assignmentId: string;
  readonly title: string;
  readonly label: 'Начать' | 'Продолжить' | 'Доработать';
  readonly href: string;
}

/** Links to the existing resolver; this recommendation never starts an attempt. */
export function nextLearningAction(
  assignments: readonly SeatAssignment[],
  quizzes: readonly LearnerQuiz[],
): NextLearningAction | null {
  const candidates: Array<NextLearningAction & { priority: number }> = [];
  for (const item of assignments) {
    // Direct quiz state is absent from this projection, even after submission.
    // Its exact run must be checked separately before offering an action.
    if (item.status !== 'open' || item.activityKind === 'quiz') continue;
    const state = item.canonicalState?.workflowState;
    if (
      state
        ? !['changes_requested', 'in_progress', 'not_started'].includes(state)
        : item.submittedAt || !(item.projectId || item.activityRunId || item.courseStartAllowed)
    )
      continue;
    const label =
      state === 'changes_requested'
        ? 'Доработать'
        : state === 'in_progress' || item.projectId
          ? 'Продолжить'
          : 'Начать';
    candidates.push({
      assignmentId: item.id,
      title: item.title,
      label,
      href: `/#/learning?assignment=${encodeURIComponent(item.id)}`,
      priority: label === 'Доработать' ? 0 : label === 'Продолжить' ? 1 : 2,
    });
  }
  for (const item of quizzes) {
    const state = item.canonicalState?.workflowState;
    if (
      item.status !== 'open' ||
      item.attemptsUsed >= item.attemptLimit ||
      (state
        ? !['changes_requested', 'in_progress', 'not_started'].includes(state)
        : item.latestResult !== null)
    )
      continue;
    const label =
      state === 'changes_requested'
        ? 'Доработать'
        : state === 'in_progress'
          ? 'Продолжить'
          : 'Начать';
    candidates.push({
      assignmentId: item.assignmentId,
      title: item.title,
      label,
      href: `/#/learning?assignment=${encodeURIComponent(item.assignmentId)}`,
      priority: label === 'Доработать' ? 0 : label === 'Продолжить' ? 1 : 2,
    });
  }
  return candidates.sort((a, b) => a.priority - b.priority)[0] ?? null;
}

/** One exact quiz read, fenced by both the learner lifetime and selected run. */
export function useDirectQuizAction(candidate: SeatAssignment | null, lifetime: ProgressLifetime) {
  const runId =
    candidate?.status === 'open' && candidate.activityKind === 'quiz'
      ? (candidate.activityRunId ?? null)
      : null;
  const key =
    lifetime.key && runId && candidate ? `${lifetime.key}:quiz:${candidate.id}:${runId}` : null;
  const selectedKey = useRef(key);
  selectedKey.current = key;
  const current = useCallback(
    () => (lifetime.current() === lifetime.key ? selectedKey.current : null),
    [lifetime],
  );
  const proofLifetime = useMemo(() => ({ key, current }), [key, current]);
  const read = useCallback(() => {
    if (!runId) throw lifecycleCancellation();
    return api.readQuizLearning(runId);
  }, [runId]);
  const proof = usePersonalRead(proofLifetime, read);
  const data = proof.data;
  let label: NextLearningAction['label'] | null = null;
  if (data?.canStart) {
    const attempt = data.attempt;
    if (attempt === null) label = 'Начать';
    else if (['created', 'in_progress', 'working', 'active'].includes(attempt.state)) {
      // Match QuizResponsePlayer's editable states, using the server's clock.
      const expires = attempt.expiresAt === null ? null : Date.parse(attempt.expiresAt);
      const now = Date.parse(attempt.serverNow);
      if (expires === null || (Number.isFinite(expires) && Number.isFinite(now) && expires > now))
        label = 'Продолжить';
    }
  }
  const action: NextLearningAction | null =
    candidate && label
      ? {
          assignmentId: candidate.id,
          title: candidate.title,
          label,
          href: `/#/learning?assignment=${encodeURIComponent(candidate.id)}`,
        }
      : null;
  return { action, settled: proof.settled, error: proof.error, reload: proof.reload };
}

export function useNextLearningAction(actor: OwnProgressActor, lifetime: ProgressLifetime) {
  const readAssignments = useCallback(
    (signal: AbortSignal) =>
      actor.kind === 'seat' ? api.seatAssignments() : api.attendedAssignments(signal),
    [actor.kind],
  );
  const readQuizzes = useCallback(
    () => (actor.kind === 'seat' ? api.seatQuizzes() : api.accountQuizzes()),
    [actor.kind],
  );
  const assignments = usePersonalRead(lifetime, readAssignments);
  const quizzes = usePersonalRead(lifetime, readQuizzes);
  const items = assignments.data?.items ?? [];
  // Keep server order. Never scan other quizzes after a denied/terminal proof.
  const candidate =
    items.find(
      (item) => item.status === 'open' && item.activityKind === 'quiz' && item.activityRunId,
    ) ?? null;
  const directQuiz = useDirectQuizAction(candidate, lifetime);
  return {
    action: nextLearningAction(items, quizzes.data?.items ?? []) ?? directQuiz.action,
    settled: assignments.settled && quizzes.settled && directQuiz.settled,
    error: assignments.error !== null || quizzes.error !== null || directQuiz.error !== null,
    reload: () => {
      if (assignments.error) assignments.reload();
      if (quizzes.error) quizzes.reload();
      if (directQuiz.error) directQuiz.reload();
    },
  };
}

export const progressNumber = (value: number): string =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
