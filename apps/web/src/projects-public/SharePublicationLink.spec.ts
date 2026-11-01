// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SharePublicationLink } from './SharePublicationLink';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('shows the check only after clipboard success, fences duplicate clicks and restores the icon', async () => {
  vi.useFakeTimers();
  let done!: () => void;
  const write = vi.fn(
    () =>
      new Promise<void>((r) => {
        done = r;
      }),
  );
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: write },
  });
  await act(async () =>
    root.render(createElement(SharePublicationLink, { publicationId: 'p', compact: true })),
  );
  const button = host.querySelector('button')!;
  await act(async () => {
    button.click();
    button.click();
  });
  expect(write).toHaveBeenCalledOnce();
  expect(button.classList.contains('is-copied')).toBe(false);
  await act(async () => done());
  expect(button.classList.contains('is-copied')).toBe(true);
  expect(host.textContent).toContain('Ссылка скопирована');
  await act(async () => vi.advanceTimersByTimeAsync(2500));
  expect(button.classList.contains('is-copied')).toBe(false);
  expect(host.querySelector('[role=status]')).toBeNull();
});
it('retains a selectable URL on clipboard failure without a false success check', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  });
  await act(async () =>
    root.render(createElement(SharePublicationLink, { publicationId: 'p', compact: true })),
  );
  await act(async () => host.querySelector('button')!.click());
  expect(host.querySelector('input')!.value).toContain('/public-projects/p');
  expect(host.querySelector('.is-copied')).toBeNull();
});
