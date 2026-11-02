// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { api, type AuthoredActivityDraft, type LessonBlock } from '../../api';
import { LessonBlockEditor } from '../../components/LessonBlockEditor';

const rootId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const guards = new Map<string, () => boolean>();
let root: Root | null = null;
let container: HTMLDivElement;
let saved: AuthoredActivityDraft;
const parentSubmit = vi.fn();
const pinChange = vi.fn();
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
const module = {
  moduleKey: 'electronics',
  displayName: 'Электроника',
  creatable: true,
  learningCapabilities: { assignable: true },
};
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}
function button(label: string) {
  const value = [...document.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!value) throw new Error('Missing button ' + label);
  return value;
}
async function click(label: string) {
  await act(async () => {
    button(label).click();
    await flush();
  });
}
async function fill(label: string, value: string) {
  const field = document.querySelector<HTMLTextAreaElement | HTMLSelectElement>(
    '[aria-label="' + label + '"]',
  )!;
  await act(async () => {
    const prototype =
      field instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}
function Harness() {
  const [blocks, setBlocks] = useState<LessonBlock[]>([
    { id: 'practice', type: 'activity', learningActivityVersionId: '' },
  ]);
  return createElement(
    'form',
    {
      onSubmit: (event) => {
        event.preventDefault();
        parentSubmit();
      },
    },
    createElement('input', {
      'aria-label': 'Название урока',
      defaultValue: 'Мой несохранённый урок',
    }),
    createElement(LessonBlockEditor, {
      blocks,
      activities: [],
      onChange: (value) => {
        pinChange(value);
        setBlocks(value);
      },
      onRegisterNestedLeaveGuard: (id, guard) => {
        if (guard) guards.set(id, guard);
        else guards.delete(id);
      },
    }),
    createElement(
      'output',
      { 'data-testid': 'saved-pin' },
      blocks[0]?.type === 'activity' ? blocks[0].learningActivityVersionId : '',
    ),
  );
}
async function mount() {
  container = document.createElement('div');
  container.id = 'root';
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(Harness));
    await flush();
  });
  await click('Создать задание для урока');
}
async function readyDraft() {
  await fill('Среда задания', 'electronics');
  await fill('Название задания', 'Новая практика прямо из курса');
  await fill('Содержание', 'Соберите и проверьте цепь.');
}
function canLeaveParent() {
  return [...guards.values()].every((guard) => guard());
}
beforeAll(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});
beforeEach(() => {
  guards.clear();
  parentSubmit.mockClear();
  pinChange.mockClear();
  Object.defineProperty(HTMLDialogElement.prototype, 'show', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  vi.spyOn(api, 'authoredActivities').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [] },
  });
  vi.spyOn(api, 'listModules').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [module] },
  } as never);
  vi.spyOn(api, 'createActivityDraft').mockImplementation(async (draft) => {
    saved = draft;
    return { ok: true, status: 201, data: { id: rootId, draftRevision: 1 } };
  });
  vi.spyOn(api, 'authoredActivity').mockImplementation(async () => ({
    ok: true,
    status: 200,
    data: {
      id: rootId,
      title: saved.title,
      kind: 'project',
      draftRevision: 1,
      draftSampleImage: null,
      currentPublishedVersionId: versionId,
      draft: saved,
      inheritedGoal: null,
    },
  }));
  vi.spyOn(api, 'publishAuthoredActivity').mockResolvedValue({
    ok: true,
    status: 200,
    data: { id: versionId, versionNumber: 1 },
  } as never);
  vi.spyOn(api, 'previewAuthoredActivityVersion').mockImplementation(async () => ({
    ok: true,
    status: 200,
    data: {
      source: {
        kind: 'published',
        id: versionId,
        versionNumber: 1,
        draftRevision: null,
        contentDigest: 'digest',
      },
      assignment: {
        title: saved.title,
        goal: null,
        brief: saved.instructions,
        blocks: [],
        sampleImage: null,
      },
      moduleKey: 'electronics',
      resultMode: 'completion',
      maxPoints: null,
      policies: {},
      learnerRuntime: false,
    },
  }));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  vi.restoreAllMocks();
});
it('creates and inserts the confirmed published version without submitting or replacing the lesson form', async () => {
  await mount();
  expect(button('Опубликовать и добавить в урок').disabled).toBe(true);
  await readyDraft();
  await click('Создать задание');
  expect(parentSubmit).not.toHaveBeenCalled();
  expect(api.createActivityDraft).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-testid="saved-pin"]')?.textContent).toBe('');
  await click('Опубликовать и добавить в урок');
  expect(api.publishAuthoredActivity).toHaveBeenCalledWith(rootId, 1, 'publish:' + rootId + ':1');
  expect(api.previewAuthoredActivityVersion).toHaveBeenCalledWith(rootId, versionId);
  expect(container.querySelector('[data-testid="saved-pin"]')?.textContent).toBe(versionId);
  expect(container.querySelector<HTMLInputElement>('[aria-label="Название урока"]')?.value).toBe(
    'Мой несохранённый урок',
  );
  expect(document.querySelector('[aria-label="Новое задание для урока"]')).toBeNull();
  expect(guards.size).toBe(0);
  expect(container.inert).toBe(false);
  expect(document.activeElement).toBe(button('Создать задание для урока'));
  expect(parentSubmit).not.toHaveBeenCalled();
});
it('keeps the same dirty author and lesson mounted when close or parent navigation is rejected', async () => {
  await mount();
  await readyDraft();
  const textarea = document.querySelector('[aria-label="Название задания"]');
  expect(canLeaveParent()).toBe(false);
  await click('Вернуться к уроку');
  expect(document.querySelector('[aria-label="Название задания"]')).toBe(textarea);
  expect((textarea as HTMLTextAreaElement).value).toBe('Новая практика прямо из курса');
  expect(container.querySelector('[data-testid="saved-pin"]')?.textContent).toBe('');
  vi.mocked(window.confirm).mockReturnValue(true);
  await click('Вернуться к уроку');
  expect(guards.size).toBe(0);
  expect(container.querySelector<HTMLInputElement>('[aria-label="Название урока"]')?.value).toBe(
    'Мой несохранённый урок',
  );
});
it('blocks parent navigation and close while the server has not confirmed creation', async () => {
  let complete!: (value: Awaited<ReturnType<typeof api.createActivityDraft>>) => void;
  vi.mocked(api.createActivityDraft).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await mount();
  await readyDraft();
  await click('Создать задание');
  expect(canLeaveParent()).toBe(false);
  expect(document.querySelector('[aria-label="Название задания"]')?.matches(':disabled')).toBe(
    true,
  );
  await click('Вернуться к уроку');
  expect(document.querySelector('[aria-label="Название задания"]')).not.toBeNull();
  expect(window.confirm).not.toHaveBeenCalled();
  await act(async () => {
    complete({
      ok: false,
      status: 503,
      error: { code: 'unavailable', message: 'Сохранение не подтверждено' },
    });
    await flush();
  });
  expect(document.body.textContent).toContain('Сохранение не подтверждено');
  expect(container.querySelector('[data-testid="saved-pin"]')?.textContent).toBe('');
});
it('keeps the authored draft and rejects an unavailable module at insertion even after publication succeeds', async () => {
  await mount();
  await readyDraft();
  vi.mocked(api.listModules).mockResolvedValue({ ok: true, status: 200, data: { items: [] } });
  await click('Опубликовать и добавить в урок');
  expect(document.body.textContent).toContain('Опубликованное задание сейчас недоступно');
  expect(document.querySelector('[aria-label="Название задания"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="saved-pin"]')?.textContent).toBe('');
  expect(parentSubmit).not.toHaveBeenCalled();
  vi.mocked(api.listModules).mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [module] },
  } as never);
  await click('Опубликовать и добавить в урок');
  expect(container.querySelector('[data-testid="saved-pin"]')?.textContent).toBe(versionId);
  expect(api.createActivityDraft).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.publishAuthoredActivity).mock.calls.map((call) => call[2])).toEqual([
    'publish:' + rootId + ':1',
    'publish:' + rootId + ':1',
  ]);
});

it('ignores verification that finishes after the owning lesson is unmounted', async () => {
  await mount();
  await readyDraft();
  await click('Создать задание');
  const previewResult = await api.previewAuthoredActivityVersion(rootId, versionId);
  let complete!: (value: Awaited<ReturnType<typeof api.previewAuthoredActivityVersion>>) => void;
  vi.mocked(api.previewAuthoredActivityVersion).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await click('Опубликовать и добавить в урок');
  expect(canLeaveParent()).toBe(false);
  await act(async () => {
    root?.unmount();
    root = null;
  });
  await act(async () => {
    complete(previewResult);
    await flush();
  });
  expect(pinChange).not.toHaveBeenCalled();
  expect(guards.size).toBe(0);
  expect(container.inert).toBe(false);
});
