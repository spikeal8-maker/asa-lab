import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const evidence = 'e2e/artifacts/owner-preview/access-a-ui';
test.beforeAll(() => mkdirSync(evidence, { recursive: true }));
test.beforeEach(async ({ page }) => {
  const dist = resolve('apps/web/dist');
  // Serve only committed-build artifacts inside dist; no real API or server is
  // contacted. The fixture's more-specific API handler is installed afterwards.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4612' || url.pathname.startsWith('/api/'))
      return route.abort();
    const file = resolve(
      dist,
      `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
    );
    if (!file.startsWith(`${dist}${sep}`) || !existsSync(file)) return route.abort();
    return route.fulfill({ path: file });
  });
});

async function fixture(
  page: Page,
  options: {
    profileFailure?: boolean;
    secondaryFailure?: boolean;
    educator?: boolean;
    author?: boolean;
    seat?: boolean;
    awardsFailure?: boolean;
    notificationFailure?: boolean;
    organization?: boolean;
    platformAdmin?: boolean;
  } = {},
) {
  const mutations: string[] = [];
  let failing = options.profileFailure ?? false;
  let secondaryFailure = options.secondaryFailure ?? false;
  let educator = options.educator ?? false;
  let awardsFailure = options.awardsFailure ?? false;
  let notificationFailure = options.notificationFailure ?? false;
  let timeZone = 'Europe/Moscow';
  let preferences = {
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
    classes: [
      {
        id: 'class-1',
        title: 'Длинное название класса для проверки переносов и настроек уведомлений',
      },
    ],
  };
  const workspaces = [
    {
      workspaceId: '10000000-0000-4000-8000-000000000001',
      kind: 'personal',
      title: 'Личное пространство',
      role: 'owner',
    },
  ];
  if (options.organization)
    workspaces.push({
      workspaceId: '10000000-0000-4000-8000-000000000002',
      kind: 'organization',
      title: 'Организация с длинным названием для проверки списка доступов',
      role: 'school_admin',
    });
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
    ...(options.author ? [{ capability: 'content_author', state: 'verified' }] : []),
    ...(educator ? [{ capability: 'educator', state: 'provisional' }] : []),
    ...(options.platformAdmin ? [{ capability: 'platform_admin', state: 'verified' }] : []),
  ];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const reply = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (!['GET', 'HEAD'].includes(method)) mutations.push(path);
    if (path === '/api/admin/v1/dashboard')
      return reply(
        { error: { code: 'unavailable', message: 'Dashboard fixture unavailable' } },
        503,
      );
    if (path === '/api/admin/v1/me')
      return options.platformAdmin
        ? reply({
            administrator: true,
            principalId: 'admin-1',
            accountId: '20000000-0000-4000-8000-000000000001',
            displayName: profile.displayName,
            activeWorkspaceId: workspaces[0].workspaceId,
            scopes: [
              {
                kind: 'platform',
                id: null,
                title: 'ASA Lab',
                role: 'platform_admin',
                permissions: ['administration.open'],
              },
            ],
          })
        : reply({ error: { code: 'forbidden', message: 'Forbidden' } }, 403);
    if (path === '/api/class-join/me')
      return reply(
        options.seat
          ? {
              authenticated: true,
              student: {
                seatId: 'seat-1',
                displayName: 'Ученик с длинным именем',
                safeMode: true,
                avatarKey: null,
              },
              classroom: {
                id: 'class-1',
                title: 'Учебный класс',
                teacherDisplayName: 'Преподаватель',
              },
              expiresAt: '2030-01-01T00:00:00Z',
            }
          : { authenticated: false },
      );
    if (path === '/api/class-join/me/awards')
      return awardsFailure
        ? reply({ error: { code: 'unavailable', message: 'Unavailable' } }, 503)
        : reply({ items: [] });
    if (path === '/api/class-join/account/classes')
      return reply({
        items: [
          {
            seatId: 'seat-1',
            classroomId: 'class-1',
            classroomTitle: 'Учебный класс',
            teacherDisplayName: 'Преподаватель',
            openCount: 0,
            unfinishedCount: 0,
          },
        ],
      });
    if (path === '/api/classrooms/class-1')
      return reply({
        classroom: {
          id: 'class-1',
          title: 'Учебный класс',
          status: 'active',
          ageBand: 'mixed',
          topicKeys: [],
          safeModeDefault: true,
          studentCount: 0,
          joinCodeVersion: null,
          joinCodeStatus: null,
          joinCode: null,
          teacherRole: 'owner',
          workspaceKind: 'personal',
          workspaceTitle: 'Личное пространство',
          createdAt: '2026-01-01T00:00:00Z',
          archivedAt: null,
        },
      });
    if (path === '/api/learning/notifications/classes/class-1/reminders')
      return reply({ revision: 0, due: true, overdue: true });
    if (path === '/api/learning/notifications')
      return reply({ items: [], snapshot: '2026-01-01T00:00:00Z', unread: 0 });
    if (path === '/api/learning/notifications/preferences') {
      if (notificationFailure)
        return reply(
          { error: { code: 'unavailable', message: 'Настройки временно недоступны' } },
          503,
        );
      if (method === 'POST')
        preferences = {
          ...preferences,
          ...request.postDataJSON(),
          revision: preferences.revision + 1,
        };
      return reply(preferences);
    }
    if (path === '/api/account/time-zone') {
      timeZone = request.postDataJSON().timeZone;
      return reply({ timeZone });
    }
    if (path === '/api/auth/me' && options.seat) return reply({ authenticated: false });
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
          contentAuthoring: educator || options.author === true,
        },
        timeZone,
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
    recoverAwards: () => {
      awardsFailure = false;
    },
    recoverNotifications: () => {
      notificationFailure = false;
    },
  };
}

const panel = (page: Page, name: string) =>
  page.getByLabel('Разделы настроек').getByRole('button', { name, exact: true });

async function traverse(page: Page, direction: 'back' | 'forward') {
  // Wait for the requested browser entry change before asserting restoration;
  // otherwise an assertion could pass on the old URL before Back has happened.
  await page.evaluate(
    (step) =>
      new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true });
        window.history[step]();
      }),
    direction,
  );
}

for (const navigationApi of [true, false]) {
  const browserMode = navigationApi ? 'Navigation API' : 'without Navigation API';
  const disableNavigationApi = async (page: Page) => {
    if (!navigationApi)
      await page.addInitScript(() =>
        Object.defineProperty(window, 'navigation', { value: undefined, configurable: true }),
      );
  };
  for (const decision of [
    'Остаться',
    'Отменить изменения и перейти',
    'Сохранить и перейти',
    'Ошибка сохранения и повтор',
  ])
    test(`duplicate addresses retain their distinct history entries: ${decision} ${browserMode}`, async ({
      page,
    }) => {
      await disableNavigationApi(page);
      const state = await fixture(page);
      let failingSave = decision === 'Ошибка сохранения и повтор';
      await page.route('**/api/account/profile', async (route) => {
        if (route.request().method() === 'PATCH' && failingSave)
          return route.fulfill({
            status: 503,
            json: { error: { code: 'unavailable', message: 'profile save unavailable' } },
          });
        return route.fallback();
      });
      const entryIndex = () =>
        page.evaluate(() => {
          const browser = window as Window & {
            navigation?: { currentEntry?: { index: number } };
          };
          return browser.navigation?.currentEntry?.index ?? window.history.state?.asaRouteIndex;
        });
      const go = (delta: number) =>
        page.evaluate(
          (offset) =>
            new Promise<void>((resolve) => {
              window.addEventListener('popstate', () => resolve(), { once: true });
              window.history.go(offset);
            }),
          delta,
        );
      await page.goto('/#/account/notifications');
      await expect(page.getByLabel('Получать учебные оповещения')).toBeVisible();
      const firstIndex = await entryIndex();
      await panel(page, 'Профиль').click();
      await panel(page, 'Интерфейс').click();
      await panel(page, 'Профиль').click();
      const name = page.getByLabel('Отображаемое имя');
      await name.fill('Черновик повторяющегося адреса');
      const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
      await go(-1);
      await expect(guard).toBeVisible();
      await expect.poll(entryIndex).toBe(firstIndex + 3);
      // The history list can select an earlier entry with exactly the same URL.
      // URL-only deduplication would silently leave the browser at profile[1].
      await go(-2);
      await expect.poll(entryIndex).toBe(firstIndex + 3);
      await expect(name).toHaveValue('Черновик повторяющегося адреса');
      if (decision === 'Остаться') {
        await guard.getByRole('button', { name: decision, exact: true }).click();
        await expect(guard).toHaveCount(0);
        await expect.poll(entryIndex).toBe(firstIndex + 3);
        await expect(name).toHaveValue('Черновик повторяющегося адреса');
        await go(-2);
        await expect(guard).toBeVisible();
        await expect.poll(entryIndex).toBe(firstIndex + 3);
        await guard.getByRole('button', { name: 'Остаться', exact: true }).click();
        // A new Back decision must still target interface[2], not profile[1].
        await go(-1);
        await expect(guard).toBeVisible();
        await expect.poll(entryIndex).toBe(firstIndex + 3);
      }
      if (failingSave) {
        await guard.getByRole('button', { name: 'Сохранить и перейти', exact: true }).click();
        await expect(guard.getByRole('alert')).toContainText('Не удалось сохранить');
        await expect.poll(entryIndex).toBe(firstIndex + 3);
        await expect(name).toHaveValue('Черновик повторяющегося адреса');
        await go(-2);
        await expect.poll(entryIndex).toBe(firstIndex + 3);
        failingSave = false;
      }
      const saved = decision === 'Сохранить и перейти' || decision === 'Ошибка сохранения и повтор';
      await guard
        .getByRole('button', {
          name: saved ? 'Сохранить и перейти' : 'Отменить изменения и перейти',
          exact: true,
        })
        .click();
      await expect.poll(entryIndex).toBe(firstIndex + 2);
      await expect(page).toHaveURL(/#\/account\/interface$/);
      await expect(page.getByRole('heading', { name: 'Интерфейс', exact: true })).toBeVisible();
      // Assert every original entry in order in both directions; replacing the
      // notifications entry with interface must never satisfy this regression.
      for (const [offset, route] of [
        [1, 'profile'],
        [0, 'notifications'],
        [1, 'profile'],
        [2, 'interface'],
        [3, 'profile'],
      ] as const) {
        await go(firstIndex + offset - (await entryIndex()));
        await expect.poll(entryIndex).toBe(firstIndex + offset);
        await expect(page).toHaveURL(new RegExp(`#/account/${route}$`));
        if (route === 'profile')
          await expect(name).toHaveValue(
            saved ? 'Черновик повторяющегося адреса' : 'Проверочный профиль',
          );
        if (route === 'notifications')
          await expect(page.getByLabel('Получать учебные оповещения')).toBeVisible();
      }
      expect(state.mutations.filter((path) => path === '/api/account/profile')).toHaveLength(
        saved ? 1 : 0,
      );
    });
  for (const decision of ['Остаться', 'Отменить изменения и перейти', 'Сохранить и перейти'])
    test(`native hash replacement preserves the original destination: ${decision} ${browserMode}`, async ({
      page,
    }) => {
      await disableNavigationApi(page);
      const state = await fixture(page);
      await page.goto('/#/account/profile');
      const name = page.getByLabel('Отображаемое имя');
      await name.fill('Черновик исходного адреса');
      await page.evaluate(() => {
        window.location.hash = '/account/security';
      });
      const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
      await expect(guard).toBeVisible();
      await expect(page).toHaveURL(/#\/account\/profile$/);
      // A new native entry truncates the original forward entry while the
      // original decision is pending. Its history index is no longer its identity.
      await page.evaluate(() => {
        window.location.hash = '/help';
      });
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await expect(name).toHaveValue('Черновик исходного адреса');
      await guard.getByRole('button', { name: decision, exact: true }).click();
      if (decision === 'Остаться') {
        await expect(guard).toHaveCount(0);
        await expect(page).toHaveURL(/#\/account\/profile$/);
        await expect(name).toHaveValue('Черновик исходного адреса');
        expect(state.mutations).toEqual([]);
        // A fresh decision must not revive the cancelled destination.
        await page.evaluate(() => {
          window.location.hash = '/account/interface';
        });
        await expect(guard).toBeVisible();
        await expect(page).toHaveURL(/#\/account\/profile$/);
        await guard
          .getByRole('button', { name: 'Отменить изменения и перейти', exact: true })
          .click();
        await expect(page).toHaveURL(/#\/account\/interface$/);
        return;
      }
      await expect(page).toHaveURL(/#\/account\/security$/);
      await expect(
        page.getByRole('heading', { name: 'Вход и безопасность', exact: true }),
      ).toBeVisible();
      await traverse(page, 'back');
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await expect(name).toHaveValue(
        decision === 'Сохранить и перейти' ? 'Черновик исходного адреса' : 'Проверочный профиль',
      );
      await traverse(page, 'forward');
      await expect(page).toHaveURL(/#\/account\/security$/);
      expect(state.mutations.filter((path) => path === '/api/account/profile')).toHaveLength(
        decision === 'Сохранить и перейти' ? 1 : 0,
      );
    });

  test(`failed save retains both draft and original native hash destination ${browserMode}`, async ({
    page,
  }) => {
    await disableNavigationApi(page);
    const state = await fixture(page);
    let failingSave = true;
    await page.route('**/api/account/profile', async (route) => {
      if (route.request().method() === 'PATCH' && failingSave)
        return route.fulfill({
          status: 503,
          json: { error: { code: 'unavailable', message: 'profile save unavailable' } },
        });
      return route.fallback();
    });
    await page.goto('/#/account/profile');
    const name = page.getByLabel('Отображаемое имя');
    await name.fill('Черновик после ошибки сохранения');
    await page.evaluate(() => {
      window.location.hash = '/account/security';
    });
    const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
    await expect(guard).toBeVisible();
    await expect(page).toHaveURL(/#\/account\/profile$/);
    await page.evaluate(() => {
      window.location.hash = '/help';
    });
    await expect(page).toHaveURL(/#\/account\/profile$/);
    await guard.getByRole('button', { name: 'Сохранить и перейти', exact: true }).click();
    await expect(guard.getByRole('alert')).toContainText('Не удалось сохранить');
    await expect(page).toHaveURL(/#\/account\/profile$/);
    await expect(name).toHaveValue('Черновик после ошибки сохранения');
    failingSave = false;
    await guard.getByRole('button', { name: 'Сохранить и перейти', exact: true }).click();
    await expect(page).toHaveURL(/#\/account\/security$/);
    await traverse(page, 'back');
    await expect(name).toHaveValue('Черновик после ошибки сохранения');
    expect(state.mutations.filter((path) => path === '/api/account/profile')).toHaveLength(1);
  });

  test(`administrator transition protects the profile draft ${browserMode}`, async ({ page }) => {
    await disableNavigationApi(page);
    const state = await fixture(page, { platformAdmin: true });
    await page.goto('/#/account/profile');
    const admin = page.getByRole('button', { name: 'Админ', exact: true });
    const name = page.getByLabel('Отображаемое имя');
    const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
    await expect(admin).toBeVisible();
    await name.fill('Администратор с черновиком');
    await admin.click();
    await expect(guard).toBeVisible();
    await expect(page).toHaveURL(/#\/account\/profile$/);
    await guard.getByRole('button', { name: 'Остаться', exact: true }).click();
    await expect(name).toHaveValue('Администратор с черновиком');
    await admin.click();
    await guard.getByRole('button', { name: 'Отменить изменения и перейти', exact: true }).click();
    await expect(page).toHaveURL(/#\/admin$/);
    await expect(name).toHaveCount(0);
    await traverse(page, 'back');
    await expect(name).toHaveValue('Проверочный профиль');
    await name.fill('Сохранённый администратор');
    await admin.click();
    await guard.getByRole('button', { name: 'Сохранить и перейти', exact: true }).click();
    await expect(page).toHaveURL(/#\/admin$/);
    await traverse(page, 'back');
    await expect(name).toHaveValue('Сохранённый администратор');
    expect(state.mutations.filter((path) => path === '/api/account/profile')).toHaveLength(1);
  });

  for (const decision of ['Остаться', 'Отменить изменения и перейти', 'Сохранить и перейти'])
    test(`repeated Back and Forward during a draft dialog stays coherent: ${decision} ${browserMode}`, async ({
      page,
    }) => {
      await disableNavigationApi(page);
      const state = await fixture(page);
      await page.goto('/#/account/notifications');
      await panel(page, 'Интерфейс').click();
      await panel(page, 'Профиль').click();
      // Keep a genuine forward entry, so both directions can be repeated while
      // the first Back decision is pending.
      await page.evaluate(() => {
        window.location.hash = '/help';
      });
      await expect(page).toHaveURL(/#\/help$/);
      await traverse(page, 'back');
      const name = page.getByLabel('Отображаемое имя');
      await name.fill('Черновик повторного перехода');
      const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
      await traverse(page, 'back');
      await expect(guard).toBeVisible();
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await traverse(page, 'back');
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await expect(name).toHaveValue('Черновик повторного перехода');
      await traverse(page, 'forward');
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await guard.getByRole('button', { name: decision, exact: true }).click();
      if (decision === 'Остаться') {
        await expect(page).toHaveURL(/#\/account\/profile$/);
        await expect(name).toHaveValue('Черновик повторного перехода');
        await traverse(page, 'back');
        await guard
          .getByRole('button', { name: 'Отменить изменения и перейти', exact: true })
          .click();
      }
      await expect(page).toHaveURL(/#\/account\/interface$/);
      await expect(page.getByRole('heading', { name: 'Интерфейс', exact: true })).toBeVisible();
      await traverse(page, 'forward');
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await expect(name).toHaveValue(
        decision === 'Сохранить и перейти' ? 'Черновик повторного перехода' : 'Проверочный профиль',
      );
      expect(state.mutations.filter((path) => path === '/api/account/profile')).toHaveLength(
        decision === 'Сохранить и перейти' ? 1 : 0,
      );
    });

  test(`native hash entry is restored and then reached after discard ${browserMode}`, async ({
    page,
  }) => {
    await disableNavigationApi(page);
    await fixture(page);
    await page.goto('/#/account/profile');
    if (!navigationApi)
      expect(
        await page.evaluate(() => 'navigation' in window && window.navigation),
      ).toBeUndefined();
    const name = page.getByLabel('Отображаемое имя');
    await name.fill('Черновик новой hash-записи');
    await page.evaluate(() => {
      window.location.hash = '/account/notifications';
    });
    const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
    await expect(guard).toBeVisible();
    await expect(page).toHaveURL(/#\/account\/profile$/);
    await guard.getByRole('button', { name: 'Остаться', exact: true }).click();
    await expect(name).toHaveValue('Черновик новой hash-записи');
    await traverse(page, 'forward');
    await expect(guard).toBeVisible();
    await expect(page).toHaveURL(/#\/account\/profile$/);
    await guard.getByRole('button', { name: 'Отменить изменения и перейти', exact: true }).click();
    await expect(page).toHaveURL(/#\/account\/notifications$/);
    await expect(page.getByLabel('Получать учебные оповещения')).toBeVisible();
    await traverse(page, 'back');
    await expect(page).toHaveURL(/#\/account\/profile$/);
    await expect(name).toHaveValue('Проверочный профиль');
    await traverse(page, 'forward');
    await expect(page).toHaveURL(/#\/account\/notifications$/);
    await expect(page.getByLabel('Получать учебные оповещения')).toBeVisible();
  });
}

test('personal account never receives administrative navigation from its display name', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#/account/profile');
  await page.getByLabel('Отображаемое имя').fill('Администратор');
  await expect(page.getByRole('button', { name: 'Админ', exact: true })).toHaveCount(0);
});
async function capture(page: Page, path: string) {
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(
    await page.locator('.portal-header').evaluate((header) => header.getBoundingClientRect().top),
  ).toBe(0);
  await page.screenshot({ path, fullPage: true });
}

test('panel addresses reload and repeated Back/Forward keep both history and protected drafts', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#/account');
  await panel(page, 'Интерфейс').click();
  await expect(page).toHaveURL(/#\/account\/interface$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Интерфейс', exact: true })).toBeVisible();
  await panel(page, 'Профиль').click();
  await page.getByLabel('Отображаемое имя').fill('Черновик после возврата');
  await page.evaluate(() => window.history.back());
  const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
  await expect(guard).toBeVisible();
  await expect(page).toHaveURL(/#\/account\/profile$/);
  await guard.getByRole('button', { name: 'Остаться', exact: true }).click();
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Черновик после возврата');
  await page.evaluate(() => window.history.back());
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Отменить изменения и перейти', exact: true }).click();
  await expect(page).toHaveURL(/#\/account\/interface$/);
  await page.evaluate(() => window.history.forward());
  await expect(page).toHaveURL(/#\/account\/profile$/);
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Проверочный профиль');
  await page.evaluate(() => window.history.back());
  await expect(page).toHaveURL(/#\/account\/interface$/);
  await expect(guard).toHaveCount(0);
});

test('mobile selection uses the same draft guard and saving navigates only after persistence', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/#/account');
  await page.getByLabel('Отображаемое имя').fill('Сохранённый переход');
  await page.getByLabel('Выбрать раздел настроек').selectOption('interface');
  const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Сохранить и перейти', exact: true }).click();
  await expect(page).toHaveURL(/#\/account\/interface$/);
  expect(state.mutations.filter((path) => path === '/api/account/profile')).toHaveLength(1);
  await page.getByLabel('Часовой пояс').selectOption('UTC');
  await page.getByLabel('Выбрать раздел настроек').selectOption('profile');
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Остаться', exact: true }).click();
  await expect(page.getByLabel('Часовой пояс')).toHaveValue('UTC');
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await page.getByLabel('Выбрать раздел настроек').selectOption('profile');
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Сохранённый переход');
});

test('avatar dialog contains keyboard focus and restores the opener on Escape', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#/account');
  const opener = page.getByRole('button', { name: 'Выбрать аватар', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  await expect(dialog.getByRole('button', { name: 'Закрыть выбор аватара' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Загрузить своё изображение' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Закрыть выбор аватара' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

for (const persona of ['personal', 'author', 'teacher-learner', 'organization'] as const)
  test(`settings follow actual server actions for ${persona}`, async ({ page }) => {
    await fixture(page, {
      author: persona === 'author',
      educator: persona === 'teacher-learner' || persona === 'organization',
      organization: persona === 'organization',
    });
    await page.goto('/#/account/notifications');
    const staff = page.getByLabel('Работы на проверку', { exact: true });
    if (persona === 'teacher-learner' || persona === 'organization')
      await expect(staff).toBeVisible();
    else await expect(staff).toHaveCount(0);
    await panel(page, 'Возможности').click();
    if (persona === 'author')
      await expect(page.getByRole('link', { name: 'Открыть материалы' })).toBeVisible();
    if (persona === 'teacher-learner' || persona === 'organization')
      await expect(page.getByRole('button', { name: 'Открыть классы', exact: true })).toBeVisible();
    await panel(page, 'Мои доступы').click();
    await expect(page.getByText('Активна', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Полный', { exact: true })).toHaveCount(0);
    if (persona === 'organization')
      await expect(page.getByRole('button', { name: 'Открыть классы', exact: true })).toBeVisible();
  });

test('notification load errors are retryable, drafts stay on cancelled navigation and hidden staff keys survive save', async ({
  page,
}) => {
  const state = await fixture(page, { notificationFailure: true });
  await page.goto('/#/account/notifications');
  await expect(page.getByRole('alert')).toContainText('Настройки временно недоступны');
  await expect(page.getByText('Загружаем настройки…', { exact: true })).toHaveCount(0);
  state.recoverNotifications();
  await page.getByRole('button', { name: 'Обновить форму' }).click();
  const master = page.getByLabel('Получать учебные оповещения');
  await master.uncheck();
  await panel(page, 'Профиль').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Остаться', exact: true }).click();
  await expect(master).not.toBeChecked();
  const saved = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().endsWith('/api/learning/notifications/preferences'),
  );
  await page.getByRole('button', { name: 'Сохранить оповещения' }).click();
  expect((await saved).postDataJSON().categories.NC02).toBe(true);
});

for (const width of [1440, 1024, 390, 320])
  test(`Seat has three honest panels and retryable awards at ${width}px`, async ({ page }) => {
    const state = await fixture(page, { seat: true, awardsFailure: true });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/account');
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить значки');
    await expect(page.getByText(/Пока ни одного/)).toHaveCount(0);
    state.recoverAwards();
    await page.getByRole('button', { name: 'Повторить загрузку значков' }).click();
    await expect(page.getByText(/Пока ни одного/)).toBeVisible();
    for (const name of ['Мой профиль', 'Интерфейс', 'Уведомления']) {
      if (width <= 900)
        await page.getByLabel('Выбрать раздел настроек').selectOption({ label: name });
      else await panel(page, name).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await capture(page, `${evidence}/seat-${width}-${name}.png`);
    }
    const personalPreferences = page.getByRole('region', {
      name: 'Учебные оповещения — только для меня',
      exact: true,
    });
    await expect(personalPreferences.getByLabel('Работы на проверку')).toHaveCount(0);
    await expect(personalPreferences.getByLabel('Заявки и приглашения')).toHaveCount(0);
    expect(state.mutations).toEqual([]);
  });

test('routing outside settings keeps ordinary Back/Forward without a draft dialog', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#/help');
  await page.evaluate(() => {
    window.location.hash = '/account/interface';
  });
  await expect(page.getByRole('heading', { name: 'Интерфейс', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = '/help';
  });
  await expect(page).toHaveURL(/#\/help$/);
  await page.evaluate(() => window.history.back());
  await expect(page.getByRole('heading', { name: 'Интерфейс', exact: true })).toBeVisible();
  await page.evaluate(() => window.history.forward());
  await expect(page).toHaveURL(/#\/help$/);
  await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toHaveCount(0);
});

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
      'Уведомления',
      'Приглашения и запросы',
      'Данные и приватность',
    ]) {
      if (width <= 900)
        await page.getByLabel('Выбрать раздел настроек').selectOption({ label: name });
      else await panel(page, name).click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      expect(overflow, `${width}px ${name}`).toBe(false);
      if (name === 'Возможности') {
        const textWidths = await page
          .locator('.account-capability-card > div')
          .evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().width),
          );
        expect(textWidths).toHaveLength(2);
        // The reported failure squeezed the description into a 52px icon slot.
        for (const textWidth of textWidths)
          expect(textWidth, `${width}px capability description`).toBeGreaterThan(
            width <= 700 ? 170 : 210,
          );
      }
      if (name === 'Уведомления') {
        const rows = page.locator(
          '.learning-notification-settings label:has(input[type="checkbox"])',
        );
        for (const row of await rows.all()) {
          const layout = await row.evaluate((label) => {
            const input = label.querySelector('input')!.getBoundingClientRect();
            const bounds = label.getBoundingClientRect();
            return { checkboxWidth: input.width, rowWidth: bounds.width, rowHeight: bounds.height };
          });
          expect(layout.checkboxWidth).toBeLessThanOrEqual(24);
          expect(layout.rowWidth).toBeGreaterThan(150);
          expect(layout.rowHeight).toBeLessThan(90);
        }
        const actions = page.locator(
          '.learning-notification-settings > .learning-notification-actions',
        );
        const primary = await actions
          .getByRole('button', { name: 'Сохранить оповещения' })
          .boundingBox();
        const cancel = await actions
          .getByRole('button', { name: 'Отменить', exact: true })
          .boundingBox();
        expect(primary?.y).toBe(cancel?.y);
      }
      await capture(page, `${evidence}/account-${width}-${name}.png`);
    }
    if (width <= 900)
      await page.getByLabel('Выбрать раздел настроек').selectOption({ label: 'Профиль' });
    else await panel(page, 'Профиль').click();
    await capture(page, `${evidence}/account-${width}.png`);
  });

for (const width of [1440, 1024, 390, 320])
  test(`shared personal notification layout works in Inbox, attended class and staff class at ${width}px`, async ({
    page,
  }) => {
    await fixture(page, { educator: true });
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/#/attending', '/#/classrooms/class-1']) {
      await page.goto(route);
      const summary = page.getByText(
        route.includes('attending')
          ? 'Мои оповещения об этом классе'
          : 'Настройки учебных оповещений',
        { exact: true },
      );
      await summary.click();
      const form = page.getByRole('region', {
        name: 'Учебные оповещения — только для меня',
        exact: true,
      });
      await expect(form.getByLabel('Получать учебные оповещения')).toBeVisible();
      await form.getByLabel('Мои оповещения об этом классе').selectOption('custom');
      await expect(
        form.getByRole('combobox', { name: 'Назначения и условия', exact: true }),
      ).toBeVisible();
      if (route.includes('attending'))
        await expect(
          form.getByRole('combobox', { name: 'Работы на проверку', exact: true }),
        ).toHaveCount(0);
      else
        await expect(
          form.getByRole('combobox', { name: 'Работы на проверку', exact: true }),
        ).toBeVisible();
      const checkbox = await form.getByLabel('Получать учебные оповещения').boundingBox();
      expect(checkbox?.width).toBe(20);
      await form.screenshot({
        path: `${evidence}/${route.includes('attending') ? 'attending' : 'classroom'}-${width}-notifications.png`,
      });
    }
    await page.goto('/#/account/notifications');
    await page.getByRole('button', { name: 'Оповещения: непрочитанных 0', exact: true }).click();
    const inbox = page.getByRole('dialog', { name: 'Учебные оповещения', exact: true });
    await inbox.getByRole('button', { name: 'Настроить', exact: true }).click();
    await expect(inbox.getByLabel('Работы на проверку', { exact: true })).toBeVisible();
    expect(
      await inbox
        .getByLabel('Получать учебные оповещения')
        .evaluate((element) => element.getBoundingClientRect().width),
    ).toBe(20);
    await inbox.screenshot({ path: `${evidence}/inbox-${width}-notifications.png` });
  });
