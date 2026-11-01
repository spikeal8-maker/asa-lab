// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  PublicationComments,
  type DiscussionState,
  type PublicComment,
} from './PublicationComments';
import { call } from '../api-call';
import { setTelemetryContext } from '../telemetry-context';
vi.mock('../api-call', () => ({ call: vi.fn() }));
let host: HTMLDivElement, root: Root;
const state: DiscussionState = {
  authenticated: true,
  enabled: true,
  adminEnabled: true,
  version: 0,
  revisionId: 'rev',
  canManage: false,
  canComment: true,
  reason: null,
};
const row: PublicComment = {
  id: 'comment',
  parentId: null,
  author: 'Алексей',
  body: '<img src=x onerror=alert(1)>',
  status: 'visible',
  createdAt: '2026-11-01T09:00:00Z',
  version: 0,
  canDelete: true,
  canManage: false,
  replyCount: 0,
};
const page = (override: Partial<DiscussionState> = {}, items: PublicComment[] = []) => ({
  ok: true as const,
  status: 200,
  data: { state: { ...state, ...override }, items, nextCursor: null },
});
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setTelemetryContext(null, true, 'public');
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
async function render() {
  await act(async () =>
    root.render(createElement(PublicationComments, { publicationId: 'pub', revisionId: 'rev' })),
  );
}
async function click(name: string) {
  const b = [...host.querySelectorAll('button')].find((b) => b.textContent === name)!;
  expect(b).toBeTruthy();
  await act(async () => b.click());
}
async function type(text: string) {
  const t = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(t, text);
    t.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
it('separates guest, denied learner and closed discussion access while retaining readable comments', async () => {
  vi.mocked(call).mockResolvedValue(
    page({ authenticated: false, canComment: false, reason: 'sign_in' }, [row]),
  );
  await render();
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.querySelector('a')?.textContent).toContain('Войдите');
  expect(host.textContent).toContain(row.body);
  expect(host.querySelector('img')).toBeNull();
  vi.mocked(call).mockResolvedValue(page({ canComment: false, reason: 'permission' }));
  await click('Обновить');
  expect(host.textContent).toContain('настройкам вашего класса');
  vi.mocked(call).mockResolvedValue(
    page({ canComment: false, enabled: false, reason: 'closed' }, [row]),
  );
  await click('Обновить');
  expect(host.textContent).toContain('Автор закрыл');
  expect(host.textContent).toContain(row.body);
});
it('retains the mutation key and draft after an unconfirmed request and inserts only the authoritative receipt', async () => {
  vi.mocked(call).mockResolvedValueOnce(page());
  await render();
  await type('Мой комментарий');
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 0,
    error: { code: 'network', message: 'lost' },
  });
  await submit();
  expect(host.querySelector('textarea')!.value).toBe('Мой комментарий');
  const first = JSON.parse(vi.mocked(call).mock.calls.at(-1)![1]!.body as string);
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: { comment: { ...row, body: 'Мой комментарий' } },
  });
  await submit();
  const second = JSON.parse(vi.mocked(call).mock.calls.at(-1)![1]!.body as string);
  expect(second.mutationId).toBe(first.mutationId);
  expect(second.revisionId).toBe('rev');
  expect(host.querySelectorAll('[data-testid="publication-comment"]')).toHaveLength(1);
  expect(host.querySelector('textarea')!.value).toBe('');
});
it('discards late private state when identity changes', async () => {
  let resolve!: (v: Awaited<ReturnType<typeof call>>) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render();
  await act(async () =>
    setTelemetryContext(
      { kind: 'account', accountId: 'other', workspaceId: 'other' },
      true,
      'public',
    ),
  );
  await act(async () => resolve(page({ canManage: true }, [row])));
  expect(host.textContent).toContain('Контекст входа изменился');
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.textContent).not.toContain(row.author);
});
it('clears owner controls and private state on an expired mutation session', async () => {
  vi.mocked(call).mockResolvedValueOnce(page({ canManage: true }, [row]));
  await render();
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 401,
    error: { code: 'unauthorized', message: 'expired' },
  });
  await click('Удалить');
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.querySelector('input[type=checkbox]')).toBeNull();
  expect(host.textContent).not.toContain(row.author);
});
it('does not let a slow refresh replace a confirmed comment', async () => {
  vi.mocked(call).mockResolvedValueOnce(page());
  await render();
  await type('Сохранённый ответ');
  let resolve!: (v: Awaited<ReturnType<typeof call>>) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await click('Обновить');
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: { comment: { ...row, body: 'Сохранённый ответ' } },
  });
  await submit();
  await act(async () => resolve(page()));
  expect(host.textContent).toContain('Сохранённый ответ');
});
it('appends cursor pages and loads replies independently without duplicate roots', async () => {
  vi.mocked(call).mockResolvedValueOnce({
    ...page({}, [{ ...row, replyCount: 1 }]),
    data: { ...page().data, items: [{ ...row, replyCount: 1 }], nextCursor: 'comment' },
  });
  await render();
  vi.mocked(call).mockResolvedValueOnce(page({}, [{ ...row, id: 'older', body: 'Старый' }]));
  await click('Ещё комментарии');
  expect(vi.mocked(call).mock.calls.at(-1)![0]).toContain('before=comment');
  vi.mocked(call).mockResolvedValueOnce(
    page({}, [{ ...row, id: 'reply', parentId: 'comment', body: 'Ответ ученика' }]),
  );
  await click('Ответы: 1');
  expect(vi.mocked(call).mock.calls.at(-1)![0]).toContain('parentId=comment');
  expect(host.textContent).toContain('Ответ ученика');
  expect(host.querySelectorAll('[data-testid=publication-comment]')).toHaveLength(3);
});
it('requires report reason and sends CAS when the owner closes comments', async () => {
  vi.mocked(call).mockResolvedValueOnce(page({ canManage: true }, [row]));
  await render();
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: {
      ...state,
      canManage: true,
      enabled: false,
      canComment: false,
      reason: 'closed',
      version: 1,
    },
  });
  await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  expect(JSON.parse(vi.mocked(call).mock.calls.at(-1)![1]!.body as string)).toEqual({
    action: 'settings',
    enabled: false,
    expectedVersion: 0,
  });
  expect(host.textContent).toContain('Автор закрыл');
  expect(host.querySelector('textarea')).toBeNull();
  await click('Пожаловаться');
  expect(host.querySelector('textarea[name=reason]')?.hasAttribute('required')).toBe(true);
});
it('renders authoritative reaction receipts and pins without duplicate root rows', async () => {
  vi.mocked(call).mockResolvedValueOnce(
    page({ canPin: true }, [{ ...row, canLike: true, likeCount: 2 }]),
  );
  await render();
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: { comment: { ...row, canLike: true, liked: true, likeCount: 3 } },
  });
  const heart = host.querySelector<HTMLButtonElement>('[aria-label="Нравится комментарий"]')!;
  await act(async () => heart.click());
  expect(host.querySelector('[aria-label="Убрать лайк комментария"]')?.textContent).toBe('3');
  vi.mocked(call)
    .mockResolvedValueOnce({ ok: true, status: 200, data: { succeeded: true } })
    .mockResolvedValueOnce({
      ...page({ canPin: true, version: 1 }),
      data: {
        ...page({ canPin: true, version: 1 }).data,
        pinnedComment: { ...row, pinned: true, likeCount: 3, liked: true },
      },
    });
  await click('Закрепить');
  expect(host.querySelectorAll('[data-testid=publication-comment]')).toHaveLength(1);
  expect(host.textContent).toContain('Закреплено');
});
it('changes server sorting without losing the comment draft', async () => {
  vi.mocked(call).mockResolvedValueOnce(page());
  await render();
  await type('Черновик ответа');
  vi.mocked(call).mockResolvedValueOnce(page({}, [row]));
  await act(async () => {
    const select = host.querySelector('select')!;
    select.value = 'popular';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(vi.mocked(call).mock.calls.at(-1)![0]).toContain('sort=popular');
  expect(host.querySelector('textarea')!.value).toBe('Черновик ответа');
});
