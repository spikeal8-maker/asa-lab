import { expect, type Page } from '@playwright/test';

export interface OrganizationCredentials {
  readonly workspace: string;
  readonly email: string;
  readonly password: string;
}

export async function loginWithOrganization(
  page: Page,
  credentials: OrganizationCredentials,
): Promise<void> {
  await page.goto('/#/projects');
  await page
    .getByRole('button', { name: 'Войти', exact: true })
    .or(page.getByRole('link', { name: 'Войти', exact: true }))
    .click();
  await page.getByTestId('login-organization').click();
  await page.getByLabel('Код организации').fill(credentials.workspace);
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Пароль').fill(credentials.password);
  await page.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  const submit = page.getByRole('button', { name: 'Войти через организацию' });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(
    page.getByRole('heading', {
      name: /^(Мои проекты|Главная)$/,
    }),
  ).toBeVisible();
}
