// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AiWorkingFiles } from './AiWorkingFiles';
import { downloadBlob } from './ai-download';

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('./ai-scope-api', () => ({ createAiScopeCall: () => api.call }));
vi.mock('./ai-download', async (original) => ({
  ...(await original<typeof import('./ai-download')>()),
  downloadBlob: vi.fn(),
}));

it('refreshes the same file on image completion without another message and retains isolated viewing controls', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const mount = document.createElement('div');
  const anchor = document.createElement('div');
  host.append(mount, anchor);
  const root = createRoot(mount);
  const messages = [{ id: 'message', requestId: 'request', role: 'assistant' }];
  const targets = { message: anchor };
  let head = 1;
  const contents = ['<button>Snake</button>', '<button>Змейка</button>'];
  const metadata = () => ({
    id: 'file',
    name: 'snake.html',
    anchorRequestId: 'request',
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
  const render = (refreshKey: string, latestRequestId = 'request') =>
    root.render(
      createElement(AiWorkingFiles, {
        threadId: 'thread',
        refreshKey,
        busy: false,
        onSources,
        messages,
        targets,
        latestRequestId,
      }),
    );
  try {
    await act(async () => render('1:false:image:running'));
    const card = host.querySelector('dialog');
    expect(card).not.toBeNull();
    expect(anchor.contains(card)).toBe(true);
    expect(mount.querySelector('dialog')).toBeNull();
    expect(host.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    head = 2;
    // Native image completion enriches the existing acknowledgement: no new history row.
    await act(async () => render('1:false:image:complete'));
    expect(host.querySelector('dialog')).toBe(card);
    expect(host.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(host.querySelector('iframe')?.getAttribute('srcdoc')).toContain('Змейка');
    expect(
      host.querySelector<HTMLSelectElement>('[aria-label="Версия файла"]')?.options,
    ).toHaveLength(2);
    expect(host.querySelector('[aria-label="Запустить приложение"]')).toBeNull();
    expect(onSources).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'file', version: 2 }),
    ]);
    await act(async () => render('3', 'next-question'));
    expect(anchor.querySelector('iframe')).toBeNull();
    const open = anchor.querySelector<HTMLButtonElement>('[aria-label="Открыть файл snake.html"]')!;
    expect(open).not.toBeNull();
    await act(async () => open.click());
    expect(anchor.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    await act(async () =>
      anchor.querySelector<HTMLButtonElement>('[aria-label="Свернуть предпросмотр"]')!.click(),
    );
    expect(anchor.querySelector('iframe')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('shows the real saved revision beside the saving reply and a later filename reference, rather than hiding it beside v1', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const mount = document.createElement('div');
  const first = document.createElement('div');
  const saved = document.createElement('div');
  const question = document.createElement('div');
  host.append(mount, first, saved, question);
  document.body.append(host);
  const root = createRoot(mount);
  let version = 1;
  const metadata = () => ({
    id: 'site',
    name: 'site.html',
    version,
    anchorRequestId: 'r1',
    sourceMessageId: null,
    sourceBlock: null,
    updatedAt: version === 1 ? '2026-11-02T00:00:01Z' : '2026-11-02T00:01:01Z',
  });
  api.call.mockImplementation(async (url: string) => ({
    ok: true,
    data: url.endsWith('/working-files')
      ? { items: [metadata()] }
      : {
          ...metadata(),
          content: '<h1>Saved v' + version + '</h1>',
          versions: [{ version, summary: '', createdAt: '' }],
        },
  }));
  const messages = [
    {
      id: 'first',
      requestId: 'r1',
      role: 'assistant',
      createdAt: '2026-11-02T00:00:02Z',
      content: 'Создан `site.html`',
    },
    {
      id: 'saved',
      requestId: 'r2',
      role: 'assistant',
      createdAt: '2026-11-02T00:01:02Z',
      content: 'Сайт обновлён',
    },
  ];
  const onSources = vi.fn();
  const render = (request: string) =>
    root.render(
      createElement(AiWorkingFiles, {
        threadId: 'thread',
        refreshKey: request + version,
        busy: false,
        onSources,
        messages,
        targets: { first, saved, question },
        latestRequestId: request,
      }),
    );
  try {
    await act(async () => render('r1'));
    expect(first.querySelector('iframe')).not.toBeNull();
    await act(async () => render('r2'));
    expect(first.querySelector('iframe')).toBeNull();
    version = 2;
    await act(async () => render('r2'));
    expect(first.querySelector('iframe')).toBeNull();
    expect(saved.querySelector('iframe')?.getAttribute('srcdoc')).toContain('Saved v2');
    messages.push({
      id: 'question',
      requestId: 'r3',
      role: 'assistant',
      createdAt: '2026-11-02T00:02:02Z',
      content: 'Вот файл `site.html`',
    });
    await act(async () => render('r3'));
    expect(saved.querySelector('iframe')).toBeNull();
    const open = question.querySelector<HTMLButtonElement>('[aria-label="Открыть файл site.html"]');
    expect(open).not.toBeNull();
    await act(async () => open!.click());
    expect(question.querySelector('[aria-label="Скачать код: site.html"]')).not.toBeNull();
    expect(question.querySelector('iframe')?.getAttribute('srcdoc')).toContain('Saved v2');
    vi.mocked(downloadBlob).mockClear();
    await act(async () =>
      question.querySelector<HTMLButtonElement>('[aria-label="Скачать код: site.html"]')!.click(),
    );
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'site.html');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('never offers a broken private-image HTML download when its image is unavailable', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(downloadBlob).mockClear();
  const host = document.createElement('div');
  const anchor = document.createElement('div');
  document.body.append(host, anchor);
  const root = createRoot(host);
  const meta = {
    id: 'site',
    name: 'site.html',
    version: 1,
    anchorRequestId: 'request',
    sourceMessageId: null,
    sourceBlock: null,
  };
  api.call.mockResolvedValue({
    ok: true,
    data: { items: [meta], ...meta, content: '<img src="/api/ai/threads/foreign/image">' },
  });
  try {
    await act(async () =>
      root.render(
        createElement(AiWorkingFiles, {
          threadId: 'thread',
          refreshKey: '1',
          busy: false,
          onSources: vi.fn(),
          messages: [{ id: 'message', requestId: 'request', role: 'assistant' }],
          targets: { message: anchor },
          latestRequestId: 'request',
        }),
      ),
    );
    await act(async () =>
      anchor.querySelector<HTMLButtonElement>('[aria-label="Скачать код: site.html"]')!.click(),
    );
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(anchor.textContent).toContain('Не удалось подготовить файл с изображениями.');
    expect(
      anchor.querySelector<HTMLButtonElement>('[aria-label="Скачать код: site.html"]')?.disabled,
    ).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    anchor.remove();
    vi.unstubAllGlobals();
  }
});
