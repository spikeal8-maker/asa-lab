// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublicationCommentModeration } from '../PublicationCommentModeration';
import { call } from '../admin-api';
vi.mock('../admin-api', () => ({ call: vi.fn() }));
let root: Root, host: HTMLDivElement;
const denied = vi.fn();
const data = {
  state: { version: 2, enabled: true, adminEnabled: true },
  items: [
    {
      id: 'c',
      body: 'Комментарий',
      author: 'Ученик',
      parentId: null,
      createdAt: '2026-11-01T09:00:00Z',
      version: 3,
      authorDeleted: false,
      ownerHidden: true,
      moderatorHidden: false,
      reports: [{ reason: 'Проверить', createdAt: '2026-11-01T09:00:00Z' }],
    },
  ],
  nextCursor: null,
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(call).mockReset();
  denied.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function click(label: string) {
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === label)!.click(),
  );
}
it('loads lazily, requires a reason and sends the comment CAS to real moderation endpoint', async () => {
  await act(async () =>
    root.render(
      createElement(PublicationCommentModeration, { publicationId: 'pub', onAccessDenied: denied }),
    ),
  );
  expect(call).not.toHaveBeenCalled();
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data });
  await click('Комментарии');
  expect(host.textContent).toContain('Скрыт владельцем');
  expect(host.textContent).toContain('Проверить');
  expect(
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Скрыть модератором')!
      .disabled,
  ).toBe(true);
  await act(async () => {
    const i = host.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      i,
      'Нарушение правил',
    );
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  vi.mocked(call)
    .mockResolvedValueOnce({ ok: true, status: 200, data: {} })
    .mockResolvedValueOnce({ ok: true, status: 200, data });
  await click('Скрыть модератором');
  expect(vi.mocked(call).mock.calls[1]![0]).toBe(
    '/api/admin/v1/publications/pub/comments/commands',
  );
  expect(JSON.parse(vi.mocked(call).mock.calls[1]![1]!.body as string)).toEqual({
    action: 'hide',
    commentId: 'c',
    expectedVersion: 3,
    reason: 'Нарушение правил',
  });
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 403,
    error: { code: 'forbidden', message: 'denied' },
  });
  await click('Обновить');
  expect(denied).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain('Комментарий');
});
