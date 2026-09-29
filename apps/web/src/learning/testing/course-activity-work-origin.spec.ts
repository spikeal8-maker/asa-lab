// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type CourseActivityOccurrence, type SeatCourseRun } from '../../api';
import { SeatCourses } from '../../components/SeatCourses';

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let root: Root | null = null;
let container: HTMLDivElement | null = null;

const baseOccurrence: CourseActivityOccurrence = {
  blockId: 'activity-a',
  activityRunId: 'run-a',
  classroomAssignmentId: 'shared-handout',
  learningActivityVersionId: 'version-a',
  title: 'Circuit practice',
  goal: 'Measure the circuit',
  blocks: [],
  moduleKey: 'electronics',
  sampleImage: null,
  projectId: null,
  submittedAt: null,
  snapshotRevision: null,
  updatedAt: null,
  canonicalState: null,
  workOriginAmbiguous: true,
};

function course(occurrences: CourseActivityOccurrence[]): SeatCourseRun {
  return {
    id: 'course-run',
    courseId: 'course',
    courseVersionId: 'course-version',
    versionNumber: 1,
    classroomTitle: 'Class',
    title: 'Circuit course',
    summary: null,
    dueAt: null,
    status: 'open',
    sections: [
      {
        id: 'section',
        title: 'Section',
        summary: null,
        position: 1,
        lessons: [
          {
            id: 'lesson',
            sourceLessonId: 'source-lesson',
            title: 'Practice lesson',
            summary: null,
            content: null,
            blocks: occurrences.map((occurrence) => ({
              id: occurrence.blockId,
              type: 'activity',
              learningActivityVersionId: occurrence.learningActivityVersionId,
            })),
            kind: 'material',
            estimatedMinutes: null,
            position: 1,
            classroomAssignmentId: null,
            assignmentTitle: null,
            assignmentGoal: null,
            assignmentBrief: null,
            moduleKey: null,
            sampleImage: null,
            activityOccurrences: occurrences,
            projectId: null,
            submittedAt: null,
            snapshotRevision: null,
            updatedAt: null,
            completedAt: null,
            canonicalState: null,
            canonicalCounts: null,
          },
        ],
      },
    ],
  };
}

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

async function renderCourse(
  source: 'seat' | 'account',
  occurrence: CourseActivityOccurrence | CourseActivityOccurrence[],
  onOpenProject = vi.fn(),
) {
  const read = source === 'seat' ? 'seatCourseRuns' : 'accountCourseRuns';
  vi.spyOn(api, read).mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [course(Array.isArray(occurrence) ? occurrence : [occurrence])] },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(SeatCourses, { source, onOpenProject }));
    await Promise.resolve();
  });
  const openCourse = [...container.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Circuit course'),
  );
  await act(async () => openCourse?.click());
  return container;
}

describe('Course Activity work origin', () => {
  it.each(['seat', 'account'] as const)(
    '%s starts a shared handout only through the exact Course occurrence Run',
    async (source) => {
      const start = vi.spyOn(api, 'startLearningWork').mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          projectId: 'new-project',
          participationId: 'new-participation',
          activityRunId: 'run-a',
          attemptId: 'new-attempt',
          attemptNumber: 1,
          state: 'in_progress',
          reused: false,
        },
      });
      const create = vi.spyOn(api, 'createProject');
      const legacy = vi.spyOn(api, 'startSeatAssignment');
      const view = await renderCourse(source, baseOccurrence);
      const activity = view.querySelector('[data-testid="course-activity-runtime"]');
      expect(activity?.textContent).toContain('Measure the circuit');
      expect(activity?.textContent).toContain('по её точному запуску');
      expect([...activity!.querySelectorAll('button')].map((button) => button.textContent)).toEqual(
        ['Начать'],
      );
      await act(async () => activity?.querySelector('button')?.click());
      expect(start).toHaveBeenCalledOnce();
      expect(start.mock.calls[0]?.[0]).toBe('run-a');
      expect(create).not.toHaveBeenCalled();
      expect(legacy).not.toHaveBeenCalled();
      expect(activity?.textContent).not.toContain('В работе');
      expect(activity?.textContent).not.toContain('Сдать');
    },
  );

  it('keeps a uniquely bound Course Activity work action and a not-started action', async () => {
    const started = await renderCourse('seat', {
      ...baseOccurrence,
      workOriginAmbiguous: false,
      projectId: 'exact-project',
    });
    let activity = started.querySelector('[data-testid="course-activity-runtime"]');
    expect(activity?.textContent).toContain('В работе');
    expect([...activity!.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Открыть работу',
      'Сдать',
    ]);
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    const unstarted = await renderCourse('seat', {
      ...baseOccurrence,
      workOriginAmbiguous: false,
    });
    activity = unstarted.querySelector('[data-testid="course-activity-runtime"]');
    expect(activity?.textContent).toContain('Не начато');
    expect([...activity!.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Начать',
    ]);
  });

  it('starts sibling blocks on their separate Runs and does not navigate after a failed Start', async () => {
    const sibling = {
      ...baseOccurrence,
      blockId: 'activity-b',
      activityRunId: 'run-b',
    };
    const start = vi
      .spyOn(api, 'startLearningWork')
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        error: { code: 'start_unavailable', message: 'Start unavailable' },
      })
      .mockImplementation(async (activityRunId) => ({
        ok: true,
        status: 200,
        data: {
          projectId: `project-${activityRunId}`,
          participationId: `participation-${activityRunId}`,
          activityRunId,
          attemptId: `attempt-${activityRunId}`,
          attemptNumber: 1,
          state: 'in_progress',
          reused: false,
        },
      }));
    const onOpenProject = vi.fn();
    const view = await renderCourse('seat', [baseOccurrence, sibling], onOpenProject);
    const activityButton = (index: number) => {
      const activities = view.querySelectorAll('[data-testid="course-activity-runtime"]');
      return activities[index]?.querySelector('button');
    };
    expect(view.querySelectorAll('[data-testid="course-activity-runtime"]')).toHaveLength(2);
    await act(async () => activityButton(0)?.click());
    expect(onOpenProject).not.toHaveBeenCalled();
    expect(view.textContent).toContain('Start unavailable');
    await act(async () => view.querySelector('button')?.click());
    await act(async () => activityButton(0)?.click());
    await act(async () => activityButton(1)?.click());
    expect(start.mock.calls.map((call) => call[0])).toEqual(['run-a', 'run-a', 'run-b']);
    expect(start.mock.calls[0]?.[1]).toBe(start.mock.calls[1]?.[1]);
    expect(start.mock.calls[2]?.[1]).not.toBe(start.mock.calls[1]?.[1]);
    expect(onOpenProject.mock.calls).toEqual([
      ['project-run-a', 'electronics'],
      ['project-run-b', 'electronics'],
    ]);
  });
});
