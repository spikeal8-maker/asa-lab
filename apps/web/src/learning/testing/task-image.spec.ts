// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskBlocks } from '../../components/TaskBlocks';

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('ordered task image block', () => {
  it('zooms and pins the same immutable image inside the page', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hash = 'b'.repeat(64);
    const src = `/api/assignments/task-images/${hash}`;
    await act(async () => {
      root?.render(
        createElement(TaskBlocks, {
          blocks: [{ type: 'image', alt: 'Exact circuit', contentHash: hash }],
        }),
      );
    });
    const zoomButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Открыть крупно: Exact circuit"]',
    );
    await act(async () => zoomButton?.click());
    const zoom = document.body.querySelector('[role="dialog"][aria-modal="true"]');
    expect(zoom?.querySelector('img')?.getAttribute('src')).toBe(src);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(document.body.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    expect(document.activeElement).toBe(zoomButton);
    await act(async () =>
      container
        ?.querySelector<HTMLButtonElement>(
          'button[aria-label="Закрепить изображение: Exact circuit"]',
        )
        ?.click(),
    );
    const reference = document.body.querySelector('[data-testid="task-image-reference-window"]');
    expect(reference?.querySelector('img')?.getAttribute('src')).toBe(src);
    expect(reference?.querySelector('img')?.getAttribute('alt')).toBe('Exact circuit');
    await act(async () =>
      reference
        ?.querySelector<HTMLButtonElement>('button[aria-label="Закрыть окно: Изображение задания"]')
        ?.click(),
    );
    expect(document.body.querySelector('[data-testid="task-image-reference-window"]')).toBeNull();
  });

  it('renders the pinned learner URL in order and shows an explicit unavailable error', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hash = 'a'.repeat(64);
    await act(async () => {
      root?.render(
        createElement(TaskBlocks, {
          blocks: [
            { type: 'paragraph', text: 'Before image' },
            { type: 'image', alt: 'Circuit diagram', contentHash: hash },
            { type: 'paragraph', text: 'After image' },
          ],
        }),
      );
    });
    const html = container.innerHTML;
    expect(html.indexOf('Before image')).toBeLessThan(html.indexOf('Circuit diagram'));
    expect(html.indexOf('Circuit diagram')).toBeLessThan(html.indexOf('After image'));
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe(`/api/assignments/task-images/${hash}`);
    await act(async () => image?.dispatchEvent(new Event('error')));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Изображение задания недоступно',
    );
  });
});
