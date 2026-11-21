// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { AdminUserHistory } from '../AdminUserHistory';
import { adminApi, type AdminHistoryPage, type AdminApiResult } from '../admin-api';
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const ok = (items: AdminHistoryPage['items'], next: string | null = null) => ({
  ok: true as const,
  status: 200,
  data: { items, next, asOf: '2026-10-25T12:00:00Z', coverage: 'retained' as const },
});
const item = {
  key: 'ai:one',
  id: 'one',
  type: 'ai' as const,
  occurredAt: '2026-10-25T11:00:00Z',
  inputTokens: null,
  outputTokens: '0',
  status: 'failed',
  errorCode: 'ai_provider_timeout',
};
async function show(targetId = 'one', onAccessDenied = vi.fn()) {
  await act(async () =>
    root.render(
      createElement(AdminUserHistory, {
        kind: 'student',
        targetId,
        scope: { kind: 'platform', id: null },
        onAccessDenied,
      }),
    ),
  );
}
async function click(text: string) {
  await act(async () =>
    [...host.querySelectorAll('button')].find((x) => x.textContent === text)!.click(),
  );
}
it('loads lazily, paginates, keeps unknown tokens distinct from zero and preserves rows on append failure/retry', async () => {
  const api = vi
    .spyOn(adminApi, 'userHistory')
    .mockResolvedValueOnce(ok([item], 'next'))
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: { code: 'offline', message: 'offline' },
    })
    .mockResolvedValueOnce(ok([{ ...item, key: 'ai:two', id: 'two' }]));
  await show();
  expect(api).not.toHaveBeenCalled();
  await click('История проектов, публикаций и ИИ');
  expect(host.textContent).toContain('Входные токены: Неизвестно');
  expect(host.textContent).toContain('Выходные токены: 0');
  expect(host.textContent).toContain('ai_provider_timeout');
  await click('Показать ещё записи');
  expect(host.querySelectorAll('li')).toHaveLength(1);
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await click('Повторить');
  expect(host.querySelectorAll('li')).toHaveLength(2);
  expect(api.mock.calls[2][0].cursor).toBe('next');
});
it('discards a late response after category change and resets the continuation', async () => {
  let resolve!: (result: AdminApiResult<AdminHistoryPage>) => void;
  const api = vi
    .spyOn(adminApi, 'userHistory')
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce(ok([{ ...item, key: 'ai:new', id: 'new' }]));
  await show();
  await click('История проектов, публикаций и ИИ');
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Загружаем');
  await act(async () => {
    const select = host.querySelector('select')!;
    select.value = 'ai';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => resolve(ok([{ ...item, key: 'project:stale', title: 'STALE' }], 'stale')));
  expect(host.textContent).not.toContain('STALE');
  expect(api.mock.calls.at(-1)![0]).toMatchObject({ category: 'ai', cursor: null });
});
it('does not retain records across actor changes and clears history on access revocation', async () => {
  const denied = vi.fn();
  vi.spyOn(adminApi, 'userHistory')
    .mockResolvedValueOnce(ok([item]))
    .mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: { code: 'forbidden', message: 'forbidden' },
    });
  await show('one', denied);
  await click('История проектов, публикаций и ИИ');
  expect(host.querySelectorAll('li')).toHaveLength(1);
  await show('two', denied);
  expect(host.querySelectorAll('li')).toHaveLength(0);
  expect(denied).toHaveBeenCalledOnce();
});

it('distinguishes empty retained history from unavailable coverage and can restart an expired continuation', async () => {
  const api = vi
    .spyOn(adminApi, 'userHistory')
    .mockResolvedValueOnce(ok([item], 'expired'))
    .mockResolvedValueOnce({
      ok: false,
      status: 400,
      error: { code: 'expired', message: 'expired' },
    })
    .mockResolvedValueOnce(ok([]))
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { items: [], next: null, asOf: '2026-10-25T12:00:00Z', coverage: 'unavailable_scope' },
    });
  await show();
  await click('История проектов, публикаций и ИИ');
  await click('Показать ещё записи');
  expect(host.textContent).toContain('Срок страницы истёк');
  await click('Обновить историю');
  expect(api.mock.calls.at(-1)![0].cursor).toBeNull();
  expect(host.textContent).toContain('Сохранившихся записей в этом разделе нет');
  await act(async () => {
    const select = host.querySelector('select')!;
    select.value = 'ai';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(host.textContent).toContain('Личная история недоступна');
  expect(host.textContent).not.toContain('Сохранившихся записей в этом разделе нет');
});
