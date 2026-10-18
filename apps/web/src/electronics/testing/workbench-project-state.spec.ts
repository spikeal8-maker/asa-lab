/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseElectronicsDocument } from '@asa-lab/electronics';
import { api, type Project, type SchematicDocument } from '../../api';
import {
  localProjectDraftKey,
  readLocalProjectDraft,
  writeLocalProjectDraft,
} from '../../modules/project-local-draft';
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
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  vi.setSystemTime(0);
  window.localStorage.clear();
  window.sessionStorage.clear();
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

async function reopenProject(expectedStatus: 'ready' | 'error' = 'ready') {
  await act(async () => root!.unmount());
  host?.remove();
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(createElement(Probe)));
  expect(state().status).toBe(expectedStatus);
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
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('Electronics project autosave in the mounted editor hook', () => {
  function oldCopy(): SchematicDocument {
    const id = 'old-copy-'.repeat(15);
    return {
      ...initialDocument,
      components: [resistor('base', 10), { ...resistor(id, 80), name: 'Old copy' }],
      connections: [
        {
          id: 'old-wire-'.repeat(15),
          from: { componentId: 'base', terminal: 'a' },
          to: { componentId: id, terminal: 'b' },
        },
      ],
    };
  }

  function storeOldCopy(document = oldCopy(), baseDocument = initialDocument) {
    const key =
      localProjectDraftKey(projectId, userId, 'account') + ':electronics-editor:old-classroom-tab';
    expect(
      writeLocalProjectDraft(
        window.localStorage,
        {
          projectId,
          userId,
          identityKind: 'account',
          moduleKey: 'electronics',
          baseRevision: 1,
          baseDocument,
          document,
        },
        key,
      ),
    ).toBe(true);
    window.sessionStorage.clear();
    return { key, raw: window.localStorage.getItem(key)! };
  }

  it.each([
    ['delete', false],
    ['edit', false],
    ['delete', true],
    ['edit', true],
  ] as const)(
    'retires the consumed source after %s before first confirmation (reload=%s)',
    async (action, reload) => {
      const save = await mountProject();
      const { key, raw } = storeOldCopy();
      await reopenProject();
      const recovered = state().document!;
      const changed =
        action === 'delete'
          ? { ...recovered, components: [], connections: [] }
          : {
              ...recovered,
              components: recovered.components.map((item) => ({ ...item, value: 1000 })),
            };
      act(() => state().setDocument(changed));
      if (reload) {
        // Leave without a successful server write; the lineage must survive in storage.
        save.mockResolvedValue({
          ok: false,
          status: 0,
          error: { code: 'offline', message: 'offline' },
        } as Awaited<ReturnType<typeof api.saveDraft>>);
        window.sessionStorage.clear();
        await reopenProject();
      }
      save.mockImplementation(async (_id, document, revision) => {
        expect(parseElectronicsDocument(document).ok).toBe(true);
        vi.mocked(api.openProject).mockResolvedValue({
          ok: true,
          status: 200,
          data: {
            project,
            draft: { projectId, document, revision: revision + 1, updatedAt: '' },
            versions: [],
            result: null,
          },
        } as Awaited<ReturnType<typeof api.openProject>>);
        return {
          ok: true,
          status: 200,
          data: {
            draft: { projectId, document, revision: revision + 1, updatedAt: '' },
            result: null,
          },
        } as Awaited<ReturnType<typeof api.saveDraft>>;
      });
      await act(async () => state().saveNow());
      expect(state().saveStatus).toBe('saved');
      expect(window.localStorage.getItem(key)).toBe(raw);
      expect(window.localStorage.getItem(key + ':ack')).not.toBeNull();
      window.sessionStorage.clear();
      await reopenProject();
      expect(state().document!.components).toEqual(changed.components);
      expect(state().document!.connections).toEqual(changed.connections);
      expect(state().saveStatus).toBe('saved');
    },
  );

  it('repairs an old local copy, confirms a valid save and never resurrects the original branch', async () => {
    const save = await mountProject();
    const { key, raw } = storeOldCopy();
    await reopenProject();
    const repaired = state().document!;
    expect(parseElectronicsDocument(repaired).ok).toBe(true);
    expect(repaired.components).toHaveLength(2);
    expect(repaired.connections[0]!.to.componentId).toBe(repaired.components[1]!.id);
    expect(state().saveStatus).toBe('dirty');
    expect(state().localCopySaved).toBe(true);
    const originals = Object.keys(window.localStorage).filter((item) =>
      item.includes(':electronics-identifier-original:'),
    );
    expect(originals).toHaveLength(1);
    expect(window.localStorage.getItem(originals[0]!)).toBe(raw);
    save.mockImplementation(async (_id, document, revision) => {
      expect(parseElectronicsDocument(document).ok).toBe(true);
      const stored = JSON.parse(JSON.stringify(document)) as SchematicDocument;
      vi.mocked(api.openProject).mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          project,
          draft: { projectId, document: stored, revision: revision + 1, updatedAt: '' },
          versions: [],
          result: null,
        },
      } as Awaited<ReturnType<typeof api.openProject>>);
      return {
        ok: true,
        status: 200,
        data: {
          draft: { projectId, document: stored, revision: revision + 1, updatedAt: '' },
          result: null,
        },
      } as Awaited<ReturnType<typeof api.saveDraft>>;
    });
    await act(async () => state().saveNow());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![2]).toBe(1);
    expect(state().saveStatus).toBe('saved');
    expect(window.localStorage.getItem(key + ':ack')).not.toBeNull();
    window.sessionStorage.clear();
    await reopenProject();
    expect(state().document).toEqual(repaired);
    // A later confirmed deletion must not bring back an old, pre-repair branch.
    act(() => state().setDocument({ ...state().document!, components: [], connections: [] }));
    await act(async () => state().saveNow());
    window.sessionStorage.clear();
    await reopenProject();
    expect(state().document!.components).toEqual([]);
    expect(state().document!.connections).toEqual([]);
    expect(state().saveStatus).toBe('saved');
    expect(window.localStorage.getItem(originals[0]!)).toBe(raw);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('backs up a legacy server draft before repair and retains its actual revision', async () => {
    const save = await mountProject();
    const original = oldCopy();
    vi.mocked(api.openProject).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        project,
        draft: { projectId, document: original, revision: 17, updatedAt: '2026-10-16T12:00:00Z' },
        versions: [],
        result: null,
      },
    } as Awaited<ReturnType<typeof api.openProject>>);
    await reopenProject();
    expect(parseElectronicsDocument(state().document).ok).toBe(true);
    expect(state().saveStatus).toBe('dirty');
    const backup = Object.keys(window.localStorage).find((key) =>
      key.includes(':electronics-identifier-original:'),
    )!;
    expect(JSON.parse(window.localStorage.getItem(backup)!)).toMatchObject({
      document: original,
      baseRevision: 17,
      userId,
      identityKind: 'account',
    });
    save.mockImplementationOnce(
      async (_id, document, revision) =>
        ({
          ok: true,
          status: 200,
          data: {
            draft: { projectId, document, revision: revision + 1, updatedAt: '' },
            result: null,
          },
        }) as Awaited<ReturnType<typeof api.saveDraft>>,
    );
    await act(async () => state().saveNow());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![2]).toBe(17);
    expect(state().serverRevision).toBe(18);
  });

  it('does not apply a repair or overwrite the original when its backup cannot be verified', async () => {
    const save = await mountProject();
    const { key, raw } = storeOldCopy();
    const actualSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      name,
      value,
    ) {
      if (name.includes(':electronics-identifier-original:')) throw new Error('quota');
      actualSet.call(this, name, value);
    });
    await reopenProject('error');
    expect(window.localStorage.getItem(key)).toBe(raw);
    expect(window.localStorage.getItem(key + ':ack')).toBeNull();
    expect(state().document).toBeNull();
    await advance(180_000);
    expect(save).not.toHaveBeenCalled();
  });

  it('leaves an ambiguous legacy slot byte-for-byte intact without saving or acknowledging it', async () => {
    const save = await mountProject();
    const original = oldCopy();
    const ambiguous = {
      ...original,
      components: [...original.components, original.components[1]!],
    };
    const stored = storeOldCopy(ambiguous);
    const key = localProjectDraftKey(projectId, userId, 'account');
    window.localStorage.setItem(key, stored.raw);
    window.localStorage.removeItem(stored.key);
    await reopenProject('error');
    expect(window.localStorage.getItem(key)).toBe(stored.raw);
    expect(window.localStorage.getItem(key + ':ack')).toBeNull();
    await advance(180_000);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps CAS conflicts and the actual base snapshot (invalid base=%s)',
    async (invalidBase) => {
      const save = await mountProject();
      const base = normalizeLoadedDocument(
        invalidBase
          ? oldCopy()
          : {
              ...initialDocument,
              components: [resistor('base', 10)],
            },
      );
      const original = oldCopy();
      const local = {
        ...original,
        components: original.components.map((item) =>
          item.id === 'base' ? { ...item, value: 330 } : item,
        ),
      };
      storeOldCopy(local, base);
      const remote = {
        ...base,
        components: base.components.map((item) =>
          item.id === 'base' ? { ...item, value: 470 } : item,
        ),
      };
      vi.mocked(api.openProject).mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          project,
          draft: { projectId, document: remote, revision: 2, updatedAt: '' },
          versions: [],
          result: null,
        },
      } as Awaited<ReturnType<typeof api.openProject>>);
      await reopenProject();
      expect(state().saveIssue).toBe('conflict');
      expect(state().serverRevision).toBe(1);
      expect(state().document!.components.find((item) => item.id === 'base')!.value).toBe(330);
      expect(parseElectronicsDocument(state().document).ok).toBe(true);
      expect(state().localCopySaved).toBe(true);
      expect(
        readLocalProjectDraft<SchematicDocument>(
          window.localStorage,
          projectId,
          'electronics',
          userId,
        )!.baseDocument,
      ).toEqual(base);
      await advance(180_000);
      expect(save).not.toHaveBeenCalled();
    },
  );

  it('stops a non-advancing conflict readback instead of repeating on every hide', async () => {
    const save = await mountProject();
    const local = { ...state().document!, components: [resistor('local', 10)] };
    act(() => state().setDocument(local));
    save.mockResolvedValue({
      ok: false,
      status: 409,
      error: { code: 'project_revision_conflict', message: 'Conflict' },
    } as Awaited<ReturnType<typeof api.saveDraft>>);
    await act(async () => state().saveNow());
    for (let i = 0; i < 10; i++) {
      await act(async () => window.dispatchEvent(new Event('pagehide')));
      await advance(250);
    }
    await advance(180_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(state().saveIssue).toBe('conflict');
    expect(state().localCopySaved).toBe(true);
    expect(state().document).toEqual(local);
  });

  it('finishes lost-reply readback as saved without another automatic PUT', async () => {
    const save = await mountProject();
    const local = normalizeLoadedDocument({
      ...state().document!,
      components: [resistor('committed-with-lost-reply', 10)],
    });
    act(() => state().setDocument(local));
    save.mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: { code: 'network', message: 'Reply lost after commit' },
    } as Awaited<ReturnType<typeof api.saveDraft>>);
    save.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: 'project_revision_conflict', message: 'Conflict' },
    } as Awaited<ReturnType<typeof api.saveDraft>>);
    vi.mocked(api.openProject).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        project,
        draft: { projectId, document: structuredClone(local), revision: 2, updatedAt: '' },
        versions: [],
        result: null,
      },
    } as Awaited<ReturnType<typeof api.openProject>>);
    await act(async () => state().saveNow());
    await advance(60_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(state().saveStatus).toBe('saved');
    expect(state().serverRevision).toBe(2);
    expect(state().document).toEqual(local);
    await advance(180_000);
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('spaces safe conflict rebases, stops after the finite budget, and permits an explicit retry', async () => {
    const save = await mountProject();
    let remoteRevision = 1;
    save.mockResolvedValue({
      ok: false,
      status: 409,
      error: { code: 'project_revision_conflict', message: 'Conflict' },
    } as Awaited<ReturnType<typeof api.saveDraft>>);
    vi.mocked(api.openProject).mockImplementation(
      async () =>
        ({
          ok: true,
          status: 200,
          data: {
            project,
            draft: {
              projectId,
              document: { ...initialDocument, components: [resistor('remote', ++remoteRevision)] },
              revision: remoteRevision,
              updatedAt: '',
            },
            versions: [],
            result: null,
          },
        }) as Awaited<ReturnType<typeof api.openProject>>,
    );
    act(() => state().setDocument({ ...state().document!, components: [resistor('local', 10)] }));
    await act(async () => state().saveNow());
    for (let attempt = 1; attempt <= 3; attempt++) {
      for (let event = 0; event < 5; event++) {
        await act(async () => window.dispatchEvent(new Event('pagehide')));
        await advance(250);
      }
      // New edits must neither bypass the delay nor reset the rebase budget.
      act(() => state().setDocument({ ...state().document! }));
      await advance(58_749);
      expect(save).toHaveBeenCalledTimes(attempt);
      await advance(1);
      expect(save).toHaveBeenCalledTimes(attempt + 1);
    }
    expect(state().saveIssue).toBe('conflict');
    expect(state().localCopySaved).toBe(true);
    await advance(600_000);
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(save).toHaveBeenCalledTimes(4);
    await act(async () => state().saveNow());
    expect(state().saveStatus).toBe('dirty');
    expect(save).toHaveBeenCalledTimes(5);
    save.mockImplementationOnce(
      async (_id, document, revision) =>
        ({
          ok: true,
          status: 200,
          data: {
            draft: { projectId, document, revision: revision + 1, updatedAt: '' },
            result: null,
          },
        }) as Awaited<ReturnType<typeof api.saveDraft>>,
    );
    await advance(60_000);
    expect(state().saveStatus).toBe('saved');
    expect(save).toHaveBeenCalledTimes(6);
  });

  it('keeps a later local edit when lost-reply readback confirms only the earlier snapshot', async () => {
    const save = await mountProject();
    const first = normalizeLoadedDocument({
      ...state().document!,
      components: [resistor('committed', 10)],
    });
    act(() => state().setDocument(first));
    save.mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: { code: 'network', message: 'Reply lost after commit' },
    } as Awaited<ReturnType<typeof api.saveDraft>>);
    await act(async () => state().saveNow());
    let readback: ((value: Awaited<ReturnType<typeof api.openProject>>) => void) | undefined;
    vi.mocked(api.openProject).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          readback = resolve;
        }),
    );
    save.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: 'project_revision_conflict', message: 'Conflict' },
    } as Awaited<ReturnType<typeof api.saveDraft>>);
    await advance(60_000);
    const later = normalizeLoadedDocument({
      ...first,
      components: [...first.components, resistor('later', 20)],
    });
    act(() => state().setDocument(later));
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    await act(async () =>
      readback!({
        ok: true,
        status: 200,
        data: {
          project,
          draft: { projectId, document: first, revision: 2, updatedAt: '' },
          versions: [],
          result: null,
        },
      } as Awaited<ReturnType<typeof api.openProject>>),
    );
    expect(save).toHaveBeenCalledTimes(2);
    expect(state().saveStatus).toBe('dirty');
    expect(state().document?.components.map((item) => item.id)).toEqual(['committed', 'later']);
    expect(state().localCopySaved).toBe(true);
    await advance(59_999);
    expect(save).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(save).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenLastCalledWith(projectId, state().document, 2);
    expect(state().saveStatus).toBe('saved');
  });

  it('opens once without background polling and refreshes a clean document on focus', async () => {
    await mountProject();
    const open = vi.mocked(api.openProject);
    expect(open).toHaveBeenCalledTimes(1);
    await advance(12_000);
    expect(open).toHaveBeenCalledTimes(1);
    const remote = normalizeLoadedDocument({
      ...initialDocument,
      viewport: { x: 0, y: 0, zoom: 2 },
    });
    open.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        project,
        draft: { projectId, document: remote, revision: 2, updatedAt: '' },
        versions: [],
        result: null,
      },
    } as Awaited<ReturnType<typeof api.openProject>>);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(open).toHaveBeenCalledTimes(2);
    expect(state().document).toEqual(remote);
    expect(state().saveStatus).toBe('saved');
  });

  it.each([userId, 'collaborator'])(
    'preserves both mounted editors through exit for second actor %s',
    async (otherUser) => {
      const save = await mountProject();
      const first = () => state();
      let other: ReturnType<typeof useWorkbenchProjectState> | null = null;
      const second = () => {
        if (!other) throw new Error('Second editor has not rendered');
        return other;
      };
      function OtherEditor() {
        other = useWorkbenchProjectState(projectId, otherUser);
        return null;
      }
      let server = { document: normalizeLoadedDocument(initialDocument), revision: 1 };
      vi.mocked(api.openProject).mockImplementation(
        async () =>
          ({
            ok: true,
            status: 200,
            data: {
              project,
              draft: { projectId, ...structuredClone(server), updatedAt: '' },
              versions: [],
              result: null,
            },
          }) as Awaited<ReturnType<typeof api.openProject>>,
      );
      save.mockImplementation(async (_id, document, revision) => {
        if (revision !== server.revision)
          return {
            ok: false,
            status: 409,
            error: { code: 'project_revision_conflict', message: 'Conflict' },
          } as Awaited<ReturnType<typeof api.saveDraft>>;
        server = {
          document: structuredClone(document) as SchematicDocument,
          revision: revision + 1,
        };
        return {
          ok: true,
          status: 200,
          data: { draft: { projectId, ...server, updatedAt: '' }, result: null },
        } as Awaited<ReturnType<typeof api.saveDraft>>;
      });
      const identify = (id: string) =>
        vi.mocked(api.me).mockResolvedValue({
          ok: true,
          status: 200,
          data: { authenticated: true, user: { id } },
        } as Awaited<ReturnType<typeof api.me>>);
      const otherHost = document.body.appendChild(document.createElement('div'));
      const otherRoot = createRoot(otherHost);
      const tabData = new Map<string, string>();
      const otherSession: Storage = {
        get length() {
          return tabData.size;
        },
        key: (index) => [...tabData.keys()][index] ?? null,
        getItem: (key) => tabData.get(key) ?? null,
        setItem: (key, value) => {
          tabData.set(key, value);
        },
        removeItem: (key) => {
          tabData.delete(key);
        },
        clear: () => tabData.clear(),
      };
      vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(otherSession);
      let otherMounted = true;
      try {
        identify(otherUser);
        await act(async () => otherRoot.render(createElement(OtherEditor)));
        act(() => first().setDocument({ ...first().document!, components: [resistor('a', 10)] }));
        act(() => second().setDocument({ ...second().document!, components: [resistor('b', 20)] }));
        identify(userId);
        await act(async () => first().saveNow());
        act(() =>
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: `asa-project-local-draft:user:account:${userId}:${projectId}`,
              newValue: null,
            }),
          ),
        );
        expect(second().localCopySaved).toBe(true);
        identify(otherUser);
        await act(async () => second().saveNow());
        expect(second().saveStatus).toBe('dirty');
        expect(second().document?.components.map((item) => item.id)).toEqual(['a', 'b']);
        expect(first().document?.components.map((item) => item.id)).toEqual(['a']);
        await advance(60_000);
        expect(second().saveStatus).toBe('saved');
        expect(server.document.components.map((item) => item.id)).toEqual(['a', 'b']);
        await act(async () => window.dispatchEvent(new Event('focus')));
        const change = (editor: ReturnType<typeof useWorkbenchProjectState>, value: number) =>
          editor.setDocument({
            ...editor.document!,
            components: editor.document!.components.map((item) =>
              item.id === 'a' ? { ...item, value } : item,
            ),
          });
        act(() => change(first(), 330));
        act(() => change(second(), 470));
        identify(userId);
        await act(async () => first().saveNow());
        identify(otherUser);
        await act(async () => second().saveNow());
        expect(second().saveIssue).toBe('conflict');
        expect(server.document.components.find((item) => item.id === 'a')?.value).toBe(330);
        expect(second().document?.components.find((item) => item.id === 'a')?.value).toBe(470);
        const calls = save.mock.calls.length;
        await advance(600_000);
        await act(async () => window.dispatchEvent(new Event('pagehide')));
        expect(save).toHaveBeenCalledTimes(calls);
        act(() => change(first(), 560));
        // Independent browser sessions are represented by verified identity at each action.
        // On exit identity is unavailable: neither local copy may disappear or overwrite server.
        vi.mocked(api.me).mockResolvedValue({
          ok: true,
          status: 200,
          data: { authenticated: false },
        } as Awaited<ReturnType<typeof api.me>>);
        await act(async () => {
          otherRoot.unmount();
          root!.unmount();
        });
        otherMounted = false;
        root = null;
        expect(save).toHaveBeenCalledTimes(calls);
        const owned = Array.from({ length: window.localStorage.length }, (_, index) =>
          window.localStorage.key(index),
        )
          .filter((key) => key?.includes(':electronics-editor:'))
          .map(
            (key) =>
              JSON.parse(window.localStorage.getItem(key!)!) as {
                userId: string;
                document: SchematicDocument;
              },
          );
        expect(
          owned.some(
            (copy) =>
              copy.userId === userId &&
              copy.document.components.find((item) => item.id === 'a')?.value === 560,
          ),
        ).toBe(true);
        expect(
          owned.some(
            (copy) =>
              copy.userId === otherUser &&
              copy.document.components.find((item) => item.id === 'a')?.value === 470,
          ),
        ).toBe(true);
        expect(server.document.components.find((item) => item.id === 'a')?.value).toBe(330);
      } finally {
        if (otherMounted) await act(async () => otherRoot.unmount());
        otherHost.remove();
      }
    },
  );

  it('allows an explicit checkpoint during the quiet conflict cooldown', async () => {
    const save = await mountProject();
    act(() => state().setDocument({ ...state().document!, components: [resistor('local', 10)] }));
    save.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: 'project_revision_conflict', message: 'Conflict' },
    } as Awaited<ReturnType<typeof api.saveDraft>>);
    vi.mocked(api.openProject).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        project,
        draft: {
          projectId,
          document: { ...initialDocument, components: [resistor('remote', 20)] },
          revision: 2,
          updatedAt: '',
        },
        versions: [],
        result: null,
      },
    } as Awaited<ReturnType<typeof api.openProject>>);
    await act(async () => state().saveNow());
    save.mockImplementationOnce(
      async (_id, document, revision) =>
        ({
          ok: true,
          status: 200,
          data: {
            draft: { projectId, document, revision: revision + 1, updatedAt: '' },
            result: { solved: true },
          },
        }) as Awaited<ReturnType<typeof api.saveDraft>>,
    );
    const checkpoint = vi.spyOn(api, 'createCheckpoint').mockResolvedValue({
      ok: true,
      status: 200,
      data: { version: { versionNo: 1 } },
    } as Awaited<ReturnType<typeof api.createCheckpoint>>);
    await act(async () => state().checkpoint());
    expect(save).toHaveBeenCalledTimes(2);
    expect(checkpoint).toHaveBeenCalledExactlyOnceWith(projectId);
    expect(state().saveStatus).toBe('saved');
    await advance(120_000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    'retires an included recovered branch while preserving migration=%s',
    async (migration) => {
      const save = await mountProject();
      writeLocalProjectDraft(window.localStorage, {
        projectId,
        userId,
        moduleKey: 'electronics',
        baseRevision: 1,
        baseDocument: initialDocument,
        document: normalizeLoadedDocument({ ...initialDocument, components: [resistor('a', 10)] }),
      });
      const rawRemote = { ...initialDocument, components: [resistor('a', 10), resistor('b', 20)] };
      const remote = migration ? rawRemote : normalizeLoadedDocument(rawRemote);
      vi.mocked(api.openProject).mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          project,
          draft: { projectId, document: remote, revision: 2, updatedAt: '' },
          versions: [],
          result: null,
        },
      } as Awaited<ReturnType<typeof api.openProject>>);
      window.sessionStorage.clear();
      await reopenProject();
      expect(state().document).toEqual(normalizeLoadedDocument(remote));
      expect(state().saveStatus).toBe(migration ? 'dirty' : 'saved');
      if (!migration)
        expect(
          readLocalProjectDraft(window.localStorage, projectId, 'electronics', userId),
        ).toBeNull();
      else
        save.mockImplementationOnce(
          async (_id, document, revision) =>
            ({
              ok: true,
              status: 200,
              data: {
                draft: { projectId, document, revision: revision + 1, updatedAt: '' },
                result: null,
              },
            }) as Awaited<ReturnType<typeof api.saveDraft>>,
        );
      await advance(180_000);
      expect(save).toHaveBeenCalledTimes(migration ? 1 : 0);
      expect(state().saveStatus).toBe('saved');
      expect(
        readLocalProjectDraft(window.localStorage, projectId, 'electronics', userId),
      ).toBeNull();
    },
  );

  it('does not fetch on dirty focus or overwrite an edit made during a clean focus request', async () => {
    await mountProject();
    const open = vi.mocked(api.openProject);
    let finish: ((value: Awaited<ReturnType<typeof api.openProject>>) => void) | undefined;
    open.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(open).toHaveBeenCalledTimes(2);
    const local = edit(3);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(open).toHaveBeenCalledTimes(2);
    const remote = normalizeLoadedDocument({
      ...initialDocument,
      viewport: { x: 0, y: 0, zoom: 2 },
    });
    await act(async () =>
      finish!({
        ok: true,
        status: 200,
        data: {
          project,
          draft: { projectId, document: remote, revision: 2, updatedAt: '' },
          versions: [],
          result: null,
        },
      } as Awaited<ReturnType<typeof api.openProject>>),
    );
    expect(state().document).toEqual(local);
    expect(state().saveStatus).toBe('dirty');
    expect(state().localCopySaved).toBe(true);
    expect(
      readLocalProjectDraft(window.localStorage, projectId, 'electronics', userId)?.document,
    ).toEqual(local);
  });

  it('retracts another-tab-cleared local durability and restores the current copy on save failure', async () => {
    const save = await mountProject();
    const latest = edit(2);
    expect(state().localCopySaved).toBe(true);
    const key = `asa-project-local-draft:user:account:${userId}:${projectId}`;
    window.localStorage.removeItem(key);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key, newValue: null })));
    expect(state().localCopySaved).toBe(true);
    const ownedKey = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    ).find((item) => item?.startsWith(`${key}:electronics-editor:`))!;
    window.localStorage.removeItem(ownedKey);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: ownedKey, newValue: null })));
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
    edit(3);
    await act(async () =>
      resolveFirst({
        ok: false,
        status: 0,
        error: { code: 'offline', message: 'Offline' },
      } as Awaited<ReturnType<typeof api.saveDraft>>),
    );
    expect(state().saveStatus).toBe('error');
    await advance(30_000);
    const latest = edit(4);
    expect(state().localCopySaved).toBe(true);
    expect(
      readLocalProjectDraft(window.localStorage, projectId, 'electronics', userId)?.document,
    ).toEqual(latest);
    await advance(29_999);
    expect(save).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(projectId, latest, 1);
    expect(state().saveStatus).toBe('saved');
  });

  it.each([0, 408, 500, 503])(
    'spaces temporary HTTP %s retries by one minute without edits or retry storms',
    async (status) => {
      const save = await mountProject();
      save.mockResolvedValue({
        ok: false,
        status,
        error: { code: 'temporary', message: 'Temporary' },
      } as Awaited<ReturnType<typeof api.saveDraft>>);
      const latest = edit(2);
      await act(async () => state().saveNow());
      for (const interval of [60_000, 60_000, 60_000, 60_000, 60_000, 60_000]) {
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
    await advance(59_999);
    expect(save).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(projectId, latest, 1);
    expect(state().saveStatus).toBe('saved');
  });

  it('spaces a temporary identity transport retry by a minute before sending the latest draft', async () => {
    const save = await mountProject();
    const me = vi.mocked(api.me);
    me.mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: { code: 'temporary', message: 'Temporary' },
    } as Awaited<ReturnType<typeof api.me>>);
    edit(2);
    await act(async () => state().saveNow());
    expect(state().saveStatus).toBe('error');
    expect(save).not.toHaveBeenCalled();
    const identityAttempts = me.mock.calls.length;
    await advance(30_000);
    const latest = edit(3);
    await advance(29_999);
    expect(me).toHaveBeenCalledTimes(identityAttempts);
    expect(save).not.toHaveBeenCalled();
    expect(state().localCopySaved).toBe(true);
    await advance(1);
    expect(me).toHaveBeenCalledTimes(identityAttempts + 1);
    expect(save).toHaveBeenCalledExactlyOnceWith(projectId, latest, 1);
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
    expect(readLocalProjectDraft(window.localStorage, projectId, 'electronics', userId)).toBeNull();
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
