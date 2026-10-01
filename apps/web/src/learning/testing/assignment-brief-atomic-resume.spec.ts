// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type LearningWorkContext } from '../../api';
import { AssignmentBrief } from '../../components/AssignmentBrief';
import {
  ProjectSaveEvidence,
  useReportProjectSaveEvidence,
} from '../../modules/project-save-evidence';

const context: Extract<LearningWorkContext, { state: 'ready' }> = {
  state: 'ready',
  projectId: 'current-project',
  moduleKey: 'electronics',
  origin: {
    immutable: true,
    participationId: 'participation-one',
    activityRunId: 'exact-run',
    learningActivityVersionId: 'version-one',
    sourceKind: 'direct',
    classroomAssignmentId: 'handout-one',
    courseRunId: null,
    courseLessonId: null,
    courseBlockId: null,
  },
  task: {
    id: 'version-one',
    versionNumber: 1,
    contentDigest: 'digest',
    title: 'Circuit work',
    brief: 'Build',
    goal: null,
    blocks: [],
    sampleImage: null,
    dueAt: null,
    status: 'open',
  },
  workflow: {
    canonicalState: {
      activityRunId: 'exact-run',
      workflowState: 'changes_requested',
      selectedResult: null,
      flags: [],
      learnerMessageCode: null,
    },
    attemptId: 'old-attempt',
    attemptNumber: 1,
    submissionId: 'old-submission',
    submittedProjectVersionId: 'old-version',
    submittedAt: '2026-09-29T12:00:00Z',
    snapshotRevision: 1,
    updatedAt: null,
  },
  allowedActions: {
    edit: false,
    submit: false,
    resumeAfterChangesRequested: true,
    moveToLearningArchive: false,
    restoreFromLearningArchive: false,
    createPersonalCopy: false,
    changeGenericProjectStatus: false,
    publishOriginal: false,
  },
  presentation: {
    learnerCollectionState: 'review',
    classroomTitle: 'Class 7',
    courseTitle: null,
    lessonTitle: null,
  },
};

function SavedRevision() {
  useReportProjectSaveEvidence(1, true);
  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

beforeAll(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});
afterAll(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('AssignmentBrief requested-revision resume', () => {
  it('starts the exact origin Run once and never uses handout work linking', async () => {
    const read = vi.spyOn(api, 'learningWorkContext').mockResolvedValue({
      ok: true,
      status: 200,
      data: context,
    });
    const start = vi.spyOn(api, 'startLearningWork').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        projectId: 'current-project',
        participationId: 'participation-one',
        activityRunId: 'exact-run',
        attemptId: 'new-attempt',
        attemptNumber: 2,
        state: 'in_progress',
        reused: false,
      },
    });
    const legacy = vi.spyOn(api, 'startSeatAssignment');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          ProjectSaveEvidence,
          null,
          createElement(SavedRevision),
          createElement(AssignmentBrief, { projectId: 'current-project' }),
        ),
      );
    });
    await act(async () =>
      container?.querySelector<HTMLButtonElement>('.assignment-brief-anchor')?.click(),
    );
    const resume = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Продолжить',
    );
    expect(resume?.disabled).toBe(false);
    await act(async () => resume?.click());
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0]?.[0]).toBe('exact-run');
    expect(legacy).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(2);
    start.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        projectId: 'different-project',
        participationId: 'participation-one',
        activityRunId: 'exact-run',
        attemptId: 'new-attempt',
        attemptNumber: 2,
        state: 'in_progress',
        reused: false,
      },
    });
    await act(async () => resume?.click());
    expect(read).toHaveBeenCalledTimes(2);
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      'Нельзя подтвердить учебную работу.',
    );
  });

  it('submits the exact immutable Project and never calls the handout submit', async () => {
    const inProgress: typeof context = {
      ...context,
      workflow: {
        ...context.workflow,
        canonicalState: { ...context.workflow.canonicalState, workflowState: 'in_progress' },
      },
      allowedActions: { ...context.allowedActions, edit: true, submit: true },
    };
    vi.spyOn(api, 'learningWorkContext').mockResolvedValue({
      ok: true,
      status: 200,
      data: inProgress,
    });
    const exact = vi.spyOn(api, 'submitLearningProject').mockResolvedValue({
      ok: false,
      status: 503,
      error: { code: 'lost_response', message: 'Retry' },
    });
    const legacy = vi.spyOn(api, 'submitSeatAssignment');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          ProjectSaveEvidence,
          null,
          createElement(SavedRevision),
          createElement(AssignmentBrief, { projectId: 'current-project' }),
        ),
      );
    });
    await act(async () =>
      container?.querySelector<HTMLButtonElement>('.assignment-brief-anchor')?.click(),
    );
    const submit = container?.querySelector<HTMLButtonElement>('.assignment-brief-submit');
    expect(submit?.disabled).toBe(false);
    await act(async () => submit?.click());
    expect(exact).toHaveBeenCalledWith('current-project', {
      clientRequestId: expect.any(String),
      expectedRevision: 1,
    });
    expect(legacy).not.toHaveBeenCalled();
  });

  it('continues only a proven historical Project, then submits its saved rework', async () => {
    vi.spyOn(api, 'learningWorkContext').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ...context,
        origin: { ...context.origin, immutable: false, activityRunId: null, participationId: null },
        allowedActions: { ...context.allowedActions, edit: true, submit: true },
      },
    });
    const exact = vi.spyOn(api, 'startLearningWork');
    const legacy = vi.spyOn(api, 'startSeatAssignment').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        projectId: 'current-project',
        submittedAt: null,
        participationId: null,
        attemptId: null,
        attemptNumber: null,
        state: null,
        reused: true,
      },
    });
    const submit = vi.spyOn(api, 'submitSeatAssignment').mockResolvedValue({
      ok: false,
      status: 503,
      error: { code: 'lost_response', message: 'Retry' },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          ProjectSaveEvidence,
          null,
          createElement(SavedRevision),
          createElement(AssignmentBrief, { projectId: 'current-project' }),
        ),
      );
    });
    await act(async () =>
      container?.querySelector<HTMLButtonElement>('.assignment-brief-anchor')?.click(),
    );
    await act(async () =>
      container?.querySelector<HTMLButtonElement>('.assignment-brief-submit')?.click(),
    );
    expect(legacy).toHaveBeenCalledWith('handout-one', 'current-project');
    expect(exact).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(
      container?.querySelector<HTMLButtonElement>('.assignment-brief-submit')?.textContent,
    ).toBe('Сдать доработку');
    await act(async () =>
      container?.querySelector<HTMLButtonElement>('.assignment-brief-submit')?.click(),
    );
    expect(legacy).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith('handout-one', true, 1, expect.any(String));
    expect(exact).not.toHaveBeenCalled();
  });
});
