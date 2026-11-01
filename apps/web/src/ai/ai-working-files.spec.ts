// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AiWorkingFiles } from './AiWorkingFiles';

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('./ai-scope-api', () => ({ createAiScopeCall: () => api.call }));

it('updates the same file card, retains viewing controls and revokes script execution on a new version', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let head = 1;
  const contents = ['<button>Snake</button>', '<button>Змейка</button>'];
  const metadata = () => ({
    id: 'file',
    name: 'snake.html',
    version: head,
    sourceMessageId: null,
    sourceBlock: null,
  });
  api.call.mockImplementation(async (url: string) => ({
    ok: true,
    data: url.endsWith('/working-files')
      ? { items: [metadata()] }
      : {
          ...metadata(),
          content: contents[head - 1],
          versions: Array.from({ length: head }, (_, i) => ({
            version: i + 1,
            summary: 'Правка',
            createdAt: '',
          })),
        },
  }));
  const onSources = vi.fn();
  const render = (refreshKey: string) =>
    root.render(
      createElement(AiWorkingFiles, { threadId: 'thread', refreshKey, busy: false, onSources }),
    );
  try {
    await act(async () => render('1'));
    const card = host.querySelector('dialog');
    expect(card).not.toBeNull();
    await act(async () =>
      (host.querySelector('[aria-label="Запустить приложение"]') as HTMLButtonElement).click(),
    );
    expect(host.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    head = 2;
    await act(async () => render('2'));
    expect(host.querySelector('dialog')).toBe(card);
    expect(host.querySelector('iframe')?.getAttribute('sandbox')).toBe('');
    expect(
      host.querySelector<HTMLSelectElement>('[aria-label="Версия файла"]')?.options,
    ).toHaveLength(2);
    expect(host.querySelector('[aria-label="Запустить приложение"]')).not.toBeNull();
    expect(onSources).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'file', version: 2 }),
    ]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
