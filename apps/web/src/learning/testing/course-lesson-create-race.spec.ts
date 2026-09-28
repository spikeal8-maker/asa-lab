// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { api, type Course, type CourseLesson, type CourseSection } from '../../api';
import { CoursesPanel } from '../../components/CoursesPanel';

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
const course: Course = {
  id: 'course-1',
  title: 'Course',
  summary: null,
  visibility: 'private',
  ageBand: null,
  itemCount: 0,
  sectionCount: 1,
  lessonCount: 0,
  assignmentCount: 0,
  sharedWith: 0,
  copiedFromCourseId: null,
  publicationState: 'draft',
  publishedVersion: null,
  publishedAt: null,
  draftRevision: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (entry) => entry.textContent?.trim() === label,
  );
  if (!found) throw new Error(`${label} button is missing`);
  return found;
}

function setInput(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

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

it('creates a second lesson even when a late outline reload selects the first lesson', async () => {
  const lateOutline = deferred<Awaited<ReturnType<typeof api.courseOutline>>>();
  const lessons: CourseLesson[] = [];
  let revision = 1;
  let failNextUpdate = false;
  const outline = (): { sections: CourseSection[]; draftRevision: number } => ({
    sections: [
      {
        id: 'section-1',
        title: 'Section',
        summary: null,
        position: 1,
        hidden: false,
        lessons: [...lessons],
      },
    ],
    draftRevision: revision,
  });
  vi.spyOn(api, 'listCourses').mockImplementation(async () => ({
    ok: true,
    status: 200,
    data: { items: [{ ...course, draftRevision: revision, lessonCount: lessons.length }] },
  }));
  const readOutline = vi
    .spyOn(api, 'courseOutline')
    .mockImplementationOnce(async () => ({ ok: true, status: 200, data: outline() }))
    .mockReturnValueOnce(lateOutline.promise)
    .mockImplementation(async () => ({ ok: true, status: 200, data: outline() }));
  vi.spyOn(api, 'authorVersions').mockResolvedValue({ ok: true, status: 200, data: { items: [] } });
  vi.spyOn(api, 'authoredActivities').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [] },
  });
  const save = vi
    .spyOn(api, 'saveCourseLesson')
    .mockImplementation(async (_courseId, lessonId, input) => {
      if (failNextUpdate && lessonId === 'lesson-2') {
        failNextUpdate = false;
        return { ok: false, status: 503, error: { code: 'unavailable', message: 'Try again' } };
      }
      const id = lessonId ?? `lesson-${lessons.length + 1}`;
      const lesson: CourseLesson = {
        id,
        title: input.title,
        summary: input.summary,
        content: input.content,
        blocks: input.blocks,
        kind: input.kind,
        assignmentId: input.assignmentId,
        learningActivityVersionId: input.learningActivityVersionId ?? null,
        assignmentTitle: null,
        moduleKey: null,
        estimatedMinutes: input.estimatedMinutes,
        position: lessonId ? 1 : lessons.length + 1,
        hidden: false,
      };
      if (lessonId) lessons[lessons.findIndex((entry) => entry.id === lessonId)] = lesson;
      else lessons.push(lesson);
      revision += 1;
      return { ok: true, status: 200, data: { id } };
    });

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(CoursesPanel, { assignments: [], canTeach: true, onChanged: vi.fn() }),
    );
    await flush();
  });
  const openCourse = container.querySelector<HTMLButtonElement>(
    '[data-testid="courses-list"] .course-row-main',
  );
  expect(openCourse).not.toBeNull();
  await act(async () => openCourse?.click());
  expect(readOutline).toHaveBeenCalledTimes(1);
  await act(async () => button(container!, '+ Урок').click());
  const firstTitle = container.querySelector<HTMLInputElement>(
    '.course-lesson-editor input[maxlength="160"]',
  );
  expect(firstTitle).not.toBeNull();
  await act(async () => setInput(firstTitle!, 'First lesson'));
  await act(async () => button(container!, '+ Урок').click());
  expect(container.textContent).toContain('Сначала сохраните изменения урока');
  await act(async () => {
    container
      ?.querySelector('.course-lesson-editor')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]?.[1]).toBeNull();
  expect(readOutline).toHaveBeenCalledTimes(2);

  await act(async () => button(container!, '+ Урок').click());
  expect(container.textContent).toContain('Новый урок');
  const secondTitle = container.querySelector<HTMLInputElement>(
    '.course-lesson-editor input[maxlength="160"]',
  );
  expect(secondTitle).not.toBeNull();
  await act(async () => setInput(secondTitle!, 'Second lesson'));
  await act(async () => {
    container
      ?.querySelector('.course-lesson-editor')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => setInput(secondTitle!, 'Second lesson revised'));
  await act(async () => lateOutline.resolve({ ok: true, status: 200, data: outline() }));
  expect(container.textContent).toContain('Новый урок');

  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]?.[1]).toBeNull();
  expect(save.mock.calls[1]?.[2]).toMatchObject({ title: 'Second lesson', expectedRevision: 2 });
  expect(lessons.map((lesson) => lesson.title)).toEqual(['First lesson', 'Second lesson']);
  expect(secondTitle?.value).toBe('Second lesson revised');
  await act(async () => button(container!, '+ Урок').click());
  expect(container.textContent).toContain('Сначала сохраните изменения урока');
  failNextUpdate = true;
  await act(async () => {
    container
      ?.querySelector('.course-lesson-editor')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
  expect(save).toHaveBeenCalledTimes(3);
  expect(save.mock.calls[2]?.[1]).toBe('lesson-2');
  expect(save.mock.calls[2]?.[2]).toMatchObject({
    title: 'Second lesson revised',
    expectedRevision: 3,
  });
  expect(container.textContent).toContain('Try again');
  await act(async () => {
    container
      ?.querySelector('.course-lesson-editor')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
  expect(save).toHaveBeenCalledTimes(4);
  expect(save.mock.calls[3]?.[1]).toBe('lesson-2');
  expect(save.mock.calls[3]?.[2]).toMatchObject({
    title: 'Second lesson revised',
    expectedRevision: 3,
  });
  expect(lessons.map((lesson) => lesson.title)).toEqual(['First lesson', 'Second lesson revised']);
  expect(container.querySelectorAll('.course-outline-section li')).toHaveLength(2);

  const firstLesson = [
    ...container.querySelectorAll<HTMLButtonElement>('.course-lesson-link'),
  ].find((entry) => entry.textContent?.includes('First lesson'));
  expect(firstLesson).toBeDefined();
  await act(async () => firstLesson?.click());
  const editTitle = container.querySelector<HTMLInputElement>(
    '.course-lesson-editor input[maxlength="160"]',
  );
  expect(editTitle?.value).toBe('First lesson');
  await act(async () => setInput(editTitle!, 'Updated first lesson'));
  await act(async () => {
    container
      ?.querySelector('.course-lesson-editor')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
  expect(save.mock.calls[4]?.[1]).toBe('lesson-1');
  expect(save.mock.calls[4]?.[2]).toMatchObject({
    title: 'Updated first lesson',
    expectedRevision: 4,
  });
  expect(lessons.map((lesson) => lesson.title)).toEqual([
    'Updated first lesson',
    'Second lesson revised',
  ]);
});

it('keeps edits made during a create request and updates that lesson on the next save', async () => {
  const pendingCreate = deferred<Awaited<ReturnType<typeof api.saveCourseLesson>>>();
  const lessons: CourseLesson[] = [];
  let revision = 1;
  const outline = () => ({
    sections: [
      {
        id: 'section-1',
        title: 'Section',
        summary: null,
        position: 1,
        hidden: false,
        lessons: [...lessons],
      },
    ] satisfies CourseSection[],
    draftRevision: revision,
  });
  vi.spyOn(api, 'listCourses').mockImplementation(async () => ({
    ok: true,
    status: 200,
    data: { items: [{ ...course, draftRevision: revision, lessonCount: lessons.length }] },
  }));
  vi.spyOn(api, 'courseOutline').mockImplementation(async () => ({
    ok: true,
    status: 200,
    data: outline(),
  }));
  vi.spyOn(api, 'authorVersions').mockResolvedValue({ ok: true, status: 200, data: { items: [] } });
  vi.spyOn(api, 'authoredActivities').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [] },
  });
  const save = vi
    .spyOn(api, 'saveCourseLesson')
    .mockReturnValueOnce(pendingCreate.promise)
    .mockImplementation(async (_courseId, lessonId, input) => {
      expect(lessonId).toBe('lesson-1');
      lessons[0] = { ...lessons[0]!, title: input.title };
      revision += 2;
      return { ok: true, status: 200, data: { id: lessonId! } };
    });

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(CoursesPanel, { assignments: [], canTeach: true, onChanged: vi.fn() }),
    );
    await flush();
  });
  await act(async () =>
    container
      ?.querySelector<HTMLButtonElement>('[data-testid="courses-list"] .course-row-main')
      ?.click(),
  );
  await act(async () => button(container!, '+ Урок').click());
  const title = container.querySelector<HTMLInputElement>(
    '.course-lesson-editor input[maxlength="160"]',
  );
  expect(title).not.toBeNull();
  await act(async () => setInput(title!, 'First version'));
  await act(async () => {
    container
      ?.querySelector('.course-lesson-editor')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]?.[1]).toBeNull();
  await act(async () => setInput(title!, 'Edited during save'));
  lessons.push({
    id: 'lesson-1',
    title: 'First version',
    summary: null,
    content: null,
    blocks: [{ id: 'intro', type: 'paragraph', text: '' }],
    kind: 'material',
    assignmentId: null,
    learningActivityVersionId: null,
    assignmentTitle: null,
    moduleKey: null,
    estimatedMinutes: null,
    position: 1,
    hidden: false,
  });
  revision = 3;
  await act(async () => {
    pendingCreate.resolve({ ok: true, status: 200, data: { id: 'lesson-1' } });
    await flush();
  });
  expect(title?.value).toBe('Edited during save');
  expect(container.textContent).toContain('Новый урок');
  await act(async () => button(container!, '+ Урок').click());
  expect(container.textContent).toContain('Сначала сохраните изменения урока');

  await act(async () => {
    container
      ?.querySelector('.course-lesson-editor')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]?.[1]).toBe('lesson-1');
  expect(save.mock.calls[1]?.[2]).toMatchObject({
    title: 'Edited during save',
    expectedRevision: 3,
  });
  expect(lessons.map((lesson) => lesson.title)).toEqual(['Edited during save']);
});
