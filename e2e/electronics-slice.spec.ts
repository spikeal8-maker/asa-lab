import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const REVIEW_DIR = 'docs/review/TASK_ELECTRONICS_M1_001';
const BASIC_FAMILY_ORDER = [
  'breadboard',
  'battery-holder-aa',
  'resistor',
  'led',
  'button',
  'spdt-switch',
  'potentiometer',
  'diode',
  'rgb-led',
  'seven-segment',
  'lamp',
] as const;

let admin: pg.Pool;
let teacher: SeededTeacher;

async function login(page: Page): Promise<void> {
  await loginWithOrganization(page, teacher);
}

async function createPersonalProject(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByLabel('Название проекта').fill(title);
  await page.getByRole('dialog').getByRole('button', { name: 'Создать проект' }).click();
  await expect(page.getByLabel('Название проекта')).toHaveValue(title);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${REVIEW_DIR}/${name}.png`, fullPage: true });
}

test.beforeAll(async () => {
  mkdirSync(REVIEW_DIR, { recursive: true });
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e-electronics-family-library');
});

test.afterAll(async () => {
  await admin.end();
});

test('family catalog navigation and selected variant persist in the real editor', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1680, height: 1040 });
  await login(page);
  await createPersonalProject(page, 'Electronics family library');

  const category = page.getByLabel('Категория компонентов');
  const cards = page.locator('.workbench-catalog-card');
  await expect(category).toHaveValue('basic');
  await expect(cards).toHaveCount(BASIC_FAMILY_ORDER.length);
  expect(
    await cards.evaluateAll((elements) =>
      elements.map((item) => item.getAttribute('data-family-id')),
    ),
  ).toEqual(BASIC_FAMILY_ORDER);
  await expect(page.locator('.workbench-catalog-grid')).toHaveAttribute(
    'data-library-view',
    'grid',
  );
  await screenshot(page, 'library-basic-default');

  await category.selectOption('power');
  await expect(page.locator('[data-family-id="battery-holder-aa"]')).toBeVisible();
  await expect(page.locator('[data-family-id="regulated-power-supply"]')).toBeVisible();
  await expect(
    page.locator('[data-family-id^="battery-"]:not([data-family-id="battery-holder-aa"])'),
  ).toHaveCount(0);
  await screenshot(page, 'library-category-power');

  const batteryVariant = page.getByLabel('Вариант Батарейный отсек AA');
  await expect(batteryVariant.locator('option')).toHaveCount(6);
  await batteryVariant.selectOption('battery-holder-aa-6');
  await expect(page.locator('[data-family-id="battery-holder-aa"]')).toHaveAttribute(
    'data-selected-variant',
    'battery-holder-aa-6',
  );
  await screenshot(page, 'library-family-battery-variants');

  await category.selectOption('basic');
  await page.getByPlaceholder('Поиск').fill('led');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('[data-family-id="led"]')).toBeVisible();
  await expect(page.locator('[data-family-id="rgb-led"]')).toBeVisible();
  await screenshot(page, 'library-search-led');

  await page.getByPlaceholder('Поиск').fill('');
  await category.selectOption('preview');
  await expect(cards.first()).toHaveAttribute('data-catalog-tier', 'preview');
  await expect(cards.locator('button:enabled')).toHaveCount(0);
  expect(
    await cards.evaluateAll((elements) =>
      elements.every((item) => item.getAttribute('draggable') !== 'true'),
    ),
  ).toBe(true);
  await screenshot(page, 'library-supported-vs-preview');

  await category.selectOption('all');
  await page.getByRole('button', { name: 'Переключить на список' }).click();
  await expect(page.locator('.workbench-catalog-grid')).toHaveAttribute(
    'data-library-view',
    'list',
  );
  await screenshot(page, 'library-list-view');

  await category.selectOption('power');
  await batteryVariant.selectOption('battery-holder-aa-6');
  await page.getByRole('button', { name: 'Батарейный отсек AA', exact: true }).click();
  const placedBattery = page.locator(
    '[data-testid="schematic-component"][data-component-type="battery-holder-aa-6"]',
  );
  await expect(placedBattery).toBeVisible();
  await expect(page.getByLabel('Вариант Батарейный отсек AA в проекте')).toHaveValue(
    'battery-holder-aa-6',
  );
  await page.getByRole('button', { name: 'Сохранить сейчас' }).click();
  await page.getByRole('button', { name: 'Создать версию' }).click();
  await expect(page.getByText('Последняя версия: №1')).toBeVisible();
  await page.reload();
  await expect(placedBattery).toBeVisible();
  await placedBattery.locator('.workbench-part').click();
  await expect(page.getByLabel('Вариант Батарейный отсек AA в проекте')).toHaveValue(
    'battery-holder-aa-6',
  );
  await expect(page.getByText('Последняя версия: №1')).toBeVisible();
  await screenshot(page, 'variant-persisted-after-reload');

  expect(failures.counts).toMatchObject({
    consoleErrors: 0,
    pageErrors: 0,
    failedRequests: 0,
    httpServerErrors: 0,
  });
  failures.assertEmpty();
});
