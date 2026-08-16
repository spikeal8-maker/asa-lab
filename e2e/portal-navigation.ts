import { expect, type Page } from '@playwright/test';

/**
 * The portal has two navigation regions: a sidebar ("Основная навигация") that
 * lists the sections, and a top bar ("Разделы ASA Lab") with a shorter set of
 * destinations. Several labels appear in both, and "Проекты" also names a tab
 * inside a classroom and a filter on the projects page.
 *
 * That is fine for a person, who reads a control by where it sits. It is not
 * fine for an unscoped role query, which matched every one of them and started
 * failing the moment a second match appeared on screen. Tests go through the
 * region, the same way a screen-reader user does.
 */
export function portalSidebar(page: Page) {
  return page.getByLabel('Основная навигация');
}

export function portalTopBar(page: Page) {
  return page.getByLabel('Разделы ASA Lab');
}

export function portalSection(page: Page, label: string) {
  return portalSidebar(page).getByRole('button', { name: label, exact: true });
}

export async function openPortalSection(page: Page, label: string): Promise<void> {
  await expect(portalSection(page, label)).toBeVisible();
  await portalSection(page, label).click();
}

/**
 * Account actions live in a disclosure that closes on navigation, and workspace
 * switching sits in a nested group inside it. Both have to be reopened every
 * time, which is easy to forget and reads as a mysterious timeout when omitted.
 */
export function accountMenu(page: Page) {
  return page.locator('.portal-account-menu');
}

/**
 * Both of these are <details>: clicking the summary of an already-open one
 * closes it. Opening is therefore conditional, so a helper can be called twice
 * in a row without the second call undoing the first.
 */
async function openDisclosure(page: Page, selector: string): Promise<void> {
  const details = page.locator(selector);
  await expect(details).toBeAttached();
  // The open attribute is the state itself; visibility lags behind it while the
  // panel animates, and polling visibility raced with that.
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await details.locator('> summary').click();
  }
  await expect(details).toHaveAttribute('open', '');
}

export async function openAccountMenu(page: Page): Promise<void> {
  await openDisclosure(page, '.portal-account');
  await expect(accountMenu(page)).toBeVisible();
}

async function openWorkspaceGroup(page: Page): Promise<void> {
  await openDisclosure(page, '.portal-account-workspaces');
  await expect(page.locator('.portal-account-workspace-list')).toBeVisible();
}

export async function openAccountSettings(page: Page): Promise<void> {
  await openAccountMenu(page);
  await accountMenu(page).getByRole('button', { name: 'Настройки', exact: true }).click();
}

export async function switchWorkspace(page: Page, title: string | RegExp): Promise<void> {
  await openAccountMenu(page);
  await openWorkspaceGroup(page);
  const entry = page.locator('.portal-account-workspace-list button').filter({ hasText: title });
  await expect(entry).toBeVisible();
  await entry.click();
}

/** Personal space is listed by its own title with this subtitle underneath. */
export const PERSONAL_WORKSPACE = 'Личные проекты';
