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

export async function addAssignmentBlock(page: Page, label: string): Promise<void> {
  const trigger = page.getByRole('button', { name: '+ Добавить блок', exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Добавить блок' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: label, exact: true }).click();
}

export async function previewAssignmentAs(
  page: Page,
  source: 'draft' | 'published',
): Promise<void> {
  const drawer = page.getByRole('dialog', { name: 'Как увидит ученик' });
  if (!(await drawer.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
    await expect(drawer).toBeVisible();
  }
  await drawer
    .getByRole('button', {
      name: source === 'draft' ? 'Черновик' : 'Опубликованная версия',
      exact: true,
    })
    .click();
}

export async function closeAssignmentPreview(page: Page): Promise<void> {
  const drawer = page.getByRole('dialog', { name: 'Как увидит ученик' });
  if (await drawer.isVisible().catch(() => false)) {
    await drawer.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click();
  }
}

export async function openAssignmentSettings(page: Page): Promise<void> {
  const drawer = page.getByRole('dialog', { name: 'Настройки' });
  if (!(await drawer.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Настройки', exact: true }).first().click();
    await expect(drawer).toBeVisible();
  }
}

export async function closeAssignmentSettings(page: Page): Promise<void> {
  const drawer = page.getByRole('dialog', { name: 'Настройки' });
  if (await drawer.isVisible().catch(() => false)) {
    await drawer.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();
  }
}
