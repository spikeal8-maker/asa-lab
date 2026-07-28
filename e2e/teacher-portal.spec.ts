import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';
import { signInThroughOrganization } from './entry';

/** TST-E2E-PORTAL-001: real browser flow —
 * login → empty state → create classroom → card visible → reload → card
 * remains → logout. Saves desktop and mobile evidence screenshots. */

let admin: pg.Pool;
let teacher: SeededTeacher;

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e');
});

test.afterAll(async () => {
  await admin.end();
});

test('teacher logs in, creates a classroom and it survives reload', async ({ page }) => {
  await signInThroughOrganization(page, teacher);

  // Classes live in their own section of the project-first workbench.
  await page.getByRole('button', { name: 'Классы' }).click();
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Создайте первый класс' })).toBeVisible();

  const createButton = page.getByRole('button', { name: 'Создать класс' }).first();
  await createButton.click();
  await expect(page.getByLabel('Название класса')).toBeFocused();
  await page.getByLabel('Название класса').fill('8А Робототехника');
  await page.getByRole('dialog').getByRole('button', { name: 'Создать' }).click();

  const card = page.getByTestId('classroom-card').filter({ hasText: '8А Робототехника' });
  await expect(card).toBeVisible();
  await expect(page.getByText('Класс «8А Робототехника» создан.')).toBeVisible();
  await expect(createButton).toBeFocused();

  mkdirSync('e2e/artifacts', { recursive: true });
  await page.screenshot({ path: 'e2e/artifacts/portal-desktop.png', fullPage: true });

  await page.reload();
  await page.getByRole('button', { name: 'Классы' }).click();
  await expect(
    page.getByTestId('classroom-card').filter({ hasText: '8А Робототехника' }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'e2e/artifacts/portal-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByTestId('entry-sign-in')).toBeVisible();
});
