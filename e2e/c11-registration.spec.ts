import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/** C1.1 evidence: adult registration and sign-in without an organization code. */
test('adult registers, lands in the personal workspace and signs in by email', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const email = `c11-${Date.now()}@test.local`;
  const password = 'sufficiently-long-pass';

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/c11/login-with-registration.png', fullPage: false });

  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByRole('heading', { name: 'ASA Lab' })).toBeVisible();
  await expect(page.getByText('Создание личного аккаунта')).toBeVisible();

  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.getByLabel('Дата рождения').fill('1990-05-17');
  await page.getByLabel('Имя').fill('Демо Педагог');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  mkdirSync('e2e/artifacts/c11', { recursive: true });
  await page.screenshot({ path: 'e2e/artifacts/c11/registration-form.png', fullPage: false });

  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  // Registration signs the account in and lands in its personal workspace.
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/c11/personal-workspace.png', fullPage: false });

  // Sign out and sign back in with email and password only.
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();

  // Everything up to here must be free of console and page errors.
  expect(consoleErrors, 'console errors during the happy path').toEqual([]);
  expect(pageErrors, 'page errors during the happy path').toEqual([]);

  // Under-18 self-registration is refused by the server policy; the browser
  // echoes that deliberate 422 as a console error, so it is expected here.
  await page.getByRole('button', { name: 'Выйти' }).click();
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await page.getByLabel('Дата рождения').fill('2014-01-01');
  await page.getByLabel('Имя').fill('Юный пользователь');
  await page.getByLabel('Email').fill(`minor-${Date.now()}@test.local`);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('с 18 лет');
  await page.screenshot({ path: 'e2e/artifacts/c11/age-policy.png', fullPage: false });
  expect(pageErrors, 'the refusal must not throw in the page').toEqual([]);
});
