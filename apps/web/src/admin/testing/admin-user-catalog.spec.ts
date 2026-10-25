// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { AdminUsersCatalog } from '../AdminUsersCatalog';
import {
  adminApi,
  type AdminScope,
  type AdminCatalogPage,
  type AdminApiResult,
} from '../admin-api';
import { catalogUserFixture, catalogPageFixture } from './admin-user-catalog.fixture';
let host: HTMLDivElement, root: Root;
const scope: AdminScope = {
  kind: 'platform',
  id: null,
  title: 'ASA Lab',
  role: 'platform_admin',
  permissions: ['administration.accounts.read'],
};
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
const ok = (page: AdminCatalogPage) => ({ ok: true as const, status: 200, data: page });
const renderAccount = vi.fn((user: ReturnType<typeof catalogUserFixture>) =>
  createElement('article', { 'data-account-key': user.actorKey }, user.displayName),
);
async function show(selected = scope, denied = vi.fn()) {
  await act(async () =>
    root.render(
      createElement(AdminUsersCatalog, {
        scope: selected,
        version: 0,
        onAccessDenied: denied,
        renderAccount,
      }),
    ),
  );
}
async function button(text: string) {
  await act(async () =>
    [...host.querySelectorAll('button')].find((item) => item.textContent === text)!.click(),
  );
}
async function select(label: string, value: string) {
  const node = [...host.querySelectorAll('label')]
    .find((item) => item.textContent?.startsWith(label))!
    .querySelector('select')!;
  await act(async () => {
    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
it('keeps server ordering, typed same-UUID Account and Seat entries, and account-only rendering', async () => {
  const ordinary = catalogUserFixture('account', undefined, 'Я — аккаунт');
  const account = { ...ordinary, email: null, account: { ...ordinary.account!, email: null } };
  const seat = {
    ...catalogUserFixture('student', account.id, 'А — ученическое место'),
    login: 'nonpublic-fixture-value',
  };
  vi.spyOn(adminApi, 'users').mockResolvedValue(ok(catalogPageFixture([account, seat])));
  renderAccount.mockClear();
  await show();
  expect(host.textContent!.indexOf('Я — аккаунт')).toBeLessThan(
    host.textContent!.indexOf('А — ученическое место'),
  );
  expect(renderAccount).toHaveBeenCalledTimes(1);
  expect(host.textContent!.includes(seat.login)).toBe(false);
  expect(host.querySelector('[data-actor-key^="student:"] button')).toBeNull();
  expect(host.textContent).toContain('Выдано');
});
it('loads every server page with its opaque cursor, no first-50 client sort', async () => {
  const rows = Array.from({ length: 50 }, (_, i) =>
    catalogUserFixture(
      'student',
      `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      `Строка ${i}`,
    ),
  );
  const api = vi
    .spyOn(adminApi, 'users')
    .mockResolvedValueOnce(ok(catalogPageFixture(rows, 'opaque')))
    .mockResolvedValueOnce(
      ok(
        catalogPageFixture([catalogUserFixture('student', '20000000-0000-4000-8000-999999999999')]),
      ),
    );
  await show();
  await button('Показать ещё');
  expect(api.mock.calls[1]![0].cursor).toBe('opaque');
  expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(51);
  expect(host.textContent).toContain('Показано записей: 51');
});
it('sends server filters/sort/direction and resets cursor for every criteria change', async () => {
  const api = vi
    .spyOn(adminApi, 'users')
    .mockResolvedValue(ok(catalogPageFixture([catalogUserFixture('student')], 'old')));
  await show();
  for (const [label, value, field] of [
    ['Тип записи', 'students', 'kind'],
    ['Состояние записи', 'inactive', 'status'],
    ['Сортировка', 'name', 'sort'],
    ['Направление', 'asc', 'direction'],
  ] as const) {
    await select(label, value);
    expect(api.mock.calls.at(-1)![0]).toMatchObject({ [field]: value, cursor: null });
  }
});
it('clears stale scope rows immediately and ignores its late page; exposes honest unavailable coverage', async () => {
  let resolve!: (result: AdminApiResult<AdminCatalogPage>) => void;
  const delayed = new Promise<AdminApiResult<AdminCatalogPage>>((done) => {
    resolve = done;
  });
  vi.spyOn(adminApi, 'users')
    .mockReturnValueOnce(delayed)
    .mockResolvedValueOnce(ok(catalogPageFixture([], null, true)));
  await show();
  await show({ ...scope, kind: 'organization', id: 'school' });
  await act(async () => resolve(ok(catalogPageFixture([catalogUserFixture('student')]))));
  expect(host.querySelector('[data-actor-key]')).toBeNull();
  expect(host.textContent).toContain('связь классов с организацией не подтверждена');
  vi.mocked(adminApi.users).mockResolvedValue(ok(catalogPageFixture([], null, true)));
  await select('Тип записи', 'students');
  expect(host.textContent).not.toContain('0 учеников');
});
it('shows loading/error/retry/empty states and preserves rows on pagination error', async () => {
  const api = vi
    .spyOn(adminApi, 'users')
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: { code: 'unavailable', message: 'safe' },
    })
    .mockResolvedValueOnce(ok(catalogPageFixture([catalogUserFixture('student')], 'more')))
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: { code: 'unavailable', message: 'safe' },
    });
  await show();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await button('Повторить');
  await button('Показать ещё');
  expect(host.querySelector('[data-actor-key]')).not.toBeNull();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  api.mockResolvedValueOnce(ok(catalogPageFixture()));
  await select('Тип записи', 'accounts');
  expect(host.textContent).toContain('Пользователи не найдены');
});
it.each([401, 403])('revokes rows on %s rather than retaining prior page', async (status) => {
  const denied = vi.fn();
  vi.spyOn(adminApi, 'users')
    .mockResolvedValueOnce(ok(catalogPageFixture([catalogUserFixture('student')], 'more')))
    .mockResolvedValueOnce({ ok: false, status, error: { code: 'denied', message: 'safe' } });
  await show(scope, denied);
  await button('Показать ещё');
  expect(denied).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-actor-key]')).toBeNull();
});

it('uses structured device fields once and keeps the fallback when they are absent', async () => {
  const seat = {
    ...catalogUserFixture('student'),
    browser: 'Chrome',
    operatingSystem: 'Windows',
    deviceCategory: 'desktop',
    lastDevice: 'Chrome · Windows',
  };
  vi.spyOn(adminApi, 'users').mockResolvedValue(ok(catalogPageFixture([seat])));
  await show();
  expect(host.textContent).toContain('Chrome · Windows · Компьютер');
  expect(host.textContent!.match(/Chrome/g)).toHaveLength(1);
  vi.mocked(adminApi.users).mockResolvedValue(
    ok(
      catalogPageFixture([{ ...seat, browser: null, operatingSystem: null, deviceCategory: null }]),
    ),
  );
  await select('Тип записи', 'students');
  expect(host.textContent).toContain('Chrome · Windows');
});
