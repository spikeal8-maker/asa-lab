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

function course(occurrence: CourseActivityOccurrence): SeatCourseRun {
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
            blocks: [
              { id: 'activity-a', type: 'activity', learningActivityVersionId: 'version-a' },
            ],
            kind: 'material',
            estimatedMinutes: null,
            position: 1,
            classroomAssignmentId: null,
            assignmentTitle: null,
            assignmentGoal: null,
            assignmentBrief: null,
            moduleKey: null,
            sampleImage: null,
            activityOccurrences: [occurrence],
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

async function renderCourse(source: 'seat' | 'account', occurrence: CourseActivityOccurrence) {
  const read = source === 'seat' ? 'seatCourseRuns' : 'accountCourseRuns';
  vi.spyOn(api, read).mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [course(occurrence)] },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(SeatCourses, { source, onOpenProject: vi.fn() }));
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
    '%s shows pinned content but no work actions for a shared legacy handout',
    async (source) => {
      const view = await renderCourse(source, baseOccurrence);
      const activity = view.querySelector('[data-testid="course-activity-runtime"]');
      expect(activity?.textContent).toContain('Measure the circuit');
      expect(activity?.textContent).toContain('Работа пока недоступна');
      expect(activity?.textContent).toContain('после привязки работы');
      expect(activity?.querySelectorAll('button')).toHaveLength(0);
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
});
