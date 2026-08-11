import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

let admin: pg.Pool;
let teacher: SeededTeacher;

async function createThreeDProject(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByLabel('Название проекта').fill(title);
  const tile = page.locator('.module-tile').filter({ hasText: 'ASA 3D' });
  await expect(tile).toContainText('Браузерное 3D-моделирование');
  await tile.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Создать проект' }).click();
  await expect(page.getByTestId('asa3d-viewport')).toBeVisible();
}

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e-three-d');
});

test.afterAll(async () => {
  await admin.end();
});

test('teacher models, autosaves, reloads and versions an ASA 3D scene', async ({ page }) => {
  test.setTimeout(150_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await loginWithOrganization(page, teacher);
  await createThreeDProject(page, 'Корпус датчика');

  await page.getByRole('button', { name: 'Параметры', exact: true }).click();
  await expect(page.getByLabel('Параметры рабочей плоскости')).toContainText('Миллиметры (мм)');
  await expect(page.getByLabel('Ширина, мм')).toHaveValue('200');
  await expect(page.getByLabel('Глубина, мм')).toHaveValue('200');
  await page.getByRole('button', { name: 'Закрыть параметры' }).click();

  await page.getByRole('button', { name: 'Поиск форм' }).click();
  await page.getByLabel('Название формы').fill('сф');
  await expect(page.locator('.asa3d-shape-card')).toHaveCount(1);
  await expect(page.locator('.asa3d-shape-card')).toContainText('Сфера');
  await page.getByRole('button', { name: 'Поиск форм' }).click();
  await expect(page.locator('.asa3d-shape-card')).toHaveCount(7);

  await page.getByRole('button', { name: 'Параллелепипед' }).click();
  await expect(page.getByLabel('Параметры выбранной формы')).toBeVisible();
  await page.getByLabel('Ширина, мм').fill('42');
  await page.getByLabel('Глубина, мм').fill('28');
  await page.getByLabel('Высота, мм').fill('12');
  await page.getByLabel('Положение X, мм').fill('16');
  await page.getByLabel('Поворот Z, градусов').fill('15');
  await page.getByRole('button', { name: 'Копировать (Ctrl+C)' }).click();
  await page.getByRole('button', { name: 'Вставить (Ctrl+V)' }).click();
  await expect(page.getByText('2 объекта', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)' }).click();
  await expect(page.getByText('1 объект', { exact: true })).toBeVisible();
  await expect(page.getByText('Все изменения сохранены', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.locator('.asa3d-toast').click();

  mkdirSync('e2e/artifacts', { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'e2e/artifacts/three-d-desktop.png', fullPage: true });

  await page.reload();
  await expect(page.getByTestId('asa3d-viewport')).toBeVisible();
  await expect(page.getByText('1 объект', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Версия/ }).click();
  await expect(page.getByText(/Создана неизменяемая версия №1/)).toBeVisible();

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByLabel('Библиотека форм')).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/three-d-tablet.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Библиотека форм')).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/three-d-mobile.png', fullPage: true });
  failures.assertEmpty();
});
