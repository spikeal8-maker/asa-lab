// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { CrmUserCard, CrmDocumentView } from '../CrmUserCard';
import { crmApi, type CrmContentPage } from '../crm-user-api';
import { crmProfileFixture, CRM_ID } from './crm-user.fixture';
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
const ok = <T>(data: T) => ({ ok: true as const, status: 200, data });
async function show(
  kind: 'account' | 'student' = 'account',
  targetId = CRM_ID,
  onAccessDenied = vi.fn(),
  onChanged = vi.fn(),
) {
  await act(async () =>
    root.render(createElement(CrmUserCard, { kind, targetId, onAccessDenied, onChanged })),
  );
}
async function button(text: string) {
  await act(async () =>
    [...host.querySelectorAll('button')].find((item) => item.textContent === text)!.click(),
  );
}
it('shows typed profile/age/roles; successful profile change updates from server and invalidates the directory', async () => {
  const profile = crmProfileFixture('student'),
    changed = vi.fn();
  vi.spyOn(crmApi, 'profile').mockResolvedValue(ok(profile));
  const save = vi
    .spyOn(crmApi, 'saveProfile')
    .mockResolvedValue(ok({ ...profile, version: 'b'.repeat(64) }));
  await show('student', CRM_ID, vi.fn(), changed);
  expect(host.textContent).toContain('11 лет');
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(save.mock.calls[0][1]).toMatchObject({
    version: profile.version,
    birthDate: '2015-01-01',
  });
  expect(changed).toHaveBeenCalledOnce();
});
it('retains input on concurrent-profile conflict and teachers receive read-only fields without capability controls', async () => {
  vi.spyOn(crmApi, 'profile')
    .mockResolvedValueOnce(ok(crmProfileFixture()))
    .mockResolvedValueOnce(
      ok({ ...crmProfileFixture('student'), canEdit: false, canManageCapabilities: false }),
    );
  vi.spyOn(crmApi, 'saveProfile').mockResolvedValue({
    ok: false,
    status: 409,
    error: { code: 'crm_conflict', message: 'Данные уже изменились' },
  });
  await show();
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('уже изменились');
  expect((host.querySelector('input') as HTMLInputElement).value).toContain('Полное имя');
  await show('student');
  expect([...host.querySelectorAll('input')].every((input) => input.disabled)).toBe(true);
  expect(host.textContent).not.toContain('Изменить право');
});
it('renders transcript as literal text, preserves pages on retry and ignores late data after identity change', async () => {
  vi.spyOn(crmApi, 'profile').mockResolvedValue(ok(crmProfileFixture()));
  let finish!: (value: ReturnType<typeof ok<CrmContentPage>>) => void;
  const content = vi
    .spyOn(crmApi, 'content')
    .mockResolvedValueOnce(
      ok({
        items: [
          {
            id: 'one',
            occurredAt: '2026-10-25T10:00:00Z',
            role: 'user',
            text: '<script>do not execute</script>',
          },
        ],
        next: 'next',
      }),
    )
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: { code: 'offline', message: 'Нет связи' },
    })
    .mockResolvedValueOnce(
      ok({
        items: [
          { id: 'two', occurredAt: '2026-10-25T10:00:01Z', role: 'assistant', text: 'Ответ' },
        ],
        next: null,
      }),
    )
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
  await show();
  await button('Переписка с ИИ');
  expect(host.textContent).toContain('<script>do not execute</script>');
  expect(host.querySelector('script')).toBeNull();
  await button('Ещё записи');
  expect(host.querySelectorAll('li')).toHaveLength(1);
  await button('Повторить');
  expect(host.querySelectorAll('li')).toHaveLength(2);
  expect(content.mock.calls[2][2]).toBe('next');
  await button('Проекты');
  await show('account', '20000000-0000-4000-8000-000000000003');
  await act(async () =>
    finish(
      ok({
        items: [{ id: 'stale', title: 'OLD IDENTITY', occurredAt: '2026-10-25T10:00:00Z' }],
        next: null,
      }),
    ),
  );
  expect(host.textContent).not.toContain('OLD IDENTITY');
});
it('retains the visible access pane during refresh and scrubs it when access is denied', async () => {
  const denied = vi.fn();
  let resolve!: (value: Awaited<ReturnType<typeof crmApi.profile>>) => void;
  vi.spyOn(crmApi, 'profile')
    .mockResolvedValueOnce(ok(crmProfileFixture('student')))
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  await show('student', CRM_ID, denied);
  await button('Безопасность и доступ');
  const field = host.querySelector('.crm-full-reason textarea');
  expect(host.textContent).toContain('Приостановить доступ ученика');
  await button('Обновить карточку');
  expect(host.querySelector('.crm-full-reason textarea')).toBe(field);
  await act(async () =>
    resolve({ ok: false, status: 403, error: { code: 'denied', message: 'Недоступно' } }),
  );
  expect(denied).toHaveBeenCalledOnce();
  expect(host.querySelector('.crm-full-reason textarea')).toBeNull();
  expect(host.textContent).not.toContain('Приостановить доступ ученика');
});
it('ignores a profile response after the subject changes, even when Account and Seat share an ID', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof crmApi.profile>>) => void;
  vi.spyOn(crmApi, 'profile')
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValueOnce(ok(crmProfileFixture('student')));
  await show();
  await show('student');
  await act(async () => resolve(ok({ ...crmProfileFixture(), name: 'OLD PRIVATE ACCOUNT' })));
  expect(host.textContent).not.toContain('OLD PRIVATE ACCOUNT');
  expect(host.textContent).toContain('11 лет');
});
it('does not restore a card from an older profile refresh after content access is revoked', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof crmApi.profile>>) => void;
  const denied = vi.fn();
  vi.spyOn(crmApi, 'profile')
    .mockResolvedValueOnce(ok(crmProfileFixture('student')))
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  vi.spyOn(crmApi, 'content').mockResolvedValue({
    ok: false,
    status: 403,
    error: { code: 'denied', message: 'Доступ отозван' },
  });
  await show('student', CRM_ID, denied);
  await button('Обновить карточку');
  await button('Входы и действия');
  await act(async () =>
    resolve(ok({ ...crmProfileFixture('student'), name: 'OLD PRIVATE PROFILE' })),
  );
  expect(denied).toHaveBeenCalled();
  expect(host.textContent).not.toContain('OLD PRIVATE PROFILE');
  expect(host.querySelector('nav')).toBeNull();
});

it('never displays a latest snapshot as a saved version and keeps document data behind disclosure', async () => {
  await act(async () =>
    root.render(
      createElement(CrmDocumentView, {
        value: {
          projectId: CRM_ID,
          title: 'Версия',
          module: 'electronics',
          revision: 2,
          source: 'saved_version',
          updatedAt: '2026-10-25T10:00:00Z',
          document: { components: [{ id: 'one' }] },
          preview: { dataUrl: 'data:image/png;base64,latest', revision: 99 },
        },
      }),
    ),
  );
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('details')!.open).toBe(false);
  expect(host.textContent).toContain('1 элементов');
  expect(host.textContent).toContain('Скачать документ JSON');
});
