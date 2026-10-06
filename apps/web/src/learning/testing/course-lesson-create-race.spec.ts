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

function setSelect(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function testLesson(title: string, position = 1): CourseLesson {
  return {
    id: 'lesson-1',
    title,
    summary: null,
    content: null,
    blocks: [{ id: 'intro', type: 'paragraph', text: '' }],
    kind: 'material',
    assignmentId: null,
    learningActivityVersionId: null,
    assignmentTitle: null,
    moduleKey: null,
    estimatedMinutes: null,
    position,
    hidden: false,
  };
}

function testSection(id: string, lessons: CourseLesson[]): CourseSection {
  return {
    id,
    title: id,
    summary: null,
    position: id === 'section-1' ? 1 : 2,
    hidden: false,
    lessons,
  };
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
      return { ok: true, status: 200, data: { id, draftRevision: revision } };
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
      return { ok: true, status: 200, data: { id: lessonId!, draftRevision: revision } };
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
    pendingCreate.resolve({ ok: true, status: 200, data: { id: 'lesson-1', draftRevision: 3 } });
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

it('retains post-submit edits when the acknowledged PATCH moves an existing lesson', async () => {
  const pendingPatch = deferred<Awaited<ReturnType<typeof api.saveCourseLesson>>>();
  let revision = 1;
  let savedLesson = testLesson('Original');
  let moved = false;
  const outline = () => ({
    sections: [
      testSection('section-1', moved ? [] : [savedLesson]),
      testSection('section-2', moved ? [savedLesson] : []),
    ],
    draftRevision: revision,
  });
  vi.spyOn(api, 'listCourses').mockImplementation(async () => ({
    ok: true,
    status: 200,
    data: { items: [{ ...course, draftRevision: revision, sectionCount: 2, lessonCount: 1 }] },
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
    .mockReturnValueOnce(pendingPatch.promise)
    .mockImplementation(async (_courseId, lessonId, input) => {
      expect(lessonId).toBe('lesson-1');
      expect(input.expectedRevision).toBe(3);
      savedLesson = { ...savedLesson, title: input.title };
      revision = 5;
      return { ok: true, status: 200, data: { id: 'lesson-1', draftRevision: 5 } };
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
  const title = container.querySelector<HTMLInputElement>(
    '.course-lesson-editor input[maxlength="160"]',
  );
  const section = container.querySelector<HTMLSelectElement>('.course-lesson-editor select');
  expect(title?.value).toBe('Original');
  expect(section).not.toBeNull();
  await act(async () => {
    setInput(title!, 'Submitted title');
    section!.value = 'section-2';
    section!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {
    container
      ?.querySelector('.course-lesson-editor')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]?.[2]).toMatchObject({
    title: 'Submitted title',
    sectionId: 'section-2',
    expectedRevision: 1,
  });
  await act(async () => setInput(title!, 'Typed after submit'));
  savedLesson = testLesson('Submitted title', 2);
  moved = true;
  revision = 3;
  await act(async () => {
    pendingPatch.resolve({ ok: true, status: 200, data: { id: 'lesson-1', draftRevision: 3 } });
    await flush();
  });
  expect(
    container.querySelector<HTMLInputElement>('.course-lesson-editor input[maxlength="160"]'),
  ).toBe(title);
  expect(title?.value).toBe('Typed after submit');
  await act(async () => {
    container
      ?.querySelector('.course-lesson-editor')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]?.[2]).toMatchObject({
    title: 'Typed after submit',
    sectionId: 'section-2',
    expectedRevision: 3,
  });
  expect(savedLesson.title).toBe('Typed after submit');
});

it.each([
  { field: 'summary', mode: 'new' },
  { field: 'minutes', mode: 'new' },
  { field: 'section', mode: 'edit' },
  { field: 'kind', mode: 'edit' },
  { field: 'assignment', mode: 'edit' },
] as const)('keeps a $field edit made during a $mode lesson save', async ({ field, mode }) => {
  const pendingSave = deferred<Awaited<ReturnType<typeof api.saveCourseLesson>>>();
  let revision = 1;
  let savedLesson: CourseLesson | null = mode === 'edit' ? testLesson('Original') : null;
  if (savedLesson && (field === 'kind' || field === 'assignment')) {
    savedLesson = {
      ...savedLesson,
      kind: 'assignment',
      learningActivityVersionId: 'version-1',
    };
  }
  const outline = () => ({
    sections: [
      testSection('section-1', savedLesson ? [savedLesson] : []),
      testSection('section-2', []),
    ],
    draftRevision: revision,
  });
  vi.spyOn(api, 'listCourses').mockImplementation(async () => ({
    ok: true,
    status: 200,
    data: { items: [{ ...course, draftRevision: revision, lessonCount: savedLesson ? 1 : 0 }] },
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
    data: {
      items: [
        {
          id: 'activity-1',
          title: 'Practice one',
          kind: 'project',
          draftRevision: 1,
          currentPublishedVersionId: 'version-1',
        },
        {
          id: 'activity-2',
          title: 'Practice two',
          kind: 'project',
          draftRevision: 1,
          currentPublishedVersionId: 'version-2',
        },
      ],
    },
  });
  vi.spyOn(api, 'listModules').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          moduleKey: 'electronics',
          creatable: true,
          learningCapabilities: { assignable: true },
        } as never,
      ],
    },
  });
  vi.spyOn(api, 'previewAuthoredActivityVersion').mockImplementation(async (_id, versionId) => ({
    ok: true,
    status: 200,
    data: {
      source: {
        kind: 'published',
        id: versionId,
        draftRevision: null,
        versionNumber: 1,
        contentDigest: 'digest',
      },
      assignment: { title: 'Practice two', goal: null, blocks: [], brief: null, sampleImage: null },
      moduleKey: 'electronics',
      resultMode: 'completion',
      maxPoints: null,
      policies: {},
      learnerRuntime: false,
    },
  }));
  const save = vi
    .spyOn(api, 'saveCourseLesson')
    .mockReturnValueOnce(pendingSave.promise)
    .mockImplementation(async (_courseId, lessonId, input) => {
      expect(lessonId).toBe('lesson-1');
      expect(input.expectedRevision).toBe(2);
      revision = 3;
      return { ok: true, status: 200, data: { id: 'lesson-1', draftRevision: revision } };
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
  if (mode === 'new') {
    await act(async () => button(container!, '+ Урок').click());
    const title = container.querySelector<HTMLInputElement>(
      '.course-lesson-editor input[maxlength="160"]',
    );
    await act(async () => setInput(title!, 'Original'));
  }
  const editor = container.querySelector<HTMLFormElement>('.course-lesson-editor');
  expect(editor).not.toBeNull();
  await act(async () => {
    editor?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]?.[1]).toBe(mode === 'new' ? null : 'lesson-1');

  if (field === 'assignment')
    await act(async () => {
      button(editor!, 'Заменить практику').click();
      await flush();
    });
  await act(async () => {
    if (field === 'summary') {
      setInput(editor!.querySelector<HTMLInputElement>('input[maxlength="600"]')!, 'Late summary');
    } else if (field === 'minutes') {
      setInput(editor!.querySelector<HTMLInputElement>('input[type="number"]')!, '45');
    } else if (field === 'section') {
      setSelect(editor!.querySelectorAll<HTMLSelectElement>('select')[0]!, 'section-2');
    } else if (field === 'kind') {
      setSelect(editor!.querySelectorAll<HTMLSelectElement>('select')[1]!, 'material');
    } else {
      editor!
        .querySelector<HTMLButtonElement>('[aria-label="Добавить практику «Practice two»"]')!
        .click();
      await flush();
    }
  });
  if (mode === 'new') {
    savedLesson = testLesson('Original');
  } else {
    savedLesson = { ...savedLesson!, position: 2 };
  }
  revision = 2;
  await act(async () => {
    pendingSave.resolve({ ok: true, status: 200, data: { id: 'lesson-1', draftRevision: 2 } });
    await flush();
  });
  expect(container.querySelector('.course-lesson-editor')).toBe(editor);
  if (mode === 'new') expect(container.textContent).toContain('Новый урок');
  expect(container.textContent).toContain('Последние изменения ещё не сохранены');
  await act(async () => {
    editor?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]?.[1]).toBe('lesson-1');
  const savedInput = save.mock.calls[1]?.[2];
  expect(savedInput?.expectedRevision).toBe(2);
  if (field === 'summary') expect(savedInput?.summary).toBe('Late summary');
  if (field === 'minutes') expect(savedInput?.estimatedMinutes).toBe(45);
  if (field === 'section') expect(savedInput?.sectionId).toBe('section-2');
  if (field === 'kind') expect(savedInput?.kind).toBe('material');
  if (field === 'assignment') expect(savedInput?.learningActivityVersionId).toBe('version-2');
});

it('does not adopt a concurrent revision while preserving edits made after save', async () => {
  const pendingOutline = deferred<Awaited<ReturnType<typeof api.courseOutline>>>();
  let revision = 1;
  let savedLesson = testLesson('Original');
  const outline = () => ({
    sections: [testSection('section-1', [savedLesson])],
    draftRevision: revision,
  });
  vi.spyOn(api, 'listCourses').mockImplementation(async () => ({
    ok: true,
    status: 200,
    data: { items: [{ ...course, draftRevision: revision, lessonCount: 1 }] },
  }));
  vi.spyOn(api, 'courseOutline')
    .mockImplementationOnce(async () => ({ ok: true, status: 200, data: outline() }))
    .mockReturnValueOnce(pendingOutline.promise)
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
      expect(lessonId).toBe('lesson-1');
      if (input.expectedRevision !== revision) {
        return {
          ok: false,
          status: 409,
          error: { code: 'draft_conflict', message: 'Remote conflict' },
        };
      }
      savedLesson = { ...savedLesson, title: input.title };
      revision = 2;
      return { ok: true, status: 200, data: { id: 'lesson-1', draftRevision: 2 } };
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
  const title = container.querySelector<HTMLInputElement>(
    '.course-lesson-editor input[maxlength="160"]',
  );
  expect(title?.value).toBe('Original');
  await act(async () => setInput(title!, 'Saved by me'));
  await act(async () => {
    container
      ?.querySelector('.course-lesson-editor')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => setInput(title!, 'My unsaved follow-up'));
  savedLesson = testLesson('Changed remotely');
  revision = 3;
  await act(async () => {
    pendingOutline.resolve({ ok: true, status: 200, data: outline() });
    await flush();
  });
  expect(title?.value).toBe('My unsaved follow-up');
  expect(container.textContent).toContain('Курс изменён в другом окне');
  await act(async () => {
    container
      ?.querySelector('.course-lesson-editor')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]?.[2]).toMatchObject({
    title: 'My unsaved follow-up',
    expectedRevision: 2,
  });
  expect(savedLesson.title).toBe('Changed remotely');
  expect(container.textContent).toContain('Remote conflict');
});

it.each(['newer revision', 'failed request'] as const)(
  'ignores a %s from an outline request started before a lesson edit',
  async (staleResponse) => {
    const oldOutline = deferred<Awaited<ReturnType<typeof api.courseOutline>>>();
    let revision = 1;
    let savedLesson = testLesson('Original');
    const outline = () => ({
      sections: [testSection('section-1', [savedLesson])],
      draftRevision: revision,
    });
    vi.spyOn(api, 'listCourses').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [{ ...course, lessonCount: 1 }] },
    });
    const readOutline = vi
      .spyOn(api, 'courseOutline')
      .mockImplementationOnce(async () => ({ ok: true, status: 200, data: outline() }))
      .mockReturnValueOnce(oldOutline.promise)
      .mockImplementation(async () => ({ ok: true, status: 200, data: outline() }));
    vi.spyOn(api, 'authorVersions').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    vi.spyOn(api, 'authoredActivities').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    vi.spyOn(api, 'publishCourse').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        versionId: 'version-1',
        versionNumber: 1,
        publishedAt: '2026-01-01T00:00:00.000Z',
        reused: false,
      },
    });
    const save = vi
      .spyOn(api, 'saveCourseLesson')
      .mockImplementation(async (_, lessonId, input) => {
        expect(lessonId).toBe('lesson-1');
        if (input.expectedRevision !== revision) {
          return {
            ok: false,
            status: 409,
            error: { code: 'draft_conflict', message: 'Remote conflict' },
          };
        }
        savedLesson = { ...savedLesson, title: input.title };
        revision = 2;
        return { ok: true, status: 200, data: { id: 'lesson-1', draftRevision: 2 } };
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
    await act(async () => {
      button(container!, 'Опубликовать').click();
      await flush();
    });
    expect(readOutline).toHaveBeenCalledTimes(2);
    const title = container.querySelector<HTMLInputElement>(
      '.course-lesson-editor input[maxlength="160"]',
    );
    expect(title?.value).toBe('Original');
    await act(async () => setInput(title!, 'Saved by me'));
    await act(async () => {
      container
        ?.querySelector('.course-lesson-editor')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(save.mock.calls[0]?.[2].expectedRevision).toBe(1);
    expect(readOutline).toHaveBeenCalledTimes(3);
    revision = 3;
    savedLesson = testLesson('Changed remotely');
    await act(async () => {
      oldOutline.resolve(
        staleResponse === 'failed request'
          ? {
              ok: false,
              status: 503,
              error: { code: 'unavailable', message: 'Stale outline failure' },
            }
          : { ok: true, status: 200, data: outline() },
      );
      await flush();
    });
    expect(container.textContent).not.toContain('Stale outline failure');
    expect(container.textContent).toContain('Урок сохранён.');
    await act(async () => setInput(title!, 'My follow-up edit'));
    await act(async () => {
      container
        ?.querySelector('.course-lesson-editor')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(save.mock.calls[1]?.[2]).toMatchObject({
      title: 'My follow-up edit',
      expectedRevision: 2,
    });
    expect(savedLesson.title).toBe('Changed remotely');
    expect(container.textContent).toContain('Remote conflict');
  },
);

it.each(['failed', 'stale'] as const)(
  'unblocks structure changes and publication after a %s saved lesson outline refresh',
  async (refreshResult) => {
    let revision = 1;
    let savedLesson = testLesson('Original');
    const sections = [testSection('section-1', [savedLesson])];
    const outline = () => ({ sections: [...sections], draftRevision: revision });
    vi.spyOn(api, 'listCourses').mockImplementation(async () => ({
      ok: true,
      status: 200,
      data: { items: [{ ...course, draftRevision: revision, lessonCount: 1 }] },
    }));
    vi.spyOn(api, 'courseOutline')
      .mockImplementationOnce(async () => ({ ok: true, status: 200, data: outline() }))
      .mockResolvedValueOnce(
        refreshResult === 'failed'
          ? {
              ok: false,
              status: 503,
              error: { code: 'unavailable', message: 'Outline temporarily unavailable' },
            }
          : { ok: true, status: 200, data: { sections: [...sections], draftRevision: 1 } },
      )
      .mockImplementation(async () => ({ ok: true, status: 200, data: outline() }));
    vi.spyOn(api, 'authorVersions').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    vi.spyOn(api, 'authoredActivities').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    vi.spyOn(api, 'saveCourseLesson').mockImplementation(async (_courseId, lessonId, input) => {
      expect(lessonId).toBe('lesson-1');
      expect(input.expectedRevision).toBe(1);
      savedLesson = { ...savedLesson, title: input.title };
      sections[0] = testSection('section-1', [savedLesson]);
      revision = 2;
      return { ok: true, status: 200, data: { id: 'lesson-1', draftRevision: revision } };
    });
    const saveSection = vi
      .spyOn(api, 'saveCourseSection')
      .mockImplementation(async (_, id, input) => {
        expect(id).toBeNull();
        expect(input.expectedRevision).toBe(2);
        sections.push(testSection('section-2', []));
        revision = 3;
        return { ok: true, status: 200, data: { id: 'section-2' } };
      });
    const publish = vi.spyOn(api, 'publishCourse').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        versionId: 'version-1',
        versionNumber: 1,
        publishedAt: '2026-01-01T00:00:00.000Z',
        reused: false,
      },
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
    const title = container.querySelector<HTMLInputElement>(
      '.course-lesson-editor input[maxlength="160"]',
    );
    expect(title?.value).toBe('Original');
    await act(async () => setInput(title!, 'Saved lesson'));
    await act(async () => {
      container
        ?.querySelector('.course-lesson-editor')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
    });
    if (refreshResult === 'failed') {
      expect(container.textContent).toContain('Outline temporarily unavailable');
    }
    expect(title?.value).toBe('Saved lesson');

    await act(async () =>
      container?.querySelector<HTMLButtonElement>('button[aria-label="Добавить раздел"]')?.click(),
    );
    const sectionTitle = container.querySelector<HTMLInputElement>('.course-form-dialog input');
    await act(async () => setInput(sectionTitle!, 'Second section'));
    await act(async () => {
      container
        ?.querySelector('.course-form-dialog')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(saveSection).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('.course-outline-section')).toHaveLength(2);
    expect(container.textContent).not.toContain('Дождитесь обновления содержания курса');

    await act(async () => {
      button(container!, 'Опубликовать').click();
      await flush();
    });
    expect(publish).toHaveBeenCalledWith('course-1', 3, 'course-publish:course-1:3');
  },
);

it('protects dirty course lessons through the registered portal guard and beforeunload', async () => {
  vi.spyOn(api, 'listCourses').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [course] },
  });
  vi.spyOn(api, 'courseOutline').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      sections: [testSection('section-1', [testLesson('Saved lesson')])],
      draftRevision: 1,
    },
  });
  vi.spyOn(api, 'authorVersions').mockResolvedValue({ ok: true, status: 200, data: { items: [] } });
  let guard: (() => boolean) | null = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(CoursesPanel, {
        assignments: [],
        canTeach: true,
        onChanged: vi.fn(),
        onRegisterLeaveGuard: (value) => {
          guard = value;
        },
      }),
    );
    await flush();
  });
  await act(async () => container!.querySelector<HTMLButtonElement>('.course-row-main')!.click());
  expect(guard!()).toBe(true);
  await act(async () =>
    setInput(
      container!.querySelector<HTMLInputElement>('.course-lesson-editor input[maxlength="160"]')!,
      'Unsaved lesson',
    ),
  );
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  expect(guard!()).toBe(false);
  expect(confirm).toHaveBeenCalledTimes(1);
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  expect(
    container!.querySelector<HTMLInputElement>('.course-lesson-editor input[maxlength="160"]')!
      .value,
  ).toBe('Unsaved lesson');
});

it('keeps the frozen ambiguous assignment when internal Course Back is declined and retries it unchanged', async () => {
  vi.spyOn(api, 'listCourses').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [{ ...course, publicationState: 'published', publishedVersion: 1 }] },
  });
  vi.spyOn(api, 'courseOutline').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      sections: [testSection('section-1', [testLesson('Saved lesson')])],
      draftRevision: 1,
    },
  });
  vi.spyOn(api, 'authorVersions').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          id: 'version-1',
          versionNumber: 1,
          outline: { course: { title: 'Course', summary: null }, sections: [] },
        },
      ],
    },
  });
  vi.spyOn(api, 'listClassrooms').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [{ id: 'class-1', title: 'First class', archivedAt: null } as never],
      meta: { total: 1 },
    },
  });
  const response = deferred<Awaited<ReturnType<typeof api.assignCourseToClassroom>>>();
  const assign = vi
    .spyOn(api, 'assignCourseToClassroom')
    .mockReturnValueOnce(response.promise)
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { runId: 'run', versionNumber: 1, reused: true },
    });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  let guard: (() => boolean) | null = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(CoursesPanel, {
        assignments: [],
        canTeach: true,
        onChanged: vi.fn(),
        onRegisterLeaveGuard: (value) => {
          guard = value;
        },
      }),
    );
    await flush();
  });
  await act(async () => container!.querySelector<HTMLButtonElement>('.course-row-main')!.click());
  await act(async () => {
    button(container!, 'Назначить курс').click();
    await flush();
  });
  await act(async () =>
    setSelect(
      container!.querySelector<HTMLSelectElement>('[aria-label="Класс для курса"]')!,
      'class-1',
    ),
  );
  await act(async () =>
    setInput(container!.querySelector<HTMLInputElement>('input[type="date"]')!, '2027-09-30'),
  );
  await act(async () => {
    button(container!, 'Назначить').click();
  });
  expect(guard!()).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
  expect(button(container!, 'Закрыть назначение').disabled).toBe(true);
  await act(async () =>
    container!.querySelector<HTMLButtonElement>('.course-back-button')!.click(),
  );
  expect(container!.querySelector('[data-testid="course-editor"]')).not.toBeNull();
  const frozen = structuredClone(assign.mock.calls[0]);
  await act(async () => {
    response.resolve({
      ok: false,
      status: 0,
      error: { code: 'network_error', message: 'Lost response' },
    });
    await flush();
  });
  expect(container!.textContent).toContain('Lost response');
  await act(async () => button(container!, 'Закрыть назначение').click());
  await act(async () =>
    container!.querySelector<HTMLButtonElement>('.course-back-button')!.click(),
  );
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Назначение курса не подтверждено'));
  expect(container!.querySelector('[data-testid="course-editor"]')).not.toBeNull();
  expect(container!.querySelector('[data-testid="courses-list"]')).toBeNull();
  await act(async () => {
    button(container!, 'Назначить курс').click();
    await flush();
  });
  expect(container!.querySelector<HTMLSelectElement>('[aria-label="Класс для курса"]')!.value).toBe(
    'class-1',
  );
  expect(container!.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe(
    '2027-09-30',
  );
  await act(async () => {
    button(container!, 'Повторить назначение').click();
    await flush();
  });
  expect(assign.mock.calls[1]).toEqual(frozen);
  expect(container!.textContent).toContain('Сервер подтвердил версию 1');
  await act(async () => button(container!, 'Закрыть назначение').click());
  await act(async () =>
    container!.querySelector<HTMLButtonElement>('.course-back-button')!.click(),
  );
  expect(container!.querySelector('[data-testid="courses-list"]')).not.toBeNull();
  expect(confirm).toHaveBeenCalledTimes(1);
});
