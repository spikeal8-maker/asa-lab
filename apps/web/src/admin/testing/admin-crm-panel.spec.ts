// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UserCrmPanel } from '../AdminPage';
import { adminApi, type AdminAccountCrm, type AdminScope } from '../admin-api';
import { crmApi } from '../crm-user-api';
import { crmProfileFixture, crmDashboardFixture } from './crm-user.fixture';
import { catalogUserFixture } from './admin-user-catalog.fixture';
let host: HTMLDivElement, root: Root;
const account = catalogUserFixture('account').account!;
const scope: AdminScope = {
  kind: 'platform',
  id: null,
  title: 'ASA Lab',
  role: 'platform_admin',
  permissions: [],
};
const detail: AdminAccountCrm = {
  ...account,
  email: account.email!,
  firstAuthenticatedAt: null,
  organizations: [],
  sessions: [],
  activity: [],
  ipAddresses: [],
  notes: [],
  max: { linked: false, verifiedAt: null },
  moduleUsage: [],
};
const ok = <T>(data: T) => ({ ok: true as const, status: 200, data });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(crmApi, 'profile').mockResolvedValue(ok(crmProfileFixture()));
  vi.spyOn(crmApi, 'dashboard').mockResolvedValue(ok(crmDashboardFixture()));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function show(denied = vi.fn(), selected = account) {
  await act(async () =>
    root.render(
      createElement(UserCrmPanel, {
        account: selected,
        scope: { ...scope },
        currentAccountId: account.accountId,
        canManage: true,
        onChanged: vi.fn(),
        onAccessDenied: denied,
      }),
    ),
  );
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Профиль')?.click(),
  );
}
async function click(text: string) {
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === text)!.click(),
  );
}
async function input(node: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('keeps selected pane and mounted fields during same-context refresh; rejects stale refresh on permission loss', async () => {
  let resolve!: (result: Awaited<ReturnType<typeof adminApi.accountCrm>>) => void;
  const read = vi
    .spyOn(adminApi, 'accountCrm')
    .mockResolvedValueOnce(ok(detail))
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  vi.spyOn(adminApi, 'addAccountNote').mockResolvedValue(ok({ id: 'note-one' }));
  await show();
  await show(); // New callback and scope object are not a new subject.
  expect(read).toHaveBeenCalledTimes(1);
  await click('Заметки');
  const field = host.querySelector('textarea')!;
  await input(field, 'Контекст пользователя');
  await click('Добавить');
  expect(read).toHaveBeenCalledTimes(2);
  expect(host.querySelector('textarea')).toBe(field);
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Заметки');
  await act(async () =>
    resolve({ ok: false, status: 403, error: { code: 'denied', message: 'Недоступно' } }),
  );
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.textContent).not.toContain('Контекст пользователя');
});
it('keeps self administrative and login protections reachable together with scoped capability controls', async () => {
  vi.spyOn(adminApi, 'accountCrm').mockResolvedValue(ok(detail));
  await show();
  await show(vi.fn(), { ...account, isPlatformAdmin: true });
  await click('Безопасность и доступ');
  expect(host.textContent).toContain('Изменить право');
  expect(host.textContent).toContain('Вход в аккаунт и администратор платформы');
  const block = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'Заблокировать вход',
  )!;
  const outerReason = host.querySelector('.admin-reason-field textarea') as HTMLTextAreaElement;
  await input(outerReason, 'Проверка защиты');
  expect(block.disabled).toBe(true);
  expect(
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Снять роль администратора')!
      .disabled,
  ).toBe(true);
  expect(host.textContent).toContain('Собственный доступ и роль нельзя отозвать');
});

it('discards a late old-account CRM result after switching subjects', async () => {
  let resolve!: (result: Awaited<ReturnType<typeof adminApi.accountCrm>>) => void;
  vi.spyOn(adminApi, 'accountCrm')
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValueOnce(ok({ ...detail, email: 'current-account@example.test' }));
  await show();
  await show(vi.fn(), { ...account, accountId: '20000000-0000-4000-8000-000000000003' });
  await act(async () => resolve(ok({ ...detail, email: 'OLD-PRIVATE-ACCOUNT@example.test' })));
  expect(host.textContent).toContain('current-account@example.test');
  expect(host.textContent).not.toContain('OLD-PRIVATE-ACCOUNT');
});
