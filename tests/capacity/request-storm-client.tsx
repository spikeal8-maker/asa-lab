// Browser fixture imports the real client mechanisms; it does not reimplement them.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, type ClassroomStudentSession } from '../../apps/web/src/api';
import { call } from '../../apps/web/src/api-call';
import { installClientDiagnostics } from '../../apps/web/src/client-diagnostics';
import { observeAnalytics, analyticsSessionTransport } from '../../apps/web/src/analytics-runtime';
import { setTelemetryContext, telemetryActor } from '../../apps/web/src/telemetry-context';
import {
  useGameInvitations,
  usePortalGameNotifications,
} from '../../apps/web/src/games/game-notifications';

const params = new URLSearchParams(location.search);
const client = Number(params.get('client'));
const nativeFetch = window.fetch.bind(window);
// Observation only: one synthetic integer. Cookies and user identifiers are never logged.
window.fetch = (input, init) => {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  headers.set('x-asa-storm-client', String(client));
  return nativeFetch(input, { ...init, headers });
};
installClientDiagnostics();
observeAnalytics();
let seat: ClassroomStudentSession | undefined;
let activate: (actor: string) => void = () => {
  throw new Error('Fixture not mounted');
};
let incoming: ReturnType<typeof useGameInvitations>['incoming'] = [];
let currentProject = sessionStorage.getItem('asa:storm:project') ?? '';
let currentRevision = Number(sessionStorage.getItem('asa:storm:revision') ?? 0);
let activity: ReturnType<typeof analyticsSessionTransport> | undefined;
let activityId = '';

function bind(value: ClassroomStudentSession) {
  seat = value;
  setTelemetryContext(telemetryActor({ kind: 'student', session: value }), true, 'projects');
  activate(`seat:${value.student.seatId}`);
  if (currentProject && !activity) {
    activity = analyticsSessionTransport(
      telemetryActor({ kind: 'student', session: value }),
      'electronics',
    );
    activityId = crypto.randomUUID();
    void activity.start(activityId, currentProject);
  }
}

function Fixture() {
  const [actor, setActor] = useState('');
  activate = setActor;
  usePortalGameNotifications(actor);
  incoming = useGameInvitations().incoming;
  return <main data-fixture="request-storm">Synthetic classroom client {client}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);

function unwrap<T>(result: { ok: boolean; status: number; data?: T; error?: unknown }): T {
  if (!result.ok)
    throw new Error(`Fixture API failed: ${result.status} ${JSON.stringify(result.error)}`);
  return result.data as T;
}

export const storm = {
  ready: true,
  login: async (code: string, studentCode: string) => {
    const started = performance.now();
    bind(unwrap(await api.signInClassroomSeat(code, studentCode)));
    return { durationMs: performance.now() - started, seatId: seat!.student.seatId };
  },
  resume: async () => {
    const result = unwrap(await api.classroomStudentMe());
    if (!result.authenticated) throw new Error('Lost synthetic Seat session');
    bind(result);
    return result.student.seatId;
  },
  bootstrap: async () => {
    const started = performance.now();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => [
        api.me(),
        api.classroomStudentMe(),
        api.seatAssignmentCounts(),
        api.listProjects(),
        call('/api/public-projects'),
        api.listModules(),
      ]).flat(),
    );
    results.forEach((result) => unwrap(result));
    return performance.now() - started;
  },
  route: (route: 'home' | 'projects' | 'games' | 'editor.electronics') => {
    if (!seat) throw new Error('Synthetic Seat is not authenticated');
    setTelemetryContext(telemetryActor({ kind: 'student', session: seat }), true, route);
    observeAnalytics();
  },
  createAndSave: async (document: Record<string, unknown>) => {
    if (!seat) throw new Error('Synthetic Seat is not authenticated');
    const project = unwrap(
      await api.createProject({
        module: 'electronics',
        scope: 'personal',
        title: 'Synthetic storm circuit',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).project;
    currentProject = project.id;
    const initial = unwrap(await api.openProject(project.id));
    const saved = unwrap(await api.saveDraft(project.id, document, initial.draft.revision));
    currentRevision = saved.draft.revision;
    sessionStorage.setItem('asa:storm:project', currentProject);
    sessionStorage.setItem('asa:storm:revision', String(currentRevision));
    const reopened = unwrap(await api.openProject(project.id));
    activity = analyticsSessionTransport(
      telemetryActor({ kind: 'student', session: seat }),
      'electronics',
    );
    activityId = crypto.randomUUID();
    // Optional telemetry is deliberately not awaited by project saving.
    void activity.start(activityId, project.id);
    return { document: reopened.draft.document, revision: currentRevision };
  },
  saveAgain: async (document: Record<string, unknown>) => {
    const saved = unwrap(await api.saveDraft(currentProject, document, currentRevision));
    currentRevision = saved.draft.revision;
    sessionStorage.setItem('asa:storm:revision', String(currentRevision));
    const reopened = unwrap(await api.openProject(currentProject));
    return { document: reopened.draft.document, revision: reopened.draft.revision };
  },
  verifySaved: async () => unwrap(await api.openProject(currentProject)).draft,
  projectId: () => currentProject,
  foreignRead: async (id: string) => (await api.openProject(id)).status,
  requestBurst: async () => Promise.all(Array.from({ length: 24 }, () => api.listProjects())),
  failures: async () => {
    // Real HTTP503 is injected by the loopback proxy below the product fetch instrumentation.
    await Promise.all(Array.from({ length: 24 }, (_, i) => call(`/api/modules?stormFailure=${i}`)));
  },
  touchActivity: () => {
    if (activity) void activity.touch(activityId, false);
  },
  contextBurst: () => {
    for (let i = 0; i < 20; i++) {
      storm.route(i % 2 ? 'projects' : 'games');
      window.dispatchEvent(new Event('online'));
    }
  },
  notifications: () => incoming.map(({ game, id }) => ({ game, id })),
  game: async (game: 'chess' | 'checkers', path: string, data?: unknown) =>
    unwrap(
      await call<Record<string, unknown>>(
        `/api/games/${game}/${path}`,
        data === undefined
          ? { headers: { 'x-game-presence': '1' } }
          : {
              method: 'POST',
              headers: { 'idempotency-key': crypto.randomUUID() },
              body: JSON.stringify(data),
            },
      ),
    ),
  stop: () => {
    activity?.closeIntent(activityId);
    activate('');
    setTelemetryContext(null, false, 'unknown');
  },
};

Object.assign(window, { __asaStorm: storm });
