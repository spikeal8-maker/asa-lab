import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fixture } from './fixtures/classroom-owner';

const out = 'e2e/artifacts/owner-preview/portal-header-adaptive';
const widths = [
  320, 360, 390, 430, 540, 600, 601, 680, 768, 820, 900, 1023, 1024, 1097, 1250, 1440, 1920, 2560,
  3840,
] as const;

test.use({ locale: 'ru-RU', timezoneId: 'Europe/Moscow' });

test('shared portal header stays on one row with useful labels and 4K scaling', async ({
  page,
}) => {
  test.setTimeout(120_000);
  mkdirSync(out, { recursive: true });
  const state = await fixture(page, 15, { classes: 23, sidebar: 'expanded' });
  await page.goto('/#/classrooms');
  await expect(page.getByRole('navigation', { name: 'Разделы ASA Lab' })).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const result = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error('Missing header element: ' + selector);
        const rect = element.getBoundingClientRect();
        const computed = getComputedStyle(element);
        return {
          x: rect.left,
          right: rect.right,
          y: rect.top,
          h: rect.height,
          w: rect.width,
          display: computed.display,
          fontSize: parseFloat(computed.fontSize),
        };
      };
      const navItems = [
        ...document.querySelectorAll<HTMLElement>('.portal-header .portal-global-nav a'),
      ];
      return {
        width: innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        header: box('.portal-shell .portal-header'),
        brand: box('.portal-header .portal-brand'),
        create: box('.portal-header .portal-quick-create'),
        account: box('.portal-header .portal-account'),
        menu: box('.portal-header .portal-menu-toggle'),
        nav: box('.portal-header .portal-global-nav'),
        navLabels: navItems.map((item) => {
          const label = item.querySelector<HTMLElement>('span')!;
          return {
            text: label.textContent,
            width: label.getBoundingClientRect().width,
            clipped: getComputedStyle(label).clipPath === 'inset(50%)',
            accessible: item.getAttribute('aria-label'),
            box: item.getBoundingClientRect().toJSON(),
            labelBox: label.getBoundingClientRect().toJSON(),
          };
        }),
        viewportScrollbar: getComputedStyle(document.documentElement).scrollbarWidth,
      };
    });
    const expectedHeight = width > 1920 ? Math.min(72, Math.max(56, 40 + width / 120)) : 56;
    expect(result.header.h, width + ': single-row header').toBeCloseTo(expectedHeight, 1);
    expect(result.pageWidth, width + ': no page horizontal overflow').toBeLessThanOrEqual(
      width + 1,
    );
    const items = [result.brand, result.nav, result.create, result.account];
    if (width <= 1023) items.push(result.menu);
    for (const item of items) {
      expect(item.y, width + ': child top').toBeGreaterThanOrEqual(-1);
      expect(item.y + item.h, width + ': child bottom').toBeLessThanOrEqual(result.header.h + 1);
      expect(item.x, width + ': child left').toBeGreaterThanOrEqual(-1);
      expect(item.right, width + ': child right').toBeLessThanOrEqual(width + 1);
    }
    // No visual overlaps: testing outer grid cells alone missed the case where
    // 44px icon hitboxes contained full labels wider than the cell at 768px.
    expect(result.brand.right, width + ': brand vs nav').toBeLessThanOrEqual(result.nav.x - 1);
    expect(result.nav.right, width + ': nav vs create').toBeLessThanOrEqual(result.create.x - 1);
    expect(result.create.right, width + ': create vs avatar').toBeLessThanOrEqual(
      result.account.x - 1,
    );
    for (let index = 0; index < result.navLabels.length; index++) {
      const link = result.navLabels[index]!;
      expect(link.box.left, width + ': nav link left').toBeGreaterThanOrEqual(result.nav.x - 1);
      expect(link.box.right, width + ': nav link right').toBeLessThanOrEqual(result.nav.right + 1);
      if (width >= 601) {
        expect(link.labelBox.left, width + ': text left').toBeGreaterThanOrEqual(link.box.left - 1);
        expect(link.labelBox.right, width + ': text right').toBeLessThanOrEqual(link.box.right + 1);
      }
      if (index > 0) {
        expect(
          result.navLabels[index - 1]!.box.right,
          width + ': links overlap',
        ).toBeLessThanOrEqual(link.box.left);
      }
    }
    expect(result.navLabels.map((x) => x.accessible)).toEqual(['Проекты', 'Знания']);
    if (width >= 601) {
      expect(
        result.navLabels.every((item) => item.width > 35 && !item.clipped),
        width + ': visible text',
      ).toBe(true);
    } else {
      expect(
        result.navLabels.every((item) => item.clipped),
        width + ': accessible icons',
      ).toBe(true);
    }
    expect(result.menu.display === 'none', width + ': drawer trigger').toBe(width > 1023);
    expect(result.viewportScrollbar, width + ': decorative page scrollbar hidden').toBe('none');
    if ([320, 390, 540, 768, 900, 1023, 1024, 1097, 1440, 1920, 2560, 3840].includes(width)) {
      await page.screenshot({ path: out + '/portal-header-' + width + '.png', fullPage: false });
    }
    if (width <= 560) {
      await expect(page.locator('.portal-header-create > span:first-child')).toBeVisible();
      await expect(page.locator('.portal-header-create-label')).toBeHidden();
    }
    if ([320, 390, 560].includes(width)) {
      await page.locator('.portal-quick-create > summary').click();
      const popup = page.locator('.portal-header .portal-create-options');
      await expect(popup).toBeVisible();
      const bounding = await popup.boundingBox();
      expect(bounding).not.toBeNull();
      expect(bounding!.x, width + ': create popup left').toBeGreaterThanOrEqual(-1);
      expect(bounding!.x + bounding!.width, width + ': create popup right').toBeLessThanOrEqual(
        width + 1,
      );
      await page.keyboard.press('Escape');
      await expect(popup).toBeHidden();
    }
    if (width === 1920) expect(result.navLabels[0]!.box.height).toBeGreaterThanOrEqual(40);
    if (width === 3840) expect(result.navLabels[0]!.box.height).toBeGreaterThanOrEqual(50);
  }
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

test('header remains pinned on scroll and on other portal routes', async ({ page }) => {
  test.setTimeout(100_000);
  const state = await fixture(page, 15, { classes: 23 });
  for (const route of ['/#/classrooms', '/#/gallery', '/#/knowledge']) {
    await page.setViewportSize({ width: 768, height: 650 });
    await page.goto(route);
    await expect(page.locator('.portal-header')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Проекты' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Знания' })).toBeVisible();
    await expect(page.locator('.portal-header')).toHaveCSS('height', '56px');
  }
  await page.setViewportSize({ width: 390, height: 650 });
  await page.goto('/#/classrooms');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await expect(page.locator('.portal-sidebar.mobile-open')).toBeVisible();
  await expect(page.locator('.portal-sidebar.mobile-open .portal-mobile-public')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.portal-sidebar.mobile-open')).toHaveCount(0);
  await page.setViewportSize({ width: 768, height: 650 });
  await page.goto('/#/classrooms');
  await page.locator('.classroom-list-row').first().waitFor();
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  const y = await page
    .locator('.portal-header')
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(y).toBe(0);
  expect(state.mutations).toEqual([]);
});
