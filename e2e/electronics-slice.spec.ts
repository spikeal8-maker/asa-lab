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
  from: { kind: string; terminal: 'A' | 'B' },
  to: { kind: string; terminal: 'A' | 'B' },
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
    page.getByText('Схема пустая. Добавьте источник, резистор и светодиод.'),
  ).toBeVisible();

  // Источник, резистор, LED и провод
  for (const element of ['Источник', 'Резистор', 'Светодиод', 'Провод']) {
    await page.getByRole('button', { name: element, exact: true }).click();
  }
  await expect(page.getByTestId('schematic-component')).toHaveCount(4);

  // Последовательная цепь: источник → резистор → светодиод → провод → источник
  await connect(page, { kind: 'Источник', terminal: 'A' }, { kind: 'Резистор', terminal: 'A' });
  await connect(page, { kind: 'Резистор', terminal: 'B' }, { kind: 'Светодиод', terminal: 'A' });
  await connect(page, { kind: 'Светодиод', terminal: 'B' }, { kind: 'Провод', terminal: 'A' });
  await connect(page, { kind: 'Провод', terminal: 'B' }, { kind: 'Источник', terminal: 'B' });

  // Ток, состояние LED и понятная диагностика
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByTestId('current-reading')).toContainText('10.0 мА');
  await expect(page.getByTestId('led-state')).toContainText('Светодиод горит');
  await expect(page.getByTestId('diagnostics')).toContainText('Цепь замкнута');

  mkdirSync('e2e/artifacts', { recursive: true });
  await page.screenshot({ path: 'e2e/artifacts/electronics-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'e2e/artifacts/electronics-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });

  // Reload сохраняет схему и результат
  await page.reload();
  await expect(page.getByTestId('schematic-component')).toHaveCount(4);
  await expect(page.getByTestId('current-reading')).toContainText('10.0 мА');
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
  await connect(page, { kind: 'Источник', terminal: 'A' }, { kind: 'Светодиод', terminal: 'A' });
  await connect(page, { kind: 'Светодиод', terminal: 'B' }, { kind: 'Источник', terminal: 'B' });
  await page.getByRole('button', { name: 'Сохранить' }).click();

  await expect(page.getByTestId('diagnostics')).toContainText('токоограничивающего резистора');
});
