import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const REVIEW_DIR = 'docs/review/TASK_ELECTRONICS_M1_001';
const OWNER_REFERENCE = process.env['ASA_E2E_OWNER_REFERENCE'];
const BASIC_FAMILY_ORDER = [
  'resistor',
  'led',
  'button',
  'potentiometer',
  'capacitor',
  'spdt-switch',
  'battery',
  'breadboard',
  'microbit',
  'arduino-uno',
  'vibration-motor',
  'dc-motor',
  'servo',
  'battery-holder-aa',
  'diode',
  'rgb-led',
  'seven-segment',
  'lamp',
  'regulated-power-supply',
  'photoresistor',
  'transistor-npn',
  'piezo',
  'multimeter',
] as const;

const ownerEmail = process.env['ASA_E2E_OWNER_EMAIL'];
const ownerPassword = process.env['ASA_E2E_OWNER_PASSWORD'];
const externalOwner = Boolean(ownerEmail && ownerPassword);

let admin: pg.Pool | null = null;
let teacher: SeededTeacher | null = null;

async function login(page: Page): Promise<void> {
  if (externalOwner && ownerEmail && ownerPassword) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByLabel('Email или имя пользователя').fill(ownerEmail);
    await page.getByLabel('Пароль').fill(ownerPassword);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page).toHaveURL(/#\/home$/);
    return;
  }
  if (!teacher) throw new Error('isolated Electronics E2E teacher is unavailable');
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

async function dragTo(locator: Locator, page: Page, x: number, y: number): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('component has no visual bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
}

async function createComparison(page: Page): Promise<void> {
  if (!OWNER_REFERENCE) return;
  const owner = readFileSync(OWNER_REFERENCE).toString('base64');
  const current = readFileSync(`${REVIEW_DIR}/editor-idle-clean.png`).toString('base64');
  const comparison = await page.context().newPage();
  await comparison.setViewportSize({ width: 2048, height: 1220 });
  await comparison.setContent(`
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; background: #eef1f4; font-family: Segoe UI, sans-serif; color: #304352; }
      main { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; height: 1220px; padding: 12px; }
      figure { display: grid; grid-template-rows: 42px 1fr; min-width: 0; margin: 0; overflow: hidden; border: 1px solid #cfd6dc; background: #fff; }
      figcaption { display: grid; place-items: center; border-bottom: 1px solid #dbe1e6; font-weight: 700; }
      img { width: 100%; height: 100%; object-fit: contain; object-position: top center; background: #f4f5f7; }
    </style>
    <main>
      <figure><figcaption>Owner reference · 100%</figcaption><img src="data:image/png;base64,${owner}"></figure>
      <figure><figcaption>ASA Lab · current implementation · 100%</figcaption><img src="data:image/png;base64,${current}"></figure>
    </main>
  `);
  await comparison.screenshot({
    path: `${REVIEW_DIR}/owner-reference-vs-current.png`,
    fullPage: true,
  });
  await comparison.close();
}

test.beforeAll(async () => {
  mkdirSync(REVIEW_DIR, { recursive: true });
  if (externalOwner) return;
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e-electronics-owner-visual-parity');
});

test.afterAll(async () => {
  await admin?.end();
});

test('owner-reference presentation states in the real Electronics editor', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 2048, height: 1220 });
  await login(page);
  await createPersonalProject(page, 'Electronics owner visual parity');

  await page.getByRole('button', { name: 'Схема', exact: true }).click();
  await expect(page.locator('.workbench-schematic-view')).toBeVisible();
  await page.getByRole('button', { name: 'Список компонентов', exact: true }).click();
  await expect(page.locator('.workbench-bom-view')).toBeVisible();
  await page.getByRole('button', { name: 'Макет', exact: true }).click();
  await expect(page.locator('.workbench-stage')).toBeVisible();

  await page.getByRole('button', { name: 'Код', exact: true }).click();
  const codePanel = page.locator('.workbench-utility-panel.code');
  await expect(codePanel).toContainText('Нет программируемых компонентов');
  await codePanel.getByRole('button', { name: 'Закрыть' }).click();
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  const notesPanel = page.locator('.workbench-utility-panel.notes');
  const notesField = notesPanel.getByRole('textbox', { name: 'Заметки проекта' });
  await notesField.fill('Проверка заметки Electronics');
  await notesPanel.getByRole('button', { name: 'Закрыть' }).click();
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await expect(notesField).toHaveValue('Проверка заметки Electronics');
  await notesPanel.getByRole('button', { name: 'Закрыть' }).click();
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  const shareDialog = page.getByRole('dialog', { name: 'Отправить проект' });
  await expect(shareDialog.getByRole('textbox', { name: 'Ссылка на проект' })).toBeVisible();
  await shareDialog.getByRole('button', { name: 'Закрыть' }).click();

  const category = page.getByLabel('Категория компонентов');
  const grid = page.locator('.workbench-catalog-grid');
  const cards = page.locator('.workbench-catalog-card');
  await expect(category).toHaveValue('basic');
  await expect(cards).toHaveCount(BASIC_FAMILY_ORDER.length);
  expect(
    await cards.evaluateAll((elements) =>
      elements.map((item) => item.getAttribute('data-family-id')),
    ),
  ).toEqual(BASIC_FAMILY_ORDER);
  expect(
    await grid.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
    ),
  ).toBe(3);
  await expect(cards.locator('select')).toHaveCount(0);
  await expect(cards.locator('small')).toHaveCount(0);
  await page.getByRole('button', { name: 'Переключить на список' }).click();
  await expect(grid).toHaveAttribute('data-library-view', 'list');
  await expect(cards.locator('small')).toHaveCount(BASIC_FAMILY_ORDER.length);
  await expect(cards.first()).toContainText('Цветовые полосы');
  await page.getByRole('button', { name: 'Переключить на сетку' }).click();
  await expect(grid).toHaveAttribute('data-library-view', 'grid');
  await page.getByRole('textbox', { name: 'Поиск компонентов' }).fill('LED');
  await expect(cards).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Поиск компонентов' }).fill('');
  await expect(cards).toHaveCount(BASIC_FAMILY_ORDER.length);
  await screenshot(page, 'library-basic-three-columns');
  await screenshot(page, 'library-basic-exact-order');

  const disabledCards = page.locator('.workbench-catalog-card[aria-disabled="true"]');
  await expect(disabledCards).toHaveCount(12);
  expect(
    await disabledCards.evaluateAll((elements) =>
      elements.every(
        (item) =>
          item.getAttribute('draggable') !== 'true' &&
          item.getAttribute('aria-disabled') === 'true',
      ),
    ),
  ).toBe(true);
  await screenshot(page, 'library-disabled-components');

  const stage = page.locator('svg.workbench-canvas');
  const stageBox = await stage.boundingBox();
  if (!stageBox) throw new Error('stage has no visual bounding box');
  const placementTargets = [
    ['Макетная плата', 0.33, 0.68],
    ['Резистор', 0.46, 0.31],
    ['Светодиод', 0.58, 0.31],
    ['Кнопка', 0.46, 0.48],
    ['Ползунковый переключатель', 0.58, 0.48],
  ] as const;
  for (const [name, xRatio, yRatio] of placementTargets) {
    const before = await page.locator('[data-testid="schematic-component"]').count();
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('[data-testid="schematic-component"]')).toHaveCount(before);
    await page.mouse.move(
      stageBox.x + stageBox.width * xRatio,
      stageBox.y + stageBox.height * yRatio,
    );
    await expect(page.getByTestId('catalog-placement-preview')).toBeVisible();
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.getByTestId('catalog-placement-preview')).toHaveCount(0);
    await expect(page.locator('[data-testid="schematic-component"]')).toHaveCount(before + 1);
  }

  const board = page.locator(
    '[data-testid="schematic-component"][data-component-type="breadboard-medium"]',
  );
  const led = page.locator('[data-testid="schematic-component"][data-component-type="led-5mm"]');
  const resistor = page.locator(
    '[data-testid="schematic-component"][data-component-type="resistor-axial"]',
  );
  const boardBox = await board.boundingBox();
  if (!boardBox) throw new Error('breadboard has no visual bounding box');
  await dragTo(
    led.locator('.workbench-part'),
    page,
    boardBox.x + boardBox.width * 0.76,
    boardBox.y + boardBox.height * 0.48,
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('.workbench-toast')).toHaveCount(0);

  await expect(page.locator('.workbench-stage-controls').getByRole('button')).toHaveCount(3);
  await expect(page.locator('.workbench-snap-link')).toHaveCount(0);
  await expect(page.locator('.workbench-component-diagnostic')).toHaveCount(0);
  await expect(page.locator('.workbench-results')).toHaveCount(0);
  expect(
    await page
      .locator('.workbench-terminal-dot')
      .evaluateAll((elements) => elements.every((item) => getComputedStyle(item).opacity === '0')),
  ).toBe(true);
  await screenshot(page, 'editor-idle-clean');

  const resistorTerminal = resistor.locator('.workbench-terminal');
  await resistorTerminal.first().hover();
  expect(
    await resistor
      .locator('.workbench-terminal-dot')
      .evaluateAll((elements) => elements.some((item) => getComputedStyle(item).opacity === '1')),
  ).toBe(true);
  await screenshot(page, 'component-hover-terminal');

  await resistor.locator('.workbench-terminal-hit').first().click();
  await expect(page.locator('.workbench-canvas')).toHaveClass(/wiring/);
  expect(
    await page
      .locator('.workbench-terminal-dot')
      .evaluateAll(
        (elements) => elements.filter((item) => getComputedStyle(item).opacity === '1').length,
      ),
  ).toBeLessThanOrEqual(1);
  await screenshot(page, 'wiring-mode-terminals');

  await page.keyboard.press('Escape');
  await expect(page.locator('.workbench-toast')).toHaveCount(0);
  await resistor.locator('.workbench-part').click();
  await expect(page.locator('.workbench-selection-box')).toHaveCount(0);
  await expect(resistor.locator('.workbench-tinkercad-selection')).toHaveCount(1);
  expect(
    await resistor
      .locator('.workbench-terminal-dot')
      .evaluateAll((elements) => elements.every((item) => getComputedStyle(item).opacity === '0')),
  ).toBe(true);
  await screenshot(page, 'component-selected');

  await page.keyboard.press('Escape');
  await expect(page.locator('.workbench-toast')).toHaveCount(0);
  await screenshot(page, 'breadboard-placement-clean');
  await createComparison(page);

  expect(failures.counts).toMatchObject({
    consoleErrors: 0,
    pageErrors: 0,
    failedRequests: 0,
    httpServerErrors: 0,
  });
  failures.assertEmpty();
});
