// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEmptyThreeDDocument, createThreeDNode } from '@asa-lab/three-d';
import {
  ProjectSaveEvidence,
  useConfirmedProjectRevision,
} from '../../modules/project-save-evidence';
import { useThreeDProject, type ThreeDProjectController } from '../use-three-d-project';
import { readLocalThreeDDraft } from '../local-draft';

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
