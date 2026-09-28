// @vitest-environment jsdom

import { StrictMode, act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { ClassroomGradingScheme } from '../../components/ClassroomGradingScheme';

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
type SchemeResponse = Awaited<ReturnType<typeof api.classroomGradingScheme>>;

const emptyScheme: SchemeResponse = {
  ok: true,
  status: 200,
  data: { title: null, version: null, bands: [] },
};
const publishedScheme: SchemeResponse = {
  ok: true,
  status: 200,
  data: {
    title: 'Два уровня',
    version: 1,
    bands: [
      { minBasisPoints: 0, label: 'Нужна практика' },
      { minBasisPoints: 7000, label: 'Освоено' },
    ],
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (entry) => entry.textContent?.trim() === label,
  );
  if (!found) throw new Error(`${label} button is missing`);
  return found;
}

function input(container: HTMLElement, label: string): HTMLInputElement {
  const found = [...container.querySelectorAll('input')].find(
    (entry) => entry.closest('label')?.textContent?.trim() === label || entry.ariaLabel === label,
  );
  if (!found) throw new Error(`${label} input is missing`);
  return found;
}

function setInput(element: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(strict = false): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    const form = createElement(ClassroomGradingScheme, { classroomId: 'class-1' });
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

it('keeps a completed scheme draft when an older load resolves, then publishes that draft', async () => {
  const oldLoad = deferred<SchemeResponse>();
  const currentLoad = deferred<SchemeResponse>();
  const get = vi
    .spyOn(api, 'classroomGradingScheme')
    .mockReturnValueOnce(oldLoad.promise)
    .mockReturnValueOnce(currentLoad.promise)
    .mockResolvedValue(publishedScheme);
  const publish = vi.spyOn(api, 'publishGradingScheme').mockResolvedValue({
    ok: true,
    status: 200,
    data: { id: 'scheme-1', version: 1 },
  });

  const form = await render(true);
  expect(get).toHaveBeenCalledTimes(2);
  await act(async () => currentLoad.resolve(emptyScheme));
  await act(async () => setInput(input(form, 'Название шкалы'), 'Два уровня'));
  await act(async () => setInput(input(form, 'Обозначение оценки 1'), 'Нужна практика'));
  await act(async () => setInput(input(form, 'Порог 2, %'), '70'));
  await act(async () => setInput(input(form, 'Обозначение оценки 2'), 'Освоено'));
  expect(button(form, 'Сохранить шкалу для новых заданий').disabled).toBe(false);

  await act(async () => oldLoad.resolve(emptyScheme));
  expect(input(form, 'Название шкалы').value).toBe('Два уровня');
  expect(button(form, 'Сохранить шкалу для новых заданий').disabled).toBe(false);

  await act(async () => button(form, 'Сохранить шкалу для новых заданий').click());
  expect(publish).toHaveBeenCalledWith(
    'class-1',
    'Два уровня',
    [
      { minBasisPoints: 0, label: 'Нужна практика' },
      { minBasisPoints: 7000, label: 'Освоено' },
    ],
    expect.any(String),
  );
  expect(get).toHaveBeenCalledTimes(3);
  expect(form.textContent).toContain('Выбрана шкала «Два уровня», версия 1.');
});

it('reloads on Cancel, but a later edit wins over a delayed Cancel response', async () => {
  const delayedCancel = deferred<SchemeResponse>();
  vi.spyOn(api, 'classroomGradingScheme')
    .mockResolvedValueOnce(publishedScheme)
    .mockReturnValueOnce(delayedCancel.promise)
    .mockResolvedValueOnce(publishedScheme)
    .mockResolvedValueOnce(emptyScheme);
  const form = await render();
  await act(async () => setInput(input(form, 'Название шкалы'), 'Черновик'));
  await act(async () => button(form, 'Отменить').click());
  await act(async () => setInput(input(form, 'Название шкалы'), 'Новая правка'));
  await act(async () => delayedCancel.resolve(publishedScheme));
  expect(input(form, 'Название шкалы').value).toBe('Новая правка');

  await act(async () => button(form, 'Отменить').click());
  expect(input(form, 'Название шкалы').value).toBe('Два уровня');
  expect(input(form, 'Порог 2, %').value).toBe('70');

  await act(async () => button(form, 'Отменить').click());
  expect(input(form, 'Название шкалы').value).toBe('');
  expect(input(form, 'Порог 2, %').value).toBe('');
  expect(input(form, 'Обозначение оценки 1').value).toBe('');
});
