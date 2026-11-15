// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { api, type Course, type CourseSection } from '../../api';
import { CoursesPanel } from '../../components/CoursesPanel';
import { installCourseEditorTestDom } from '../../components/course-editor-test-dom';

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
const modes = ['new course', 'existing course', 'new section', 'existing section'] as const;
type Mode = (typeof modes)[number];
type Receipt = { id: string; draftRevision: number };
type SaveResult =
  | { ok: true; status: number; data: Receipt }
  | { ok: false; status: number; error: { code: string; message: string } };

const originalCourse: Course = {
  id: 'course-1',
  title: 'Original course',
  summary: 'Original course description',
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
  draftRevision: 7,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
};
const originalSection: CourseSection = {
  id: 'section-1',
  title: 'Original section',
  summary: 'Original section description',
  position: 1,
  hidden: false,
  lessons: [],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
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
  container = null;
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function setField(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function button(label: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll('button')].find(
    (entry) => entry.textContent?.trim() === label || entry.getAttribute('aria-label') === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function dialog(): HTMLFormElement {
  const found = container!.querySelector<HTMLFormElement>('.course-form-dialog');
  if (!found) throw new Error('The author form was closed with unsaved input');
  return found;
}

async function submit(): Promise<void> {
  await act(async () => {
    dialog().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
}

async function setup(mode: Mode, failFirst = false, { fromList = false } = {}) {
  const pending = deferred<SaveResult>();
  let firstResult: SaveResult | null = null;
  const courses = mode === 'new course' ? [] : [structuredClone(originalCourse)];
  const sections = [structuredClone(originalSection)];
  let guard: (() => boolean) | null = null;
  let calls = 0;
  let failNextList: 'http503' | 'malformed200' | null = null;
  const snapshot = () => structuredClone(courses[0]);
  const conflict = (): SaveResult => ({
    ok: false,
    status: 409,
    error: { code: 'draft_conflict', message: 'The course changed in another window' },
  });

  vi.spyOn(api, 'listCourses').mockImplementation(async () => {
    if (failNextList) {
      const failure = failNextList;
      failNextList = null;
      if (failure === 'malformed200') {
        return { ok: true, status: 200, data: null as unknown as { items: Course[] } };
      }
      return {
        ok: false,
        status: 503,
        error: { code: 'unavailable', message: 'Course list is temporarily unavailable' },
      };
    }
    return { ok: true, status: 200, data: { items: structuredClone(courses) } };
  });
  vi.spyOn(api, 'courseOutline').mockImplementation(async () => {
    if (!courses[0] || courses[0].archivedAt !== null) {
      return {
        ok: false,
        status: 404,
        error: { code: 'course_not_found', message: 'Course is no longer available' },
      };
    }
    return {
      ok: true,
      status: 200,
      data: { sections: structuredClone(sections), draftRevision: courses[0].draftRevision },
    };
  });
  vi.spyOn(api, 'authorVersions').mockResolvedValue({ ok: true, status: 200, data: { items: [] } });
  vi.spyOn(api, 'authoredActivities').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [] },
  });
  const finish = (result: SaveResult) => {
    if (calls === 1) {
      firstResult = result;
      return pending.promise;
    }
    return Promise.resolve(result);
  };
  const saveCourse = vi.spyOn(api, 'saveCourse').mockImplementation(async (id, input) => {
    calls += 1;
    if (failFirst && calls === 1) {
      return finish({
        ok: false,
        status: 503,
        error: { code: 'unavailable', message: 'Saving is temporarily unavailable' },
      });
    }
    if (
      id &&
      (id !== courses[0]?.id ||
        courses[0]?.archivedAt !== null ||
        input.expectedRevision !== courses[0]?.draftRevision)
    ) {
      return finish(conflict());
    }
    if (!id) {
      courses.push({
        ...structuredClone(originalCourse),
        id: `course-${courses.length + 1}`,
        title: input.title,
        summary: input.summary,
        draftRevision: 1,
      });
    } else {
      courses[0] = {
        ...courses[0]!,
        title: input.title,
        summary: input.summary,
        draftRevision: courses[0]!.draftRevision + 1,
      };
    }
    const saved = courses[courses.length - 1]!;
    return finish({
      ok: true,
      status: id ? 200 : 201,
      data: { id: saved.id, draftRevision: saved.draftRevision },
    });
  });
  const saveSection = vi
    .spyOn(api, 'saveCourseSection')
    .mockImplementation(async (courseId, id, input) => {
      calls += 1;
      if (failFirst && calls === 1) {
        return finish({
          ok: false,
          status: 503,
          error: { code: 'unavailable', message: 'Saving is temporarily unavailable' },
        });
      }
      if (
        courseId !== courses[0]?.id ||
        courses[0]?.archivedAt !== null ||
        input.expectedRevision !== courses[0]?.draftRevision
      ) {
        return finish(conflict());
      }
      const savedId = id ?? `section-${sections.length + 1}`;
      if (id) {
        const index = sections.findIndex((entry) => entry.id === id);
        if (index < 0) throw new Error('The form attempted to update a different section');
        sections[index] = { ...sections[index]!, title: input.title, summary: input.summary };
      } else {
        sections.push({
          ...structuredClone(originalSection),
          id: savedId,
          title: input.title,
          summary: input.summary,
          position: sections.length + 1,
        });
      }
      courses[0]!.draftRevision += 1;
      return finish({
        ok: true,
        status: id ? 200 : 201,
        data: { id: savedId, draftRevision: courses[0]!.draftRevision },
      });
    });

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(CoursesPanel, {
        assignments: [],
        canTeach: true,
        onChanged: vi.fn(),
        onRegisterLeaveGuard: (next) => {
          guard = next;
        },
      }),
    );
    await flush();
  });
  if (mode === 'new course') {
    await act(async () => button('Создать курс').click());
  } else if (fromList) {
    await act(async () =>
      container!.querySelector<HTMLElement>('.course-row-menu summary')!.click(),
    );
    await act(async () => button('Настройки').click());
  } else {
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('.course-row-main')!.click();
      await flush();
    });
    await act(async () => {
      if (mode === 'existing course') {
        container!.querySelector<HTMLElement>('.course-actions-menu summary')!.click();
        button('Настройки').click();
      } else if (mode === 'new section') button('Добавить раздел').click();
      else container!.querySelector<HTMLButtonElement>('.course-section-name')!.click();
    });
  }
  return {
    saveCourse,
    saveSection,
    release: async (response?: SaveResult) => {
      expect(firstResult).not.toBeNull();
      await act(async () => {
        pending.resolve(response ?? firstResult!);
        await flush();
      });
    },
    receipt: () => {
      if (!firstResult?.ok) throw new Error('A successful response is required');
      return firstResult.data;
    },
    canLeave: () => guard?.() ?? true,
    failNextList: (failure: 'http503' | 'malformed200') => {
      failNextList = failure;
    },
    courses: () => structuredClone(courses),
    sections: () => structuredClone(sections),
    makeUnavailable: (kind: 'archived' | 'missing') => {
      if (kind === 'missing') courses.splice(0, courses.length);
      else {
        courses[0]!.archivedAt = '2026-10-19T12:00:00.000Z';
        courses[0]!.draftRevision += 1;
      }
    },
    changeRemotely: () => {
      courses[0]!.draftRevision += 1;
      if (mode.includes('course')) {
        courses[0]!.title = 'Remote course';
        courses[0]!.summary = 'Remote description';
      } else {
        const index = mode === 'new section' ? 1 : 0;
        sections[index]!.title = 'Remote section';
        sections[index]!.summary = 'Remote description';
      }
    },
    snapshot,
  };
}

it.each(modes)(
  'retains newer title and description after saving a %s, then updates the same ID with the acknowledged revision',
  async (mode) => {
    const state = await setup(mode);
    await act(async () => {
      setField(dialog().querySelector('input')!, 'Sent title A');
      setField(dialog().querySelector('textarea')!, 'Sent description A');
    });
    await submit();
    expect(dialog().querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
    await act(async () => {
      setField(dialog().querySelector('input')!, 'New title B');
      setField(dialog().querySelector('textarea')!, 'New description B');
    });
    const receipt = state.receipt();
    await state.release();
    expect(dialog().querySelector<HTMLInputElement>('input')!.value).toBe('New title B');
    expect(dialog().querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(
      'New description B',
    );
    expect(dialog().textContent).toContain('Последние изменения ещё не сохранены');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => expect(state.canLeave()).toBe(false));
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await submit();
    expect(container!.querySelector('.course-form-dialog')).toBeNull();
    if (mode.includes('course')) {
      expect(state.saveCourse.mock.calls[1]).toMatchObject([
        receipt.id,
        {
          title: 'New title B',
          summary: 'New description B',
          expectedRevision: receipt.draftRevision,
        },
      ]);
      expect(state.courses()).toHaveLength(1);
      expect(state.courses()[0]).toMatchObject({
        id: receipt.id,
        title: 'New title B',
        summary: 'New description B',
      });
    } else {
      expect(state.saveSection.mock.calls[1]).toMatchObject([
        'course-1',
        receipt.id,
        {
          title: 'New title B',
          summary: 'New description B',
          expectedRevision: receipt.draftRevision,
        },
      ]);
      expect(state.sections()).toHaveLength(mode === 'new section' ? 2 : 1);
      expect(state.sections().find((entry) => entry.id === receipt.id)).toMatchObject({
        title: 'New title B',
        summary: 'New description B',
      });
    }
  },
);

it.each(modes)(
  'preserves typed values and the leave guard when saving a %s fails',
  async (mode) => {
    const state = await setup(mode, true);
    const original = state.snapshot();
    await act(async () => setField(dialog().querySelector('input')!, 'Sent title A'));
    await submit();
    await act(async () => {
      setField(dialog().querySelector('input')!, 'New title B');
      setField(dialog().querySelector('textarea')!, 'New description B');
    });
    await state.release();
    expect(dialog().querySelector<HTMLInputElement>('input')!.value).toBe('New title B');
    expect(dialog().querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(
      'New description B',
    );
    expect(dialog().textContent).toContain('Saving is temporarily unavailable');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => expect(state.canLeave()).toBe(false));
    expect(state.snapshot()).toEqual(original);
  },
);

it.each(modes)(
  'does not adopt a competing revision while preserving the later input of a %s',
  async (mode) => {
    const state = await setup(mode);
    await act(async () => setField(dialog().querySelector('input')!, 'Sent title A'));
    await submit();
    const receipt = state.receipt();
    await act(async () => {
      setField(dialog().querySelector('input')!, 'New title B');
      setField(dialog().querySelector('textarea')!, 'New description B');
    });
    state.changeRemotely();
    await state.release();
    await submit();
    expect(dialog().querySelector<HTMLInputElement>('input')!.value).toBe('New title B');
    expect(dialog().textContent).toContain('The course changed in another window');
    const input = mode.includes('course')
      ? state.saveCourse.mock.calls[1]?.[1]
      : state.saveSection.mock.calls[1]?.[2];
    expect(input?.expectedRevision).toBe(receipt.draftRevision);
    expect(
      mode.includes('course') ? state.courses()[0]!.title : state.sections().at(-1)!.title,
    ).toMatch(/^Remote /);
  },
);

it.each(modes.flatMap((mode) => ['http503', 'malformed200'].map((failure) => ({ mode, failure }))))(
  'keeps the later $mode input after a failed list refresh ($failure) following a successful save',
  async ({ mode, failure }) => {
    const state = await setup(mode);
    await act(async () => setField(dialog().querySelector('input')!, 'Sent title A'));
    await submit();
    const receipt = state.receipt();
    await act(async () => {
      setField(dialog().querySelector('input')!, 'New title B');
      setField(dialog().querySelector('textarea')!, 'New description B');
    });
    state.failNextList(failure as 'http503' | 'malformed200');
    await state.release();
    expect(dialog().querySelector<HTMLInputElement>('input')!.value).toBe('New title B');
    expect(dialog().querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(
      'New description B',
    );
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => expect(state.canLeave()).toBe(false));
    await submit();
    expect(container!.querySelector('.course-form-dialog')).toBeNull();
    const input = mode.includes('course')
      ? state.saveCourse.mock.calls[1]?.[1]
      : state.saveSection.mock.calls[1]?.[2];
    expect(input?.expectedRevision).toBe(receipt.draftRevision);
  },
);

it.each(
  modes.flatMap((mode) =>
    ['missing revision', 'null JSON', 'absent JSON'].map((shape) => ({ mode, shape })),
  ),
)(
  'preserves the later $mode input and refuses another mutation for an unconfirmed receipt ($shape)',
  async ({ mode, shape }) => {
    const state = await setup(mode);
    await act(async () => setField(dialog().querySelector('input')!, 'Sent title A'));
    await submit();
    const { id } = state.receipt();
    await act(async () => {
      setField(dialog().querySelector('input')!, 'New title B');
      setField(dialog().querySelector('textarea')!, 'New description B');
    });
    const data = shape === 'missing revision' ? { id } : shape === 'null JSON' ? null : undefined;
    await state.release({ ok: true, status: 200, data: data as Receipt });
    expect(dialog().querySelector<HTMLInputElement>('input')!.value).toBe('New title B');
    expect(dialog().querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(
      'New description B',
    );
    expect(dialog().querySelector('[role="alert"]')!.textContent).toContain(
      'Не удалось подтвердить сохранение',
    );
    expect(dialog().querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => expect(state.canLeave()).toBe(false));
    await submit();
    expect(mode.includes('course') ? state.saveCourse : state.saveSection).toHaveBeenCalledTimes(1);
  },
);

it.each([false, true])(
  'handles a current-state creation replay after a lost POST response without overwriting a competing edit (%s)',
  async (competing) => {
    const state = await setup('new course');
    await act(async () => setField(dialog().querySelector('input')!, 'Sent title A'));
    await submit();
    // The first POST committed A, but its response did not reach the form.
    await state.release({
      ok: false,
      status: 0,
      error: { code: 'network', message: 'The response was lost' },
    });
    if (competing) state.changeRemotely();
    const remote = state.snapshot()!;
    const retry = deferred<SaveResult>();
    state.saveCourse.mockImplementationOnce(async (id, input) => {
      expect(id).toBeNull();
      expect(input).toEqual(state.saveCourse.mock.calls[0]![1]);
      // Existing course_save_v2 replay returns the course's current revision,
      // which may belong to a later writer rather than the first POST.
      return retry.promise;
    });
    await submit();
    await act(async () => {
      setField(dialog().querySelector('input')!, 'New title B');
      setField(dialog().querySelector('textarea')!, 'New description B');
    });
    await act(async () => {
      retry.resolve({
        ok: true,
        status: 201,
        data: { id: remote.id, draftRevision: remote.draftRevision },
      });
      await flush();
    });
    expect(dialog().querySelector<HTMLInputElement>('input')!.value).toBe('New title B');
    expect(dialog().querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(
      'New description B',
    );
    await submit();
    if (competing) {
      expect(state.saveCourse).toHaveBeenCalledTimes(2);
      expect(state.courses()).toEqual([remote]);
      expect(dialog().querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
      expect(dialog().querySelector('[role="alert"]')!.textContent).toContain(
        'Курс уже существует и был изменён после создания',
      );
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      await act(async () => expect(state.canLeave()).toBe(false));
    } else {
      expect(state.saveCourse).toHaveBeenCalledTimes(3);
      expect(state.saveCourse.mock.calls[2]).toMatchObject([
        remote.id,
        { title: 'New title B', expectedRevision: 1 },
      ]);
      expect(state.courses()).toHaveLength(1);
      expect(state.courses()[0]).toMatchObject({
        id: remote.id,
        title: 'New title B',
        summary: 'New description B',
      });
      expect(container!.querySelector('.course-form-dialog')).toBeNull();
    }
  },
);

it.each(
  [
    { mode: 'existing course' as const, fromList: false },
    { mode: 'existing course' as const, fromList: true },
    { mode: 'new section' as const, fromList: false },
    { mode: 'existing section' as const, fromList: false },
  ].flatMap((entry) =>
    (['archived', 'missing'] as const).map((unavailable) => ({ ...entry, unavailable })),
  ),
)(
  'preserves local $mode input (fromList=$fromList) when a successful refresh makes its course $unavailable',
  async ({ mode, fromList, unavailable }) => {
    const state = await setup(mode, false, { fromList });
    await act(async () => {
      setField(dialog().querySelector('input')!, 'Sent title A');
      setField(dialog().querySelector('textarea')!, 'Sent description A');
    });
    await submit();
    await act(async () => {
      setField(dialog().querySelector('input')!, 'New title B');
      setField(dialog().querySelector('textarea')!, 'New description B');
    });
    state.makeUnavailable(unavailable);
    const remoteCourses = state.courses();
    const remoteSections = state.sections();
    await state.release();

    expect(dialog().querySelector<HTMLInputElement>('input')!.value).toBe('New title B');
    expect(dialog().querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(
      'New description B',
    );
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(
      'Курс больше недоступен для редактирования',
    );
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => expect(state.canLeave()).toBe(false));
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    // A disabled button alone is insufficient: form submission must also stop.
    await submit();
    expect(mode === 'existing course' ? state.saveCourse : state.saveSection).toHaveBeenCalledTimes(
      1,
    );
    expect(dialog().querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
    expect(state.courses()).toEqual(remoteCourses);
    expect(state.sections()).toEqual(remoteSections);

    confirm.mockReturnValue(true);
    await act(async () => button('Отмена').click());
    expect(container!.querySelector('.course-form-dialog')).toBeNull();
    await act(async () => expect(state.canLeave()).toBe(true));
    expect(container!.querySelector('[data-testid="course-editor"]')).toBeNull();
    expect(container!.querySelectorAll('.course-row-main')).toHaveLength(0);
    expect(state.courses()).toEqual(remoteCourses);
    expect(state.sections()).toEqual(remoteSections);
  },
);
