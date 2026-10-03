/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
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

function Probe() {
  current = useWorkbenchProjectState(projectId);
  return null;
}

async function mountProject() {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(0);
  window.localStorage.clear();
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

afterEach(() => {
  if (root) act(() => root!.unmount());
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
    act(() => {
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

    act(() => root!.unmount());
    root = null;
    expect(save).toHaveBeenCalledWith(projectId, changed, 1, { unloading: true });
  });

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

    act(() => window.dispatchEvent(new Event('pagehide')));
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

  it('keeps a later queued edit local after an in-flight save fails, then recovers on a new edit', async () => {
    const save = await mountProject();
    let finishFirst: ((value: Awaited<ReturnType<typeof api.saveDraft>>) => void) | null = null;
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    edit(2);
    await act(async () => {
      void state().saveNow();
    });
    edit(3);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () =>
      finishFirst!({
        ok: false,
        status: 0,
        error: { code: 'offline', message: 'Offline' },
      } as Awaited<ReturnType<typeof api.saveDraft>>),
    );
    await advance(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(state().saveStatus).toBe('error');
    expect(window.localStorage.length).toBeGreaterThan(0);

    const recovered = edit(4);
    await advance(59_999);
    expect(save).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(save).toHaveBeenLastCalledWith(projectId, recovered, 1);
    expect(state().saveStatus).toBe('saved');
  });

  it('does not loop after a failed save and gives the next edit a fresh minute', async () => {
    const save = await mountProject();
    save.mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: { code: 'offline', message: 'Offline' },
    } as Awaited<ReturnType<typeof api.saveDraft>>);
    edit(2);
    await advance(60_000);
    expect(state().saveStatus).toBe('error');
    await advance(180_000);
    expect(save).toHaveBeenCalledTimes(1);
    const recovered = edit(3);
    await advance(59_999);
    expect(save).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(save).toHaveBeenLastCalledWith(projectId, recovered, 1);
    expect(state().saveStatus).toBe('saved');
  });

  it.each([
    { name: 'offline', status: 0, code: 'offline' },
    { name: 'revision conflict', status: 409, code: 'project_revision_conflict' },
  ])(
    'does not flush an unchanged failed draft on repeated hide events after $name',
    async (failure) => {
      const save = await mountProject();
      if (failure.status === 409) {
        vi.mocked(api.openProject).mockResolvedValueOnce({
          ok: false,
          status: 0,
          error: { code: 'offline', message: 'Cannot load latest revision' },
        } as Awaited<ReturnType<typeof api.openProject>>);
      }
      save.mockResolvedValueOnce({
        ok: false,
        status: failure.status,
        error: { code: failure.code, message: failure.name },
      } as Awaited<ReturnType<typeof api.saveDraft>>);

      edit(2);
      await advance(60_000);
      expect(save).toHaveBeenCalledTimes(1);
      expect(state().saveStatus).toBe('error');

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('pagehide'));
        window.dispatchEvent(new Event('pagehide'));
      });
      expect(save).toHaveBeenCalledTimes(1);
      await advance(120_000);
      expect(save).toHaveBeenCalledTimes(1);

      const recovered = edit(3);
      await advance(59_999);
      expect(save).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(save).toHaveBeenCalledTimes(2);
      expect(save).toHaveBeenLastCalledWith(projectId, recovered, 1);
      Reflect.deleteProperty(document, 'visibilityState');
    },
  );

  it('stops automatic retries when the draft request throws', async () => {
    const save = await mountProject();
    save.mockRejectedValueOnce(new Error('network request failed'));
    edit(2);
    await advance(60_000);
    expect(state().saveStatus).toBe('error');
    expect(window.localStorage.length).toBeGreaterThan(0);
    await advance(120_000);
    expect(save).toHaveBeenCalledTimes(1);
    edit(3);
    await advance(60_000);
    expect(save).toHaveBeenCalledTimes(2);
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
