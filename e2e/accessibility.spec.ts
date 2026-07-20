import { test, expect } from '@playwright/test';
import pg from 'pg';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

let admin: pg.Pool;
let teacher: SeededTeacher;

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Workspace').fill(teacher.workspace);
  await page.getByLabel('Email').fill(teacher.email);
  await page.getByLabel('Пароль').fill(teacher.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
}

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'a11y');
});

test.afterAll(async () => {
  await admin.end();
});

test('dialog supports initial focus, focus trap, Escape and focus restoration', async ({ page }) => {
  await login(page);

  const trigger = page.getByRole('button', { name: 'Создать класс' });
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

test('critical controls have names and reduced motion disables skeleton animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  await expect(page.getByLabel('Workspace')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Пароль')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();

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
