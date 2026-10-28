import { AI_IMAGE_PRESETS } from '@asa-lab/contracts';
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { call } from '../api-call';
import { fetchWithSessionRefresh } from '../session-fetch';
import { AiImageGeneration } from './AiImageGeneration';
import { AiGeneratedImage, generatedImagePath } from './AiGeneratedImage';

vi.mock('../api-call', () => ({ call: vi.fn() }));
vi.mock('../session-fetch', () => ({ fetchWithSessionRefresh: vi.fn() }));
const THREAD = '10000000-0000-4000-8000-000000000001';
const REQUEST = '20000000-0000-4000-8000-000000000001';
let host: HTMLDivElement, root: Root;
const complete = vi.fn();
const status = {
  enabled: true,
  ready: true,
  reason: null,
  sizes: [768],
  dailyLimit: 10,
  remainingToday: 10,
};
const job = {
  threadId: THREAD,
  requestId: REQUEST,
  prompt: 'A bird',
  state: 'running',
  createdAt: '2026-10-26T00:00:00Z',
  cancelRequested: false,
  errorCode: null,
  image: null,
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(call).mockReset();
  vi.mocked(fetchWithSessionRefresh).mockReset();
  complete.mockReset();
  sessionStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function render(threadId = THREAD, seatId?: string) {
  await act(async () =>
    root.render(
      createElement(AiImageGeneration, {
        threadId,
        seatId,
        disabled: false,
        createThread: async () => THREAD,
        onComplete: complete,
        onClose: vi.fn(),
      }),
    ),
  );
}
async function prompt(value: string) {
  const input = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('never repeats an uncertain POST; reload reads only the exact saved UUID', async () => {
  vi.mocked(call).mockImplementation(async (path, init) => {
    if (path.endsWith('/status')) return { ok: true, status: 200, data: status };
    if (init?.method === 'POST')
      return { ok: false, status: 0, error: { code: 'network', message: 'unknown' } };
    return { ok: false, status: 404, error: { code: 'not_found', message: 'unknown' } };
  });
  await render();
  await prompt('A bird');
  await act(async () =>
    Array.from(host.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === 'Создать изображение')!
      .click(),
  );
  const writes = vi.mocked(call).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes).toHaveLength(1);
  const id = JSON.parse(String(writes[0]![1]!.body)).requestId;
  expect(sessionStorage.getItem('asa-ai-image:personal:' + THREAD)).toBe(id);
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  await prompt('Another prompt');
  await act(async () =>
    Array.from(host.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === 'Создать изображение')!
      .click(),
  );
  expect(vi.mocked(call).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(
    vi.mocked(call).mock.calls.some(([path]) => path.endsWith('/image-generations/' + id)),
  ).toBe(true);
});
it.each([
  [400, 'Неверный идентификатор запроса.'],
  [400, 'Размер больше не разрешён.'],
  [403, 'Генерация изображений выключена.'],
  [429, 'Видеокарта занята.'],
  [503, 'Локальная генерация больше не готова.'],
] as const)(
  'releases a typed not-admitted %s fresh POST and permits only an explicit new UUID (%s)',
  async (httpStatus, message) => {
    vi.useFakeTimers();
    let statusReads = 0;
    const writes: { requestId: string; size: number }[] = [];
    vi.mocked(call).mockImplementation(async (path, init) => {
      if (path.endsWith('/status'))
        return {
          ok: true,
          status: 200,
          data: ++statusReads === 1 ? status : { ...status, sizes: [768], remainingToday: 9 },
        };
      if (init?.method === 'POST') {
        const input = JSON.parse(String(init.body));
        writes.push(input);
        return writes.length === 1
          ? { ok: false, status: httpStatus, error: { code: 'ai_image_not_admitted', message } }
          : {
              ok: true,
              status: 200,
              data: { ...job, requestId: input.requestId, state: 'admitted' },
            };
      }
      return {
        ok: true,
        status: 200,
        data: { ...job, requestId: writes.at(-1)!.requestId, state: 'admitted' },
      };
    });
    await render();
    await prompt('A bird');
    const create = () =>
      Array.from(host.querySelectorAll('button')).find(
        (button) => button.getAttribute('aria-label') === 'Создать изображение',
      )!;
    await act(async () => create().click());
    expect(sessionStorage.getItem('asa-ai-image:personal:' + THREAD)).toBeNull();
    expect(host.textContent).toContain(message);
    expect(statusReads).toBe(2);
    expect(
      host.querySelector<HTMLSelectElement>('select[aria-label="Размер изображения"]')!.value,
    ).toBe('768');
    expect(host.querySelector('textarea')!.value).toBe('A bird');
    expect(create().disabled).toBe(false);
    await act(async () => vi.advanceTimersByTime(20000));
    expect(writes).toHaveLength(1);
    expect(vi.mocked(call).mock.calls.some(([path]) => path.includes('/image-generations/'))).toBe(
      false,
    );
    await act(async () => create().click());
    expect(writes).toHaveLength(2);
    expect(writes[1]!.requestId).not.toBe(writes[0]!.requestId);
    expect(writes[1]!.size).toBe(768);
  },
);
it.each([
  [503, 'ai_image_unavailable'],
  [503, 'proxy_error'],
  [500, 'server_error'],
  [500, 'ai_image_not_admitted'],
  [400, 'proxy_error'],
  [403, 'ai_image_denied'],
  [429, 'proxy_throttle'],
] as const)(
  'preserves an uncertain %s/%s POST even when every recovery GET is 404',
  async (httpStatus, code) => {
    vi.useFakeTimers();
    vi.mocked(call).mockImplementation(async (path, init) => {
      if (path.endsWith('/status')) return { ok: true, status: 200, data: status };
      if (init?.method === 'POST')
        return { ok: false, status: httpStatus, error: { code, message: 'unknown' } };
      return {
        ok: false,
        status: 404,
        error: { code: 'ai_image_not_found', message: 'not found' },
      };
    });
    await render();
    await prompt('A bird');
    await act(async () =>
      Array.from(host.querySelectorAll('button'))
        .find((button) => button.getAttribute('aria-label') === 'Создать изображение')!
        .click(),
    );
    const post = vi.mocked(call).mock.calls.find(([, init]) => init?.method === 'POST')!;
    const id = JSON.parse(String(post[1]!.body)).requestId;
    await act(async () => vi.advanceTimersByTime(2000));
    expect(sessionStorage.getItem('asa-ai-image:personal:' + THREAD)).toBe(id);
    expect(vi.mocked(call).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(
      1,
    );
    expect(
      vi.mocked(call).mock.calls.filter(([path]) => path.endsWith('/image-generations/' + id))
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      Array.from(host.querySelectorAll('button')).find(
        (button) => button.getAttribute('aria-label') === 'Создать изображение',
      )!.disabled,
    ).toBe(true);
  },
);
it('refreshes exhausted quota after a definite 429 without generating or polling', async () => {
  let reads = 0;
  vi.mocked(call).mockImplementation(async (path) =>
    path.endsWith('/status')
      ? { ok: true, status: 200, data: { ...status, remainingToday: ++reads === 1 ? 10 : 0 } }
      : {
          ok: false,
          status: 429,
          error: { code: 'ai_image_not_admitted', message: 'Лимит исчерпан' },
        },
  );
  await render();
  await prompt('A bird');
  await act(async () =>
    Array.from(host.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Создать изображение')!
      .click(),
  );
  expect(sessionStorage.getItem('asa-ai-image:personal:' + THREAD)).toBeNull();
  expect(
    Array.from(host.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'Создать изображение',
    )!.disabled,
  ).toBe(true);
  expect(reads).toBe(2);
});
it('refreshes lost readiness after a confirmed 503 race while preserving the rejected draft', async () => {
  let ready = true;
  vi.mocked(call).mockImplementation(async (path, init) => {
    if (path.endsWith('/status')) return { ok: true, status: 200, data: { ...status, ready } };
    if (init?.method === 'POST') {
      ready = false;
      return {
        ok: false,
        status: 503,
        error: { code: 'ai_image_not_admitted', message: 'Локальная генерация больше не готова.' },
      };
    }
    throw new Error('A confirmed preadmission rejection must not poll');
  });
  await render();
  await prompt('Preserve this image description');
  const create = () =>
    Array.from(host.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'Создать изображение',
    )!;
  expect(create().disabled).toBe(false);
  await act(async () => create().click());
  expect(sessionStorage.getItem('asa-ai-image:personal:' + THREAD)).toBeNull();
  expect(host.querySelector('textarea')!.value).toBe('Preserve this image description');
  expect(create().disabled).toBe(true);
  expect(host.textContent).toContain('Локальная генерация больше не готова.');
  expect(vi.mocked(call).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(vi.mocked(call).mock.calls.filter(([path]) => path.endsWith('/status'))).toHaveLength(2);
});
it('fences a late poll when another thread is selected and preserves Seat headers', async () => {
  sessionStorage.setItem('asa-ai-image:seat-a:' + THREAD, REQUEST);
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  vi.mocked(call).mockImplementation(async (path) =>
    path.endsWith('/status') ? { ok: true, status: 200, data: status } : ((await pending) as never),
  );
  await render(THREAD, 'seat-a');
  await render('another-thread', 'seat-a');
  await act(async () => finish({ ok: true, status: 200, data: { ...job, state: 'complete' } }));
  expect(complete).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain('Изображение создано.');
  expect(
    vi.mocked(call).mock.calls.find(([path]) => path.includes('/image-generations/'))?.[1]?.headers,
  ).toEqual({ 'x-asa-ai-seat': 'seat-a' });
});
it('reports queued and cancellation honestly without creating a second job', async () => {
  sessionStorage.setItem('asa-ai-image:personal:' + THREAD, REQUEST);
  vi.mocked(call).mockImplementation(async (path, init) => ({
    ok: true,
    status: 200,
    data: path.endsWith('/status')
      ? status
      : { ...job, state: 'admitted', cancelRequested: init?.method === 'POST' },
  }));
  await render();
  expect(host.textContent).toContain('Задание принято');
  await act(async () =>
    Array.from(host.querySelectorAll('button'))
      .find((b) => b.getAttribute('aria-label') === 'Отменить задание')!
      .click(),
  );
  expect(vi.mocked(call).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(vi.mocked(call).mock.calls.some(([path]) => path.endsWith('/cancel'))).toBe(true);
});
it('fetches the closed authenticated image route and revokes its object URL', async () => {
  const create = vi.fn(() => 'blob:private-image'),
    revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  vi.mocked(fetchWithSessionRefresh).mockResolvedValue({
    ok: true,
    blob: async () => new Blob(['png'], { type: 'image/png' }),
  } as Response);
  const image = {
    requestId: REQUEST,
    width: 512,
    height: 512,
    mimeType: 'image/png' as const,
    sizeBytes: 3,
    downloadUrl: 'https://untrusted.invalid/image',
  };
  await act(async () =>
    root.render(createElement(AiGeneratedImage, { image, threadId: THREAD, seatId: 'seat-a' })),
  );
  expect(fetchWithSessionRefresh).toHaveBeenCalledWith(
    generatedImagePath(THREAD, REQUEST),
    expect.objectContaining({ headers: { 'x-asa-ai-seat': 'seat-a' } }),
  );
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:private-image');
  expect(host.querySelector('a')?.getAttribute('download')).toContain('.png');
  await act(async () => root.unmount());
  root = createRoot(host);
  expect(revoke).toHaveBeenCalledWith('blob:private-image');
});
it('removes a completed receipt only after terminal GET and refreshes this thread once', async () => {
  sessionStorage.setItem('asa-ai-image:personal:' + THREAD, REQUEST);
  vi.mocked(call).mockImplementation(async (path) => ({
    ok: true,
    status: 200,
    data: path.endsWith('/status') ? status : { ...job, state: 'complete' },
  }));
  await render();
  expect(complete).toHaveBeenCalledExactlyOnceWith(THREAD);
  expect(sessionStorage.getItem('asa-ai-image:personal:' + THREAD)).toBeNull();
  expect(host.textContent).toContain('Изображение создано.');
});
it('a failed image is not presented as complete and never creates a text request', async () => {
  sessionStorage.setItem('asa-ai-image:personal:' + THREAD, REQUEST);
  vi.mocked(call).mockImplementation(async (path) => ({
    ok: true,
    status: 200,
    data: path.endsWith('/status') ? status : { ...job, state: 'failed' },
  }));
  await render();
  expect(host.textContent).toContain('Не удалось создать изображение.');
  expect(complete).not.toHaveBeenCalled();
  expect(vi.mocked(call).mock.calls.every(([, init]) => !init?.method)).toBe(true);
});

it('shows the same six exact dimensions in the image composer', async () => {
  vi.mocked(call).mockResolvedValue({
    ok: true,
    status: 200,
    data: { ...status, sizes: AI_IMAGE_PRESETS.map((p) => p.id) },
  });
  await render();
  const sizes = host.querySelector<HTMLSelectElement>('select[aria-label="Размер изображения"]')!;
  expect(Array.from(sizes.options).map((o) => o.textContent?.trim())).toEqual(
    AI_IMAGE_PRESETS.map((p) => p.label),
  );
  expect(sizes.textContent).not.toContain('512');
});
