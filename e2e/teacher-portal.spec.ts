import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

/** TST-E2E-PORTAL-001: real browser flow on the isolated test DB —
 * login → empty state → keyboard-friendly modal → create classroom → card →
 * reload persists → logout, with desktop and mobile screenshot artifacts. */

let admin: pg.Pool;
let teacher: SeededTeacher;

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e');
});

test.afterAll(async () => {
  await admin.end();
});

test('teacher logs in, creates a classroom via an accessible modal and it survives reload', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ASA Lab' })).toBeVisible();

  await page.getByLabel('Workspace').fill(teacher.workspace);
  await page.getByLabel('Email').fill(teacher.email);
  await page.getByLabel('Пароль').fill(teacher.password);
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
  await expect(page.getByText('Классов пока нет.')).toBeVisible();

  // Open the dialog: initial focus is on the title input.
  const openButton = page.getByRole('button', { name: 'Создать класс' });
  await openButton.click();
  const dialog = page.getByRole('dialog', { name: 'Создать класс' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Название класса')).toBeFocused();

  // Escape closes the dialog and focus returns to the opener.
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(openButton).toBeFocused();

  // Reopen with the keyboard and create.
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Название класса')).toBeFocused();
  await page.keyboard.type('8А Робототехника');
  await dialog.getByRole('button', { name: 'Создать' }).click();

  const card = page.getByTestId('classroom-card').filter({ hasText: '8А Робототехника' });
  await expect(card).toBeVisible();

  mkdirSync('e2e/artifacts', { recursive: true });
  await page.screenshot({ path: 'e2e/artifacts/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'e2e/artifacts/dashboard-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.reload();
  await expect(
    page.getByTestId('classroom-card').filter({ hasText: '8А Робототехника' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByLabel('Workspace')).toBeVisible();
});
