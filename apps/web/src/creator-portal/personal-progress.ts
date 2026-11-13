import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PersonalProgressSummaryV1, OwnProgressGroupV1 } from '@asa-lab/contracts';
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
