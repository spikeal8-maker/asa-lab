// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  type AccountProfile,
  type ClassroomStudentSession,
  type LearningNotificationPreferences as Preferences,
  type SessionPayload,
} from '../../apps/web/src/api';
import { AccountPage } from '../../apps/web/src/pages/AccountPage';
import { SeatAccountPage } from '../../apps/web/src/pages/SeatAccountPage';
import { requestSettingsNavigation } from '../../apps/web/src/components/settings-navigation';
import { creatorViewFromHash } from '../../apps/web/src/creator-portal/navigation';

const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
const preferences: Preferences = {
  revision: 0,
  masterEnabled: true,
  categories: {
    NC01: true,
    NC02: true,
    NC03: true,
    NC04: true,
    NC05: true,
    NC06: true,
    NC08: true,
  },
  classOverrides: {},
  classes: [],
};
const session: SessionPayload = {
  authenticated: true,
  user: { id: 'account-1', displayName: 'Личный профиль', email: 'private@example.test' },
  account: { id: 'account-1', displayName: 'Личный профиль', email: 'private@example.test' },
  capabilities: [],
  workspaces: [
    { workspaceId: 'personal-1', kind: 'personal', title: 'Личное пространство', role: 'owner' },
  ],
  activeWorkspace: { workspaceId: 'personal-1', kind: 'personal' },
  navigation: { classes: false, classroomManagement: false, contentAuthoring: false },
  timeZone: 'Europe/Moscow',
};
const profile: AccountProfile = {
  username: 'personal.name',
  displayName: 'Личный профиль',
  bio: 'Мои интересы',
  email: 'private@example.test',
  birthDate: '1990-01-01',
  country: 'RU',
  emailVerificationState: 'unverified',
  capabilities: [],
  workspaces: session.workspaces,
};
let container: HTMLDivElement;
let root: Root;
beforeAll(() => {
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});
beforeEach(() => {
  window.history.replaceState(null, '', '/#/account');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(api, 'accountProfile').mockResolvedValue({ ok: true, status: 200, data: profile });
  vi.spyOn(api, 'accountAvatar').mockResolvedValue({
    ok: true,
    status: 200,
    data: { avatarDataUrl: null },
  });
  vi.spyOn(api, 'listAccountSessions').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [] },
  });
  vi.spyOn(api, 'maxStatus').mockResolvedValue({
    ok: false,
    status: 503,
    error: { code: 'unavailable', message: 'Unavailable' },
  });
  vi.spyOn(api, 'maxConfig').mockResolvedValue({
    ok: true,
    status: 200,
    data: { enabled: false, launchUrl: null },
  });
  vi.spyOn(api, 'accountPasswordStatus').mockResolvedValue({
    ok: true,
    status: 200,
    data: { configured: true, canResetWithoutCurrent: false },
  });
  vi.spyOn(api, 'learningNotificationPreferences').mockResolvedValue({
    ok: true,
    status: 200,
    data: preferences,
  });
  vi.spyOn(api, 'me').mockResolvedValue({ ok: true, status: 200, data: session });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function renderAccount(nextSession = session) {
  await act(async () =>
    root.render(
      createElement(AccountPage, {
        session: nextSession,
        onSessionChanged: vi.fn(),
        onOpenClasses: vi.fn(),
      }),
    ),
  );
}
function button(text: string, within: ParentNode = container) {
  const found = [...within.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
async function click(text: string, within?: ParentNode) {
  await act(async () => button(text, within).click());
}
function input(label: string) {
  const found = [...container.querySelectorAll('label')]
    .find((element) => element.textContent?.includes(label))
    ?.querySelector('input');
  if (!found) throw new Error(`Missing input ${label}`);
  return found;
}
async function fill(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('account settings composition', () => {
  it('addresses every existing panel and keeps the historical account route', () => {
    for (const id of [
      'profile',
      'interface',
      'notifications',
      'security',
      'privacy',
      'capabilities',
      'school',
      'requests',
    ])
      expect(creatorViewFromHash(`#/account/${id}`)).toEqual({ kind: 'account' });
    expect(creatorViewFromHash('#/account')).toEqual({ kind: 'account' });
  });
  it('shows a public-only draft preview and cancelling restores server values', async () => {
    await renderAccount();
    await fill(input('Отображаемое имя'), 'Мой черновик');
    const preview = container.querySelector('[aria-label="Предпросмотр публичного профиля"]');
    expect(preview?.textContent).toContain('Мой черновик');
    expect(preview?.textContent).not.toContain(profile.email);
    expect(preview?.textContent).not.toContain(profile.birthDate);
    await click('Отменить');
    expect(input('Отображаемое имя').value).toBe(profile.displayName);
  });
  it('protects tab and shell navigation, keeps the draft on stay, and never navigates after a failed save', async () => {
    const save = vi.spyOn(api, 'updateAccountProfile').mockResolvedValue({
      ok: false,
      status: 503,
      error: { code: 'unavailable', message: 'Повторите позже' },
    });
    await renderAccount();
    await fill(input('Отображаемое имя'), 'Мой черновик');
    await click('Интерфейс');
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await click('Остаться');
    expect(input('Отображаемое имя').value).toBe('Мой черновик');
    const navigate = vi.fn();
    await act(async () => requestSettingsNavigation(navigate));
    await click('Сохранить и перейти');
    expect(save).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    await click('Отменить изменения и перейти');
    expect(navigate).toHaveBeenCalledOnce();
    expect(input('Отображаемое имя').value).toBe(profile.displayName);
  });
  it('traps avatar focus, supports Escape and restores the opener', async () => {
    await renderAccount();
    button('Выбрать аватар').focus();
    await click('Выбрать аватар');
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const buttons = [...dialog.querySelectorAll('button')];
    expect(document.activeElement).toBe(buttons[0]);
    await act(async () =>
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(buttons.at(-1));
    await act(async () =>
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button('Выбрать аватар'));
  });
  it('filters staff notifications from the server projection without deleting hidden stored categories', async () => {
    const save = vi
      .spyOn(api, 'saveLearningNotificationPreferences')
      .mockImplementation(async (value) => ({
        ok: true,
        status: 200,
        data: { ...preferences, masterEnabled: value.masterEnabled, categories: value.categories },
      }));
    await renderAccount();
    await click('Уведомления');
    const form = container.querySelector('.learning-notification-settings')!;
    expect(form.textContent).not.toContain('Работы на проверку');
    await act(async () => form.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click('Сохранить оповещения');
    expect(save.mock.calls[0]?.[0].categories.NC02).toBe(true);
    await act(async () =>
      root.render(
        createElement(AccountPage, {
          session: { ...session, navigation: { ...session.navigation, classroomManagement: true } },
          onSessionChanged: vi.fn(),
          onOpenClasses: vi.fn(),
        }),
      ),
    );
    expect(form.textContent).toContain('Работы на проверку');
  });
  it('retains notification draft while the user cancels a transition and discards it only explicitly', async () => {
    await renderAccount();
    await click('Уведомления');
    const checkbox = container.querySelector<HTMLInputElement>(
      '.learning-notification-settings input[type="checkbox"]',
    )!;
    await act(async () => checkbox.click());
    await click('Профиль');
    await click('Остаться');
    expect(checkbox.checked).toBe(false);
    await click('Профиль');
    await click('Отменить изменения и перейти');
    await click('Уведомления');
    expect(checkbox.checked).toBe(true);
  });
  it('distinguishes a Seat awards failure from no achievements and retries without account mutations', async () => {
    const awards = vi
      .spyOn(api, 'mySeatAwards')
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        error: { code: 'unavailable', message: 'Unavailable' },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { items: [] } });
    const seat: ClassroomStudentSession = {
      authenticated: true,
      student: { seatId: 'seat-1', displayName: 'Ученик', safeMode: true, avatarKey: null },
      classroom: { id: 'class-1', title: 'Класс', teacherDisplayName: 'Преподаватель' },
      expiresAt: '2030-01-01T00:00:00Z',
    };
    await act(async () =>
      root.render(createElement(SeatAccountPage, { seat, onSeatChanged: vi.fn() })),
    );
    expect(container.textContent).toContain('Не удалось загрузить значки');
    expect(container.textContent).not.toContain('Пока ни одного');
    await click('Повторить загрузку значков');
    expect(awards).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Пока ни одного');
    expect(container.querySelectorAll('[aria-label="Разделы настроек"] button')).toHaveLength(3);
  });
});
