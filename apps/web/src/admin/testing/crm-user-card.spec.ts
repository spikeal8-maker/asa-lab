// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { CrmUserCard } from '../CrmUserCard';
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
  await button('Все проекты');
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
