// @vitest-environment jsdom

import { StrictMode, act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type LearningNotificationPreferences as Preferences } from '../../api';
import { LearningNotificationPreferences } from '../../components/LearningNotificationPreferences';

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
type Response = Awaited<ReturnType<typeof api.learningNotificationPreferences>>;

const preferences: Preferences = {
  revision: 0,
  masterEnabled: true,
  categories: {
    NC01: true,
    NC02: true,
    NC03: true,
    NC04: true,
    NC05: true,
    NC06: true,
    NC08: true,
  },
  classOverrides: {},
  classes: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function categoryCheckbox(container: HTMLElement) {
  const label = [...container.querySelectorAll('label')].find((entry) =>
    entry.textContent?.includes('Работы на проверку'),
  );
  const checkbox = label?.querySelector('input[type="checkbox"]');
  if (!(checkbox instanceof HTMLInputElement)) throw new Error('NC02 checkbox is missing');
  return checkbox;
}

function button(container: HTMLElement, text: string) {
  const match = [...container.querySelectorAll('button')].find((entry) =>
    entry.textContent?.includes(text),
  );
  if (!match) throw new Error(`${text} button is missing`);
  return match;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(strict = false) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    const form = createElement(LearningNotificationPreferences);
    root?.render(strict ? createElement(StrictMode, null, form) : form);
  });
  return container;
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

describe('learning notification preference loading', () => {
  it('keeps NC02 unchecked when an older duplicate GET resolves after the edit', async () => {
    const oldGet = deferred<Response>();
    const newGet = deferred<Response>();
    const get = vi
      .spyOn(api, 'learningNotificationPreferences')
      .mockReturnValueOnce(oldGet.promise)
      .mockReturnValueOnce(newGet.promise);
    const save = vi
      .spyOn(api, 'saveLearningNotificationPreferences')
      .mockImplementation(async (input) => ({
        ok: true,
        status: 200,
        data: { ...preferences, revision: 1, categories: input.categories },
      }));

    const form = await render(true);
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => newGet.resolve({ ok: true, status: 200, data: preferences }));
    await act(async () => categoryCheckbox(form).click());
    expect(categoryCheckbox(form).checked).toBe(false);

    await act(async () => oldGet.resolve({ ok: true, status: 200, data: preferences }));
    expect(categoryCheckbox(form).checked).toBe(false);
    await act(async () => button(form, 'Сохранить оповещения').click());

    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0].categories.NC02).toBe(false);
    expect(form.textContent).toContain('Настройки сохранены.');
  });

  it('allows explicit refresh but does not replace a newer edit with its delayed result', async () => {
    const delayedGet = deferred<Response>();
    vi.spyOn(api, 'learningNotificationPreferences')
      .mockResolvedValueOnce({ ok: true, status: 200, data: preferences })
      .mockReturnValueOnce(delayedGet.promise);
    const save = vi
      .spyOn(api, 'saveLearningNotificationPreferences')
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        error: { code: 'unavailable', message: 'Попробуйте ещё раз' },
      })
      .mockImplementationOnce(async (input) => ({
        ok: true,
        status: 200,
        data: { ...preferences, revision: 1, categories: input.categories },
      }));

    const form = await render();
    await act(async () => button(form, 'Сохранить оповещения').click());
    await act(async () => button(form, 'Обновить форму').click());
    await act(async () => categoryCheckbox(form).click());
    await act(async () => delayedGet.resolve({ ok: true, status: 200, data: preferences }));

    expect(categoryCheckbox(form).checked).toBe(false);
    await act(async () => button(form, 'Сохранить оповещения').click());
    expect(save.mock.calls[1]?.[0].categories.NC02).toBe(false);
  });

  it('applies an explicit refresh when no edit follows it', async () => {
    vi.spyOn(api, 'learningNotificationPreferences')
      .mockResolvedValueOnce({ ok: true, status: 200, data: preferences })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          ...preferences,
          revision: 1,
          categories: { ...preferences.categories, NC02: false },
        },
      });
    vi.spyOn(api, 'saveLearningNotificationPreferences').mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: { code: 'unavailable', message: 'Попробуйте ещё раз' },
    });

    const form = await render();
    await act(async () => button(form, 'Сохранить оповещения').click());
    await act(async () => button(form, 'Обновить форму').click());
    expect(categoryCheckbox(form).checked).toBe(false);
    expect(form.textContent).not.toContain('Попробуйте ещё раз');
  });
});
