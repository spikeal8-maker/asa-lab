import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PersonalProgressSummaryV1 } from '@asa-lab/contracts';
import type { ApiResult } from '../api';
import { call } from '../api-call';
import { abortable, lifecycleCancellation } from '../auth-request';
import { subscribeTelemetry, telemetryContext, type TelemetryContext } from '../telemetry-context';

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

export const progressNumber = (value: number): string =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
