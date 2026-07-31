import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

/** TST-E2E-ELECTRONICS-M1-001: one focused owner journey covers the active
 * catalog, editor operations, a parallel DC circuit, diagnostics, immutable
 * checkpoint creation and durable reload. */

const REVIEW_DIR = 'docs/review/TASK_ELECTRONICS_M1_001';

const labels = {
  source: 'Источник постоянного тока',
  resistor: 'Резистор',
  led: 'Светодиод',
  button: 'Кнопка',
  switch: 'Переключатель',
  potentiometer: 'Потенциометр',
  diode: 'Диод',
  lamp: 'Лампа',
} as const;

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

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${REVIEW_DIR}/${name}.png`, fullPage: true });
}

async function addComponent(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click();
}

function component(page: Page, kind: keyof typeof labels, index = 0): Locator {
  return page.locator(`[data-testid="schematic-component"][data-kind="${kind}"]`).nth(index);
}

function terminal(
  page: Page,
  kind: keyof typeof labels,
  index: number,
  terminalLabel: string,
): Locator {
  return component(page, kind, index).getByRole('button', {
    name: `${labels[kind]}: вывод ${terminalLabel}`,
    exact: true,
  });
}

async function connect(first: Locator, second: Locator): Promise<void> {
  await first.click();
  await second.click();
}

test.beforeAll(async () => {
  mkdirSync(REVIEW_DIR, { recursive: true });
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e-electronics-m1');
});

test.afterAll(async () => {
  await admin.end();
});

test('teacher builds, runs, diagnoses and reloads an Electronics M1 circuit', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await login(page);
  await createPersonalProject(page, 'Electronics M1 — owner checkpoint');

  await expect(page.getByText('Рабочее поле пустое')).toBeVisible();
  await screenshot(page, 'empty');

  for (const label of Object.values(labels)) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    await addComponent(page, label);
  }
  await addComponent(page, labels.resistor);
  await addComponent(page, labels.resistor);
  await expect(page.locator('[data-testid="schematic-component"]')).toHaveCount(10);
  await expect(component(page, 'potentiometer').getByRole('button')).toHaveCount(4);

  const resistors = page.locator('[data-testid="schematic-component"][data-kind="resistor"]');
  await resistors.nth(0).locator('.workbench-part').click();
  await resistors
    .nth(1)
    .locator('.workbench-part')
    .click({ modifiers: ['Shift'] });
  await expect(page.getByText('Выбрано: 2')).toBeVisible();
  const firstTransform = await resistors
    .nth(0)
    .locator('.workbench-part')
    .getAttribute('transform');
  const secondTransform = await resistors
    .nth(1)
    .locator('.workbench-part')
    .getAttribute('transform');
  await page.getByRole('button', { name: 'Повернуть компонент (R)' }).click();
  await expect(resistors.nth(0).locator('.workbench-part')).not.toHaveAttribute(
    'transform',
    firstTransform ?? '',
  );
  await expect(resistors.nth(1).locator('.workbench-part')).not.toHaveAttribute(
    'transform',
    secondTransform ?? '',
  );
  await page.getByRole('button', { name: 'Дублировать', exact: true }).click();
  await expect(page.locator('[data-testid="schematic-component"]')).toHaveCount(12);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.locator('[data-testid="schematic-component"]')).toHaveCount(10);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('[data-testid="schematic-component"]')).toHaveCount(12);
  await page.getByRole('toolbar').getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.locator('[data-testid="schematic-component"]')).toHaveCount(10);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.locator('[data-testid="schematic-component"]')).toHaveCount(12);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('[data-testid="schematic-component"]')).toHaveCount(10);

  await component(page, 'switch').locator('.workbench-part').click();
  await page.getByLabel('Контакт замкнут').check();
  await component(page, 'button').locator('.workbench-part').click();
  await page.getByLabel('Кнопка нажата').check();
  await component(page, 'potentiometer').locator('.workbench-part').click();
  await page.getByRole('slider').fill('0.5');
  await screenshot(page, 'components');

  await connect(terminal(page, 'source', 0, '+'), terminal(page, 'switch', 0, '1'));
  await page.getByLabel('Цвет провода').selectOption('#2c62c9');
  await page.getByRole('button', { name: 'Изменить изгиб провода' }).click();
  await expect(page.locator('.workbench-wire-vertex')).toHaveCount(2);
  await page.getByRole('button', { name: 'Переподключить конец' }).click();
  await terminal(page, 'switch', 0, '2').click();
  await page.getByRole('button', { name: 'Переподключить конец' }).click();
  await terminal(page, 'switch', 0, '1').click();

  // Source -> switch -> resistor -> LED -> source return.
  await connect(terminal(page, 'switch', 0, '2'), terminal(page, 'resistor', 0, '1'));
  await connect(terminal(page, 'resistor', 0, '2'), terminal(page, 'led', 0, 'A'));
  await connect(terminal(page, 'led', 0, 'K'), terminal(page, 'source', 0, '−'));

  // Two additional parallel resistive branches, one with the lamp load.
  await connect(terminal(page, 'switch', 0, '2'), terminal(page, 'resistor', 1, '1'));
  await connect(terminal(page, 'resistor', 1, '2'), terminal(page, 'lamp', 0, '1'));
  await connect(terminal(page, 'lamp', 0, '2'), terminal(page, 'source', 0, '−'));
  await connect(terminal(page, 'switch', 0, '2'), terminal(page, 'resistor', 2, '1'));

  // The potentiometer is a real three-terminal branch.
  await connect(terminal(page, 'switch', 0, '2'), terminal(page, 'potentiometer', 0, '1'));
  await connect(terminal(page, 'potentiometer', 0, '2'), terminal(page, 'source', 0, '−'));
  await connect(terminal(page, 'potentiometer', 0, 'W'), terminal(page, 'source', 0, '−'));

  // Resistor, diode and normally-open button form another controlled branch.
  await connect(terminal(page, 'resistor', 2, '2'), terminal(page, 'diode', 0, 'A'));
  await connect(terminal(page, 'diode', 0, 'K'), terminal(page, 'button', 0, '1'));
  await connect(terminal(page, 'button', 0, '2'), terminal(page, 'source', 0, '−'));

  await expect(page.getByTestId('schematic-wire')).toHaveCount(14);
  await page.getByRole('button', { name: 'Сохранить сейчас' }).click();
  await expect(page.getByText('Все изменения сохранены', { exact: true })).toBeVisible();
  await screenshot(page, 'wired');

  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect(page.locator('.workbench-stage-status')).toContainText('Моделирование запущено');
  await expect(page.getByTestId('current-reading')).toContainText('мА');
  await expect(page.getByTestId('current-reading')).not.toHaveText('0.0 мА');
  await expect(page.locator('image[href$="led-red-lit.svg"]')).toBeVisible();
  await expect(page.locator('image[href$="lamp-on.svg"]')).toBeVisible();
  await expect(page.getByTestId('diagnostics')).toContainText('DC-расчёт завершён');

  await component(page, 'led').locator('.workbench-part').click();
  await expect(page.getByText('Падение', { exact: true })).toBeVisible();
  await expect(page.getByText('Горит', { exact: true })).toBeVisible();
  await expect(page.locator('.workbench-measurements')).toContainText('мА');
  await screenshot(page, 'running');

  // A real switch opens and restores all parallel branches.
  await component(page, 'switch').locator('.workbench-part').click();
  await page.getByLabel('Контакт замкнут').uncheck();
  await expect(page.getByTestId('current-reading')).toHaveText('0.0 мА');
  await expect(page.getByTestId('diagnostics')).toContainText('цепь разомкнута');
  await page.getByLabel('Контакт замкнут').check();
  await expect(page.getByTestId('current-reading')).not.toHaveText('0.0 мА');

  await page.getByRole('button', { name: 'Создать версию' }).click();
  await expect(page.getByText('Последняя версия: №1')).toBeVisible();

  // A direct source wire produces an anchored, actionable short-circuit error.
  await connect(terminal(page, 'source', 0, '+'), terminal(page, 'source', 0, '−'));
  await expect(page.getByTestId('diagnostics')).toContainText(/коротк/i);
  await expect(component(page, 'source')).toHaveAttribute('data-diagnostics', /short_circuit/);
  await screenshot(page, 'diagnostic');

  await page.getByRole('toolbar').getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByTestId('schematic-wire')).toHaveCount(14);
  await page.getByRole('button', { name: 'Сохранить сейчас' }).click();
  await expect(page.getByText('Все изменения сохранены', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Название проекта')).toHaveValue(
    'Electronics M1 — owner checkpoint',
  );
  await expect(page.locator('[data-testid="schematic-component"]')).toHaveCount(10);
  await expect(page.getByTestId('schematic-wire')).toHaveCount(14);
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toBeVisible();
  await expect(page.getByTestId('current-reading')).toContainText('мА');
  await expect(page.getByText('Последняя версия: №1')).toBeVisible();
  await screenshot(page, 'reload');

  expect(failures.counts).toMatchObject({
    consoleErrors: 0,
    pageErrors: 0,
    failedRequests: 0,
    httpServerErrors: 0,
  });
  failures.assertEmpty();
});

test('classes remain a separate teacher workspace from personal projects', async ({ page }) => {
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await login(page);
  await page.getByRole('button', { name: 'Классы', exact: true }).click();
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
