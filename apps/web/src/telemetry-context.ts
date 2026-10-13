import { actorKey, type EntryRoute, type TelemetryActor } from './telemetry-contract';

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
  route: EntryRoute;
}
let current: TelemetryContext = { actor: null, ready: false, generation: 0, route: 'unknown' };
const listeners = new Set<(context: TelemetryContext) => void>();
export const telemetryContext = () => current;
export function setTelemetryContext(
  actor: TelemetryActor | null,
  ready: boolean,
  route: EntryRoute,
): void {
  const changed = ready && (actorKey(actor) !== actorKey(current.actor) || !current.ready);
  // The layout effect retires old admissions before editor passive effects run.
  current = {
    actor: ready ? actor : current.actor,
    ready,
    route,
    generation: current.generation + (changed ? 1 : 0),
  };
  for (const listener of listeners) {
    try {
      listener(current);
    } catch {
      /* Observability cannot break a product context switch. */
    }
  }
}
export function subscribeTelemetry(listener: (context: TelemetryContext) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
