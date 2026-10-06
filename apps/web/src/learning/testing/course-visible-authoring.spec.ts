// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { api, type AuthoredActivityLearnerPreview, type PublishedAuthorVersion } from '../../api';
import {
  CanonicalPracticePicker,
  loadPinnedPractice,
} from '../../components/CanonicalPracticePicker';
import { CourseAssignDialog, type CourseAssignAttempt } from '../../components/CourseAssignDialog';
import { LessonBlockEditor } from '../../components/LessonBlockEditor';
import { publishedCourseSections } from '../../components/CoursesPanel';

const versionId = '11111111-1111-4111-8111-111111111111';
const newerId = '22222222-2222-4222-8222-222222222222';
const preview = (id = versionId): AuthoredActivityLearnerPreview => ({
  source: { kind: 'published', id, versionNumber: 1, draftRevision: null, contentDigest: 'digest' },
  assignment: {
    title: 'Exact Electronics',
    goal: 'Exact goal',
    brief: 'Exact content',
    blocks: [],
    sampleImage: null,
  },
  moduleKey: 'electronics',
  resultMode: 'completion',
  maxPoints: null,
  policies: {},
  learnerRuntime: false,
});
const version: PublishedAuthorVersion = {
  id: versionId,
  versionNumber: 1,
  outline: {
    course: { title: 'Pinned course', summary: null },
    sections: [
      {
        sourceSectionId: 'section',
        title: 'Section',
        summary: null,
        lessons: [
          {
            sourceLessonId: 'lesson',
            title: 'Mixed',
            content: null,
            blocks: [
              { id: 'before', type: 'paragraph', text: 'Before' },
              { id: 'practice', type: 'activity', learningActivityVersionId: versionId },
              { id: 'after', type: 'paragraph', text: 'After' },
            ],
          },
        ],
      },
    ],
  },
};
let root: Root | null = null;
let container: HTMLDivElement | null = null;
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}
async function mount(element: ReturnType<typeof createElement>) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(element);
    await flush();
  });
}
function button(label: string) {
  const result = [...container!.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!result) throw new Error('Missing button ' + label);
  return result;
}

it('loads historical practice bytes and metadata from the saved pin after its source is republished', async () => {
  vi.spyOn(api, 'authoredActivities').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          id: 'root',
          title: 'Future title',
          kind: 'project',
          draftRevision: 4,
          currentPublishedVersionId: newerId,
        },
      ],
    },
  });
  vi.spyOn(api, 'authorVersions').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        { id: versionId, versionNumber: 1 },
        { id: newerId, versionNumber: 2 },
      ],
    },
  });
  const read = vi
    .spyOn(api, 'previewAuthoredActivityVersion')
    .mockResolvedValue({ ok: true, status: 200, data: preview() });
  expect((await loadPinnedPractice(versionId)).assignment.title).toBe('Exact Electronics');
  expect(read).toHaveBeenCalledWith('root', versionId);
  expect(read).not.toHaveBeenCalledWith('root', newerId);
  const sections = publishedCourseSections(version);
  expect(sections[0]?.lessons[0]?.blocks.map((block) => block.id)).toEqual([
    'before',
    'practice',
    'after',
  ]);
  expect(sections[0]?.lessons[0]?.blocks[1]).toEqual({
    id: 'practice',
    type: 'activity',
    learningActivityVersionId: versionId,
  });
});

it('does not substitute another version when the pinned preview response is wrong', async () => {
  vi.spyOn(api, 'authoredActivities').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          id: 'root',
          title: 'Practice',
          kind: 'project',
          draftRevision: 1,
          currentPublishedVersionId: versionId,
        },
      ],
    },
  });
  vi.spyOn(api, 'previewAuthoredActivityVersion').mockResolvedValue({
    ok: true,
    status: 200,
    data: preview(newerId),
  });
  await expect(loadPinnedPractice(versionId)).rejects.toThrow('Сервер не подтвердил');
});

it('offers only owned published project practices and searches before an exact selection', async () => {
  vi.spyOn(api, 'authoredActivities').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          id: 'root',
          title: 'Electronics',
          kind: 'project',
          draftRevision: 1,
          currentPublishedVersionId: versionId,
        },
        {
          id: 'manual',
          title: 'Manual',
          kind: 'manual',
          draftRevision: 1,
          currentPublishedVersionId: newerId,
        },
        {
          id: 'draft',
          title: 'Draft',
          kind: 'project',
          draftRevision: 1,
          currentPublishedVersionId: null,
        },
      ],
    },
  });
  const read = vi
    .spyOn(api, 'previewAuthoredActivityVersion')
    .mockResolvedValue({ ok: true, status: 200, data: preview() });
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
  const change = vi.fn();
  await mount(createElement(CanonicalPracticePicker, { value: '', onChange: change }));
  await act(async () => {
    button('Выбрать практику').click();
    await flush();
  });
  expect(container!.textContent).not.toContain('Manual');
  expect(container!.textContent).not.toContain('Draft');
  await act(async () => {
    const search = container!.querySelector<HTMLInputElement>('input[type="search"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      search,
      'Elect',
    );
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    button('Добавить').click();
    await flush();
  });
  expect(read).toHaveBeenCalledWith('root', versionId);
  expect(change).toHaveBeenCalledWith(versionId, 'Exact Electronics');
});

it('reuses frozen class, deadline and request ID after a lost response and close/reopen', async () => {
  vi.spyOn(api, 'listClassrooms').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [{ id: 'class', title: 'Class', archivedAt: null } as never],
      meta: { total: 1 },
    },
  });
  const assign = vi
    .spyOn(api, 'assignCourseToClassroom')
    .mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: { code: 'network_error', message: 'Lost response' },
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { runId: 'run', versionNumber: 1, reused: true },
    });
  const attempt: CourseAssignAttempt = { classroomId: 'class', dueDate: '2027-04-01' };
  const props = { courseId: 'course', version, attempt, onClose: vi.fn(), onBusyChange: vi.fn() };
  await mount(createElement(CourseAssignDialog, props));
  await act(async () => {
    button('Назначить').click();
    await flush();
  });
  expect(container!.textContent).toContain('Lost response');
  expect(container!.querySelector('select')!.disabled).toBe(true);
  expect(container!.querySelector<HTMLInputElement>('input[type="date"]')!.disabled).toBe(true);
  const frozen = structuredClone(assign.mock.calls[0]);
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  await mount(createElement(CourseAssignDialog, props));
  await act(async () => {
    button('Повторить назначение').click();
    await flush();
  });
  expect(assign.mock.calls[1]).toEqual(frozen);
  expect(container!.textContent).toContain('Сервер подтвердил версию 1');
  expect(button('Назначить').disabled).toBe(true);
});

it('rejects a published practice whose actual module cannot be assigned', async () => {
  vi.spyOn(api, 'authoredActivities').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          id: 'root',
          title: 'Scratch practice',
          kind: 'project',
          draftRevision: 1,
          currentPublishedVersionId: versionId,
        },
      ],
    },
  });
  vi.spyOn(api, 'previewAuthoredActivityVersion').mockResolvedValue({
    ok: true,
    status: 200,
    data: { ...preview(), moduleKey: 'blocks' },
  });
  vi.spyOn(api, 'listModules').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          moduleKey: 'blocks',
          creatable: true,
          learningCapabilities: { assignable: false },
        } as never,
      ],
    },
  });
  const change = vi.fn();
  await mount(createElement(CanonicalPracticePicker, { value: '', onChange: change }));
  await act(async () => {
    button('Выбрать практику').click();
    await flush();
  });
  await act(async () => {
    button('Добавить').click();
    await flush();
  });
  expect(change).not.toHaveBeenCalled();
  expect(container!.querySelector('[role="alert"]')!.textContent).toContain(
    'недоступна для назначения',
  );
});

it('does not add a practice after navigating away while its selection is pending', async () => {
  vi.spyOn(api, 'authoredActivities').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          id: 'root',
          title: 'Electronics',
          kind: 'project',
          draftRevision: 1,
          currentPublishedVersionId: versionId,
        },
      ],
    },
  });
  let resolve!: (value: Awaited<ReturnType<typeof api.previewAuthoredActivityVersion>>) => void;
  vi.spyOn(api, 'previewAuthoredActivityVersion').mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
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
  const change = vi.fn();
  await mount(createElement(CanonicalPracticePicker, { value: '', onChange: change }));
  await act(async () => {
    button('Выбрать практику').click();
    await flush();
  });
  await act(async () => {
    button('Добавить').click();
  });
  await act(async () => root?.unmount());
  root = null;
  await act(async () => {
    resolve({ ok: true, status: 200, data: preview() });
    await flush();
  });
  expect(change).not.toHaveBeenCalled();
});

it('keeps an already open add-content menu disabled when the lesson reaches its block limit', async () => {
  const change = vi.fn();
  const blocks = Array.from({ length: 40 }, (_, index) => ({
    id: String(index),
    type: 'paragraph' as const,
    text: '',
  }));
  await mount(
    createElement(LessonBlockEditor, {
      blocks: blocks.slice(0, 39),
      activities: [],
      onChange: change,
    }),
  );
  await act(async () => button('+ Добавить содержимое').click());
  await act(async () =>
    root?.render(createElement(LessonBlockEditor, { blocks, activities: [], onChange: change })),
  );
  const choices = [...container!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  expect(choices.length).toBeGreaterThan(0);
  expect(choices.every((choice) => choice.disabled)).toBe(true);
  await act(async () => choices.forEach((choice) => choice.click()));
  expect(change).not.toHaveBeenCalled();
});

it('uses the current editor callback when a practice selection resolves after another edit', async () => {
  vi.spyOn(api, 'authoredActivities').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          id: 'root',
          title: 'Electronics',
          kind: 'project',
          draftRevision: 1,
          currentPublishedVersionId: versionId,
        },
      ],
    },
  });
  let resolve!: (value: Awaited<ReturnType<typeof api.previewAuthoredActivityVersion>>) => void;
  vi.spyOn(api, 'previewAuthoredActivityVersion').mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
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
  const stale = vi.fn(),
    current = vi.fn();
  await mount(createElement(CanonicalPracticePicker, { value: '', onChange: stale }));
  await act(async () => {
    button('Выбрать практику').click();
    await flush();
  });
  await act(async () => {
    button('Добавить').click();
  });
  await act(async () =>
    root?.render(createElement(CanonicalPracticePicker, { value: '', onChange: current })),
  );
  await act(async () => {
    resolve({ ok: true, status: 200, data: preview() });
    await flush();
  });
  expect(stale).not.toHaveBeenCalled();
  expect(current).toHaveBeenCalledWith(versionId, 'Exact Electronics');
});
