import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

/** TST-A11Y-001: automated accessibility for the teacher portal critical path.
 * axe-core scans (no critical/serious violations) plus explicit keyboard-only
 * flow, focus order and focus restoration assertions. */

let admin: pg.Pool;
let teacher: SeededTeacher;

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'a11y');
});

test.afterAll(async () => {
  await admin.end();
});

async function expectNoSeriousViolations(page: any, context: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(
    serious.map((v) => `${context}: ${v.id} (${v.impact}) — ${v.nodes.length} node(s)`),
  ).toEqual([]);
}

async function login(page: any) {
  await page.goto('/');
  await page.getByLabel('Workspace').fill(teacher.workspace);
  await page.getByLabel('Email').fill(teacher.email);
  await page.getByLabel('Пароль').fill(teacher.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
}

test('login page has no critical/serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Workspace')).toBeVisible();
  await expectNoSeriousViolations(page, 'login');
});

test('dashboard empty state has no critical/serious violations', async ({ page }) => {
  await login(page);
  await expectNoSeriousViolations(page, 'dashboard-empty');
});

test('create-classroom dialog is accessible with a working focus trap', async ({ page }) => {
  await login(page);
  const openButton = page.getByRole('button', { name: 'Создать класс' });
  await openButton.click();
  const dialog = page.getByRole('dialog', { name: 'Создать класс' });
  await expect(dialog).toBeVisible();
  await expectNoSeriousViolations(page, 'create-dialog');

  // Focus order inside the dialog: title input → Отмена → Создать → cycles.
  await expect(page.getByLabel('Название класса')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Создать' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Название класса')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Создать' })).toBeFocused();
});

test('keyboard-only open, cancel, reopen and create flow with focus restoration', async ({
  page,
}) => {
  await login(page);
  const openButton = page.getByRole('button', { name: 'Создать класс' });
  await openButton.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Создать класс' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Название класса')).toBeFocused();

  // Cancel with Escape: focus must be restored to the opener.
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(openButton).toBeFocused();

  // Reopen and create using the keyboard only.
  await page.keyboard.press('Enter');
  await page.keyboard.type('7Б Электроника');
  await page.keyboard.press('Enter');
  await expect(
    page.getByTestId('classroom-card').filter({ hasText: '7Б Электроника' }),
  ).toBeVisible();
});
