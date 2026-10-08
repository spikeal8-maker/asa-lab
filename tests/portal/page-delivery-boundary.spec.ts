// @vitest-environment jsdom
import { act, createElement, lazy } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageDeliveryBoundary } from '../../apps/web/src/components/PageDeliveryBoundary';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('selected page delivery lifecycle', () => {
  it('retains the branded pending frame and replaces it with the unchanged resolved page', async () => {
    let resolve!: (module: { default: () => React.ReactElement }) => void;
    const pending = new Promise<{ default: () => React.ReactElement }>((done) => {
      resolve = done;
    });
    const Page = lazy(() => pending);
    await act(async () =>
      root.render(
        createElement(PageDeliveryBoundary, {
          label: 'Открываем приглашение',
          backLabel: 'На главную',
          onBack: () => undefined,
          children: createElement(Page),
        }),
      ),
    );
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(
      'Открываем приглашение',
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/asa-lab-mark.svg');
    await act(async () =>
      resolve({
        default: () => createElement('main', { 'data-original-page': true }, 'Содержимое страницы'),
      }),
    );
    expect(container.querySelector('[data-original-page]')?.textContent).toBe(
      'Содержимое страницы',
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('gives a failed import an honest exit, hides exception data and resets on a new route key', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onBack = vi.fn();
    const Page = lazy(async () => {
      throw new Error('Private exception https://example.invalid/chunk.js?token=secret');
    });
    await act(async () =>
      root.render(
        createElement(PageDeliveryBoundary, {
          key: 'old-invitation',
          label: 'Открываем приглашение',
          backLabel: 'Вернуться к классам',
          onBack,
          embedded: true,
          children: createElement(Page),
        }),
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Страница не загрузилась',
    );
    expect(container.textContent).not.toContain('Private exception');
    expect(container.textContent).not.toContain('token=secret');
    await act(async () => (container.querySelector('button') as HTMLButtonElement).click());
    expect(onBack).toHaveBeenCalledTimes(1);
    await act(async () =>
      root.render(
        createElement(PageDeliveryBoundary, {
          key: 'new-invitation',
          label: 'Открываем приглашение',
          backLabel: 'На главную',
          onBack,
          children: createElement('main', {}, 'Следующее приглашение'),
        }),
      ),
    );
    expect(container.textContent).toBe('Следующее приглашение');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
