// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type AuthoredActivityDraft, type ModuleSummary } from '../../api';
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

    const status = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Фильтр по статусу"]',
    );
    expect(status).not.toBeNull();
    await act(async () => {
      status!.value = 'published';
      status!.dispatchEvent(new Event('change', { bubbles: true }));
    });

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

    expect(container.querySelector('form')).not.toBeNull();
    expect(container.querySelector('.course-editor-grid')?.classList.contains('authored-editor-single')).toBe(
      true,
    );
    expect(
      container.querySelector<HTMLElement>('aside[aria-label="Библиотека материалов"]')?.hidden,
    ).toBe(true);
    expect(findButton('← Задания')).toBeDefined();

    await act(async () => {
      findButton('← Задания')?.click();
      await flush();
    });

    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toContain('Автоматический ночник');
  });
});
