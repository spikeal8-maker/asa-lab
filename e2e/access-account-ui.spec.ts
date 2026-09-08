import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const evidence = 'e2e/artifacts/owner-preview/access-a-ui';
test.beforeAll(() => mkdirSync(evidence, { recursive: true }));

async function fixture(
  page: Page,
  options: { profileFailure?: boolean; secondaryFailure?: boolean } = {},
) {
  const mutations: string[] = [];
  let failing = options.profileFailure ?? false;
  let secondaryFailure = options.secondaryFailure ?? false;
  let educator = false;
  const workspaces = [
    {
      workspaceId: '10000000-0000-4000-8000-000000000001',
      kind: 'personal',
      title: 'Личное пространство',
      role: 'owner',
    },
  ];
  let profile = {
    username: 'access.preview',
    displayName: 'Проверочный профиль',
    bio: '',
    email: 'access@example.test',
    birthDate: '1990-01-01',
    country: 'RU',
    emailVerificationState: 'unverified',
  };
  const capabilities = () => [
    { capability: 'creator', state: 'verified' },
    ...(educator ? [{ capability: 'educator', state: 'provisional' }] : []),
  ];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const reply = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (!['GET', 'HEAD'].includes(method)) mutations.push(path);
    if (path === '/api/auth/me')
      return reply({
        authenticated: true,
        user: {
          id: '20000000-0000-4000-8000-000000000001',
          email: profile.email,
          displayName: profile.displayName,
        },
        account: {
          id: '20000000-0000-4000-8000-000000000001',
          email: profile.email,
          displayName: profile.displayName,
        },
        capabilities: capabilities(),
        workspaces,
        activeWorkspace: { workspaceId: workspaces[0].workspaceId, kind: 'personal' },
        navigation: {
          classes: educator,
          classroomManagement: educator,
          contentAuthoring: educator,
        },
        timeZone: 'Europe/Moscow',
      });
    if (path === '/api/account/profile') {
      if (failing) return reply({ error: { code: 'unavailable', message: 'test failure' } }, 503);
      if (method === 'PATCH') profile = { ...profile, ...request.postDataJSON() };
      return reply({ ...profile, capabilities: capabilities(), workspaces });
    }
    if (path === '/api/account/avatar')
      return secondaryFailure
        ? reply({ error: { code: 'unavailable', message: 'avatar unavailable' } }, 503)
        : reply({ avatarDataUrl: null });
    if (path === '/api/account/sessions')
      return secondaryFailure
        ? reply({ error: { code: 'unavailable', message: 'sessions unavailable' } }, 503)
        : reply({ items: [] });
    if (path === '/api/auth/max/status')
      return secondaryFailure
        ? reply({ error: { code: 'unavailable', message: 'MAX unavailable' } }, 503)
        : reply({
            linked: false,
            verifiedAt: null,
            firstAuthenticatedAt: null,
            promptDue: false,
            promptDismissedUntil: null,
            available: false,
          });
    if (path === '/api/auth/max/config') return reply({ enabled: false, launchUrl: null });
    if (path === '/api/account/password')
      return reply({ configured: true, canResetWithoutCurrent: false });
    if (path === '/api/capabilities/educator/self-attest') {
      educator = true;
      return reply({ capability: 'educator', state: 'provisional', created: true });
    }
    if (path === '/api/classrooms/awaiting-review') return reply({ total: 0 });
    // Read-only empty fixture data, never forwarded to a real API.
    if (method === 'GET') return reply({ items: [], meta: { total: 0 } });
    return reply({ error: { code: 'unexpected_mutation', message: path } }, 400);
  });
  return {
    mutations,
    recoverProfile: () => {
      failing = false;
    },
    recoverSecondary: () => {
      secondaryFailure = false;
    },
  };
}

const panel = (page: Page, name: string) =>
  page.getByLabel('Разделы настроек').getByRole('button', { name, exact: true });

test('profile failure shows retry instead of an endless spinner', async ({ page }) => {
  const state = await fixture(page, { profileFailure: true });
  await page.goto('/#/account');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить профиль');
  await expect(page.getByText('Загружаем настройки…')).toHaveCount(0);
  state.recoverProfile();
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Проверочный профиль');
});

test('secondary failure cannot block profile, grant educator, or erase a dirty draft', async ({
  page,
}) => {
  const state = await fixture(page, { secondaryFailure: true });
  await page.goto('/#/account');
  const name = page.getByLabel('Отображаемое имя');
  await expect(name).toBeVisible();
  await expect(page.getByLabel(/Кто вы в ASA Lab/)).toHaveCount(0);
  await name.fill('Мой несохранённый текст');
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(name).toHaveValue('Мой несохранённый текст');
  state.recoverSecondary();
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(page.getByText(/Не удалось обновить:/)).toHaveCount(0);
  await expect(name).toHaveValue('Мой несохранённый текст');
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Изменения сохранены.' })).toBeVisible();
  expect(state.mutations).toContain('/api/account/profile');
  expect(state.mutations).not.toContain('/api/account/role');
  expect(state.mutations).not.toContain('/api/capabilities/educator/self-attest');
  await page.reload();
  await expect(name).toHaveValue('Мой несохранённый текст');
});

test('unknown MAX is not disconnected; teaching is a separate explicit action', async ({
  page,
}) => {
  const state = await fixture(page, { secondaryFailure: true });
  await page.goto('/#/account');
  await panel(page, 'Вход и безопасность').click();
  await expect(page.getByText('Статус недоступен', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подключить MAX', exact: true })).toHaveCount(0);
  await panel(page, 'Возможности').click();
  await page.getByRole('button', { name: 'Подключить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть классы', exact: true })).toBeVisible();
  expect(
    state.mutations.filter((path) => path === '/api/capabilities/educator/self-attest'),
  ).toHaveLength(1);
  expect(state.mutations).not.toContain('/api/schools');
  expect(state.mutations).not.toContain('/api/account/role');
});

for (const width of [1440, 1024, 390, 320])
  test(`eight account panels fit ${width}px without horizontal overflow`, async ({ page }) => {
    await fixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/account');
    if (width <= 900)
      await expect(page.getByLabel('Выбрать раздел настроек').locator('option')).toHaveCount(8);
    else await expect(page.getByLabel('Разделы настроек').getByRole('button')).toHaveCount(8);
    for (const name of [
      'Профиль',
      'Вход и безопасность',
      'Интерфейс',
      'Возможности',
      'Мои доступы',
    ]) {
      if (width <= 900)
        await page.getByLabel('Выбрать раздел настроек').selectOption({ label: name });
      else await panel(page, name).click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      expect(overflow, `${width}px ${name}`).toBe(false);
    }
    if (width <= 900)
      await page.getByLabel('Выбрать раздел настроек').selectOption({ label: 'Профиль' });
    else await panel(page, 'Профиль').click();
    await page.screenshot({ path: `${evidence}/account-${width}.png`, fullPage: true });
  });
