import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const REVIEW_DIR = 'docs/review/TASK_ELECTRONICS_M1_001';
const BOARD_LABEL = 'Макетка 420 точек';

const labels = {
  source: 'Батарейный отсек 2×AA',
  resistor: 'Осевой резистор',
  led: 'Светодиод 5 мм',
  rgb: 'RGB-светодиод',
  display: 'Семисегментный индикатор',
  button: 'Тактовая кнопка 6×6 мм',
  switch: 'Ползунковый переключатель SPDT',
  potentiometer: 'Потенциометр',
  diode: 'Диод DO-35',
  lamp: 'Лампа накаливания',
} as const;

interface BoardDefinition {
  componentId: string;
  holes: Array<{ id: string; groupId: string }>;
  groups: Record<string, string[]>;
}

const connectivity = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      'apps/web/public/assets/electronics/production/breadboard-connectivity.json',
    ),
    'utf8',
  ),
) as { boards: BoardDefinition[] };
const mediumBoard = connectivity.boards.find((board) => board.componentId === 'breadboard-medium');

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

async function addComponent(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click();
}

function component(page: Page, componentTypeId: string, index = 0): Locator {
  return page
    .locator(`[data-testid="schematic-component"][data-component-type="${componentTypeId}"]`)
    .nth(index);
}

async function dragOntoBoard(
  page: Page,
  componentTypeId: string,
  xFraction: number,
  yFraction: number,
): Promise<void> {
  const part = component(page, componentTypeId).locator('.workbench-part');
  const board = component(page, 'breadboard-medium');
  const [partBox, boardBox] = await Promise.all([part.boundingBox(), board.boundingBox()]);
  expect(partBox).not.toBeNull();
  expect(boardBox).not.toBeNull();
  if (!partBox || !boardBox) return;
  await page.mouse.move(partBox.x + partBox.width / 2, partBox.y + partBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    boardBox.x + boardBox.width * xFraction,
    boardBox.y + boardBox.height * yFraction,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect(component(page, componentTypeId)).not.toHaveAttribute('data-hole-bindings', '0');
}

function bindings(value: string | null): Record<string, string> {
  return Object.fromEntries(
    (value ?? '')
      .split(',')
      .filter(Boolean)
      .map((pair) => {
        const separator = pair.indexOf(':');
        return [pair.slice(0, separator), pair.slice(separator + 1)];
      }),
  );
}

function groupMate(holeId: string): string {
  const hole = mediumBoard?.holes.find((candidate) => candidate.id === holeId);
  const members = hole ? mediumBoard?.groups[hole.groupId] : undefined;
  return members?.find((candidate) => candidate !== holeId) ?? holeId;
}

function boardHole(page: Page, holeId: string): Locator {
  return page.getByRole('button', { name: `${BOARD_LABEL}: отверстие ${holeId}`, exact: true });
}

async function connect(first: Locator, second: Locator): Promise<void> {
  await first.click();
  await second.click();
}

function terminal(componentLocator: Locator, label: string, componentLabel: string): Locator {
  return componentLocator.getByRole('button', {
    name: `${componentLabel}: вывод ${label}`,
    exact: true,
  });
}

test.beforeAll(async () => {
  mkdirSync(REVIEW_DIR, { recursive: true });
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e-electronics-production-editor');
});

test.afterAll(async () => {
  await admin.end();
});

test('production catalog, states, breadboard nets and reload work in the real editor', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1680, height: 1040 });
  await login(page);
  await createPersonalProject(page, 'Electronics production integration');

  await expect(page.getByRole('button', { name: labels.source, exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Батарейный отсек 8×AA', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: BOARD_LABEL, exact: true })).toBeVisible();
  await expect(page.locator('.workbench-catalog-card')).toHaveCount(32);
  await screenshot(page, 'library-production');

  await addComponent(page, BOARD_LABEL);
  await expect(component(page, 'breadboard-medium')).toBeVisible();
  await expect(boardHole(page, 'J1')).toBeAttached();
  await screenshot(page, 'breadboard-empty');

  for (const label of Object.values(labels)) await addComponent(page, label);
  await addComponent(page, labels.display);
  await addComponent(page, labels.display);
  await addComponent(page, labels.display);

  await dragOntoBoard(page, 'resistor-axial', 0.25, 0.38);
  await dragOntoBoard(page, 'led-5mm', 0.57, 0.38);
  await dragOntoBoard(page, 'button-tactile-6mm', 0.42, 0.62);
  await expect(component(page, 'button-tactile-6mm')).toHaveAttribute('data-hole-bindings', '4');
  await component(page, 'button-tactile-6mm').locator('.workbench-part').click();
  await expect(page.getByTestId('hole-bindings')).toContainText('SW-A1');
  await screenshot(page, 'breadboard-components-snapped');

  await component(page, 'resistor-axial').locator('.workbench-part').click();
  await page.getByLabel('Сопротивление').fill('4700');
  await expect(
    component(page, 'resistor-axial').getByTestId('resistor-colour-bands'),
  ).toBeVisible();

  await component(page, 'led-5mm').locator('.workbench-part').click();
  await page.getByLabel('Цвет').selectOption('green');
  await page.getByLabel('Яркость обычного LED').fill('84');
  await expect(component(page, 'led-5mm').locator('image')).toHaveAttribute(
    'href',
    /\/green\/084\.svg$/,
  );

  await component(page, 'rgb-led').locator('.workbench-part').click();
  await page.getByLabel('RGB red').fill('100');
  await page.getByLabel('RGB green').fill('35');
  await page.getByLabel('RGB blue').fill('75');
  await expect(component(page, 'rgb-led').getByTestId('rgb-led-mixture')).toBeVisible();

  const glyphs = ['0', '8', 'A'] as const;
  for (const [index, glyph] of glyphs.entries()) {
    await component(page, 'seven-segment-display', index).locator('.workbench-part').click();
    await page.getByLabel('Символ семисегментного индикатора').selectOption(glyph);
    await expect(
      component(page, 'seven-segment-display', index).getByTestId('seven-segment-state'),
    ).toBeVisible();
  }
  await component(page, 'seven-segment-display', 3).locator('.workbench-part').click();
  await page.getByLabel('Маска сегментов').fill('a,f,g,c,d');
  await expect(
    component(page, 'seven-segment-display', 3).locator('[data-segment="g"]'),
  ).toBeVisible();

  await component(page, 'switch-spdt').locator('.workbench-part').click();
  await page.getByLabel('SPDT: common → right').check();
  await component(page, 'potentiometer').locator('.workbench-part').click();
  await page.getByRole('slider').fill('0.8');
  await expect(component(page, 'potentiometer').getByTestId('potentiometer-angle')).toBeVisible();
  await component(page, 'incandescent-lamp').locator('.workbench-part').click();
  await page.getByLabel('Состояние лампы').selectOption('max');
  await screenshot(page, 'led-rgb-display-states');

  const resistorBindings = bindings(
    await component(page, 'resistor-axial').getAttribute('data-hole-ids'),
  );
  const ledBindings = bindings(await component(page, 'led-5mm').getAttribute('data-hole-ids'));
  await connect(
    terminal(component(page, 'battery-holder-aa-2'), '+', labels.source),
    boardHole(page, groupMate(resistorBindings['lead-1'] as string)),
  );
  await connect(
    boardHole(page, groupMate(resistorBindings['lead-2'] as string)),
    boardHole(page, groupMate(ledBindings['anode'] as string)),
  );
  await connect(
    boardHole(page, groupMate(ledBindings['cathode'] as string)),
    terminal(component(page, 'battery-holder-aa-2'), '−', labels.source),
  );
  await expect(page.getByTestId('schematic-wire')).toHaveCount(3);
  await page.getByRole('button', { name: 'Сохранить сейчас' }).click();
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect(page.getByTestId('current-reading')).toContainText('мА');
  await screenshot(page, 'connected-running');

  await page.getByRole('button', { name: 'Создать версию' }).click();
  await expect(page.getByText('Последняя версия: №1')).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить сейчас' }).click();
  await page.reload();
  await expect(page.getByLabel('Название проекта')).toHaveValue(
    'Electronics production integration',
  );
  await expect(component(page, 'breadboard-medium')).toBeVisible();
  await expect(component(page, 'resistor-axial')).toHaveAttribute('data-hole-bindings', '2');
  await expect(component(page, 'button-tactile-6mm')).toHaveAttribute('data-hole-bindings', '4');
  await expect(component(page, 'rgb-led').getByTestId('rgb-led-mixture')).toBeVisible();
  await expect(component(page, 'seven-segment-display')).toHaveCount(4);
  await expect(page.getByTestId('schematic-wire')).toHaveCount(3);
  await expect(page.getByText('Последняя версия: №1')).toBeVisible();
  await screenshot(page, 'reload-checkpoint');

  expect(failures.counts).toMatchObject({
    consoleErrors: 0,
    pageErrors: 0,
    failedRequests: 0,
    httpServerErrors: 0,
  });
  failures.assertEmpty();
});
