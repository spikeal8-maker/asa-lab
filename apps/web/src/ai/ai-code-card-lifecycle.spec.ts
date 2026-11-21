// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AiMessageContent } from './AiMessageContent';
import { fetchWithSessionRefresh } from '../session-fetch';

vi.mock('../session-fetch', () => ({ fetchWithSessionRefresh: vi.fn() }));

it('clears and aborts artifact image bytes on a scope change and ignores late completion', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const path =
    '/api/ai/threads/11111111-1111-4111-8111-111111111111/web-search/22222222-2222-4222-8222-222222222222/images/1';
  const url = 'https://images.example.org/cat.jpg';
  const evidence = {
    schemaVersion: 1,
    provider: 'searxng',
    mode: 'images',
    status: 'ready',
    query: 'cats',
    retrievedAt: '2026-11-02T00:00:00Z',
    sources: [],
    images: [
      {
        id: 1,
        title: 'Cat',
        thumbnailUrl: path,
        sourceUrl: 'https://example.org/cat',
        originalUrl: url,
      },
    ],
  };
  const pending: ((response: Response) => void)[] = [];
  vi.mocked(fetchWithSessionRefresh).mockImplementation(
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const content = '```html\n<img src="' + url + '">\n```';
  const image = () =>
    new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), {
      headers: { 'content-type': 'image/png' },
    });
  try {
    await act(async () =>
      root.render(
        createElement(AiMessageContent, { content, webSearch: evidence, seatId: 'seat-a' }),
      ),
    );
    const firstSignal = vi.mocked(fetchWithSessionRefresh).mock.calls.at(-1)?.[1]?.signal;
    await act(async () =>
      root.render(
        createElement(AiMessageContent, { content, webSearch: evidence, seatId: 'seat-b' }),
      ),
    );
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => {
      pending[0]!(image());
    });
    expect(host.querySelector('iframe')?.getAttribute('srcdoc')).not.toContain('data:image/png');
    await act(async () => {
      pending[1]!(image());
    });
    expect(host.querySelector('iframe')?.getAttribute('srcdoc')).toContain('data:image/png');
    const count = vi.mocked(fetchWithSessionRefresh).mock.calls.length;
    await act(async () =>
      root.render(
        createElement(AiMessageContent, { content, webSearch: evidence, seatId: 'seat-b' }),
      ),
    );
    expect(vi.mocked(fetchWithSessionRefresh)).toHaveBeenCalledTimes(count);
    await act(async () =>
      root.render(
        createElement(AiMessageContent, { content, webSearch: undefined, seatId: 'seat-b' }),
      ),
    );
    expect(host.querySelector('iframe')?.getAttribute('srcdoc')).not.toContain('data:image/png');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.mocked(fetchWithSessionRefresh).mockReset();
  }
});

it('waits for complete code, then fits the available width without reloading the running frame', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let width = 768;
  let measure: () => void = () => undefined;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        measure = callback;
      }
      observe() {
        measure();
      }
      disconnect() {}
    },
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const content = '```html\n<button onclick="this.textContent=42">Играть</button>\n```';
  try {
    await act(async () => root.render(createElement(AiMessageContent, { content, pending: true })));
    expect(host.querySelector('iframe')).toBeNull();
    await act(async () => root.render(createElement(AiMessageContent, { content })));
    const frame = host.querySelector('iframe');
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts');
    const preview = host.querySelector<HTMLElement>('.asa-ai-code-preview')!;
    expect(preview.style.getPropertyValue('--code-preview-scale')).toBe('0.75');
    await act(async () => {
      width = 512;
      measure();
    });
    expect(preview.style.getPropertyValue('--code-preview-scale')).toBe('0.5');
    expect(host.querySelector('iframe')).toBe(frame);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it('starts automatically, survives chat rerenders and restarts only on request', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const content = '```html\n<button onclick="this.textContent=42">Играть</button>\n```';
  try {
    await act(async () => root.render(createElement(AiMessageContent, { content })));
    const runningFrame = host.querySelector('iframe');
    expect(runningFrame?.getAttribute('sandbox')).toBe('allow-scripts');
    await act(async () => root.render(createElement(AiMessageContent, { content })));
    expect(host.querySelector('iframe')).toBe(runningFrame);
    expect(host.querySelector('[aria-label="Запустить приложение"]')).toBeNull();
    await act(async () =>
      (host.querySelector('[aria-label="Перезапустить приложение"]') as HTMLButtonElement).click(),
    );
    expect(host.querySelector('iframe')).not.toBe(runningFrame);
    await act(async () => (host.querySelector('[aria-label="Код"]') as HTMLButtonElement).click());
    expect(host.querySelector('iframe')).toBeNull();
    await act(async () =>
      (host.querySelector('[aria-label="Просмотр"]') as HTMLButtonElement).click(),
    );
    expect(host.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('opens at 100%, preserves the running frame and restores the inline scale on Escape', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(AiMessageContent, { content: '```html\n<button>Играть</button>\n```' }),
      ),
    );
    const dialog = host.querySelector('dialog')!;
    dialog.showModal = () => {
      dialog.open = true;
    };
    dialog.close = () => {
      dialog.open = false;
    };
    const scale = host.querySelector<HTMLSelectElement>('[aria-label="Масштаб HTML"]')!;
    await act(async () => {
      scale.value = '0.25';
      scale.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const frame = host.querySelector('iframe');
    await act(async () =>
      (host.querySelector('[aria-label="Открыть на всё окно"]') as HTMLButtonElement).click(),
    );
    expect(scale.value).toBe('1');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(host.querySelector('iframe')).toBe(frame);
    await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
    expect(scale.value).toBe('0.25');
    expect(dialog.hasAttribute('aria-modal')).toBe(false);
    expect(host.querySelector('iframe')).toBe(frame);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
