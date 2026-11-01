// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AiMessageContent } from './AiMessageContent';

it('keeps a running preview through chat rerenders and replaces it only on restart or stop', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const content = '```html\n<button onclick="this.textContent=42">Играть</button>\n```';
  try {
    await act(async () => root.render(createElement(AiMessageContent, { content })));
    await act(async () =>
      (host.querySelector('[aria-label="Запустить приложение"]') as HTMLButtonElement).click(),
    );
    const runningFrame = host.querySelector('iframe');
    expect(runningFrame?.getAttribute('sandbox')).toBe('allow-scripts');
    await act(async () => root.render(createElement(AiMessageContent, { content })));
    expect(host.querySelector('iframe')).toBe(runningFrame);
    expect(host.querySelector('[aria-label="Остановить приложение"]')).not.toBeNull();
    await act(async () =>
      (host.querySelector('[aria-label="Перезапустить приложение"]') as HTMLButtonElement).click(),
    );
    expect(host.querySelector('iframe')).not.toBe(runningFrame);
    await act(async () =>
      (host.querySelector('[aria-label="Остановить приложение"]') as HTMLButtonElement).click(),
    );
    expect(host.querySelector('iframe')?.getAttribute('sandbox')).toBe('');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
