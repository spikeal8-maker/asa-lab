import { test, expect } from '@playwright/test';
import pg from 'pg';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

/** Live verification against the running demo: no mocks, no route stubs. */
let admin: pg.Pool;
let teacher: SeededTeacher;
test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'live');
});
test.afterAll(async () => {
  await admin.end();
});

test('portal, chooser and module states load without console or page errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  const failedRequests: string[] = [];
  page.on('response', (r) => {
    // The anonymous session probe before sign-in answers 401 by design.
    const anonymousProbe = r.status() === 401 && r.url().endsWith('/api/auth/me');
    if (r.status() >= 400 && !anonymousProbe) failedRequests.push(`${r.status()} ${r.url()}`);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByTestId('entry-school-educator').click();
  await page.getByRole('button', { name: 'Войти через организацию' }).click();
  await page.getByLabel('Код организации').fill(teacher.workspace);
  await page.getByLabel('Email').fill(teacher.email);
  await page.getByLabel('Пароль').fill(teacher.password);
  await page.getByRole('button', { name: 'Войти через организацию' }).click();

  // My projects loads
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();

  // The anonymous session probe before sign-in answers 401 by design and the
  // browser echoes it; everything from here on must be clean.
  consoleErrors.length = 0;
  pageErrors.length = 0;
  failedRequests.length = 0;

  // Chooser loads from the live registry
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Что вы хотите создать?' })).toBeVisible();
  const tiles = page.locator('.module-tile');
  await expect(tiles).toHaveCount(6);

  // Electronics is selectable
  const electronics = page.locator('.module-tile', { hasText: 'Электроника' });
  await electronics.locator('input[value="electronics"]').check();
  await expect(electronics.locator('input[value="electronics"]')).toBeChecked();

  // Future environments are visibly marked and disabled
  const future = page.locator('.module-tile.disabled');
  await expect(future).toHaveCount(5);
  await expect(future.first()).toContainText('Скоро');
  for (const key of ['three-d', 'blocks', 'robotics', 'drawing', 'checkers']) {
    await expect(page.locator(`.module-tile input[value="${key}"]`)).toBeDisabled();
  }

  console.log(
    'LIVE errorTexts=' +
      JSON.stringify(consoleErrors) +
      ' consoleErrors=' +
      consoleErrors.length +
      ' pageErrors=' +
      pageErrors.length +
      ' failedRequests=' +
      JSON.stringify(failedRequests),
  );
  expect(failedRequests, 'no failing requests').toEqual([]);
  expect(consoleErrors, 'no console errors').toEqual([]);
  expect(pageErrors, 'no page errors').toEqual([]);
});
