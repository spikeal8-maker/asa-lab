import { expect, test, type Page } from '@playwright/test';

// UI contract only: these responses represent the server's scoped decisions.
// This fixture does not prove backend ACLs or the future class game policy.
async function seatFixture(page: Page) {
  let ended = false;
  const requests: URL[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
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
                seatId: 'seat-navigation-own',
                displayName: 'Ученик навигации',
                safeMode: true,
                avatarKey: null,
              },
              classroom: { id: 'class-navigation', title: 'Класс', teacherDisplayName: 'Учитель' },
              expiresAt: '2099-01-01T00:00:00.000Z',
            },
      );
    if (path === '/api/class-join/logout') {
      ended = true;
      return json({ ok: true });
    }
    if (path === '/api/auth/refresh')
      return json({ error: { code: 'refresh_not_applicable', message: 'Seat session' } }, 409);
    if (path === '/api/modules') return json({ items: [] });
    if (path === '/api/projects')
      return json({
        items: [
          {
            id: 'seat-own-project',
            moduleKey: 'electronics',
            title: 'Моя схема',
            scope: 'personal',
            classroomId: 'class-navigation',
            status: 'active',
            createdAt: '2026-10-18T00:00:00.000Z',
            updatedAt: '2026-10-18T00:00:00.000Z',
            preview: null,
          },
        ],
      });
    if (path === '/api/projects/feedback') return json({ items: {} });
    if (path === '/api/gallery/mine') return json({ projectIds: [] });
    if (path.startsWith('/api/analytics/')) return json({ accepted: true });
    if (path.startsWith('/api/admin/'))
      return json({ error: { code: 'forbidden', message: 'forbidden' } }, 403);
    return json({ items: [], total: 0 });
  });
  return { requests, errors };
}

for (const width of [1440, 390, 320]) {
  test(`Seat reaches real projects and unavailable games at ${width}px`, async ({ page }) => {
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
    await expect(nav.getByRole('link', { name: 'Классы', exact: true })).toHaveCount(0);
    await expect(nav.locator('[data-admin-navigation]')).toHaveCount(0);
    const games = nav.getByRole('link', { name: 'Игры', exact: true });
    await expect(games).toHaveAttribute('href', '/#/games');
    await games.click();
    await expect(page).toHaveURL(/#\/games$/);
    await expect(page.getByRole('heading', { name: 'Игры', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Пока недоступно: Шахматы' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Пока недоступно: Шашки' })).toBeDisabled();
    if (width < 1024) await expect(menu).toBeFocused();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Игры', exact: true })).toBeVisible();
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
  });
}
