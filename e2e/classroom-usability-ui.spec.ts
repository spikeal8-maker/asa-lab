import { classroomTextDefects } from './classroom-readable-text';
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
    const visibleText = (element: HTMLElement) =>
      element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
      !element.closest('.sr-only,.dropdown-menu');
    const styleEvidence = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return {
        selector: element.className || element.tagName,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        visible: visibleText(element),
      };
    };
    const issues: string[] = [];
    for (const row of document.querySelectorAll(
      '.classroom-roster-head,.classroom-roster-row,.classroom-list-head,.classroom-list-row',
    )) {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      const glyphs: Array<{ text: string; rect: DOMRect; element: HTMLElement }> = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.textContent?.trim()) continue;
        const element = node.parentElement!;
        if (!visibleText(element)) continue;
        const range = document.createRange();
        // Measure rendered words, excluding collapsed JSX whitespace and the
        // empty portion of a wrapped line. Hidden desktop/mobile copies never
        // enter the comparison; text in different cells still must not collide.
        for (const word of node.textContent.matchAll(/\S+/gu)) {
          range.setStart(node, word.index!);
          range.setEnd(node, word.index! + word[0].length);
          for (const rect of range.getClientRects())
            if (rect.width && rect.height) glyphs.push({ text: word[0], rect, element });
        }
      }
      glyphs.forEach((a, i) =>
        glyphs.slice(i + 1).forEach((b) => {
          if (intersects(a.rect, b.rect))
            issues.push(
              JSON.stringify({
                a: { text: a.text, rect: a.rect.toJSON(), style: styleEvidence(a.element) },
                b: { text: b.text, rect: b.rect.toJSON(), style: styleEvidence(b.element) },
              }),
            );
        }),
      );
    }
    const rows = [...document.querySelectorAll<HTMLElement>('.classroom-roster-row')];
    const visibility = [
      ...document.querySelectorAll<HTMLElement>('.classroom-roster-head .sr-only'),
      ...rows[0]!.querySelectorAll<HTMLElement>('.classroom-seen-mobile,.classroom-roster-seen'),
    ].map(styleEvidence);
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      viewport: {
        width: innerWidth,
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      },
      header: [...document.querySelectorAll<HTMLElement>('.portal-header,.portal-header > *')].map(
        (el) => ({
          selector: el.className,
          width: el.getBoundingClientRect().width,
          x: el.getBoundingClientRect().x,
          columns: getComputedStyle(el).gridTemplateColumns,
          area: getComputedStyle(el).gridArea,
          display: getComputedStyle(el).display,
          minWidth: getComputedStyle(el).minWidth,
        }),
      ),
      overflowElements: [...document.querySelectorAll<HTMLElement>('body *')]
        .filter(
          (element) =>
            visibleText(element) && element.getBoundingClientRect().right > innerWidth + 1,
        )
        .slice(0, 16)
        .map((element) => ({
          selector: element.className || element.tagName,
          rect: element.getBoundingClientRect().toJSON(),
          scrollWidth: element.scrollWidth,
          columns: getComputedStyle(element).gridTemplateColumns,
          rows: getComputedStyle(element).gridTemplateRows,
          minWidth: getComputedStyle(element).minWidth,
        })),
      issues,
      visibility,
      nameFonts: rows.map((row) =>
        parseFloat(getComputedStyle(row.querySelector('strong')!).fontSize),
      ),
      rowHeights: rows.map((row) => row.getBoundingClientRect().height),
      density: [...rows[0]!.querySelectorAll<HTMLElement>('*')].filter(visibleText).map((el) => ({
        selector: el.className || el.tagName,
        height: el.getBoundingClientRect().height,
        minHeight: getComputedStyle(el).minHeight,
        padding: getComputedStyle(el).padding,
        position: getComputedStyle(el).gridArea,
        line: getComputedStyle(el).lineHeight,
      })),
      regularRowHeights: rows
        .filter(
          (row) => !row.querySelector('strong')!.textContent!.includes('— исследователь проекта'),
        )
        .map((row) => row.getBoundingClientRect().height),
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
      }, testInfo) => {
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
        expect(
          await classroomTextDefects(page),
          'Numbers and actual captions must not overlap at this zoom',
        ).toEqual([]);
        await expect(
          page.locator('.classroom-row-works .classroom-stat-number').first(),
        ).toHaveText('7');
        await expect(page.locator('.classroom-row-works .classroom-stat-number').nth(1)).toHaveText(
          '10',
        );
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        await page.goto(`/#/classrooms/${classId}`);
        await expect(page.locator('.classroom-roster-row')).toHaveCount(15);
        await expect(
          page.locator('.classroom-roster-row .classroom-login-handle').first(),
        ).toHaveText('******');
        const result = await geometry(page);
        if (width === 320 && sidebar === 'expanded' && zoom === 1.25)
          await page.screenshot({ path: evidence + '/narrow-roster-diagnostic.png' });
        await testInfo.attach('roster-geometry', {
          body: JSON.stringify(result, null, 2),
          contentType: 'application/json',
        });
        expect(
          result.overflow,
          JSON.stringify({
            viewport: result.viewport,
            header: result.header,
            elements: result.overflowElements,
          }),
        ).toBe(false);
        expect(result.issues).toEqual([]);
        expect(result.visibility.find((item) => item.selector === 'sr-only')?.visible).toBe(false);
        expect(
          result.visibility.find((item) => item.selector === 'classroom-seen-mobile')?.visible,
        ).toBe(!result.table);
        expect(
          result.visibility.find((item) => item.selector === 'classroom-roster-seen')?.visible,
        ).toBe(result.table);
        expect(result.nameFonts.every((size) => size >= 16)).toBe(true);
        // Sorting moves the intentionally long name into the middle of the
        // roster. Keep the density bound on all fourteen ordinary names.
        expect(result.regularRowHeights).toHaveLength(14);
        if (result.table)
          expect(
            result.regularRowHeights.every((size) => size <= 40),
            JSON.stringify(result.density),
          ).toBe(true);
        else {
          expect(
            result.regularRowHeights.every(
              (size) => size <= (Math.round(width / zoom) < 300 ? 164 : 110),
            ),
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
          const sectionBounds = await page.evaluate(() => ({
            fits: document.documentElement.scrollWidth <= innerWidth + 1,
            elements: [...document.querySelectorAll<HTMLElement>('body *')]
              .filter(
                (el) =>
                  el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
                  !el.closest('.sr-only,.dropdown-menu') &&
                  el.getBoundingClientRect().right > innerWidth + 1,
              )
              .slice(0, 12)
              .map((el) => ({
                selector: el.className || el.tagName,
                text: el.textContent?.slice(0, 40),
                rect: el.getBoundingClientRect().toJSON(),
                minWidth: getComputedStyle(el).minWidth,
              })),
          }));
          expect(sectionBounds.fits, section + JSON.stringify(sectionBounds.elements)).toBe(true);
          if (section === 'Журнал') {
            const overlaps = await page.locator('.manual-journal-filters').evaluate((toolbar) => {
              const controls = [
                ...toolbar.querySelectorAll<HTMLElement>('button,input,select'),
              ].filter((el) =>
                el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }),
              );
              const found: string[] = [];
              for (let i = 0; i < controls.length; i++)
                for (let j = i + 1; j < controls.length; j++) {
                  const a = controls[i]!.getBoundingClientRect(),
                    b = controls[j]!.getBoundingClientRect();
                  if (
                    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
                  )
                    found.push(
                      String(controls[i]!.getAttribute('aria-label') || controls[i]!.textContent) +
                        ' / ' +
                        String(controls[j]!.getAttribute('aria-label') || controls[j]!.textContent),
                    );
                }
              return found;
            });
            expect(overlaps, 'Journal controls must not cover each other').toEqual([]);
          }
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
