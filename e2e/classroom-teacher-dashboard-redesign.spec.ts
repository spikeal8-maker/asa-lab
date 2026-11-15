import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fixture } from './fixtures/classroom-owner';

const out = 'e2e/artifacts/owner-preview/teacher-dashboard-redesign';
test.use({ locale: 'ru-RU', timezoneId: 'Europe/Moscow' });

test('sort by register headers uses actual class metrics both ways', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const state = await fixture(page, 15, { classes: 23, sidebar: 'expanded' });
  await page.goto('/#/classrooms');
  await expect(page.locator('.classroom-list-row')).toHaveCount(23);
  await expect(page.locator('.classroom-row-works .classroom-stat-number').first()).not.toHaveText(
    '—',
  );
  const students = page.getByRole('button', { name: 'Сортировать по колонке «Ученики»' });
  await students.click();
  let values = (
    await page.locator('.classroom-row-students .classroom-stat-number').allTextContents()
  ).map(Number);
  expect(values).toEqual([...values].sort((a, b) => b - a));
  await students.click();
  values = (
    await page.locator('.classroom-row-students .classroom-stat-number').allTextContents()
  ).map(Number);
  expect(values).toEqual([...values].sort((a, b) => a - b));
  await page.getByRole('button', { name: 'Сортировать по колонке «Работы»' }).click();
  values = (
    await page.locator('.classroom-row-works .classroom-stat-number').allTextContents()
  ).map(Number);
  expect(values).toEqual([...values].sort((a, b) => b - a));
  await page.getByRole('button', { name: 'Сортировать по колонке «Класс»' }).click();
  await expect(page.locator('.classroom-column-sort.active')).toHaveCount(1);
  await expect(page.locator('.classroom-row-index')).toHaveText(
    Array.from({ length: 23 }, (_, i) => String(i + 1) + '.'),
  );
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

test('class selection is an intentional mode and does not change class data', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const state = await fixture(page, 15, { classes: 23 });
  await page.goto('/#/classrooms');
  await expect(page.locator('.classroom-row-select input').first()).toBeHidden();
  await expect(page.locator('.classroom-select-all')).toBeHidden();
  await page.getByRole('button', { name: 'Действия с классами', exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать классы' }).click();
  await expect(page.locator('.classroom-row-select input').first()).toBeVisible();
  await expect(page.locator('.classroom-select-all input')).toBeVisible();
  await page.locator('.classroom-row-select input').first().check();
  await page.getByRole('button', { name: 'Действия с классами', exact: true }).click();
  await expect(page.getByText('Выбрано классов: 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Архивировать' })).toBeVisible();
  await page.getByRole('button', { name: 'Завершить выбор' }).click();
  await expect(page.locator('.classroom-row-select input').first()).toBeHidden();
  await expect(page.locator('.classroom-row-select input:checked')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Поиск класса по названию' }).fill('7А Робототехника');
  await expect(page.locator('.classroom-list-row')).toHaveCount(1);
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

for (const width of [320, 390, 540, 768, 1024, 1440]) {
  test('teacher list density at ' + width + 'px', async ({ page }) => {
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height: 950 });
    const state = await fixture(page, 15, { classes: 23, sidebar: 'expanded' });
    await page.goto('/#/classrooms');
    await expect(page.locator('.classroom-list-row')).toHaveCount(23);
    await expect(page.locator('.classroom-title-and-link')).toBeVisible();
    await expect(page.getByRole('button', { name: /Я учусь в классе/ })).toBeVisible();
    const geometry = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('main.classroom-owner-list')!;
      const title = document
        .querySelector<HTMLElement>('.classroom-title-row h1')!
        .getBoundingClientRect();
      const attend = document
        .querySelector<HTMLElement>('.classroom-attend-link')!
        .getBoundingClientRect();
      const row = document
        .querySelector<HTMLElement>('.classroom-list-row')!
        .getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        mainWidth: main.clientWidth,
        mainScrollWidth: main.scrollWidth,
        titleY: title.top,
        attendY: attend.top,
        firstRowHeight: row.height,
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(width + 1);
    expect(geometry.mainScrollWidth).toBeLessThanOrEqual(geometry.mainWidth + 1);
    expect(Math.abs(geometry.titleY - geometry.attendY)).toBeLessThanOrEqual(16);
    expect(geometry.firstRowHeight).toBeLessThanOrEqual(width >= 1024 ? 60 : 135);
    if (geometry.mainWidth >= 680) {
      await expect(
        page.getByRole('button', { name: 'Сортировать по колонке «Работы»' }),
      ).toBeVisible();
    } else {
      await expect(page.getByLabel('Порядок классов')).toBeVisible();
    }
    await expect(page.locator('.classroom-row-select input').first()).toBeHidden();
    await page.screenshot({ path: out + '/teacher-classes-' + width + '.png', fullPage: true });
    await page.getByRole('button', { name: 'Действия с классами', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Выбрать классы', exact: true })).toBeVisible();
    const menu = await page.locator('.classroom-bulk-menu .dropdown-menu').boundingBox();
    expect(menu).not.toBeNull();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width + 1,
    );
    await page.keyboard.press('Escape');
    expect(state.errors).toEqual([]);
    expect(state.mutations).toEqual([]);
  });
}
