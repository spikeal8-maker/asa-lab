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
  return { publish, save };
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
