import { expect, type Page } from '@playwright/test';
import type { SeededTeacher } from './seed';

/**
 * Walks the public entry the way a person does: one intention, one screen.
 *
 * A teacher onboarded before accounts existed takes the secondary link at the
 * bottom of the ordinary sign-in; everyone else uses the form above it.
 */
export async function signInThroughOrganization(page: Page, teacher: SeededTeacher): Promise<void> {
  await openSignIn(page);
  await page.getByRole('button', { name: 'Вход для ранее подключённой организации' }).click();

  await page.getByLabel('Код организации').fill(teacher.workspace);
  await page.getByLabel('Email').fill(teacher.email);
  await page.getByLabel('Пароль').fill(teacher.password);
  await page.getByRole('button', { name: 'Войти через организацию' }).click();
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();
}

/** Opens the universal sign-in without signing in. */
export async function openSignIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('entry-sign-in').click();
  await expect(page.getByLabel('Email или имя пользователя')).toBeVisible();
}
