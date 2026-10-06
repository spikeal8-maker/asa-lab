// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type AuthoredActivityDraft, type Classroom, type ModuleSummary } from '../../api';
import { AuthoredMaterialsPage } from '../../pages/AuthoredMaterialsPage';

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
const draftId = '11111111-1111-4111-8111-111111111111';
const publishedId = '22222222-2222-4222-8222-222222222222';

const draft: AuthoredActivityDraft = {
  title: 'Автоматический ночник',
  goal: 'Собрать схему',
  instructions: 'Соберите автоматический ночник.',
  moduleKey: 'electronics',
  resultMode: 'completion',
  maxPoints: null,
  policies: {
    attemptPolicy: { maxAttempts: 1 },
    resultSelectionPolicy: { mode: 'latest_accepted' },
    completionPolicy: { mode: 'accepted' },
    latePolicy: { mode: 'allow_until_close' },
    assessmentPolicy: { mode: 'manual' },
    feedbackReleasePolicy: { mode: 'immediate' },
  },
};

function classroom(): Classroom {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    title: '10А',
    status: 'active',
    ageBand: '16-18',
    topicKeys: ['electronics'],
    safeModeDefault: false,
    studentCount: 2,
    joinCodeVersion: null,
    joinCodeStatus: null,
    joinCode: null,
    teacherRole: 'owner',
    workspaceKind: 'organization',
    workspaceTitle: 'Школа',
    createdAt: '2026-10-05T00:00:00.000Z',
    archivedAt: null,
  };
}

function electronicsModule(): ModuleSummary {
  return {
    moduleKey: 'electronics',
    moduleVersion: '1.0.0',
    displayName: 'Электроника',
    shortDescription: 'Электроника',
    defaultProjectTitlePrefix: 'Проект',
    projectType: 'electronics',
    schemaVersion: 1,
    editorRoute: '/projects/:projectId/electronics',
    viewerRoute: '/view/projects/:versionId/electronics',
    safeModeSupported: true,
    availability: 'active',
    previewKind: 'summary',
    iconKey: 'electronics',
    categories: ['electronics'],
    creatable: true,
    learningCapabilities: {
      assignable: true,
      editableEvidence: true,
      submitProjectVersion: true,
      preview: 'summary',
    },
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function findButton(text: string): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll('button') ?? [])].find((button) =>
    button.textContent?.includes(text),
  );
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

describe('V-UX2A authored assignment list', () => {
  it('keeps ordinary material without a medium unsaved until the server confirms it, then reopens it', async () => {
    const manual = { ...draft, title: 'Краткая теория', moduleKey: null };
    vi.spyOn(api, 'listModules').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [electronicsModule()] },
    });
    vi.spyOn(api, 'authoredActivities')
      .mockResolvedValueOnce({ ok: true, status: 200, data: { items: [] } })
      .mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          items: [
            {
              id: draftId,
              title: manual.title,
              kind: 'manual',
              draftRevision: 1,
              currentPublishedVersionId: null,
            },
          ],
        },
      });
    vi.spyOn(api, 'authoredActivity').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        id: draftId,
        title: manual.title,
        kind: 'manual',
        draftRevision: 1,
        draftSampleImage: null,
        currentPublishedVersionId: null,
        draft: manual,
        inheritedGoal: null,
      },
    });
    let complete!: (result: Awaited<ReturnType<typeof api.createActivityDraft>>) => void;
    const create = vi
      .spyOn(api, 'createActivityDraft')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValue({ ok: true, status: 201, data: { id: draftId, draftRevision: 1 } });

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(AuthoredMaterialsPage, { embedded: true }));
      await flush();
    });
    await act(async () => findButton('Новое задание')?.click());
    const title = container.querySelector<HTMLTextAreaElement>('[aria-label="Название задания"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        title,
        manual.title,
      );
      title?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(findButton('Назначить')?.disabled).toBe(true);
    expect(container.textContent).toContain('Материал можно добавить в курс');
    await act(async () => {
      findButton('Создать задание')?.click();
      await flush();
    });
    expect(container.textContent).toContain('Сохраняем…');
    expect(container.textContent).not.toContain('Сохранено');
    await act(async () => {
      complete({
        ok: false,
        status: 503,
        error: { code: 'unavailable', message: 'Сервер недоступен.' },
      });
      await flush();
    });
    expect(container.textContent).toContain('Сервер недоступен.');
    expect(container.textContent).not.toContain('Сохранено');
    await act(async () => {
      findButton('Создать задание')?.click();
      await flush();
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[1]).toBe(create.mock.calls[1]?.[1]);
    expect(create.mock.calls[1]?.[0].moduleKey).toBeNull();
    expect(container.textContent).toContain('Сохранено');
    await act(async () => findButton('← Задания')?.click());
    await act(async () => {
      findButton(manual.title)?.click();
      await flush();
    });
    expect(title?.value).toBe(manual.title);
    expect(findButton('Назначить')?.disabled).toBe(true);
  });

  it('does not show saved after the text succeeds but the draft sample upload fails', async () => {
    vi.spyOn(api, 'authoredActivities').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [
          {
            id: draftId,
            title: draft.title,
            kind: 'project',
            draftRevision: 3,
            currentPublishedVersionId: null,
          },
        ],
      },
    });
    vi.spyOn(api, 'authoredActivity').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        id: draftId,
        title: draft.title,
        kind: 'project',
        draftRevision: 3,
        draftSampleImage: null,
        currentPublishedVersionId: null,
        draft,
        inheritedGoal: null,
      },
    });
    vi.spyOn(api, 'listModules').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [electronicsModule()] },
    });
    vi.spyOn(api, 'saveAuthoredActivity').mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: draftId, draftRevision: 4 },
    });
    const sample = vi
      .spyOn(api, 'saveAuthoredActivityDraftSample')
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        error: { code: 'unavailable', message: 'Образец не загрузился.' },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { draftRevision: 5, contentHash: 'a'.repeat(64), url: '/sample.png' },
      });

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(AuthoredMaterialsPage, { embedded: true }));
      await flush();
    });
    await act(async () => {
      findButton(draft.title)?.click();
      await flush();
    });
    const title = container.querySelector<HTMLTextAreaElement>('[aria-label="Название задания"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        title,
        'Новая редакция',
      );
      title?.dispatchEvent(new Event('input', { bubbles: true }));
      findButton('+ Добавить содержимое')?.click();
    });
    const file = container.querySelector<HTMLInputElement>(
      '[aria-label="Файл схемы или изображения"]',
    );
    await act(async () => {
      Object.defineProperty(file, 'files', {
        configurable: true,
        value: [new File(['image'], 'sample.png', { type: 'image/png' })],
      });
      file?.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      await flush();
    });
    await act(async () => {
      findButton('Сохранить')?.click();
      await flush();
    });
    expect(sample).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Образец не загрузился.');
    expect(container.textContent).not.toContain('Сохранено');
    await act(async () => {
      findButton('Сохранить')?.click();
      await flush();
    });
    expect(sample).toHaveBeenCalledTimes(2);
    expect(sample.mock.calls[1]?.[1]).toBe(4);
    expect(container.textContent).toContain('Сохранено');
  });

  it('shows a compact list first and filters only by canonical list data', async () => {
    const listModules = vi.spyOn(api, 'listModules');
    vi.spyOn(api, 'authoredActivities').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [
          {
            id: draftId,
            title: 'Автоматический ночник',
            kind: 'project',
            draftRevision: 3,
            currentPublishedVersionId: null,
          },
          {
            id: publishedId,
            title: 'Светофор',
            kind: 'project',
            draftRevision: 7,
            currentPublishedVersionId: '33333333-3333-4333-8333-333333333333',
          },
        ],
      },
    });

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(AuthoredMaterialsPage, { embedded: true }));
      await flush();
    });

    expect(container.querySelector('form')).toBeNull();
    expect(findButton('Новое задание')).toBeDefined();
    expect(container.textContent).toContain('Автоматический ночник');
    expect(container.textContent).toContain('Светофор');
    expect(container.textContent).toContain('Черновик');
    expect(container.textContent).toContain('Опубликовано');
    expect(listModules).not.toHaveBeenCalled();

    const publishedFilter = findButton('Опубликованные');
    expect(publishedFilter).toBeDefined();
    expect(publishedFilter?.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      publishedFilter?.click();
    });

    expect(publishedFilter?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).not.toContain('Автоматический ночник');
    expect(container.textContent).toContain('Светофор');

    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(search, 'нет такого задания');
      search?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('Ничего не найдено');
  });

  it('opens the existing editor as a separate state and returns to the list', async () => {
    vi.spyOn(api, 'authoredActivities').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [
          {
            id: draftId,
            title: draft.title,
            kind: 'project',
            draftRevision: 3,
            currentPublishedVersionId: null,
          },
        ],
      },
    });
    vi.spyOn(api, 'authoredActivity').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        id: draftId,
        title: draft.title,
        draftRevision: 3,
        draftSampleImage: null,
        currentPublishedVersionId: null,
        draft,
        inheritedGoal: null,
      },
    });
    vi.spyOn(api, 'listModules').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [electronicsModule()] },
    });
    vi.spyOn(api, 'authorVersions').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(AuthoredMaterialsPage, { embedded: true }));
      await flush();
    });

    await act(async () => {
      findButton('Автоматический ночник')?.click();
      await flush();
    });

    expect(container.querySelector('form.assignment-document-form')).not.toBeNull();
    expect(container.querySelector('.assignment-document-canvas')).not.toBeNull();
    expect(container.querySelector('aside[aria-label="Библиотека материалов"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Поиск материалов"]')).toBeNull();
    expect(findButton('Новый материал')).toBeUndefined();
    expect(container.querySelector('[aria-label="Название задания"]')).not.toBeNull();
    expect(findButton('Предпросмотр')).toBeDefined();
    expect(findButton('Настройки')).toBeDefined();
    expect(findButton('Назначить')).toBeDefined();
    expect(findButton('← Задания')).toBeDefined();

    await act(async () => {
      findButton('← Задания')?.click();
      await flush();
    });

    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toContain('Автоматический ночник');
  });

  it('retries only the failed classroom after partial assignment', async () => {
    const activityVersionId = '33333333-3333-4333-8333-333333333333';
    vi.spyOn(api, 'authoredActivities').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [
          {
            id: draftId,
            title: draft.title,
            kind: 'project',
            draftRevision: 3,
            currentPublishedVersionId: activityVersionId,
          },
        ],
      },
    });
    vi.spyOn(api, 'authoredActivity').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        id: draftId,
        title: draft.title,
        draftRevision: 3,
        draftSampleImage: null,
        currentPublishedVersionId: activityVersionId,
        draft,
        inheritedGoal: null,
      },
    });
    vi.spyOn(api, 'listModules').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [electronicsModule()] },
    });
    vi.spyOn(api, 'authorVersions').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    vi.spyOn(api, 'listClassrooms').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [
          classroom(),
          { ...classroom(), id: '88888888-8888-4888-8888-888888888888', title: '10Б' },
        ],
        meta: { total: 2 },
      },
    });
    const success = {
      ok: true,
      status: 201,
      data: {
        assignmentId: '55555555-5555-4555-8555-555555555555',
        activityRunId: '66666666-6666-4666-8666-666666666666',
        audienceId: '77777777-7777-4777-8777-777777777777',
        assignedCount: 2,
        reused: false,
      },
    } as const;
    const assign = vi
      .spyOn(api, 'assignLearningActivity')
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        error: { code: 'temporarily_unavailable', message: 'Повторите попытку.' },
      })
      .mockResolvedValueOnce(success);

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(AuthoredMaterialsPage, { embedded: true }));
      await flush();
    });

    await act(async () => {
      findButton('Автоматический ночник')?.click();
      await flush();
    });

    await act(async () => {
      findButton('Назначить')?.click();
      await flush();
      await flush();
    });

    const modal = container.querySelector<HTMLElement>('.teacher-assign-dialog');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('10А');
    expect(modal?.textContent).toContain('10Б');
    expect(modal?.textContent).toContain('2 учеников');

    const classroomCheckboxes = modal?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(classroomCheckboxes?.length).toBe(2);
    await act(async () => {
      const date = modal?.querySelector<HTMLInputElement>('input[type="date"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        date,
        '2026-10-15',
      );
      date?.dispatchEvent(new Event('input', { bubbles: true }));
      date?.dispatchEvent(new Event('change', { bubbles: true }));
      classroomCheckboxes?.[0]?.click();
      classroomCheckboxes?.[1]?.click();
      await flush();
    });

    const modalAssign = [...(modal?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent?.trim() === 'Назначить',
    );
    expect(modalAssign).toBeDefined();
    await act(async () => {
      modalAssign?.click();
      await flush();
      await flush();
    });

    expect(assign).toHaveBeenCalledWith(
      classroom().id,
      expect.objectContaining({
        activityVersionId,
        audienceType: 'whole_class',
        seatIds: [],
        dueAt: expect.any(String),
        requestId: expect.any(String),
      }),
    );
    expect(container.querySelector('.teacher-assign-dialog')).not.toBeNull();
    expect(modal?.textContent).toContain('Назначено в 1 из 2 классов');
    expect(classroomCheckboxes?.[0]?.disabled).toBe(true);
    expect(modal?.querySelector<HTMLInputElement>('input[type="date"]')?.disabled).toBe(true);
    await act(async () => {
      modalAssign?.click();
      await flush();
      await flush();
    });
    expect(assign).toHaveBeenCalledTimes(3);
    expect(assign.mock.calls[2]?.[0]).toBe('88888888-8888-4888-8888-888888888888');
    expect(assign.mock.calls[2]?.[1].requestId).toBe(assign.mock.calls[1]?.[1].requestId);
    expect(assign.mock.calls[2]?.[1].dueAt).toBe(assign.mock.calls[1]?.[1].dueAt);
    expect(container.querySelector('.teacher-assign-dialog')).toBeNull();
    expect(container.textContent).toContain('Задание назначено в классы: 2. Учеников: 4.');
  });
});
