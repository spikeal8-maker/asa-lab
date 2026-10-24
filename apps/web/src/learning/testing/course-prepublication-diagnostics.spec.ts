// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type ApiResult, type Course, type CourseLesson, type CourseSection } from '../../api';
import { CoursesPanel } from '../../components/CoursesPanel';
import { installCourseEditorTestDom } from '../../components/course-editor-test-dom';

const courseId = '11111111-1111-4111-8111-111111111111';
const sectionId = '22222222-2222-4222-8222-222222222222';
const firstId = '33333333-3333-4333-8333-333333333333';
const secondId = '44444444-4444-4444-8444-444444444444';
const pinId = '55555555-5555-4555-8555-555555555555';
const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let root: Root | null = null;
let container: HTMLDivElement;
let restoreBrowserApis: () => void;
beforeAll(() => {
  restoreBrowserApis = installCourseEditorTestDom();
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  restoreBrowserApis();
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  vi.restoreAllMocks();
});

function button(text: string, where: Element = container): HTMLButtonElement {
  const result = [...where.querySelectorAll<HTMLButtonElement>('button')].find(
    (entry) => entry.textContent?.trim() === text,
  );
  if (!result) throw new Error('Missing button: ' + text);
  return result;
}
function typeTitle(value: string) {
  const input = container.querySelector<HTMLTextAreaElement>(
    '.course-lesson-editor textarea[aria-label="Название урока"]',
  )!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const diagnostic = {
  courseId,
  draftRevision: 7,
  sectionId,
  lessonId: secondId,
  blockId: 'second-practice',
  field: 'learningActivityVersionId',
  reason: 'pin_unavailable',
  path: 'Раздел «Произвольное → название» → урок «Второй» → блок 2',
  message: 'Выберите доступную опубликованную практику.',
};
const rejected = () => ({
  ok: false as const,
  status: 409,
  error: {
    code: 'prepublish_invalid',
    message: diagnostic.path + ': ' + diagnostic.message,
    diagnostic,
  },
});

async function setup(legacy = false, secondBlocks?: CourseLesson['blocks']) {
  const lesson: CourseLesson = {
    id: firstId,
    title: 'Первый',
    summary: null,
    content: null,
    blocks: [{ id: 'first-text', type: 'paragraph', text: 'Сохранённая теория' }],
    kind: 'material',
    assignmentId: null,
    learningActivityVersionId: null,
    assignmentTitle: null,
    moduleKey: null,
    estimatedMinutes: null,
    position: 1,
    hidden: false,
  };
  const sections: CourseSection[] = [
    {
      id: sectionId,
      title: 'Произвольное → название',
      summary: null,
      position: 1,
      hidden: false,
      lessons: [
        lesson,
        {
          ...lesson,
          id: secondId,
          title: 'Второй',
          position: 2,
          kind: legacy ? 'assignment' : 'material',
          assignmentId: legacy ? pinId : null,
          assignmentTitle: legacy ? 'Старый банк' : null,
          blocks: secondBlocks ?? [
            { id: 'second-text', type: 'paragraph', text: 'Не потерять этот текст' },
            { id: 'second-practice', type: 'activity', learningActivityVersionId: pinId },
          ],
        },
      ],
    },
  ];
  const course: Course = {
    id: courseId,
    title: 'Курс диагностики',
    summary: null,
    visibility: 'private',
    ageBand: null,
    itemCount: 2,
    sectionCount: 1,
    lessonCount: 2,
    assignmentCount: 0,
    sharedWith: 0,
    copiedFromCourseId: null,
    publicationState: 'draft',
    publishedVersion: null,
    publishedAt: null,
    draftRevision: 7,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    archivedAt: null,
  };
  vi.spyOn(api, 'listCourses').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [course] },
  });
  vi.spyOn(api, 'courseOutline').mockResolvedValue({
    ok: true,
    status: 200,
    data: { sections, draftRevision: 7 },
  });
  vi.spyOn(api, 'authorVersions').mockResolvedValue({ ok: true, status: 200, data: { items: [] } });
  vi.spyOn(api, 'authoredActivities').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [] },
  });
  const publish = vi.spyOn(api, 'publishCourse').mockResolvedValue(rejected());
  const save = vi.spyOn(api, 'saveCourseLesson');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(CoursesPanel, {
        assignments: [],
        canTeach: true,
        onChanged: vi.fn(),
      }),
    ),
  );
  await act(async () => container.querySelector<HTMLButtonElement>('.course-row-main')!.click());
  return { publish, save, sections };
}

describe('course publication correction navigation', () => {
  it('opens the exact lesson and focuses the second block picker without parsing its displayed path', async () => {
    await setup();
    await act(async () => button('Опубликовать').click());
    expect(container.textContent).toContain(diagnostic.message);
    await act(async () => button('Перейти к исправлению').click());
    expect(
      container.querySelector<HTMLTextAreaElement>(
        '.course-lesson-editor textarea[aria-label="Название урока"]',
      )?.value,
    ).toBe('Второй');
    const blocks = container.querySelectorAll('.lesson-block-card');
    expect(blocks).toHaveLength(2);
    expect(document.activeElement).toBe(button('Заменить практику', blocks[1]!));
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Текст блока"]')?.value).toBe(
      'Не потерять этот текст',
    );
  });

  it('keeps edits typed while publication was pending and refuses to leave that lesson', async () => {
    const { publish, save } = await setup();
    let deliver!: (value: ApiResult<never>) => void;
    publish.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    await act(async () => button('Опубликовать').click());
    await act(async () => typeTitle('Правки B не потерять'));
    await act(async () => deliver(rejected()));
    await act(async () => button('Перейти к исправлению').click());
    expect(
      container.querySelector<HTMLTextAreaElement>(
        '.course-lesson-editor textarea[aria-label="Название урока"]',
      )?.value,
    ).toBe('Правки B не потерять');
    expect(container.textContent).toContain(
      'Сначала сохраните изменения урока. Переход не выполнен, данные не потеряны.',
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('focuses the image URL in the second block without changing its first text block', async () => {
    const { publish } = await setup(false, [
      { id: 'second-text', type: 'paragraph', text: 'Не потерять этот текст' },
      {
        id: 'second-image',
        type: 'image',
        url: 'https://example.test/image.png',
        alt: 'Изображение',
        caption: '',
      },
    ]);
    publish.mockResolvedValueOnce({
      ...rejected(),
      error: {
        ...rejected().error,
        diagnostic: {
          ...diagnostic,
          blockId: 'second-image',
          field: 'url',
          reason: 'asset_invalid',
        },
      },
    });
    await act(async () => button('Опубликовать').click());
    await act(async () => button('Перейти к исправлению').click());
    expect(document.activeElement).toBe(
      container.querySelector('[aria-label="Ссылка на изображение"]'),
    );
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Текст блока"]')?.value).toBe(
      'Не потерять этот текст',
    );
  });

  it('focuses a table cell when its rows need correction', async () => {
    const { publish } = await setup(false, [
      { id: 'second-table', type: 'table', rows: [['Сохранённая ячейка']] },
    ]);
    publish.mockResolvedValueOnce({
      ...rejected(),
      error: {
        ...rejected().error,
        diagnostic: {
          ...diagnostic,
          blockId: 'second-table',
          field: 'rows',
          reason: 'block_invalid',
        },
      },
    });
    await act(async () => button('Опубликовать').click());
    await act(async () => button('Перейти к исправлению').click());
    expect(document.activeElement).toBe(container.querySelector('[aria-label="Ячейка 1:1"]'));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Ячейка 1:1"]')?.value).toBe(
      'Сохранённая ячейка',
    );
  });

  it('explains why an existing legacy bank assignment must be replaced before saving it as a publishable lesson', async () => {
    await setup(true);
    const lessonButton = [
      ...container.querySelectorAll<HTMLButtonElement>('.course-lesson-link'),
    ].find((item) => item.textContent?.includes('Второй'));
    expect(lessonButton).toBeTruthy();
    await act(async () => lessonButton!.click());
    expect(container.textContent).toContain(
      'Задание из старого банка нельзя включить в новую публикацию курса.',
    );
    const save = container.querySelector<HTMLButtonElement>('.course-save-slot [type="submit"]');
    expect(save?.form).toBe(container.querySelector('.course-lesson-editor'));
    expect(save?.disabled).toBe(true);
    expect(button('Выбрать практику')).toBeTruthy();
  });
});

function typeMinutes(value: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('.course-duration-field input')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input;
}

function visible(selector: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(selector)].filter(
    (element) => !element.closest('[hidden], dialog:not([open])'),
  );
}

function readyLessonSave({ save, sections }: Awaited<ReturnType<typeof setup>>) {
  vi.mocked(api.courseOutline).mockResolvedValue({
    ok: true,
    status: 200,
    data: { sections, draftRevision: 8 },
  });
  const receipt = { ok: true as const, status: 200, data: { id: firstId, draftRevision: 8 } };
  save.mockResolvedValue(receipt);
  return receipt;
}

const durationError = 'Укажите целое число минут от 1 до 600 или оставьте поле пустым.';

describe('course editor save notices and parameter correction', () => {
  it('identifies the exact save notice separately from the persistent save state', async () => {
    const fixture = await setup();
    readyLessonSave(fixture);
    await act(async () => typeTitle('Свет и сопротивление'));
    await act(async () => button('Сохранить урок').click());
    expect(fixture.save).toHaveBeenCalledTimes(1);
    const notices = visible('[role="status"][aria-label="Уведомление курса"]');
    expect(notices).toHaveLength(1);
    expect(notices[0]!.textContent).toBe('Урок сохранён.');
    const states = visible('[role="status"][aria-label="Состояние сохранения курса"]');
    expect(states).toHaveLength(1);
    expect(states[0]!.textContent).toBe('Изменения сохраненыЧерновик · редакция 8');
    expect(notices[0]).not.toBe(states[0]);
  });

  it.each(['0', '601', '1.5'])(
    'keeps invalid duration %s visible and offers a focused correction without losing the lesson',
    async (value) => {
      const fixture = await setup();
      readyLessonSave(fixture);
      await act(async () => typeTitle('Правки урока сохраните'));
      await act(async () => button('Параметры урока').click());
      await act(async () => typeMinutes(value));
      const input = container.querySelector<HTMLInputElement>('.course-duration-field input')!;
      const settings = input.closest<HTMLDialogElement>('dialog')!;
      expect(input.validity.valid).toBe(false);
      await act(async () => button('Вернуться к уроку', settings).click());
      expect(settings.open).toBe(false);
      const alerts = visible('[role="alert"]');
      expect(alerts.map((element) => element.textContent)).toEqual([durationError]);
      expect(input.getAttribute('aria-describedby')).toBe(alerts[0]!.id);
      expect(fixture.save).not.toHaveBeenCalled();
      await act(async () => button('Исправить время урока').click());
      expect(settings.open).toBe(true);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe(value);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(visible('[role="alert"]').map((element) => element.textContent)).toEqual([
        durationError,
      ]);
      expect(
        container.querySelector<HTMLTextAreaElement>('[aria-label="Название урока"]')!.value,
      ).toBe('Правки урока сохраните');
      expect(
        container.querySelector<HTMLTextAreaElement>('[aria-label="Текст блока"]')!.value,
      ).toBe('Сохранённая теория');
      await act(async () => typeMinutes('15'));
      expect(input.validity.valid).toBe(true);
      expect(input.getAttribute('aria-invalid')).toBeNull();
      await act(async () => button('Вернуться к уроку', settings).click());
      expect(visible('[role="alert"]')).toHaveLength(0);
      await act(async () => button('Сохранить урок').click());
      expect(fixture.save).toHaveBeenCalledTimes(1);
      expect(fixture.save).toHaveBeenCalledWith(courseId, firstId, {
        sectionId,
        title: 'Правки урока сохраните',
        summary: null,
        content: null,
        blocks: [{ id: 'first-text', type: 'paragraph', text: 'Сохранённая теория' }],
        kind: 'material',
        assignmentId: null,
        learningActivityVersionId: null,
        estimatedMinutes: 15,
        expectedRevision: 7,
      });
    },
  );

  it('opens and focuses invalid parameters when Save is attempted, including an explicit submit event', async () => {
    const fixture = await setup();
    readyLessonSave(fixture);
    await act(async () => button('Параметры урока').click());
    await act(async () => typeMinutes('0'));
    const input = container.querySelector<HTMLInputElement>('.course-duration-field input')!;
    const settings = input.closest<HTMLDialogElement>('dialog')!;
    await act(async () => button('Вернуться к уроку', settings).click());
    expect(button('Сохранить урок').disabled).toBe(false);
    await act(async () => button('Сохранить урок').click());
    expect(fixture.save).not.toHaveBeenCalled();
    expect(settings.open).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(visible('[role="alert"]').map((element) => element.textContent)).toEqual([
      durationError,
    ]);
    await act(async () => typeMinutes('1.5'));
    await act(async () => button('Вернуться к уроку', settings).click());
    await act(async () => {
      input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(fixture.save).not.toHaveBeenCalled();
    expect(settings.open).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it.each([
    { value: '', expected: null },
    { value: '1', expected: 1 },
    { value: '600', expected: 600 },
  ])('preserves optional blank and valid duration boundary $value', async ({ value, expected }) => {
    const fixture = await setup();
    readyLessonSave(fixture);
    await act(async () => typeTitle('Урок с допустимым временем'));
    await act(async () => button('Параметры урока').click());
    await act(async () => typeMinutes(value));
    const input = container.querySelector<HTMLInputElement>('.course-duration-field input')!;
    expect(input.validity.valid).toBe(true);
    await act(async () => button('Вернуться к уроку').click());
    expect(visible('[role="alert"]')).toHaveLength(0);
    await act(async () => button('Сохранить урок').click());
    expect(fixture.save).toHaveBeenCalledTimes(1);
    expect(fixture.save.mock.calls[0]![2]).toMatchObject({
      estimatedMinutes: expected,
      expectedRevision: 7,
      title: 'Урок с допустимым временем',
    });
  });

  it('keeps later typed text dirty when the corrected-duration save acknowledgement arrives', async () => {
    const fixture = await setup();
    const receipt = readyLessonSave(fixture);
    let deliver!: (value: typeof receipt) => void;
    fixture.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    await act(async () => typeTitle('Отправленный урок'));
    await act(async () => button('Параметры урока').click());
    await act(async () => typeMinutes('0'));
    await act(async () => button('Вернуться к уроку').click());
    await act(async () => button('Исправить время урока').click());
    await act(async () => typeMinutes('15'));
    await act(async () => button('Вернуться к уроку').click());
    await act(async () => button('Сохранить урок').click());
    expect(fixture.save).toHaveBeenCalledTimes(1);
    expect(fixture.save.mock.calls[0]![2]).toMatchObject({
      title: 'Отправленный урок',
      estimatedMinutes: 15,
      expectedRevision: 7,
    });
    await act(async () => typeTitle('Новые правки во время сохранения'));
    await act(async () => deliver(receipt));
    expect(
      container.querySelector<HTMLTextAreaElement>('[aria-label="Название урока"]')!.value,
    ).toBe('Новые правки во время сохранения');
    expect(
      visible('[role="status"][aria-label="Уведомление курса"]').map(
        (element) => element.textContent,
      ),
    ).toEqual(['Урок сохранён. Последние изменения ещё не сохранены.']);
    expect(container.querySelector('[data-testid="course-save-state"]')!.textContent).toBe(
      'Есть несохранённые измененияЧерновик · редакция 8',
    );
    expect(container.querySelector<HTMLInputElement>('.course-duration-field input')!.value).toBe(
      '15',
    );
  });
});
