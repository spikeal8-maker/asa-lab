import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';
import { loginWithOrganization } from './organization-login';
import { portalSection } from './portal-navigation';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

let admin: pg.Pool;
let teacher: SeededTeacher;

async function login(page: Page): Promise<void> {
  await loginWithOrganization(page, teacher);
  await portalSection(page, 'Классы').click();
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
}

/**
 * At a mobile width the section list becomes a horizontally scrolling strip and
 * the destination can sit outside its visible part. The mobile case here is
 * about layout overflow rather than about navigating, so it opens the section
 * by route; whether the control is reachable by pointer on a narrow screen is
 * worth its own test rather than being smuggled into this one.
 */
async function loginAndOpenClasses(page: Page): Promise<void> {
  await loginWithOrganization(page, teacher);
  await page.goto('/#/classrooms');
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
}

async function expectNoWcagViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations,
    results.violations
      .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`)
      .join('\n'),
  ).toEqual([]);
}

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'a11y');
});

test.afterAll(async () => {
  await admin.end();
});

test('login page passes automated WCAG A/AA checks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ASA Lab' })).toBeVisible();
  await expectNoWcagViolations(page);
});

test('dashboard and create dialog pass automated WCAG A/AA checks', async ({ page }) => {
  await login(page);
  await expectNoWcagViolations(page);

  await page.getByRole('button', { name: 'Создать класс' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Создать класс' })).toBeVisible();
  await expectNoWcagViolations(page);
});

test('skip link moves keyboard focus to the dashboard content', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Перейти к содержанию' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main-content')).toBeFocused();
});

test('dialog supports initial focus, focus trap, Escape and focus restoration', async ({
  page,
}) => {
  await login(page);

  const trigger = page.getByRole('button', { name: 'Создать класс' }).first();
  await trigger.focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Создать класс' });
  const title = page.getByLabel('Название класса');
  const cancel = dialog.getByRole('button', { name: 'Отмена' });
  const submit = dialog.getByRole('button', { name: 'Создать' });

  await expect(dialog).toBeVisible();
  await expect(title).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(submit).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(title).toBeFocused();

  // The dialog gained an age band, module checkboxes and a safe-mode switch, so
  // a fixed three-stop order is no longer the contract. What must hold is that
  // tabbing never leaves the dialog.
  const stops = await dialog.locator('input, select, textarea, button').count();
  expect(stops).toBeGreaterThan(2);
  for (let step = 0; step < stops + 1; step += 1) {
    await page.keyboard.press('Tab');
    await expect(dialog.locator(':focus')).toHaveCount(1);
  }
  await expect(cancel).toBeVisible();

  // Escape is pressed from a known field so the restoration below is about
  // closing the dialog rather than about wherever the loop above ended.
  await title.focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('critical controls have names and reduced motion disables skeleton animation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  await page.getByTestId('entry-sign-in').click();
  await page.getByRole('button', { name: 'Вход через организацию' }).click();
  await expect(page.getByLabel('Код организации')).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Пароль')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти через организацию' })).toBeVisible();

  const animationName = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'card skeleton';
    document.body.append(probe);
    const value = getComputedStyle(probe).animationName;
    probe.remove();
    return value;
  });
  expect(animationName).toBe('none');
});

test('teacher portal has no horizontal overflow at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAndOpenClasses(page);
  const fitsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(fitsViewport).toBe(true);
});
