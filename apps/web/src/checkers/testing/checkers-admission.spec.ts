// @vitest-environment jsdom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameAccessBoundary } from '../../games/GameAccessBoundary';
import { gameAccessApi } from '../../games/game-access-api';

let root: Root, host: HTMLDivElement;
const stopped = vi.fn();
function Game() {
  useEffect(() => () => stopped(), []);
  return createElement('button', { 'data-game': true }, 'Ход');
}
beforeEach(() => {
  vi.useFakeTimers();
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});
async function render(guarded = true) {
  await act(async () =>
    root.render(
      createElement(GameAccessBoundary, {
        game: 'checkers',
        guarded,
        actor: 'seat',
        onBack: vi.fn(),
        children: createElement(Game),
      }),
    ),
  );
}
const granted = {
  ok: true as const,
  status: 200,
  data: { granted: true, reason: 'allowed' as const, threshold: null },
};

it('unmounts the open local game and its effects when the teacher revokes access', async () => {
  const read = vi.spyOn(gameAccessApi, 'read').mockResolvedValue(granted);
  await render();
  expect(host.querySelector('[data-game]')).not.toBeNull();
  read.mockResolvedValue({
    ok: true,
    status: 200,
    data: { granted: false, reason: 'class_disabled', threshold: null },
  });
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(host.querySelector('[data-game]')).toBeNull();
  expect(stopped).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Игры недоступны');
  expect(host.textContent).toContain('Учитель отключил игры для класса.');
});
it('fails closed on unavailable admission and only remounts after a successful retry', async () => {
  const read = vi.spyOn(gameAccessApi, 'read').mockResolvedValue({
    ok: false,
    status: 503,
    error: { code: 'unavailable', message: 'offline' },
  });
  await render();
  expect(host.querySelector('[data-game]')).toBeNull();
  read.mockResolvedValue(granted);
  await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
  expect(host.querySelector('[data-game]')).not.toBeNull();
  expect(read).toHaveBeenLastCalledWith('checkers');
});
it('leaves ordinary Account offline play available without a Seat-only admission poll', async () => {
  const read = vi.spyOn(gameAccessApi, 'read');
  await render(false);
  expect(host.querySelector('[data-game]')).not.toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it('keeps an admitted board mounted during focus revalidation, then unmounts on denial', async () => {
  const read = vi.spyOn(gameAccessApi, 'read').mockResolvedValue(granted);
  await render();
  let resolve: ((value: Awaited<ReturnType<typeof gameAccessApi.read>>) => void) | undefined;
  read.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(host.querySelector('[data-game]')).not.toBeNull();
  expect(stopped).not.toHaveBeenCalled();
  await act(async () => {
    resolve!({
      ok: true,
      status: 200,
      data: { granted: false, reason: 'class_disabled', threshold: null },
    });
  });
  expect(host.querySelector('[data-game]')).toBeNull();
  expect(stopped).toHaveBeenCalledTimes(1);
});
