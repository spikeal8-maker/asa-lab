// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type AuthoredActivityDraft, type ModuleSummary } from '../../api';
import { AuthoredMaterialsPage } from '../../pages/AuthoredMaterialsPage';

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
const activityId = '11111111-1111-4111-8111-111111111111';
const legacyDraft: AuthoredActivityDraft = {
  title: 'Legacy teacher material',
  instructions: 'Build the circuit',
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

function module(moduleKey: string, assignable: boolean): ModuleSummary {
  return {
    moduleKey,
    moduleVersion: '1.0.0',
    displayName: moduleKey === 'new-lab' ? 'Новая лаборатория' : moduleKey,
    shortDescription: 'Test laboratory',
    defaultProjectTitlePrefix: 'Project',
    projectType: 'test',
    schemaVersion: 1,
    editorRoute: '/projects/:projectId/test',
    viewerRoute: '/view/projects/:versionId/test',
    safeModeSupported: true,
    availability: 'active',
    previewKind: 'summary',
    iconKey: 'test',
    categories: ['test'],
    creatable: true,
    learningCapabilities: {
      assignable,
      editableEvidence: assignable,
      submitProjectVersion: assignable,
      preview: assignable ? 'summary' : 'none',
    },
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
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

describe('authored material legacy goal', () => {
  it('keeps an existing draft usable but blocks creation and publication with a legacy module catalogue', async () => {
    const legacyModule = module('electronics', true);
    delete legacyModule.learningCapabilities;
    vi.spyOn(api, 'listModules').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [legacyModule] },
    });
    vi.spyOn(api, 'authoredActivities').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [
          {
            id: activityId,
            title: legacyDraft.title,
            kind: 'project',
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
        id: activityId,
        title: legacyDraft.title,
        draftRevision: 1,
        draftSampleImage: null,
        currentPublishedVersionId: null,
        draft: legacyDraft,
        inheritedGoal: null,
      },
    });
    vi.spyOn(api, 'authorVersions').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    const save = vi.spyOn(api, 'saveAuthoredActivity').mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: activityId, draftRevision: 2 },
    });
    const create = vi.spyOn(api, 'createActivityDraft');
    const publish = vi.spyOn(api, 'publishAuthoredActivity');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(AuthoredMaterialsPage));
      await flush();
    });
    const findButton = (label: string) =>
      [...container!.querySelectorAll('button')].find((button) => button.textContent === label);
    const title = container.querySelector<HTMLInputElement>('input[maxlength="255"]');
    await act(async () => setInput(title!, 'New material'));
    expect(findButton('Создать материал')?.disabled).toBe(true);
    expect(findButton('Опубликовать')?.disabled).toBe(true);
    await act(async () => {
      container
        ?.querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(create).not.toHaveBeenCalled();

    await act(async () => {
      findButton(legacyDraft.title)?.click();
      await flush();
    });
    expect(container.querySelector<HTMLInputElement>('input[maxlength="255"]')?.value).toBe(
      legacyDraft.title,
    );
    expect(findButton('Опубликовать')?.disabled).toBe(true);
    const instructions = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Содержание"]',
    );
    await act(async () => setInput(instructions!, 'Updated circuit instructions'));
    expect(findButton('Сохранить')?.disabled).toBe(false);
    await act(async () => {
      container
        ?.querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(save).toHaveBeenCalledWith(
      activityId,
      1,
      expect.objectContaining({ instructions: 'Updated circuit instructions' }),
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes an existing manual material without an editor when the catalogue lacks capabilities', async () => {
    const legacyModule = module('electronics', true);
    delete legacyModule.learningCapabilities;
    vi.spyOn(api, 'listModules').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [legacyModule] },
    });
    vi.spyOn(api, 'authoredActivities').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [
          {
            id: activityId,
            title: 'Manual handout',
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
        id: activityId,
        title: 'Manual handout',
        draftRevision: 1,
        draftSampleImage: null,
        currentPublishedVersionId: null,
        draft: { ...legacyDraft, title: 'Manual handout', moduleKey: null },
        inheritedGoal: null,
      },
    });
    vi.spyOn(api, 'authorVersions').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    const save = vi.spyOn(api, 'saveAuthoredActivity');
    const create = vi.spyOn(api, 'createActivityDraft');
    const publish = vi.spyOn(api, 'publishAuthoredActivity').mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: activityId, versionNumber: 1, contentDigest: 'test', reused: false },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(AuthoredMaterialsPage));
      await flush();
    });
    const findButton = (label: string) =>
      [...container!.querySelectorAll('button')].find((button) => button.textContent === label);
    expect(findButton('Опубликовать')?.disabled).toBe(true);
    await act(async () => {
      findButton('Manual handout')?.click();
      await flush();
    });
    expect(findButton('Опубликовать')?.disabled).toBe(false);
    await act(async () => {
      findButton('Опубликовать')?.click();
      await flush();
    });
    expect(publish).toHaveBeenCalledWith(activityId, 1, `publish:${activityId}:1`);
    expect(save).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the default module when catalogue loading overlaps author typing', async () => {
    let resolveModules: (result: Awaited<ReturnType<typeof api.listModules>>) => void = () => {};
    vi.spyOn(api, 'listModules').mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<typeof api.listModules>>>((resolve) => {
          resolveModules = resolve;
        }),
    );
    vi.spyOn(api, 'authoredActivities').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    const create = vi.spyOn(api, 'createActivityDraft').mockResolvedValue({
      ok: true,
      status: 201,
      data: { id: activityId, draftRevision: 1 },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(AuthoredMaterialsPage));
      await flush();
    });
    const title = container.querySelector<HTMLInputElement>('input[maxlength="255"]');
    const instructions = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Содержание"]',
    );
    expect(title).not.toBeNull();
    expect(instructions).not.toBeNull();
    await act(async () => setInput(title!, 'Circuit lesson'));
    await act(async () => {
      resolveModules({
        ok: true,
        status: 200,
        data: { items: [module('three-d', true), module('electronics', true)] },
      });
      await Promise.resolve();
      setInput(instructions!, 'Build and explain the circuit');
      await flush();
    });
    const chooser = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Среда проекта'))
      ?.querySelector('select');
    const createButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Создать материал',
    );
    expect(chooser?.value).toBe('electronics');
    expect(createButton?.disabled).toBe(false);
    await act(async () => {
      createButton?.click();
      await flush();
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Circuit lesson',
        instructions: 'Build and explain the circuit',
        moduleKey: 'electronics',
      }),
      expect.any(String),
    );
  });

  it('reloads the module catalogue after a transient failure without a page reload', async () => {
    const listModules = vi.spyOn(api, 'listModules');
    listModules
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        error: { code: 'unavailable', message: 'Список учебных сред недоступен.' },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { items: [module('electronics', true)] },
      });
    vi.spyOn(api, 'authoredActivities').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(AuthoredMaterialsPage));
      await flush();
    });
    const chooser = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Среда проекта'))
      ?.querySelector('select');
    expect(chooser?.disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Список учебных сред недоступен.',
    );
    await act(async () => {
      [...container!.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('Повторить чтение'))
        ?.click();
      await flush();
    });
    expect(listModules).toHaveBeenCalledTimes(2);
    expect(chooser?.disabled).toBe(false);
    expect(chooser?.value).toBe('electronics');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('starts new material in Electronics even when another assignable module comes first', async () => {
    vi.spyOn(api, 'listModules').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [module('three-d', true), module('electronics', true)] },
    });
    vi.spyOn(api, 'authoredActivities').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(AuthoredMaterialsPage));
      await flush();
    });
    const chooser = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Среда проекта'))
      ?.querySelector('select');
    expect(chooser?.value).toBe('electronics');
    expect([...chooser!.options].map((option) => option.value)).toEqual(['three-d', 'electronics']);
    await act(async () => {
      chooser!.value = 'three-d';
      chooser!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(chooser?.value).toBe('three-d');
    await act(async () => {
      [...container!.querySelectorAll('button')]
        .find((button) => button.textContent === 'Новый материал')
        ?.click();
    });
    expect(chooser?.value).toBe('electronics');
  });

  it('keeps an omitted teacher goal absent during unrelated edits and sends an explicit clear after goal editing', async () => {
    vi.spyOn(api, 'listModules').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    vi.spyOn(api, 'authoredActivities').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [
          {
            id: activityId,
            title: legacyDraft.title,
            kind: 'project',
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
        id: activityId,
        title: legacyDraft.title,
        draftRevision: 1,
        draftSampleImage: null,
        currentPublishedVersionId: null,
        draft: legacyDraft,
        inheritedGoal: 'Inherited teacher goal',
      },
    });
    vi.spyOn(api, 'authorVersions').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    const save = vi.spyOn(api, 'saveAuthoredActivity');
    save
      .mockResolvedValueOnce({ ok: true, status: 200, data: { id: activityId, draftRevision: 2 } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { id: activityId, draftRevision: 3 } });

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(AuthoredMaterialsPage));
      await flush();
    });
    const openButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === legacyDraft.title,
    );
    expect(openButton).toBeDefined();
    await act(async () => {
      openButton?.click();
      await flush();
    });
    const goal = container.querySelector<HTMLInputElement>('input[aria-label="Цель задания"]');
    expect(goal?.value).toBe('Inherited teacher goal');

    const instructions = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Содержание"]',
    );
    expect(instructions).not.toBeNull();
    await act(async () => setInput(instructions!, 'Explain the circuit'));
    await act(async () => {
      container
        ?.querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[2]).toMatchObject({ instructions: 'Explain the circuit' });
    expect(save.mock.calls[0]?.[2]).not.toHaveProperty('goal');
    expect(goal?.value).toBe('Inherited teacher goal');

    const clear = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Очистить цель задания'),
    );
    expect(clear).toBeDefined();
    await act(async () => clear?.click());
    expect(goal?.value).toBe('');
    await act(async () => {
      container
        ?.querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[2]).toHaveProperty('goal', null);
  });

  it('falls back to the first assignable future laboratory when Electronics is absent', async () => {
    vi.spyOn(api, 'listModules').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [module('blocks', false), module('new-lab', true), module('other-lab', true)],
      },
    });
    vi.spyOn(api, 'authoredActivities').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [
          {
            id: activityId,
            title: 'Новая работа',
            kind: 'project',
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
        id: activityId,
        title: 'Новая работа',
        draftRevision: 1,
        draftSampleImage: null,
        currentPublishedVersionId: null,
        draft: { ...legacyDraft, title: 'Новая работа', moduleKey: 'new-lab', goal: null },
        inheritedGoal: null,
      },
    });
    vi.spyOn(api, 'authorVersions').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    vi.spyOn(api, 'previewAuthoredActivityDraft').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        source: {
          kind: 'draft',
          id: activityId,
          draftRevision: 1,
          versionNumber: null,
          contentDigest: 'test',
        },
        assignment: {
          title: 'Новая работа',
          goal: null,
          blocks: [],
          brief: null,
          sampleImage: null,
        },
        moduleKey: 'new-lab',
        resultMode: 'completion',
        maxPoints: null,
        policies: legacyDraft.policies,
        learnerRuntime: false,
      },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(AuthoredMaterialsPage));
      await flush();
    });
    const chooser = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Среда проекта'))
      ?.querySelector('select');
    expect(chooser?.value).toBe('new-lab');
    expect([...chooser!.options].map((option) => option.textContent)).toEqual([
      'Новая лаборатория',
      'other-lab',
    ]);
    const item = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Новая работа',
    );
    await act(async () => {
      item?.click();
      await flush();
    });
    const preview = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Как ученик: сохранённый черновик'),
    );
    await act(async () => {
      preview?.click();
      await flush();
    });
    expect(container.querySelector('[data-testid="learner-preview"]')?.textContent).toContain(
      'Новая лаборатория',
    );
  });
});
