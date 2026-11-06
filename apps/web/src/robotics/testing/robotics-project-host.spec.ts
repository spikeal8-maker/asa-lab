/* @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialRoboticsProject } from '@asa-lab/robotics/document';
import { api, type ApiResult, type Project, type ProjectDraft } from '../../api';
import {
  localProjectDraftKey,
  readLocalProjectDraft,
  writeLocalProjectDraft,
} from '../../modules/project-local-draft';
import { projectDraftMutationIdSync } from '../../modules/project-draft-mutation';
import { toRoboticsWebProject, type RoboticsProject } from '../robotics-project';
import {
  useOpenRoboticsProject,
  useRoboticsProject,
  type OpenRoboticsProject,
} from '../use-robotics-project';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const id = '64d1b8a0-4500-4000-8000-000000000001';
const owner = '64d1b8a0-4500-4000-8000-000000000002';
const other = '64d1b8a0-4500-4000-8000-000000000003';
const now = '2026-11-05T12:00:00Z';
const metadata = (title = 'Робот из аккаунта'): Project => ({
  id,
  scope: 'personal',
  classroomId: null,
  moduleKey: 'robotics',
  title,
  status: 'active',
  createdAt: now,
  updatedAt: now,
  preview: null,
  snapshotRevision: null,
  copiedFrom: null,
});
const opening = (): OpenRoboticsProject => ({
  project: metadata(),
  draft: {
    projectId: id,
    document: toRoboticsWebProject(createInitialRoboticsProject()),
    revision: 1,
    updatedAt: now,
  },
  versions: [],
});
type SaveReply = ApiResult<{ draft: ProjectDraft<RoboticsProject>; result: null }>;
function acknowledged(document: RoboticsProject, revision: number): SaveReply {
  return {
    ok: true,
    status: 200,
    data: {
      draft: { projectId: id, document: structuredClone(document), revision, updatedAt: now },
      result: null,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let root: Root | undefined;
let container: HTMLDivElement;
let host: ReturnType<typeof useRoboticsProject>;
const spyOnSaveDraft = () => vi.spyOn(api, 'saveDraft');
let saves: ReturnType<typeof spyOnSaveDraft>;

function mount(opened = opening(), userId = owner, seat = false): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  function Harness() {
    host = useRoboticsProject(opened, userId, seat);
    return createElement('output', null, host.host.saveStatus);
  }
  act(() => root!.render(createElement(Harness)));
}
function unmount(): void {
  if (root) act(() => root!.unmount());
  root = undefined;
  container?.remove();
}
function editCode(source: string): void {
  const circuit = host.host.getCurrentDocument()!;
  host.host.commitDocument({
    ...circuit,
    components: circuit.components.map((component) =>
      component.id === 'uno'
        ? { ...component, stateProperties: { ...component.stateProperties, arduinoSource: source } }
        : component,
    ),
  });
}
function editField(): void {
  const world = host.getCurrentProject().world;
  expect(host.setWorld({ ...world, field: { ...world.field, gridMeters: 0.2 } })).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  saves = spyOnSaveDraft().mockImplementation(async (projectId, document, baseRevision) => ({
    ok: true,
    status: 200,
    data: {
      draft: { projectId, document, revision: baseRevision + 1, updatedAt: now },
      result: null,
    },
  }));
  vi.spyOn(api, 'renameProject').mockImplementation(async (_id, title) => ({
    ok: true,
    status: 200,
    data: { project: metadata(title) },
  }));
});
afterEach(() => {
  unmount();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('account robotics whole-document project host', () => {
  it('accepts a semantically equal JSONB acknowledgement with reordered nested object keys', async () => {
    const reverseKeys = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reverseKeys)
        : value !== null && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, child]) => [key, reverseKeys(child)]),
            )
          : value;
    mount();
    saves.mockImplementationOnce(async (_id, document, revision) =>
      acknowledged(reverseKeys(document) as RoboticsProject, revision + 1),
    );
    await act(async () => {
      editCode('void setup(){} void loop(){delay(29);}');
      editField();
      expect(await host.saveAll()).toBe(true);
    });
    expect(host.getSavedRevision()).toBe(2);
    expect(host.host.saveStatus).toBe('saved');
    const reordered = reverseKeys(host.getCurrentProject()) as RoboticsProject;
    await act(async () => {
      host.host.commitDocument(reordered.circuit);
      expect(await host.saveAll()).toBe(true);
    });
    expect(saves).toHaveBeenCalledTimes(1);
    expect(host.hasUnsavedChanges()).toBe(false);
    expect(readLocalProjectDraft(localStorage, id, 'robotics', owner, 'account')).toBeNull();
  });
  it('does not read or adopt the global standalone project and saves latest code/assembly/field together', async () => {
    localStorage.setItem(
      'asa-lab:robotics:local-project:v1',
      JSON.stringify({ privateOtherUser: 'must not be read' }),
    );
    const read = vi.spyOn(Storage.prototype, 'getItem');
    mount();
    expect(read.mock.calls.some(([key]) => key === 'asa-lab:robotics:local-project:v1')).toBe(
      false,
    );
    expect(host.host.project?.id).toBe(id);
    expect(host.getSavedRevision()).toBe(1);
    await act(async () => {
      editCode('void setup(){} void loop(){delay(37);}');
      editField();
      const world = host.getCurrentProject().world;
      host.setWorld({ ...world, robot: { ...world.robot, bodyLengthMeters: 0.16 } });
      expect(await host.saveAll()).toBe(true);
    });
    expect(saves).toHaveBeenCalledTimes(1);
    expect(saves.mock.calls[0]![1]).toEqual(host.getCurrentProject());
    expect(host.getCurrentProject().world.field.gridMeters).toBe(0.2);
    expect(host.getCurrentProject().world.robot.bodyLengthMeters).toBe(0.16);
    expect(
      host.getCurrentProject().circuit.components[0]!.stateProperties!.arduinoSource,
    ).toContain('delay(37)');
    expect(host.getCurrentProject().circuit.simulation.running).toBe(false);
    expect(host.getSavedRevision()).toBe(2);
    expect(host.host.saveStatus).toBe('saved');
  });

  it('flushes the active program before Save and keeps one Undo history for source', async () => {
    mount();
    let pending = true;
    const release = host.registerProgramFlush(() => {
      if (pending) {
        pending = false;
        editCode('void setup(){} void loop(){delay(41);}');
      }
    });
    await act(async () => {
      expect(await host.saveAll()).toBe(true);
    });
    expect(
      host.getCurrentProject().circuit.components[0]!.stateProperties!.arduinoSource,
    ).toContain('delay(41)');
    act(() => host.host.undo());
    expect(host.getProgramRevision()).toBe(1);
    expect(host.host.saveStatus).toBe('dirty');
    expect(host.getSavedRevision()).toBeNull();
    release();
  });

  it('waits for newer edits after an in-flight acknowledgement without calling them saved early', async () => {
    mount();
    const first = deferred<SaveReply>();
    const second = deferred<SaveReply>();
    saves.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    let saving!: Promise<boolean>;
    act(() => {
      editCode('void setup(){} void loop(){delay(51);}');
      saving = host.saveAll();
    });
    const submitted = structuredClone(host.getCurrentProject());
    act(() => {
      editField();
      editCode('void setup(){} void loop(){delay(52);}');
    });
    const latest = structuredClone(host.getCurrentProject());
    await act(async () => {
      first.resolve(acknowledged(submitted, 2));
      await Promise.resolve();
    });
    expect(host.getCurrentProject()).toEqual(latest);
    expect(host.getSavedRevision()).toBeNull();
    expect(host.host.saveStatus).toBe('saving');
    expect(saves.mock.calls[1]!.slice(0, 3)).toEqual([id, latest, 2]);
    await act(async () => {
      second.resolve(acknowledged(latest, 3));
      expect(await saving).toBe(true);
    });
    expect(host.getSavedRevision()).toBe(3);
    expect(host.host.saveStatus).toBe('saved');
    act(() => host.host.undo());
    expect(host.getCurrentProject().world.field.gridMeters).toBe(0.2);
    expect(
      host.getCurrentProject().circuit.components[0]!.stateProperties!.arduinoSource,
    ).toContain('delay(51)');
  });

  it('retries the exact lost-acknowledgement mutation before sending subsequent edits', async () => {
    mount();
    let accepted!: RoboticsProject;
    saves.mockImplementationOnce(async (_projectId, document) => {
      accepted = structuredClone(document as RoboticsProject);
      return { ok: false, status: 0, error: { code: 'network_error', message: 'Ответ потерян' } };
    });
    await act(async () => {
      editCode('void setup(){} void loop(){delay(61);}');
      expect(await host.saveAll()).toBe(false);
    });
    expect(host.getSavedRevision()).toBeNull();
    expect(host.host.saveStatus).toBe('error');
    act(() => {
      editField();
      editCode('void setup(){} void loop(){delay(62);}');
    });
    saves.mockImplementationOnce(async () => acknowledged(accepted, 2));
    await act(async () => {
      expect(await host.saveAll()).toBe(true);
    });
    const first = saves.mock.calls[0]!;
    const retry = saves.mock.calls[1]!;
    expect(retry.slice(0, 3)).toEqual(first.slice(0, 3));
    expect(projectDraftMutationIdSync(id, retry[2], retry[1])).toBe(
      projectDraftMutationIdSync(id, first[2], first[1]),
    );
    expect(saves.mock.calls.map((call) => call[2])).toEqual([1, 1, 2]);
    expect(
      host.getCurrentProject().circuit.components[0]!.stateProperties!.arduinoSource,
    ).toContain('delay(62)');
    expect(host.getCurrentProject().world.field.gridMeters).toBe(0.2);
    expect(host.getSavedRevision()).toBe(3);
  });

  it('sends the corrected current source after a definite validation rejection', async () => {
    mount();
    saves.mockResolvedValueOnce({
      ok: false,
      status: 400,
      error: { code: 'invalid_document', message: 'Программа не прошла проверку.' },
    });
    await act(async () => {
      editCode('void setup(){} void loop(){delay(63);}');
      expect(await host.saveAll()).toBe(false);
    });
    expect(host.host.saveStatus).toBe('error');
    const rejected = structuredClone(host.getCurrentProject());
    await act(async () => {
      editCode('void setup(){} void loop(){delay(64);}');
      editField();
      expect(await host.saveAll()).toBe(true);
    });
    expect(saves.mock.calls).toHaveLength(2);
    expect(saves.mock.calls.map((call) => call[2])).toEqual([1, 1]);
    expect(saves.mock.calls[1]![1]).toEqual(host.getCurrentProject());
    expect(saves.mock.calls[1]![1]).not.toEqual(rejected);
    expect(host.getSavedRevision()).toBe(2);
    expect(host.host.saveStatus).toBe('saved');
  });

  it('keeps a conflicting whole source and its recovery copy through metadata reads and reopening', async () => {
    const opened = opening();
    mount(opened);
    saves.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: 'revision_conflict', message: 'Изменено в другой вкладке' },
    });
    await act(async () => {
      editField();
      editCode('void setup(){} void loop(){delay(71);}');
      expect(await host.saveAll()).toBe(false);
    });
    const authored = structuredClone(host.getCurrentProject());
    const remote = {
      ...opened,
      project: metadata('Другое серверное имя'),
      draft: { ...opened.draft, revision: 4 },
    };
    vi.spyOn(api, 'openProject').mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...remote, result: null },
    });
    await act(async () => host.refreshMetadata());
    expect(host.getCurrentProject()).toEqual(authored);
    expect(host.host.saveIssue).toBe('conflict');
    expect(host.getSavedRevision()).toBeNull();
    expect(host.host.projectTitle).toBe('Другое серверное имя');
    expect(readLocalProjectDraft(localStorage, id, 'robotics', owner, 'account')?.document).toEqual(
      authored,
    );
    unmount();
    mount(remote);
    expect(host.host.saveIssue).toBe('conflict');
    act(() => editCode('void setup(){} void loop(){delay(72);}'));
    const revised = host.getCurrentProject();
    unmount();
    mount(remote);
    expect(host.getCurrentProject()).toEqual(revised);
    expect(host.host.saveIssue).toBe('conflict');
    await act(async () => {
      expect(await host.saveAll()).toBe(false);
    });
    expect(saves).toHaveBeenCalledTimes(1);
  });

  it('scopes recovery to both principal kind and account, without reading another person’s work', () => {
    const opened = opening();
    const recovered = { ...opened.draft.document, title: 'Только мой черновик' };
    writeLocalProjectDraft(localStorage, {
      projectId: id,
      moduleKey: 'robotics',
      userId: owner,
      identityKind: 'account',
      baseRevision: 1,
      document: recovered,
    });
    mount(opened, other);
    expect(host.getCurrentProject()).toEqual(opened.draft.document);
    unmount();
    mount(opened, owner, true);
    expect(host.getCurrentProject()).toEqual(opened.draft.document);
    act(editField);
    expect(sessionStorage.getItem(localProjectDraftKey(id, owner, 'seat'))).not.toBeNull();
    expect(localStorage.getItem(localProjectDraftKey(id, owner, 'seat'))).toBeNull();
    expect(readLocalProjectDraft(localStorage, id, 'robotics', owner, 'account')?.document).toEqual(
      recovered,
    );
  });

  it('does not let a late Save acknowledgement replace a newly mounted principal', async () => {
    const first = deferred<SaveReply>();
    saves.mockImplementationOnce(() => first.promise);
    mount();
    let oldSave!: Promise<boolean>;
    act(() => {
      editCode('void setup(){} void loop(){delay(81);}');
      oldSave = host.saveAll();
    });
    const oldDocument = structuredClone(host.getCurrentProject());
    unmount();
    const next = opening();
    mount(next, other);
    await act(async () => {
      first.resolve(acknowledged(oldDocument, 2));
      expect(await oldSave).toBe(false);
    });
    expect(host.getCurrentProject()).toEqual(next.draft.document);
    expect(host.getSavedRevision()).toBe(1);
    expect(readLocalProjectDraft(localStorage, id, 'robotics', other, 'account')).toBeNull();
    expect(readLocalProjectDraft(localStorage, id, 'robotics', owner, 'account')?.document).toEqual(
      oldDocument,
    );
  });

  it('renames Project metadata up to 255 characters without rewriting legacy document.title', async () => {
    mount();
    const original = host.getCurrentProject();
    const longTitle = 'Робот '.repeat(40).trim();
    expect(longTitle.length).toBeGreaterThan(80);
    await act(async () => {
      host.host.setProjectTitle(longTitle);
      await host.host.renameProject();
    });
    expect(host.host.project?.title).toBe(longTitle);
    expect(host.host.projectTitle).toBe(longTitle);
    expect(host.getCurrentProject()).toEqual(original);
    expect(saves).not.toHaveBeenCalled();
  });

  it('never substitutes a starter or a late Open response for an inaccessible current project', async () => {
    const first = deferred<Awaited<ReturnType<typeof api.openProject>>>();
    vi.spyOn(api, 'openProject')
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        error: { code: 'not_found', message: 'Проект недоступен' },
      });
    let state!: ReturnType<typeof useOpenRoboticsProject>;
    function Harness({ projectId }: { projectId: string }) {
      state = useOpenRoboticsProject(projectId, owner);
      return createElement('output', null, state.kind);
    }
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(createElement(Harness, { projectId: id })));
    await act(async () => root!.render(createElement(Harness, { projectId: other })));
    expect(state).toEqual({ kind: 'error', message: 'Проект недоступен' });
    await act(async () =>
      first.resolve({ ok: true, status: 200, data: { ...opening(), result: null } }),
    );
    expect(state).toEqual({ kind: 'error', message: 'Проект недоступен' });
    expect(saves).not.toHaveBeenCalled();
  });
});
