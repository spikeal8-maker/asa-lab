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
  await page.getByRole('banner').getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByTestId('login-organization').click();
  await page.getByLabel('Код организации').fill(credentials.workspace);
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Пароль').fill(credentials.password);
  await page.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  const submit = page.getByRole('button', { name: 'Войти через организацию' });
  await expect(submit).toBeEnabled();
  const loginResponse = page.waitForResponse(
    (response) => {
      if (
        new URL(response.url()).pathname !== '/api/auth/login' ||
        response.request().method() !== 'POST'
      ) {
        return false;
      }
      const request = response.request().postDataJSON();
      return (
        request.workspace === credentials.workspace.trim() &&
        request.email === credentials.email.trim()
      );
    },
    { timeout: 5_000 },
  );
  await submit.click();
  const response = await loginResponse;
  expect(response.status()).toBe(200);
  const session = (await response.json()) as {
    authenticated?: boolean;
    user?: { email?: string };
  };
  expect(session.authenticated, 'Organization login authenticated the requested account').toBe(
    true,
  );
  expect(
    session.user?.email?.toLowerCase() === credentials.email.trim().toLowerCase(),
    'Organization login returned the requested account',
  ).toBe(true);
  await expect(page.getByRole('banner').getByLabel(/^Меню аккаунта /)).toBeVisible();
  await expect(page).toHaveURL(/\/#\/home$/);
  // Home retains its named landmark after the visible page heading was removed.
  await expect(page.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
}
