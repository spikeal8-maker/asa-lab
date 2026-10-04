import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import type pg from 'pg';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';
import { openExistingAssignmentEditor, openNewAssignmentEditor } from './learning-authoring-navigation';

const evidenceDir = 'e2e/artifacts/learning/v-ux2a';

let admin: pg.Pool;
let teacher: SeededTeacher;

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'v-ux2a-assignment-list');
  mkdirSync(evidenceDir, { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('V-UX2A assignment list is list-first, real-data filtered and responsive', async ({ page }) => {
  test.setTimeout(90_000);
  await loginWithOrganization(page, teacher);

  await page.goto('/#/challenges');
  await expect(page.getByRole('heading', { name: 'Задания', exact: true })).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
  await expect(page.getByText('Заданий пока нет.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Новое задание/ })).toBeVisible();

  await openNewAssignmentEditor(page);
  await page.getByLabel('Название материала', { exact: true }).fill('Автоматический ночник');
  await page
    .getByLabel('Содержание', { exact: true })
    .fill('Соберите схему автоматического ночника. Светодиод должен включаться при уменьшении освещения.');
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText(/Опубликована версия 1/)).toBeVisible();

  await openNewAssignmentEditor(page);
  await page.getByLabel('Название материала', { exact: true }).fill('Светофор');
  await page
    .getByLabel('Содержание', { exact: true })
    .fill('Соберите светофор и запрограммируйте последовательность сигналов.');
  await page.getByRole('button', { name: 'Создать материал', exact: true }).click();
  await expect(
    page.getByText('Черновик сохранён. Публикация — отдельное действие.', { exact: true }),
  ).toBeVisible();

  await page.goto('/#/challenges');
  const rows = page.locator('.authored-assignment-row');
  await expect(rows).toHaveCount(2);
  await expect(page.getByText('Автоматический ночник', { exact: true })).toBeVisible();
  await expect(page.getByText('Светофор', { exact: true })).toBeVisible();
  await expect(page.getByText('Опубликовано', { exact: true })).toBeVisible();
  await expect(page.getByText('Черновик', { exact: true })).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);

  const search = page.getByPlaceholder('Поиск заданий');
  await search.fill('Светофор');
  await expect(rows).toHaveCount(1);
  await expect(page.getByText('Светофор', { exact: true })).toBeVisible();
  await search.fill('');

  const status = page.getByLabel('Фильтр по статусу');
  await status.selectOption('published');
  await expect(rows).toHaveCount(1);
  await expect(page.getByText('Автоматический ночник', { exact: true })).toBeVisible();
  await status.selectOption('all');
  await expect(rows).toHaveCount(2);

  await openExistingAssignmentEditor(page, 'Автоматический ночник');
  await expect(page.getByLabel('Название материала', { exact: true })).toBeVisible();
  await expect(page.locator('.authored-assignment-row')).toHaveCount(0);
  await expect(page.locator('aside[aria-label="Библиотека материалов"]')).toBeHidden();
  await page.getByRole('button', { name: '← Задания', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Задания', exact: true })).toBeVisible();

  for (const [width, height, file] of [
    [1440, 900, 'desktop-1440.png'],
    [390, 844, 'mobile-390.png'],
    [320, 720, 'mobile-320.png'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(rows).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `${evidenceDir}/${file}`, fullPage: true });
  }
});
