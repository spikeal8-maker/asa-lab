import {
  actorKey,
  record,
  validActor,
  type EntryRoute,
  type TelemetryActor,
} from './telemetry-contract';

type Identity = {
  kind: string;
  session?: {
    account?: { id: string };
    activeWorkspace?: { workspaceId: string };
    student?: { seatId: string };
    classroom?: { id: string };
  };
};
/** Read only the original App SessionState, never the presentation Seat-as-Account adapter. */
export function telemetryActor(state: Identity): TelemetryActor | null {
  if (state.kind === 'authenticated' && state.session?.account && state.session.activeWorkspace)
    return {
      kind: 'account',
      accountId: state.session.account.id.toLowerCase(),
      workspaceId: state.session.activeWorkspace.workspaceId.toLowerCase(),
    };
  if (state.kind === 'student' && state.session?.student && state.session.classroom)
    return {
      kind: 'student',
      seatId: state.session.student.seatId.toLowerCase(),
      classId: state.session.classroom.id.toLowerCase(),
    };
  return null;
}
export function telemetryRoute(
  view: { kind: string; moduleKey?: string },
  admin = false,
): EntryRoute {
  if (admin) return 'admin';
  if (view.kind === 'editor')
    return ['electronics', 'three-d', 'chess', 'checkers', 'blocks'].includes(view.moduleKey ?? '')
      ? (`editor.${view.moduleKey}` as EntryRoute)
      : 'unknown';
  if (view.kind === 'my-projects') return 'projects';
  if (['classrooms', 'classroom', 'classroom-projects', 'teacher-invite'].includes(view.kind))
    return 'classes';
  if (['home', 'games', 'learning', 'account'].includes(view.kind)) return view.kind as EntryRoute;
  return 'public';
}
export interface TelemetryContext {
  actor: TelemetryActor | null;
  ready: boolean;
  generation: number;
  continuity: number;
  route: EntryRoute;
}
let current: TelemetryContext = {
  actor: null,
  ready: false,
  generation: 0,
  continuity: 0,
  route: 'unknown',
};
// A workspace handoff hides readiness without changing the underlying binding or queue IDs.
let binding = current;
interface WorkspaceHandoff {
  epoch: number;
  mutations: Set<number>;
  presentation: Pick<TelemetryContext, 'actor' | 'ready' | 'route'>;
  confirmed?: TelemetryActor | null | undefined;
  proofReady?: boolean;
  uncertain: boolean;
  observation: number;
  fallback?: ReturnType<typeof setTimeout> | undefined;
  proof?: AbortController | undefined;
  productConfirmation?: { context: TelemetryContext; deadline: number } | undefined;
}
let handoff: WorkspaceHandoff | undefined;
let epoch = 0;
let mutationId = 0;
let observationId = 0;
export interface TelemetryIdentityObservation {
  epoch: number;
  observation: number;
}
const listeners = new Set<(context: TelemetryContext) => void>();
const productConfirmations = new Set<(context: TelemetryContext, deadline: number) => void>();
export const telemetryContext = () => current;
export function setTelemetryContext(
  actor: TelemetryActor | null,
  ready: boolean,
  route: EntryRoute,
): void {
  if (handoff) {
    if (ready && (!actor || actor.kind === 'student')) {
      invalidateProof(handoff);
      handoff = undefined;
    } else if (
      handoff.confirmed !== undefined &&
      actor &&
      actorKey(actor) !== actorKey(handoff.confirmed)
    ) {
      // Old React renders cannot reopen the old workspace during or after canonical proof.
      return;
    } else {
      handoff.presentation = { actor, ready, route };
      if (!ready) {
        // A real session check also invalidates any identity read begun before that boundary.
        invalidateProof(handoff);
      } else if (handoff.confirmed === undefined) {
        binding = { ...binding, route };
        publish();
        return;
      }
    }
  }
  updateBinding(actor, ready, route);
}
function updateBinding(actor: TelemetryActor | null, ready: boolean, route: EntryRoute): void {
  const changed = ready && (actorKey(actor) !== actorKey(binding.actor) || !binding.ready);
  const interrupted =
    ready !== binding.ready || (ready && actorKey(actor) !== actorKey(binding.actor));
  // The layout effect retires old admissions before editor passive effects run.
  binding = {
    actor: ready ? actor : binding.actor,
    ready,
    route,
    generation: binding.generation + (changed ? 1 : 0),
    continuity: binding.continuity + (interrupted ? 1 : 0),
  };
  publish();
}
function publish(): void {
  current =
    handoff &&
    (handoff.confirmed === undefined ||
      !handoff.proofReady ||
      !handoff.presentation.ready ||
      actorKey(handoff.confirmed) !== actorKey(binding.actor) ||
      actorKey(handoff.confirmed) !== actorKey(handoff.presentation.actor))
      ? { ...binding, ready: false }
      : binding;
  for (const listener of listeners) {
    try {
      listener(current);
    } catch {
      /* Observability cannot break a product context switch. */
    }
  }
  releaseHandoffProductConfirmation();
}
function releaseHandoffProductConfirmation(): void {
  const pending = handoff?.productConfirmation;
  if (!handoff || !pending) return;
  if (
    Date.now() >= pending.deadline ||
    !binding.ready ||
    !sameBindingIdentity(pending.context, binding) ||
    (handoff.confirmed !== undefined &&
      (!handoff.proofReady || actorKey(handoff.confirmed) !== actorKey(pending.context.actor)))
  ) {
    handoff.productConfirmation = undefined;
    return;
  }
  if (!current.ready) return;
  handoff.productConfirmation = undefined;
  publishProductConfirmation(current, pending.deadline);
}
function invalidateProof(value: WorkspaceHandoff): void {
  value.epoch = ++epoch;
  value.confirmed = undefined;
  value.proofReady = false;
  value.observation = 0;
  if (value.fallback) clearTimeout(value.fallback);
  value.fallback = undefined;
  value.proof?.abort();
  value.proof = undefined;
}
/** Synchronous: cancel telemetry before the product POST can change the cookie's owner. */
export function beginTelemetryWorkspaceSwitch(): number {
  handoff ??= {
    epoch,
    mutations: new Set(),
    presentation: binding,
    uncertain: false,
    observation: 0,
  };
  if (!handoff.mutations.size) handoff.uncertain = false;
  invalidateProof(handoff);
  const mutation = ++mutationId;
  handoff.mutations.add(mutation);
  publish();
  return mutation;
}
export function finishTelemetryWorkspaceSwitch(mutation: number, uncertain: boolean): void {
  const value = handoff;
  if (!value?.mutations.delete(mutation)) return;
  invalidateProof(value);
  value.uncertain ||= uncertain;
  if (value.mutations.size || !value.uncertain) return;
  // Give the product's own continuation the first opportunity to read its canonical session.
  value.fallback = setTimeout(() => {
    value.fallback = undefined;
    if (handoff !== value || value.mutations.size || value.observation) return;
    const observation = beginTelemetryIdentityObservation();
    if (!observation) return;
    const controller = new AbortController();
    value.proof = controller;
    const deadline = Date.now() + 12_000;
    const outOfTime = (): boolean => {
      if (Date.now() >= deadline) controller.abort();
      return controller.signal.aborted;
    };
    const cancelled = new Promise<undefined>((resolve) =>
      controller.signal.addEventListener('abort', () => resolve(undefined), { once: true }),
    );
    const timeout = setTimeout(() => controller.abort(), 12_000);
    void (async () => {
      try {
        const session = await Promise.race([
          (async () => {
            if (outOfTime()) return undefined;
            const response = await fetch('/api/auth/me', {
              credentials: 'same-origin',
              cache: 'no-store',
              signal: controller.signal,
            });
            if (outOfTime() || response.status !== 200) return undefined;
            const session: unknown = await response.json();
            return outOfTime() ? undefined : session;
          })(),
          cancelled,
        ]);
        if (!outOfTime()) observeTelemetryIdentity(observation, session);
      } catch {
        // An unavailable proof leaves the queue paused; it cannot fail the product mutation.
      } finally {
        clearTimeout(timeout);
        if (value.proof === controller) value.proof = undefined;
      }
    })();
  }, 0);
}
export function beginTelemetryIdentityObservation(): TelemetryIdentityObservation | undefined {
  if (!handoff || handoff.mutations.size) return undefined;
  if (handoff.fallback) clearTimeout(handoff.fallback);
  handoff.fallback = undefined;
  handoff.proof?.abort();
  handoff.proof = undefined;
  handoff.observation = ++observationId;
  return { epoch: handoff.epoch, observation: handoff.observation };
}
export function observeTelemetryIdentity(
  observation: TelemetryIdentityObservation | undefined,
  session: unknown,
): void {
  if (
    !observation ||
    !handoff ||
    handoff.mutations.size ||
    handoff.epoch !== observation.epoch ||
    handoff.observation !== observation.observation ||
    !record(session)
  )
    return;
  let actor: TelemetryActor | null;
  if (session.authenticated === false) actor = null;
  else if (
    session.authenticated === true &&
    record(session.account) &&
    record(session.activeWorkspace) &&
    typeof session.account.id === 'string' &&
    typeof session.activeWorkspace.workspaceId === 'string'
  ) {
    actor = {
      kind: 'account',
      accountId: session.account.id.toLowerCase(),
      workspaceId: session.activeWorkspace.workspaceId.toLowerCase(),
    };
    if (!validActor(actor)) return;
  } else return;
  handoff.confirmed = actor;
  handoff.proofReady = !(record(session.verification) && session.verification.required === true);
  // A changed actor waits for App's readiness gates. Retain the proof fence even after App
  // accepts it: a still-pending pre-mutation /me may render its old identity later.
  if (
    handoff.proofReady &&
    handoff.presentation.ready &&
    actorKey(handoff.presentation.actor) === actorKey(actor)
  ) {
    // App may already have rendered this actor during overlapping mutations; its layout effect
    // need not run again when the later canonical read confirms the same identity.
    updateBinding(actor, true, handoff.presentation.route);
  } else publish();
}
export function sameTelemetryBinding(expected: TelemetryContext): boolean {
  return current.ready && expected.ready && sameBindingIdentity(expected, current);
}
function sameBindingIdentity(expected: TelemetryContext, actual: TelemetryContext): boolean {
  return (
    !!actual.actor &&
    actual.generation === expected.generation &&
    actual.continuity === expected.continuity &&
    actorKey(actual.actor) === actorKey(expected.actor)
  );
}
/** A product retry is a trigger for a fresh server identity read, never identity proof itself. */
export function confirmTelemetryProductSession(expected: TelemetryContext): void {
  const deadline = Date.now() + 12_000;
  if (sameTelemetryBinding(expected)) {
    publishProductConfirmation(expected, deadline);
  } else if (
    handoff &&
    binding.ready &&
    binding.actor?.kind === 'account' &&
    sameBindingIdentity(expected, binding)
  ) {
    // Keep one independent product success across the temporary barrier, including requests
    // begun before it. Mutation settlement must not discard or extend this original deadline.
    handoff.productConfirmation = { context: expected, deadline };
    releaseHandoffProductConfirmation();
  }
}
function publishProductConfirmation(expected: TelemetryContext, deadline: number): void {
  for (const listener of productConfirmations) {
    try {
      listener(expected, deadline);
    } catch {
      /* Product success is independent of analytics. */
    }
  }
}
export function subscribeProductConfirmation(
  listener: (context: TelemetryContext, deadline: number) => void,
): () => void {
  productConfirmations.add(listener);
  return () => {
    productConfirmations.delete(listener);
  };
}
export function renewTelemetryContext(expected: TelemetryContext): void {
  if (!sameTelemetryBinding(expected)) return;
  binding = { ...binding, generation: binding.generation + 1 };
  publish();
}
export function subscribeTelemetry(listener: (context: TelemetryContext) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
