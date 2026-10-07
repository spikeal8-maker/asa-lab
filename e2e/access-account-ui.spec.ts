import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
    presentationFailure?: boolean;
    presentationSaveFailure?: boolean;
    presentationLongContent?: boolean;
    unreadCount?: number;
  } = {},
) {
  const mutations: string[] = [];
  let failing = options.profileFailure ?? false;
  let secondaryFailure = options.secondaryFailure ?? false;
  let educator = options.educator ?? false;
  let awardsFailure = options.awardsFailure ?? false;
  let notificationFailure = options.notificationFailure ?? false;
  let presentationFailure = options.presentationFailure ?? false;
  let presentationSaveFailure = options.presentationSaveFailure ?? false;
  let presentationActorChanged = false;
  let avatarDataUrl: string | null = null;
  let seatAvatarKey: string | null = null;
  let timeZone = 'Europe/Moscow';
  let presentation = { motion: 'system', sidebar: 'expanded', revision: 0 };
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
      title: options.presentationLongContent
        ? 'Личное пространство для создания проектов, материалов и независимого обучения в нескольких организациях'
        : 'Личное пространство',
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
    displayName: options.presentationLongContent
      ? 'Проверочный профиль с очень длинным отображаемым именем и несколькими учебными обязанностями'
      : 'Проверочный профиль',
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
    if (path === '/api/account/presentation') {
      if (presentationFailure)
        return reply({ error: { code: 'not_found', message: 'old backend' } }, 404);
      if (method === 'PUT' && presentationSaveFailure)
        return reply({ error: { code: 'unavailable', message: 'offline' } }, 503);
      if (options.seat)
        return reply({ error: { code: 'unauthorized', message: 'Account required' } }, 401);
      expect(request.headers()['x-asa-presentation-account']).toBe(
        '20000000-0000-4000-8000-000000000001',
      );
      if (presentationActorChanged)
        return reply({ error: { code: 'actor_changed', message: 'Account changed' } }, 409);
      if (method === 'PUT') {
        const input = request.postDataJSON();
        if (input.revision !== presentation.revision)
          return reply({ error: { code: 'conflict', message: 'changed' } }, 409);
        presentation = {
          motion: input.motion,
          sidebar: input.sidebar,
          revision: presentation.revision + 1,
        };
      }
      return reply(presentation);
    }
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
                avatarKey: seatAvatarKey,
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
    if (path === '/api/class-join/me/avatar') {
      seatAvatarKey = request.postDataJSON().avatarKey;
      return reply({
        authenticated: true,
        student: {
          seatId: 'seat-1',
          displayName: 'Ученик с длинным именем',
          safeMode: true,
          avatarKey: seatAvatarKey,
        },
        classroom: { id: 'class-1', title: 'Учебный класс', teacherDisplayName: 'Преподаватель' },
        expiresAt: '2030-01-01T00:00:00Z',
      });
    }
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
      return reply({
        items: [],
        snapshot: '2026-01-01T00:00:00Z',
        unread: options.unreadCount ?? 0,
      });
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
    if (path === '/api/account/avatar') {
      if (secondaryFailure)
        return reply({ error: { code: 'unavailable', message: 'avatar unavailable' } }, 503);
      if (method === 'PATCH') avatarDataUrl = request.postDataJSON().avatarDataUrl;
      return reply({ avatarDataUrl });
    }
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
    if (path === '/api/classrooms/teacher-home-attention')
      return reply({
        reviews: [
          {
            key: 'review-1',
            classroomId: 'class-1',
            classroomTitle: 'Класс с длинным названием',
            assignmentId: 'assignment-1',
            assignmentTitle: 'Учебная работа, ожидающая проверки преподавателем',
            seatId: 'seat-1',
            learnerName: 'Ученик с длинным именем',
            attemptId: null,
          },
        ],
        joinRequests: [],
        classrooms: [{ id: 'class-1', title: 'Класс с длинным названием' }],
        joinRequestsMayBeLimited: false,
      });
    if (path === '/api/classrooms/awaiting-review') return reply({ total: 0 });
    // Read-only empty fixture data, never forwarded to a real API.
    if (method === 'GET') return reply({ items: [], meta: { total: 0 } });
    return reply({ error: { code: 'unexpected_mutation', message: path } }, 400);
  });
  return {
    mutations,
    changePresentationActor: () => {
      presentationActorChanged = true;
    },
    recoverPresentation: () => {
      presentationFailure = false;
      presentationSaveFailure = false;
    },
    externalPresentation: () => {
      presentation = {
        motion: 'system',
        sidebar: 'collapsed',
        revision: presentation.revision + 1,
      };
    },
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
  await page.getByRole('combobox', { name: /^Часовой пояс/ }).selectOption('UTC');
  await page.getByLabel('Выбрать раздел настроек').selectOption('profile');
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Остаться', exact: true }).click();
  await expect(page.getByRole('combobox', { name: /^Часовой пояс/ })).toHaveValue('UTC');
  await page
    .getByRole('form', { name: 'Часовой пояс', exact: true })
    .getByRole('button', { name: 'Отменить изменения часового пояса', exact: true })
    .click();
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
  await expect(dialog.getByRole('button', { name: 'Загрузить своё изображение' })).toBeEnabled();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeFocused();
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
    await panel(page, 'Материалы и преподавание').click();
    if (persona === 'author')
      await expect(page.getByRole('link', { name: 'Открыть материалы' })).toBeVisible();
    if (persona === 'teacher-learner' || persona === 'organization')
      await expect(page.getByRole('button', { name: 'Открыть классы', exact: true })).toBeVisible();
    await panel(page, 'Рабочие пространства').click();
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
  await panel(page, 'Материалы и преподавание').click();
  await page.getByRole('button', { name: 'Подключить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть классы', exact: true })).toBeVisible();
  expect(
    state.mutations.filter((path) => path === '/api/capabilities/educator/self-attest'),
  ).toHaveLength(1);
  expect(state.mutations).not.toContain('/api/schools');
  expect(state.mutations).not.toContain('/api/account/role');
});

for (const width of [1440, 1024, 390, 320])
  test(`six account panels fit ${width}px without horizontal overflow`, async ({ page }) => {
    await fixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/account');
    if (width <= 900)
      await expect(page.getByLabel('Выбрать раздел настроек').locator('option')).toHaveCount(6);
    else await expect(page.getByLabel('Разделы настроек').getByRole('button')).toHaveCount(6);
    for (const name of [
      'Профиль',
      'Вход и безопасность',
      'Интерфейс',
      'Материалы и преподавание',
      'Рабочие пространства',
      'Уведомления',
    ]) {
      if (width <= 900)
        await page.getByLabel('Выбрать раздел настроек').selectOption({ label: name });
      else await panel(page, name).click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      expect(overflow, `${width}px ${name}`).toBe(false);
      if (name === 'Материалы и преподавание') {
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

async function assertCompactSettings(page: Page, width: number) {
  const main = page.locator('main.account-settings-page');
  await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(main.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
  await expect(main.locator('.portal-eyebrow')).toHaveCount(0);
  await expect(main.locator('.account-settings-navigation > strong')).toHaveCount(0);
  await expect(main.getByRole('heading', { name: 'Оформление' })).toHaveCount(1);
  // The first actual setting fits near the top even on a narrow phone. This
  // catches the repeated headings and context strip shown in the owner report.
  const firstControl = await main.getByLabel('Анимации', { exact: false }).boundingBox();
  expect(firstControl).not.toBeNull();
  // Between the picker breakpoint and tablet width, the scope hint may wrap
  // once inside the desktop settings column; it must still fit above 320px.
  // The approved mobile shell has a second 44px public-navigation row. Measure
  // settings density below the shell so this still catches extra page banners.
  const header = (await page.locator('.portal-header').boundingBox())!;
  const belowHeader = firstControl!.y - (header.y + header.height);
  expect(belowHeader).toBeLessThan(width <= 900 ? 314 : width < 1024 ? 264 : 244);
  expect(belowHeader + firstControl!.height).toBeLessThan(width <= 900 ? 354 : 294);
  const sectionHeading = await main
    .getByRole('heading', { name: 'Интерфейс', level: 2 })
    .boundingBox();
  if (width <= 900) expect(sectionHeading!.height).toBeLessThanOrEqual(1);
  else expect(sectionHeading!.height).toBeGreaterThan(1);
  console.log(
    `Settings density ${width}px: H2 y=${sectionHeading!.y.toFixed(1)}, first control y=${firstControl!.y.toFixed(1)}, bottom=${(firstControl!.y + firstControl!.height).toFixed(1)}`,
  );
  const form = main.getByRole('form', { name: 'Оформление', exact: true });
  for (const name of [
    'Сохранить оформление',
    'Отменить изменения оформления',
    'Сбросить оформление',
  ])
    await expect(form.getByRole('button', { name, exact: true })).toBeVisible();
  for (const control of await form.getByRole('button').all())
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const primary = await form
    .getByRole('button', { name: 'Сохранить оформление', exact: true })
    .boundingBox();
  const cancel = await form
    .getByRole('button', { name: 'Отменить изменения оформления', exact: true })
    .boundingBox();
  expect(primary!.y).toBe(cancel!.y);
  const actions = await form.locator('.account-presentation-actions').boundingBox();
  const zoneFooter = main.locator('.account-time-zone .account-form-actions');
  const zoneActions = (await zoneFooter.count()) ? await zoneFooter.boundingBox() : null;
  console.log(
    `Settings actions ${width}px: presentation=${actions!.height.toFixed(1)}px, time-zone=${zoneActions?.height.toFixed(1) ?? 'n/a'}px`,
  );
}

const shellEvidence = 'reports/playwright/settings-ui/portal-shell-s1';

async function assertShellGeometry(page: Page, width: number) {
  const metrics = await page.locator('.portal-header').evaluate((header) => {
    const bounds = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const selectors = [
      '.portal-menu-toggle',
      '.portal-brand',
      '.portal-global-nav a',
      '.portal-quick-create > summary',
      '.learning-inbox-button',
      '.portal-account > summary',
    ];
    return {
      header: bounds(header),
      controls: selectors.flatMap((selector) =>
        [...header.querySelectorAll(selector)]
          .filter((element) => element.checkVisibility())
          .map((element) => ({
            label: element.getAttribute('aria-label') ?? element.textContent,
            ...bounds(element),
          })),
      ),
      links: [...header.querySelectorAll('.portal-global-nav a')].map(bounds),
      main: bounds(document.querySelector('.portal-shell > main')!),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(metrics.overflow, `${width}px page overflow`).toBe(false);
  for (const control of metrics.controls) {
    expect(control.x, `${width}px ${control.label} left`).toBeGreaterThanOrEqual(0);
    expect(control.right, `${width}px ${control.label} right`).toBeLessThanOrEqual(width);
    expect(control.bottom, `${width}px ${control.label} below header`).toBeLessThanOrEqual(
      metrics.header.bottom + 1,
    );
  }
  for (let i = 0; i < metrics.controls.length; i++)
    for (let j = i + 1; j < metrics.controls.length; j++) {
      const a = metrics.controls[i]!,
        b = metrics.controls[j]!;
      const intersectionWidth = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const intersectionHeight = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      expect(
        intersectionWidth > 1 && intersectionHeight > 1,
        `${width}px overlap: ${a.label} / ${b.label}`,
      ).toBe(false);
    }
  for (const link of metrics.links) expect(link.height).toBeGreaterThanOrEqual(44);
  if (width <= 1023) {
    expect(metrics.header.height).toBeGreaterThanOrEqual(100);
    for (const link of metrics.links) expect(link.y).toBeGreaterThanOrEqual(metrics.header.y + 56);
    // A hidden desktop sidebar must not leave its 264px content offset behind.
    expect(metrics.main.x).toBeLessThanOrEqual(24);
    expect(metrics.main.right).toBeLessThanOrEqual(width);
  } else expect(metrics.header.height).toBeLessThan(60);
}

for (const width of [1440, 1024, 390, 320, 349, 350, 600, 601, 820, 821, 1022, 1023])
  test(`portal shell has distinct non-overlapping slots and room for a third public link at ${width}px`, async ({
    page,
  }) => {
    mkdirSync(shellEvidence, { recursive: true });
    const state = await fixture(page, {
      educator: true,
      author: true,
      presentationLongContent: true,
    });
    await page.setViewportSize({ width, height: 568 });
    await page.goto('/#/account/interface');
    await expect(page.getByLabel('Анимации', { exact: false })).toBeEnabled();
    const publicNav = page.getByLabel('Разделы ASA Lab');
    await expect(publicNav.getByRole('link')).toHaveCount(2);
    await expect(publicNav.getByRole('link', { name: 'ИИ', exact: true })).toHaveCount(0);
    await assertShellGeometry(page, width);
    await page.screenshot({ path: `${shellEvidence}/shell-${width}.png` });
    // Layout-only fixture: the real product exposes no placeholder AI feature.
    await publicNav.evaluate((nav) => {
      const third = nav.querySelector('a')!.cloneNode(true) as HTMLAnchorElement;
      third.href = '/#/ai-fixture';
      third.dataset.layoutFixture = 'future-ai';
      third.removeAttribute('aria-current');
      third.querySelector('span')!.textContent = 'ИИ';
      nav.append(third);
    });
    await assertShellGeometry(page, width);
    await page.screenshot({ path: `${shellEvidence}/third-link-fixture-${width}.png` });
    await publicNav.locator('[data-layout-fixture]').evaluate((element) => element.remove());
    const sidebar = page.locator('#portal-sidebar');
    const settings = sidebar.getByRole('link', {
      name: 'Настройки',
      exact: true,
      includeHidden: true,
    });
    await expect(sidebar.locator('a[href="/#/gallery"], a[href="/#/knowledge"]')).toHaveCount(0);
    await expect(
      sidebar.getByRole('link', { name: 'Мои проекты', exact: true, includeHidden: true }),
    ).toHaveCount(1);
    await expect(settings).toHaveCount(1);
    await expect(
      sidebar.getByRole('link', { name: 'Курсы и задания', exact: true, includeHidden: true }),
    ).toHaveCount(1);
    if (width <= 1023) {
      const toggle = page.getByRole('button', { name: 'Открыть меню', exact: true });
      await toggle.click();
      await expect(sidebar).toHaveAttribute('role', 'dialog');
      await expect(page.locator('.portal-header')).toHaveAttribute('inert', '');
      const order = await sidebar.evaluate((element) => {
        const nav = element.querySelector('.portal-nav')!,
          footer = element.querySelector('.portal-sidebar-footer')!;
        const links = [...footer.querySelectorAll('a, button')].map((child) => {
          const r = child.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, height: r.height };
        });
        return {
          navBottom: nav.getBoundingClientRect().bottom,
          links,
          navOrder: getComputedStyle(nav).order,
          footerBottomMargin: getComputedStyle(footer).marginBottom,
        };
      });
      expect(order.navOrder).toBe('0');
      expect(order.footerBottomMargin).toBe('0px');
      expect(order.links[0]!.top).toBeGreaterThanOrEqual(order.navBottom);
      for (let i = 1; i < order.links.length; i++)
        expect(order.links[i]!.top).toBeGreaterThanOrEqual(order.links[i - 1]!.bottom);
      for (const link of order.links) expect(link.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `${shellEvidence}/drawer-${width}-short.png` });
      const exit = sidebar.getByRole('button', { name: 'Выход', exact: true });
      await exit.scrollIntoViewIfNeeded();
      expect(
        (await exit.boundingBox())!.y + (await exit.boundingBox())!.height,
      ).toBeLessThanOrEqual(568);
      await page.screenshot({ path: `${shellEvidence}/drawer-${width}-logout.png` });
      // Tab wraps from the last action to Close; Escape restores the trigger.
      await exit.focus();
      await page.keyboard.press('Tab');
      await expect(
        sidebar.getByRole('button', { name: 'Закрыть меню', exact: true }),
      ).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(toggle).toBeFocused();
      await expect(page.locator('.portal-header')).not.toHaveAttribute('inert', '');
    } else {
      const collapse = sidebar.getByRole('button', {
        name: 'Свернуть боковую панель',
        exact: true,
      });
      await collapse.scrollIntoViewIfNeeded();
      const size = await collapse.boundingBox();
      expect(size!.width).toBe(44);
      expect(size!.height).toBe(44);
      await expect(collapse).toHaveCSS('border-radius', '50%');
      await page.screenshot({ path: `${shellEvidence}/expanded-control-${width}.png` });
      await collapse.click();
      await expect(sidebar).toHaveClass(/collapsed/);
      await page.screenshot({ path: `${shellEvidence}/collapsed-${width}.png` });
      expect(state.mutations.filter((path) => path === '/api/account/presentation')).toHaveLength(
        1,
      );
      await page.reload();
      await expect(sidebar).toHaveClass(/collapsed/);
    }
  });

for (const width of [1440, 1024, 1023, 1022, 821, 820, 601, 600, 390, 350, 349, 320])
  test(`portal shell reserves intrinsic brand and inbox width under wide text metrics at ${width}px`, async ({
    page,
  }) => {
    mkdirSync(shellEvidence, { recursive: true });
    await fixture(page, { educator: true, author: true, unreadCount: 9999 });
    await page.setViewportSize({ width, height: 568 });
    await page.goto('/#/account/interface');
    await expect(page.getByLabel('Анимации', { exact: false })).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Оповещения: непрочитанных 9999' }),
    ).toBeVisible();
    // A deterministic wider font plus text-spacing stress exposes the brand's
    // old 120px minimum on Windows too, instead of depending on Linux fonts.
    await page.addStyleTag({
      content: `
        .portal-header, .portal-header * {
          font-family: monospace !important;
          letter-spacing: 2px !important;
        }
        .portal-header button, .portal-header a, .portal-header summary {
          font-size: 16px !important;
        }
      `,
    });
    await assertShellGeometry(page, width);
    const nav = page.getByLabel('Разделы ASA Lab');
    await nav.evaluate((element) => {
      const third = element.querySelector('a')!.cloneNode(true) as HTMLAnchorElement;
      third.href = '/#/ai-fixture';
      third.removeAttribute('aria-current');
      third.querySelector('span')!.textContent = 'ИИ';
      element.append(third);
    });
    await assertShellGeometry(page, width);
    await page.screenshot({ path: `${shellEvidence}/wide-text-third-link-${width}.png` });
  });

for (const role of ['account', 'seat', 'teacher', 'author', 'admin'] as const)
  test(`short mobile drawer preserves ${role} navigation projections and one settings destination`, async ({
    page,
  }) => {
    await fixture(page, {
      seat: role === 'seat',
      educator: role === 'teacher',
      author: role === 'author',
      platformAdmin: role === 'admin',
      presentationLongContent: true,
    });
    await page.setViewportSize({ width: 390, height: 568 });
    await page.goto('/#/account');
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    const sidebar = page.locator('#portal-sidebar');
    await expect(
      sidebar.getByRole('link', {
        name: role === 'seat' ? 'Настройки учебного профиля' : 'Настройки',
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(sidebar.locator('a[href="/#/account"]')).toHaveCount(1);
    await expect(sidebar.getByRole('link', { name: 'Классы', exact: true })).toHaveCount(
      role === 'teacher' ? 1 : 0,
    );
    await expect(sidebar.getByRole('link', { name: 'Курсы и задания', exact: true })).toHaveCount(
      ['teacher', 'author'].includes(role) ? 1 : 0,
    );
    await expect(sidebar.getByRole('button', { name: 'Админ', exact: true })).toHaveCount(
      role === 'admin' ? 1 : 0,
    );
    await expect(
      sidebar.getByRole('link', {
        name: role === 'seat' ? 'Мои учебные работы' : 'Мои проекты',
        exact: true,
      }),
    ).toBeVisible();
    const help = sidebar.getByRole('link', {
      name: role === 'seat' ? 'Помощь' : 'Справка',
      exact: true,
    });
    await help.scrollIntoViewIfNeeded();
    await expect(help).toHaveAttribute('href', '/#/help');
    await page.screenshot({ path: `${shellEvidence}/drawer-${role}-390-short.png` });
    await help.click();
    await expect(page).toHaveURL(/#\/help$/);
    await expect(sidebar).not.toHaveClass(/mobile-open/);
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    await page.locator('.portal-menu-backdrop').click({ position: { x: 385, y: 300 } });
    await expect(sidebar).not.toHaveClass(/mobile-open/);
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    await page.setViewportSize({ width: 1023, height: 568 });
    await expect(sidebar).toHaveClass(/mobile-open/);
    await page.setViewportSize({ width: 1024, height: 568 });
    await expect(sidebar).not.toHaveClass(/mobile-open/);
    await expect(sidebar).not.toHaveAttribute('role', 'dialog');
    await expect(page.locator('.portal-header')).not.toHaveAttribute('inert', '');
    await expect(page.locator('.portal-shell > main')).not.toHaveAttribute('inert', '');
    expect(await page.locator('body').evaluate((element) => element.style.overflow)).not.toBe(
      'hidden',
    );
    await page.setViewportSize({ width: 1023, height: 568 });
    const toggle = page.getByRole('button', { name: 'Открыть меню', exact: true });
    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
  });

for (const width of [1440, 1024, 1023, 821, 390, 320])
  test(`public and personal routes retain shell, active section, native links and dirty guard at ${width}px`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await page.setViewportSize({ width, height: 900 });
    for (const hash of [
      'home',
      'projects',
      'gallery',
      'knowledge',
      'learning',
      'help',
      'account',
    ]) {
      await page.goto(`/#/${hash}`);
      await expect(page.getByLabel('Разделы ASA Lab').getByRole('link')).toHaveCount(2);
      await assertShellGeometry(page, width);
      const active = page.locator('.portal-global-nav [aria-current="page"]');
      await expect(active).toHaveCount(['gallery', 'knowledge'].includes(hash) ? 1 : 0);
      if (['gallery', 'knowledge'].includes(hash)) {
        await expect(active).toHaveAttribute('href', `/#/${hash}`);
        await expect(page.locator('.portal-sidebar a[aria-current="page"]')).toHaveCount(0);
      }
    }
    const projects = page
      .getByLabel('Разделы ASA Lab')
      .getByRole('link', { name: 'Проекты', exact: true });
    await expect(projects).toHaveAttribute('href', '/#/gallery');
    await page.getByLabel('Отображаемое имя').fill('Несохранённый профиль');
    // A modified click follows the native destination; it must not dispatch a
    // guarded same-tab navigation or discard this tab's profile draft.
    const prevented = await projects.evaluate((element) => {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
      element.dispatchEvent(click);
      return click.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(page).toHaveURL(/#\/account$/);
    await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toHaveCount(0);
    for (const hash of ['gallery', 'knowledge', 'help']) {
      if (hash !== 'gallery') {
        await page.goto('/#/account');
        await page.getByLabel('Отображаемое имя').fill('Несохранённый профиль');
      }
      const target =
        hash === 'help'
          ? page.locator('#portal-sidebar a[href="/#/help"]')
          : page.locator(`.portal-global-nav a[href="/#/${hash}"]`);
      const follow = async () => {
        if (hash === 'help' && width <= 1023)
          await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
        await target.click();
      };
      await follow();
      await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toBeVisible();
      await page.getByRole('button', { name: 'Остаться', exact: true }).click();
      await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Несохранённый профиль');
      await follow();
      await page.getByRole('button', { name: 'Отменить изменения и перейти', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`#/${hash}$`));
      await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toHaveCount(0);
    }
    await page
      .getByLabel('Разделы ASA Lab')
      .getByRole('link', { name: 'Проекты', exact: true })
      .click();
    await page
      .getByLabel('Разделы ASA Lab')
      .getByRole('link', { name: 'Знания', exact: true })
      .click();
    await expect(page).toHaveURL(/#\/knowledge$/);
    await traverse(page, 'back');
    await expect(page).toHaveURL(/#\/gallery$/);
    await traverse(page, 'forward');
    await expect(page).toHaveURL(/#\/knowledge$/);
    expect(state.mutations).not.toContain('/api/account/profile');
  });

test('plain native links still protect settings drafts and modified or middle clicks stay native', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/#/account');
  await page.getByLabel('Отображаемое имя').fill('Черновик обычной ссылки');
  await page.locator('main').evaluate((main) => {
    const link = document.createElement('a');
    link.href = '/#/help';
    link.textContent = 'Обычная ссылка проверки';
    main.append(link);
  });
  const plain = page.getByRole('link', { name: 'Обычная ссылка проверки', exact: true });
  await plain.click();
  await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toBeVisible();
  await page.getByRole('button', { name: 'Остаться', exact: true }).click();
  const projects = page
    .getByLabel('Разделы ASA Lab')
    .getByRole('link', { name: 'Проекты', exact: true });
  for (const options of [{ button: 1 }, { metaKey: true }, { shiftKey: true }, { altKey: true }])
    expect(
      await projects.evaluate((element, input) => {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...input });
        let observed = false,
          prevented = true;
        document.addEventListener(
          'click',
          (click) => {
            observed = true;
            prevented = click.defaultPrevented;
            // The fixture observes whether the app retained native behavior,
            // then suppresses a real new tab/download from this synthetic click.
            click.preventDefault();
          },
          { once: true },
        );
        element.dispatchEvent(event);
        return { observed, prevented };
      }, options),
    ).toEqual({ observed: true, prevented: false });
  await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toHaveCount(0);
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Черновик обычной ссылки');
  expect(state.mutations).not.toContain('/api/account/profile');
  await plain.click();
  await page.getByRole('button', { name: 'Отменить изменения и перейти', exact: true }).click();
  await expect(page).toHaveURL(/#\/help$/);
  await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toHaveCount(0);
});

for (const navigationApi of [true, false])
  for (const decision of ['Сохранить и перейти', 'Отменить изменения и перейти'])
    test(`Seat native Help completes one ${decision} decision ${navigationApi ? 'with' : 'without'} Navigation API`, async ({
      page,
    }) => {
      if (!navigationApi)
        await page.addInitScript(() =>
          Object.defineProperty(window, 'navigation', { value: undefined, configurable: true }),
        );
      const state = await fixture(page, { seat: true });
      await page.goto('/#/account/interface');
      await page.getByLabel('Анимации', { exact: false }).selectOption('reduce');
      const help = page.locator('main').getByRole('link', { name: 'Помощь', exact: true });
      await expect(help).not.toHaveAttribute('data-portal-navigation', 'managed');
      await help.click();
      await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toBeVisible();
      await page.getByRole('button', { name: 'Остаться', exact: true }).click();
      await expect(page.getByLabel('Анимации', { exact: false })).toHaveValue('reduce');
      await help.click();
      await page.getByRole('button', { name: decision, exact: true }).click();
      await expect(page).toHaveURL(/#\/help$/);
      await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toHaveCount(0);
      await traverse(page, 'back');
      await expect(page).toHaveURL(/#\/account\/interface$/);
      await expect(page.getByLabel('Анимации', { exact: false })).toHaveValue(
        decision === 'Сохранить и перейти' ? 'reduce' : 'system',
      );
      expect(state.mutations).not.toContain('/api/account/presentation');
    });

for (const width of [560, 561, 900, 901])
  test(`settings heading and picker switch without layout drift at ${width}px boundary`, async ({
    page,
  }) => {
    await fixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/account/interface');
    await expect(page.getByLabel('Анимации', { exact: false })).toBeEnabled();
    await assertCompactSettings(page, width);
    await expect(page.getByLabel('Выбрать раздел настроек')).toBeVisible({
      visible: width <= 900,
    });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await capture(page, `${evidence}/settings-usability-boundary-${width}.png`);
  });

for (const navigationApi of [true, false])
  for (const [alias, destination, label] of [
    ['privacy', 'security', 'Данные и приватность'],
    ['requests', 'school', 'Приглашения на обучение'],
  ])
    test(`legacy ${alias} remains guarded through Back and Forward ${navigationApi ? 'with' : 'without'} Navigation API`, async ({
      page,
    }) => {
      if (!navigationApi)
        await page.addInitScript(() =>
          Object.defineProperty(window, 'navigation', { value: undefined, configurable: true }),
        );
      const state = await fixture(page);
      await page.goto(`/#/account/${alias}`);
      const info = page.locator('.account-settings-information');
      await expect(info.locator('summary')).toHaveText(label);
      await expect(info).toHaveAttribute('open', '');
      await expect(page.getByLabel('Выбрать раздел настроек')).toHaveValue(destination);
      await expect(page.getByLabel('Разделы настроек').locator('[aria-current="page"]')).toHaveText(
        destination === 'security' ? 'Вход и безопасность' : 'Рабочие пространства',
      );
      await panel(page, 'Профиль').click();
      await page.getByLabel('Отображаемое имя').fill('Черновик перед старым адресом');
      await page.evaluate(() => window.history.back());
      const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
      await expect(guard).toBeVisible();
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await guard.getByRole('button', { name: 'Остаться', exact: true }).click();
      await expect(page.getByLabel('Отображаемое имя')).toHaveValue(
        'Черновик перед старым адресом',
      );
      await page.evaluate(() => window.history.back());
      await expect(guard).toBeVisible();
      await guard
        .getByRole('button', { name: 'Отменить изменения и перейти', exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`#/account/${alias}$`));
      await expect(info).toHaveAttribute('open', '');
      await page.evaluate(() => window.history.forward());
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Проверочный профиль');
      expect(state.mutations).toHaveLength(0);
    });

test('narrow time-zone action pair tolerates wider 16px font metrics', async ({ page }) => {
  const state = await fixture(page, { presentationSaveFailure: true });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/#/account/interface');
  const form = page.getByRole('form', { name: 'Оформление', exact: true });
  const zoneForm = page.getByRole('form', { name: 'Часовой пояс', exact: true });
  const zone = zoneForm.getByRole('combobox', { name: /^Часовой пояс/ });
  await expect(zone).toBeEnabled();
  // Exercise a fallback font with wider Cyrillic metrics without adding a
  // product font preference. Wider font metrics can reproduce the row wrapping seen in CI.
  await page.addStyleTag({
    content: `
    .account-time-zone .account-form-actions > button,
    .account-presentation-actions > :is(.btn-primary, .btn-secondary) {
      font-family: monospace;
      font-size: 16px;
      letter-spacing: 1px;
    }
  `,
  });
  const assertPairs = async (stateName: string) => {
    await capture(page, `${evidence}/settings-actions-font-stress-${stateName}-320.png`);
    for (const actions of [
      form.locator('.account-presentation-actions'),
      zoneForm.locator('.account-form-actions'),
    ]) {
      const pair = actions.locator(':scope > :is(.btn-primary, .btn-secondary)');
      const metrics = await pair.evaluateAll((buttons) =>
        buttons.map((button) => {
          const bounds = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          const text = document.createRange();
          text.selectNodeContents(button);
          const textBounds = text.getBoundingClientRect();
          return {
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            fontSize: style.fontSize,
            family: style.fontFamily,
            textFits: textBounds.left >= bounds.left && textBounds.right <= bounds.right,
          };
        }),
      );
      expect(metrics).toHaveLength(2);
      console.log(`Font stress ${stateName}: ${JSON.stringify(metrics)}`);
      expect(metrics[0].y).toBe(metrics[1].y);
      for (const metric of metrics) {
        expect(metric.fontSize).toBe('16px');
        expect(metric.family).toContain('monospace');
        expect(metric.width).toBeGreaterThanOrEqual(44);
        expect(metric.height).toBeGreaterThanOrEqual(44);
        expect(metric.textFits).toBe(true);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  };
  await assertPairs('fresh');
  await form.getByLabel('Анимации', { exact: false }).selectOption('reduce');
  await zone.selectOption('UTC');
  await assertPairs('dirty');
  await zoneForm
    .getByRole('button', { name: 'Отменить изменения часового пояса', exact: true })
    .click();
  await expect(zone).toHaveValue('Europe/Moscow');
  await expect(form.getByLabel('Анимации', { exact: false })).toHaveValue('reduce');
  await zone.selectOption('UTC');
  await form.getByRole('button', { name: 'Сохранить оформление', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await zoneForm.getByRole('button', { name: 'Сохранить часовой пояс', exact: true }).click();
  await expect(page.locator('.account-interface-feedback .account-save-status')).toContainText(
    'Часовой пояс',
  );
  await assertPairs('partial-error');
  expect(state.mutations.filter((path) => path === '/api/account/time-zone')).toHaveLength(1);
  await expect(form.getByLabel('Анимации', { exact: false })).toHaveValue('reduce');
});

for (const width of [1440, 1024, 390, 320])
  test(`independent presentation and time-zone operations remain clear at ${width}px`, async ({
    page,
  }) => {
    const state = await fixture(page, { presentationSaveFailure: true });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/account/interface');
    const form = page.getByRole('form', { name: 'Оформление', exact: true });
    const zoneForm = page.getByRole('form', { name: 'Часовой пояс', exact: true });
    const motion = form.getByLabel('Анимации', { exact: false });
    const zone = zoneForm.getByRole('combobox', { name: /^Часовой пояс/ });
    await expect(motion).toBeEnabled();
    await expect(form.getByLabel('Боковая панель на компьютере')).toBeVisible();
    const zonePrimary = await zoneForm
      .getByRole('button', { name: 'Сохранить часовой пояс', exact: true })
      .boundingBox();
    const zoneCancel = await zoneForm
      .getByRole('button', { name: 'Отменить изменения часового пояса', exact: true })
      .boundingBox();
    expect(zonePrimary!.y).toBe(zoneCancel!.y);
    await expect(
      form.getByRole('button', { name: 'Сохранить оформление', exact: true }),
    ).toBeDisabled();
    await capture(page, `${evidence}/settings-usability-fresh-${width}.png`);
    await motion.selectOption('reduce');
    await zone.selectOption('UTC');
    await capture(page, `${evidence}/settings-usability-dirty-${width}.png`);
    await form.getByRole('button', { name: 'Сохранить оформление', exact: true }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    await expect(zone).toHaveValue('UTC');
    await zoneForm.getByRole('button', { name: 'Сохранить часовой пояс', exact: true }).click();
    await expect(
      zoneForm.getByRole('button', { name: 'Сохранить часовой пояс', exact: true }),
    ).toBeDisabled();
    await expect(page.locator('.account-interface-feedback .account-save-status')).toContainText(
      'Часовой пояс',
    );
    await expect(zoneForm.locator('[role="status"]')).toHaveCount(0);
    await expect(page.locator('.account-settings-content > .account-message.success')).toHaveCount(
      0,
    );
    await expect(motion).toHaveValue('reduce');
    await expect(
      form.getByRole('button', { name: 'Сохранить оформление', exact: true }),
    ).toBeEnabled();
    await expect(form.getByRole('alert')).toBeVisible();
    await capture(page, `${evidence}/settings-usability-partial-error-${width}.png`);
    state.recoverPresentation();
    await form.getByRole('button', { name: 'Сохранить оформление', exact: true }).click();
    await expect(form.locator('.account-save-status')).toBeVisible();
    await expect(form.locator('.account-message.success')).toHaveCount(0);
    await expect(zone).toHaveValue('UTC');
    await zone.selectOption('Europe/Paris');
    const mutationsBeforeReset = state.mutations.length;
    await form.getByRole('button', { name: 'Сбросить оформление', exact: true }).click();
    await expect(motion).toHaveValue('system');
    await expect(zone).toHaveValue('Europe/Paris');
    expect(state.mutations).toHaveLength(mutationsBeforeReset);
    await form.getByRole('button', { name: 'Отменить изменения оформления', exact: true }).click();
    await expect(motion).toHaveValue('reduce');
    await expect(zone).toHaveValue('Europe/Paris');
    await zoneForm
      .getByRole('button', { name: 'Отменить изменения часового пояса', exact: true })
      .click();
    await expect(zone).toHaveValue('UTC');
    if (width <= 900) await page.getByLabel('Выбрать раздел настроек').selectOption('profile');
    else await panel(page, 'Профиль').click();
    if (width <= 900) await page.getByLabel('Выбрать раздел настроек').selectOption('interface');
    else await panel(page, 'Интерфейс').click();
    await expect(motion).toHaveValue('reduce');
    await expect(zone).toHaveValue('UTC');
    await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toHaveCount(0);
    await capture(page, `${evidence}/settings-usability-reentry-${width}.png`);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  });

for (const width of [1440, 1024, 390, 320]) {
  test(`Account presentation preview, guard and coherent persistence fit ${width}px`, async ({
    page,
  }) => {
    const state = await fixture(page, {
      educator: true,
      author: true,
      organization: true,
      presentationLongContent: true,
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/account/interface');
    const motion = page.getByLabel('Анимации', { exact: false }),
      sidebar = page.getByLabel('Боковая панель', { exact: false });
    await expect(motion).toBeEnabled();
    await motion.selectOption('reduce');
    await sidebar.selectOption('collapsed');
    await expect(page.locator('.presentation-shell')).toHaveAttribute('data-motion', 'reduce');
    await expect(page.locator('.portal-sidebar-collapse')).toBeDisabled();
    if (width <= 900) await page.getByLabel('Выбрать раздел настроек').selectOption('profile');
    else await panel(page, 'Профиль').click();
    await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toBeVisible();
    await page.getByRole('button', { name: 'Остаться', exact: true }).click();
    await page
      .getByRole('form', { name: 'Оформление', exact: true })
      .getByRole('button', { name: 'Сохранить оформление', exact: true })
      .click();
    await expect(page.getByText('Оформление сохранено в аккаунте.', { exact: true })).toBeVisible();
    await expect(page.locator('.portal-sidebar-collapse')).toBeEnabled();
    await expect(page.getByRole('combobox', { name: /^Часовой пояс/ })).toHaveValue(
      'Europe/Moscow',
    );
    await expect(page.getByLabel('Текущий аккаунт и контекст')).toHaveCount(0);
    const accountMenu = page.locator('.portal-account > summary');
    await accountMenu.click();
    await expect(page.locator('.portal-account-identity')).toContainText('Проверочный профиль');
    await expect(page.locator('.portal-account-workspace-copy')).toContainText(
      'Личное пространство',
    );
    await accountMenu.click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect
      .poll(async () => Math.abs((await page.locator('.portal-header').boundingBox())!.y))
      .toBeLessThan(1);
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector('.skip-link')!.getBoundingClientRect().bottom),
      )
      .toBeLessThan(1);
    await assertCompactSettings(page, width);
    await page.screenshot({
      path: `${evidence}/settings-usability-account-full-${width}.png`,
      fullPage: true,
    });
    await page.screenshot({ path: `${evidence}/settings-usability-account-${width}.png` });
    await page.reload();
    await expect(motion).toHaveValue('reduce');
    await expect(sidebar).toHaveValue('collapsed');
    await page
      .getByRole('form', { name: 'Оформление', exact: true })
      .getByRole('button', { name: 'Сбросить оформление', exact: true })
      .click();
    await expect(motion).toHaveValue('system');
    await page
      .getByRole('form', { name: 'Оформление', exact: true })
      .getByRole('button', { name: 'Отменить изменения оформления', exact: true })
      .click();
    await expect(motion).toHaveValue('reduce');
    if (width >= 1024) {
      await page.locator('.portal-sidebar-collapse').click();
      await expect(sidebar).toHaveValue('expanded');
    }
    expect(state.mutations.filter((path) => path === '/api/account/presentation')).toHaveLength(
      width >= 1024 ? 2 : 1,
    );
    await page.getByRole('button', { name: 'ASA Lab — главная', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Требует внимания', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Работы на проверке: 1', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Текущий аккаунт и контекст')).toHaveCount(0);
    await expect(page.locator('.presentation-shell')).toHaveAttribute('data-motion', 'reduce');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect
      .poll(async () => Math.abs((await page.locator('.portal-header').boundingBox())!.y))
      .toBeLessThan(1);
    await page.screenshot({
      path: `${evidence}/settings-usability-home-${width}.png`,
      fullPage: true,
    });
  });
  test(`Seat temporary motion preserves help and context at ${width}px`, async ({ page }) => {
    const state = await fixture(page, { seat: true });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/account/interface');
    await page.getByLabel('Анимации', { exact: false }).selectOption('reduce');
    await page
      .getByRole('form', { name: 'Оформление', exact: true })
      .getByRole('button', { name: 'Сохранить оформление', exact: true })
      .click();
    await expect(
      page.getByText('Сохранено до выхода из этого учебного сеанса.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('main').getByRole('link', { name: 'Помощь', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Боковая панель', { exact: false })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await assertCompactSettings(page, width);
    await page.screenshot({
      path: `${evidence}/settings-usability-seat-full-${width}.png`,
      fullPage: true,
    });
    await page.screenshot({ path: `${evidence}/settings-usability-seat-${width}.png` });
    await page.reload();
    await expect(page.getByLabel('Анимации', { exact: false })).toHaveValue('reduce');
    await page.evaluate(() => window.dispatchEvent(new Event('asa-session-logout')));
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('asa-seat-presentation-session')))
      .toBeNull();
    expect(state.mutations).not.toContain('/api/account/presentation');
  });
}
test('old backend leaves preferences unavailable but navigation and profile still work', async ({
  page,
}) => {
  const state = await fixture(page, { presentationFailure: true });
  await page.goto('/#/account/interface');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить оформление');
  await expect(page.getByLabel('Анимации', { exact: false })).toBeDisabled();
  await panel(page, 'Профиль').click();
  await expect(page.getByLabel('Отображаемое имя')).toBeEnabled();
  state.recoverPresentation();
  await panel(page, 'Интерфейс').click();
  await page.getByRole('button', { name: 'Загрузить сохранённое оформление', exact: true }).click();
  await expect(page.getByLabel('Анимации', { exact: false })).toBeEnabled();
});
test('failed save preserves preview and conflict requires explicit cancellation and reload', async ({
  page,
}) => {
  const state = await fixture(page, { presentationSaveFailure: true });
  await page.goto('/#/account/interface');
  await page.getByLabel('Анимации', { exact: false }).selectOption('reduce');
  await page
    .getByRole('form', { name: 'Оформление', exact: true })
    .getByRole('button', { name: 'Сохранить оформление', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('не сохранено');
  await expect(page.getByLabel('Анимации', { exact: false })).toHaveValue('reduce');
  state.recoverPresentation();
  state.externalPresentation();
  await page
    .getByRole('form', { name: 'Оформление', exact: true })
    .getByRole('button', { name: 'Сохранить оформление', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('другом окне');
  await page
    .getByRole('form', { name: 'Оформление', exact: true })
    .getByRole('button', { name: 'Отменить изменения оформления', exact: true })
    .click();
  await page.getByRole('button', { name: 'Загрузить сохранённое оформление', exact: true }).click();
  await expect(page.getByLabel('Анимации', { exact: false })).toHaveValue('system');
  await expect(page.getByLabel('Боковая панель', { exact: false })).toHaveValue('collapsed');
});
test('dirty independent profile blocks header preference writes without storing a cross-user browser preference', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.addInitScript(() => localStorage.setItem('asa-portal-sidebar', 'collapsed'));
  await page.goto('/#/account');
  await expect(page.locator('#portal-sidebar')).not.toHaveClass(/collapsed/);
  await page.getByLabel('Отображаемое имя').fill('Несохранённое новое имя');
  const collapse = page.getByRole('button', { name: 'Свернуть боковую панель', exact: true });
  await expect(collapse).toBeDisabled();
  await expect(collapse).toHaveAttribute(
    'title',
    'Сначала сохраните или отмените изменения настроек',
  );
  expect(state.mutations).not.toContain('/api/account/presentation');
});

for (const width of [1440, 1024, 390, 320]) {
  test(`Account changed terminal presentation state and explicit refresh fit ${width}px`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/account/interface');
    await page.getByLabel('Анимации', { exact: false }).selectOption('reduce');
    state.changePresentationActor();
    await page
      .getByRole('form', { name: 'Оформление', exact: true })
      .getByRole('button', { name: 'Сохранить оформление', exact: true })
      .click();
    await expect(page.locator('.account-presentation').getByRole('alert')).toContainText(
      'Аккаунт изменился',
    );
    await expect(
      page.getByRole('button', { name: 'Обновить страницу', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Загрузить сохранённое оформление', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel('Анимации', { exact: false })).toHaveValue('system');
    await expect(page.getByLabel('Анимации', { exact: false })).toBeDisabled();
    await expect(
      page
        .getByRole('form', { name: 'Оформление', exact: true })
        .getByRole('button', { name: 'Отменить изменения оформления', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText('Предпросмотр только здесь; изменения ещё не сохранены.', { exact: true }),
    ).toHaveCount(0);
    const metrics = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
    await page.screenshot({
      path: `${evidence}/settings-usability-actor-changed-${width}.png`,
      fullPage: true,
    });
    expect(state.mutations.filter((path) => path === '/api/account/presentation')).toHaveLength(1);
  });
}

const avatarEvidence = 'reports/playwright/settings-ui/portal-avatar-s2-20261008';
async function assertAvatarGeometry(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  const metrics = await dialog.evaluate((element) => {
    const preview = element
      .querySelector('img[alt="Предпросмотр аватара"]')!
      .getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const tiles = [...element.querySelectorAll('.avatar-selection-grid button')].map((tile) => {
      const r = tile.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    });
    return {
      preview: { width: preview.width, height: preview.height },
      bounds: { x: bounds.x, right: bounds.right, top: bounds.top, bottom: bounds.bottom },
      tiles,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(metrics.preview.width).toBeGreaterThanOrEqual(240);
  expect(metrics.preview.width).toBeLessThanOrEqual(320);
  expect(metrics.preview.height).toBe(metrics.preview.width);
  expect(metrics.pageOverflow).toBe(false);
  expect(metrics.bounds.x).toBeGreaterThanOrEqual(0);
  expect(metrics.bounds.right).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(metrics.bounds.top).toBeGreaterThanOrEqual(0);
  expect(metrics.bounds.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
  for (const tile of metrics.tiles) expect(Math.abs(tile.width - tile.height)).toBeLessThan(1);
  for (let i = 0; i < metrics.tiles.length; i++)
    for (let j = i + 1; j < metrics.tiles.length; j++) {
      const a = metrics.tiles[i]!,
        b = metrics.tiles[j]!;
      expect(
        Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1,
      ).toBe(false);
    }
  await expect(dialog.getByRole('button', { name: 'Закрыть выбор аватара' })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Использовать', exact: true })).toBeInViewport();
}
for (const width of [1440, 1024, 390, 320])
  for (const seat of [false, true]) {
    test(`S2 avatar chooser geometry ${seat ? 'seat' : 'account'} ${width} short screen`, async ({
      page,
    }) => {
      mkdirSync(avatarEvidence, { recursive: true });
      await page.setViewportSize({ width, height: 568 });
      const state = await fixture(page, { seat, presentationLongContent: true });
      await page.goto('/#/account');
      await page
        .locator('main')
        .getByRole('button', { name: 'Выбрать аватар', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
      await expect(dialog.getByRole('img', { name: 'Предпросмотр аватара' })).toBeVisible();
      await assertAvatarGeometry(page);
      if (seat) await expect(dialog.locator('input[type="file"]')).toHaveCount(0);
      await page.screenshot({
        path: `${avatarEvidence}/${seat ? 'seat' : 'account'}-${width}-short.png`,
      });
      const firstTile = dialog.getByRole('button', { name: 'Выбрать: Аватар 1', exact: true });
      await firstTile.scrollIntoViewIfNeeded();
      const reachability = await dialog.locator('.avatar-selection-grid').evaluate((grid) => {
        const r = grid.getBoundingClientRect(),
          parent = grid.closest('.avatar-selection')!.getBoundingClientRect();
        return {
          height: grid.clientHeight,
          visibleHeight: Math.min(r.bottom, parent.bottom) - Math.max(r.top, parent.top),
          contentHeight: grid.scrollHeight,
        };
      });
      expect(reachability.height).toBeGreaterThanOrEqual(80);
      expect(reachability.visibleHeight).toBeGreaterThanOrEqual(60);
      await dialog
        .getByRole('button', { name: 'Выбрать: Аватар 67', exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        dialog.getByRole('button', { name: 'Выбрать: Аватар 67', exact: true }),
      ).toBeInViewport();
      await firstTile.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${avatarEvidence}/${seat ? 'seat' : 'account'}-${width}-catalogue.png`,
      });
      writeFileSync(
        `${avatarEvidence}/${seat ? 'seat' : 'account'}-${width}-reachability.json`,
        JSON.stringify(reachability),
      );

      await dialog.getByRole('button', { name: 'Выбрать: Аватар 1', exact: true }).click();
      await expect(dialog.getByRole('img', { name: 'Предпросмотр аватара' })).toHaveAttribute(
        'src',
        /avatar-01.webp$/,
      );
      expect(state.mutations).not.toContain(
        seat ? '/api/class-join/me/avatar' : '/api/account/avatar',
      );
      await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(
        state.mutations.filter(
          (path) => path === (seat ? '/api/class-join/me/avatar' : '/api/account/avatar'),
        ),
      ).toHaveLength(1);
      await page
        .locator('main')
        .getByRole('button', { name: 'Выбрать аватар', exact: true })
        .click();
      await expect(dialog.getByRole('img', { name: 'Предпросмотр аватара' })).toHaveAttribute(
        'src',
        seat ? /avatar-01.webp$/ : /^data:image\/webp;base64,/,
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });
  }
test('S2 quick avatar access keeps routes and dirty drafts, returns focus to live account control', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/#/account');
  await page.getByLabel('Отображаемое имя').fill('Черновик имени');
  const menu = page.locator('.portal-account > summary');
  await menu.click();
  await page.getByRole('button', { name: 'Открыть выбор аватара', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/#\/account$/);
  await dialog.getByRole('button', { name: 'Выбрать: Аватар 3', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Черновик имени');
  expect(state.mutations).not.toContain('/api/account/avatar');
  expect(state.mutations).not.toContain('/api/account/profile');
  await page.locator('.portal-sidebar-avatar').click();
  await dialog.getByRole('button', { name: 'Выбрать: Аватар 4', exact: true }).click();
  await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Черновик имени');
  expect(state.mutations).not.toContain('/api/account/profile');
  await page.getByRole('button', { name: 'Интерфейс', exact: true }).click();
  const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
  await guard.getByRole('button', { name: 'Отменить изменения и перейти' }).click();
  await page.getByLabel('Анимации').selectOption('reduce');
  await page.locator('.portal-sidebar-avatar').click();
  await dialog.getByRole('button', { name: 'Выбрать: Аватар 5', exact: true }).click();
  await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
  await expect(page.getByLabel('Анимации')).toHaveValue('reduce');
  expect(state.mutations).not.toContain('/api/account/presentation');
  await expect(page).toHaveURL(/#\/account\/interface$/);
});
test('S2 mobile drawer avatar opens above the current page and cancels without mutation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const state = await fixture(page, { seat: true });
  await page.goto('/#/home');
  await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await page.locator('.portal-sidebar-avatar').click();
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.locator('.portal-sidebar')).not.toHaveClass(/mobile-open/);
  await dialog.getByRole('button', { name: 'Выбрать: Аватар 1', exact: true }).click();
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть меню', exact: true })).toBeFocused();
  expect(state.mutations).not.toContain('/api/class-join/me/avatar');
});
test('S2 upload is transformed for preview, explicit save and reopen retain current data URL', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/#/account');
  await page.locator('main').getByRole('button', { name: 'Выбрать аватар', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  await dialog
    .getByLabel('Загрузить свой аватар')
    .setInputFiles('apps/web/public/assets/avatars/default/avatar-02.webp');
  const preview = dialog.getByRole('img', { name: 'Предпросмотр аватара' });
  await expect(preview).toHaveAttribute('src', /^data:image\/webp;base64,/);
  expect(
    await preview.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight]),
  ).toEqual([320, 320]);
  expect(state.mutations).not.toContain('/api/account/avatar');
  await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .locator('main')
    .getByRole('button', { name: 'Увеличить и выбрать аватар', exact: true })
    .click();
  await expect(preview).toHaveAttribute('src', /^data:image\/webp;base64,/);
  await page.keyboard.press('Escape');
});
test('S2 save error stays visible, retry retains selected preview and Escape works after busy', async ({
  page,
}) => {
  await fixture(page);
  let failure = true;
  let saves = 0;
  await page.route('**/api/account/avatar', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { avatarDataUrl: null } });
    saves++;
    return failure
      ? route.fulfill({
          status: 503,
          json: { error: { code: 'unavailable', message: 'Проверочная ошибка сохранения' } },
        })
      : route.fulfill({ json: route.request().postDataJSON() });
  });
  await page.goto('/#/account');
  await page.locator('main').getByRole('button', { name: 'Выбрать аватар', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  await dialog.getByRole('button', { name: 'Выбрать: Аватар 6', exact: true }).click();
  await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Проверочная ошибка сохранения');
  await page.screenshot({ path: `${avatarEvidence}/account-error-retry.png` });
  await expect(
    dialog.getByRole('button', { name: 'Выбрать: Аватар 6', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(saves).toBe(1);
  await page.locator('main').getByRole('button', { name: 'Выбрать аватар', exact: true }).click();
  await dialog.getByRole('button', { name: 'Выбрать: Аватар 6', exact: true }).click();
  await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  failure = false;
  await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(saves).toBe(3);
});
for (const width of [1440, 1024, 390, 320])
  test(`S2 teacher avatar preview stages in narrow parent modal ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 568 });
    await fixture(page, { educator: true });
    const student = {
      id: 'seat-1',
      displayLabel: 'Ученица с длинным именем',
      studentCode: 'AbC123',
      loginHandle: 'AbC123',
      safeMode: true,
      status: 'issued',
      avatarKey: null,
      lastActiveAt: null,
      createdAt: '2026-01-01T00:00:00Z',
    };
    const writes: unknown[] = [];
    await page.route('**/api/classrooms/class-1/roster', (route) =>
      route.fulfill({ json: { items: [student] } }),
    );
    await page.route('**/api/classrooms/class-1/seats/seat-1', (route) => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({
        json: { student: { ...student, ...route.request().postDataJSON() } },
      });
    });
    await page.goto('/#/classrooms/class-1');
    await expect(
      page.getByRole('button', { name: 'Действия: Ученица с длинным именем', exact: true }),
    ).toBeVisible();
    const baselineLayout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: innerWidth,
    }));
    const baselineOverflow = baselineLayout.scrollWidth > baselineLayout.clientWidth;
    await page
      .getByRole('button', { name: 'Действия: Ученица с длинным именем', exact: true })
      .click();
    await page.getByRole('button', { name: 'Изменить данные', exact: true }).click();
    const parent = page.locator('.classroom-student-dialog');
    await parent
      .getByRole('textbox', { name: 'Имя в списке класса' })
      .fill('Изменённое имя ученика');
    await parent.getByRole('button', { name: 'Выбрать аватар ученика', exact: true }).click();
    await parent.getByRole('button', { name: 'Выбрать: Аватар 7', exact: true }).click();
    expect(writes).toHaveLength(0);
    const geometry = await parent.evaluate((element) => {
      const r = element.getBoundingClientRect();
      const content = element.querySelector('.avatar-selection')!.getBoundingClientRect();
      return {
        parentWidth: r.width,
        contentWidth: content.width,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(geometry.contentWidth).toBeLessThan(geometry.parentWidth);
    expect(geometry.overflow).toBe(baselineOverflow);
    writeFileSync(
      `${avatarEvidence}/teacher-${width}-layout.json`,
      JSON.stringify({ baseline: baselineLayout, chooser: geometry }),
    );
    await parent.getByRole('img', { name: 'Предпросмотр аватара' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${avatarEvidence}/teacher-${width}-short.png` });
    await parent.getByRole('button', { name: 'Использовать аватар', exact: true }).click();
    expect(writes).toHaveLength(0);
    await parent.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(parent).toHaveCount(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      avatarKey: 'asa-avatar-07',
      displayLabel: 'Изменённое имя ученика',
    });
  });

test('S2 late initial avatar GET cannot overwrite a confirmed save', async ({ page }) => {
  await fixture(page);
  let reads = 0;
  let release!: () => void;
  let staleDone!: () => void;
  const staleComplete = new Promise<void>((resolve) => {
    staleDone = resolve;
  });
  await page.route('**/api/account/avatar', async (route) => {
    if (route.request().method() !== 'GET')
      return route.fulfill({ json: route.request().postDataJSON() });
    reads++;
    if (reads === 1) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ json: { avatarDataUrl: null } });
      staleDone();
      return;
    }
    return route.fulfill({ json: { avatarDataUrl: null } });
  });
  await page.goto('/#/account');
  await page.locator('main').getByRole('button', { name: 'Выбрать аватар', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  await expect(
    dialog.getByRole('button', { name: 'Выбрать: Аватар 8', exact: true }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Выбрать: Аватар 8', exact: true }).click();
  await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.portal-sidebar-avatar img')).toHaveAttribute(
    'src',
    /^data:image\/webp;base64,/,
  );
  release();
  await staleComplete;
  await expect(page.locator('.portal-sidebar-avatar img')).toHaveAttribute(
    'src',
    /^data:image\/webp;base64,/,
  );
  await expect(page.getByRole('img', { name: 'Текущий аватар', exact: true })).toHaveAttribute(
    'src',
    /^data:image\/webp;base64,/,
  );
});
test('S2 lazy chooser failure keeps drafts, retries locally and leaves unrelated recovery alone', async ({
  page,
}) => {
  await fixture(page);
  let fail = true;
  await page.route('**/AvatarChooser-*.js', (route) => (fail ? route.abort() : route.fallback()));
  await page.goto('/#/account');
  await page.getByLabel('Отображаемое имя').fill('Черновик пережил загрузку');
  await page.locator('.portal-account > summary').click();
  await page.getByRole('button', { name: 'Открыть выбор аватара', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  await expect(dialog.getByRole('alert')).toContainText('Не удалось открыть выбор аватара');
  await expect(page).toHaveURL(/#\/account$/);
  expect(await page.evaluate(() => sessionStorage.getItem('asa-vite-preload-recovery'))).toBeNull();
  fail = false;
  await dialog.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(dialog.getByRole('img', { name: 'Предпросмотр аватара' })).toBeVisible();
  const unrelated = await page.evaluate(() => {
    sessionStorage.setItem('asa-vite-preload-recovery', String(Date.now()));
    let delivered = false;
    const listener = () => {
      delivered = true;
    };
    window.addEventListener('vite:preloadError', listener);
    const event = new Event('vite:preloadError', { cancelable: true }) as Event & {
      payload: Error;
    };
    event.payload = new Error('Failed to fetch OtherChunk-test.js');
    window.dispatchEvent(event);
    window.removeEventListener('vite:preloadError', listener);
    return { delivered, handledByGlobal: event.defaultPrevented };
  });
  expect(unrelated).toEqual({ delivered: true, handledByGlobal: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.portal-account > summary')).toBeFocused();
  const afterUnmount = await page.evaluate(() => {
    const event = new Event('vite:preloadError', { cancelable: true }) as Event & {
      payload: Error;
    };
    event.payload = new Error(
      `Failed to fetch dynamically imported module: ${location.origin}/assets/AvatarChooser-test.js`,
    );
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(afterUnmount).toBe(true);
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Черновик пережил загрузку');
});

test('S2 teacher optional catalogue failure preserves parent draft and retries locally', async ({
  page,
}) => {
  await fixture(page, { educator: true });
  let fail = true;
  const student = {
    id: 'seat-1',
    displayLabel: 'Ученица',
    studentCode: 'AbC123',
    loginHandle: 'AbC123',
    safeMode: true,
    status: 'issued',
    avatarKey: null,
    lastActiveAt: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
  await page.route('**/api/classrooms/class-1/roster', (route) =>
    route.fulfill({ json: { items: [student] } }),
  );
  await page.route('**/AvatarChooser-*.js*', (route) => (fail ? route.abort() : route.fallback()));
  await page.goto('/#/classrooms/class-1');
  await page.getByRole('button', { name: 'Действия: Ученица', exact: true }).click();
  await page.getByRole('button', { name: 'Изменить данные', exact: true }).click();
  const parent = page.locator('.classroom-student-dialog');
  await parent.getByRole('textbox', { name: 'Имя в списке класса' }).fill('Черновик преподавателя');
  await parent.getByRole('button', { name: 'Выбрать аватар ученика', exact: true }).click();
  await expect(parent.getByRole('alert')).toContainText('Не удалось открыть выбор аватара');
  expect(await page.evaluate(() => sessionStorage.getItem('asa-vite-preload-recovery'))).toBeNull();
  fail = false;
  await parent.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(parent.getByRole('img', { name: 'Предпросмотр аватара' })).toBeVisible();
  await expect(parent.getByRole('textbox', { name: 'Имя в списке класса' })).toHaveValue(
    'Черновик преподавателя',
  );
  await parent.getByRole('button', { name: 'Отменить выбор аватара', exact: true }).click();
  await expect(parent.getByRole('textbox', { name: 'Имя в списке класса' })).toHaveValue(
    'Черновик преподавателя',
  );
  await parent.getByRole('button', { name: 'Отмена', exact: true }).click();
});
test('S2 avatar library code is requested only when opening the chooser', async ({ page }) => {
  await fixture(page);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/AvatarChooser-/.test(request.url())) requests.push(request.url());
  });
  await page.goto('/#/home');
  await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.locator('.portal-account > summary').click();
  await page.getByRole('button', { name: 'Открыть выбор аватара', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Предпросмотр аватара' })).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
});
