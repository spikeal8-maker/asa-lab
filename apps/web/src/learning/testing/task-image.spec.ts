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
