/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type Project, type SchematicDocument } from '../../api';
import { readLocalProjectDraft } from '../../modules/project-local-draft';
import {
  configureProductionLibrary,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';
import { normalizeLoadedDocument, useWorkbenchProjectState } from '../use-workbench-project-state';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  const root = resolve(process.cwd(), 'apps/web/public/assets/electronics/component-database');
  configureProductionLibrary(
    JSON.parse(readFileSync(resolve(root, 'catalog.json'), 'utf8')) as OwnerCatalogManifest,
  );
});

describe('loaded Electronics project migration', () => {
  it('migrates legacy component pins and wire endpoints together before saving', () => {
    const legacy = {
      schemaVersion: 4,
      components: [
        {
          id: 'battery',
          kind: 'source',
          name: 'Battery',
          position: { x: 100, y: 120 },
          rotation: 0,
          value: 3,
          pinIds: ['a', 'b'],
        },
        {
          id: 'resistor',
          kind: 'resistor',
          name: 'Resistor',
          position: { x: 340, y: 120 },
          rotation: 0,
          value: 220,
          pinIds: ['a', 'b'],
        },
      ],
      connections: [
        {
          id: 'wire-legacy',
          from: { componentId: 'battery', terminal: 'a' },
          to: { componentId: 'resistor', terminal: 'b' },
          color: '#149447',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: false, maxIterations: 24 },
    } as SchematicDocument;

    const normalized = normalizeLoadedDocument(legacy);

    expect(normalized.components.find((item) => item.id === 'battery')?.pinIds).toEqual([
      'BAT-',
      'BAT+',
    ]);
    expect(normalized.components.find((item) => item.id === 'resistor')?.pinIds).toEqual([
      'lead-1',
      'lead-2',
    ]);
    expect(normalized.connections[0]).toMatchObject({
      from: { componentId: 'battery', terminal: 'BAT+' },
      to: { componentId: 'resistor', terminal: 'lead-2' },
    });
  });

  it('keeps autosave behind the first local Worker result after Start', () => {
    const projectStateSource = readFileSync(
      resolve(process.cwd(), 'apps/web/src/electronics/use-workbench-project-state.ts'),
      'utf8',
    );
    const workbenchSource = readFileSync(
      resolve(process.cwd(), 'apps/web/src/electronics/use-electronics-workbench.ts'),
      'utf8',
    );

    expect(projectStateSource).toContain("paused: simulationStatusRef.current === 'starting'");
    expect(projectStateSource).toContain("if (simulationStatusRef.current === 'starting') return;");
    expect(projectStateSource).toContain(
      "setSimulationStatus((current) => (current === 'starting' ? 'running' : current));",
    );
    const toggleSource = projectStateSource.slice(
      projectStateSource.indexOf('async function toggleSimulation'),
      projectStateSource.indexOf('function resetSimulation'),
    );
    expect(toggleSource).toContain("setSimulationStatus('starting')");
    expect(toggleSource).not.toContain("setSimulationStatus('running')");
    expect(workbenchSource).toContain('confirmSimulationStarted();');
  });
});

const projectId = 'autosave-project';
const userId = 'autosave-user';
const project = {
  id: projectId,
  moduleKey: 'electronics',
  title: 'Autosave test',
  scope: 'personal',
  classroomId: null,
  status: 'active',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  preview: null,
  snapshotRevision: null,
  copiedFrom: null,
} as Project;
const initialDocument: SchematicDocument = {
  schemaVersion: 4,
  components: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
};
const resistor = (id: string, x: number): SchematicDocument['components'][number] => ({
  id,
  kind: 'resistor',
  name: id,
  value: 220,
  position: { x, y: 10 },
});

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let current: ReturnType<typeof useWorkbenchProjectState> | null = null;

function state(): ReturnType<typeof useWorkbenchProjectState> {
  if (!current) throw new Error('Project hook has not rendered');
  return current;
}

function Probe({
  id = projectId,
  actor = userId,
  seat = false,
}: {
  id?: string;
  actor?: string;
  seat?: boolean;
}) {
  current = useWorkbenchProjectState(id, actor, seat);
  return null;
}

async function mountProject() {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(0);
  window.localStorage.clear();
  vi.spyOn(api, 'me').mockResolvedValue({
    ok: true,
    status: 200,
    data: { authenticated: true, user: { id: userId } },
  } as Awaited<ReturnType<typeof api.me>>);
  let revision = 1;
  vi.spyOn(api, 'openProject').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      project,
      draft: { projectId, document: initialDocument, revision, updatedAt: '' },
      versions: [],
      result: null,
    },
  } as Awaited<ReturnType<typeof api.openProject>>);
  const save = vi.spyOn(api, 'saveDraft').mockImplementation(
    async (_id, document) =>
      ({
        ok: true,
        status: 200,
        data: {
          draft: { projectId, document, revision: ++revision, updatedAt: '' },
          result: null,
        },
      }) as Awaited<ReturnType<typeof api.saveDraft>>,
  );
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(Probe));
  });
  expect(state().status).toBe('ready');
  return save;
}

async function reopenProject() {
  await act(async () => root!.unmount());
  host?.remove();
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(createElement(Probe)));
  expect(state().status).toBe('ready');
}

function edit(zoom: number) {
  const next = { ...state().document!, viewport: { x: 0, y: 0, zoom } };
  act(() => state().setDocument(next));
  return next;
}

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  current = null;
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('Electronics project autosave in the mounted editor hook', () => {
  it('retracts another-tab-cleared local durability and restores the current copy on save failure', async () => {
    const save = await mountProject();
    const latest = edit(2);
    expect(state().localCopySaved).toBe(true);
    const key = `asa-project-local-draft:user:account:${userId}:${projectId}`;
    window.localStorage.removeItem(key);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key, newValue: null })));
    expect(state().localCopySaved).toBe(false);
    save.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: 'project_revision_conflict', message: 'Conflict' },
    } as Awaited<ReturnType<typeof api.saveDraft>>);
    vi.mocked(api.openProject).mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: { code: 'offline', message: 'Offline' },
    } as Awaited<ReturnType<typeof api.openProject>>);
    await act(async () => state().saveNow());
    expect(state().saveStatus).toBe('error');
    expect(state().localCopySaved).toBe(true);
    expect(
      readLocalProjectDraft(window.localStorage, projectId, 'electronics', userId)?.document,
    ).toEqual(latest);
  });
  it('loads, saves and restores a StudentSeat using its server authority and separate identity namespace', async () => {
    const save = await mountProject();
    edit(2);
    const accountCalls = vi.mocked(api.me).mock.calls.length;
    const seatMe = vi.spyOn(api, 'classroomStudentMe').mockResolvedValue({
      ok: true,
      status: 200,
      data: { authenticated: true, student: { seatId: userId } },
    } as Awaited<ReturnType<typeof api.classroomStudentMe>>);
    await act(async () => root!.render(createElement(Probe, { seat: true })));
    expect(state().document?.viewport.zoom).toBe(1);
    expect(vi.mocked(api.me).mock.calls.length).toBe(accountCalls);
    const latest = normalizeLoadedDocument({
      ...edit(3),
      components: [resistor('seat-pupil-work', 42)],
    });
    act(() => state().setDocument(latest));
    expect(
      readLocalProjectDraft<SchematicDocument>(
        window.localStorage,
        projectId,
        'electronics',
        userId,
        'account',
      )?.document.viewport.zoom,
    ).toBe(2);
    expect(
      readLocalProjectDraft<SchematicDocument>(
        window.localStorage,
        projectId,
        'electronics',
        userId,
        'seat',
      )?.document.viewport.zoom,
    ).toBe(3);
    seatMe.mockResolvedValueOnce({ ok: true, status: 200, data: { authenticated: false } });
    await act(async () => state().saveNow());
    expect(save).not.toHaveBeenCalled();
    expect(state().saveIssue).toBe('auth');
    await act(async () => root!.unmount());
    root = createRoot(host!);
    await act(async () => root!.render(createElement(Probe, { seat: true })));
    expect(state().document).toEqual(latest);
    await act(async () => state().saveNow());
    expect(save).toHaveBeenCalledExactlyOnceWith(projectId, state().document, 1);
    expect(state().saveStatus).toBe('saved');
    expect(vi.mocked(api.me).mock.calls.length).toBe(accountCalls);
    expect(
      readLocalProjectDraft(window.localStorage, projectId, 'electronics', userId, 'seat'),
    ).toBeNull();
    expect(
      readLocalProjectDraft(window.localStorage, projectId, 'electronics', userId, 'account'),
    ).not.toBeNull();
  });
  it('retains the latest schema and sketch but retracts local durability when a later write fails', async () => {
    await mountProject();
    edit(2);
    expect(state().localCopySaved).toBe(true);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const latest = {
      ...state().document!,
      components: [
        resistor('latest', 33),
        {
          id: 'uno',
          kind: 'visual',
          componentTypeId: 'arduino-uno',
          name: 'Pupil Arduino',
          position: { x: 100, y: 100 },
          value: 5,
          stateProperties: { arduinoSource: 'void setup() {} void loop() {}' },
        },
      ],
    } as SchematicDocument;
    act(() => state().setDocument(latest));
    expect(state().document).toBe(latest);
    expect(state().localCopySaved).toBe(false);
    expect(state().getCurrentDocument()).toBe(latest);
    expect(
      readLocalProjectDraft(window.localStorage, projectId, 'electronics', userId)?.document,
    ).not.toEqual(latest);
  });

  it('catches an unavailable localStorage getter without losing the in-memory edit', async () => {
    await mountProject();
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('denied getter');
    });
    const latest = edit(3);
    expect(state().getCurrentDocument()).toBe(latest);
    expect(state().localCopySaved).toBe(false);
    vi.restoreAllMocks();
  });

  it('checks existing server session identity before resuming a failed save', async () => {
    const save = await mountProject();
    edit(2);
    vi.mocked(api.me).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { authenticated: false },
    });
    await act(async () => state().saveNow());
    expect(save).not.toHaveBeenCalled();
    expect(state().saveIssue).toBe('auth');
    const latest = edit(3);
    await advance(120_000);
    expect(save).not.toHaveBeenCalled();
    vi.mocked(api.me).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { authenticated: true, user: { id: 'different-user' } },
    } as Awaited<ReturnType<typeof api.me>>);
    await act(async () => state().saveNow());
    expect(save).not.toHaveBeenCalled();
    expect(state().localCopySaved).toBe(true);
    await act(async () => state().saveNow());
    expect(save).toHaveBeenCalledExactlyOnceWith(projectId, latest, 1);
    expect(state().saveStatus).toBe('saved');
  });

  it('drops queued work and a late response after user changes, retaining only that actor draft', async () => {
    const save = await mountProject();
    let resolveSave!: (result: Awaited<ReturnType<typeof api.saveDraft>>) => void;
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const first = edit(2);
    await act(async () => {
      void state().saveNow();
    });
    edit(3);
    act(() => window.dispatchEvent(new Event('pagehide')));
    vi.mocked(api.me).mockResolvedValue({
      ok: true,
      status: 200,
      data: { authenticated: true, user: { id: 'new-user' } },
    } as Awaited<ReturnType<typeof api.me>>);
    await act(async () => root!.render(createElement(Probe, { actor: 'new-user' })));
    expect(state().document?.viewport.zoom).toBe(1);
    expect(state().busy).toBe(false);
    await act(async () =>
      resolveSave({
        ok: true,
        status: 200,
        data: { draft: { projectId, document: first, revision: 2, updatedAt: '' }, result: null },
      } as Awaited<ReturnType<typeof api.saveDraft>>),
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(state().document?.viewport.zoom).toBe(1);
    expect(
      readLocalProjectDraft<SchematicDocument>(
        window.localStorage,
        projectId,
        'electronics',
        userId,
      )?.document.viewport.zoom,
    ).toBe(3);
    expect(
      readLocalProjectDraft(window.localStorage, projectId, 'electronics', 'new-user'),
    ).toBeNull();
  });

  it('drops a late open response after a project switch', async () => {
    await mountProject();
    let resolveOpen!: (result: Awaited<ReturnType<typeof api.openProject>>) => void;
    vi.mocked(api.openProject).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    );
    await act(async () => root!.render(createElement(Probe, { id: 'old-pending' })));
    await act(async () => root!.render(createElement(Probe, { id: 'new-project' })));
    const fresh = state().document;
    await act(async () =>
      resolveOpen({
        ok: true,
        status: 200,
        data: {
          project,
          draft: {
            projectId: 'old-pending',
            document: { ...initialDocument, viewport: { x: 999, y: 999, zoom: 3 } },
            revision: 99,
            updatedAt: '',
          },
          versions: [],
          result: null,
        },
      } as Awaited<ReturnType<typeof api.openProject>>),
    );
    expect(state().document).toBe(fresh);
    expect(state().serverRevision).toBe(1);
  });

  it('opens under the production StrictMode lifecycle and cannot retry after unmount', async () => {
    const save = await mountProject();
    await act(async () => root!.render(createElement(StrictMode, null, createElement(Probe))));
    expect(state().status).toBe('ready');
    save.mockResolvedValue({
      ok: false,
      status: 503,
      error: { code: 'temporary', message: 'Temporary' },
    } as Awaited<ReturnType<typeof api.saveDraft>>);
    edit(2);
    await act(async () => state().saveNow());
    const count = save.mock.calls.length;
    await act(async () => root!.unmount());
    root = null;
    await advance(180_000);
    expect(save).toHaveBeenCalledTimes(count);
  });
  it('recognizes reordered server JSON as saved but keeps a real migration dirty', async () => {
    const save = await mountProject();
    const normalized = normalizeLoadedDocument({
      ...initialDocument,
      components: [resistor('persisted', 10)],
    });
    const reordered = {
      ...normalized,
      components: normalized.components.map(
        (component) => Object.fromEntries(Object.entries(component).reverse()) as typeof component,
      ),
    };
    vi.mocked(api.openProject).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        project,
        draft: { projectId, document: reordered, revision: 2, updatedAt: '' },
        versions: [],
        result: null,
      },
    } as Awaited<ReturnType<typeof api.openProject>>);
    await reopenProject();
    expect(state().saveStatus).toBe('saved');
    expect(state().serverRevision).toBe(2);
    await advance(60_000);
    expect(save).not.toHaveBeenCalled();

    vi.mocked(api.openProject).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        project,
        draft: {
          projectId,
          document: { ...normalized, simulation: { running: true, maxIterations: 24 } },
          revision: 3,
          updatedAt: '',
        },
        versions: [],
        result: null,
      },
    } as Awaited<ReturnType<typeof api.openProject>>);
    await reopenProject();
    expect(state().saveStatus).toBe('dirty');
  });

  it('sends the latest edit at the first 60-second deadline despite continued edits', async () => {
    const save = await mountProject();
    edit(2);
    await advance(30_000);
    const latest = edit(3);
    await advance(29_999);
    expect(save).not.toHaveBeenCalled();
    await advance(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(projectId, latest, 1);

    for (let second = 1; second < 60; second += 1) {
      await advance(1_000);
      edit(3 + second);
    }
    expect(save).toHaveBeenCalledTimes(1);
    await advance(2_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[1]).toBe(state().document);
  });

  it('saves immediately on manual Save, visibility hidden, and pagehide', async () => {
    const save = await mountProject();
    const first = edit(2);
    await act(async () => state().saveNow());
    expect(save).toHaveBeenCalledWith(projectId, first, 1);

    const second = edit(3);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(save).toHaveBeenCalledWith(projectId, second, 2, { unloading: true });

    const third = { ...state().document!, viewport: { x: 0, y: 0, zoom: 4 } };
    await act(async () => {
      state().setDocument(third);
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(save).toHaveBeenCalledWith(projectId, third, 3, { unloading: true });
    await advance(0);
    await advance(60_000);
    expect(save).toHaveBeenCalledTimes(3);
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('starts a safety save when an SPA route unmounts the editor', async () => {
    const save = await mountProject();
    const changed = { ...state().document!, components: [resistor('route-edit', 10)] };
    act(() => state().setDocument(changed));

    await act(async () => root!.unmount());
    root = null;
    expect(save).toHaveBeenCalledWith(projectId, changed, 1, { unloading: true });
  });

  it('serially completes one genuine-unmount safety save after an older request, using its confirmed revision', async () => {
    const save = await mountProject();
    let finish!: (value: Awaited<ReturnType<typeof api.saveDraft>>) => void;
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = edit(2);
    await act(async () => {
      void state().saveNow();
    });
    const latest = edit(3);
    await act(async () => root!.unmount());
    root = null;
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () =>
      finish({
        ok: true,
        status: 200,
        data: { draft: { projectId, document: first, revision: 2, updatedAt: '' }, result: null },
      } as Awaited<ReturnType<typeof api.saveDraft>>),
    );
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(projectId, latest, 2, { unloading: true });
    // No detached response may clear a newer copy. Reopening checks it against the server.
    expect(
      readLocalProjectDraft(window.localStorage, projectId, 'electronics', userId)?.document,
    ).toEqual(latest);
    await advance(180_000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not complete detached safety under a different verified user or retry its failure', async () => {
    const save = await mountProject();
    edit(2);
    vi.mocked(api.me).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { authenticated: true, user: { id: 'different-cookie-owner' } },
    } as Awaited<ReturnType<typeof api.me>>);
    await act(async () => root!.unmount());
    root = null;
    expect(save).not.toHaveBeenCalled();
    expect(
      readLocalProjectDraft(window.localStorage, projectId, 'electronics', userId),
    ).not.toBeNull();
    await advance(180_000);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([200, 401, 403, 409])(
    'does not duplicate a same-document in-flight save or retry permanent %s on unmount',
    async (status) => {
      const save = await mountProject();
      let finish!: (value: Awaited<ReturnType<typeof api.saveDraft>>) => void;
      save.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const latest = edit(2);
      await act(async () => {
        void state().saveNow();
      });
      await act(async () => root!.unmount());
      root = null;
      await act(async () =>
        finish(
          status === 200
            ? ({
                ok: true,
                status,
                data: {
                  draft: { projectId, document: latest, revision: 2, updatedAt: '' },
                  result: null,
                },
              } as Awaited<ReturnType<typeof api.saveDraft>>)
            : ({
                ok: false,
                status,
                error: {
                  code: status === 409 ? 'project_revision_conflict' : 'auth',
                  message: 'Blocked',
                },
              } as Awaited<ReturnType<typeof api.saveDraft>>),
        ),
      );
      expect(save).toHaveBeenCalledTimes(1);
      await advance(180_000);
      expect(save).toHaveBeenCalledTimes(1);
      expect(
        readLocalProjectDraft(window.localStorage, projectId, 'electronics', userId)?.document,
      ).toEqual(latest);
    },
  );

  it('queues a later edit after the in-flight save without sending an old snapshot again', async () => {
    const save = await mountProject();
    let finishFirst: ((value: Awaited<ReturnType<typeof api.saveDraft>>) => void) | null = null;
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    const first = edit(2);
    await advance(60_000);
    expect(save).toHaveBeenCalledWith(projectId, first, 1);
    const second = edit(3);
    await advance(60_000);
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () =>
      finishFirst!({
        ok: true,
        status: 200,
        data: {
          draft: { projectId, document: first, revision: 2, updatedAt: '' },
          result: null,
        },
      } as Awaited<ReturnType<typeof api.saveDraft>>),
    );
    await advance(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(projectId, second, 2);
  });

  it('does not overwrite an independently changed server document after same-turn safety events', async () => {
    const save = await mountProject();
    const remote = {
      ...initialDocument,
      components: [resistor('remote', 50)],
    };
    vi.mocked(api.openProject).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        project,
        draft: { projectId, document: remote, revision: 2, updatedAt: '' },
        versions: [],
        result: null,
      },
    } as Awaited<ReturnType<typeof api.openProject>>);
    save.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: 'project_revision_conflict', message: 'Conflict' },
    } as Awaited<ReturnType<typeof api.saveDraft>>);

    const local = { ...edit(2), components: [resistor('local', 10)] };
    act(() => state().setDocument(local));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(projectId, local, 1, { unloading: true });
    expect(state().document?.viewport.zoom).toBe(2);
    expect(state().document?.components.map((item) => item.id)).toEqual(['remote', 'local']);
    expect(state().saveStatus).toBe('dirty');
    expect(window.localStorage.length).toBeGreaterThan(0);
  });

  it('does not send a second queued safety write after the first fails offline', async () => {
    const save = await mountProject();
    save.mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: { code: 'offline', message: 'Offline' },
    } as Awaited<ReturnType<typeof api.saveDraft>>);

    edit(2);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(state().saveStatus).toBe('error');
    expect(window.localStorage.length).toBeGreaterThan(0);
  });

  it('restores a newer dirty document when pagehide interrupts an older in-flight save', async () => {
    const save = await mountProject();
    save.mockImplementationOnce(() => new Promise(() => undefined));
    const first = { ...edit(2), components: [resistor('first', 10)] };
    act(() => state().setDocument(first));
    await act(async () => {
      void state().saveNow();
    });
    expect(save).toHaveBeenCalledWith(projectId, first, 1);
    const newest = { ...edit(3), components: [...first.components, resistor('newest', 20)] };
    act(() => state().setDocument(newest));

    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(save).toHaveBeenCalledTimes(1);
    expect(window.localStorage.length).toBeGreaterThan(0);
    expect(
      readLocalProjectDraft<SchematicDocument>(
        window.localStorage,
        projectId,
        'electronics',
        userId,
      )?.document.components.map((component) => component.id),
    ).toEqual(['first', 'newest']);
    await reopenProject();
    expect(state().document?.components.map((component) => component.id)).toEqual([
      'first',
      'newest',
    ]);
    expect(state().saveStatus).toBe('dirty');
  });

  it('restores an oversized dirty document when the unload request fails', async () => {
    const save = await mountProject();
    const large = {
      ...state().document!,
      components: [{ ...resistor('large', 10), name: 'x'.repeat(70_000) }],
    };
    act(() => state().setDocument(large));
    save.mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: { code: 'network', message: 'Unload request cancelled' },
    } as Awaited<ReturnType<typeof api.saveDraft>>);

    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(save).toHaveBeenCalledWith(projectId, large, 1, { unloading: true });
    await reopenProject();
    expect(state().document?.components[0]?.name).toBe(large.components[0]?.name);
    expect(state().saveStatus).toBe('dirty');
  });

  it('does not send a queued later edit from before a conflict merge', async () => {
    const save = await mountProject();
    let finishFirst: ((value: Awaited<ReturnType<typeof api.saveDraft>>) => void) | null = null;
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    const first = { ...edit(2), components: [resistor('local', 10)] };
    act(() => state().setDocument(first));
    await act(async () => {
      void state().saveNow();
    });
    expect(save).toHaveBeenCalledWith(projectId, first, 1);

    const later = edit(3);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    const remote = {
      ...initialDocument,
      components: [resistor('remote', 50)],
    };
    vi.mocked(api.openProject).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        project,
        draft: { projectId, document: remote, revision: 2, updatedAt: '' },
        versions: [],
        result: null,
      },
    } as Awaited<ReturnType<typeof api.openProject>>);
    await act(async () =>
      finishFirst!({
        ok: false,
        status: 409,
        error: { code: 'project_revision_conflict', message: 'Conflict' },
      } as Awaited<ReturnType<typeof api.saveDraft>>),
    );
    await advance(0);

    expect(save).toHaveBeenCalledTimes(1);
    expect(state().document?.viewport.zoom).toBe(later.viewport.zoom);
    expect(state().document?.components.map((item) => item.id)).toEqual(['remote', 'local']);
    expect(state().saveStatus).toBe('dirty');
    const merged = state().document;
    await advance(59_999);
    expect(save).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(projectId, merged, 2);
    expect(state().saveStatus).toBe('saved');
  });

  it('starts a fresh minute when an edit supersedes a due save before its queued send', async () => {
    const save = await mountProject();
    edit(2);
    act(() => vi.advanceTimersByTime(60_000));
    const latest = edit(3);
    await advance(0);
    expect(save).not.toHaveBeenCalled();
    await advance(59_999);
    expect(save).not.toHaveBeenCalled();
    await advance(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(projectId, latest, 1);
  });

  it('retries the latest queued edit quietly after a transient failure', async () => {
    const save = await mountProject();
    let resolveFirst!: (result: Awaited<ReturnType<typeof api.saveDraft>>) => void;
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    edit(2);
    await act(async () => {
      void state().saveNow();
    });
    const latest = edit(3);
    await act(async () =>
      resolveFirst({
        ok: false,
        status: 0,
        error: { code: 'offline', message: 'Offline' },
      } as Awaited<ReturnType<typeof api.saveDraft>>),
    );
    expect(state().saveStatus).toBe('error');
    await advance(4_999);
    expect(save).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(projectId, latest, 1);
    expect(state().saveStatus).toBe('saved');
  });

  it.each([0, 408, 500, 503])(
    'backs off temporary HTTP %s failures without edits or retry storms',
    async (status) => {
      const save = await mountProject();
      save.mockResolvedValue({
        ok: false,
        status,
        error: { code: 'temporary', message: 'Temporary' },
      } as Awaited<ReturnType<typeof api.saveDraft>>);
      const latest = edit(2);
      await act(async () => state().saveNow());
      for (const interval of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) {
        const before = save.mock.calls.length;
        await advance(interval - 1);
        expect(save).toHaveBeenCalledTimes(before);
        await advance(1);
        expect(save).toHaveBeenCalledTimes(before + 1);
        expect(save).toHaveBeenLastCalledWith(projectId, latest, 1);
      }
      save.mockResolvedValue({
        ok: true,
        status: 200,
        data: { draft: { projectId, document: latest, revision: 2, updatedAt: '' }, result: null },
      } as Awaited<ReturnType<typeof api.saveDraft>>);
      await advance(60_000);
      expect(state().saveStatus).toBe('saved');
      const count = save.mock.calls.length;
      await advance(120_000);
      expect(save).toHaveBeenCalledTimes(count);
    },
  );

  it.each([400, 401, 403, 404, 409])(
    'does not let edits or repeated hide events clear permanent HTTP %s failure',
    async (status) => {
      const save = await mountProject();
      save.mockResolvedValueOnce({
        ok: false,
        status,
        error: {
          code: status === 409 ? 'project_revision_conflict' : 'permanent',
          message: 'Permanent',
        },
      } as Awaited<ReturnType<typeof api.saveDraft>>);
      if (status === 409)
        vi.mocked(api.openProject).mockResolvedValueOnce({
          ok: false,
          status: 0,
          error: { code: 'offline', message: 'Offline' },
        } as Awaited<ReturnType<typeof api.openProject>>);
      edit(2);
      await act(async () => state().saveNow());
      expect(state().saveStatus).toBe('error');
      edit(3);
      await act(async () => {
        window.dispatchEvent(new Event('pagehide'));
        window.dispatchEvent(new Event('pagehide'));
      });
      await advance(180_000);
      expect(save).toHaveBeenCalledTimes(1);
      expect(state().saveStatus).toBe('error');
      expect(state().localCopySaved).toBe(true);
    },
  );

  it('rearms a thrown transport failure and only sends one request', async () => {
    const save = await mountProject();
    save.mockRejectedValueOnce(new Error('network failed'));
    const latest = edit(2);
    await act(async () => state().saveNow());
    expect(state().saveStatus).toBe('error');
    await advance(4_999);
    expect(save).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(projectId, latest, 1);
    expect(state().saveStatus).toBe('saved');
  });

  it('clears the error after a successful manual retry without creating another autosave', async () => {
    const save = await mountProject();
    save.mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: { code: 'offline', message: 'Offline' },
    } as Awaited<ReturnType<typeof api.saveDraft>>);
    const changed = { ...state().document!, components: [resistor('retry', 10)] };
    act(() => state().setDocument(changed));

    await act(async () => state().saveNow());
    expect(state().saveStatus).toBe('error');
    expect(window.localStorage.length).toBeGreaterThan(0);
    await act(async () => state().saveNow());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(projectId, changed, 1);
    expect(state().saveStatus).toBe('saved');
    expect(window.localStorage.length).toBe(0);
    await advance(60_000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('keeps a due save behind simulation startup until the local Worker confirms', async () => {
    const save = await mountProject();
    edit(2);
    await act(async () => state().toggleSimulation());
    expect(state().simulationStatus).toBe('starting');
    await advance(60_000);
    expect(save).not.toHaveBeenCalled();
    act(() => state().confirmSimulationStarted());
    await advance(0);
    expect(save).toHaveBeenCalledTimes(1);
    edit(3);
    await advance(700);
    expect(save).toHaveBeenCalledTimes(1);
    await advance(59_300);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
