import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

/** TST-E2E-ELECTRONICS-SLICE-001: a teacher creates a personal project without
 * a class, works in the full-screen electronics workbench, wires the circuit,
 * simulates, reloads and creates an immutable checkpoint. */

let admin: pg.Pool;
let teacher: SeededTeacher;

async function login(page: Page): Promise<void> {
  await loginWithOrganization(page, teacher);
}

async function createPersonalProject(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Что вы хотите создать?' })).toBeVisible();
  await page.getByLabel('Название проекта').fill(title);
  await expect(page.getByRole('dialog').getByText('Электроника', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Создать проект' }).click();
  await expect(page.getByLabel('Название проекта')).toHaveValue(title);
  await expect(page.getByRole('button', { name: 'Начать моделирование' })).toBeVisible();
}

async function addComponent(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click();
}

async function connect(page: Page, first: string, second: string): Promise<void> {
  await page.getByLabel(first).click();
  await page.getByLabel(second).click();
}

async function moveComponent(
  page: Page,
  kind: string,
): Promise<{ beforeX: number; afterX: number }> {
  const target = page
    .locator(`[data-testid="schematic-component"][data-kind="${kind}"]`)
    .first();
  const beforeX = Number(await target.getAttribute('data-x'));
  const box = await target.locator('.workbench-part').boundingBox();
  if (!box) throw new Error(`component ${kind} has no bounding box`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 100, startY + 60, {
    steps: 8,
  });
  await page.mouse.up();
  await expect.poll(async () => Number(await target.getAttribute('data-x'))).not.toBe(beforeX);
  return { beforeX, afterX: Number(await target.getAttribute('data-x')) };
}

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e-workbench');
});

test.afterAll(async () => {
  await admin.end();
});

test('teacher builds and preserves a personal circuit in the Tinkercad-style workbench', async ({
  page,
}) => {
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await login(page);
  await createPersonalProject(page, 'Демонстрация закона Ома');

  await expect(page.getByLabel('Библиотека компонентов')).toBeVisible();
  await expect(page.getByPlaceholder('Поиск')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Код' })).toBeDisabled();

  await addComponent(page, 'Батарейный отсек');
  await addComponent(page, 'Резистор');
  await addComponent(page, 'Светодиод');
  await expect(page.locator('[data-testid="schematic-component"]')).toHaveCount(3);
  await expect(page.locator('image[href$="power-source.svg"]')).toBeVisible();
  await expect(page.locator('image[href$="resistor.svg"]')).toBeVisible();
  await expect(page.locator('image[href$="led-red-off.svg"]')).toBeVisible();

  await connect(page, 'Батарейный отсек: вывод +', 'Резистор: вывод 1');
  await connect(page, 'Резистор: вывод 2', 'Светодиод: вывод A');
  await connect(page, 'Светодиод: вывод K', 'Батарейный отсек: вывод −');
  await expect(page.getByTestId('schematic-wire')).toHaveCount(3);

  const moved = await moveComponent(page, 'led');
  expect(moved.afterX).not.toBe(moved.beforeX);
  await page.getByRole('button', { name: 'Сохранить сейчас' }).click();
  await expect(page.getByText('Все изменения сохранены', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect(page.locator('.workbench-stage-status')).toContainText('Моделирование запущено');
  await expect(page.getByTestId('current-reading')).toContainText('3.3 мА');
  await expect(page.locator('image[href$="led-red-lit.svg"]')).toBeVisible();
  await expect(page.getByTestId('diagnostics')).toContainText('Цепь замкнута');

  mkdirSync('e2e/artifacts', { recursive: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: 'e2e/artifacts/electronics-desktop.png', fullPage: true });
  await page.screenshot({ path: 'e2e/artifacts/docker-electronics.png', fullPage: true });

  await page.reload();
  await expect(page.getByLabel('Название проекта')).toHaveValue('Демонстрация закона Ома');
  const led = page.locator('[data-testid="schematic-component"][data-kind="led"]').first();
  expect(Number(await led.getAttribute('data-x'))).toBe(moved.afterX);
  await expect(page.getByTestId('schematic-wire')).toHaveCount(3);

  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect(page.getByTestId('current-reading')).toContainText('3.3 мА');
  await page.getByRole('button', { name: 'Создать версию' }).click();
  await expect(page.getByText('Последняя версия: №1')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'e2e/artifacts/electronics-mobile.png', fullPage: true });
  failures.assertEmpty();
});

test('classes remain a separate teacher workspace from personal projects', async ({ page }) => {
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await login(page);
  await page.getByRole('button', { name: 'Классы' }).click();
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
  await expect(
    page.getByText(
      'Классы нужны для учеников, заданий и проверки. Личные проекты доступны отдельно.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Мои проекты' }).click();
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();
  failures.assertEmpty();
});
