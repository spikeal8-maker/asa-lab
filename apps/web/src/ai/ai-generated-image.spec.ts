// @vitest-environment jsdom
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchWithSessionRefresh } from '../session-fetch';
import { AiGeneratedImage, generatedImagePath } from './AiGeneratedImage';

vi.mock('../session-fetch', () => ({ fetchWithSessionRefresh: vi.fn() }));
const THREAD = '10000000-0000-4000-8000-000000000001';
const image = (id: number) => ({
  requestId: '20000000-0000-4000-8000-' + String(id).padStart(12, '0'),
  width: 512,
  height: 512,
  mimeType: 'image/png' as const,
  sizeBytes: 3,
  downloadUrl: 'https://untrusted.invalid/image',
});
const png = () => new Blob(['png'], { type: 'image/png' });
const response = (blob = png()) => ({ ok: true, status: 200, blob: async () => blob }) as Response;
const busy = () =>
  ({
    ok: false,
    status: 429,
    json: async () => ({ error: { code: 'ai_image_busy' } }),
  }) as Response;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
let host: HTMLDivElement, root: Root;
const createUrl = vi.fn(),
  revokeUrl = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
  createUrl.mockReset().mockImplementation(() => 'blob:image-' + createUrl.mock.calls.length);
  revokeUrl.mockReset();
  vi.mocked(fetchWithSessionRefresh).mockReset();
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
async function render(ids: number[], threadId = THREAD, seatId = 'seat-a') {
  await act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        ...ids.map((id) =>
          createElement(AiGeneratedImage, { key: id, image: image(id), threadId, seatId }),
        ),
      ),
    ),
  );
}
it('serializes simultaneous history images through the complete body read and reloads both downloads', async () => {
  const first = deferred<Blob>();
  let active = 0,
    maximum = 0;
  vi.mocked(fetchWithSessionRefresh).mockImplementation(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    const n = vi.mocked(fetchWithSessionRefresh).mock.calls.length;
    return {
      ok: true,
      status: 200,
      blob: async () => {
        const blob = n === 1 ? await first.promise : png();
        active -= 1;
        return blob;
      },
    } as Response;
  });
  await render([1, 2]);
  expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(1);
  expect(host.querySelectorAll('a')).toHaveLength(0);
  await act(async () => first.resolve(png()));
  expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(2);
  expect(maximum).toBe(1);
  expect(host.querySelectorAll('img')).toHaveLength(2);
  expect(host.querySelectorAll('a[download]')).toHaveLength(2);
  await act(async () => root.unmount());
  root = createRoot(host);
  await render([1, 2]);
  expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(4);
  expect(maximum).toBe(1);
  expect(host.querySelectorAll('a[download]')).toHaveLength(2);
  expect(revokeUrl).toHaveBeenCalledTimes(2);
  for (const [path, options] of vi.mocked(fetchWithSessionRefresh).mock.calls) {
    expect(path).toMatch(/^\/api\/ai\/threads\/[^/]+\/image-generations\/[^/]+\/image$/);
    expect(options).toMatchObject({ headers: { 'x-asa-ai-seat': 'seat-a' }, cache: 'no-store' });
  }
});
it.each(['thread', 'scope'] as const)(
  'cancels queued images and fences a lost active body on %s change',
  async (change) => {
    const oldBody = deferred<Blob>();
    vi.mocked(fetchWithSessionRefresh).mockImplementation(async () =>
      vi.mocked(fetchWithSessionRefresh).mock.calls.length === 1
        ? ({ ok: true, status: 200, blob: () => oldBody.promise } as Response)
        : response(),
    );
    await render([1, 2]);
    const oldSignal = vi.mocked(fetchWithSessionRefresh).mock.calls[0]![1]!.signal!;
    await render([3], 'another-thread', change === 'scope' ? 'seat-b' : 'seat-a');
    expect(oldSignal.aborted).toBe(true);
    // A different owner has its own permit; the same owner waits for the old body.
    expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(change === 'scope' ? 2 : 1);
    await act(async () => oldBody.resolve(png()));
    expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(fetchWithSessionRefresh)
        .mock.calls.some(([path]) => path === generatedImagePath(THREAD, image(2).requestId)),
    ).toBe(false);
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('a[download]')).toHaveLength(1);
    expect(vi.mocked(fetchWithSessionRefresh).mock.calls[1]).toEqual([
      generatedImagePath('another-thread', image(3).requestId),
      expect.objectContaining({
        headers: { 'x-asa-ai-seat': change === 'scope' ? 'seat-b' : 'seat-a' },
      }),
    ]);
  },
);
it('recovers a typed temporary transfer 429 with a bounded GET retry', async () => {
  vi.useFakeTimers();
  vi.mocked(fetchWithSessionRefresh)
    .mockResolvedValueOnce(busy())
    .mockResolvedValueOnce(response());
  await render([1]);
  expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(2);
  expect(host.querySelector('a')?.getAttribute('download')).toContain(image(1).requestId);
  expect(vi.mocked(fetchWithSessionRefresh).mock.calls.map(([path]) => path)).toEqual([
    generatedImagePath(THREAD, image(1).requestId),
    generatedImagePath(THREAD, image(1).requestId),
  ]);
});
it('stops after three temporary-429 retries and releases the queue for another card', async () => {
  vi.useFakeTimers();
  vi.mocked(fetchWithSessionRefresh).mockImplementation(async (path) =>
    path === generatedImagePath(THREAD, image(1).requestId) ? busy() : response(),
  );
  await render([1, 2]);
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(5);
  expect(host.textContent).toContain('Изображение недоступно');
  expect(host.querySelectorAll('a[download]')).toHaveLength(1);
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(5);
});
it('cancels a retry timer on unmount and lets the next history image load', async () => {
  vi.useFakeTimers();
  vi.mocked(fetchWithSessionRefresh).mockResolvedValueOnce(busy()).mockResolvedValue(response());
  await render([1, 2]);
  await render([2]);
  expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(2);
  expect(host.querySelectorAll('a[download]')).toHaveLength(1);
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(2);
});
it.each([
  [403, 'ai_image_denied'],
  [404, 'ai_image_not_found'],
  [500, 'server_error'],
  [429, 'proxy_throttle'],
] as const)('does not retry a permanent or unrecognized %s/%s response', async (status, code) => {
  vi.useFakeTimers();
  vi.mocked(fetchWithSessionRefresh).mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: { code } }),
  } as Response);
  await render([1]);
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Изображение недоступно');
  expect(createUrl).not.toHaveBeenCalled();
});
it('releases the slot after byte validation fails without retrying invalid bytes', async () => {
  vi.mocked(fetchWithSessionRefresh)
    .mockResolvedValueOnce(response(new Blob(['bad'], { type: 'text/html' })))
    .mockResolvedValueOnce(response());
  await render([1, 2]);
  expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(2);
  expect(createUrl).toHaveBeenCalledTimes(1);
  expect(host.querySelectorAll('a[download]')).toHaveLength(1);
  expect(host.textContent).toContain('Изображение недоступно');
});
it('waits for visibility and disconnects its observer when a history card unmounts', async () => {
  const observers: {
    callback: IntersectionObserverCallback;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      readonly disconnect = vi.fn();
      readonly observe = vi.fn();
      constructor(callback: IntersectionObserverCallback) {
        observers.push({ callback, disconnect: this.disconnect });
      }
    },
  );
  vi.mocked(fetchWithSessionRefresh).mockResolvedValue(response());
  await render([1]);
  expect(fetchWithSessionRefresh).not.toHaveBeenCalled();
  await act(async () =>
    observers[0]!.callback(
      [{ isIntersecting: true }] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    ),
  );
  expect(fetchWithSessionRefresh).toHaveBeenCalledTimes(1);
  expect(observers[0]!.disconnect).toHaveBeenCalled();
  await render([]);
  expect(revokeUrl).toHaveBeenCalledTimes(1);
});
