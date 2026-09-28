// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type AuthoredActivityDraft } from '../../api';
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
  it('keeps an omitted teacher goal absent during unrelated edits and sends an explicit clear after goal editing', async () => {
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
});
