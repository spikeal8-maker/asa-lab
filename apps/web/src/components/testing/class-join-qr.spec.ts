// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClassJoinQr } from '../ClassJoinQr';
import { encodeClassJoinQr } from '../class-join-qr-encoder';

vi.mock('../class-join-qr-encoder', () => ({ encodeClassJoinQr: vi.fn() }));
const encoder = vi.mocked(encodeClassJoinQr);
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
const urlA = 'https://portal.example.org/#/join-class?code=ABC%20DEF%20234';
const urlB = 'https://portal.example.org/#/join-class?code=QRT%20UVW%20678';
const pathsA = { size: 41, d: 'M4 4h7v1h-7z' };
const pathsB = { size: 45, d: 'M4 5h7v1h-7z' };
function pending() {
  let resolve!: (value: typeof pathsA) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<typeof pathsA>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
let root: Root;
let container: HTMLDivElement;
function render(url: string): void {
  root.render(createElement(ClassJoinQr, { url, label: 'Вход в класс' }));
}
beforeAll(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.resetAllMocks();
});
async function mount(url: string) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => render(url));
}
describe('rendered ClassJoinQr lifecycle', () => {
  it('removes the old SVG synchronously when URL changes and ignores a late old response', async () => {
    const first = pending();
    const next = pending();
    const last = pending();
    encoder
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(next.promise)
      .mockReturnValueOnce(last.promise);
    await mount(urlA);
    expect(container.querySelector('svg')).toBeNull();
    await act(async () => first.resolve(pathsA));
    expect(container.querySelector('path')?.getAttribute('d')).toBe(pathsA.d);
    await act(async () => {
      flushSync(() => render(urlB));
      // Check before the new async encoder can settle, including React's first render.
      expect(container.querySelector('svg')).toBeNull();
    });
    await act(async () => render(urlA));
    await act(async () => last.resolve(pathsA));
    await act(async () => next.resolve(pathsB));
    expect(container.querySelector('path')?.getAttribute('d')).toBe(pathsA.d);
    expect(encoder.mock.calls.map(([url]) => url)).toEqual([urlA, urlB, urlA]);
  });
  it('shows a current-URL failure without the old QR, then retries successfully', async () => {
    const next = pending();
    encoder
      .mockResolvedValueOnce(pathsA)
      .mockReturnValueOnce(next.promise)
      .mockResolvedValueOnce(pathsB);
    await mount(urlA);
    expect(container.querySelector('svg')).not.toBeNull();
    await act(async () => render(urlB));
    await act(async () => next.reject(new Error('encoder import failed')));
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Не удалось построить QR-код',
    );
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('path')?.getAttribute('d')).toBe(pathsB.d);
    expect(container.querySelector('svg')?.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(container.querySelector('rect')?.getAttribute('fill')).toBe('#ffffff');
    expect(container.querySelector('path')?.getAttribute('fill')).toBe('#000000');
    expect(encoder).toHaveBeenLastCalledWith(urlB);
  });
  it('does not carry a failed URL into a new URL or apply an obsolete rejection', async () => {
    const old = pending();
    encoder.mockReturnValueOnce(old.promise).mockResolvedValueOnce(pathsB);
    await mount(urlA);
    await act(async () => render(urlB));
    await act(async () => old.reject(new Error('obsolete import failure')));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('path')?.getAttribute('d')).toBe(pathsB.d);
    encoder.mockRejectedValueOnce(new Error('current failure')).mockResolvedValueOnce(pathsB);
    await act(async () => render(urlA));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => render(urlB));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('path')?.getAttribute('d')).toBe(pathsB.d);
  });
});
