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
