import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';
import { signInThroughOrganization } from './entry';

let admin: pg.Pool;
let teacher: SeededTeacher;

async function login(page: Page): Promise<void> {
  await signInThroughOrganization(page, teacher);
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

/** Classes are a separate area in the project-first workbench. */
async function openClasses(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Классы' }).click();
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
}

test('login page passes automated WCAG A/AA checks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ASA Lab' })).toBeVisible();
  await expectNoWcagViolations(page);
});

test('dashboard and create dialog pass automated WCAG A/AA checks', async ({ page }) => {
  await login(page);
  await expectNoWcagViolations(page);

  await openClasses(page);
  await page.getByRole('button', { name: 'Создать класс' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Создать класс' })).toBeVisible();
  await expectNoWcagViolations(page);
});

test('skip link moves keyboard focus to the dashboard content', async ({ page }) => {
  await login(page);
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

  await openClasses(page);
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

  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('critical controls have names and reduced motion disables skeleton animation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  await expect(page.getByTestId('entry-sign-in')).toBeVisible();
  await expect(page.getByTestId('entry-sign-up')).toBeVisible();

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
  await login(page);
  const fitsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(fitsViewport).toBe(true);
});
