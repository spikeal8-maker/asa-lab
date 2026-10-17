import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fixture } from './fixtures/classroom-owner';

test.use({ locale: 'ru-RU', timezoneId: 'Europe/Moscow' });

test('teacher text grows progressively on 4K but Full HD keeps its approved density', async ({
  page,
}) => {
  const state = await fixture(page, 15, { classes: 23, sidebar: 'expanded' });
  await page.goto('/#/classrooms');
  await expect(page.locator('.classroom-list-row')).toHaveCount(23);

  const observed: Array<{
    viewport: number;
    mainWidth: number;
    name: number;
    number: number;
    heading: number;
    columnHeading: number;
    rowHeight: number;
    overflow: boolean;
  }> = [];

  for (const width of [1920, 2560, 3840]) {
    await page.setViewportSize({ width, height: 1080 });
    const sample = await page.evaluate(() => {
      const css = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector);
        if (!node) throw Error('Missing element: ' + selector);
        return parseFloat(getComputedStyle(node).fontSize);
      };
      const main = document.querySelector<HTMLElement>('main.classroom-owner-list')!;
      const row = document.querySelector<HTMLElement>('.classroom-list-row')!;
      return {
        viewport: innerWidth,
        mainWidth: Math.round(main.getBoundingClientRect().width),
        name: css('.classroom-row-title'),
        number: css('.classroom-row-students .classroom-stat-number'),
        heading: css('.classroom-title-row h1'),
        columnHeading: css('.classroom-column-sort'),
        rowHeight: row.getBoundingClientRect().height,
        overflow:
          document.documentElement.scrollWidth > innerWidth + 1 ||
          main.scrollWidth > main.clientWidth + 1,
      };
    });
    observed.push(sample);
    expect(sample.overflow, 'No page or content overflow at ' + width).toBe(false);
  }

  const [fullHd, large, ultraHd] = observed;
  expect(fullHd.name).toBe(16);
  expect(fullHd.number).toBe(13);
  expect(fullHd.heading).toBe(28);
  expect(fullHd.mainWidth).toBe(1180);
  expect(large.name).toBeGreaterThan(fullHd.name);
  expect(large.number).toBeGreaterThan(fullHd.number);
  expect(large.mainWidth).toBeGreaterThan(fullHd.mainWidth);
  expect(ultraHd.name).toBeGreaterThanOrEqual(19.9);
  expect(ultraHd.number).toBeGreaterThanOrEqual(16.9);
  expect(ultraHd.columnHeading).toBeGreaterThanOrEqual(14.9);
  expect(ultraHd.heading).toBeGreaterThanOrEqual(33.9);
  expect(ultraHd.mainWidth).toBeGreaterThanOrEqual(1900);
  expect(ultraHd.rowHeight).toBeGreaterThan(fullHd.rowHeight);

  mkdirSync('e2e/artifacts/owner-preview/teacher-ultrawide', { recursive: true });
  await page.screenshot({
    path: 'e2e/artifacts/owner-preview/teacher-ultrawide/teacher-4k.png',
    fullPage: false,
  });
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

test('ultrawide scaling respects the CSS viewport after display zoom', async ({ page }) => {
  const state = await fixture(page, 15, { classes: 23, sidebar: 'expanded' });
  await page.goto('/#/classrooms');
  for (const width of [1097, 1920]) {
    await page.setViewportSize({ width, height: 950 });
    const computed = await page
      .locator('.classroom-row-students .classroom-stat-number')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize);
    expect(computed).toBe('13px');
  }
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});
