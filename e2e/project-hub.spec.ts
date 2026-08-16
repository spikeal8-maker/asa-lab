import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { collectBrowserFailures } from './browser-failures';
import { openPortalSection } from './portal-navigation';

const EVIDENCE_DIR =
  process.env['ASA_OWNER_EVIDENCE_DIR'] ?? 'e2e/artifacts/project-hub/r3b-project-lifecycle';

/**
 * Reveals a card's actions and opens its menu. The menu is a <details>, and
 * clicking the summary of an open one closes it, so opening is conditional.
 */
async function openCardMenu(card: Locator): Promise<void> {
  await card.hover();
  const menu = card.locator('details');
  if (!(await menu.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await menu.locator('> summary').click();
  }
  await expect(menu).toHaveAttribute('open', '');
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
}

test('project hub supports duplicate, archive, trash and restore journeys', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await page.getByTestId('entry-sign-up').click();
  await page.getByLabel('Email').fill(`project_${unique}@r3b-e2e.test`);
  await page.getByLabel('Имя пользователя').fill(`project_${unique}`.slice(0, 36));
  await page.getByLabel('Отображаемое имя (необязательно)').fill('Анна Проектова');
  await page.getByLabel('Дата рождения').fill('1993-04-18');
  await page.getByLabel('Пароль').fill(`Safe-${unique}-Password`);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/#\/home$/);

  const response = await page.context().request.post('/api/projects', {
    headers: { origin: new URL(page.url()).origin, 'idempotency-key': `hub-${unique}` },
    data: {
      scope: 'personal',
      classroomId: null,
      module: 'electronics',
      title: 'Умный светильник',
    },
  });
  expect(response.status()).toBe(201);

  await openPortalSection(page, 'Проекты');
  await expect(page).toHaveURL(/#\/projects$/);
  const original = page.getByTestId('project-card').filter({
    has: page.getByRole('heading', { name: 'Умный светильник', exact: true }),
  });
  await expect(original).toBeVisible();
  // The card actions live over the picture and appear on hover, as they do for a learner.
  await openCardMenu(original);
  await original.getByRole('button', { name: 'Дублировать' }).click();
  await expect(page.getByText('Умный светильник — копия', { exact: true })).toBeVisible();

  // The list re-rendered around the new copy, so the menu has to be reopened.
  await openCardMenu(original);
  await original.getByRole('button', { name: 'Архивировать' }).click();
  await expect(original).toHaveCount(0);
  await page.getByRole('tab', { name: 'Архив' }).click();
  const archived = page.getByTestId('project-card').filter({
    has: page.getByRole('heading', { name: 'Умный светильник', exact: true }),
  });
  await expect(archived).toBeVisible();
  await archived.hover();
  await archived.getByRole('button', { name: 'Восстановить' }).click();
  await expect(archived).toHaveCount(0);

  await page.getByRole('tab', { name: 'Проекты' }).click();
  const copy = page.getByTestId('project-card').filter({
    has: page.getByRole('heading', { name: 'Умный светильник — копия', exact: true }),
  });
  await openCardMenu(copy);
  await copy.getByRole('button', { name: 'В корзину' }).click();
  await expect(copy).toHaveCount(0);
  await page.getByRole('tab', { name: 'Корзина' }).click();
  await expect(page.getByText('Умный светильник — копия', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('tab', { name: 'Проекты' }).click();
  await expect(page.getByText('Умный светильник', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-project-hub-desktop.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-project-hub-mobile.png`, fullPage: true });

  failures.assertEmpty();
});
