// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type SeatAssignment } from '../../api';
import { SeatAssignments } from '../../components/SeatAssignments';
import { AttendedClassesPage } from '../../pages/AttendedClassesPage';

const assignment: SeatAssignment = {
  id: 'handout-one',
  activityRunId: 'direct-run-one',
  title: 'Circuit work',
  brief: 'Build a circuit',
  goal: null,
  moduleKey: 'electronics',
  dueAt: null,
  status: 'open',
  sampleImage: null,
  projectId: null,
  submittedAt: null,
  snapshotRevision: null,
  updatedAt: null,
  canonicalState: null,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

beforeAll(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

async function renderSurface(source: 'seat' | 'account', item = assignment) {
  vi.spyOn(api, 'seatAssignments').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [item] },
  });
  vi.spyOn(api, 'attendedClasses').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [] },
  });
  vi.spyOn(api, 'attendedAssignments').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [{ ...item, classroomTitle: 'Class 7' }] },
  });
  vi.spyOn(api, 'classroomJoinRequests').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [] },
  });
  const onOpenProject = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      source === 'seat'
        ? createElement(SeatAssignments, { onOpenProject })
        : createElement(AttendedClassesPage, { onOpenProject }),
    );
  });
  return { view: container, onOpenProject };
}

describe('Direct learner Start cutover', () => {
  it.each(['seat', 'account'] as const)(
    '%s uses one atomic exact-Run request and returned Project',
    async (source) => {
      const start = vi.spyOn(api, 'startLearningWork').mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          projectId: 'returned-project',
          participationId: 'participation-one',
          activityRunId: 'direct-run-one',
          attemptId: 'attempt-one',
          attemptNumber: 1,
          state: 'in_progress',
          reused: false,
        },
      });
      const create = vi.spyOn(api, 'createProject');
      const legacy = vi.spyOn(api, 'startSeatAssignment');
      const { view, onOpenProject } = await renderSurface(source);
      const button = view.querySelector<HTMLButtonElement>(
        '.seat-assignment-actions .portal-create-button',
      );
      expect(button?.disabled).toBe(false);
      await act(async () => button?.click());
      expect(start).toHaveBeenCalledOnce();
      expect(start.mock.calls[0]?.[0]).toBe('direct-run-one');
      expect(onOpenProject).toHaveBeenCalledWith('returned-project', 'electronics');
      expect(create).not.toHaveBeenCalled();
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it('retains the request key after a failed Start and never opens an orphan Project', async () => {
    const start = vi.spyOn(api, 'startLearningWork').mockResolvedValue({
      ok: false,
      status: 0,
      error: { code: 'network', message: 'Lost response' },
    });
    const create = vi.spyOn(api, 'createProject');
    const legacy = vi.spyOn(api, 'startSeatAssignment');
    const { view, onOpenProject } = await renderSurface('seat');
    const button = view.querySelector<HTMLButtonElement>(
      '.seat-assignment-actions .portal-create-button',
    );
    await act(async () => button?.click());
    expect(view.textContent).toContain('Lost response');
    expect(onOpenProject).not.toHaveBeenCalled();
    await act(async () => button?.click());
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[0]?.[1]).toBe(start.mock.calls[1]?.[1]);
    expect(create).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each(['seat', 'account'] as const)(
    '%s explains why a new old-work Start is unavailable without an exact Run',
    async (source) => {
      const start = vi.spyOn(api, 'startLearningWork');
      const { view } = await renderSurface(source, { ...assignment, activityRunId: null });
      expect(view.querySelector('.seat-assignment-actions button')).toBeNull();
      expect(view.querySelector('.seat-assignment-actions [role="status"]')?.textContent).toContain(
        'Начать новую работу',
      );
      expect(start).not.toHaveBeenCalled();
    },
  );

  it.each(['seat', 'account'] as const)(
    '%s cannot start even a previously eligible old handout in two requests',
    async (source) => {
      const atomic = vi.spyOn(api, 'startLearningWork');
      const create = vi.spyOn(api, 'createProject');
      const legacy = vi.spyOn(api, 'startSeatAssignment');
      const { view, onOpenProject } = await renderSurface(source, {
        ...assignment,
        activityRunId: null,
        legacyStartAllowed: true,
      });
      expect(view.querySelector('.seat-assignment-actions button')).toBeNull();
      expect(view.querySelector('.seat-assignment-actions [role="status"]')).not.toBeNull();
      expect(create).not.toHaveBeenCalled();
      expect(legacy).not.toHaveBeenCalled();
      expect(atomic).not.toHaveBeenCalled();
      expect(onOpenProject).not.toHaveBeenCalled();
    },
  );

  it.each(['seat', 'account'] as const)(
    '%s never treats a run-bearing or unproven handout as legacy Start',
    async (source) => {
      const create = vi.spyOn(api, 'createProject');
      const { view } = await renderSurface(source, {
        ...assignment,
        activityRunId: null,
        legacyStartAllowed: false,
      });
      expect(view.querySelector('.seat-assignment-actions button')).toBeNull();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each(['seat', 'account'] as const)(
    '%s keeps a proven already-linked old Project resumable',
    async (source) => {
      const create = vi.spyOn(api, 'createProject');
      const legacy = vi.spyOn(api, 'startSeatAssignment');
      const { view, onOpenProject } = await renderSurface(source, {
        ...assignment,
        activityRunId: null,
        projectId: 'historical-project',
        legacySubmitAllowed: true,
      });
      const button = [
        ...view.querySelectorAll<HTMLButtonElement>('.seat-assignment-actions button'),
      ].find((item) => item.textContent === 'Открыть работу');
      expect(button).toBeDefined();
      await act(async () => button?.click());
      expect(onOpenProject).toHaveBeenCalledWith('historical-project', 'electronics');
      expect(create).not.toHaveBeenCalled();
      expect(legacy).not.toHaveBeenCalled();
    },
  );
});
