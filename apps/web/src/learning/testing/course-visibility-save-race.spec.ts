// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type ApiResult, type Course, type CourseLesson, type CourseSection } from '../../api';
import { CoursesPanel } from '../../components/CoursesPanel';

type VisibilityReceipt = { hidden: boolean; draftRevision: number };
type VisibilityTarget = 'lesson' | 'section';
const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let root: Root | null = null;
let container: HTMLDivElement;

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

function button(where: Element, text: string): HTMLButtonElement {
  const found = [...where.querySelectorAll<HTMLButtonElement>('button')].find(
    (entry) => entry.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

function titleInput(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('.course-lesson-editor input[maxlength="160"]')!;
}

function summaryInput(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('.course-lesson-editor input[maxlength="600"]')!;
}

function setInput(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function typeLater(): Promise<void> {
  await act(async () => {
    setInput(titleInput(), 'Правки B во время изменения видимости');
    setInput(summaryInput(), 'Описание B остаётся в форме');
  });
}

function expectLater(): void {
  expect(titleInput().value).toBe('Правки B во время изменения видимости');
  expect(summaryInput().value).toBe('Описание B остаётся в форме');
}

function saveButton(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('.course-lesson-editor [type="submit"]')!;
}

async function submit(): Promise<void> {
  await act(async () => {
    container
      .querySelector('.course-lesson-editor')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function setup(target: VisibilityTarget, initiallyHidden = false, noOp = false) {
  let revision = 1;
  let lesson: CourseLesson = {
    id: 'lesson-1',
    title: 'Исходный урок',
    summary: 'Исходное описание',
    content: null,
    blocks: [{ id: 'intro', type: 'paragraph', text: 'Исходное содержание' }],
    kind: 'material',
    assignmentId: null,
    learningActivityVersionId: null,
    assignmentTitle: null,
    moduleKey: null,
    estimatedMinutes: null,
    position: 1,
    hidden: target === 'lesson' && initiallyHidden,
  };
  let sectionHidden = target === 'section' && initiallyHidden;
  const sections = (): CourseSection[] => [
    {
      id: 'section-1',
      title: 'Исходный раздел',
      summary: null,
      position: 1,
      hidden: sectionHidden,
      lessons: [structuredClone(lesson)],
    },
  ];
  const course: Course = {
    id: 'course-1',
    title: 'Курс',
    summary: null,
    visibility: 'private',
    ageBand: null,
    itemCount: 1,
    sectionCount: 1,
    lessonCount: 1,
    assignmentCount: 0,
    sharedWith: 0,
    copiedFromCourseId: null,
    publicationState: 'draft',
    publishedVersion: null,
    publishedAt: null,
    draftRevision: 1,
    createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
    archivedAt: null,
  };
  const readCourses = vi.spyOn(api, 'listCourses').mockImplementation(async () => ({
    ok: true,
    status: 200,
    data: { items: [{ ...course, draftRevision: revision }] },
  }));
  const readOutline = vi.spyOn(api, 'courseOutline').mockImplementation(async () => ({
    ok: true,
    status: 200,
    data: { sections: sections(), draftRevision: revision },
  }));
  vi.spyOn(api, 'authorVersions').mockResolvedValue({ ok: true, status: 200, data: { items: [] } });
  vi.spyOn(api, 'authoredActivities').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [] },
  });
  const response = deferred<ApiResult<VisibilityReceipt>>();
  let visibilityResponse = response;
  const setHidden = vi
    .spyOn(api, target === 'lesson' ? 'setCourseLessonHidden' : 'setCourseSectionHidden')
    .mockImplementation(async (_courseId, _id, hidden, expectedRevision) => {
      expect(expectedRevision).toBe(revision);
      // The endpoint explicitly permits a no-op receipt at expectedRevision.
      // Exercise that contract independently of the outline's displayed flag.
      if (!noOp) revision += 1;
      if (target === 'lesson') lesson = { ...lesson, hidden };
      else sectionHidden = hidden;
      return visibilityResponse.promise;
    });
  const save = vi
    .spyOn(api, 'saveCourseLesson')
    .mockImplementation(async (_courseId, lessonId, input) => {
      expect(lessonId).toBe(lesson.id);
      if (input.expectedRevision !== revision) {
        return {
          ok: false,
          status: 409,
          error: { code: 'draft_conflict', message: 'Курс изменён в другом окне.' },
        };
      }
      lesson = { ...lesson, title: input.title, summary: input.summary };
      revision += 1;
      return { ok: true, status: 200, data: { id: lesson.id, draftRevision: revision } };
    });
  let guard: (() => boolean) | null = null;
  let mount = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  async function showCourseList(): Promise<void> {
    await act(async () => {
      root?.render(
        createElement(CoursesPanel, {
          key: ++mount,
          assignments: [],
          canTeach: true,
          onChanged: vi.fn(),
          onRegisterLeaveGuard: (value) => {
            guard = value;
          },
        }),
      );
    });
  }
  async function openCourse(): Promise<void> {
    await showCourseList();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.course-row-main')!.click();
    });
  }
  await openCourse();
  return {
    setHidden,
    response,
    nextVisibilityResponse: () => {
      visibilityResponse = deferred<ApiResult<VisibilityReceipt>>();
      return visibilityResponse;
    },
    save,
    readOutline,
    readCourses,
    canLeave: () => guard!(),
    openCourse,
    showCourseList,
    lesson: () => structuredClone(lesson),
    sectionHidden: () => sectionHidden,
    revision: () => revision,
    outline: () => ({ draftRevision: revision, sections: sections() }),
    writeRemoteLesson: () => {
      lesson = { ...lesson, title: 'Чужие правки C', summary: 'Чужое описание C' };
      revision += 1;
    },
  };
}

async function startVisibility(target: VisibilityTarget, initiallyHidden: boolean): Promise<void> {
  const row = container.querySelector(
    target === 'lesson' ? '.course-outline-section li' : '.course-outline-section-head',
  )!;
  await act(async () => {
    row.querySelector<HTMLElement>('.course-outline-menu > summary')!.click();
  });
  await act(async () => button(row, initiallyHidden ? 'Показать' : 'Скрыть').click());
}

describe.each(['lesson', 'section'] as const)('%s visibility during lesson editing', (target) => {
  it.each([false, true])(
    'uses the exact receipt and retains B when initially hidden=%s',
    async (hidden) => {
      const state = await setup(target, hidden);
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await startVisibility(target, hidden);
      expect(state.setHidden).toHaveBeenCalledWith('course-1', `${target}-1`, !hidden, 1);
      expect(titleInput().disabled).toBe(false);
      await typeLater();
      await act(async () => {
        state.response.resolve({
          ok: true,
          status: 200,
          data: { hidden: !hidden, draftRevision: 2 },
        });
      });
      expectLater();
      expect(state.canLeave()).toBe(false);
      expect(confirm).toHaveBeenCalledOnce();
      expect(saveButton().disabled).toBe(false);
      await submit();
      expect(state.save).toHaveBeenCalledOnce();
      expect(state.save.mock.calls[0]?.[2]).toMatchObject({
        title: 'Правки B во время изменения видимости',
        summary: 'Описание B остаётся в форме',
        expectedRevision: 2,
      });
      expect(state.lesson().title).toBe('Правки B во время изменения видимости');
      expect(target === 'lesson' ? state.lesson().hidden : state.sectionHidden()).toBe(!hidden);
      expect(container.textContent).not.toContain('Курс изменён в другом окне.');
      expect(state.canLeave()).toBe(true);
    },
  );

  it('does not send a lesson write while visibility is pending and keeps input editable', async () => {
    const state = await setup(target);
    await startVisibility(target, false);
    await typeLater();
    expect(saveButton().disabled).toBe(true);
    expect(container.textContent).toContain('Дождитесь подтверждения');
    await submit();
    expect(state.save).not.toHaveBeenCalled();
    expectLater();
    await act(async () => {
      state.response.resolve({ ok: true, status: 200, data: { hidden: true, draftRevision: 2 } });
    });
    expect(saveButton().disabled).toBe(false);
    expect(state.save).not.toHaveBeenCalled();
    await submit();
    expect(state.save.mock.calls[0]?.[2].expectedRevision).toBe(2);
    expect(state.lesson().title).toBe('Правки B во время изменения видимости');
  });

  it.each([false, true])(
    'accepts a confirmed no-op at the expected revision, initially hidden=%s',
    async (hidden) => {
      const state = await setup(target, hidden, true);
      await startVisibility(target, hidden);
      await typeLater();
      await act(async () => {
        state.response.resolve({
          ok: true,
          status: 200,
          data: { hidden: !hidden, draftRevision: 1 },
        });
      });
      expectLater();
      expect(saveButton().disabled).toBe(false);
      await submit();
      expect(state.save.mock.calls[0]?.[2].expectedRevision).toBe(1);
      expect(state.lesson().title).toBe('Правки B во время изменения видимости');
    },
  );

  it('does not adopt a later foreign revision from the refreshed course or outline', async () => {
    const state = await setup(target);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await startVisibility(target, false);
    await typeLater();
    state.writeRemoteLesson();
    expect(state.revision()).toBe(3);
    await act(async () => {
      state.response.resolve({ ok: true, status: 200, data: { hidden: true, draftRevision: 2 } });
    });
    await submit();
    expect(state.save.mock.calls[0]?.[2].expectedRevision).toBe(2);
    expect(state.lesson().title).toBe('Чужие правки C');
    expectLater();
    expect(container.textContent).toContain('Курс изменён в другом окне.');
    expect(state.canLeave()).toBe(false);
  });

  it('keeps the receipt revision when a late outline arrives after new input', async () => {
    const state = await setup(target);
    const lateOutline = deferred<Awaited<ReturnType<typeof api.courseOutline>>>();
    state.readOutline.mockReturnValueOnce(lateOutline.promise);
    await startVisibility(target, false);
    await act(async () => {
      state.response.resolve({ ok: true, status: 200, data: { hidden: true, draftRevision: 2 } });
    });
    expect(state.readOutline).toHaveBeenCalledTimes(2);
    await typeLater();
    state.writeRemoteLesson();
    await act(async () => {
      lateOutline.resolve({ ok: true, status: 200, data: state.outline() });
    });
    expectLater();
    await submit();
    expect(state.save.mock.calls[0]?.[2].expectedRevision).toBe(2);
    expect(state.lesson().title).toBe('Чужие правки C');
    expectLater();
  });

  it.each([
    ['null', null],
    ['missing', undefined],
    ['empty', {}],
    ['wrong visibility', { hidden: false, draftRevision: 2 }],
    ['missing visibility', { draftRevision: 2 }],
    ['string revision', { hidden: true, draftRevision: '2' }],
    ['missing revision', { hidden: true }],
    ['older revision', { hidden: true, draftRevision: 0 }],
    ['foreign revision', { hidden: true, draftRevision: 3 }],
    ['fractional revision', { hidden: true, draftRevision: 1.5 }],
  ])('blocks an unconfirmed %s receipt without losing B', async (_label, receipt) => {
    const state = await setup(target);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await startVisibility(target, false);
    await typeLater();
    await act(async () => {
      state.response.resolve({
        ok: true,
        status: 200,
        data: receipt as VisibilityReceipt,
      });
    });
    expectLater();
    expect(saveButton().disabled).toBe(true);
    expect(container.textContent).toContain('Не удалось подтвердить изменение видимости');
    await submit();
    expect(state.save).not.toHaveBeenCalled();
    expect(state.canLeave()).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('preserves B and the previous revision when the server rejects the visibility command', async () => {
    const state = await setup(target);
    state.setHidden.mockImplementation(async () => state.response.promise);
    await startVisibility(target, false);
    await typeLater();
    state.writeRemoteLesson();
    await act(async () => {
      state.response.resolve({
        ok: false,
        status: 409,
        error: {
          code: 'draft_conflict',
          message: 'Видимость не изменена: курс изменён в другом окне.',
        },
      });
    });
    expectLater();
    expect(saveButton().disabled).toBe(false);
    expect(container.textContent).toContain('Видимость не изменена: курс изменён в другом окне.');
    await submit();
    expect(state.save.mock.calls[0]?.[2].expectedRevision).toBe(1);
    expect(state.lesson().title).toBe('Чужие правки C');
    expectLater();
  });

  it.each(['network', 'server', 'exception'] as const)(
    'blocks an ambiguous %s failure and recovers only after explicit discard and reopen',
    async (failure) => {
      const state = await setup(target);
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await startVisibility(target, false);
      await typeLater();
      await act(async () => {
        if (failure === 'exception') state.response.reject(new Error('Response interrupted'));
        else {
          state.response.resolve({
            ok: false,
            status: failure === 'server' ? 503 : 0,
            error: { code: 'network', message: 'Сервер недоступен' },
          });
        }
      });
      expectLater();
      expect(saveButton().disabled).toBe(true);
      expect(container.textContent).toContain('Не удалось подтвердить изменение видимости');
      expect(state.canLeave()).toBe(false);
      expectLater();
      confirm.mockReturnValue(true);
      // The existing parent/global navigation uses this guard before unmounting.
      // Only an explicit discard removes B and permits a fresh server revision.
      expect(state.canLeave()).toBe(true);
      await state.openCourse();
      expect(titleInput().value).toBe('Исходный урок');
      expect(saveButton().disabled).toBe(false);
      await act(async () => setInput(titleInput(), 'Новая правка после повторного открытия'));
      await submit();
      expect(state.save.mock.calls[0]?.[2].expectedRevision).toBe(2);
      expect(state.lesson().title).toBe('Новая правка после повторного открытия');
    },
  );
});

describe.each(['lesson', 'section'] as const)(
  '%s visibility with an unavailable course',
  (target) => {
    it.each([
      ['archived', false],
      ['archived', true],
      ['missing', false],
      ['missing', true],
    ] as const)(
      'retains B and blocks further writes after the %s refresh, initially hidden=%s',
      async (availability, hidden) => {
        const state = await setup(target, hidden);
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const duplicate = vi
          .spyOn(api, target === 'lesson' ? 'duplicateCourseLesson' : 'duplicateCourseSection')
          .mockResolvedValue({
            ok: false,
            status: 404,
            error: { code: 'course_not_found', message: 'Недоступно' },
          });
        await startVisibility(target, hidden);
        await typeLater();
        const listed = await api.listCourses();
        if (!listed.ok) throw new Error('Fixture list failed');
        const unavailableItems =
          availability === 'missing'
            ? []
            : [
                {
                  ...listed.data.items[0],
                  archivedAt: '2026-10-19T18:00:00.000Z',
                  draftRevision: 3,
                },
              ];
        state.readCourses.mockResolvedValue({
          ok: true,
          status: 200,
          data: { items: unavailableItems },
        });
        await act(async () => {
          state.response.resolve({
            ok: true,
            status: 200,
            data: { hidden: !hidden, draftRevision: 2 },
          });
        });
        expect(container.querySelector('.course-lesson-editor')).not.toBeNull();
        expectLater();
        expect(
          container.querySelector('[data-testid="course-editor"] [role="alert"]')?.textContent,
        ).toContain('Курс больше недоступен для редактирования');
        expect(saveButton().disabled).toBe(true);
        await submit();
        expect(state.save).not.toHaveBeenCalled();
        await startVisibility(target, !hidden);
        const row = container.querySelector(
          target === 'lesson' ? '.course-outline-section li' : '.course-outline-section-head',
        )!;
        await act(async () => button(row, 'Дублировать').click());
        expect(state.setHidden).toHaveBeenCalledOnce();
        expect(duplicate).not.toHaveBeenCalled();
        expectLater();
        expect(state.canLeave()).toBe(false);
        expect(confirm).toHaveBeenCalledOnce();
        expectLater();
        expect(await state.readCourses()).toEqual({
          ok: true,
          status: 200,
          data: { items: unavailableItems },
        });
        confirm.mockReturnValue(true);
        expect(state.canLeave()).toBe(true);
        // Existing parent navigation unmounts only after the explicit discard.
        await state.showCourseList();
        expect(container.querySelector('.course-lesson-editor')).toBeNull();
        expect(container.querySelector('.course-row-main')).toBeNull();
        expect(state.save).not.toHaveBeenCalled();
        expect(state.canLeave()).toBe(true);
      },
    );

    it.each(['archived', 'missing'] as const)(
      'retains pending and unconfirmed visibility work when an earlier list request returns %s',
      async (availability) => {
        const state = await setup(target);
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const lateList = deferred<Awaited<ReturnType<typeof api.listCourses>>>();
        const initialList = await state.readCourses();
        if (!initialList.ok) throw new Error('Fixture list failed');
        state.readCourses.mockReturnValueOnce(lateList.promise);
        await startVisibility(target, false);
        await act(async () => {
          state.response.resolve({
            ok: true,
            status: 200,
            data: { hidden: true, draftRevision: 2 },
          });
        });
        expect(state.readCourses).toHaveBeenCalledTimes(3);
        const secondResponse = state.nextVisibilityResponse();
        await startVisibility(target, true);
        const unavailableItems =
          availability === 'missing'
            ? []
            : [
                {
                  ...initialList.data.items[0],
                  archivedAt: '2026-10-19T18:00:00.000Z',
                  draftRevision: 4,
                },
              ];
        state.readCourses.mockResolvedValue({
          ok: true,
          status: 200,
          data: { items: unavailableItems },
        });
        await act(async () =>
          lateList.resolve({ ok: true, status: 200, data: { items: unavailableItems } }),
        );
        expect(container.querySelector('.course-lesson-editor')).not.toBeNull();
        expect(titleInput().value).toBe('Исходный урок');
        expect(summaryInput().value).toBe('Исходное описание');
        expect(saveButton().disabled).toBe(true);
        expect(state.canLeave()).toBe(false);
        expect(confirm).not.toHaveBeenCalled();
        await act(async () =>
          secondResponse.resolve({
            ok: false,
            status: 0,
            error: { code: 'network', message: 'Ответ потерян' },
          }),
        );
        expect(container.querySelector('.course-lesson-editor')).not.toBeNull();
        expect(titleInput().value).toBe('Исходный урок');
        expect(summaryInput().value).toBe('Исходное описание');
        expect(
          container.querySelector('[data-testid="course-editor"] [role="alert"]')?.textContent,
        ).toContain('Курс больше недоступен для редактирования');
        expect(saveButton().disabled).toBe(true);
        expect(state.canLeave()).toBe(false);
        expect(confirm).toHaveBeenCalledOnce();
        expect(confirm).toHaveBeenCalledWith(
          'Изменение видимости не подтверждено. Всё равно покинуть редактор?',
        );
        confirm.mockClear();
        await typeLater();
        expectLater();
        await submit();
        expect(state.save).not.toHaveBeenCalled();
        expect(state.canLeave()).toBe(false);
        expect(confirm).toHaveBeenCalledOnce();
        confirm.mockReturnValue(true);
        expect(state.canLeave()).toBe(true);
        await state.showCourseList();
        expect(container.querySelector('.course-lesson-editor')).toBeNull();
        expect(container.querySelector('.course-row-main')).toBeNull();
        expect(state.save).not.toHaveBeenCalled();
      },
    );
  },
);
