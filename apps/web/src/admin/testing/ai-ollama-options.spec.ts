// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminOllamaPage } from '../AdminOllamaPage';
import { call } from '../admin-api';
vi.mock('../admin-api', () => ({ call: vi.fn() }));
let root: Root, host: HTMLDivElement;
const config = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen:27b',
  revision: 4,
  updatedAt: null,
  thinking: 'default',
  contextTokens: 65536,
};
const denied = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(call).mockImplementation(async (path, init) => {
    const input = JSON.parse(String(init?.body ?? '{}'));
    const data = path.endsWith('/models')
      ? {
          models: [
            { name: 'qwen:27b', size: 17000000000 },
            { name: 'gemma:26b', size: 16000000000 },
          ],
        }
      : path.endsWith('/model-detail')
        ? {
            thinking:
              input.model === 'gemma:26b'
                ? { values: [false, true], default: true }
                : { values: [false, 'low', 'medium', 'xhigh'], default: 'medium' },
            contextMax: 131072,
          }
        : path.endsWith('/apply')
          ? {
              config: { ...config, ...input, revision: 5 },
              verified: true,
              test: { model: input.model, elapsedMs: 10, testedAt: '' },
            }
          : config;
    return { ok: true, status: 200, data } as never;
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function render() {
  await act(async () => root.render(createElement(AdminOllamaPage, { onAccessDenied: denied })));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
}
it('discovers per-model modes inside the selected card and saves manual context and reasoning together', async () => {
  await render();
  const select = host.querySelector<HTMLSelectElement>(
    'select[aria-label="Режим размышления Ollama"]',
  )!;
  expect(Array.from(select.options).map((v) => v.value)).toEqual([
    'default',
    'off',
    'low',
    'medium',
    'xhigh',
  ]);
  expect(select.closest('.asa-ai-ollama-model-card')?.textContent).toContain('qwen:27b');
  await act(async () => {
    select.value = 'xhigh';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const context = host.querySelector<HTMLInputElement>('input[aria-label="Контекст Ollama"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      context,
      '98304',
    );
    context.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  const applied = vi.mocked(call).mock.calls.find(([path]) => path.endsWith('/apply'))!;
  expect(JSON.parse(String(applied[1]?.body))).toMatchObject({
    thinking: 'xhigh',
    contextTokens: 98304,
    revision: 4,
  });
  expect(host.textContent).toContain('Сохранено');
});
it('resets a Qwen-only choice when switching to a boolean-thinking model', async () => {
  await render();
  const select = host.querySelector('select')!;
  await act(async () => {
    select.value = 'xhigh';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const gemma = Array.from(host.querySelectorAll('button')).find((v) =>
    v.textContent?.includes('gemma:26b'),
  )!;
  await act(async () => gemma.click());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  const next = host.querySelector('select')!;
  expect(next.value).toBe('default');
  expect(Array.from(next.options).map((v) => v.value)).toEqual(['default', 'off', 'on']);
});
