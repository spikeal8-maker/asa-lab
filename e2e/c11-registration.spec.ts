import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * C1.1 evidence: the public entry, the contextual chooser, the ordinary
 * sign-in and the separate legacy organization sign-in.
 *
 * Public registration is behind a feature flag that is off until
 * principal-aware sessions exist, so the form here proves the honest answer,
 * not a working adult account.
 */
test('public entry routes by intent and context', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  mkdirSync('e2e/artifacts/c11', { recursive: true });

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Присоединиться к классу' })).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/c11/public-entry.png' });

  // Intent first, context second.
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByRole('heading', { name: 'В школе' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Самостоятельно' })).toBeVisible();
  await expect(page.getByTestId('entry-school-class-code')).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/c11/context-chooser.png' });

  // A student is never dead-ended: the class-code path leads to a real screen.
  await page.getByTestId('entry-school-class-code').click();
  await expect(page.getByRole('heading', { name: 'Вход по коду класса' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('the ordinary sign-in asks for email only, with organization login apart', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByTestId('entry-school-educator').click();

  // No teacher wording and no organization code in the main form.
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Пароль')).toBeVisible();
  await expect(page.getByLabel('Код организации')).toHaveCount(0);
  await expect(page.getByText('Email педагога')).toHaveCount(0);
  await page.screenshot({ path: 'e2e/artifacts/c11/sign-in.png' });

  await page.getByRole('button', { name: 'Войти через организацию' }).click();
  await expect(page.getByLabel('Код организации')).toBeVisible();
  await expect(page.getByText('Временный совместимый путь')).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/c11/organization-sign-in.png' });
});

test('registration states the flag honestly and routes a minor', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await page.getByTestId('entry-personal-account').click();
  await expect(page.getByText('Создание личного аккаунта')).toBeVisible();

  // The username is a pseudonym with its own availability answer.
  await page.getByLabel('Псевдоним').fill(`pseudo${Date.now()}`);
  await expect(page.getByTestId('username-availability')).toContainText('свободен');
  await page.screenshot({ path: 'e2e/artifacts/c11/registration-form.png' });

  // A minor gets routes, not a dead end.
  await page.getByLabel('Дата рождения').fill('2014-01-01');
  await page.getByLabel('Email').fill(`minor-${Date.now()}@test.local`);
  await page.getByLabel('Пароль').fill('sufficiently-long-pass');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByTestId('register-error')).toContainText('с 18 лет');
  await expect(page.getByRole('button', { name: 'Войти по коду класса' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Создать ученический аккаунт — следующий этап' }),
  ).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/c11/minor-routes.png' });

  // An adult sees the feature-flag answer instead of a half-made account.
  await page.getByLabel('Дата рождения').fill('1990-05-17');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByTestId('register-error')).toContainText('следующем этапе');
  await page.screenshot({ path: 'e2e/artifacts/c11/registration-flag-off.png' });

  expect(pageErrors, 'the refusals must not throw in the page').toEqual([]);
});
