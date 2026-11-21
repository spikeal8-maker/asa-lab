// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublicationReactionSettings } from '../PublicationReactionSettings';
import { call } from '../admin-api';
vi.mock('../admin-api', () => ({ call: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(call).mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it('uses displayed revision/CAS and a mandatory reason; stale state is retired without guessing counts', async () => {
  vi.mocked(call).mockResolvedValue({
    ok: false,
    status: 409,
    error: { code: 'conflict', message: 'private' },
  });
  await act(async () =>
    root.render(
      createElement(PublicationReactionSettings, {
        publicationId: 'pub',
        revisionId: 'revision',
        initial: { likeCount: 12, reactionsEnabled: true, reactionsVersion: 3 },
        onAccessDenied: vi.fn(),
      }),
    ),
  );
  expect(host.querySelector('button')!.disabled).toBe(true);
  expect(host.textContent).toContain('12 нравится');
  await act(async () => {
    const input = host.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'Safety review',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => host.querySelector('button')!.click());
  expect(call).toHaveBeenCalledWith('/api/admin/v1/publications/pub/reactions', {
    method: 'POST',
    body: JSON.stringify({
      enabled: false,
      expectedVersion: 3,
      expectedRevisionId: 'revision',
      reason: 'Safety review',
    }),
  });
  expect(host.querySelector('input')).toBeNull();
  expect(host.textContent).toContain('изменилась');
  expect(host.textContent).not.toContain('private');
});
