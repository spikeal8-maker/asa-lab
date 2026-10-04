import { expect, type Page } from '@playwright/test';

export async function openNewAssignmentEditor(page: Page): Promise<void> {
  await page.goto('/#/challenges');
  const button = page.getByRole('button', { name: /Новое задание/ });
  await expect(button).toBeVisible();
  await button.click();
}

export async function openExistingAssignmentEditor(page: Page, title: string): Promise<void> {
  await page.goto('/#/challenges');
  const button = page.getByRole('button', {
    name: `Открыть задание «${title}»`,
    exact: true,
  });
  await expect(button).toBeVisible();
  await button.click();
}
