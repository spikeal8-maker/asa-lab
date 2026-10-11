import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fixture, classId } from './fixtures/classroom-owner';

const evidence = 'e2e/artifacts/owner-preview/classroom-usability';
const sections = [
  'Ученики',
  'Обучение',
  'Журнал',
  'Проекты',
  'История',
  'Преподаватели',
  'Заявки',
  'Настройки',
];
const widths = [320, 390, 768, 1024, 1100, 1180, 1280, 1366, 1440, 1600, 1920];
const names = [
  'Александра Иванова',
  'Константин Соколов',
  'Мария Александрова',
  'Даниил Кузнецов',
  'Елизавета Петрова',
];
async function openSection(page: Page, name: string) {
  const select = page.getByLabel('Раздел класса', { exact: true });
  if (await select.isVisible()) await select.selectOption({ label: name });
  else
    await page
      .locator('.classroom-workspace-tabs')
      .getByRole('button', { name, exact: true })
      .click();
}
async function geometry(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const intersects = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const issues: string[] = [];
    for (const row of document.querySelectorAll(
      '.classroom-roster-head,.classroom-roster-row,.classroom-list-head,.classroom-list-row',
    )) {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      const glyphs: Array<{ text: string; rect: DOMRect }> = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.textContent?.trim()) continue;
        const element = node.parentElement!;
        if (!element.checkVisibility() || element.closest('.sr-only,.dropdown-menu')) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects())
          if (rect.width && rect.height) glyphs.push({ text: node.textContent.trim(), rect });
      }
      glyphs.forEach((a, i) =>
        glyphs.slice(i + 1).forEach((b) => {
          if (intersects(a.rect, b.rect)) issues.push(`${a.text} overlaps ${b.text}`);
        }),
      );
    }
    const rows = [...document.querySelectorAll<HTMLElement>('.classroom-roster-row')];
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      issues,
      nameFonts: rows.map((row) =>
        parseFloat(getComputedStyle(row.querySelector('strong')!).fontSize),
      ),
      rowHeights: rows.map((row) => row.getBoundingClientRect().height),
      table: getComputedStyle(document.querySelector('.classroom-roster-head')!).display !== 'none',
      codeTargets: rows.map(
        (row) => row.querySelector('.classroom-login-handle')?.getBoundingClientRect().height ?? 44,
      ),
    };
  });
}
test.beforeAll(() => mkdirSync(evidence, { recursive: true }));
for (const width of widths)
  for (const sidebar of ['expanded', 'collapsed'] as const)
    for (const zoom of [1, 1.25, 1.5]) {
      test(`23 classes / 15 pupils: ${width}, ${sidebar}, effective zoom ${zoom}`, async ({
        page,
      }) => {
        // Effective CSS viewport, not deviceScaleFactor: layout receives the same
        // available CSS width as browser zoom with an open/collapsed sidebar.
        await page.setViewportSize({
          width: Math.round(width / zoom),
          height: Math.round(1000 / zoom),
        });
        const state = await fixture(page, 15, { classes: 23, sidebar });
        state.students().forEach((row, index) => {
          row.displayLabel =
            names[index % names.length]! + (index === 14 ? ' — исследователь проекта' : '');
          row.assignedCount = 8 + (index % 4);
          row.submittedCount = index % 7;
          row.awaitingReview = index % 3;
          row.lastActiveAt = index % 2 ? ('2026-10-11T09:30:00Z' as never) : null;
        });
        await page.goto('/#/classrooms');
        await expect(page.getByTestId('classroom-card')).toHaveCount(23);
        await expect(page.locator('.classroom-row-works').first()).toHaveText('7');
        await expect(page.locator('.classroom-row-works').nth(1)).toHaveText('10');
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        await page.goto(`/#/classrooms/${classId}`);
        await expect(page.locator('.classroom-roster-row')).toHaveCount(15);
        await expect(
          page.locator('.classroom-roster-row .classroom-login-handle').first(),
        ).toHaveText('******');
        const result = await geometry(page);
        expect(result.overflow).toBe(false);
        expect(result.issues).toEqual([]);
        expect(result.nameFonts.every((size) => size >= 16)).toBe(true);
        if (result.table)
          expect(result.rowHeights.slice(0, 14).every((size) => size <= 40)).toBe(true);
        else {
          expect(
            result.rowHeights
              .slice(0, 14)
              .every((size) => size <= (Math.round(width / zoom) < 300 ? 164 : 110)),
          ).toBe(true);
          expect(result.codeTargets.every((height) => height >= 44)).toBe(true);
        }
        // Open the last row menu and verify its actual bounds, including at zoom.
        await page.locator('.classroom-roster-row .classroom-row-menu summary').last().click();
        const bounds = await page
          .locator('.classroom-roster-row .classroom-row-menu[open] .dropdown-menu')
          .boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(Math.round(width / zoom) + 1);
        await page.keyboard.press('Escape');
        for (const section of sections) {
          await openSection(page, section);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            section,
          ).toBe(true);
          if (width === 1366 || width === 390) {
            await page.screenshot({
              path: `${evidence}/${width}-${sidebar}-zoom${zoom}-${sections.indexOf(section) + 1}.png`,
              fullPage: true,
            });
          }
        }
        expect(state.errors).toEqual([]);
      });
    }

test('synthetic controls keep secrets out of the DOM and support header reveal, denial, double click and F2', async ({
  page,
}) => {
  await fixture(page, 15, { classes: 23 });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/#/classrooms/${classId}`);
  const row = page.locator('.classroom-roster-row').first();
  const code = row.locator('.classroom-login-handle');
  await expect(code).toHaveText('******');
  expect(await page.locator('body').innerHTML()).not.toContain('Aa0000');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    }),
  );
  await code.press('Enter');
  await expect(code).toHaveText('Aa0000');
  await expect(page.getByRole('alert')).toContainText('Выделите и скопируйте');
  await code.dblclick();
  await expect(page.locator('.student-code-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  const header = page
    .locator('.classroom-roster-head')
    .getByRole('button', { name: 'Код', exact: true });
  await header.click();
  await expect(header).toHaveAttribute('aria-pressed', 'true');
  await header.click();
  await expect(code).toHaveText('******');
  expect(await page.locator('body').innerHTML()).not.toContain('Aa0000');
  await code.press('F2');
  await expect(page.locator('.student-code-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
});
