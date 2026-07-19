import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { adminPool, seedTeacher, type SeededTeacher } from '../tests/mvp/helpers';

/** TST-MVP-E2E-001: real browser flow —
 * login → empty state → create classroom → card visible → reload → card
 * remains → logout. Saves a dashboard screenshot artifact. */

let admin: pg.Pool;
let teacher: SeededTeacher;

test.beforeAll(async () => {
  admin = adminPool();
  teacher = await seedTeacher(admin, 'e2e');
});

test.afterAll(async () => {
  await admin.end();
});

test('teacher logs in, creates a classroom and it survives reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ASA Lab' })).toBeVisible();

  await page.getByLabel('Workspace').fill(teacher.workspace);
  await page.getByLabel('Email').fill(teacher.email);
  await page.getByLabel('Пароль').fill(teacher.password);
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
  await expect(page.getByText('Классов пока нет.')).toBeVisible();

  await page.getByRole('button', { name: 'Создать класс' }).click();
  await page.getByLabel('Название класса').fill('8А Робототехника');
  await page.getByRole('dialog').getByRole('button', { name: 'Создать' }).click();

  const card = page.getByTestId('classroom-card').filter({ hasText: '8А Робототехника' });
  await expect(card).toBeVisible();

  mkdirSync('e2e/artifacts', { recursive: true });
  await page.screenshot({ path: 'e2e/artifacts/dashboard.png', fullPage: true });

  await page.reload();
  await expect(
    page.getByTestId('classroom-card').filter({ hasText: '8А Робототехника' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByLabel('Workspace')).toBeVisible();
});
