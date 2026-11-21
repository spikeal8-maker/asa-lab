// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { CrmUserDashboard } from '../CrmUserDashboard';
import { crmApi } from '../crm-user-api';
import { crmDashboardFixture, CRM_ID } from './crm-user.fixture';
let host: HTMLDivElement, root: Root;
const subject = { kind: 'account' as const, targetId: CRM_ID };
const ok = (kind: 'account' | 'student' = 'account') => ({
  ok: true as const,
  status: 200,
  data: crmDashboardFixture(kind),
});
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
async function show(target = subject.targetId, denied = vi.fn()) {
  await act(async () =>
    root.render(
      createElement(CrmUserDashboard, {
        subject: { ...subject, targetId: target },
        onAccessDenied: denied,
      }),
    ),
  );
}
it('starts with compact factual totals and two 30-day charts without edit controls or invented rating', async () => {
  vi.spyOn(crmApi, 'dashboard').mockResolvedValue(ok());
  await show();
  expect(host.querySelectorAll('svg[role="img"]')).toHaveLength(2);
  expect(host.querySelectorAll('circle')).toHaveLength(60);
  expect(host.querySelectorAll('circle[tabindex="0"]')).toHaveLength(2);
  await act(async () =>
    host
      .querySelector('circle')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
  );
  expect(host.querySelectorAll('circle')[1]!.getAttribute('tabindex')).toBe('0');
  expect(host.querySelectorAll('circle[tabindex="0"]')).toHaveLength(2);
  expect(host.textContent).toContain('Сохранение проекта');
  expect(host.textContent).toContain('Электроника');
  expect(host.textContent).toContain('Общий рейтинг ещё не настроен');
  expect(host.textContent).toContain('Бонусы ИИ автоматически не начисляются');
  expect(host.querySelector('input')).toBeNull();
});
it('shows canonical classroom rating and place without converting it into AI credits', async () => {
  vi.spyOn(crmApi, 'dashboard').mockResolvedValue(ok('student'));
  await show();
  expect(host.textContent).toContain('Учебный рейтинг класса');
  expect(host.textContent).toContain('78');
  expect(host.textContent).toContain('Место в классе: 2');
});
it('keeps an error distinct from empty or zero activity and retries', async () => {
  const request = vi
    .spyOn(crmApi, 'dashboard')
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: { code: 'unavailable', message: 'offline' },
    })
    .mockResolvedValueOnce(ok());
  await show();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('svg')).toBeNull();
  await act(async () => host.querySelector('button')!.click());
  expect(request).toHaveBeenCalledTimes(2);
  expect(host.querySelectorAll('svg')).toHaveLength(2);
});
it('does not display a late previous user dashboard and scrubs the current view on denied access', async () => {
  let finish!: (value: ReturnType<typeof ok>) => void;
  vi.spyOn(crmApi, 'dashboard')
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    )
    .mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: { code: 'forbidden', message: 'denied' },
    });
  await show();
  const denied = vi.fn();
  await show('other-user', denied);
  await act(async () => finish(ok()));
  expect(denied).toHaveBeenCalledOnce();
  expect(host.querySelector('svg')).toBeNull();
  expect(host.textContent).not.toContain('Сохранение проекта');
});
it('renders genuine empty history without implying a configured zero reputation', async () => {
  const value = ok();
  value.data.activity = [];
  value.data.latestActions = [];
  value.data.lastSeenAt = null;
  value.data.lastActionAt = null;
  vi.spyOn(crmApi, 'dashboard').mockResolvedValue(value);
  await show();
  expect(host.textContent).toContain('Действия пока не зафиксированы');
  expect(host.textContent).toContain('Не зафиксировано');
  expect(host.querySelectorAll('circle')).toHaveLength(0);
});
