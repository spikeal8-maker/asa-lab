// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  api,
  type ApiResult,
  type Course,
  type CourseLesson,
  type CourseSection,
  type PublishedAuthorVersion,
} from '../../api';
import { CoursesPanel } from '../../components/CoursesPanel';
import { installCourseEditorTestDom } from '../../components/course-editor-test-dom';

type Outline = { sections: CourseSection[]; draftRevision: number };
const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let root: Root | null = null;
let container: HTMLDivElement;
let restoreBrowserApis: () => void;

beforeAll(() => {
  restoreBrowserApis = installCourseEditorTestDom();
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  restoreBrowserApis();
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function button(text: string, where: Element = container): HTMLButtonElement {
  const result = [...where.querySelectorAll<HTMLButtonElement>('button')].find(
    (entry) => entry.textContent?.trim() === text,
  );
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}

function titleInput(): HTMLTextAreaElement {
  const result = container.querySelector<HTMLTextAreaElement>(
    '.course-lesson-editor textarea[aria-label="Название урока"]',
  );
  if (!result) throw new Error('The lesson form was lost during publication refresh');
  return result;
}

async function typeTitle(value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      titleInput(),
      value,
    );
    titleInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function selectHistoricalVersion(): Promise<void> {
  await act(async () => button('История версий').click());
  await act(async () => {
    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="author-version-history"] select[aria-label="Опубликованная версия"]',
    )!;
    select.value = 'version-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function submitLesson(): Promise<void> {
  await act(async () => {
    container
      .querySelector('.course-lesson-editor')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function setup() {
  let revision = 10;
  let published = false;
  let lesson: CourseLesson = {
    id: 'lesson-1',
    title: 'Lesson V3',
    summary: 'Saved description V3',
    content: null,
    blocks: [{ id: 'text-1', type: 'paragraph', text: 'Saved content V3' }],
    kind: 'material',
    assignmentId: null,
    learningActivityVersionId: null,
    assignmentTitle: null,
    moduleKey: null,
    estimatedMinutes: null,
    position: 1,
    hidden: false,
  };
  const sections = (): CourseSection[] => [
    {
      id: 'section-1',
      title: 'Section',
      summary: null,
      position: 1,
      hidden: false,
      lessons: [structuredClone(lesson)],
    },
  ];
  const course: Course = {
    id: 'course-1',
    title: 'Historical course',
    summary: null,
    visibility: 'private',
    ageBand: null,
    itemCount: 1,
    sectionCount: 1,
    lessonCount: 1,
    assignmentCount: 0,
    sharedWith: 0,
    copiedFromCourseId: null,
    publicationState: 'changed',
    publishedVersion: 2,
    publishedAt: '2026-11-18T00:00:00.000Z',
    draftRevision: 10,
    draftActive: true,
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    archivedAt: null,
  };
  const historical: PublishedAuthorVersion = {
    id: 'version-1',
    versionNumber: 1,
    outline: {
      course: { title: 'Historical course', summary: null },
      sections: [
        {
          sourceSectionId: 'section-1',
          title: 'Section',
          summary: null,
          lessons: [
            {
              sourceLessonId: lesson.id,
              title: 'Lesson V1',
              content: null,
              blocks: [{ id: 'text-1', type: 'paragraph', text: 'Exact historical content V1' }],
            },
          ],
        },
      ],
    },
  };
  const readCourses = vi.spyOn(api, 'listCourses').mockImplementation(async () => ({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          ...course,
          draftRevision: revision,
          publicationState: published ? 'published' : 'changed',
          publishedVersion: published ? 3 : 2,
        },
      ],
    },
  }));
  const snapshot = (): ApiResult<Outline> => ({
    ok: true,
    status: 200,
    data: { sections: sections(), draftRevision: revision },
  });
  const outline = vi.spyOn(api, 'courseOutline').mockImplementation(async () => snapshot());
  vi.spyOn(api, 'authorVersions').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [historical] },
  });
  vi.spyOn(api, 'authoredActivities').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [] },
  });
  const publish = vi.spyOn(api, 'publishCourse').mockImplementation(async (_id, expected) => {
    expect(expected).toBe(revision);
    revision += 1;
    published = true;
    return {
      ok: true,
      status: 201,
      data: {
        versionId: 'version-3',
        versionNumber: 3,
        publishedAt: '2026-11-18T00:00:00.000Z',
        reused: false,
      },
    };
  });
  const restore = vi
    .spyOn(api, 'draftFromPublishedVersion')
    .mockImplementation(async (_kind, _id, _versionId, expected) => {
      if (expected !== revision) {
        return {
          ok: false,
          status: 409,
          error: { code: 'draft_conflict', message: 'The course changed in another window' },
        };
      }
      lesson = {
        ...lesson,
        title: 'Lesson V1',
        blocks: [{ id: 'text-1', type: 'paragraph', text: 'Exact historical content V1' }],
      };
      revision += 1;
      published = false;
      return {
        ok: true,
        status: 201,
        data: { id: course.id, draftRevision: revision, sourceVersionNumber: 1 },
      };
    });
  const save = vi
    .spyOn(api, 'saveCourseLesson')
    .mockImplementation(async (_id, _lessonId, input) => {
      if (input.expectedRevision !== revision) {
        return {
          ok: false,
          status: 409,
          error: { code: 'draft_conflict', message: 'The course changed in another window' },
        };
      }
      lesson = { ...lesson, ...input };
      revision += 1;
      published = false;
      return { ok: true, status: 200, data: { id: lesson.id, draftRevision: revision } };
    });
  let leave: (() => boolean) | null = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(CoursesPanel, {
        assignments: [],
        canTeach: true,
        onChanged: vi.fn(),
        onRegisterLeaveGuard: (guard) => {
          leave = guard;
        },
      }),
    ),
  );
  await act(async () => container.querySelector<HTMLButtonElement>('.course-row-main')!.click());
  await selectHistoricalVersion();
  return {
    publish,
    restore,
    save,
    outline,
    readCourses,
    snapshot,
    canLeave: () => leave!(),
    lesson: () => structuredClone(lesson),
    remoteEdit: () => {
      lesson = { ...lesson, title: 'Another author changed this lesson' };
      revision += 1;
    },
  };
}

describe('Course publication revision handoff', () => {
  it('holds restore until the published outline is confirmed and sends revision 11', async () => {
    const state = await setup();
    const delayed = deferred<ApiResult<Outline>>();
    state.outline.mockImplementationOnce(() => delayed.promise);
    await act(async () => button('Опубликовать v3').click());
    expect(state.publish).toHaveBeenCalledWith('course-1', 10, 'course-publish:course-1:10');
    expect(container.textContent).toContain('Курс опубликован: версия 3.');
    const restore = button('Создать черновик из этой версии');
    await act(async () => restore.click());
    expect(
      state.restore.mock.calls,
      'a pending outline must not send stale expectedRevision=10',
    ).toEqual([]);
    expect(restore.disabled).toBe(true);
    expect(state.canLeave()).toBe(false);
    await act(async () => delayed.resolve(state.snapshot()));
    await selectHistoricalVersion();
    expect(button('Создать черновик из этой версии').disabled).toBe(false);
    await act(async () => button('Создать черновик из этой версии').click());
    expect(state.restore).toHaveBeenCalledExactlyOnceWith('course', 'course-1', 'version-1', 11);
    expect(titleInput().value).toBe('Lesson V1');
    expect(container.textContent).not.toContain('The course changed in another window');
  });

  it.each(['http503', 'rejected'] as const)(
    'retains the lesson after %s and retries only the outline before restoring',
    async (failure) => {
      const state = await setup();
      state.outline.mockImplementationOnce(async () => {
        if (failure === 'rejected') throw new Error('Transport disconnected');
        return {
          ok: false,
          status: 503,
          error: { code: 'unavailable', message: 'Outline temporarily unavailable' },
        };
      });
      await act(async () => button('Опубликовать v3').click());
      expect(titleInput().value).toBe('Lesson V3');
      await act(async () => button('Создать черновик из этой версии').click());
      expect(state.restore).not.toHaveBeenCalled();
      expect(button('Создать черновик из этой версии').disabled).toBe(true);
      const retry = button('Повторить обновление');
      await act(async () => retry.click());
      expect(state.publish).toHaveBeenCalledTimes(1);
      await selectHistoricalVersion();
      await act(async () => button('Создать черновик из этой версии').click());
      expect(state.restore).toHaveBeenCalledExactlyOnceWith('course', 'course-1', 'version-1', 11);
      expect(titleInput().value).toBe('Lesson V1');
    },
  );

  it.each(['pending', 'failed'] as const)(
    'preserves later input across a %s refresh and saves it with the confirmed revision',
    async (phase) => {
      const state = await setup();
      const delayed = deferred<ApiResult<Outline>>();
      state.outline.mockImplementationOnce(() => delayed.promise);
      await act(async () => button('Опубликовать v3').click());
      if (phase === 'failed') {
        await act(async () =>
          delayed.resolve({
            ok: false,
            status: 503,
            error: { code: 'unavailable', message: 'Outline temporarily unavailable' },
          }),
        );
      }
      await typeTitle('Unsaved after publication');
      await submitLesson();
      expect(state.save).not.toHaveBeenCalled();
      expect(titleInput().value).toBe('Unsaved after publication');
      if (phase === 'failed') await act(async () => button('Повторить обновление').click());
      else await act(async () => delayed.resolve(state.snapshot()));
      expect(titleInput().value).toBe('Unsaved after publication');
      await selectHistoricalVersion();
      expect(button('Создать черновик из этой версии').disabled).toBe(true);
      await submitLesson();
      expect(state.save).toHaveBeenCalledWith(
        'course-1',
        'lesson-1',
        expect.objectContaining({ title: 'Unsaved after publication', expectedRevision: 11 }),
      );
      expect(state.lesson().title).toBe('Unsaved after publication');
      expect(titleInput().value).toBe('Unsaved after publication');
      expect(container.textContent).toContain('Урок сохранён.');
    },
  );

  it('does not rebase unsaved input onto a concurrent remote edit', async () => {
    const state = await setup();
    const delayed = deferred<ApiResult<Outline>>();
    state.outline.mockImplementationOnce(() => delayed.promise);
    await act(async () => button('Опубликовать v3').click());
    await typeTitle('My unsaved lesson');
    state.remoteEdit();
    await act(async () => delayed.resolve(state.snapshot()));
    await submitLesson();
    expect(state.save).not.toHaveBeenCalled();
    expect(titleInput().value).toBe('My unsaved lesson');
    expect(state.lesson().title).toBe('Another author changed this lesson');
    expect(container.textContent).toContain('Курс изменён в другом окне.');
    expect(button('Создать черновик из этой версии').disabled).toBe(true);
  });

  it('keeps the server conflict check for a remote edit after the confirmed refresh', async () => {
    const state = await setup();
    await act(async () => button('Опубликовать v3').click());
    await selectHistoricalVersion();
    state.remoteEdit();
    await act(async () => button('Создать черновик из этой версии').click());
    expect(state.restore).toHaveBeenCalledExactlyOnceWith('course', 'course-1', 'version-1', 11);
    expect(container.textContent).toContain('The course changed in another window');
    expect(titleInput().value).toBe('Lesson V3');
    expect(state.lesson().title).toBe('Another author changed this lesson');
  });
});
