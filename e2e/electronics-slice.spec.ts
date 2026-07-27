import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

/** TST-E2E-ELECTRONICS-SLICE-001: the owner-facing path —
 * Классы → Проекты → создать проект → редактор → источник, резистор, LED и
 * провод → последовательная цепь → ток и состояние LED → сохранить →
 * reload сохраняет схему → immutable checkpoint. */

let admin: pg.Pool;
let teacher: SeededTeacher;

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e-elec');
});

test.afterAll(async () => {
  await admin.end();
});

async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Код организации').fill(teacher.workspace);
  await page.getByLabel('Email педагога').fill(teacher.email);
  await page.getByLabel('Пароль').fill(teacher.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
}

/** Connect two terminals by clicking them in sequence. */
async function connect(
  page: Page,
  from: { kind: string; terminal: string },
  to: { kind: string; terminal: string },
): Promise<void> {
  await page.getByRole('button', { name: `${from.kind}: вывод ${from.terminal}` }).click();
  await page.getByRole('button', { name: `${to.kind}: вывод ${to.terminal}` }).click();
}

test('teacher builds a series circuit, sees the result and keeps it after reload', async ({
  page,
}) => {
  await login(page);

  // Классы → Проекты
  await page.getByRole('button', { name: 'Создать класс' }).click();
  await page.getByLabel('Название класса').fill('8А Электроника');
  await page.getByRole('dialog').getByRole('button', { name: 'Создать' }).click();
  await expect(
    page.getByTestId('classroom-card').filter({ hasText: '8А Электроника' }),
  ).toBeVisible();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: '8А Электроника' })
    .getByRole('button', { name: 'Проекты' })
    .click();
  await expect(page.getByRole('heading', { name: /Проекты/ })).toBeVisible();
  await expect(page.getByText('Проектов пока нет.')).toBeVisible();

  // Создать проект → «Электроника» → редактор
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await page.getByLabel('Название проекта').fill('Первая схема');
  await expect(page.getByLabel('Электроника')).toBeChecked();
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Первая схема' })).toBeVisible();
  await expect(
    page.getByText('Поле пустое. Добавьте источник, резистор и светодиод.'),
  ).toBeVisible();

  // Этап A: авторские SVG источника, резистора и светодиода на рабочем поле
  for (const element of ['Источник', 'Резистор', 'Светодиод']) {
    await page.getByRole('button', { name: element, exact: true }).click();
  }
  await expect(page.getByTestId('schematic-component')).toHaveCount(3);
  const svgHrefs = await page
    .getByTestId('schematic-component')
    .locator('image')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
  expect(svgHrefs.sort()).toEqual([
    '/assets/electronics/components/led.svg',
    '/assets/electronics/components/power-source.svg',
    '/assets/electronics/components/resistor.svg',
  ]);

  // Этап B: элемент перетаскивается указателем, координаты меняются
  const led = page
    .getByTestId('schematic-component')
    .filter({ has: page.locator('[data-kind="led"]') });
  const ledNode = page.locator('[data-kind="led"]');
  const before = {
    x: await ledNode.getAttribute('data-x'),
    y: await ledNode.getAttribute('data-y'),
  };
  const ledImage = ledNode.locator('image');
  const box = await ledImage.boundingBox();
  if (!box) throw new Error('LED image has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  const after = {
    x: await ledNode.getAttribute('data-x'),
    y: await ledNode.getAttribute('data-y'),
  };
  expect(after).not.toEqual(before);
  void led;

  // Этап C: последовательная цепь настоящими SVG-проводами
  await connect(page, { kind: 'Источник', terminal: '+' }, { kind: 'Резистор', terminal: 'A' });
  await connect(page, { kind: 'Резистор', terminal: 'B' }, { kind: 'Светодиод', terminal: 'A' });
  await connect(page, { kind: 'Светодиод', terminal: 'K' }, { kind: 'Источник', terminal: '−' });
  await expect(page.getByTestId('schematic-wire')).toHaveCount(3);

  // Ток, состояние LED и понятная диагностика
  // Этап D: ток, состояние LED и понятная диагностика
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByTestId('current-reading')).toContainText('3.3 мА');
  await expect(page.getByTestId('led-state')).toContainText('Светодиод горит');
  await expect(page.getByTestId('diagnostics')).toContainText('Цепь замкнута');
  await expect(page.getByTestId('led-glow')).toBeVisible();

  mkdirSync('e2e/artifacts', { recursive: true });
  await page.screenshot({ path: 'e2e/artifacts/electronics-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'e2e/artifacts/electronics-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });

  // Reload сохраняет схему, позиции и результат
  await page.reload();
  await expect(page.getByTestId('schematic-component')).toHaveCount(3);
  await expect(page.getByTestId('schematic-wire')).toHaveCount(3);
  await expect(page.locator('[data-kind="led"]')).toHaveAttribute('data-x', after.x as string);
  await expect(page.locator('[data-kind="led"]')).toHaveAttribute('data-y', after.y as string);
  await expect(page.getByTestId('current-reading')).toContainText('3.3 мА');
  await expect(page.getByTestId('led-state')).toContainText('Светодиод горит');

  // Immutable checkpoint
  await page.getByRole('button', { name: 'Создать версию' }).click();
  await expect(page.getByTestId('version-list')).toContainText('Версия №1');
  await expect(page.getByRole('status')).toContainText('больше нельзя изменить');
});

test('the editor explains a broken circuit in plain language', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Создать класс' }).click();
  await page.getByLabel('Название класса').fill('Диагностика');
  await page.getByRole('dialog').getByRole('button', { name: 'Создать' }).click();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: 'Диагностика' })
    .getByRole('button', { name: 'Проекты' })
    .click();
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await page.getByLabel('Название проекта').fill('Разрыв');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Разрыв' })).toBeVisible();

  // An LED wired straight across the source: no current limiting resistor.
  await page.getByRole('button', { name: 'Источник', exact: true }).click();
  await page.getByRole('button', { name: 'Светодиод', exact: true }).click();
  await connect(page, { kind: 'Источник', terminal: '+' }, { kind: 'Светодиод', terminal: 'A' });
  await connect(page, { kind: 'Светодиод', terminal: 'K' }, { kind: 'Источник', terminal: '−' });
  await page.getByRole('button', { name: 'Сохранить' }).click();

  await expect(page.getByTestId('diagnostics')).toContainText('токоограничивающего резистора');
});
