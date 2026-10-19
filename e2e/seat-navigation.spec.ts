import { expect, test, type Page } from '@playwright/test';

type AdmissionMode = 'allow' | 'deny' | 'pending' | 'unavailable';

// UI contract only. Active module metadata never grants a Seat admission.
// Real API/SQL permissions and revocation races are covered by Games admission tests.
async function seatFixture(page: Page, initialAdmission: AdmissionMode = 'deny') {
  let ended = false;
  let admission = initialAdmission;
  let releaseAdmission: () => void = () => undefined;
  const admissionReady = new Promise<void>((resolve) => {
    releaseAdmission = resolve;
  });
  const requests: URL[] = [];
  const projectWrites: URL[] = [];
  const gameProjectReads: URL[] = [];
  const admissionReads: string[] = [];
  const errors: string[] = [];
  const modules = ['electronics', 'three-d', 'chess', 'checkers'].map((moduleKey) => ({
    moduleKey,
    moduleVersion: '0.1.0',
    displayName: (
      {
        electronics: 'Электроника',
        'three-d': '3D',
        chess: 'Шахматы',
        checkers: 'Шашки',
      } as Record<string, string>
    )[moduleKey],
    shortDescription: moduleKey,
    defaultProjectTitlePrefix: 'Проект',
    projectType: moduleKey,
    schemaVersion: 1,
    editorRoute: '',
    viewerRoute: '',
    safeModeSupported: true,
    availability: 'active',
    previewKind: 'board',
    iconKey: moduleKey,
    categories: [],
    creatable: true,
  }));
  page.on('pageerror', (error) => errors.push(error.message));
  // This unrelated external SDK is unreachable in the isolated D2 browser.
  await page.route('https://st.max.ru/js/max-web-app.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const path = url.pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/me') return json({ authenticated: false });
    if (path === '/api/class-join/me')
      return json(
        ended
          ? { authenticated: false }
          : {
              authenticated: true,
              student: {
                seatId: '11111111-1111-4111-8111-111111111111',
                displayName: 'Ученик навигации',
                safeMode: true,
                avatarKey: null,
              },
              classroom: {
                id: '22222222-2222-4222-8222-222222222222',
                title: 'Класс',
                teacherDisplayName: 'Учитель',
              },
              expiresAt: '2099-01-01T00:00:00.000Z',
            },
      );
    if (path === '/api/class-join/logout') {
      ended = true;
      return json({ ok: true });
    }
    if (path === '/api/auth/refresh')
      return json({ error: { code: 'refresh_not_applicable', message: 'Seat session' } }, 409);
    if (path === '/api/modules') return json({ items: modules });
    if (path === '/api/games/access') {
      const game = url.searchParams.get('game') ?? '';
      admissionReads.push(game);
      if (!['chess', 'checkers'].includes(game))
        return json({ error: { code: 'invalid_game', message: 'Unknown game' } }, 400);
      if (admission === 'pending') await admissionReady;
      if (admission === 'unavailable')
        return json(
          {
            error: {
              code: 'admission_unavailable',
              message: 'Не удалось проверить доступ к играм.',
            },
          },
          503,
        );
      return json({
        granted: admission === 'allow',
        reason: admission === 'allow' ? 'allowed' : 'class_disabled',
        threshold: null,
      });
    }
    if (path === '/api/projects') {
      if (route.request().method() !== 'GET') {
        projectWrites.push(url);
        return json(
          { error: { code: 'games_access_denied', message: 'Учитель отключил игры для класса.' } },
          403,
        );
      }
      if (['chess', 'checkers'].includes(url.searchParams.get('module') ?? '')) {
        gameProjectReads.push(url);
        return json({ items: [] });
      }
      return json({
        items: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            moduleKey: 'electronics',
            title: 'Моя схема',
            scope: 'personal',
            classroomId: '22222222-2222-4222-8222-222222222222',
            status: 'active',
            createdAt: '2026-10-18T00:00:00.000Z',
            updatedAt: '2026-10-18T00:00:00.000Z',
            preview: null,
          },
        ],
      });
    }
    if (path === '/api/projects/feedback') return json({ items: {} });
    if (path === '/api/gallery/mine') return json({ projectIds: [] });
    if (path.startsWith('/api/analytics/')) return json({ accepted: true });
    if (path.startsWith('/api/admin/'))
      return json({ error: { code: 'forbidden', message: 'forbidden' } }, 403);
    return json({ items: [], total: 0 });
  });
  return {
    requests,
    errors,
    projectWrites,
    gameProjectReads,
    admissionReads,
    setAdmission(next: Exclude<AdmissionMode, 'pending'>): void {
      admission = next;
      releaseAdmission();
    },
  };
}

async function expectDeniedGames(page: Page): Promise<void> {
  for (const title of ['Шахматы', 'Шашки']) {
    const card = page.getByRole('button', { name: `Сейчас недоступно: ${title}`, exact: true });
    await expect(card).toBeDisabled();
    await expect(card).toContainText('Учитель отключил игры для класса.');
  }
}

for (const width of [1440, 1024, 390, 320]) {
  test(`Seat reaches scoped projects and server-denied games at ${width}px`, async ({ page }) => {
    const state = await seatFixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/projects');
    await expect(page.getByRole('heading', { name: 'Мои проекты', exact: true })).toBeVisible();
    await expect(page.getByText('Моя схема', { exact: true })).toBeVisible();
    expect(state.requests.some((url) => url.pathname === '/api/projects')).toBe(true);
    const nav = page.locator('#portal-sidebar');
    const menu = page.getByRole('button', { name: 'Открыть меню', exact: true });
    if (width < 1024) {
      await menu.click();
      await expect(nav).toHaveAttribute('aria-modal', 'true');
      await page.keyboard.press('Escape');
      await expect(menu).toBeFocused();
      await menu.click();
    }
    await expect(nav.getByRole('link', { name: 'Мои проекты', exact: true })).toHaveAttribute(
      'href',
      '/#/projects',
    );
    const headerAi = page.locator('.portal-global-nav > a[aria-label="ИИ"]');
    const drawerAi = nav.locator('.portal-mobile-public').getByRole('link', {
      name: 'ИИ',
      exact: true,
      includeHidden: true,
    });
    for (const ai of [headerAi, drawerAi]) {
      await expect(ai).toHaveAttribute('href', '/#/ai');
      expect(await ai.evaluate((link) => link.tagName)).toBe('A');
    }
    await expect(nav.locator('.portal-nav > a[href="/#/ai"]')).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Классы', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Курсы и задания', exact: true })).toHaveCount(0);
    await expect(nav.locator('[data-admin-navigation]')).toHaveCount(0);
    const games = nav.getByRole('link', { name: 'Игры', exact: true });
    await expect(games).toHaveAttribute('href', '/#/games');
    await games.click();
    await expect(page).toHaveURL(/#\/games$/);
    await expect(page.getByRole('heading', { name: 'Игры', exact: true })).toBeVisible();
    await expectDeniedGames(page);
    expect(state.admissionReads).toEqual(expect.arrayContaining(['chess', 'checkers']));
    expect(state.gameProjectReads).toEqual([]);
    expect(state.projectWrites).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width < 1024) await expect(menu).toBeFocused();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Игры', exact: true })).toBeVisible();
    await expectDeniedGames(page);
    if (width < 1024) await menu.click();
    await nav.getByRole('link', { name: 'Мои проекты', exact: true }).click();
    await expect(page).toHaveURL(/#\/projects$/);
    await expect(page.getByText('Моя схема', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Моя схема', { exact: true })).toBeVisible();
    expect(state.requests.some((url) => /\/api\/account\//.test(url.pathname))).toBe(false);
    expect(state.requests.some((url) => /\/api\/workspaces\//.test(url.pathname))).toBe(false);
    expect(state.errors).toEqual([]);
    // Existing Seat logout must remove the authenticated shell and own items.
    if (width < 1024) await menu.click();
    else await page.locator('.portal-account > summary').click();
    await page
      .locator('button:visible')
      .filter({ hasText: /^Выход$/ })
      .click();
    await expect(page.locator('#portal-sidebar')).toHaveCount(0);
    await expect(page.getByText('Моя схема', { exact: true })).toHaveCount(0);
    expect(state.projectWrites).toEqual([]);
  });
}

test('Seat rechecks admission at play time after an earlier allowed catalogue receipt', async ({
  page,
}) => {
  const state = await seatFixture(page, 'allow');
  await page.goto('/#/games');
  const chess = page.getByRole('button', { name: 'Играть: Шахматы', exact: true });
  await expect(chess).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Играть: Шашки', exact: true })).toBeEnabled();
  const before = state.admissionReads.length;
  state.setAdmission('deny');
  await chess.click();
  await expect(page.getByRole('alert')).toContainText('Учитель отключил игры для класса.');
  expect(state.admissionReads.length).toBe(before + 1);
  await expect(page).toHaveURL(/#\/games$/);
  expect(state.gameProjectReads).toEqual([]);
  expect(state.projectWrites).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('Seat cannot start active modules while admission is pending', async ({ page }) => {
  const state = await seatFixture(page, 'pending');
  await page.goto('/#/games');
  await expect(
    page.getByRole('button', { name: 'Загрузка…: Шахматы', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Загрузка…: Шашки', exact: true })).toBeDisabled();
  await expect.poll(() => state.admissionReads.length).toBe(2);
  expect(state.projectWrites).toEqual([]);
  state.setAdmission('deny');
  await expectDeniedGames(page);
  expect(state.gameProjectReads).toEqual([]);
  expect(state.projectWrites).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('Seat keeps active games unavailable after an admission error and retries the server decision', async ({
  page,
}) => {
  const state = await seatFixture(page, 'unavailable');
  await page.goto('/#/games');
  await expect(page.getByRole('alert')).toContainText(
    'Не удалось загрузить игры. Попробуйте ещё раз.',
  );
  await expect(page.locator('.game-card').nth(0)).toBeDisabled();
  await expect(page.locator('.game-card').nth(1)).toBeDisabled();
  state.setAdmission('deny');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expectDeniedGames(page);
  expect(state.admissionReads.filter((game) => game === 'chess')).toHaveLength(2);
  expect(state.admissionReads.filter((game) => game === 'checkers')).toHaveLength(2);
  expect(state.gameProjectReads).toEqual([]);
  expect(state.projectWrites).toEqual([]);
  expect(state.errors).toEqual([]);
});
