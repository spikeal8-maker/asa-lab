import { expect, type Page } from '@playwright/test';

async function openAssignmentList(page: Page): Promise<void> {
  await page.goto('/#/challenges');

  const tabs = page.getByRole('navigation', { name: 'Разделы курсов и заданий' });
  const assignmentsTab = tabs.getByRole('button', { name: 'Задания', exact: true });
  if (
    (await assignmentsTab.count()) > 0 &&
    (await assignmentsTab.getAttribute('aria-current')) !== 'page'
  ) {
    await assignmentsTab.click();
  }

  const back = page.getByRole('button', { name: '← Задания', exact: true });
  if (await back.isVisible().catch(() => false)) {
    await back.click();
  }

  await expect(page.locator('.authored-assignment-list')).toBeVisible();
}

export async function openNewAssignmentEditor(page: Page): Promise<void> {
  await openAssignmentList(page);
  const button = page.getByRole('button', { name: /Новое задание/ });
  await expect(button).toBeVisible();
  await button.click();
}

export async function openExistingAssignmentEditor(page: Page, title: string): Promise<void> {
  await openAssignmentList(page);
  const button = page.getByRole('button', {
    name: `Открыть задание «${title}»`,
    exact: true,
  });
  await expect(button).toBeVisible();
  await button.click();
}
