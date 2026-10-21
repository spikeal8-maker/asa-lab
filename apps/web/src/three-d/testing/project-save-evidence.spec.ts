// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cloneThreeDDocument,
  createEmptyThreeDDocument,
  createThreeDNode,
  parseThreeDDocument,
} from '@asa-lab/three-d';
import {
  ProjectSaveEvidence,
  useConfirmedProjectRevision,
} from '../../modules/project-save-evidence';
import { useThreeDProject, type ThreeDProjectController } from '../use-three-d-project';
import {
  readLocalThreeDDraft,
  threeDDocumentSignature,
  writeLocalThreeDDraft,
} from '../local-draft';

const requests = vi.hoisted(() => ({
  openProject: vi.fn(),
  saveDraft: vi.fn(),
  createCheckpoint: vi.fn(),
}));
vi.mock('../../api', () => ({ api: requests }));
const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let root: Root;

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.resetAllMocks();
  window.localStorage.clear();
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});

// PostgreSQL JSONB orders keys by length, then bytes. Arrays retain their order.
function jsonbOrder<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const record = item as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
          .map((key) => [key, record[key]]),
      );
    }),
  ) as T;
}

it.each(['open', 'local', 'legacy-local', 'restore'] as const)(
  'does not save unchanged JSONB geometry on %s, but saves a real edit at the loaded revision',
  async (mode) => {
    const original = jsonbOrder({
      ...createEmptyThreeDDocument(),
      nodes: [createThreeDNode('box', 'published-box')],
    });
    const parsed = parseThreeDDocument(original);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.message);
    // Prove the exact pre-repair byte mismatch rather than using an empty scene.
    expect(JSON.stringify(parsed.value)).not.toBe(
      JSON.stringify(cloneThreeDDocument(parsed.value)),
    );
    const projectId = `jsonb-${mode}`;
    if (mode === 'local' || mode === 'legacy-local') {
      writeLocalThreeDDraft(
        window.localStorage,
        projectId,
        cloneThreeDDocument(original),
        mode === 'local' ? threeDDocumentSignature(original) : JSON.stringify(parsed.value),
      );
    }
    requests.openProject.mockResolvedValue({
      ok: true,
      data: {
        draft: { document: original, revision: 3 },
        project: { title: 'Copied project' },
        versions: [],
      },
    });
    requests.saveDraft.mockResolvedValue({ ok: true, data: { draft: { revision: 4 } } });
    let controller!: ThreeDProjectController;
    function Editor() {
      controller = useThreeDProject(projectId);
      return null;
    }
    await act(async () => root.render(createElement(Editor)));
    if (mode === 'restore') {
      await act(async () => {
        expect(controller.acceptRestoredDocument(original, 7)).toBe(true);
        controller.undo();
        controller.redo();
      });
    }
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    expect(requests.saveDraft).not.toHaveBeenCalled();
    expect(controller.saveState).toBe('saved');
    expect(controller.serverRevision).toBe(mode === 'restore' ? 7 : 3);
    expect(readLocalThreeDDraft(window.localStorage, projectId)).toBeNull();
    const edited = {
      ...original,
      nodes: [...original.nodes, createThreeDNode('box', 'new-box')],
    };
    await act(async () => {
      controller.importDocument(edited);
    });
    await act(async () => {
      vi.advanceTimersByTime(650);
    });
    expect(requests.saveDraft).toHaveBeenCalledExactlyOnceWith(
      projectId,
      edited,
      mode === 'restore' ? 7 : 3,
    );
    expect(controller.document).toEqual(edited);
  },
);

it('ignores object key order but preserves node order and geometry in signatures', () => {
  const document = {
    ...createEmptyThreeDDocument(),
    nodes: [createThreeDNode('box', 'a'), createThreeDNode('sphere', 'b')],
  };
  expect(threeDDocumentSignature(jsonbOrder(document))).toBe(threeDDocumentSignature(document));
  expect(threeDDocumentSignature({ ...document, nodes: [...document.nodes].reverse() })).not.toBe(
    threeDDocumentSignature(document),
  );
  const first = document.nodes[0]!;
  const changed = {
    ...document,
    nodes: [
      {
        ...first,
        transform: {
          ...first.transform,
          position: { ...first.transform.position, x: first.transform.position.x + 1 },
        },
      },
      ...document.nodes.slice(1),
    ],
  };
  expect(threeDDocumentSignature(changed)).not.toBe(threeDDocumentSignature(document));
});

it('keeps newer geometry dirty after an older save and queues it with the confirmed revision', async () => {
  const original = jsonbOrder({
    ...createEmptyThreeDDocument(),
    nodes: [createThreeDNode('box', 'original')],
  });
  const firstEdit = { ...original, nodes: [...original.nodes, createThreeDNode('box', 'first')] };
  const latestEdit = {
    ...firstEdit,
    nodes: [...firstEdit.nodes, createThreeDNode('box', 'latest')],
  };
  const olderSave = deferred();
  const newerSave = deferred();
  requests.openProject.mockResolvedValue({
    ok: true,
    data: {
      draft: { document: original, revision: 3 },
      project: { title: 'Copied project' },
      versions: [],
    },
  });
  requests.saveDraft
    .mockImplementationOnce(() => olderSave.promise)
    .mockImplementationOnce(() => newerSave.promise);
  let controller!: ThreeDProjectController;
  function Editor() {
    controller = useThreeDProject('ordered-save');
    return null;
  }
  await act(async () => root.render(createElement(Editor)));
  await act(async () => {
    controller.importDocument(firstEdit);
  });
  await act(async () => {
    vi.advanceTimersByTime(650);
  });
  expect(requests.saveDraft).toHaveBeenLastCalledWith('ordered-save', firstEdit, 3);
  await act(async () => {
    controller.importDocument(latestEdit);
  });
  await act(async () => {
    vi.advanceTimersByTime(650);
  });
  expect(requests.saveDraft).toHaveBeenCalledTimes(1);
  await act(async () => olderSave.resolve({ ok: true, data: { draft: { revision: 4 } } }));
  expect(controller.document).toEqual(latestEdit);
  expect(controller.saveState).toBe('saving');
  expect(requests.saveDraft).toHaveBeenLastCalledWith('ordered-save', latestEdit, 4);
  await act(async () => newerSave.resolve({ ok: true, data: { draft: { revision: 5 } } }));
  expect(controller.document).toEqual(latestEdit);
  expect(controller.saveState).toBe('saved');
  expect(controller.serverRevision).toBe(5);
});

it.each([true, false])(
  'keeps edited 3D evidence unavailable when checkpoint resolves (edit before save response: %s)',
  async (editBeforeSave) => {
    const original = createEmptyThreeDDocument();
    const edited = { ...original, nodes: [createThreeDNode('box', 'edited-box')] };
    const saved = deferred(),
      checkpoint = deferred(),
      autosaved = deferred();
    requests.openProject.mockResolvedValue({
      ok: true,
      data: {
        draft: { document: original, revision: 1 },
        project: { title: 'Synthetic project' },
        versions: [],
      },
    });
    requests.saveDraft
      .mockImplementationOnce(() => saved.promise)
      .mockImplementationOnce(() => autosaved.promise);
    requests.createCheckpoint.mockImplementation(() => checkpoint.promise);
    let controller!: ThreeDProjectController;
    let evidence: number | null = null;
    function Editor() {
      controller = useThreeDProject('save-evidence-test');
      return null;
    }
    function Submission() {
      evidence = useConfirmedProjectRevision();
      return null;
    }
    await act(async () =>
      root.render(
        createElement(ProjectSaveEvidence, {
          children: [
            createElement(Editor, { key: 'editor' }),
            createElement(Submission, { key: 'submission' }),
          ],
        }),
      ),
    );
    expect(evidence).toBe(1);
    let completed!: Promise<void>;
    await act(async () => {
      completed = controller.createCheckpoint();
    });
    if (editBeforeSave) await act(async () => controller.importDocument(edited));
    await act(async () => saved.resolve({ ok: true, data: { draft: { revision: 2 } } }));
    if (!editBeforeSave) await act(async () => controller.importDocument(edited));
    expect(evidence).toBeNull();
    expect(readLocalThreeDDraft(window.localStorage, 'save-evidence-test')?.document).toEqual(
      edited,
    );
    await act(async () => {
      checkpoint.resolve({ ok: true, data: { version: { versionNo: 1 } } });
      await completed;
    });
    expect(controller.document).toEqual(edited);
    expect(controller.saveState).toBe('dirty');
    expect(evidence).toBeNull();
    expect(readLocalThreeDDraft(window.localStorage, 'save-evidence-test')?.document).toEqual(
      edited,
    );
    await act(async () => {
      vi.advanceTimersByTime(650);
    });
    expect(requests.saveDraft).toHaveBeenLastCalledWith('save-evidence-test', edited, 2);
    await act(async () => autosaved.resolve({ ok: true, data: { draft: { revision: 3 } } }));
    expect(controller.saveState).toBe('saved');
    expect(evidence).toBe(3);
    expect(readLocalThreeDDraft(window.localStorage, 'save-evidence-test')).toBeNull();
  },
);
